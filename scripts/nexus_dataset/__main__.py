"""Print explicitly validated dataset records as JSONL; coverage accounting goes to stderr."""
import argparse
import json
import subprocess
import sys
from pathlib import Path

from scripts.nexus_session_usage.snapshot import UsageError
from .input import artifact
from .routing import observations


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="kind", required=True)
    qa = sub.add_parser("qa")
    for field in ("project-id", "revision", "labels", "labels-sha256"):
        qa.add_argument("--" + field, required=True)
    routes = sub.add_parser("routing")
    for field in ("report", "report-sha256", "session-manifest", "session-manifest-sha256"):
        routes.add_argument("--" + field, required=True)
    args = parser.parse_args()
    try:
        if args.kind == "qa":
            manifest = artifact(args.labels, args.labels_sha256, 256 * 1024)
            if not isinstance(manifest, dict):
                raise UsageError("invalid_labels")
            job = {"projectId": args.project_id, "revision": args.revision, "manifest": manifest, "manifestDigest": args.labels_sha256}
            script = Path(__file__).with_name("qa-evidence.mjs")
            child = subprocess.run(["node", str(script)], input=json.dumps(job), capture_output=True, text=True, timeout=60)
            if child.returncode:
                raise UsageError("qa_export_unavailable")
            result = json.loads(child.stdout)
            rows, summary = result["rows"], result["summary"]
        else:
            rows, summary = observations(args.report, args.report_sha256, args.session_manifest, args.session_manifest_sha256)
        for row in rows:
            print(json.dumps(row, ensure_ascii=True, sort_keys=True))
        print(json.dumps(summary, sort_keys=True), file=sys.stderr)
        return 0
    except (OSError, subprocess.SubprocessError):
        error = "dataset_export_unavailable"
    except UsageError as exc:
        error = str(exc)
    print(json.dumps({"error": error}), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
