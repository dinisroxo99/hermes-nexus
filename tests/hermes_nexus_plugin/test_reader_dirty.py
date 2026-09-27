"""In-memory tests for read_dirty per E7 contract.

Exactly the 10 named methods. Gate:
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests/hermes_nexus_plugin -p test_reader_dirty.py
"""

from __future__ import annotations

import importlib
import importlib.util
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from typing import Any

PLUGIN_DIR = Path(__file__).parents[2] / "integrations" / "hermes-nexus"
ANALYSIS = "reader-dirty-v1"


def _load_reader():
    name = "hermes_nexus_test_reader_dirty"
    for key in list(sys.modules):
        if key == name or key.startswith(name + "."):
            del sys.modules[key]
    spec = importlib.util.spec_from_file_location(
        name,
        PLUGIN_DIR / "reader_dirty.py",
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module.read_dirty


class ReadDirtyTests(unittest.TestCase):
    def setUp(self):
        self.read_dirty = _load_reader()

    def _assert_refused(self, res: dict[str, Any]) -> None:
        self.assertEqual(
            res,
            {
                "status": "not_evaluated",
                "reason": "input_incomplete",
                "analysisVersion": ANALYSIS,
            },
        )
        self.assertNotIn("dirty", res)

    def test_tracked_edit_is_dirty(self):
        obs = {"porcelain": " M src/source.ts\0", "serviceHasPycacheFilter": False, "linkedWorktree": True}
        res = self.read_dirty(obs)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res["dirty"], True)
        self.assertEqual(res["omittedUntrackedBytecode"], False)
        self.assertEqual(res["linkedWorktree"], True)
        self.assertEqual(res["unfilteredLengthDirty"], True)
        self.assertEqual(res["disagreeWithUnfilteredService"], False)
        self.assertEqual(res["notServiceUpdate"], True)
        self.assertEqual(res["notInventedClean"], True)
        self.assertNotIn("serviceFilter", res)

    def test_untracked_env_log_node_modules_and_case_are_dirty(self):
        cases = [
            "?? .env\0",
            "?? debug.log\0",
            "?? node_modules/pkg/index.js\0",
            "?? file.pyc.bak\0",
            "?? Foo/__Pycache__/a.txt\0",
            # D2: normal business.py dirty; leading-space variants (space in pathname) dirty+omitted=false
            "?? src/business.py\0",
            "??  __pycache__/business.py\0",
            "??  mod.pyc\0",
            "??  mod.pyo\0",
            "??  foo/__pycache__/bar.pyo\0",
        ]
        for p in cases:
            with self.subTest(p=p):
                obs = {"porcelain": p, "serviceHasPycacheFilter": False, "linkedWorktree": False}
                res = self.read_dirty(obs)
                self.assertEqual(res["dirty"], True, p)
                self.assertEqual(res["omittedUntrackedBytecode"], False, p)

    def test_untracked_pycache_and_pyc_are_not_dirty(self):
        cases = [
            "?? foo/__pycache__/bar.cpython-312.pyc\0",
            "?? mod.pyc\0",
            "?? foo/__pycache__\0",
            "?? foo\\\\__pycache__\\\\bar.pyc\0",
            # D2: root __pycache__, .pyo (no leading space) omitted
            "?? __pycache__/cached.pyc\0",
            "?? mod.pyo\0",
            "?? foo/__pycache__/bar.pyo\0",
            "?? __pycache__/x.pyo\0",
        ]
        for p in cases:
            with self.subTest(p=p):
                obs = {"porcelain": p, "serviceHasPycacheFilter": False, "linkedWorktree": True}
                res = self.read_dirty(obs)
                self.assertEqual(res["dirty"], False, p)
                self.assertEqual(res["omittedUntrackedBytecode"], True, p)
                self.assertEqual(res["unfilteredLengthDirty"], True, p)
                self.assertEqual(res["disagreeWithUnfilteredService"], True, p)
                self.assertNotIn("serviceFilter", res)

    def test_tracked_edit_plus_pycache_is_dirty(self):
        obs = {
            "porcelain": " M src/source.ts\0?? foo/__pycache__/bar.cpython-312.pyc\0",
            "serviceHasPycacheFilter": False,
            "linkedWorktree": True,
        }
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertEqual(res["omittedUntrackedBytecode"], True)
        self.assertEqual(res["disagreeWithUnfilteredService"], False)

    def test_tracked_pyc_modification_is_dirty(self):
        obs = {"porcelain": " M tracked.pyc\0", "serviceHasPycacheFilter": True, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertEqual(res["omittedUntrackedBytecode"], False)
        self.assertIn("serviceFilter", res)

        # D2 additional: tracked .pyo also dirty (not omitted)
        obs = {"porcelain": " M tracked.pyo\0", "serviceHasPycacheFilter": False, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertEqual(res["omittedUntrackedBytecode"], False)

    def test_empty_porcelain_is_clean(self):
        res = self.read_dirty({"porcelain": "", "serviceHasPycacheFilter": False, "linkedWorktree": False})
        self.assertEqual(res["dirty"], False)
        self.assertEqual(res["omittedUntrackedBytecode"], False)
        self.assertEqual(res["unfilteredLengthDirty"], False)
        self.assertEqual(res["disagreeWithUnfilteredService"], False)

        # D2: malformed like x\0 (and other structural failures) must refuse, not invent clean
        res2 = self.read_dirty({"porcelain": "x\0", "serviceHasPycacheFilter": False, "linkedWorktree": False})
        self._assert_refused(res2)

    def test_service_lacks_filter_does_not_invent_clean_or_dirty(self):
        # real dirt stays
        obs = {"porcelain": " M src/source.ts\0", "serviceHasPycacheFilter": False, "linkedWorktree": True, "dirty": False}
        orig = deepcopy(obs)
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertNotIn("serviceFilter", res)
        self.assertEqual(res["notServiceUpdate"], True)
        self.assertEqual(res["notInventedClean"], True)
        self.assertEqual(obs, orig)  # not mutated

        # empty stays clean
        obs = {"porcelain": "", "serviceHasPycacheFilter": False, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], False)
        self.assertNotIn("serviceFilter", res)

    def test_service_filter_present_same_classification(self):
        # tracked edit
        obs = {"porcelain": " M src/source.ts\0", "serviceHasPycacheFilter": True, "linkedWorktree": True}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertIn("serviceFilter", res)
        self.assertEqual(res["disagreeWithUnfilteredService"], False)

        # pyc only
        obs = {"porcelain": "?? foo/__pycache__/bar.cpython-312.pyc\0", "serviceHasPycacheFilter": True, "linkedWorktree": True}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], False)
        self.assertIn("serviceFilter", res)
        self.assertEqual(res["disagreeWithUnfilteredService"], False)  # no disagree when service filters

        # D2: leading-space path is dirty (not omitted) even when filter present
        obs = {"porcelain": "??  __pycache__/business.py\0", "serviceHasPycacheFilter": True, "linkedWorktree": True}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertIn("serviceFilter", res)
        self.assertEqual(res["disagreeWithUnfilteredService"], False)

        # .pyo omitted same with filter
        obs = {"porcelain": "?? mod.pyo\0", "serviceHasPycacheFilter": True, "linkedWorktree": True}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], False)
        self.assertIn("serviceFilter", res)

        # malformed input refused; filter does not rescue or invent result
        res = self.read_dirty({"porcelain": "x\0", "serviceHasPycacheFilter": True, "linkedWorktree": False})
        self._assert_refused(res)

    def test_rename_is_dirty(self):
        obs = {"porcelain": "R  old.ts\0new.ts\0", "serviceHasPycacheFilter": False, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)

        obs = {"porcelain": "R  a.ts\0b.ts\0?? foo/__pycache__/x.pyc\0", "serviceHasPycacheFilter": False, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertEqual(res["omittedUntrackedBytecode"], True)

        # D2: copy also dirty
        obs = {"porcelain": "C  old.ts\0new.ts\0", "serviceHasPycacheFilter": False, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)

        # paired-path + following omission (rename then omitted pyc)
        obs = {"porcelain": "R  a.ts\0b.ts\0?? mod.pyo\0", "serviceHasPycacheFilter": False, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertEqual(res["omittedUntrackedBytecode"], True)

        # omitted then rename (mixed, following dirty keeps dirty, aggregates omitted)
        obs = {"porcelain": "?? mod.pyo\0R  x\0y\0", "serviceHasPycacheFilter": False, "linkedWorktree": False}
        res = self.read_dirty(obs)
        self.assertEqual(res["dirty"], True)
        self.assertEqual(res["omittedUntrackedBytecode"], True)

    def test_refusal_omits_dirty(self):
        cases = [
            None,
            "not a dict",
            {"porcelain": " M x\0"},  # missing keys
            {"porcelain": " M x\0", "serviceHasPycacheFilter": 1, "linkedWorktree": True},
            {"porcelain": None, "serviceHasPycacheFilter": False, "linkedWorktree": True},
            {"porcelain": " M x\0", "serviceHasPycacheFilter": False, "linkedWorktree": "yes"},
            # D2 malformed framing / structural (must refuse, no dirty invented)
            # wrapped as real obs (reach _classify / read_dirty); reuse _assert_refused
            {"porcelain": "??\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},  # short or empty path
            {"porcelain": "R  old\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},  # truncated rename/copy paired path
            {"porcelain": " M foo\0x\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},  # malformed after a dirtying entry
            {"porcelain": "?? foo", "serviceHasPycacheFilter": False, "linkedWorktree": False},  # missing final NUL
            {"porcelain": "x\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},  # short record
            {"porcelain": "?? \0", "serviceHasPycacheFilter": False, "linkedWorktree": False},  # empty pathname
            # D2-R1: interior empties as wrapped obs (real parse cases)
            {"porcelain": "\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},
            {"porcelain": "\0\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},
            {"porcelain": "?? mod.pyc\0\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},
            {"porcelain": "?? src/a.py\0\0?? src/b.py\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},
            {"porcelain": "R  old\0\0?? mod.pyc\0", "serviceHasPycacheFilter": False, "linkedWorktree": False},
        ]
        for c in cases:
            with self.subTest(c=c):
                res = self.read_dirty(c)  # type: ignore[arg-type]
                self._assert_refused(res)
