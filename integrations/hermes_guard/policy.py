"""Explicit grants for two bounded text tools. The handlers also check their grant."""
import hashlib
import json
from pathlib import Path

READ = "nexus_guard_read"
REPLACE = "nexus_guard_replace"
MAX_FILE = 128 * 1024


class Guard:
    def __init__(self, authority, workspace, evidence=None):
        self.authority = authority
        self.workspace = Path(workspace)
        self.evidence = evidence
        self.events = []

    def reason(self, tool, args):
        if tool not in (READ, REPLACE):
            return "tool_outside_worker_surface"
        fields = {"path"} if tool == READ else {"path", "beforeSha256", "text"}
        if not isinstance(args, dict) or set(args) != fields or not all(isinstance(v, str) for v in args.values()):
            return "invalid_arguments"
        files = self.authority["read"] if tool == READ else self.authority["write"]
        if args["path"] not in files:
            return "path_outside_grant"
        if tool == REPLACE:
            try:
                text = args["text"].encode("utf-8")
            except UnicodeError:
                return "invalid_text"
            if len(text) > MAX_FILE or b"\0" in text:
                return "invalid_text"
        return None

    def pre_tool(self, tool_name, args, task_id="", **_):
        reason = ("task_mismatch" if task_id != self.authority["task"] else self.reason(tool_name, args))
        event = {"tool": tool_name, "phase": "pre_tool", "decision": "deny" if reason else "allow",
                 "reason": reason or "explicit_grant"}
        if isinstance(args, dict) and args.get("path") in self.authority["read"]:
            event["path"] = args["path"]
        self.events.append(event)
        if reason:
            return {"action": "block", "message": reason}
        return None

    def post_tool(self, tool_name, task_id="", status="", **_):
        if task_id == self.authority["task"] and tool_name in (READ, REPLACE):
            self.events.append({"phase": "post_tool", "tool": tool_name, "status": status})

    def context(self, task_id="", **_):
        if task_id != self.authority["task"]:
            return None
        text = "Nexus worker authority " + json.dumps(self.authority, sort_keys=True)
        if self.evidence is not None:
            text += "\nNexus project evidence " + json.dumps(self.evidence, sort_keys=True)
        return {"context": text}

    def handle(self, tool, args):
        reason = self.reason(tool, args)
        if reason:
            return json.dumps({"error": reason})
        path = self.workspace / args["path"]
        with path.open("rb" if tool == READ else "r+b") as stream:
            content = stream.read(MAX_FILE + 1)
            if len(content) > MAX_FILE:
                return json.dumps({"error": "file_budget"})
            digest = hashlib.sha256(content).hexdigest()
            if tool == READ:
                return json.dumps({"path": args["path"], "sha256": digest, "text": content.decode("utf-8")})
            if args["beforeSha256"] != digest:
                return json.dumps({"error": "content_changed"})
            new = args["text"].encode("utf-8")
            stream.seek(0)
            stream.write(new)
            stream.truncate()
            return json.dumps({"path": args["path"], "sha256": hashlib.sha256(new).hexdigest()})

    def register(self, ctx):
        for name in (READ, REPLACE):
            keys = ["path"] if name == READ else ["path", "beforeSha256", "text"]
            schema = {"name": name, "description": "Access a granted file in this disposable worker.",
                      "parameters": {"type": "object", "properties": {k: {"type": "string"} for k in keys},
                                     "required": keys, "additionalProperties": False}}
            def handler(args, *, _tool=name, **kwargs):
                return self.handle(_tool, args)
            ctx.register_tool(name, "nexus_guard", schema, handler)
        ctx.register_hook("pre_llm_call", self.context)
        ctx.register_hook("pre_tool_call", self.pre_tool)
        ctx.register_hook("post_tool_call", self.post_tool)
