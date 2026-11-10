"""Run a bounded offline Hermes tool batch and emit a reviewable patch."""
import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from .evidence import validate_evidence
from .receipt import verify
from .inputs import MAX_FILE, check_revision, git, materialize
from .sandbox import command, network_filter, python_mounts
from .runtime_source import prepare_runtime


MAX_BATCH = 1024 * 1024
MAX_REPORT = 4 * 1024 * 1024


def parse_input(raw):
    if len(raw) > MAX_BATCH:
        raise ValueError("batch_budget")
    calls = json.loads(raw)
    context = None
    if isinstance(calls, dict):
        if set(calls) != {"calls", "nexusContext"} or not isinstance(calls["nexusContext"], dict):
            raise ValueError("invalid_envelope")
        context, calls = calls["nexusContext"], calls["calls"]
    if not isinstance(calls, list) or not 1 <= len(calls) <= 16:
        raise ValueError("invalid_batch")
    for call in calls:
        if not isinstance(call, dict) or set(call) != {"tool", "args"} or not isinstance(call["args"], dict):
            raise ValueError("invalid_call")
        if not isinstance(call["tool"], str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", call["tool"]):
            raise ValueError("invalid_tool_name")
    return calls, context


def validate_calls(raw):
    return parse_input(raw)[0]


def worker_limits():
    import resource
    for limit, value in ((resource.RLIMIT_CORE, 0), (resource.RLIMIT_FSIZE, MAX_REPORT)):
        _, hard = resource.getrlimit(limit)
        ceiling = value if hard == resource.RLIM_INFINITY else min(value, hard)
        resource.setrlimit(limit, (ceiling, ceiling))


def launch(runtime, view, authority_file, writes, worker, request):
    with tempfile.TemporaryFile() as filt, tempfile.TemporaryFile() as output:
        network_filter(filt)
        cmd = command(runtime, view, authority_file, writes, worker, filt)
        result = subprocess.run(cmd, input=request, stdout=output, stderr=subprocess.DEVNULL,
                                pass_fds=(filt.fileno(),), preexec_fn=worker_limits, timeout=45, check=False)
        if result.returncode or output.tell() > MAX_REPORT:
            raise RuntimeError("isolated_worker_failed")
        output.seek(0)
        return json.load(output)


def run(repo, checkout, revision, task, reads, writes, calls, nexus_context=None):
    if sys.platform != "linux":
        raise ValueError("linux_bubblewrap_required")
    if any(repo.is_relative_to(path) or checkout.is_relative_to(path) for path in [Path("/usr"), *python_mounts()]):
        raise ValueError("checkout_inside_runtime_mount")
    with tempfile.TemporaryDirectory(prefix="nexus-guarded-") as tmp:
        root = Path(tmp)
        view = root / "view"
        view.mkdir()
        authority = materialize(repo, revision, task, reads, writes, view)
        manifest = root / "authority.json"
        validate_evidence(nexus_context, authority, view)
        manifest.write_text(json.dumps({"grant": authority, "evidence": nexus_context}), encoding="utf-8")
        baseline = root / "baseline"
        shutil.copytree(view, baseline)
        git(baseline, "init", "-q", "--template=")
        git(baseline, "add", "--", *authority["read"])
        runtime = root / "runtime"
        runtime.mkdir()
        upstream = prepare_runtime(checkout, runtime)
        report = launch(runtime, view, manifest, authority["write"], "/guard/worker.py", json.dumps(calls).encode())
        verify(report, calls, authority, nexus_context, baseline, view)
        for name in authority["write"]:
            source = view / name
            if source.stat().st_size > MAX_FILE or source.is_symlink() or not source.is_file():
                raise ValueError("invalid_worker_output")
            content = source.read_bytes()
            content.decode("utf-8")
            if b"\0" in content:
                raise ValueError("invalid_worker_output")
            (baseline / name).write_bytes(content)
        patch = git(baseline, "diff", "--no-ext-diff", "--no-textconv", "--binary").decode()
        check_revision(repo, revision)
        return {"status": "completed", "hermesRevision": upstream, "projectRoot": str(repo), "authority": authority, **report, "patch": patch}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--repo", type=Path, required=True)
    cli.add_argument("--hermes-checkout", type=Path, required=True)
    cli.add_argument("--revision", required=True)
    cli.add_argument("--task", required=True)
    cli.add_argument("--read", action="append", default=[])
    cli.add_argument("--write", action="append", default=[])
    args = cli.parse_args()
    try:
        calls, context = parse_input(sys.stdin.buffer.read(MAX_BATCH + 1))
        result = run(args.repo.resolve(), args.hermes_checkout.resolve(), args.revision,
                     args.task, args.read, args.write, calls, context)
    except (OSError, subprocess.SubprocessError, ValueError, RuntimeError, RecursionError) as exc:
        code = str(exc) if re.fullmatch(r"[a-z_]{1,60}", str(exc)) else type(exc).__name__
        print(json.dumps({"status": "unavailable", "reason": code}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
