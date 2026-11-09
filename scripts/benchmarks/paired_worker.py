"""One Hermes session in a fresh home. Its parent supplies an allowlisted process environment."""
import json
from pathlib import Path
import sys
import time
from urllib.parse import urlsplit

from paired_cases import FILES

REPO = Path(__file__).resolve().parents[2]


def restrict_network(endpoint):
    url = urlsplit(endpoint)
    if url.scheme != "http" or url.hostname != "127.0.0.1" or not url.port or url.path != "/v1" or url.username:
        raise ValueError("numeric_loopback_endpoint_required")

    def audit(event, args):
        if event == "socket.connect":
            address = args[1]
            if not isinstance(address, tuple) or address[:2] != ("127.0.0.1", url.port):
                raise PermissionError("benchmark_remote_network_disabled")
        if event == "socket.getaddrinfo" and (args[0] != "127.0.0.1" or int(args[1]) != url.port):
            raise PermissionError("benchmark_remote_network_disabled")
    sys.addaudithook(audit)


def run(job):
    restrict_network(job["endpoint"])
    sys.path.insert(0, job["hermes"])
    sys.path.insert(0, str(REPO))
    from hermes_cli.plugins import PluginContext, PluginManifest, discover_plugins, get_plugin_manager
    from hermes_state import SessionDB
    from run_agent import AIAgent
    from scripts.nexus_session_usage.report import report_usage

    home = Path(job["home"])
    work = Path(job["work"])
    sid = job["sessionId"]
    reads = []

    def read_fixture(args, **_):
        name = args.get("path")
        allowed = isinstance(name, str) and name in FILES
        reads.append(name if allowed else None)
        return json.dumps({"text": (work / name).read_text()} if allowed else {"error": "unknown_fixture_file"})

    discover_plugins()
    ctx = PluginContext(PluginManifest(name="nexus_benchmark"), get_plugin_manager())
    ctx.register_tool("read_benchmark_file", "nexus_benchmark", {
        "name": "read_benchmark_file", "description": "Read a repository fixture file by its exact listed path.",
        "parameters": {"type": "object", "required": ["path"], "properties": {"path": {"type": "string"}}}
    }, read_fixture)
    db_path = home / "benchmark.sqlite"
    db = SessionDB(db_path=db_path)
    agent = None
    start = time.monotonic()
    result = {"execution": "unavailable", "error": None, "answer": None}
    try:
        agent = AIAgent(base_url=job["endpoint"], provider="custom", api_mode="chat_completions",
                        api_key="benchmark-loopback", model=job["model"], cwd=str(work),
                        enabled_toolsets=["nexus_benchmark"], max_iterations=4, max_tokens=160,
                        request_overrides={"temperature": 0, "seed": 42}, quiet_mode=True,
                        skip_context_files=True, skip_memory=True, skip_background_review=True,
                        session_id=sid, session_db=db, fallback_model=None,
                        ephemeral_system_prompt=job.get("evidence"), run_budget_seconds=110)
        if agent.valid_tool_names != {"read_benchmark_file"}:
            raise RuntimeError("unexpected_tools:" + ",".join(sorted(agent.valid_tool_names)))
        reply = agent.run_conversation(job["prompt"])
        result["answer"] = reply.get("final_response")
        result["turnExitReason"] = reply.get("turn_exit_reason")
        result["turnApiCalls"] = reply.get("api_calls")
        result["execution"] = "agent_error" if reply.get("error") or reply.get("interrupted") else "completed"
        if reply.get("error"):
            result["error"] = str(reply["error"])[:360]
    except Exception as error:
        result["error"] = type(error).__name__ + ": " + str(error)[:300]
    finally:
        result["seconds"] = round(time.monotonic() - start, 3)
        if agent:
            agent.close()
        db.close()
    sample = report_usage(db_path, sid)["sessions"][0]
    result.update({"usage": sample, "fixtureReadCalls": len(reads), "filesRead": sorted({name for name in reads if name})})
    return result


if __name__ == "__main__":
    job = json.loads(Path(sys.argv[1]).read_text())
    output = run(job)
    Path(job["result"]).write_text(json.dumps(output, ensure_ascii=True))
