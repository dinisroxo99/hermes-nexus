"""Minimized observations from standalone snapshots of the pinned Hermes Kanban schema."""
import hashlib
import json
import re

from scripts.nexus_session_usage.snapshot import UsageError, open_snapshot

PROJECT = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
SESSION = re.compile(r"[A-Za-z0-9._:-]{1,128}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
PR = re.compile(r"https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([1-9][0-9]{0,9})\Z")
SOURCE = "hermes.kanban.pr_acceptance"
MAX_RUNS, MAX_EVENTS = 64, 512
TASK_STATES = {"triage", "todo", "ready", "running", "blocked", "review", "done", "archived", "scheduled"}
RUN_STATES = {"running", "done", "blocked", "crashed", "timed_out", "failed", "released"}
OUTCOMES = {"completed", "blocked", "crashed", "timed_out", "spawn_failed", "gave_up", "reclaimed",
            "released", "abandoned", "interrupted", "superseded", "failed", "review_requested", "archived"}
SCHEMA = {
    "tasks": {"id", "project_id", "status", "session_id", "completion_contract"},
    "task_runs": {"id", "task_id", "status", "outcome", "started_at", "ended_at"},
    "task_events": {"id", "task_id", "run_id", "kind", "payload", "created_at"},
}


def require(condition, code):
    if not condition:
        raise UsageError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(",", ":"), ensure_ascii=True, sort_keys=True).encode()).hexdigest()


def validate_schema(db):
    for name, required in SCHEMA.items():
        table = db.execute(f"PRAGMA main.table_list('{name}')").fetchone()
        require(table and table[:3] == ("main", name, "table"), "unsupported_kanban_schema")
        columns = {r[1]: r for r in db.execute(f"PRAGMA main.table_xinfo('{name}')")}
        require(all(k in columns and columns[k][6] == 0 for k in required), "unsupported_kanban_schema")
        require(columns["id"][5] == 1 and sum(c[5] > 0 for c in columns.values()) == 1, "unsupported_kanban_schema")
        require(columns["id"][2].upper() == ("TEXT" if name == "tasks" else "INTEGER"), "unsupported_kanban_schema")


def _payload(raw):
    def object_pairs(items):
        data = dict(items)
        require(len(data) == len(items), "invalid_event_payload")
        return data
    require(isinstance(raw, str) and len(raw) <= 65536, "invalid_event_payload")
    try:
        value = json.loads(raw, object_pairs_hook=object_pairs)
    except (ValueError, RecursionError):
        raise UsageError("invalid_event_payload") from None
    require(isinstance(value, dict), "invalid_event_payload")
    return value


def _receipt(payload, contract):
    # All fields come from Hermes's machine-written pr_acceptance event. Never echo check names, URLs or detail text.
    require(type(payload.get("ok")) is bool and isinstance(payload.get("classification"), str), "invalid_receipt")
    match = PR.fullmatch(payload["pr_url"]) if isinstance(payload.get("pr_url"), str) else None
    revision = payload.get("head_sha")
    if not payload["ok"]:
        return {"verified": False, "revision": revision if isinstance(revision, str) and SHA.fullmatch(revision) else None}
    require(payload["classification"] == "success" and match and payload["pr_url"] == contract and
            isinstance(revision, str) and SHA.fullmatch(revision), "invalid_receipt")
    required, checks = payload.get("required"), payload.get("checks")
    require(isinstance(required, list) and 0 < len(required) <= 128 and
            isinstance(checks, list) and 0 < len(checks) <= 256, "invalid_receipt")
    for entry in required:
        require(isinstance(entry, dict) and isinstance(entry.get("context"), str) and
                0 < len(entry["context"]) <= 256 and (entry.get("app_id") is None or type(entry["app_id"]) is int),
                "invalid_receipt")
    for check in checks:
        require(isinstance(check, dict) and type(check.get("id")) is int and check["id"] > 0 and
                isinstance(check.get("name"), str) and check.get("head_sha") == revision and
                check.get("conclusion") == "success" and check.get("classification") == "success", "invalid_receipt")
    require({row["context"] for row in required} == {row["name"] for row in checks}, "invalid_receipt")
    return {"verified": True, "revision": revision, "repository": match[1], "pullRequest": int(match[2]),
            "requiredCheckCount": len(required)}


