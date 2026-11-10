"""Transactional, bounded local store for minimized Hermes observations."""
import json
import sqlite3
from contextlib import contextmanager

from scripts.nexus_session_usage.report import report_usage
from scripts.nexus_session_usage.snapshot import UsageError
from .files import MAX_BYTES, locked_store
from .source import OUTCOMES, PROJECT, PR, RUN_STATES, SESSION, SHA, SOURCE, digest, require

APP_ID = 0x4E585248
MAX_TASKS = 2000
MAX_ROWS = 10000
PENDING_REASONS = {"project_task_mismatch", "invalid_task_record", "task_history_incomplete", "invalid_event",
                   "invalid_event_payload", "invalid_receipt", "missing_task_creation", "invalid_run",
                   "divergent_task_history", "project_repository_mismatch", "unexpected_historical_task",
                   "previous_task_missing"}
LEGACY_DDL = {
    "project_sources": "CREATE TABLE project_sources(project TEXT PRIMARY KEY,repository TEXT NOT NULL) WITHOUT ROWID",
    "task_heads": """CREATE TABLE task_heads(project TEXT NOT NULL,task TEXT NOT NULL,watermark INTEGER NOT NULL,
        prefix TEXT NOT NULL,rows_hash TEXT NOT NULL,PRIMARY KEY(project,task)) WITHOUT ROWID""",
    "observations": """CREATE TABLE observations(project TEXT NOT NULL,task TEXT NOT NULL,run INTEGER NOT NULL,
        revision TEXT,status TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(project,task,run)) WITHOUT ROWID""",
    "observations_scope": "CREATE INDEX observations_scope ON observations(project,revision,status,task,run)",
}


SYNC_TABLE = """CREATE TABLE sync_projects(project TEXT PRIMARY KEY,watermark INTEGER NOT NULL,
    publication TEXT NOT NULL) WITHOUT ROWID"""
PENDING_TABLE = """CREATE TABLE sync_pending(project TEXT NOT NULL,task TEXT NOT NULL,watermark INTEGER NOT NULL,
    reason TEXT NOT NULL,PRIMARY KEY(project,task)) WITHOUT ROWID"""
DDL = {**LEGACY_DDL, "sync_projects": SYNC_TABLE, "sync_pending": PENDING_TABLE}


def store_version(db):
    app = db.execute("PRAGMA application_id").fetchone()[0]
    version = db.execute("PRAGMA user_version").fetchone()[0]
    schema = dict(db.execute("SELECT name,sql FROM sqlite_schema WHERE substr(name,1,7) != 'sqlite_'"))
    require(app == APP_ID and version in (1, 2) and schema == (LEGACY_DDL if version == 1 else DDL),
            "unsupported_history_store")
    return version


@contextmanager
def connect_store(filename, write=False):
    db = None
    try:
        with locked_store(filename, write) as (data, publish):
            db = sqlite3.connect(":memory:", isolation_level=None)
            if data is not None:
                db.deserialize(data)
            db.execute("PRAGMA trusted_schema=OFF")
            db.execute("PRAGMA temp_store=MEMORY")
            db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 1024 * 1024)
            if not write:
                db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN")
            version = 0
            if data is None:
                for sql in DDL.values():
                    db.execute(sql)
                db.execute(f"PRAGMA application_id={APP_ID}")
                db.execute("PRAGMA user_version=2")
            else:
                version = store_version(db)
                if write and version == 1:
                    db.execute(SYNC_TABLE)
                    db.execute(PENDING_TABLE)
                    db.execute("PRAGMA user_version=2")
            if write:
                page_size = db.execute("PRAGMA page_size").fetchone()[0]
                db.execute(f"PRAGMA max_page_count={MAX_BYTES // page_size}")
            yield db
            db.commit()
            if write and (data is None or version == 1 or db.total_changes):
                publish(db.serialize())
    except (OSError, sqlite3.Error):
        raise UsageError("history_store_unavailable") from None
    finally:
        if db is not None:
            db.close()


def ingest(store, observation):
    with connect_store(store, write=True) as db:
        report = ingest_task(db, observation)
        if db.total_changes:
            db.execute("UPDATE sync_projects SET publication='' WHERE project=? AND publication!=''", (observation["project"],))
        return report


