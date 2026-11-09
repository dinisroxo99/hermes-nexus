"""Synchronize one project's minimized acceptance history from an explicitly published standalone image."""
import hashlib
from collections import defaultdict
import re

from scripts.nexus_session_usage.snapshot import UsageError, open_snapshot_data, snapshot_bytes
from .source import MAX_EVENTS, MAX_RUNS, PROJECT, observe_rows, require, validate_schema
from .store import MAX_ROWS, MAX_TASKS, PENDING_REASONS, connect_store, ingest_task

MAX_PROJECT_EVENTS = 65536
MAX_REPORTED_ERRORS = 32


def _project_rows(source, project):
    # The joins constrain all returned rows to the caller-selected project. Nothing selects prompts or run summaries.
    tasks = dict()
    rows = source.execute("SELECT id,project_id,status,session_id,completion_contract FROM tasks"
                          " WHERE project_id=? COLLATE BINARY ORDER BY id COLLATE BINARY LIMIT ?", (project, MAX_TASKS + 1))
    for task, *row in rows:
        require(isinstance(task, str) and PROJECT.fullmatch(task), "invalid_project_task_id")
        tasks[task] = row
    require(len(tasks) <= MAX_TASKS, "project_sync_limit")
    runs, events = defaultdict(list), defaultdict(list)
    for records, limit, per_task, sql in [
        (runs, MAX_ROWS, MAX_RUNS, "SELECT r.task_id,r.id,r.status,r.outcome,r.started_at,r.ended_at FROM task_runs r"),
        (events, MAX_PROJECT_EVENTS, MAX_EVENTS,
         "SELECT r.task_id,r.id,r.run_id,r.kind,r.created_at,CASE WHEN r.kind IN ('created','pr_acceptance')"
         " AND length(r.payload)<=65536 THEN r.payload END FROM task_events r"),
    ]:
        selected = source.execute(sql + " JOIN tasks t ON t.id=r.task_id COLLATE BINARY"
                                   " WHERE t.project_id=? COLLATE BINARY ORDER BY r.id LIMIT ?", (project, limit + 1))
        for index, (task, *row) in enumerate(selected):
            require(index < limit, "project_sync_limit")
            # One overflow row lets the existing validator reject this task without suppressing other tasks.
            if len(records[task]) <= per_task:
                records[task].append(row)
    return tasks, runs, events


def _watermarks(db, project):
    result = {}
    for task, mark in db.execute("SELECT task,watermark FROM task_heads WHERE project=? UNION ALL "
                                 "SELECT task,watermark FROM sync_pending WHERE project=?", (project, project)):
        require(isinstance(task, str) and PROJECT.fullmatch(task) and type(mark) is int and mark >= 0,
                "invalid_history_observation")
        result[task] = max(result.get(task, 0), mark)
    return result


def _pending(db, project, task, mark, code):
    db.execute("""INSERT INTO sync_pending VALUES(?,?,?,?) ON CONFLICT(project,task) DO UPDATE
                  SET watermark=excluded.watermark,reason=excluded.reason
                  WHERE excluded.watermark>=sync_pending.watermark
                    AND (excluded.watermark!=sync_pending.watermark OR excluded.reason!=sync_pending.reason)""",
               (project, task, mark, code))


def sync_snapshot(snapshot, store, project):
    require(isinstance(project, str) and PROJECT.fullmatch(project), "invalid_project")
    data = snapshot_bytes(snapshot)
    fingerprint = hashlib.sha256(data).hexdigest()
    with connect_store(store, write=True) as db:
        head = db.execute("SELECT watermark,publication FROM sync_projects WHERE project=?", (project,)).fetchone()
        if head:
            require(type(head[0]) is int and head[0] >= 0 and isinstance(head[1], str)
                    and (head[1] == "" or re.fullmatch("[0-9a-f]{64}", head[1])), "invalid_history_observation")
        watermark = head[0] if head else 0
        report = {"schemaVersion": 1, "projectId": project, "checkpoint": watermark, "imported": 0, "unchanged": 0,
                  "failed": 0, "errors": []}
        if head and head[1] == fingerprint:
            return {**report, "status": "unchanged_publication"}
        with open_snapshot_data(data, instruction_budget=10_000_000) as source:
            validate_schema(source)
            tasks, runs, events = _project_rows(source, project)
            # Even if a malformed task overflows its per-task cap, retain its real high-water for retry.
            latest = dict(source.execute("SELECT t.id,MAX(e.id) FROM tasks t LEFT JOIN task_events e"
                                         " ON e.task_id=t.id COLLATE BINARY WHERE t.project_id=? COLLATE BINARY"
                                         " GROUP BY t.id", (project,)))
        known = _watermarks(db, project)
        admitted = {r[0] for r in db.execute("SELECT task FROM task_heads WHERE project=?", (project,))}
        source_mark = max((mark or 0 for mark in latest.values()), default=0)
        floor = max([watermark, *known.values()])
        if source_mark < floor:
            return {**report, "status": "older_snapshot"}
        if not tasks and not known:
            return {**report, "status": "no_project_tasks"}

        # Reserve capacity before ingesting even invalid cards; a publication cannot fill an unbounded retry queue.
        elsewhere = db.execute("SELECT COUNT(*) FROM (SELECT project,task FROM task_heads WHERE project!=? UNION"
                               " SELECT project,task FROM sync_pending WHERE project!=?)", (project, project)).fetchone()[0]
        require(elsewhere + len(set(known) | tasks.keys()) <= MAX_TASKS, "history_store_limit")
        for task in sorted(set(known) | tasks.keys()):
            mark = latest.get(task) or 0
            db.execute("SAVEPOINT one_task")
            try:
                require(task in tasks, "previous_task_missing")
                require(mark >= known.get(task, 0), "older_task_snapshot")
                observation = observe_rows(project, task, tasks[task], runs[task], events[task])
                require(task in admitted or min(observation["prefixes"]) > watermark, "unexpected_historical_task")
                action = ingest_task(db, observation)["status"]
                require(action != "older_snapshot", "older_task_snapshot")
                report["imported" if action == "imported" else "unchanged"] += 1
            except UsageError as error:
                db.execute("ROLLBACK TO one_task")
                code = str(error)
                # Never quarantine previously valid evidence on the basis of a strictly older per-task view.
                if code not in PENDING_REASONS and code != "older_task_snapshot":
                    raise
                if code in PENDING_REASONS:
                    _pending(db, project, task, max(mark, known.get(task, 0)), code)
                report["failed"] += 1
                if len(report["errors"]) < MAX_REPORTED_ERRORS:
                    report["errors"].append({"taskId": task, "error": code})
            finally:
                db.execute("RELEASE one_task")
        if report["failed"]:
            db.execute("UPDATE sync_projects SET publication='' WHERE project=? AND publication!=''", (project,))
            return {**report, "status": "partial"}
        db.execute("INSERT OR REPLACE INTO sync_projects VALUES(?,?,?)", (project, source_mark, fingerprint))
        return {**report, "status": "synchronized", "checkpoint": source_mark}