def observe(snapshot, project, task):
    require(isinstance(project, str) and PROJECT.fullmatch(project) and isinstance(task, str) and PROJECT.fullmatch(task),
            "invalid_project_or_task")
    with open_snapshot(snapshot) as db:
        validate_schema(db)
        row = db.execute("SELECT project_id,status,session_id,completion_contract FROM main.tasks WHERE id=? COLLATE BINARY",
                         (task,)).fetchone()
        require(row and row[0] == project, "project_task_mismatch")
        runs = db.execute("SELECT id,status,outcome,started_at,ended_at FROM main.task_runs WHERE task_id=? COLLATE BINARY "
                          "ORDER BY id LIMIT ?", (task, MAX_RUNS + 1)).fetchall()
        events = db.execute("SELECT id,run_id,kind,created_at,CASE WHEN kind IN ('created','pr_acceptance') "
                            "THEN payload END FROM main.task_events WHERE task_id=? COLLATE BINARY ORDER BY id LIMIT ?",
                            (task, MAX_EVENTS + 1)).fetchall()
    return observe_rows(project, task, row, runs, events)


def observe_rows(project, task, row, runs, events):
    require(row and row[0] == project, "project_task_mismatch")
    state, session, contract = row[1:]
    require(state in TASK_STATES and (session is None or isinstance(session, str) and SESSION.fullmatch(session)),
            "invalid_task_record")
    require(len(runs) <= MAX_RUNS and 0 < len(events) <= MAX_EVENTS, "task_history_incomplete")
    run_ids = {r[0] for r in runs}
    receipts, completions, claims, prefixes = {}, {}, {}, {}
    prefix = ""
    created = 0
    for eid, rid, kind, when, raw in events:
        require(type(eid) is int and eid > 0 and (rid is None or type(rid) is int and rid in run_ids) and
                type(when) is int and when >= 0 and isinstance(kind, str) and 0 < len(kind) <= 128, "invalid_event")
        selected = None
        if kind == "created":
            created += 1
            selected = _payload(raw).get("project_id")
            require(rid is None and selected == project, "project_task_mismatch")
        elif kind == "pr_acceptance" and rid is not None:
            selected = _receipt(_payload(raw), contract)
            receipts[rid] = (eid, selected)
        elif kind == "completed" and rid is not None:
            completions[rid] = eid
        elif kind == "claimed" and rid is not None:
            claims[rid] = eid
        prefix = digest([prefix, eid, rid, kind, when, selected])
        prefixes[eid] = prefix
    require(created == 1, "missing_task_creation")
    output = []
    for rid, run_state, outcome, start, end in runs:
        require(type(rid) is int and rid > 0 and run_state in RUN_STATES and type(start) is int and start >= 0 and
                (end is None or type(end) is int and end >= start), "invalid_run")
        require(outcome is None or isinstance(outcome, str) and len(outcome) <= 64, "invalid_run")
        receipt_id, receipt = receipts.get(rid, (None, {}))
        evidence = {"projectId": project, "taskId": task, "runId": rid, "originSessionId": session,
                    "revision": receipt.get("revision"), "outcome": outcome if outcome in OUTCOMES else None,
                    "runStatus": run_state, "source": SOURCE, "acceptanceEventId": receipt_id,
                    "completedEventId": completions.get(rid), "repository": receipt.get("repository"),
                    "pullRequest": receipt.get("pullRequest"), "requiredCheckCount": receipt.get("requiredCheckCount", 0)}
        valid = (receipt.get("verified") and rid in claims and claims[rid] < receipt_id < completions.get(rid, 0)
                 and run_state == "done" and outcome == "completed" and end is not None)
        if valid:
            latest = rid == runs[-1][0] and state == "done"
            evidence.update(status="active" if latest else "superseded",
                            qualityReason="terminal_checks_passed" if latest else "task_or_attempt_superseded")
        elif receipt_id is None:
            evidence.update(status="candidate", qualityReason="no_independent_receipt")
        else:
            evidence.update(status="rejected", qualityReason="checks_or_terminal_chain_unverified")
        evidence["evidenceId"] = "kanban_" + digest([project, task, rid, receipt_id, receipt.get("revision")])
        output.append(evidence)
    return {"project": project, "task": task, "watermark": events[-1][0], "prefixes": prefixes, "rows": output}
