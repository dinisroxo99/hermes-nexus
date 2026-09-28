"""Entry point for python -m scripts.nexus_log_inspector

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# support both package and direct
try:
    from .inspector import inspect_jsonl_log, format_text
except ImportError:
    # when run as python -m from scripts dir or direct
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from nexus_log_inspector.inspector import inspect_jsonl_log, format_text  # type: ignore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="nexus_log_inspector",
        description="Offline stdlib-only validator for D3 collect-forward-log.jsonl",
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to explicit .jsonl file (no auto-discovery, no ~/.hermes)",
    )
    parser.add_argument(
        "--format",
        choices=["json", "text"],
        default="json",
        help="Output format",
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=10 * 1024 * 1024,
        help="Byte budget for streaming read",
    )
    parser.add_argument(
        "--max-records",
        type=int,
        default=10000,
        help="Record count budget",
    )
    parser.add_argument(
        "--max-line-bytes",
        type=int,
        default=1024 * 1024,
        help="Per-line budget",
    )
    args = parser.parse_args(argv)

    try:
        report = inspect_jsonl_log(
            args.input,
            max_bytes=args.max_bytes,
            max_records=args.max_records,
            max_line_bytes=args.max_line_bytes,
        )
    except Exception as e:  # safety
        sys.stderr.write(f"error: {e}\n")
        return 1

    if report.get("status") == "error":
        sys.stderr.write(json.dumps(report, ensure_ascii=False) + "\n")
        return 1

    if args.format == "json":
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(format_text(report), end="")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
