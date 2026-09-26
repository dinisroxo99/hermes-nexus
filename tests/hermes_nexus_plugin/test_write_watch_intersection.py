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
REPOSITORY_ID = "b" * 64
WORKTREE_ID = "c" * 64
ANALYSIS = "write-watch-intersection-v1"


def _base_scope(
    write_paths: list[str] | None = None,
    watch_paths: list[str] | None = None,
    *,
    status: str = "available",
    write_ex: bool = True,
    watch_ex: bool = True,
    labels: list[str] | None = None,
    incomplete: bool = False,
    project_id: str = "prj_123",
    commit: str | None = None,
    repo_id: str | None = None,
    wt_id: str | None = None,
    schema_version: int = 1,
    analysis_version: str = "effective-task-scope-v1",
) -> dict[str, Any]:
    if write_paths is None:
        write_paths = ["src/a.js"]
    if watch_paths is None:
        watch_paths = []
    if labels is None:
        labels = ["write", "watch"]
    if commit is None:
        commit = HEX40
    if repo_id is None:
        repo_id = REPOSITORY_ID
    if wt_id is None:
        wt_id = WORKTREE_ID
    return {
        "schemaVersion": schema_version,
        "analysisVersion": analysis_version,
        "projectId": project_id,
        "status": status,
        "writeExhaustive": write_ex,
        "watchExhaustive": watch_ex,
        "labelsEmitted": labels,
        "write": [{"path": p, "source": "explicit_task_path"} for p in write_paths],
        "watch": [{"path": p} for p in watch_paths],
        "observation": {"incomplete": incomplete},
        "revisionBinding": {
            "status": "available",
            "commitSha": commit,
            "branch": "feat/test",
            "dirty": False,
            "isLinkedWorktree": True,
            "worktreeId": wt_id,
            "repositoryIdentity": repo_id,
            "impactRepositoryId": repo_id,
        },
    }


