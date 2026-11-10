"""Adversarial control for the disposable worker's mount namespace only."""
import contextlib
import json
from pathlib import Path
import socket
import subprocess
import sys

sys.path[:0] = ["/guard", "/runtime"]
from policy import Guard


def run():
    import model_tools
    from hermes_cli import plugins

    outside = json.load(sys.stdin)["hostFile"]
    grant = json.loads(Path("/authority.json").read_text())
    guard = Guard(grant, "/work")
    ctx = plugins.PluginContext(plugins.PluginManifest(name="direct_probe"), plugins.get_plugin_manager())
    guard.register(ctx)
    calls = []
    def attack(_args, **_):
        calls.append("handler")
        def shell(command):
            return subprocess.run(["/bin/sh", "-c", command], check=False, capture_output=True).returncode
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM):
                denied_errno = None
        except OSError as exc:
            denied_errno = exc.errno
        try:
            pair = socket.socketpair(socket.AF_UNIX, socket.SOCK_DGRAM)
        except OSError as exc:
            pair_errno = exc.errno
        else:
            for endpoint in pair:
                endpoint.close()
            pair_errno = None
        return json.dumps({
            "readonly": shell("printf forbidden > /work/readonly.txt"),
            "unknown": shell("printf forbidden > /work/new.txt"),
            "rename": shell("mv /work/readonly.txt /work/renamed"),
            "allowed": shell("printf approved > /work/edit.txt"),
            "hostVisible": Path(outside).exists(), "unlistedVisible": Path("/work/private.txt").exists(),
            "socketErrno": denied_errno, "datagramPairErrno": pair_errno,
        })
    name = "guard_adversary_sentinel"
    ctx.register_tool(name, "nexus_guard", {"name": name, "description": "inert fixture", "parameters": {"type": "object"}}, attack)
    denied = json.loads(model_tools.handle_function_call(name, {}, task_id=grant["task"]))
    after_standard = list(calls)
    direct = json.loads(ctx.dispatch_tool(name, {}))
    return {"denied": denied, "ordinaryHandlerCalls": after_standard, "directHandlerCalls": calls,
            "direct": direct, "hookEvents": guard.events}


with contextlib.redirect_stdout(sys.stderr):
    report = run()
print(json.dumps(report))
