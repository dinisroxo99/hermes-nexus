"""In-memory tests for collect_forward_log per E3 contract.

Exactly the 8 methods. Gate:
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests/hermes_nexus_plugin -p test_collect_forward_log.py
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


ANALYSIS = "collect-forward-log-v1"


def _base_fields(
    *,
    run_id: str = "run-123",
    profile: str = "impl",
    sha: str = "not-a-real-sha",
    nexus_tools: bool = True,
    write_paths: list[str] | None = None,
    watch_paths: list[str] | None = None,
) -> dict[str, Any]:
    if write_paths is None:
        write_paths = ["src/a.py"]
    if watch_paths is None:
        watch_paths = []
    return {
        "runId": run_id,
        "profile": profile,
        "sha": sha,
        "nexusTools": nexus_tools,
        "writePaths": write_paths,
        "watchPaths": watch_paths,
    }


class CollectForwardLogTests(unittest.TestCase):
    def setUp(self):
        self.plugin = _load_package()
        self.collect = importlib.import_module(
            self.plugin.__name__ + ".collect_forward_log"
        ).collect_forward_log

    def _assert_refused(self, res: dict[str, Any]) -> None:
        self.assertEqual(
            res,
            {
                "status": "not_evaluated",
                "reason": "input_incomplete",
                "analysisVersion": ANALYSIS,
            },
        )
        # no tokens or counts leaked on refusal
        for k in ("runId", "profile", "sha", "nexusTools", "writePathCount", "watchPathCount"):
            self.assertNotIn(k, res)

    def test_missing_run_id_refuses_without_tokens(self):
        f = _base_fields()
        del f["runId"]
        res = self.collect(f)
        self._assert_refused(res)

    def test_missing_sha_refuses_without_tokens(self):
        f = _base_fields()
        del f["sha"]
        res = self.collect(f)
        self._assert_refused(res)

    def test_nexus_tools_true_and_false_without_probe(self):
        # True
        res = self.collect(_base_fields(nexus_tools=True))
        self.assertEqual(res["status"], "collected")
        self.assertEqual(res["nexusTools"], True)
        # False
        res = self.collect(_base_fields(nexus_tools=False))
        self.assertEqual(res["status"], "collected")
        self.assertEqual(res["nexusTools"], False)
        # non-bool refuses (no probe)
        f = _base_fields()
        f["nexusTools"] = "sim"
        self._assert_refused(self.collect(f))
        f["nexusTools"] = 1
        self._assert_refused(self.collect(f))
        f["nexusTools"] = None
        self._assert_refused(self.collect(f))

    def test_write_and_watch_counts_from_provided_lists_only(self):
        f = _base_fields(
            write_paths=["src/a.py", "src/a.py", "src/b.py"],
            watch_paths=["x/y.js"],
        )
        res = self.collect(f)
        self.assertEqual(res["status"], "collected")
        self.assertEqual(res["writePathCount"], 3)
        self.assertEqual(res["watchPathCount"], 1)

        f2 = _base_fields(write_paths=[], watch_paths=[])
        res2 = self.collect(f2)
        self.assertEqual(res2["status"], "collected")
        self.assertEqual(res2["writePathCount"], 0)
        self.assertEqual(res2["watchPathCount"], 0)

    def test_missing_or_invalid_lists_refuse_not_zero(self):
        # non list
        f = _base_fields()
        f["writePaths"] = "not-a-list"
        res = self.collect(f)
        self._assert_refused(res)
        # list with empty-str entry
        f = _base_fields(write_paths=["ok", ""])
        res = self.collect(f)
        self._assert_refused(res)
        # watch bad
        f = _base_fields(watch_paths=[None])
        res = self.collect(f)
        self._assert_refused(res)
        # missing list key already refused by required (count never 0 on refuse)

    def test_incomplete_input_refuses_without_filling(self):
        # non-dict
        self._assert_refused(self.collect(None))
        self._assert_refused(self.collect([]))
        self._assert_refused(self.collect("fields"))
        # partial dicts
        self._assert_refused(self.collect({"runId": "r1"}))
        self._assert_refused(self.collect({"runId": "r1", "profile": "p", "sha": "s"}))
        # empty str after strip
        f = _base_fields(run_id="   ")
        self._assert_refused(self.collect(f))
        f = _base_fields(profile="")
        self._assert_refused(self.collect(f))
        f = _base_fields(sha=" \t\n ")
        self._assert_refused(self.collect(f))

    def test_extra_keys_not_copied_and_input_not_mutated(self):
        f = _base_fields()
        f["honcho"] = {"token": "secret123"}
        f["logPath"] = "/tmp/x.log"
        f["dispatch"] = True
        f["conflict"] = "engine"
        fcopy = deepcopy(f)
        res = self.collect(f)
        self.assertEqual(res["status"], "collected")
        for bad in ("honcho", "logPath", "dispatch", "conflict", "token", "secret"):
            self.assertNotIn(bad, res)
        self.assertEqual(f, fcopy)  # not mutated

    def test_success_shape_is_closed_and_not_ingest(self):
        f = _base_fields(
            run_id="run-xyz",
            profile="tester",
            sha="not-a-real-sha",
            nexus_tools=False,
            write_paths=["~/.hermes/kanban.db", "src/a.py", "src/a.py", "src/b.py"],
            watch_paths=[],
        )
        res = self.collect(f)
        self.assertEqual(res["status"], "collected")
        self.assertEqual(res["schemaVersion"], 1)
        self.assertEqual(res["analysisVersion"], ANALYSIS)
        self.assertEqual(res["runId"], "run-xyz")
        self.assertEqual(res["profile"], "tester")
        self.assertEqual(res["sha"], "not-a-real-sha")
        self.assertEqual(res["nexusTools"], False)
        self.assertEqual(res["writePathCount"], 4)  # dups count; ~/.hermes counts 1
        self.assertEqual(res["watchPathCount"], 0)
        self.assertTrue(res["notIngest"])
        self.assertTrue(res["notHoncho"])
        self.assertTrue(res["notDispatch"])
        self.assertTrue(res["notConflictEngine"])
        # closed: no path lists, no extra
        self.assertNotIn("writePaths", res)
        self.assertNotIn("watchPaths", res)
        self.assertNotIn("paths", res)
        self.assertNotIn("logPath", res)
        self.assertNotIn("~/.hermes/kanban.db", str(res))
        expected = {
            "status",
            "schemaVersion",
            "analysisVersion",
            "runId",
            "profile",
            "sha",
            "nexusTools",
            "writePathCount",
            "watchPathCount",
            "notIngest",
            "notHoncho",
            "notDispatch",
            "notConflictEngine",
        }
        self.assertEqual(set(res.keys()), expected)


if __name__ == "__main__":
    unittest.main()
