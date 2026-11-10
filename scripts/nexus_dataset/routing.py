"""Export measured benchmark observations. The question/answer payloads stay out of the exported data."""
import hashlib
import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

from scripts.benchmarks.paired_cases import CASES, task_prompt, validate_answer
from scripts.nexus_session_usage.report import COUNTERS, _check_schema, _sample
from scripts.nexus_session_usage.snapshot import MAX_BYTES, UsageError, open_snapshot
from .input import HASH, artifact, pinned_bytes

FIXTURE = "0894ac84d787d907bec32f1d76e0797fdd233b7a"
HERMES = "903a57c540917cedd30c7d971938f1af7bdf60e2"
CASES_BY_ID = {case["id"]: case for case in CASES}
MODEL = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}\Z")
PROTOCOL = "07aed5635c69b73372f72825ff9dcf0a6f96ed3885c2e53139663c0e4e22f85a"
MODEL_BYTES = "f530705d447660a4336c329981af164b471b60b974b1d808d57e8ec9fe23b239"
ENGINE = "523c55e2d680718afd84b0ac980f852531d96fea93a9a9762ab4ae52ce094422"
SESSIONS_BUDGET = 256 * 1024 * 1024


def check(ok, code):
    if not ok:
        raise UsageError(code)


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()


def session_data(snapshot, sid, model, expected_prompt):
    with open_snapshot(snapshot) as db:
        _check_schema(db)
        sample = _sample(db, sid)
        check(sample["status"] == "present" and sample["positiveTokenCountObserved"], "missing_session_usage")
        table = db.execute("PRAGMA table_list('messages')").fetchone()
        columns = {r[1]: r for r in db.execute("PRAGMA table_xinfo('messages')")}
        session_columns = {r[1]: r for r in db.execute("PRAGMA table_xinfo('sessions')")}
        check(table and table[:3] == ("main", "messages", "table") and all(
            k in columns and columns[k][6] == 0 for k in ("id", "role", "session_id", "content"))
            and columns["id"][5] == 1 and "model" in session_columns and session_columns["model"][6] == 0,
            "unsupported_messages_schema")
        check(db.execute("SELECT id,model FROM sessions LIMIT 2").fetchall() == [(sid, model)], "session_model_mismatch")
        users = db.execute("SELECT content FROM messages WHERE session_id=? AND role='user' ORDER BY id LIMIT 2", (sid,)).fetchall()
        last = db.execute("SELECT role,content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 1", (sid,)).fetchone()
        check(users == [(expected_prompt,)] and last and last[0] == "assistant" and isinstance(last[1], str)
              and 0 < len(last[1]) <= 8192, "session_messages_mismatch")
        return sample["counters"], last[1]


def observations(report_path, report_digest, manifest_path, manifest_digest):
    report = artifact(report_path, report_digest, 2 * 1024 * 1024)
    retained = artifact(manifest_path, manifest_digest, 65536)
    check(isinstance(report, dict) and report.get("format") == "nexus-paired-hermes-v1"
          and report.get("fixtureRevision") == FIXTURE and report.get("hermesRevision") == HERMES
          and isinstance(report.get("rows"), list) and len(report["rows"]) <= 96
          and isinstance(report.get("model"), str) and MODEL.fullmatch(report["model"])
          and report.get("protocolSha256") == PROTOCOL and report.get("engineSha256") == ENGINE
          and report.get("modelSha256") == MODEL_BYTES and report.get("model") == "qwen2.5-coder-1.5b"
          and isinstance(retained, dict) and len(retained) <= 96, "unsupported_benchmark_or_manifest")
    directory = Path(manifest_path).absolute().parent
    excluded, rows, seen, total = Counter(), [], set(), 0
    def charge(size):
        nonlocal total
        total += size
        check(total <= SESSIONS_BUDGET, "total_session_budget")

    with tempfile.TemporaryDirectory() as temp:
        copy = Path(temp) / "pinned-session.sqlite"
        for item in report["rows"]:
            check(isinstance(item, dict), "invalid_benchmark_row")
            case_id, repeat, arm = (item.get(k) for k in ("task", "repeat", "arm"))
            check(isinstance(case_id, str) and case_id in CASES_BY_ID and type(repeat) is int and 1 <= repeat <= 16
                  and isinstance(arm, str) and arm in {"baseline", "nexus", "compact"}, "invalid_benchmark_row")
            sid = f"bench-{repeat}-{case_id}-{arm}"
            check(sid not in seen, "duplicate_benchmark_trial")
            seen.add(sid)
            if item.get("execution") != "completed":
                excluded["incomplete_execution"] += 1
                continue
            if sid not in retained:
                excluded["native_snapshot_missing"] += 1
                continue
            ref = retained[sid]
            check(isinstance(ref, dict) and ref.get("file") == sid + ".sqlite" and isinstance(ref.get("sha256"), str)
                  and HASH.fullmatch(ref["sha256"]), "invalid_session_manifest")
            try:
                prompt = task_prompt(CASES_BY_ID[case_id])
                check(item.get("sessionId") == sid and item.get("fixtureRevision") == FIXTURE
                      and item.get("promptSha256") == sha(prompt), "trial_binding_mismatch")
                data = pinned_bytes(directory / ref["file"], ref["sha256"], MAX_BYTES, standalone=True, charge=charge)
                copy.write_bytes(data)
                counters, answer = session_data(copy, sid, report["model"], prompt)
                usage = item.get("usage")
                check(isinstance(usage, dict) and usage.get("sessionId") == sid and usage.get("status") == "present"
                      and usage.get("positiveTokenCountObserved") is True and isinstance(usage.get("counters"), dict)
                      and all(type(usage["counters"].get(k)) is int and usage["counters"][k] == counters[k] for k in COUNTERS),
                      "counter_mismatch")
                check(item.get("answer") == answer, "native_answer_mismatch")
                try:
                    score = validate_answer(CASES_BY_ID[case_id], answer)
                except (RecursionError, ValueError, TypeError, subprocess.SubprocessError):
                    raise UsageError("unscorable_answer") from None
                check(score in {"pass", "wrong_answer", "invalid_answer"} and item.get("score") == score, "oracle_disagreement")
            except UsageError as exc:
                if str(exc) == "total_session_budget":
                    raise
                excluded[str(exc)] += 1
                continue
            rows.append({"schemaVersion": 1, "exampleType": "benchmark_routing_observation", "projectId": "PrJ_Bench",
                         "revision": FIXTURE, "task": case_id, "repeat": repeat, "arm": arm, "sessionId": sid,
                         "outcome": score, "sessionCounters": counters, "model": report["model"],
                         "modelSha256": report["modelSha256"], "engineSha256": report["engineSha256"],
                         "protocolSha256": report["protocolSha256"], "promptSha256": sha(prompt),
                         "benchmarkSha256": report_digest, "sessionSnapshotSha256": ref["sha256"]})
    rows.sort(key=lambda r: (r["task"], r["repeat"], r["arm"]))
    return rows, {"considered": len(seen), "emitted": len(rows), "excluded": dict(excluded)}
