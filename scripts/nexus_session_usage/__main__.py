"""Print a read-only report from an explicitly supplied standalone Hermes session snapshot."""
import argparse
import json
import sys

from .report import report_usage
from .snapshot import UsageError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="standalone SQLite database snapshot")
    parser.add_argument("--session", required=True, help="exact session ID")
    parser.add_argument("--compare-session", help="optional second exact session ID")
    args = parser.parse_args()
    try:
        result = report_usage(args.input, args.session, args.compare_session)
    except UsageError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
