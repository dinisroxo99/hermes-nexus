"""Unittest for offline nexus_log_inspector (stdlib only).

Run:
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests/hermes_nexus_plugin -p test_log_inspector.py -v
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

# locate the inspector without polluting sys.path permanently
REPO_ROOT = Path(__file__).parents[2]
INSPECTOR_PY = REPO_ROOT / "scripts" / "nexus_log_inspector" / "inspector.py"


def _load_inspector():
    name = "nexus_log_inspector_test"
    for key in list(sys.modules):
        if key == name or key.startswith(name + "."):
            del sys.modules[key]
    spec = importlib.util.spec_from_file_location(name, INSPECTOR_PY)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load inspector")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


class TestLogInspector(unittest.TestCase):
    def setUp(self):
        self.inspector = _load_inspector()

    def _write_temp_jsonl(self, lines: list[str]) -> Path:
        fd, path = tempfile.mkstemp(suffix=".jsonl", text=False)
        os.close(fd)
        p = Path(path)
        with p.open("w", encoding="utf-8", newline="\n") as f:
            for ln in lines:
                f.write(ln + "\n")
        return p

    def _write_temp_no_nl(self, content: str) -> Path:
        fd, path = tempfile.mkstemp(suffix=".jsonl", text=False)
        os.close(fd)
        p = Path(path)
        p.write_text(content, encoding="utf-8")
        return p

    def test_minimal_valid(self):
        lines = [
            json.dumps({
                "runId": "r1", "profile": "impl", "sha": "s1",
                "nexusTools": True, "writePaths": ["a.py"], "watchPaths": []
            })
        ]
        p = self._write_temp_jsonl(lines)
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["status"], "ok")
            self.assertEqual(rep["examined"], 1)
            self.assertEqual(rep["valid"], 1)
            self.assertEqual(rep["invalid"], 0)
            self.assertTrue(rep["complete"])
            self.assertFalse(rep["limited"])
            self.assertEqual(rep["distinct_correlation_keys"], 1)
            self.assertEqual(rep["declared_write_path_entries"], 1)
            self.assertEqual(rep["declared_watch_path_entries"], 0)
        finally:
            p.unlink()

    def test_multiple_profiles_empty_lists_repeated_paths_unicode(self):
        lines = [
            json.dumps({"runId": "r1", "profile": "p1", "sha": "s1", "nexusTools": False, "writePaths": [], "watchPaths": []}),
            json.dumps({"runId": "r2", "profile": "p2", "sha": "s2", "nexusTools": True, "writePaths": ["x/y.py", "x/y.py"], "watchPaths": ["w"]}),
            json.dumps({"runId": "r3", "profile": "p1", "sha": "s1", "nexusTools": True, "writePaths": ["\u00e9\u00e8.py"], "watchPaths": []}),
        ]
        p = self._write_temp_jsonl(lines)
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["valid"], 3)
            self.assertEqual(rep["invalid"], 0)
            self.assertEqual(rep["distinct_correlation_keys"], 3)
            self.assertEqual(rep["declared_write_path_entries"], 0 + 2 + 1)
        finally:
            p.unlink()

    def test_invalid_cases(self):
        lines = [
            json.dumps({"runId": "r", "profile": "p", "sha": "s", "nexusTools": True, "writePaths": ["ok"], "watchPaths": [] , "extra": 1}),
            json.dumps({"runId": "", "profile": "p", "sha": "s", "nexusTools": True, "writePaths": [], "watchPaths": []}),
            json.dumps({"runId": "r", "profile": "p", "sha": "s", "nexusTools": 1, "writePaths": [], "watchPaths": []}),
            json.dumps({"runId": "r", "profile": "p", "sha": "s", "nexusTools": True, "writePaths": [""], "watchPaths": []}),
            "not json at all",
            json.dumps({"runId": "r", "profile": "p"}),  # missing keys
        ]
        p = self._write_temp_jsonl(lines)
        try:
            rep = self.inspector.inspect_jsonl_log(p, max_records=100)
            self.assertEqual(rep["examined"], 6)
            self.assertEqual(rep["valid"], 0)
            self.assertEqual(rep["invalid"], 6)
            codes = [d["code"] for d in rep["invalid_records"]]
            self.assertIn("extra_keys", codes)
            self.assertIn("empty_or_non_str", codes)
            self.assertIn("not_bool", codes)
            self.assertIn("not_list_of_nonempty_str", codes)
            self.assertIn("invalid_json", codes)
            self.assertIn("missing_keys", codes)
        finally:
            p.unlink()

    def test_empty_file(self):
        p = self._write_temp_jsonl([])
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["examined"], 0)
            self.assertEqual(rep["valid"], 0)
            self.assertTrue(rep["complete"])
        finally:
            p.unlink()

    def test_truncated_last_line(self):
        # no trailing \n , partial json would be invalid but detected as incomplete
        p = self._write_temp_no_nl('{"runId":"r","profile":"p","sha":"s","nexusTools":true,"writePaths":[],"watchPaths":[]')
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["examined"], 1)
            self.assertEqual(rep["invalid"], 1)
            self.assertTrue(rep["incomplete_last_line"] or rep["limited"])
        finally:
            p.unlink()

    def test_budgets_limit(self):
        lines = [json.dumps({"runId": f"r{i}", "profile": "p", "sha": "s", "nexusTools": True, "writePaths": [], "watchPaths": []}) for i in range(5)]
        p = self._write_temp_jsonl(lines)
        try:
            rep = self.inspector.inspect_jsonl_log(p, max_records=2)
            self.assertTrue(rep["limited"])
            self.assertEqual(rep["limited_reason"], "max_records_exceeded")
            self.assertEqual(rep["records_observed"], 2)
        finally:
            p.unlink()

    def test_access_error_non_regular(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td) / "adir"
            d.mkdir()
            rep = self.inspector.inspect_jsonl_log(d)
            self.assertEqual(rep.get("status"), "error")
            self.assertIn("not_regular", rep.get("error", ""))

    def test_cli_json(self):
        lines = [json.dumps({"runId": "rc", "profile": "cli", "sha": "sc", "nexusTools": False, "writePaths": ["f.py"], "watchPaths": []})]
        p = self._write_temp_jsonl(lines)
        try:
            res = subprocess.run(
                [sys.executable, "-B", "-m", "scripts.nexus_log_inspector", "--input", str(p), "--format", "json"],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                timeout=10,
            )
            self.assertEqual(res.returncode, 0)
            data = json.loads(res.stdout)
            self.assertEqual(data["valid"], 1)
            self.assertIn("complete", data)
        finally:
            p.unlink()

    def test_input_not_mutated(self):
        lines = [json.dumps({"runId": "rm", "profile": "m", "sha": "sm", "nexusTools": True, "writePaths": [], "watchPaths": []})]
        p = self._write_temp_jsonl(lines)
        size_before = p.stat().st_size
        mtime_before = p.stat().st_mtime
        try:
            _ = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(p.stat().st_size, size_before)
            self.assertEqual(p.stat().st_mtime, mtime_before)
        finally:
            p.unlink()

    def test_duplicate_keys_are_invalid(self):
        """Named regression for O2-DUP-KEYS: duplicate top-level keys must be invalid (not last-wins valid)."""
        # Construct with two runId keys; json.loads default would last-win and pass key-set check.
        dup_line = '{"runId":"r1","runId":"r2","profile":"p","sha":"s","nexusTools":true,"writePaths":[],"watchPaths":[]}'
        p = self._write_temp_jsonl([dup_line])
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["examined"], 1)
            self.assertEqual(rep["valid"], 0)
            self.assertEqual(rep["invalid"], 1)
            codes = [d.get("code") for d in rep.get("invalid_records", [])]
            self.assertIn("duplicate_keys", codes)
            dups = [d for d in rep.get("invalid_records", []) if d.get("code") == "duplicate_keys"]
            self.assertTrue(dups, "must report a duplicate_keys diagnostic")
            self.assertEqual(dups[0].get("field"), "runId")
            self.assertEqual(dups[0].get("line"), 1)
            # no raw value or full line in diag
            self.assertNotIn("r1", str(dups[0]))
            self.assertNotIn("r2", str(dups[0]))
        finally:
            p.unlink()

    def test_o2_read_cap_does_not_abort_on_diag_limit(self):
        """Named test for O2-READ-CAP HIGH: after 51 invalids, continue to count later valids; do not break read."""
        inv_line = json.dumps({"bad": 1})
        val_line = json.dumps({
            "runId": "r", "profile": "p", "sha": "s",
            "nexusTools": True, "writePaths": [], "watchPaths": []
        })
        lines = [inv_line] * 51 + [val_line] * 3
        p = self._write_temp_jsonl(lines)
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["examined"], 54)
            self.assertEqual(rep["valid"], 3)
            self.assertEqual(rep["invalid"], 51)
            self.assertTrue(rep["complete"])
            self.assertFalse(rep["limited"])
        finally:
            p.unlink()

    def test_o2_text_esc_escapes_c0_esc_in_text_output_only(self):
        """Named test for O2-TEXT-ESC MEDIUM: escape C0/ESC only in --format text; D3-valid records with ESC accepted."""
        esc = "\x1b"
        val = {
            "runId": "r", "profile": "p" + esc + "q", "sha": "s",
            "nexusTools": True, "writePaths": [], "watchPaths": []
        }
        lines = [json.dumps(val)]
        p = self._write_temp_jsonl(lines)
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["valid"], 1)
            self.assertEqual(rep["invalid"], 0)
            txt = self.inspector.format_text(rep)
            self.assertNotIn(esc, txt)
            # escaped as \x1b (direct) or \u001b (via json group key str)
            self.assertTrue("\\x1b" in txt or "\\u001b" in txt)
            # construction accepted ESC in profile value (D3-valid string kept; counted as valid, no reject)
        finally:
            p.unlink()

    def test_o2_group_collide_uses_structured_not_colon(self):
        """Named test for O2-GROUP-COLLIDE MEDIUM: colon concat gkey must not merge distinct (profile,sha)."""
        line_ab_c = json.dumps({
            "runId": "r1", "profile": "a:b", "sha": "c",
            "nexusTools": True, "writePaths": [], "watchPaths": []
        })
        line_a_bc = json.dumps({
            "runId": "r2", "profile": "a", "sha": "b:c",
            "nexusTools": True, "writePaths": [], "watchPaths": []
        })
        p = self._write_temp_jsonl([line_ab_c, line_a_bc])
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["valid"], 2)
            self.assertEqual(rep["distinct_correlation_keys"], 2)
            groups = rep.get("profile_sha_groups", {})
            self.assertEqual(len(groups), 2, "must not collapse on colon in profile/sha")
        finally:
            p.unlink()

    def test_o2_incomplete_heuristic_only_for_final_line_json_fail(self):
        """Named test for O2-INCOMPLETE-HEURISTIC MEDIUM: set incomplete_last_line only if final examined line failed JSON and no trailing nl."""
        inv = "not-json-line"
        val = json.dumps({
            "runId": "r", "profile": "p", "sha": "s",
            "nexusTools": True, "writePaths": [], "watchPaths": []
        })
        # invalid first + valid last, file no final nl
        content = inv + "\n" + val
        p = self._write_temp_no_nl(content)
        try:
            rep = self.inspector.inspect_jsonl_log(p)
            self.assertEqual(rep["examined"], 2)
            self.assertEqual(rep["valid"], 1)
            self.assertEqual(rep["invalid"], 1)
            self.assertFalse(rep.get("incomplete_last_line", False))
        finally:
            p.unlink()

        # last line fails json, no nl -> should set
        content2 = val + "\n" + inv
        p2 = self._write_temp_no_nl(content2)
        try:
            rep2 = self.inspector.inspect_jsonl_log(p2)
            self.assertEqual(rep2["examined"], 2)
            self.assertEqual(rep2["valid"], 1)
            self.assertEqual(rep2["invalid"], 1)
            self.assertTrue(rep2.get("incomplete_last_line", False))
        finally:
            p2.unlink()


if __name__ == "__main__":
    unittest.main()
