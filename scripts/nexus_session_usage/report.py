"""Selected-session counters from the Hermes sessions table. No chat or model-call payloads."""
import re
import sqlite3

from .snapshot import UsageError, open_snapshot


COUNTERS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens", "api_call_count")
SESSION_ID = re.compile(r"[A-Za-z0-9._:-]{1,128}\Z")


def _check_schema(db):
    # Only use a real table and stored columns. A malicious view or generated expression must never run.
    table = db.execute("PRAGMA main.table_list('sessions')").fetchone()
    if table is None or table[:3] != ("main", "sessions", "table"):
        raise UsageError("unsupported_sessions_schema")
    columns = {row[1]: row for row in db.execute("PRAGMA main.table_xinfo('sessions')")}
    if any(key not in columns or columns[key][6] != 0 for key in (*COUNTERS, "id")):
        raise UsageError("unsupported_sessions_schema")
    if columns["id"][2].upper() != "TEXT" or columns["id"][5] != 1 or sum(row[5] > 0 for row in columns.values()) != 1:
        raise UsageError("unsupported_sessions_schema")
    if any(columns[key][2].upper() != "INTEGER" for key in COUNTERS):
        raise UsageError("unsupported_sessions_schema")


def _sample(db, session_id):
    fields = ", ".join(COUNTERS)
    rows = db.execute(f"SELECT {fields} FROM main.sessions WHERE id = ? COLLATE BINARY LIMIT 2", (session_id,)).fetchall()
    if not rows:
        return {"sessionId": session_id, "status": "missing", "counters": None}
    if len(rows) != 1:
        raise UsageError("ambiguous_session")
    values = dict(zip(COUNTERS, rows[0]))
    if any(v is not None and (type(v) is not int or v < 0) for v in values.values()):
        raise UsageError("invalid_session_counters")
    return {"sessionId": session_id, "status": "present", "counters": values,
            "positiveTokenCountObserved": any((values[name] or 0) > 0 for name in COUNTERS[:-1])}


def report_usage(path, session, compare_session=None):
    ids = [session] if compare_session is None else [session, compare_session]
    if any(not isinstance(sid, str) or not SESSION_ID.fullmatch(sid) for sid in ids):
        raise UsageError("invalid_session_id")
    if len(set(ids)) != len(ids):
        raise UsageError("distinct_sessions_required")
    with open_snapshot(path) as db:
        _check_schema(db)
        def allow_counter_reads(action, table, column, database, origin):
            permitted = action == sqlite3.SQLITE_SELECT or (
                action == sqlite3.SQLITE_READ and database == "main" and table == "sessions"
                and column in (*COUNTERS, "id") and origin is None
            )
            return sqlite3.SQLITE_OK if permitted else sqlite3.SQLITE_DENY

        db.set_authorizer(allow_counter_reads)
        samples = [_sample(db, sid) for sid in ids]
    result = {"schemaVersion": 1, "source": "hermes.sessions", "projectRevisionBinding": "not_established",
              "sessions": samples}
    if compare_session is not None:
        a, b = (sample["counters"] for sample in samples)
        observed = all(row.get("positiveTokenCountObserved") for row in samples)
        delta = None if not observed else {
            name: b[name] - a[name] if b[name] is not None and a[name] is not None else None for name in COUNTERS
        }
        result["comparison"] = {"status": "descriptive_only" if delta is not None else "unavailable",
                                "secondMinusFirst": delta}
    return result
