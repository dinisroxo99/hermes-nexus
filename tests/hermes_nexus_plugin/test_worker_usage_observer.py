import concurrent.futures
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from integrations.hermes_usage_observer import register
from integrations.hermes_usage_observer import ledger
from integrations.hermes_usage_observer.events import COUNTERS, ObserverError, observe
from integrations.hermes_usage_observer.query import query


class UsageObserverTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.directory = self.root / "capture"
        self.directory.mkdir(mode=0o700)
        self.db = self.root / "board.db"
        with sqlite3.connect(self.db) as db:
            db.execute("CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT,session_id TEXT)")
            db.execute("CREATE TABLE task_runs(id INTEGER PRIMARY KEY,task_id TEXT,metadata TEXT,summary TEXT)")
            db.execute("INSERT INTO tasks VALUES ('t_1','p_1','different_origin')")
            db.execute("INSERT INTO task_runs VALUES (7,'t_1',?,'SECRET_SUMMARY')",
                       (json.dumps({"worker_session_id": "s_1", "extra": "SECRET_DATA"}),))
        db.close()
        self.env = {"HERMES_KANBAN_BOARD": "default", "HERMES_KANBAN_TASK": "t_1", "HERMES_KANBAN_RUN_ID": "7"}
        self.hook = {"task_id": "t_1", "session_id": "s_1", "turn_id": "s_1:t_1:abc", "api_request_id": "s_1:t_1:abc:api:1",
                     "usage": {"input_tokens": 17, "output_tokens": 3, "raw_usage": "SECRET_USAGE"},
                     "response": "SECRET_RESPONSE", "base_url": "SECRET_BASE_URL", "messages": ["SECRET_PROMPT"]}

    def report(self):
        return query(self.directory, self.db, "p_1", "default", "t_1", 7)

    def test_hook_uses_allowlisted_native_fields_and_query_corroborates_session_not_origin(self):
        callbacks = {}
        with patch.dict(os.environ, {**self.env, "NEXUS_USAGE_OBSERVER_DIR": str(self.directory)}):
            register(type("Context", (), {"register_hook": lambda _, hook, fn: callbacks.update({hook: fn})})())
            callback = callbacks["post_api_request"]
            self.assertIsNone(callback(**self.hook))
        capture = next(self.directory.iterdir()).read_text()
        self.assertNotIn("SECRET", capture)
        report = self.report()
        self.assertNotIn("SECRET", json.dumps(report))
        self.assertEqual(report["captureCompleteness"], "unknown")
        self.assertEqual(report["events"][0]["nativeWorkerSession"], "matches")
        self.assertTrue(report["events"][0]["hookTaskMatchesDispatch"])
        self.assertEqual(report["events"][0]["usage"]["input_tokens"], 17)
        self.assertIsNone(report["events"][0]["usage"]["reasoning_tokens"])
        self.assertEqual(set(report["events"][0]["usage"]), set(COUNTERS))

    def test_missing_mismatched_and_duplicate_native_worker_session_never_become_matches(self):
        ledger.persist(self.directory, observe(self.env, **{**self.hook, "task_id": "generated_turn_id", "usage": None}))
        for metadata, expected in [('{"worker_session_id":"different"}', "differs"), ('{}', "unobserved")]:
            with sqlite3.connect(self.db) as db:
                db.execute("UPDATE task_runs SET metadata=?", (metadata,))
            db.close()
            event = self.report()["events"][0]
            self.assertFalse(event["hookTaskMatchesDispatch"])
            self.assertIsNone(event["usage"])
            self.assertEqual(event["nativeWorkerSession"], expected)
        with sqlite3.connect(self.db) as db:
            db.execute("""UPDATE task_runs SET metadata='{"worker_session_id":"s_1","worker_session_id":"different"}'""")
        db.close()
        with self.assertRaisesRegex(ObserverError, "invalid_native_worker_session"):
            self.report()
        with self.assertRaisesRegex(ObserverError, "project_task_run_mismatch"):
            query(self.directory, self.db, "other", "default", "t_1", 7)

    def test_parallel_replays_are_idempotent_and_equivocation_is_persistently_excluded(self):
        event = observe(self.env, **self.hook)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            outcomes = list(pool.map(lambda _: ledger.persist(self.directory, event), range(12)))
        self.assertEqual(outcomes.count("observed"), 1)
        self.assertEqual(outcomes.count("duplicate"), 11)
        modified = observe(self.env, **{**self.hook, "usage": {"input_tokens": 18}})
        self.assertEqual(ledger.persist(self.directory, modified), "conflict")
        self.assertEqual(ledger.persist(self.directory, event), "conflict")
        report = self.report()
        self.assertEqual(report["events"], [])
        self.assertEqual(report["conflictingKeysForRecordedDispatch"], 1)

    def test_unrelated_dispatch_conflicts_do_not_appear_in_the_selected_run(self):
        ledger.persist(self.directory, observe(self.env, **self.hook))
        original = self.report()
        for key, replacement in (("HERMES_KANBAN_TASK", "other_task"), ("HERMES_KANBAN_RUN_ID", "8"),
                                 ("HERMES_KANBAN_BOARD", "other_board")):
            other_env = {**self.env, key: replacement}
            hook = {**self.hook, "api_request_id": "api:" + replacement}
            ledger.persist(self.directory, observe(other_env, **hook))
            modified = {**hook, "usage": {"input_tokens": 99}}
            self.assertEqual(ledger.persist(self.directory, observe(other_env, **modified)), "conflict")
        self.assertEqual(self.report(), original)

    def test_capacity_pending_write_recovery_and_unsafe_directories(self):
        event = observe(self.env, **self.hook)
        (self.directory / ".pending").write_text("incomplete")
        with patch.object(ledger, "MAX_EVENTS", 1):
            ledger.persist(self.directory, event)
            self.assertFalse((self.directory / ".pending").exists())
            other = observe(self.env, **{**self.hook, "api_request_id": "s_1:t_1:abc:api:2"})
            with self.assertRaisesRegex(ObserverError, "event_limit_reached"):
                ledger.persist(self.directory, other)
            self.assertEqual(ledger.persist(self.directory, event), "duplicate")
        alias = self.root / "link"
        alias.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(ObserverError):
            ledger.persist(alias, event)
        self.directory.chmod(0o755)
        with self.assertRaisesRegex(ObserverError, "capture_directory_not_private"):
            ledger.persist(self.directory, event)

    def test_opt_in_and_strict_identifiers_and_counters(self):
        called = []
        with patch.dict(os.environ, {}, clear=True):
            register(type("Context", (), {"register_hook": lambda *a: called.append(a)})())
        self.assertFalse(called)
        self.assertIsNone(observe({}, **self.hook))
        with self.assertRaisesRegex(ObserverError, "invalid_dispatch_context"):
            observe({**self.env, "HERMES_KANBAN_RUN_ID": "07"}, **self.hook)
        with self.assertRaisesRegex(ObserverError, "invalid_hook_identity"):
            observe(self.env, **{**self.hook, "turn_id": "bad\nturn"})
        for value in [True, -1, 2**55, "17"]:
            with self.assertRaisesRegex(ObserverError, "invalid_usage"):
                observe(self.env, **{**self.hook, "usage": {"output_tokens": value}})
