from __future__ import annotations

import importlib
import importlib.util
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Any

PLUGIN_DIR = Path(__file__).parents[2] / "integrations" / "hermes-nexus"


def _load_package():
    name = "hermes_nexus_test_plugin"
    for key in tuple(sys.modules):
        if key == name or key.startswith(name + "."):
            del sys.modules[key]
    spec = importlib.util.spec_from_file_location(
        name,
        PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


HEX40 = "a" * 40
HEX64 = "b" * 64
WORKTREE_ID = "c" * 64


def _base_scope(paths: list[str] | None = None, *, status: str = "available", write_ex: bool = True, labels: list[str] | None = None, incomplete: bool = False) -> dict[str, Any]:
    if paths is None:
        paths = ["src/a.js"]
    if labels is None:
        labels = ["write", "watch"]
    return {
        "schemaVersion": 1,
        "analysisVersion": "effective-task-scope-v1",
        "projectId": "prj_123",
        "status": status,
        "writeExhaustive": write_ex,
        "watchExhaustive": True,
        "labelsEmitted": labels,
        "write": [{"path": p, "source": "explicit_task_path"} for p in paths],
        "watch": [],
        "observation": {"incomplete": incomplete},
    }


class WriteWriteIntersectionTests(unittest.TestCase):
    def setUp(self):
        self.plugin = _load_package()
        self.inter = importlib.import_module(self.plugin.__name__ + ".write_write_intersection").observe_write_write_intersection

    def test_both_available_overlap_yields_paths_and_flags(self):
        left = _base_scope(["f.py", "g.py"])
        right = _base_scope(["g.py", "h.py"])
        res = self.inter(left, right)
        self.assertEqual(res["status"], "available")
        self.assertTrue(res["writeExhaustive"])
        self.assertEqual(res["paths"], ["g.py"])
        self.assertTrue(res["emptyIsNotNoConflict"])
        self.assertEqual(res["labelsEmitted"], ["write", "watch"])
        self.assertNotIn("conflict", res)
        self.assertNotIn("lock", res)
        self.assertNotIn("lease", res)

    def test_both_available_no_overlap_yields_empty_paths_flag(self):
        left = _base_scope(["a.py"])
        right = _base_scope(["b.py"])
        res = self.inter(left, right)
        self.assertEqual(res["status"], "available")
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])
        self.assertNotIn("conflict", res)

    def test_left_available_right_incomplete_yields_incomplete_no_paths(self):
        left = _base_scope()
        right = _base_scope(status="incomplete", write_ex=True)
        res = self.inter(left, right)
        self.assertEqual(res["status"], "incomplete")
        self.assertNotIn("paths", res)
        self.assertFalse(res.get("writeExhaustive", True))

    def test_left_incomplete_right_available_yields_incomplete_no_paths(self):
        left = _base_scope(status="incomplete")
        right = _base_scope()
        res = self.inter(left, right)
        self.assertEqual(res["status"], "incomplete")
        self.assertNotIn("paths", res)

    def test_rejected_input_yields_rejected_no_paths(self):
        rej = {"status": "rejected", "error": "scope_foo", "ok": False}
        good = _base_scope()
        res = self.inter(rej, good)
        self.assertEqual(res["status"], "rejected")
        self.assertEqual(res.get("error"), "scope_foo")
        self.assertNotIn("paths", res)

    def test_not_evaluated_yields_not_evaluated_no_paths(self):
        ne = _base_scope(status="partial")
        ne["findingState"] = "not_evaluated"
        good = _base_scope()
        res = self.inter(ne, good)
        self.assertEqual(res["status"], "not_evaluated")
        self.assertNotIn("paths", res)

    def test_both_empty_write_available_yields_empty_paths_flag(self):
        left = _base_scope([])
        right = _base_scope([])
        res = self.inter(left, right)
        self.assertEqual(res["status"], "available")
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])

    def test_wrapped_ok_data_inputs(self):
        left = {"ok": True, "data": _base_scope(["x.js", "y.js"])}
        right = {"ok": True, "data": _base_scope(["y.js"])}
        res = self.inter(left, right)
        self.assertEqual(res["status"], "available")
        self.assertEqual(res["paths"], ["y.js"])

    def test_does_not_mutate_inputs(self):
        left = _base_scope(["p.py"])
        right = _base_scope(["p.py", "q.py"])
        lcopy = deepcopy(left)
        rcopy = deepcopy(right)
        self.inter(left, right)
        self.assertEqual(left, lcopy)
        self.assertEqual(right, rcopy)

    def test_non_qualifying_writeExhaustive_false_no_paths(self):
        bad = _base_scope(write_ex=False)
        good = _base_scope()
        res = self.inter(bad, good)
        self.assertNotIn("paths", res)
        self.assertIn(res["status"], ("rejected", "incomplete"))

if __name__ == "__main__":
    unittest.main()
