"""Pure minimization of fields exposed by the native Hermes post_api_request hook."""
import hashlib
import json
import re


COUNTERS = ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "reasoning_tokens",
            "request_count", "prompt_tokens", "total_tokens")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]*\Z")


class ObserverError(Exception):
    """Safe bounded reason, with no source values."""


def identifier(value, limit=128):
    return isinstance(value, str) and 0 < len(value) <= limit and IDENTIFIER.fullmatch(value) is not None


def observe(env, *, task_id=None, turn_id=None, api_request_id=None, session_id=None, usage=None, **_ignored):
    if not env.get("HERMES_KANBAN_TASK") and not env.get("HERMES_KANBAN_RUN_ID"):
        return None
    board, task, run = (env.get(key) for key in ("HERMES_KANBAN_BOARD", "HERMES_KANBAN_TASK", "HERMES_KANBAN_RUN_ID"))
    if not (identifier(board) and identifier(task) and isinstance(run, str) and re.fullmatch(r"[1-9][0-9]{0,17}", run)):
        raise ObserverError("invalid_dispatch_context")
    if not (identifier(task_id) and identifier(session_id) and identifier(turn_id, 320) and identifier(api_request_id, 380)):
        raise ObserverError("invalid_hook_identity")
    counters = None
    if usage is not None:
        if type(usage) is not dict:
            raise ObserverError("invalid_usage")
        counters = {key: usage.get(key) for key in COUNTERS}
        if any(value is not None and (type(value) is not int or not 0 <= value <= 2**53 - 1) for value in counters.values()):
            raise ObserverError("invalid_usage")
    return {"dispatch": {"board": board, "taskId": task, "runId": int(run)},
            "hook": {"taskId": task_id, "sessionId": session_id, "turnId": turn_id, "apiRequestId": api_request_id},
            "usage": counters}


def event_key(event):
    hook = event["hook"]
    identity = [hook["sessionId"], hook["turnId"], hook["apiRequestId"]]
    return hashlib.sha256(json.dumps(identity, separators=(",", ":")).encode()).hexdigest()


def verified_event(record, key):
    try:
        event = record["event"]
        dispatch, hook = event["dispatch"], event["hook"]
        native = observe({"HERMES_KANBAN_BOARD": dispatch["board"], "HERMES_KANBAN_TASK": dispatch["taskId"],
                          "HERMES_KANBAN_RUN_ID": str(dispatch["runId"])}, task_id=hook["taskId"], session_id=hook["sessionId"],
                         turn_id=hook["turnId"], api_request_id=hook["apiRequestId"], usage=event["usage"])
        if (type(dispatch["runId"]) is not int or native != event or event_key(native) != key or
                record.keys() != {"version", "state", "event"} or type(record["version"]) is not int
                or record["version"] != 1 or record["state"] not in ("observed", "conflict")):
            raise ObserverError("invalid_event_store")
        return native
    except (KeyError, TypeError, AttributeError, ValueError, RecursionError):
        raise ObserverError("invalid_event_store") from None
