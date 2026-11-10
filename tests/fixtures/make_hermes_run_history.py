"""Generate an offline acceptance fixture using the pinned Hermes schema and lifecycle APIs."""
import argparse
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

PIN = "903a57c540917cedd30c7d971938f1af7bdf60e2"
PR = "https://github.com/example/fixture/pull/7"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--revision", default="1" * 40)
    parser.add_argument("--tasks", type=int, choices=range(1, 9), default=1)
    parser.add_argument("--other-project", action="store_true", help="also create one task in a second isolated project")
    args = parser.parse_args()
    if subprocess.check_output(["git", "-C", args.hermes, "rev-parse", "HEAD"], text=True).strip() != PIN:
        parser.error("unexpected Hermes source revision")
    root = args.output.resolve()
    root.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.environ["HERMES_HOME"] = str(root / "home")
    os.environ["HOME"] = str(root / "home")
    sys.path.insert(0, str(args.hermes.resolve()))
    from hermes_cli import kanban_db as kb, kanban_db_connect, kanban_pr_acceptance, projects_db
    from hermes_state import SessionDB
    revision = args.revision

    def github(endpoint, **options):
        if endpoint == "graphql":
            return {"data": {"repository": {"pullRequest": {"headRefOid": revision, "baseRefName": "main", "state": "OPEN",
                    "baseRef": {"branchProtectionRule": {"requiredStatusChecks": [{"context": "ci", "app": None}]}}}}}}
        if "/rules/branches/" in endpoint or endpoint.endswith("/statuses?per_page=100"):
            return [[]]
        if "/check-runs?" in endpoint:
            return [{"total_count": 1, "check_runs": [{"id": 35, "name": "ci", "app": {"id": 1}, "head_sha": revision,
                    "status": "completed", "conclusion": "success", "html_url": None}]}]
        if endpoint == "repos/example/fixture/pulls/7":
            return {"head": {"sha": revision}, "base": {"ref": "main"}, "state": "open"}
        raise AssertionError(endpoint)

    session_id = "upstream-origin-session"
    sessions = SessionDB(db_path=root / "session-native.db")
    sessions.create_session(session_id, "cli")
    sessions.close()
    with projects_db.connect_closing() as conn:
        project = projects_db.create_project(conn, name="History fixture", primary_path=str(root))
        other = projects_db.create_project(conn, name="Second isolated project", primary_path=str(root / "other")) if args.other_project else None
    targets = [project] * args.tasks + ([other] if other else [])
    observed = []
    with kanban_db_connect.connect_closing(root / "native.db") as conn:
        for index, selected in enumerate(targets, 1):
            task = kb.create_task(conn, title=f"Synthetic check {index}", assignee="tester", project_id=selected,
                                  session_id=session_id, completion_contract=PR)
            claimed = kb.claim_task(conn, task, claimer="fixture")
            assert claimed and claimed.current_run_id
            with patch.object(kanban_pr_acceptance, "_api", github):
                assert kb.complete_task(conn, task, summary="private summary", expected_run_id=claimed.current_run_id,
                                        fire_lifecycle_hook=False, metadata={"published_pr": PR})
            observed.append({"projectId": selected, "taskId": task, "runId": claimed.current_run_id})
        with sqlite3.connect(root / "board.db") as backup:
            conn.backup(backup)
    result = {**observed[0], "revision": revision, "originSessionId": session_id,
              "sourcePin": PIN, "githubTransport": "simulated", "tasks": observed}
    (root / "fixture.json").write_text(json.dumps(result), encoding="utf8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
