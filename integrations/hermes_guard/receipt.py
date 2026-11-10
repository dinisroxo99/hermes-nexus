"""Verify a child report against the request and the files observed by the launcher."""
import hashlib

from .policy import Guard, READ, REPLACE


def require(condition):
    if not condition:
        raise ValueError("invalid_worker_receipt")


def verify(report, calls, authority, context, baseline, view):
    require(isinstance(report, dict) and set(report) == {"context", "decisions", "results"})
    policy = Guard(authority, baseline, context)
    require(report["context"] == policy.context(authority["task"])["context"])
    events = report["decisions"]
    results = report["results"]
    require(isinstance(results, list) and len(results) == len(calls) and isinstance(events, list))
    expected = {p: hashlib.sha256((baseline / p).read_bytes()).hexdigest() for p in authority["read"]}
    position = 0
    for call, result in zip(calls, results):
        name, args = call["tool"], call["args"]
        require(isinstance(result, dict) and position < len(events))
        decision = events[position]
        position += 1
        reason = policy.reason(name, args)
        if name not in (READ, REPLACE):
            require(decision == {"tool": name, "phase": "worker_ingress", "decision": "deny", "reason": reason})
            require(result == {"error": reason})
            continue
        policy.pre_tool(name, args, task_id=authority["task"])
        require(decision == policy.events[-1] and position < len(events))
        status = "blocked" if reason else ("error" if "error" in result else "ok")
        require(events[position] == {"phase": "post_tool", "tool": name, "status": status})
        position += 1
        if reason:
            require(result == {"error": reason})
            continue
        path = args["path"]
        if name == READ:
            require(set(result) == {"path", "sha256", "text"} and result["path"] == path and isinstance(result["text"], str))
            require(hashlib.sha256(result["text"].encode()).hexdigest() == result["sha256"] == expected[path])
        elif args["beforeSha256"] != expected[path]:
            require(result == {"error": "content_changed"})
        else:
            digest = hashlib.sha256(args["text"].encode()).hexdigest()
            require(result == {"path": path, "sha256": digest})
            expected[path] = digest
    require(position == len(events))
    for path, digest in expected.items():
        output = view / path
        require(output.is_file() and not output.is_symlink() and output.stat().st_size <= 128 * 1024)
        require(hashlib.sha256(output.read_bytes()).hexdigest() == digest)
