"""Replay an inert pre_tool_call experiment against an explicitly trusted Hermes checkout."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def revision(checkout):
    env = {**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_LAZY_FETCH": "1"}
    for key in list(env):
        if key.startswith("GIT_") and key not in ("GIT_OPTIONAL_LOCKS", "GIT_NO_LAZY_FETCH"):
            del env[key]

    def git(*args):
        return subprocess.check_output(
            ["git", "-c", "core.fsmonitor=false", "-C", str(checkout), *args],
            env=env, text=True, stderr=subprocess.DEVNULL, timeout=10,
        ).strip()

    if Path(git("rev-parse", "--show-toplevel")).resolve() != checkout or git("status", "--porcelain"):
        raise ValueError("expected_clean_checkout_root")
    return git("rev-parse", "HEAD")


def run_probe(checkout):
    checkout = Path(checkout).resolve(strict=True)
    start = revision(checkout)
    worker = Path(__file__).with_name("worker.py").resolve()
    with TemporaryDirectory(prefix="nexus-guard-probe-") as tmp:
        root = Path(tmp)
        (root / "bundled").mkdir()
        env = {
            "PATH": os.defpath, "HOME": tmp, "USERPROFILE": tmp, "TMPDIR": tmp, "TEMP": tmp, "TMP": tmp,
            "HERMES_HOME": str(root / "profile"), "HERMES_BUNDLED_PLUGINS": str(root / "bundled"),
            "HERMES_ENABLE_PROJECT_PLUGINS": "0",
        }
        if sys.platform == "win32" and "SystemRoot" in os.environ:
            env["SystemRoot"] = os.environ["SystemRoot"]
        result_file = root / "result.json"
        result = subprocess.run(
            [sys.executable, "-IB", str(worker), str(checkout), str(result_file)],
            env=env, cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=45, check=False,
        )
        if result.returncode or not result_file.exists() or result_file.stat().st_size > 4096:
            raise ValueError("worker_failed")
        report = json.loads(result_file.read_text(encoding="utf-8"))
    if start != revision(checkout):
        raise ValueError("checkout_changed")
    return {"revision": start, **report}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True, help="Root of a trusted, clean Hermes Agent Git checkout")
    args = parser.parse_args(argv)
    try:
        report = run_probe(args.checkout)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        report = {"status": "unavailable", "reason": type(exc).__name__}
        if isinstance(exc, ValueError) and str(exc) in {"expected_clean_checkout_root", "worker_failed", "checkout_changed"}:
            report["reason"] = str(exc)
    print(json.dumps(report, sort_keys=True))
    return 0 if report.get("status") == "veto_observed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
