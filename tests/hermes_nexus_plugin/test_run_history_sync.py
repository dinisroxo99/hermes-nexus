import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.nexus_recovery.__main__ import create_backup, restore
from scripts.nexus_run_history.source import observe
from scripts.nexus_run_history.store import ingest, inspect_task, query, store_version
from scripts.nexus_run_history.sync import sync_snapshot
from scripts.nexus_session_usage.snapshot import UsageError
from test_run_history import PR, SHA, make_board, receipt


def add_task(db, project, task, revision=SHA, *, malformed=False):
    start = db.execute("SELECT COALESCE(MAX(id),0)+1 FROM task_events").fetchone()[0]
    rid = db.execute("SELECT COALESCE(MAX(id),0)+1 FROM task_runs").fetchone()[0]
    db.execute("INSERT INTO tasks VALUES(?,?,?,?,?)", (task, project, "done", "session-" + task, PR))
    db.execute("INSERT INTO task_runs VALUES(?,?,'done','completed',10,20,'PRIVATE SUMMARY','PRIVATE PROMPT')", (rid, task))
    emitted = [(None, "created", {"project_id": project}), (rid, "claimed", {}),
               (rid, "pr_acceptance", {} if malformed else receipt(PR, revision)), (rid, "completed", {"notes": "hidden"})]
    db.executemany("INSERT INTO task_events VALUES(?,?,?,?,?,?)",
                   [(start+n, task, run, kind, json.dumps(body), 10+n) for n, (run, kind, body) in enumerate(emitted)])
    return rid, start+2


def rerun(db, task, revision):
    start = db.execute("SELECT MAX(id)+1 FROM task_events").fetchone()[0]
    rid = db.execute("SELECT MAX(id)+1 FROM task_runs").fetchone()[0]
    db.execute("INSERT INTO task_runs VALUES(?,?,'done','completed',30,40,NULL,NULL)", (rid, task))
    for n, (kind, body) in enumerate([("claimed", {}), ("pr_acceptance", receipt(PR, revision)), ("completed", {})]):
        db.execute("INSERT INTO task_events VALUES(?,?,?,?,?,?)", (start+n, task, rid, kind, json.dumps(body), 30+n))
    return start+2


class RunHistorySyncTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.board = self.root / "kanban.db"
        self.store = self.root / "history.sqlite"
        make_board(self.board)

    def sync(self, board=None, project="ProjectA"):
        return sync_snapshot(board or self.board, self.store, project)

    def active(self, revision=SHA, task=None):
        return [r["taskId"] for r in query(self.store, "ProjectA", revision, task)["evidence"]]

    def cli(self):
        return subprocess.run([sys.executable, "-B", "-m", "scripts.nexus_run_history", "sync",
                               "--kanban", str(self.board), "--store", str(self.store), "--project-id", "ProjectA"],
                              capture_output=True, text=True, check=False, timeout=10)

    def test_project_scoped_sync_resumes_new_tasks_and_revisions_and_ignores_stale_replay(self):
        with sqlite3.connect(self.board) as db:
            add_task(db, "ProjectA", "t_second")
            add_task(db, "OtherProject", "UnrelatedPrivateTask", malformed=True)
        original = self.root / "old.db"
        shutil.copyfile(self.board, original)
        first = self.cli()
        self.assertEqual(first.returncode, 0, first.stderr)
        result = json.loads(first.stdout)
        self.assertEqual((result["imported"], result["checkpoint"]), (2, 8))
        before = self.store.read_bytes()
        with patch("scripts.nexus_run_history.sync._project_rows", side_effect=AssertionError("must skip validation")):
            self.assertEqual(self.sync()["status"], "unchanged_publication")
        self.assertEqual(before, self.store.read_bytes())
        self.assertNotIn(b"UnrelatedPrivateTask", before)
        self.assertNotIn(b"PRIVATE", before)
        self.assertEqual(self.active(), ["t_example", "t_second"])
        with sqlite3.connect(self.board) as db:
            mark = rerun(db, "t_example", "b"*40)
            add_task(db, "ProjectA", "t_third")
        result = self.sync()
        self.assertGreater(result["checkpoint"], mark)
        self.assertEqual((result["imported"], result["unchanged"]), (2, 1))
        self.assertEqual(self.active(), ["t_second", "t_third"])
        self.assertEqual(self.active("b"*40), ["t_example"])
        updated = self.store.read_bytes()
        self.assertEqual(self.sync(original)["status"], "older_snapshot")
        self.assertEqual(updated, self.store.read_bytes())
        self.assertEqual(inspect_task(self.store, "ProjectA", "t_example")["attempts"][0]["status"], "superseded")

    def test_malformed_task_is_quarantined_valid_tasks_publish_and_a_corrected_source_resumes(self):
        self.assertEqual(self.sync()["checkpoint"], 4)
        previous = self.root / "previous.db"
        shutil.copyfile(self.board, previous)
        with sqlite3.connect(self.board) as db:
            last = rerun(db, "t_example", "b"*40)
            db.execute("UPDATE task_events SET payload='{}' WHERE id=?", (last-1,))
            add_task(db, "ProjectA", "good")
        command = self.cli()
        self.assertEqual(command.returncode, 2, command.stderr)
        result = json.loads(command.stdout)
        self.assertEqual((result["status"], result["checkpoint"], result["imported"]), ("partial", 4, 1))
        self.assertEqual(result["errors"], [{"taskId": "t_example", "error": "invalid_receipt"}])
        self.assertEqual(self.active(), ["good"])
        self.assertEqual(inspect_task(self.store, "ProjectA", "t_example")["syncPending"]["watermark"], last)
        self.assertEqual(self.sync(previous)["status"], "older_snapshot")
        self.assertEqual(self.active(), ["good"])
        self.assertEqual(ingest(self.store, observe(previous, "ProjectA", "t_example"))["status"], "older_snapshot")
        self.assertEqual(self.sync()["status"], "partial")
        with sqlite3.connect(self.board) as db:
            db.execute("UPDATE task_events SET payload=? WHERE id=?", (json.dumps(receipt(PR, "b"*40)), last-1))
        self.assertEqual(self.sync()["status"], "synchronized")
        self.assertEqual(self.active("b"*40), ["t_example"])
        self.assertEqual(self.active(), ["good"])
        self.assertNotIn("syncPending", inspect_task(self.store, "ProjectA", "t_example"))

    def test_rollback_preserves_prior_checkpoint_and_divergent_prefix_does_not_promote_history(self):
        self.sync()
        unchanged = self.store.read_bytes()
        with sqlite3.connect(self.board) as db:
            add_task(db, "ProjectA", "new")
        from scripts.nexus_run_history import sync
        usual = sync.ingest_task
        def interrupted(store, row):
            usual(store, row)
            raise RuntimeError("interrupted before publishing")
        with patch.object(sync, "ingest_task", interrupted), self.assertRaises(RuntimeError):
            self.sync()
        self.assertEqual(self.store.read_bytes(), unchanged)
        with sqlite3.connect(self.board) as db:
            db.execute("UPDATE task_events SET created_at=500 WHERE id=1")
        report = self.sync()
        self.assertEqual(report["status"], "partial")
        self.assertEqual(report["errors"], [{"taskId": "t_example", "error": "divergent_task_history"}])
        self.assertEqual(self.active(), ["new"])

    def test_backward_compatible_recovery_of_v1_v2_and_exact_schema_admission(self):
        self.sync()
        def roundtrip(name):
            archive = self.root / (name + ".zip")
            result = create_backup(self.root, self.store, archive)
            path = self.root / ("restored-" + name)
            restore(archive, result["sha256"], path)
            return path / "history.sqlite"
        recovered = roundtrip("v2")
        self.assertEqual(query(recovered, "ProjectA", SHA)["evidence"][0]["runId"], 1)
        self.assertEqual(sync_snapshot(self.board, recovered, "ProjectA")["status"], "unchanged_publication")
        with sqlite3.connect(self.store) as db:
            db.execute("DROP TABLE sync_pending")
            db.execute("DROP TABLE sync_projects")
            db.execute("PRAGMA user_version=1")
        legacy = roundtrip("v1")
        with sqlite3.connect(legacy) as db:
            self.assertEqual(store_version(db), 1)
        self.assertEqual(query(legacy, "ProjectA", SHA)["evidence"][0]["taskId"], "t_example")
        self.assertEqual(sync_snapshot(self.board, legacy, "ProjectA")["status"], "synchronized")
        with sqlite3.connect(legacy) as db:
            self.assertEqual(store_version(db), 2)
            db.execute("ALTER TABLE sync_projects ADD COLUMN extra TEXT")
        with self.assertRaisesRegex(UsageError, "unsupported_history_store"):
            create_backup(self.root, legacy, self.root / "bad.zip")
        self.assertFalse((self.root / "bad.zip").exists())

    def test_unexpected_prefix_is_not_authorized_by_its_own_pending_entry(self):
        with sqlite3.connect(self.board) as db:
            add_task(db, "OtherProject", "old_foreign")
            add_task(db, "ProjectA", "follows")
        self.assertEqual(self.sync()["checkpoint"], 12)
        with sqlite3.connect(self.board) as db:
            db.execute("UPDATE tasks SET project_id='ProjectA' WHERE id='old_foreign'")
            db.execute("UPDATE task_events SET payload=? WHERE id=5", (json.dumps({"project_id": "ProjectA"}),))
            db.execute("INSERT INTO task_events VALUES(13,'old_foreign',NULL,'note',NULL,15)")
        for _ in range(2):
            report = self.sync()
            self.assertEqual(report["errors"], [{"taskId": "old_foreign", "error": "unexpected_historical_task"}])
            self.assertEqual(self.active(), ["follows", "t_example"])

    def test_capacity_during_batch_rolls_back_and_pending_fields_are_validated_before_display(self):
        self.sync()
        before = self.store.read_bytes()
        with sqlite3.connect(self.board) as db:
            add_task(db, "ProjectA", "new")
        with patch("scripts.nexus_run_history.store.MAX_ROWS", 1), self.assertRaisesRegex(UsageError, "history_store_limit"):
            self.sync()
        self.assertEqual(before, self.store.read_bytes())
        with sqlite3.connect(self.store) as db:
            db.execute("INSERT INTO sync_pending VALUES('ProjectA','t_example',4,'PRIVATE QUARANTINE TEXT')")
        with self.assertRaisesRegex(UsageError, "invalid_history_observation"):
            inspect_task(self.store, "ProjectA", "t_example")

    def test_whole_project_limits_refuse_instead_of_advancing_partial_input(self):
        self.sync()
        before = self.store.read_bytes()
        with sqlite3.connect(self.board) as db:
            add_task(db, "ProjectA", "new")
        with patch("scripts.nexus_run_history.sync.MAX_PROJECT_EVENTS", 4), self.assertRaisesRegex(UsageError, "project_sync_limit"):
            self.sync()
        self.assertEqual(before, self.store.read_bytes())
        self.assertEqual(self.sync()["imported"], 1)
