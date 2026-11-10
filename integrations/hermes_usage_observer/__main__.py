"""Read a selected worker run's captured Hermes usage events."""
import argparse
import json
import sys

from scripts.nexus_session_usage.snapshot import UsageError
from .events import ObserverError
from .query import query


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("directory", "kanban", "project-id", "board", "task-id"):
        parser.add_argument("--" + option, required=True)
    parser.add_argument("--run-id", type=int, required=True)
    args = parser.parse_args()
    try:
        result = query(args.directory, args.kanban, args.project_id, args.board, args.task_id, args.run_id)
    except (ObserverError, UsageError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
