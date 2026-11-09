"""Corroborate selected hook events against one explicitly supplied native Kanban snapshot."""
from scripts.nexus_session_usage.snapshot import open_snapshot
from .events import ObserverError, identifier
from .ledger import entries, locked, read_record


def native_run(kanban, project, task, run):
    with open_snapshot(kanban) as db:
        for table, required in (("tasks", {"id", "project_id"}), ("task_runs", {"id", "task_id", "metadata"})):
            info = db.execute(f"PRAGMA main.table_list('{table}')").fetchone()
            columns = {row[1]: row for row in db.execute(f"PRAGMA main.table_xinfo('{table}')")}
            if (not info or info[:3] != ("main", table, "table") or not required <= columns.keys() or
                    any(columns[key][6] for key in required) or columns["id"][5] != 1):
                raise ObserverError("unsupported_kanban_schema")
        where = """FROM main.task_runs r JOIN main.tasks t ON t.id=r.task_id
                   WHERE r.id=? AND t.id=? COLLATE BINARY AND t.project_id=? COLLATE BINARY"""
        params = (run, task, project)
        if db.execute("SELECT 1 " + where, params).fetchone() is None:
            raise ObserverError("project_task_run_mismatch")
        # Native run metadata may include caller text. SQLite projects only the stamped worker session string.
        sql = """SELECT j.type, CASE WHEN j.type='text' AND length(j.value)<=128 THEN j.value END
                 FROM json_each((SELECT CASE WHEN typeof(r.metadata)='text' AND length(CAST(r.metadata AS BLOB))<=65536
                      AND json_valid(r.metadata) THEN r.metadata END """ + where + """)) j
                 WHERE j.key='worker_session_id' LIMIT 2"""
        rows = db.execute(sql, params).fetchall()
        if not rows:
            return None
        if len(rows) != 1 or rows[0][0] != "text" or not identifier(rows[0][1]):
            raise ObserverError("invalid_native_worker_session")
        return rows[0][1]


def query(directory, kanban, project, board, task, run):
    if not all(identifier(value) for value in (project, board, task)) or type(run) is not int or not 0 < run < 10**18:
        raise ObserverError("invalid_selector")
    worker_session = native_run(kanban, project, task, run)
    selected, conflicts = [], 0
    with locked(directory, write=False) as (fd, _verify):
        for name in entries(fd):
            row = read_record(fd, name)
            event = row["event"]
            if event["dispatch"] != {"board": board, "taskId": task, "runId": run}:
                continue
            if row["state"] == "conflict":
                conflicts += 1
                continue
            hook = event["hook"]
            selected.append({"eventId": name[:-5], "hook": hook, "usage": event["usage"],
                             "hookTaskMatchesDispatch": hook["taskId"] == task,
                             "nativeWorkerSession": "unobserved" if worker_session is None else
                             "matches" if worker_session == hook["sessionId"] else "differs"})
    return {"schemaVersion": 1, "source": "hermes.post_api_request", "projectId": project, "taskId": task,
            "runId": run, "boardSelector": board, "nativeTaskRun": "matched", "captureCompleteness": "unknown",
            "conflictingKeysForRecordedDispatch": conflicts, "matchedEvents": len(selected), "events": selected[:128],
            "truncated": len(selected) > 128}
