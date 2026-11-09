"""Entered only inside the namespace. No model, gateway or arbitrary plugin is started."""
import contextlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

sys.path[:0] = ["/guard", "/runtime"]
from policy import Guard, READ, REPLACE


def execute(calls):
    import model_tools
    from agent.turn_context import _collect_pre_llm_call_context
    from hermes_cli import plugins

    manifest = json.loads(Path("/authority.json").read_text())
    authority = manifest["grant"]
    guard = Guard(authority, "/work", manifest["evidence"])
    ctx = plugins.PluginContext(plugins.PluginManifest(name="nexus_guard_worker"), plugins.get_plugin_manager())
    guard.register(ctx)
    # Use the real turn-context collector and require delivery before any dispatch.
    task = authority["task"]
    agent = SimpleNamespace(session_id="nexus-guard-offline", model="offline", platform="worker")
    text = _collect_pre_llm_call_context(agent, effective_task_id=task, turn_id="worker",
                                         original_user_message="", messages=[], conversation_history=[])
    if guard.context(task)["context"] != text:
        raise RuntimeError("context_not_delivered")
    results = []
    for call in calls:
        name, args = call["tool"], call["args"]
        if name not in (READ, REPLACE):
            guard.events.append({"phase": "worker_ingress", "tool": name, "decision": "deny",
                                 "reason": "tool_outside_worker_surface"})
            results.append({"error": "tool_outside_worker_surface"})
            continue
        before = len(guard.events)
        value = json.loads(model_tools.handle_function_call(name, args, task_id=task))
        phases = [event["phase"] for event in guard.events[before:] if event["tool"] == name]
        if phases != ["pre_tool", "post_tool"]:
            raise RuntimeError("hooks_not_delivered")
        results.append(value)
    return {"context": text, "decisions": guard.events, "results": results}


if __name__ == "__main__":
    calls = json.load(sys.stdin)
    with contextlib.redirect_stdout(sys.stderr):
        report = execute(calls)
    print(json.dumps(report, ensure_ascii=True))
