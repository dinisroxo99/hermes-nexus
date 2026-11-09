"""Measure Nexus liveness, readiness, project resolution and optional local process usage."""
import argparse
import json
import os
from pathlib import Path
import tempfile
import sys
from .soak import verify_service


def write_checkpoint(path, report):
    with tempfile.NamedTemporaryFile("w", dir=path.parent, prefix=".nexus-sample-", delete=False) as stage:
        name = stage.name
        try:
            json.dump(report, stage, sort_keys=True)
            stage.flush()
            os.fsync(stage.fileno())
            os.replace(name, path)
        finally:
            Path(name).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True, help="numeric loopback origin, e.g. http://127.0.0.1:8770")
    parser.add_argument("--duration-seconds", type=int, default=0)
    parser.add_argument("--interval-seconds", type=int, default=60)
    parser.add_argument("--project-id")
    parser.add_argument("--pid", type=int)
    parser.add_argument("--checkpoint", type=Path, help="atomically update this selected report after each sample")
    args = parser.parse_args()
    try:
        report = verify_service(args.url, args.duration_seconds, args.interval_seconds, args.project_id, args.pid,
                                (lambda record: write_checkpoint(args.checkpoint, record)) if args.checkpoint else None)
    except (ValueError, OSError):
        print(json.dumps({"error": "invalid_probe_request"}), file=sys.stderr)
        return 1
    print(json.dumps(report))
    return 0 if report["status"] == "healthy" else 2


if __name__ == "__main__":
    sys.exit(main())
