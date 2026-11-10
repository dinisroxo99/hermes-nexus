"""Run a matched, loopback-only Hermes evaluation on an independently scored disposable repository."""
import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager, ExitStack
from itertools import permutations

from paired_cases import CASES, FILES, mentions_expected_paths, task_prompt, validate_answer
from paired_metrics import finish, summarize

HERE = Path(__file__).resolve().parent
HERMES_PIN = "903a57c540917cedd30c7d971938f1af7bdf60e2"


def run_command(args, cwd, env=None, data=None):
    return subprocess.run(args, cwd=cwd, env=env, input=data, text=True, capture_output=True,
                          check=True, timeout=90).stdout.strip()


def git(args, work):
    env = {"PATH": os.environ["PATH"], "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_AUTHOR_NAME": "Benchmark", "GIT_AUTHOR_EMAIL": "benchmark@example.invalid",
           "GIT_COMMITTER_NAME": "Benchmark", "GIT_COMMITTER_EMAIL": "benchmark@example.invalid",
           "GIT_AUTHOR_DATE": "2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE": "2026-01-01T00:00:00Z"}
    return run_command(["git", *args], work, env)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare(root):
    work = root / "workspace"
    work.mkdir()
    for filename, content in FILES.items():
        target = work / filename
        target.parent.mkdir(exist_ok=True, parents=True)
        target.write_text(content)
    git(["init", "-b", "main"], work)
    git(["add", "."], work)
    git(["commit", "-m", "Controlled benchmark fixture"], work)
    revision = git(["rev-parse", "HEAD"], work)
    (root / "projects.json").write_text(json.dumps([{"name": "fixture", "rootId": "bench", "relativePath": "workspace",
                                                    "projectId": "PrJ_Bench"}]))
    job = {"root": str(root), "revision": revision, "cases": CASES}
    # The frozen comparison reuses one revision-bound projection per task across repeats.
    start = time.monotonic()
    lines = run_command(["node", str(HERE / "paired-evidence.mjs")], HERE, data=json.dumps(job))
    seconds = round(time.monotonic() - start, 3)
    data = {row["id"]: row["evidence"] for row in map(json.loads, lines.splitlines())}
    if set(data) != {case["id"] for case in CASES}:
        raise RuntimeError("missing_nexus_evidence")
    return work, revision, data, seconds


@contextmanager
def local_server(args, root):
    server = args.llama_server.resolve(strict=True)
    model = args.gguf.resolve(strict=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}/v1"
    env = {"PATH": os.environ["PATH"], "HOME": str(root), "LD_LIBRARY_PATH": str(server.parent)}
    proc = subprocess.run([str(server), "--version"], cwd=root, env=env, capture_output=True,
                          check=True, timeout=10, text=True)
    version = (proc.stdout + proc.stderr).strip()
    with (root / "server.log").open("wb") as log:
        p = subprocess.Popen([str(server), "-m", str(model), "--alias", args.model, "--host", "127.0.0.1",
                              "--port", str(port), "-c", "65536", "-t", str(args.threads), "-np", "1",
                              "-ngl", "0", "--jinja", "--rope-scaling", "yarn", "--rope-scale", "2",
                              "--yarn-orig-ctx", "32768"], env=env, stdout=log, stderr=log)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            for _ in range(150):
                if p.poll() is not None:
                    raise RuntimeError("local_model_server_failed")
                try:
                    with opener.open(f"http://127.0.0.1:{port}/health", timeout=2) as response:
                        if response.status == 200:
                            break
                except OSError:
                    time.sleep(0.3)
            else:
                raise RuntimeError("local_model_startup_timeout")
            yield endpoint, version
        finally:
            p.terminate()
            try:
                p.wait(10)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait()


def evidence_turn(arm, evidence):
    if arm == "baseline":
        return None
    if arm == "nexus":
        return "Nexus evidence for this task: " + json.dumps(evidence, separators=(",", ":"))
    symbols = [f"{s['name']}@{s['path']}" for s in evidence["symbols"]]
    return "\n".join(["Nexus", "Symbols " + ", ".join(symbols), "Affected " + ", ".join(evidence["affected"]),
                      "Tests " + ", ".join(evidence["testCandidates"]), f"Coverage {evidence['status']}; "
                      f"{evidence['finding']}; sourceIncomplete={str(evidence['sourceIncomplete']).lower()}"])