def ingest_task(db, observation):
    project, task, watermark = (observation[k] for k in ("project", "task", "watermark"))
    rows, prefixes = observation["rows"], observation["prefixes"]
    previous = db.execute("SELECT watermark,prefix,rows_hash FROM task_heads WHERE project=? AND task=?",
                          (project, task)).fetchone()
    pending = db.execute("SELECT watermark FROM sync_pending WHERE project=? AND task=?", (project, task)).fetchone()
    rows_hash = digest(rows)
    action = "imported"
    if pending and watermark < pending[0]:
        action = "older_snapshot"
    elif previous is not None:
        old_id, old_prefix, old_hash = previous
        if watermark < old_id:
            action = "older_snapshot"
        else:
            require(prefixes.get(old_id) == old_prefix, "divergent_task_history")
            if watermark == old_id:
                require(rows_hash == old_hash, "divergent_task_history")
                action = "already_imported"
    if action == "imported":
        repositories = {r["repository"].lower() for r in rows if r["repository"] is not None}
        require(len(repositories) <= 1, "project_repository_mismatch")
        if repositories:
            repository = repositories.pop()
            db.execute("INSERT OR IGNORE INTO project_sources VALUES(?,?)", (project, repository))
            bound = db.execute("SELECT repository FROM project_sources WHERE project=?", (project,)).fetchone()
            require(bound[0] == repository, "project_repository_mismatch")
        old_runs = {r[0] for r in db.execute("SELECT run FROM observations WHERE project=? AND task=?", (project, task))}
        require(old_runs <= {row["runId"] for row in rows}, "divergent_task_history")
        count = db.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
        tasks = db.execute("SELECT COUNT(*) FROM task_heads").fetchone()[0]
        require(count - len(old_runs) + len(rows) <= MAX_ROWS and tasks + int(previous is None) <= MAX_TASKS,
                "history_store_limit")
        db.execute("INSERT OR REPLACE INTO task_heads VALUES(?,?,?,?,?)",
                   (project, task, watermark, prefixes[watermark], rows_hash))
        db.executemany("INSERT OR REPLACE INTO observations VALUES(?,?,?,?,?,?)", [
            (project, task, row["runId"], row["revision"], row["status"], json.dumps(row, sort_keys=True)) for row in rows
        ])
    if pending and action != "older_snapshot":
        db.execute("DELETE FROM sync_pending WHERE project=? AND task=?", (project, task))
    return {"schemaVersion": 1, "projectId": project, "taskId": task, "status": action,
            "sourceWatermark": watermark, "observedAttempts": len(rows)}


def _read_rows(rows, project):
    result = []
    for task, run, revision, status, data in rows:
        try:
            item = json.loads(data)
        except (TypeError, ValueError, RecursionError):
            raise UsageError("invalid_history_observation") from None
        fields = {"projectId", "taskId", "runId", "revision", "status", "originSessionId", "outcome", "runStatus", "source",
                  "acceptanceEventId", "completedEventId", "repository", "pullRequest", "requiredCheckCount",
                  "qualityReason", "evidenceId"}
        require(isinstance(item, dict) and set(item) == fields and item["projectId"] == project and item["taskId"] == task
                and item["runId"] == run and item["revision"] == revision and item["status"] == status
                and status in {"candidate", "rejected", "superseded", "active"} and item["source"] == SOURCE,
                "invalid_history_observation")
        session, repo, number = item["originSessionId"], item["repository"], item["pullRequest"]
        require(isinstance(task, str) and PROJECT.fullmatch(task) and type(run) is int and run > 0
                and (revision is None or isinstance(revision, str) and SHA.fullmatch(revision))
                and (session is None or isinstance(session, str) and SESSION.fullmatch(session))
                and (repo is None and number is None or type(number) is int and isinstance(repo, str)
                     and PR.fullmatch(f"https://github.com/{repo}/pull/{number}"))
                and (item["outcome"] is None or isinstance(item["outcome"], str) and item["outcome"] in OUTCOMES)
                and isinstance(item["runStatus"], str) and item["runStatus"] in RUN_STATES
                and type(item["requiredCheckCount"]) is int and 0 <= item["requiredCheckCount"] <= 128
                and all(item[k] is None or type(item[k]) is int and item[k] > 0 for k in ("acceptanceEventId", "completedEventId")),
                "invalid_history_observation")
        reason = {"active": "terminal_checks_passed", "superseded": "task_or_attempt_superseded",
                  "candidate": "no_independent_receipt", "rejected": "checks_or_terminal_chain_unverified"}[status]
        require(item["qualityReason"] == reason and item["evidenceId"] == "kanban_" + digest(
            [project, task, run, item["acceptanceEventId"], revision]), "invalid_history_observation")
        if status in {"active", "superseded"}:
            require(repo and revision and item["outcome"] == "completed" and item["runStatus"] == "done"
                    and item["requiredCheckCount"] and item["acceptanceEventId"] and item["completedEventId"]
                    and item["acceptanceEventId"] < item["completedEventId"], "invalid_history_observation")
        result.append(item)
    return result


