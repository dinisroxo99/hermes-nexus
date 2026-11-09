"""Run the fixed, local-model edit experiment. The real project-aware worker produces proposals."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib import request

from .inputs import git
from .runtime_source import prepare_runtime
from .sandbox import command, network_filter

NEXUS = Path(__file__).resolve().parents[2]
FILE = "src/status.ts"
ORIGINAL = 'export const status = "draft";\n'
EXPECTED = 'export const status = "ready";\n'
PROMPT = ('The file src/status.ts currently contains: export const status = "draft";\n'
          'Change the project status from draft to ready using edit_status_text. Preserve the surrounding TypeScript.')
MAX = 512 * 1024


def fixture(root):
    repo = root / "main"
    repo.mkdir()
    (repo / "src").mkdir()
    (repo / FILE).write_text(ORIGINAL)
    (repo / "package.json").write_text('{"name":"fixture","type":"module"}\n')
    git(repo, "init", "-q", "--template=")
    git(repo, "add", ".")
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                    "commit", "-qm", "Initial status"], env={"PATH": os.defpath, "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z",
                    "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z"}, timeout=15, check=True)
    git(repo, "worktree", "add", "--detach", str(root / "linked"), "HEAD")
    (root / "projects.json").write_text(json.dumps([{"name": "fixture", "projectId": "PrJ_GuardModel",
                                                     "rootId": "test", "relativePath": "main"}]))
    return git(repo, "rev-parse", "HEAD").decode().strip()


def propose(root, hermes, revision, args):
    if not isinstance(args, dict) or set(args) != {"original", "replacement"} or not all(
            isinstance(v, str) and 0 < len(v) <= 128 and "\0" not in v for v in args.values()):
        return {"error": "invalid_edit_arguments"}, None
    if ORIGINAL.count(args["original"]) != 1:
        return {"error": "original_not_unique"}, None
    text = ORIGINAL.replace(args["original"], args["replacement"], 1)
    body = {"task": {"id": "status-task", "title": "Update the release status", "paths": [FILE], "symbols": []},
            "calls": [{"tool": "nexus_guard_replace", "args": {"path": FILE, "text": text,
                      "beforeSha256": hashlib.sha256(ORIGINAL.encode()).hexdigest()}}]}
    result = subprocess.run([shutil.which("node"), str(NEXUS / "scripts/guarded-project-task.mjs"),
                             "--project-id", "PrJ_GuardModel", "--root-id", "test", "--worktree", "linked",
                             "--task-id", "status-task", "--revision", revision, "--write", FILE,
                             "--hermes-checkout", str(hermes), "--python", sys.executable],
                            cwd=NEXUS, env={"PATH": os.environ["PATH"], "DATA_DIR": str(root),
                            "PROJECTS_ROOTS": json.dumps([{"id": "test", "path": str(root)}])},
                            input=json.dumps(body).encode(), capture_output=True, timeout=90)
    if result.returncode:
        return {"error": "worker_rejected"}, None
    report = json.loads(result.stdout)
    return {"result": "patch_proposed"}, report


def completion(endpoint, model, message):
    path, method = message["path"], message["method"]
    if not ((path == "/v1/chat/completions" and method == "POST")
            or (path in {"/v1/models", "/props"} and method == "GET")):
        return {"bridgeError": "unsupported_model_api"}
    data = message["body"].encode() if method == "POST" else None
    if data and (len(data) > MAX or json.loads(data).get("model") != model):
        return {"bridgeError": "invalid_model_request"}
    url = endpoint.removesuffix("/v1") + path
    class LocalOnly(request.HTTPRedirectHandler):
        def redirect_request(self, *args):
            raise ValueError("unexpected_model_redirect")
    opener = request.build_opener(request.ProxyHandler({}), LocalOnly())
    with opener.open(request.Request(url, data=data, headers={"Content-Type": "application/json"}), timeout=90) as result:
        body = result.read(MAX + 1)
        if len(body) > MAX:
            raise ValueError("model_response_budget")
        return {"status": result.status, "contentType": result.headers.get("Content-Type", ""),
                "body": base64.b64encode(body).decode()}


def model_calls(wire):
    """Recover native tool calls from the actual local server response, including streamed arguments."""
    if "body" not in wire:
        return []
    body = base64.b64decode(wire["body"], validate=True).decode()
    if "event-stream" in wire["contentType"]:
        frames = [json.loads(line[5:].strip()) for line in body.splitlines()
                  if line.startswith("data:") and line[5:].strip() != "[DONE]"]
    else:
        frames = [json.loads(body)]
    pieces = {}
    for frame in frames:
        for choice in frame.get("choices", []):
            output = choice.get("delta") or choice.get("message") or {}
            for i, tool in enumerate(output.get("tool_calls") or []):
                key = (choice.get("index", 0), tool.get("index", i))
                entry = pieces.setdefault(key, ["", ""])
                function = tool.get("function") or {}
                entry[0] += function.get("name") or ""
                entry[1] += function.get("arguments") or ""
    selected = []
    for name, arguments in pieces.values():
        if name == "edit_status_text":
            try:
                selected.append(json.loads(arguments))
            except (ValueError, TypeError):
                pass
    return selected


def run(args):
    # Reuse the paired harness's pinned local-server startup and cleanup.
    sys.path.insert(0, str(NEXUS / "scripts/benchmarks"))
    from paired_hermes import local_server
    with tempfile.TemporaryDirectory(prefix="nexus-model-guard-") as tmp:
        root = Path(tmp)
        revision = fixture(root)
        runtime = root / "runtime"
        runtime.mkdir()
        pin = prepare_runtime(args.hermes, runtime, agent=True)
        view = root / "empty"
        view.mkdir()
        manifest = root / "manifest"
        manifest.write_text("{}")
        proposals = []
        attempted = []
        selected = []
        pending = []
        requests = 0
        completions = 0
        end = {"kind": "failed", "error": "missing_final"}
        with local_server(args, root) as (endpoint, version), tempfile.TemporaryFile() as fd:
            network_filter(fd)
            cmd = command(runtime, view, manifest, [], "/guard/model_worker.py", fd)
            ca = Path("/etc/ssl/certs/ca-certificates.crt")
            if ca.is_file():
                pos = cmd.index("--remount-ro")
                cmd[pos:pos] = ["--ro-bind", str(ca), str(ca)]
            with subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  pass_fds=(fd.fileno(),), bufsize=0) as child:
                def reply(obj):
                    child.stdin.write(json.dumps(obj).encode() + b"\n")
                    child.stdin.flush()
                watchdog = threading.Timer(240, child.kill)
                watchdog.start()
                try:
                    reply({"model": args.model, "prompt": PROMPT})
                    deadline = time.monotonic() + 240
                    for _ in range(32):
                        if not select.select([child.stdout], [], [], max(0, deadline - time.monotonic()))[0]:
                            raise TimeoutError("agent_timeout")
                        line = child.stdout.readline(MAX + 1)
                        if len(line) > MAX or not line.endswith(b"\n"):
                            raise ValueError("invalid_agent_frame")
                        message = json.loads(line)
                        if message["kind"] == "model":
                            requests += 1
                            if message["path"] == "/v1/chat/completions":
                                completions += 1
                            wire = completion(endpoint, args.model, message)
                            found = model_calls(wire)
                            selected.extend(found)
                            pending.extend(found)
                            reply(wire)
                        elif message["kind"] == "edit":
                            attempted.append(message["args"])
                            if message["args"] not in pending:
                                reply({"error": "no_matching_provider_tool_call"})
                                continue
                            pending.remove(message["args"])
                            if proposals:
                                reply({"error": "proposal_already_received"})
                                continue
                            response, proposal = propose(root, args.hermes, revision, message["args"])
                            if proposal:
                                proposals.append(proposal)
                            reply(response)
                        elif message["kind"] in {"done", "failed"}:
                            end = message
                            break
                        else:
                            raise ValueError("unknown_agent_frame")
                finally:
                    watchdog.cancel()
                    if end["kind"] in ("done", "failed") and end.get("error") != "missing_final":
                        child.stdin.close()
                        try:
                            child.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            child.kill()
                    else:
                        child.kill()
        oracle = False
        if proposals:
            # Apply in an independent temporary checkout; compare exact code and the complete file set.
            candidate = root / "oracle"
            git(root / "main", "worktree", "add", "--detach", str(candidate), revision)
            patch = proposals[-1]["patch"].encode()
            if patch:
                git(candidate, "apply", "-", input_data=patch)
                oracle = ((candidate / FILE).read_text() == EXPECTED
                          and git(candidate, "diff", "--name-only").decode().splitlines() == [FILE])
        clean = not git(root / "linked", "status", "--porcelain") and not git(root / "main", "status", "--porcelain")
        with args.gguf.open("rb") as model_file, args.llama_server.open("rb") as engine_file:
            model_sha = hashlib.file_digest(model_file, "sha256").hexdigest()
            engine_sha = hashlib.file_digest(engine_file, "sha256").hexdigest()
        return {"agent": end, "model": args.model, "ggufSha256": model_sha, "engineSha256": engine_sha,
                "engine": version, "hermesRevision": pin, "revision": revision, "modelRequests": requests, "completionRequests": completions,
                "modelSelectedEdits": selected, "attemptedEdits": attempted, "proposals": len(proposals), "patch": proposals[-1]["patch"] if proposals else "",
                "oraclePassed": oracle, "checkoutClean": clean}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, required=True)
    parser.add_argument("--llama-server", type=Path, required=True)
    parser.add_argument("--gguf", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=3)
    parser.add_argument("--model", default="qwen2.5-0.5b")
    result = run(parser.parse_args())
    print(json.dumps(result, ensure_ascii=True))
    passed = (result["agent"]["kind"] == "done" and not result["agent"]["error"]
              and result["proposals"] == 1 and result["oraclePassed"] and result["checkoutClean"])
    raise SystemExit(0 if passed else 1)