def retain_native_snapshot(directory, source, session):
    # The worker has closed SessionDB and successfully read this standalone DB via the native usage reader.
    if source.stat().st_size > 32 * 1024 * 1024:
        return {"status": "unavailable", "reason": "native_snapshot_file_limit"}
    output = directory / (session + ".sqlite")
    with source.open("rb") as src, output.open("xb") as dst:
        shutil.copyfileobj(src, dst)
    output.chmod(0o600)
    with output.open("rb") as stored:
        return {"status": "retained", "file": output.name, "sha256": hashlib.file_digest(stored, "sha256").hexdigest()}


def run_arm(args, root, work, revision, endpoint, example, evidence, arm, repeat):
    session = f"bench-{repeat}-{example['id']}-{arm}"
    home = root / session
    home.mkdir()
    (home / "hermes").mkdir()
    # Present the single benchmark tool directly instead of deferring it behind Hermes's discovery bridge.
    (home / "hermes" / "config.yaml").write_text(json.dumps({"tools": {"tool_search": {"enabled": "off"}}}))
    prompt = task_prompt(example)
    projection = evidence_turn(arm, evidence)
    job = {"endpoint": endpoint, "home": str(home), "work": str(work), "hermes": str(args.hermes.resolve()),
           "sessionId": session, "model": args.model, "prompt": prompt, "evidence": projection,
           "result": str(home / "result.json")}
    (home / "job.json").write_text(json.dumps(job))
    env = {"PATH": os.environ["PATH"], "HOME": str(home), "HERMES_HOME": str(home / "hermes"),
           "HF_HUB_OFFLINE": "1", "PYTHONDONTWRITEBYTECODE": "1", "NO_COLOR": "1", "LC_ALL": "C.UTF-8"}
    row = {"repeat": repeat, "task": example["id"], "arm": arm, "promptSha256": sha(prompt.encode()),
           "evidenceBytes": len((projection or "").encode()), "evidenceSha256": sha((projection or "").encode()), "fixtureRevision": revision, "sessionId": session}
    if git(["rev-parse", "HEAD"], work) != revision or git(["status", "--porcelain"], work):
        raise RuntimeError("fixture_changed")
    try:
        proc = subprocess.run([str(args.python.absolute()), str(HERE / "paired_worker.py"), str(home / "job.json")],
                              cwd=work, env=env, capture_output=True, timeout=135)
        if proc.returncode or not (home / "result.json").is_file():
            error = proc.stderr.decode(errors="replace").splitlines()[-1:] or ["missing worker result"]
            return {**row, "execution": "worker_error", "exitCode": proc.returncode, "error": error[0][:360],
                    "usage": None, "score": "not_evaluated"}
    except subprocess.TimeoutExpired:
        return {**row, "execution": "timeout", "timeoutSeconds": 135, "usage": None, "score": "not_evaluated"}
    result = json.loads((home / "result.json").read_text())
    if git(["rev-parse", "HEAD"], work) != revision or git(["status", "--porcelain"], work):
        raise RuntimeError("fixture_changed")
    score = validate_answer(example, result["answer"]) if result["execution"] == "completed" else "not_evaluated"
    if args.session_dir and result.get("usage", {}).get("status") == "present":
        result["nativeSnapshot"] = retain_native_snapshot(args.session_dir, home / "benchmark.sqlite", session)
    mentions = mentions_expected_paths(example, result["answer"]) if result["execution"] == "completed" else None
    return {**row, **result, "score": score, "mentionsExpectedPaths": mentions}


def setup_problem(args):
    for name, path in (("hermes", args.hermes), ("python", args.python),
                       ("llama_server", args.llama_server), ("gguf", args.gguf)):
        if not (path.is_dir() if name == "hermes" else path.is_file()):
            return "unavailable", name + "_missing"
    if (args.hermes / ".env").exists():
        return "unsupported", "nonisolated_hermes_checkout"
    try:
        if git(["rev-parse", "HEAD"], args.hermes) != HERMES_PIN or git(["status", "--porcelain", "--untracked-files=no"], args.hermes):
            return "unsupported", "unsupported_hermes_checkout"
    except (OSError, subprocess.SubprocessError):
        return "unavailable", "hermes_revision_unavailable"
    return None


def save(report, out):
    # Keep a previously complete progress record readable if a worker/server exits while the next row is written.
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=out.parent, delete=False) as f:
        json.dump(report, f, indent=2, ensure_ascii=True)
        f.write("\n")
    os.replace(f.name, out)


