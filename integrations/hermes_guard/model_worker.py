"""Isolated AIAgent acceptance fixture. Its two outbound capabilities are framed stdout messages."""
import base64
import contextlib
import json
from pathlib import Path
import sys
import threading

WIRE = sys.stdout.buffer
LOCK = threading.Lock()
CLOSING = threading.Event()
sys.path[:0] = ["/runtime"]


def exchange(message):
    encoded = json.dumps(message, separators=(",", ":")).encode() + b"\n"
    if len(encoded) > 512 * 1024:
        raise ValueError("oversize_message")
    with LOCK:
        if CLOSING.is_set():
            raise RuntimeError("loop_complete")
        WIRE.write(encoded)
        WIRE.flush()
        reply = sys.stdin.buffer.readline(1024 * 1024)
        if not reply.endswith(b"\n"):
            raise RuntimeError("invalid_reply")
        data = json.loads(reply)
        if "bridgeError" in data:
            raise RuntimeError(data["bridgeError"])
        return data


def run(job):
    import httpx

    def forward(_transport, request):
        if request.url.host != "127.0.0.1" or request.url.port != 8765:
            raise RuntimeError("unsupported_destination")
        response = exchange({"kind": "model", "path": request.url.path, "method": request.method,
                             "body": request.read().decode("utf-8")})
        stream = httpx.ByteStream(base64.b64decode(response["body"], validate=True))
        return httpx.Response(response["status"], headers={"content-type": response["contentType"]}, stream=stream)

    # Hermes retains its OpenAI client, provider selection, request shape, tool loop and response parsing.
    # Only the synchronous transport is replaced, to carry real completion bytes out of the offline namespace.
    httpx.HTTPTransport.handle_request = forward
    Path("/tmp/profile/config.yaml").write_text('{"tools":{"tool_search":{"enabled":"off"}}}')
    from hermes_cli.plugins import PluginContext, PluginManifest, discover_plugins, get_plugin_manager
    from hermes_state import SessionDB
    from run_agent import AIAgent

    discover_plugins()
    ctx = PluginContext(PluginManifest(name="guard_local_fixture"), get_plugin_manager())
    def edit(args, **_):
        return json.dumps(exchange({"kind": "edit", "args": args}))
    ctx.register_tool("edit_status_text", "guard_local_fixture", {
        "name": "edit_status_text", "description": "Replace one exact occurrence of text in the fixture's src/status.ts.",
        "parameters": {"type": "object", "properties": {
            "original": {"type": "string", "description": "A unique literal already present in the file"},
            "replacement": {"type": "string", "description": "The desired new text"}},
            "required": ["original", "replacement"], "additionalProperties": False}}, edit)
    ctx.register_hook("pre_tool_call", lambda tool_name, **_: None if tool_name == "edit_status_text" else
                      {"action": "block", "message": "tool_outside_fixture"})
    db = SessionDB(db_path=Path("/tmp/profile/model-session.sqlite"))
    agent = None
    try:
        agent = AIAgent(base_url="http://127.0.0.1:8765/v1", provider="custom", api_mode="chat_completions",
                        api_key="isolated-fixture", model=job["model"], cwd="/work", max_iterations=4, max_tokens=224,
                        enabled_toolsets=["guard_local_fixture"], request_overrides={"temperature": 0, "seed": 42},
                        skip_context_files=True, skip_memory=True, skip_background_review=True, quiet_mode=True,
                        session_id="guard-local-eval", session_db=db, fallback_model=None, run_budget_seconds=150)
        if agent.valid_tool_names != {"edit_status_text"}:
            raise RuntimeError("unexpected_agent_tools")
        response = agent.run_conversation(job["prompt"])
        return {"kind": "done", "error": bool(response.get("error") or response.get("interrupted")),
                "exitReason": response.get("turn_exit_reason"), "answer": str(response.get("final_response") or "")[:2048]}
    finally:
        if agent:
            agent.close()
        db.close()


if __name__ == "__main__":
    job = json.loads(sys.stdin.buffer.readline(8192))
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = run(job)
    except Exception as exc:
        result = {"kind": "failed", "error": type(exc).__name__, "detail": str(exc)[:240]}
    # Hermes may issue a final auxiliary completion from a background thread. Let any pending
    # request/reply finish before emitting the terminal frame or closing its input pipe.
    with LOCK:
        CLOSING.set()
        WIRE.write(json.dumps(result).encode() + b"\n")
        WIRE.flush()
