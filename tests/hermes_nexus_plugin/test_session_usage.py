import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.nexus_session_usage import snapshot
from scripts.nexus_session_usage.report import COUNTERS, report_usage
from scripts.nexus_session_usage.snapshot import MAX_BYTES, UsageError


class SessionUsageTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = self.root / "state.db"
        db = sqlite3.connect(self.path)
        columns = ", ".join(f"{key} INTEGER DEFAULT 0" for key in COUNTERS)
        db.execute(f"CREATE TABLE sessions(id TEXT PRIMARY KEY, {columns}, system_prompt TEXT)")
        db.execute("CREATE TABLE messages(content TEXT)")
        db.execute("INSERT INTO messages VALUES ('PRIVATE_MESSAGE')")
        db.execute("INSERT INTO sessions VALUES ('left',120,30,60,15,5,1,'PRIVATE_PROMPT')")
        db.execute("INSERT INTO sessions VALUES ('right',45,25,0,NULL,4,1,'PRIVATE_PROMPT')")
        db.execute("INSERT INTO sessions(id) VALUES ('empty')")
        db.commit()
        db.close()

    def test_exact_session_counters_and_numeric_deltas(self):
        original = self.path.read_bytes()
        result = report_usage(self.path, "left", "right")
        self.assertEqual([s["sessionId"] for s in result["sessions"]], ["left", "right"])
        self.assertEqual(result["projectRevisionBinding"], "not_established")
        self.assertEqual(result["sessions"][0]["counters"], dict(zip(COUNTERS, [120, 30, 60, 15, 5, 1])))
        self.assertEqual(result["comparison"]["status"], "descriptive_only")
        self.assertEqual(result["comparison"]["secondMinusFirst"], dict(zip(COUNTERS, [-75, -5, -60, None, -1, 0])))
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertEqual(self.path.read_bytes(), original)
        self.assertEqual(list(self.root.iterdir()), [self.path])

    def test_exact_selection_unknown_and_no_positive_accounting(self):
        missing = report_usage(self.path, "LEFT", "empty")
        self.assertEqual(missing["sessions"][0]["status"], "missing")
        self.assertIsNone(missing["sessions"][0]["counters"])
        self.assertFalse(missing["sessions"][1]["positiveTokenCountObserved"])
        self.assertEqual(missing["comparison"], {"status": "unavailable", "secondMinusFirst": None})
        self.assertEqual(report_usage(self.path, "empty", "left")["comparison"], missing["comparison"])
        for sid in ["left' OR 1=1", "a\n", "z" * 129]:
            with self.assertRaisesRegex(UsageError, "invalid_session_id"):
                report_usage(self.path, sid)
        with self.assertRaisesRegex(UsageError, "distinct_sessions_required"):
            report_usage(self.path, "left", "left")

    def test_active_wal_refused_then_closed_wal_mode_file_reads_fresh_row(self):
        db = sqlite3.connect(self.path)
        try:
            self.assertEqual(db.execute("PRAGMA journal_mode=WAL").fetchone(), ("wal",))
            db.execute("UPDATE sessions SET input_tokens=210 WHERE id='left'")
            db.commit()
            before = {p.name: hashlib.sha256(p.read_bytes()).digest() for p in self.root.iterdir()}
            with self.assertRaisesRegex(UsageError, "standalone_snapshot_required"):
                report_usage(self.path, "left")
            self.assertEqual(before, {p.name: hashlib.sha256(p.read_bytes()).digest() for p in self.root.iterdir()})
        finally:
            db.close()
        original = self.path.read_bytes()
        self.assertEqual(original[18:20], b"\2\2")
        self.assertEqual(report_usage(self.path, "left")["sessions"][0]["counters"]["input_tokens"], 210)
        self.assertEqual(original, self.path.read_bytes())
        self.assertEqual(list(self.root.iterdir()), [self.path])

    def test_sidecars_and_unsafe_sources_refused(self):
        for suffix in ["-wal", "-shm", "-journal"]:
            sidecar = Path(str(self.path) + suffix)
            sidecar.touch()
            with self.assertRaisesRegex(UsageError, "standalone_snapshot_required"):
                report_usage(self.path, "left")
            sidecar.unlink()
        symlink = self.root / "link"
        symlink.symlink_to(self.path)
        with self.assertRaises(UsageError):
            report_usage(symlink, "left")
        symlink.unlink()
        symlink.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(UsageError):
            report_usage(symlink / self.path.name, "left")
        fifo = self.root / "pipe"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(UsageError, "regular_file_required"):
            report_usage(fifo, "left")
        with self.assertRaisesRegex(UsageError, "invalid_input_path"):
            report_usage(self.root / "x" / ".." / "state.db", "left")

    def test_changed_input_and_hard_size_cap(self):
        original_fstat = os.fstat
        def change_after_open(fd):
            st = original_fstat(fd)
            if st.st_ino == self.path.stat().st_ino:
                with self.path.open("ab") as stream:
                    stream.write(b"!")
            return st
        with patch("scripts.nexus_session_usage.snapshot.os.fstat", side_effect=change_after_open):
            with self.assertRaisesRegex(UsageError, "snapshot_changed"):
                report_usage(self.path, "left")
        with self.path.open("ab") as output:
            output.truncate(MAX_BYTES + 1)
        with self.assertRaisesRegex(UsageError, "database_too_large"):
            report_usage(self.path, "left")

    def test_replacing_grandparent_during_capture_refuses_detached_original(self):
        current, replacement = (self.root / name for name in ("current", "replacement"))
        for directory in (current, replacement):
            (directory / "data").mkdir(parents=True)
        source = current / "data" / "state.db"
        self.path.rename(source)
        replacement_file = replacement / "data" / "state.db"
        replacement_file.write_bytes(source.read_bytes())
        with sqlite3.connect(replacement_file) as db:
            db.execute("UPDATE sessions SET input_tokens=999 WHERE id='left'")
        db.close()

        check_journals = snapshot._no_journals
        calls = 0

        def swap_after_read(directory, name):
            nonlocal calls
            calls += 1
            if calls == 2:
                current.rename(self.root / "detached")
                replacement.rename(current)
            return check_journals(directory, name)

        with patch.object(snapshot, "_no_journals", side_effect=swap_after_read):
            with self.assertRaisesRegex(UsageError, "^snapshot_changed$"):
                report_usage(source, "left")
        self.assertEqual(report_usage(source, "left")["sessions"][0]["counters"]["input_tokens"], 999)

    def test_schema_and_values_are_verified(self):
        db = sqlite3.connect(self.path)
        db.execute("UPDATE sessions SET input_tokens = 'PRIVATE_COUNTER' WHERE id='left'")
        db.commit()
        db.close()
        with self.assertRaisesRegex(UsageError, "^invalid_session_counters$"):
            report_usage(self.path, "left")
        db = sqlite3.connect(self.path)
        db.execute("ALTER TABLE sessions RENAME TO other")
        db.execute("CREATE VIEW sessions AS SELECT * FROM other")
        db.commit()
        db.close()
        with self.assertRaisesRegex(UsageError, "unsupported_sessions_schema"):
            report_usage(self.path, "left")

    def test_cli_output_and_errors_do_not_disclose_paths_or_content(self):
        args = [sys.executable, "-B", "-m", "scripts.nexus_session_usage", "--input", str(self.path), "--session", "left"]
        result = subprocess.run(args, capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), report_usage(self.path, "left"))
        self.path.unlink()
        err = subprocess.run(args, capture_output=True, text=True, check=False)
        self.assertEqual(err.returncode, 1)
        self.assertEqual(err.stdout, "")
        self.assertEqual(json.loads(err.stderr), {"error": "input_unavailable"})