class WriteWatchIntersectionTests(unittest.TestCase):
    def setUp(self):
        self.plugin = _load_package()
        self.inter = importlib.import_module(
            self.plugin.__name__ + ".write_watch_intersection"
        ).observe_write_watch_intersection

    def _assert_refused(self, res: dict[str, Any], reason: str) -> None:
        self.assertEqual(
            res,
            {
                "status": "not_evaluated",
                "reason": reason,
                "analysisVersion": ANALYSIS,
            },
        )
        self.assertNotIn("paths", res)

    def test_both_available_cross_overlap_yields_paths_and_flags(self):
        # left.write overlaps right.watch ; right.write overlaps left.watch
        left = _base_scope(write_paths=["b.py", "a.py", "a.py", "é.py"], watch_paths=["x.py", "c.py"])
        right = _base_scope(write_paths=["c.py", "z.py", "b.py"], watch_paths=["a.py", "b.py", "y.py"])
        res = self.inter(left, right)
        swapped = self.inter(right, left)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res.get("schemaVersion"), 1)
        self.assertEqual(res.get("analysisVersion"), ANALYSIS)
        self.assertEqual(res.get("projectId"), "prj_123")
        self.assertIn("revisionBinding", res)
        self.assertTrue(res["writeExhaustive"])
        self.assertTrue(res["watchExhaustive"])
        self.assertEqual(res["labelsEmitted"], ["write", "watch"])
        self.assertEqual(res["paths"], ["a.py", "b.py", "c.py"])
        self.assertEqual(swapped["paths"], res["paths"])
        self.assertTrue(res["emptyIsNotNoConflict"])
        self.assertNotIn("conflict", res)
        self.assertNotIn("lock", res)
        self.assertNotIn("lease", res)

        # case sensitive miss
        case = self.inter(_base_scope(write_paths=["A.py"]), _base_scope(watch_paths=["a.py"]))
        self.assertEqual(case["status"], "observed")
        self.assertEqual(case["paths"], [])

        # differing wt still observes
        right_wt = _base_scope(write_paths=["c.py", "z.py", "b.py"], watch_paths=["a.py", "b.py"], wt_id="d" * 64)
        res_wt = self.inter(left, right_wt)
        self.assertEqual(res_wt["status"], "observed")
        self.assertEqual(res_wt["paths"], ["a.py", "b.py", "c.py"])

    def test_code_point_order_includes_non_ascii(self):
        left = _base_scope(write_paths=["é.py", "a.py", "z.py"], watch_paths=[])
        right = _base_scope(write_paths=["dummy.py"], watch_paths=["z.py", "é.py", "a.py"])
        res = self.inter(left, right)
        self.assertEqual(res["paths"], ["a.py", "z.py", "é.py"])
        self.assertEqual(self.inter(right, left)["paths"], res["paths"])

    def test_write_write_only_yields_observed_empty(self):
        left = _base_scope(write_paths=["a.py", "b.py"])
        right = _base_scope(write_paths=["a.py", "b.py"])
        res = self.inter(left, right)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])

    def test_watch_watch_only_yields_observed_empty(self):
        left = _base_scope(watch_paths=["w.py", "v.py"])
        right = _base_scope(watch_paths=["w.py", "v.py"])
        res = self.inter(left, right)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])

    def test_same_side_co_membership_not_a_hit(self):
        # p in left write+watch, q in right write+watch; no cross -> empty observed
        left = _base_scope(write_paths=["p.py"], watch_paths=["p.py", "x.py"])
        right = _base_scope(write_paths=["q.py"], watch_paths=["q.py", "y.py"])
        res = self.inter(left, right)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])

    def test_empty_watch_yields_observed_empty(self):
        left = _base_scope(write_paths=["a.py"])
        right = _base_scope(write_paths=["b.py"], watch_paths=[])
        res = self.inter(left, right)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])
        # both empty watch
        res2 = self.inter(_base_scope(write_paths=["a.py"], watch_paths=[]), _base_scope(write_paths=["a.py"], watch_paths=[]))
        self.assertEqual(res2["paths"], [])

    def test_one_direction_and_both_once(self):
        left = _base_scope(write_paths=["only_lw.py", "both.py"], watch_paths=["only_lwa.py"])
        right = _base_scope(write_paths=["only_rw.py"], watch_paths=["both.py", "only_lw.py"])
        res = self.inter(left, right)
        self.assertEqual(res["paths"], ["both.py", "only_lw.py"])  # sorted
        # one dir only
        left1 = _base_scope(write_paths=["p.py"])
        right1 = _base_scope(watch_paths=["p.py"])
        self.assertEqual(self.inter(left1, right1)["paths"], ["p.py"])

    def test_exact_path_equality(self):
        left = _base_scope(write_paths=["foo/bar.py"])
        right = _base_scope(watch_paths=["foo/bar.py"])
        self.assertEqual(self.inter(left, right)["paths"], ["foo/bar.py"])

    def test_empty_write_is_input_rejected(self):
        empty = _base_scope(write_paths=[])
        self._assert_refused(self.inter(empty, _base_scope(watch_paths=["g.py"])), "input_rejected")
        self._assert_refused(self.inter(_base_scope(write_paths=["g.py"]), empty), "input_rejected")
        self._assert_refused(self.inter(empty, empty), "input_rejected")

    def test_bad_watch_entry_rejects_the_whole_side(self):
        good = _base_scope(write_paths=["g.py"])
        bad = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        bad["watch"][0]["path"] = ""
        self._assert_refused(self.inter(good, bad), "input_rejected")

        mixed = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        mixed["watch"].append({"path": 123})
        self._assert_refused(self.inter(good, mixed), "input_rejected")

        missing = _base_scope(write_paths=["g.py"])
        missing["watch"] = [{"source": "foo"}]
        self._assert_refused(self.inter(good, missing), "input_rejected")

    def test_extra_watch_keys_ignored(self):
        left = _base_scope(write_paths=["p.py"])
        right = _base_scope(watch_paths=["p.py"])
        right["watch"][0]["roles"] = ["affected_file"]
        right["watch"][0]["extra"] = {"foo": 1}
        right["watch"][0]["minimumDistance"] = 2
        res = self.inter(left, right)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res["paths"], ["p.py"])

    def test_none_wrapper_rejected(self):
        self._assert_refused(self.inter(None, _base_scope()), "input_rejected")
        self._assert_refused(self.inter(_base_scope(), "scope"), "input_rejected")
        wrapper = {"ok": True, "data": _base_scope(write_paths=["x.py"], watch_paths=["y.py"])}
        self._assert_refused(self.inter(wrapper, _base_scope()), "input_rejected")

    def test_not_evaluated_precedence(self):
        env = {"ok": False, "error": "scope_impact_not_evaluated", "status": "rejected"}
        good = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        self._assert_refused(self.inter(env, good), "input_not_evaluated")
        self._assert_refused(self.inter(good, env), "input_not_evaluated")

        ne = _base_scope(write_paths=["g.py"], watch_paths=["w.py"], status="not_evaluated")
        self._assert_refused(self.inter(ne, good), "input_not_evaluated")

        finding = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        finding["findingState"] = "not_evaluated"
        self._assert_refused(self.inter(finding, good), "input_not_evaluated")

    def test_incomplete_including_watch_exhaustive(self):
        inc = _base_scope(write_paths=["g.py"], watch_paths=["w.py"], incomplete=True)
        self._assert_refused(self.inter(inc, _base_scope()), "input_incomplete")

        no_watch_ex = _base_scope(write_paths=["g.py"], watch_paths=["w.py"], watch_ex=False)
        self._assert_refused(self.inter(no_watch_ex, _base_scope()), "input_incomplete")

        self._assert_refused(
            self.inter(_base_scope(write_paths=["g.py"]), _base_scope(status="incomplete", watch_ex=True)),
            "input_incomplete",
        )

    def test_incomplete_precedes_identity(self):
        left = _base_scope(write_paths=["g.py"], watch_paths=["w.py"], status="incomplete")
        right = _base_scope(write_paths=["g.py"], watch_paths=["w.py"], project_id="other")
        self._assert_refused(self.inter(left, right), "input_incomplete")

    def test_rejected_envelope_precedes_incomplete_and_identity(self):
        naked = {"status": "rejected"}
        good = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        inc = _base_scope(write_paths=["g.py"], watch_paths=["w.py"], status="incomplete")
        self._assert_refused(self.inter(naked, good), "input_rejected")
        self._assert_refused(self.inter(good, naked), "input_rejected")
        self._assert_refused(self.inter(naked, inc), "input_rejected")

    def test_wrapper_ok_data_is_input_rejected(self):
        left = {"ok": True, "data": _base_scope(write_paths=["x.js"], watch_paths=["y.js"])}
        right = {"ok": True, "data": _base_scope(write_paths=["y.js"], watch_paths=["x.js"])}
        self._assert_refused(self.inter(left, right), "input_rejected")

    def test_scope_impact_not_evaluated_envelope_precedes(self):
        envelope = {
            "ok": False,
            "error": "scope_impact_not_evaluated",
            "status": "rejected",
        }
        good = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        self._assert_refused(self.inter(envelope, good), "input_not_evaluated")

    def test_version_labels_revision_gates_rejected(self):
        good = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        self._assert_refused(self.inter(good, _base_scope(write_paths=["g.py"], schema_version=2)), "input_rejected")
        self._assert_refused(
            self.inter(good, _base_scope(write_paths=["g.py"], analysis_version="effective-task-scope-v0")),
            "input_rejected",
        )
        self._assert_refused(self.inter(good, _base_scope(write_paths=["g.py"], labels=["write"])), "input_rejected")

        dirty = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        dirty["revisionBinding"]["dirty"] = True
        self._assert_refused(self.inter(good, dirty), "input_rejected")

        unlinked = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        unlinked["revisionBinding"]["isLinkedWorktree"] = False
        self._assert_refused(self.inter(good, unlinked), "input_rejected")

        rev_bad = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        rev_bad["revisionBinding"]["status"] = "incomplete"
        self._assert_refused(self.inter(good, rev_bad), "input_rejected")

    def test_absent_ids_mismatch(self):
        good = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        missing_p = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        missing_p.pop("projectId")
        self._assert_refused(self.inter(missing_p, missing_p), "identity_mismatch")
        self._assert_refused(self.inter(good, missing_p), "identity_mismatch")

        missing_c = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        missing_c["revisionBinding"].pop("commitSha")
        self._assert_refused(self.inter(missing_c, missing_c), "revision_mismatch")

        missing_r = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        missing_r["revisionBinding"].pop("repositoryIdentity")
        # absent repoId on binding already triggers rejected on per-side (since not _same_present with impact which is present)
        self._assert_refused(self.inter(missing_r, missing_r), "input_rejected")

    def test_present_identity_differences(self):
        left = _base_scope(write_paths=["g.py"], watch_paths=["w.py"])
        self._assert_refused(
            self.inter(left, _base_scope(write_paths=["g.py"], watch_paths=["w.py"], project_id="other")),
            "identity_mismatch",
        )
        self._assert_refused(
            self.inter(left, _base_scope(write_paths=["g.py"], watch_paths=["w.py"], commit="f" * 40)),
            "revision_mismatch",
        )
        self._assert_refused(
            self.inter(left, _base_scope(write_paths=["g.py"], watch_paths=["w.py"], repo_id="e" * 64)),
            "revision_mismatch",
        )

    def test_watch_exhaustive_false_incomplete(self):
        self._assert_refused(
            self.inter(_base_scope(write_paths=["g.py"], watch_ex=False), _base_scope()),
            "input_incomplete",
        )

    def test_does_not_mutate_inputs(self):
        left = _base_scope(write_paths=["p.py"], watch_paths=["q.py"])
        right = _base_scope(write_paths=["r.py"], watch_paths=["p.py"])
        lcopy = deepcopy(left)
        rcopy = deepcopy(right)
        self.inter(left, right)
        self.assertEqual(left, lcopy)
        self.assertEqual(right, rcopy)

    def test_non_dict_is_input_rejected(self):
        self._assert_refused(self.inter(None, _base_scope()), "input_rejected")
        self._assert_refused(self.inter(_base_scope(), {}), "input_rejected")

    def test_exact_refusal_and_success_keys(self):
        # refusal exact
        res = self.inter(None, _base_scope(write_paths=["g.py"], watch_paths=["w.py"]))
        self.assertEqual(list(res.keys()), ["status", "reason", "analysisVersion"])
        # success exact
        left = _base_scope(write_paths=["a.py"], watch_paths=["b.py"])
        right = _base_scope(write_paths=["b.py"], watch_paths=["a.py"])
        res = self.inter(left, right)
        keys = set(res.keys())
        self.assertIn("paths", keys)
        self.assertIn("emptyIsNotNoConflict", keys)
        self.assertIn("watchExhaustive", keys)
        self.assertIn("writeExhaustive", keys)
        self.assertIn("revisionBinding", keys)
        self.assertEqual(res["paths"], ["a.py", "b.py"])


if __name__ == "__main__":
    unittest.main()
