"""Ingest a native Kanban snapshot or query validated revision-bound outcomes."""
import argparse
import json
import sys

from scripts.nexus_session_usage.snapshot import UsageError
from .source import observe
from .store import MAX_ROWS, correlate_session, ingest, inspect_task, query


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="action", required=True)
    for action in ("ingest", "query", "export", "inspect", "correlate-session"):
        command = subs.add_parser(action)
        command.add_argument("--store", required=True)
        command.add_argument("--project-id", required=True)
        if action == "ingest":
            command.add_argument("--kanban", required=True)
            command.add_argument("--task-id", required=True)
        elif action == "inspect":
            command.add_argument("--task-id", required=True)
        else:
            command.add_argument("--revision", required=True)
            if action == "correlate-session":
                command.add_argument("--sessions", required=True)
                command.add_argument("--task-id", required=True)
            if action == "query":
                command.add_argument("--task-id")
                command.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()
    try:
        if args.action == "ingest":
            report = ingest(args.store, observe(args.kanban, args.project_id, args.task_id))
        elif args.action == "correlate-session":
            report = correlate_session(args.store, args.project_id, args.revision, args.task_id, args.sessions)
        elif args.action == "inspect":
            report = inspect_task(args.store, args.project_id, args.task_id)
        elif args.action == "query":
            report = query(args.store, args.project_id, args.revision, args.task_id, args.limit)
        else:
            report = query(args.store, args.project_id, args.revision, limit=MAX_ROWS, exporting=True)
            for row in report["evidence"]:
                print(json.dumps({"schemaVersion": 1, "exampleType": "verified_pr_check_outcome", "evidence": row}, sort_keys=True))
            return 0
        print(json.dumps(report, sort_keys=True))
        return 0
    except UsageError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
