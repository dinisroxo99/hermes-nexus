"""Exercise the installed observer in a child spawned by the pinned native Kanban dispatcher."""
import argparse
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PIN = "903a57c540917cedd30c7d971938f1af7bdf60e2"
NEXUS = Path(__file__).resolve().parents[2]


class Provider(BaseHTTPRequestHandler):
    """Deterministic loopback provider; counts supplied by the fixture."""
    def log_message(self, *_):
        pass

    def reply(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply({"object": "list", "data": [{"id": "observer-fixture", "object": "model", "context_length": 65536}]})

    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        usage = {"prompt_tokens": 17, "completion_tokens": 3, "total_tokens": 20}
        with self.server.count_lock:
            first = self.server.responses == 0
            self.server.responses += 1
        message = {"role": "assistant", "content": "Done."}
        finish = "stop"
        if first:
            message = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_completion",
                       "type": "function", "function": {"name": "kanban_complete",
                       "arguments": json.dumps({"summary": "Completed controlled usage fixture."})}}]}
            finish = "tool_calls"
        base = {"id": "fixture", "model": "observer-fixture", "created": 1}
        if request.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            delta = {**message}
            if first:
                delta["tool_calls"] = [{**message["tool_calls"][0], "index": 0}]
            for choices, counters in [([{"index": 0, "delta": delta, "finish_reason": None}], None),
                                      ([{"index": 0, "delta": {}, "finish_reason": finish}], None), ([], usage)]:
                chunk = {**base, "object": "chat.completion.chunk", "choices": choices, "usage": counters}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
            self.wfile.write(b"data: [DONE]\n\n")
        else:
            self.reply({**base, "object": "chat.completion", "choices": [{"index": 0, "message": message,
                       "finish_reason": finish}], "usage": usage})



def worker(source, output, port):
    sys.path[:0] = [str(source), str(NEXUS)]
    sys.path.append(str(NEXUS / "scripts/benchmarks"))
    from paired_worker import restrict_network
    endpoint = f"http://127.0.0.1:{port}/v1"
    restrict_network(endpoint)
    from hermes_state import SessionDB
    from hermes_state_ids import new_session_id
    from run_agent import AIAgent

    # The dispatcher supplies the task/run/board, and Hermes supplies the session and per-turn/request IDs.
    sid = new_session_id()
    os.environ["HERMES_SESSION_ID"] = sid
    db = SessionDB(db_path=output / "sessions.db")
    agent = AIAgent(base_url=endpoint, provider="custom", api_mode="chat_completions",
                    model="observer-fixture", api_key="local-fixture", cwd=os.getcwd(), enabled_toolsets=["kanban"],
                    max_iterations=4, max_tokens=64, quiet_mode=True, skip_context_files=True,
                    skip_memory=True, skip_background_review=True, session_id=sid, session_db=db, fallback_model=None)
    try:
        result = agent.run_conversation("Complete the controlled task.")
        if result.get("error") or result.get("interrupted"):
            raise RuntimeError("fixture_turn_failed")
    finally:
        agent.close()
        db.close()



def proof(source, output):
    if subprocess.check_output(["git", "-C", source, "rev-parse", "HEAD"], text=True).strip() != PIN:
        raise ValueError("unexpected_hermes_source")
    output.mkdir(parents=False, exist_ok=False, mode=0o700)
    home = output / "home"
    capture = output / "capture"
    capture.mkdir(mode=0o700)
    home.mkdir()
    # All settings are disposable. Never read another user's home or API key.
    keep = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL") if key in os.environ}
    os.environ.clear()
    os.environ.update(keep, HOME=str(home), HERMES_HOME=str(home), PYTHONDONTWRITEBYTECODE="1",
                      NEXUS_USAGE_OBSERVER_DIR=str(capture), HF_HUB_OFFLINE="1", NO_COLOR="1")
    plugin = home / "plugins" / "nexus-usage-observer"
    shutil.copytree(NEXUS / "integrations/hermes_usage_observer", plugin, ignore=shutil.ignore_patterns("__pycache__"))
    (home / "config.yaml").write_text("plugins:\n  enabled: [nexus-usage-observer]\n")
    sys.path[:0] = [str(source), str(NEXUS)]
    from hermes_cli import kanban_db as kb, kanban_db_connect, kanban_db_dispatch, projects_db
    from integrations.hermes_usage_observer.query import query

    server = ThreadingHTTPServer(("127.0.0.1", 0), Provider)
    server.count_lock = threading.Lock()
    server.responses = 0
    threading.Thread(target=server.serve_forever, daemon=True).start()
    executable = output / "controlled-worker"
    args = [sys.executable, "-B", __file__, "--worker", "--hermes", str(source), "--output", str(output),
            "--port", str(server.server_port)]
    executable.write_text("#!/bin/sh\nexec " + shlex.join(args) + "\n")
    executable.chmod(0o700)
    os.environ["HERMES_BIN"] = str(executable)
    try:
        repo = output / "project"
        repo.mkdir()
        subprocess.run(["git", "init", "--quiet", "-b", "main", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                        "commit", "--quiet", "--allow-empty", "-m", "fixture"], check=True)
        with projects_db.connect_closing() as pc:
            project = projects_db.create_project(pc, name="Observer fixture", primary_path=str(repo))
        with kanban_db_connect.connect_closing(board="default") as conn:
            task = kb.create_task(conn, title="Observer fixture", assignee="default", workspace_kind="scratch", project_id=project)
            dispatch = kanban_db_dispatch.dispatch_once(conn, max_spawn=1, board="default", reconcile_orphans=False)
            if not dispatch.spawned or dispatch.spawned[0][0] != task:
                raise RuntimeError("native_dispatch_failed: " + str(dispatch))
            run = conn.execute("SELECT id FROM task_runs WHERE task_id=?", (task,)).fetchone()[0]
            until = time.monotonic() + 90
            while time.monotonic() < until:
                row = conn.execute("SELECT status,worker_pid FROM task_runs WHERE id=?", (run,)).fetchone()
                if row[1] and os.waitpid(row[1], os.WNOHANG)[0]:
                    if row[0] != "done" or len(list(capture.glob("*.json"))) != 2:
                        raise RuntimeError("controlled_worker_failed")
                    break
                time.sleep(.25)
            else:
                raise RuntimeError("fixture_worker_timeout")
            with sqlite3.connect(output / "board.db") as backup:
                conn.backup(backup)
        report = query(capture, output / "board.db", project, "default", task, run)
        assert report["matchedEvents"] == 2 and not report["conflictingKeysForRecordedDispatch"], report
        assert all(row["nativeWorkerSession"] == "matches" for row in report["events"]), report
        assert not any(row["hookTaskMatchesDispatch"] for row in report["events"]), report
        assert all(row["usage"]["prompt_tokens"] == 17 and row["usage"]["output_tokens"] == 3 for row in report["events"])
        from scripts.nexus_session_usage.report import report_usage
        sid = report["events"][0]["hook"]["sessionId"]
        counters = report_usage(output / "sessions.db", sid)["sessions"][0]["counters"]
        assert counters["input_tokens"] == 34 and counters["output_tokens"] == 6 and counters["api_call_count"] == 2
        (output / "report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"events": report["matchedEvents"], "nativeRun": run, "workerSessionsMatched": 2,
                          "matchedHookTask": 0, "differentHookTask": 2, "provider": "controlled_loopback_fixture"}))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--port", type=int)
    a = parser.parse_args()
    if a.worker:
        worker(a.hermes.resolve(), a.output.resolve(), a.port)
    else:
        proof(a.hermes.resolve(), a.output.resolve())
