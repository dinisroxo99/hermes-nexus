"""CLI for offline descriptive comparisons of D3 collect-forward records."""

import argparse
import json

from .compare import MAX_BYTES, MAX_LINE_BYTES, MAX_RECORDS, compare_captures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, help="Baseline capture (.jsonl)")
    parser.add_argument("--candidate", required=True, help="Candidate capture (.jsonl)")
    parser.add_argument("--max-bytes", type=int, default=MAX_BYTES)
    parser.add_argument("--max-records", type=int, default=MAX_RECORDS)
    parser.add_argument("--max-line-bytes", type=int, default=MAX_LINE_BYTES)
    try:
        report = compare_captures(**vars(parser.parse_args()))
    except ValueError as error:
        parser.error(str(error))
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return int(report["status"] == "input_error")


if __name__ == "__main__":
    raise SystemExit(main())