def query(store, project, revision, task=None, limit=20, *, exporting=False):
    require(isinstance(project, str) and PROJECT.fullmatch(project) and isinstance(revision, str) and SHA.fullmatch(revision),
            "invalid_project_or_revision")
    require(task is None or isinstance(task, str) and PROJECT.fullmatch(task), "invalid_task")
    require(type(limit) is int and 1 <= limit <= (MAX_ROWS if exporting else 50), "invalid_limit")
    args = [project, revision]
    clause = ""
    if task is not None:
        clause = " AND task=?"
        args.append(task)
    with connect_store(store) as db:
        bound = db.execute("SELECT repository FROM project_sources WHERE project=?", (project,)).fetchone()
        repository = bound[0] if bound else None
        require(repository is None or isinstance(repository, str) and PR.fullmatch(
            f"https://github.com/{repository}/pull/1"), "invalid_history_observation")
        if db.execute("PRAGMA user_version").fetchone()[0] == 2:
            clause += (" AND NOT EXISTS(SELECT 1 FROM sync_pending AS p WHERE p.project=observations.project"
                       " AND p.task=observations.task)")
        found = db.execute("SELECT task,run,revision,status,data FROM observations WHERE project=? AND revision=? AND status='active'"
                           + clause + " ORDER BY task,run LIMIT ?", [*args, limit + 1]).fetchall()
    evidence = _read_rows(found[:limit], project)
    require(all(row["repository"].lower() == repository for row in evidence), "invalid_history_observation")
    return {"schemaVersion": 1, "projectId": project, "revision": revision, "repository": repository,
            "evidence": evidence, "truncated": len(found) > limit}


def inspect_task(store, project, task):
    require(isinstance(project, str) and PROJECT.fullmatch(project) and isinstance(task, str) and PROJECT.fullmatch(task),
            "invalid_project_or_task")
    with connect_store(store) as db:
        head = db.execute("SELECT watermark FROM task_heads WHERE project=? AND task=?", (project, task)).fetchone()
        pending = None
        if db.execute("PRAGMA user_version").fetchone()[0] == 2:
            pending = db.execute("SELECT watermark,reason FROM sync_pending WHERE project=? AND task=?", (project, task)).fetchone()
        if pending:
            require(type(pending[0]) is int and pending[0] >= 0 and pending[1] in PENDING_REASONS,
                    "invalid_history_observation")
        attempts = db.execute("SELECT task,run,revision,status,data FROM observations WHERE project=? AND task=? ORDER BY run", (project, task)).fetchall()
    return {"schemaVersion": 1, "projectId": project, "taskId": task, "sourceWatermark": head and head[0],
            "attempts": _read_rows(attempts, project),
            **({"syncPending": {"watermark": pending[0], "reason": pending[1]}} if pending else {})}


def correlate_session(store, project, revision, task, snapshot):
    result = query(store, project, revision, task)
    require(len(result["evidence"]) <= 1, "invalid_history_observation")
    row = next(iter(result["evidence"]), {})
    session = row.get("originSessionId")
    status = "active_outcome_missing" if not row else "origin_session_not_recorded"
    if session is not None:
        sample = report_usage(snapshot, session)["sessions"][0]
        status = "observed" if sample["status"] == "present" else "missing_from_session_snapshot"
    return {"schemaVersion": 1, "projectId": project, "revision": revision, "taskId": task, "runId": row.get("runId"),
            "evidenceId": row.get("evidenceId"), "originSessionId": session, "role": "task_origin",
            "source": "hermes.sessions", "status": status}