def evaluate(args, report):
    with tempfile.TemporaryDirectory(prefix="nexus-paired-") as tmp:
        root = Path(tmp)
        work, revision, evidence, prep = prepare(root)
        report.update({"fixtureRevision": revision, "evidencePreparationSecondsAllCases": prep})
        if args.compact_cohort and revision != "0894ac84d787d907bec32f1d76e0797fdd233b7a":
            raise RuntimeError("preregistered_fixture_mismatch")
        orders = list(permutations(("baseline", "nexus", "compact")))
        with ExitStack() as stack:
            shared = None if args.compact_cohort else stack.enter_context(local_server(args, root))
            for repeat in range(1, args.repeats + 1):
                for index, example in enumerate(CASES):
                    arms = orders[((repeat - 1) * len(CASES) + index) % 6] if args.compact_cohort else (
                        ("baseline", "nexus") if (repeat + index) % 2 else ("nexus", "baseline"))
                    for arm in arms:
                        with ExitStack() as session:
                            endpoint, version = shared or session.enter_context(local_server(args, root))
                            report["engineVersion"] = version
                            row = run_arm(args, root, work, revision, endpoint, example, evidence[example["id"]], arm, repeat)
                        report["rows"].append(row)
                        report["summary"] = summarize(report["rows"], args.compact_cohort)
                        save(report, args.output)
                        print(repeat, example["id"], arm, row["execution"], row["score"], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("hermes", "python", "llama-server", "gguf", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--model", default="qwen2.5-0.5b")
    parser.add_argument("--threads", type=int, choices=range(1, 17), default=3)
    parser.add_argument("--repeats", type=int, choices=range(1, 9), default=2)
    parser.add_argument("--session-dir", type=Path, help="new private directory to retain only this run's synthetic native DBs")
    parser.add_argument("--compact-cohort", action="store_true", help="run the fixed stronger three-arm protocol")
    args = parser.parse_args()
    if args.output.resolve() in {args.hermes.resolve(), args.python.resolve(), args.gguf.resolve(), args.llama_server.resolve()}:
        parser.error("the output must be a separate file")
    report = {"format": "nexus-paired-hermes-v1", "hermesRevision": HERMES_PIN, "model": args.model,
              "repeats": args.repeats, "threads": args.threads, "compactCohort": args.compact_cohort,
              "serverContextTokens": 65536, "ropeScaling": "yarn", "ropeScale": 2, "originalContext": 32768,
              "temperature": 0, "seed": 42, "maxOutputTokens": 160, "rows": [],
              "unmeasured": ["human_acceptance", "coordination_incidents", "paid_cost", "runtime_retry_count"]}
    problem = setup_problem(args)
    if problem:
        report["measurement"] = {"status": problem[0], "reason": problem[1]}
        save(report, args.output)
        raise SystemExit(2)
    with args.gguf.open("rb") as f:
        report["modelSha256"] = hashlib.file_digest(f, "sha256").hexdigest()
    report["engineSha256"] = sha(args.llama_server.read_bytes())
    if args.compact_cohort:
        protocol = HERE.parents[1] / "docs/development/paired-hermes-coder-protocol.md"
        report["protocolSha256"] = sha(protocol.read_bytes())
        if (report["modelSha256"] != "f530705d447660a4336c329981af164b471b60b974b1d808d57e8ec9fe23b239"
                or report["engineSha256"] != "523c55e2d680718afd84b0ac980f852531d96fea93a9a9762ab4ae52ce094422"
                or report["protocolSha256"] != "07aed5635c69b73372f72825ff9dcf0a6f96ed3885c2e53139663c0e4e22f85a"
                or args.model != "qwen2.5-coder-1.5b" or args.repeats != 2 or args.threads != 3):
            report["measurement"] = {"status": "unsupported", "reason": "preregistered_model_or_settings_mismatch"}
            save(report, args.output)
            raise SystemExit(2)
    report["nexusBaseRevision"] = git(["rev-parse", "HEAD"], HERE)
    if args.session_dir:
        try:
            args.session_dir.mkdir(mode=0o700)
        except OSError:
            report["measurement"] = {"status": "unavailable", "reason": "session_directory_must_be_new"}
            save(report, args.output)
            raise SystemExit(2)
    try:
        evaluate(args, report)
    except (OSError, subprocess.SubprocessError, RuntimeError) as err:
        report["setupOrRuntimeError"] = str(err) if isinstance(err, RuntimeError) else type(err).__name__
    save(finish(report), args.output)
    if report["measurement"]["status"] != "complete":
        raise SystemExit(2)


if __name__ == "__main__":
    main()
