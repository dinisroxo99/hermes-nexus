"""Disposable child. Only the registered sentinel can be requested by this experiment."""
import json
from pathlib import Path
import sys


TOOL = "nexus_guard_probe_sentinel"
BLOCK = "nexus_guard_probe_denied"


def experiment(context, dispatch):
    calls = []
    hooks = []

    def handler(args, **_):
        calls.append(args["mode"])
        return json.dumps({"sentinel": args["mode"]})

    def hook(tool_name, args, **_):
        if tool_name == TOOL:
            hooks.append(args["mode"])
            if args["mode"] == "deny":
                return {"action": "block", "message": BLOCK}
        return None

    schema = {"name": TOOL, "description": "Record an in-memory probe call.",
              "parameters": {"type": "object", "properties": {"mode": {"type": "string"}}}}
    context.register_tool(TOOL, "nexus_guard_probe", schema, handler)
    context.register_hook("pre_tool_call", hook)
    allow = json.loads(dispatch(TOOL, {"mode": "allow"}, task_id="nexus-guard-probe"))
    control = calls == ["allow"] and hooks == ["allow"] and allow == {"sentinel": "allow"}
    deny = json.loads(dispatch(TOOL, {"mode": "deny"}, task_id="nexus-guard-probe"))
    blocked = calls == ["allow"] and hooks == ["allow", "deny"] and deny.get("error") == BLOCK
    direct = "not_available"
    if callable(getattr(context, "dispatch_tool", None)):
        calls.clear()
        hooks.clear()
        direct = "inconclusive"
        try:
            response = json.loads(context.dispatch_tool(TOOL, {"mode": "deny"}))
        except Exception:
            pass
        else:
            if calls == ["deny"] and not hooks and response == {"sentinel": "deny"}:
                direct = "executed_without_hook"
            elif not calls and hooks == ["deny"] and isinstance(response, dict) and response.get("error") == BLOCK:
                direct = "blocked"
    return {
        "status": "veto_observed" if control and blocked else "veto_not_established",
        "control_delivered": control, "ordinary_dispatch_blocked": blocked, "direct_plugin_dispatch": direct,
    }


def run(checkout):
    def offline_worker(event, _args):
        if event.startswith(("socket.connect", "socket.getaddrinfo", "socket.sendto", "socket.sendmsg", "socket.bind",
                             "socket.gethostby", "socket.getnameinfo", "subprocess.", "os.posix_spawn", "os.exec",
                             "os.system", "os.fork")):
            raise PermissionError("offline_probe")

    sys.addaudithook(offline_worker)
    sys.path.insert(0, str(checkout))
    import model_tools
    from hermes_cli import plugins

    for module in (model_tools, plugins):
        if not Path(module.__file__).resolve().is_relative_to(checkout):
            raise ImportError("unexpected_module_origin")
    context = plugins.PluginContext(plugins.PluginManifest(name="nexus_guard_probe"), plugins.get_plugin_manager())
    return experiment(context, model_tools.handle_function_call)


if __name__ == "__main__":
    try:
        result = run(Path(sys.argv[1]))
    except Exception as exc:
        result = {"status": "unavailable", "reason": type(exc).__name__}
        if isinstance(exc, ModuleNotFoundError):
            result["missing_module"] = exc.name
    Path(sys.argv[2]).write_text(json.dumps(result), encoding="utf-8")
