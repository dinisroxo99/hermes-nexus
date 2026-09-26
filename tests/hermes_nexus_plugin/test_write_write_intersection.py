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
ANALYSIS = "write-write-intersection-v1"


def _base_scope(
    paths: list[str] | None = None,
    *,
    status: str = "available",
    write_ex: bool = True,
    labels: list[str] | None = None,
    incomplete: bool = False,
    project_id: str = "prj_123",
    commit: str | None = None,
    repo_id: str | None = None,
    wt_id: str | None = None,
    schema_version: int = 1,
    analysis_version: str = "effective-task-scope-v1",
) -> dict[str, Any]:
    if paths is None:
        paths = ["src/a.js"]
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
        "watchExhaustive": True,
        "labelsEmitted": labels,
        "write": [{"path": p, "source": "explicit_task_path"} for p in paths],
        "watch": [],
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


class WriteWriteIntersectionTests(unittest.TestCase):
    def setUp(self):
        self.plugin = _load_package()
        self.inter = importlib.import_module(
            self.plugin.__name__ + ".write_write_intersection"
        ).observe_write_write_intersection

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

    def test_both_available_overlap_yields_paths_and_flags(self):
        left = _base_scope(["b.py", "a.py", "a.py", "é.py"])
        right = _base_scope(["a.py", "z.py", "b.py"])
        res = self.inter(left, right)
        swapped = self.inter(right, left)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res.get("schemaVersion"), 1)
        self.assertEqual(res.get("analysisVersion"), ANALYSIS)
        self.assertEqual(res.get("projectId"), "prj_123")
        self.assertIn("revisionBinding", res)
        self.assertTrue(res["writeExhaustive"])
        self.assertEqual(res["labelsEmitted"], ["write", "watch"])
        self.assertEqual(res["paths"], ["a.py", "b.py"])
        self.assertEqual(swapped["paths"], res["paths"])
        self.assertTrue(res["emptyIsNotNoConflict"])
        self.assertNotIn("conflict", res)
        self.assertNotIn("lock", res)
        self.assertNotIn("lease", res)

        case = self.inter(_base_scope(["A.py"]), _base_scope(["a.py"]))
        self.assertEqual(case["status"], "observed")
        self.assertEqual(case["paths"], [])

        right_wt = _base_scope(["a.py", "z.py", "b.py"], wt_id="d" * 64)
        res_wt = self.inter(left, right_wt)
        self.assertEqual(res_wt["status"], "observed")
        self.assertEqual(res_wt["paths"], ["a.py", "b.py"])

    def test_code_point_order_includes_non_ascii(self):
        left = _base_scope(["é.py", "a.py", "z.py"])
        right = _base_scope(["z.py", "é.py", "a.py"])
        res = self.inter(left, right)
        self.assertEqual(res["paths"], ["a.py", "z.py", "é.py"])
        self.assertEqual(self.inter(right, left)["paths"], res["paths"])

    def test_watch_overlap_does_not_enter_paths(self):
        left = _base_scope(["a.py"])
        right = _base_scope(["b.py"])
        left["watch"] = [{"path": "w.py", "source": "explicit_task_path"}]
        right["watch"] = [{"path": "w.py", "source": "explicit_task_path"}]
        res = self.inter(left, right)
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])

    def test_both_available_no_overlap_yields_empty_paths_flag(self):
        res = self.inter(_base_scope(["a.py"]), _base_scope(["b.py"]))
        self.assertEqual(res["status"], "observed")
        self.assertEqual(res.get("schemaVersion"), 1)
        self.assertEqual(res["paths"], [])
        self.assertTrue(res["emptyIsNotNoConflict"])
        self.assertNotIn("conflict", res)

    def test_empty_write_is_input_rejected(self):
        empty = _base_scope([])
        self._assert_refused(self.inter(empty, _base_scope([])), "input_rejected")
        self._assert_refused(self.inter(_base_scope(["g.py"]), empty), "input_rejected")
        self._assert_refused(self.inter(empty, _base_scope(["g.py"])), "input_rejected")

    def test_bad_write_entry_rejects_the_whole_side(self):
        good = _base_scope(["g.py"])
        wrong_source = _base_scope(["g.py"])
        wrong_source["write"][0]["source"] = "other"
        self._assert_refused(self.inter(good, wrong_source), "input_rejected")

        mixed = _base_scope(["g.py"])
        mixed["write"].append({"path": "", "source": "explicit_task_path"})
        self._assert_refused(self.inter(good, mixed), "input_rejected")
        self._assert_refused(self.inter(mixed, good), "input_rejected")

        missing_path = _base_scope(["g.py"])
        missing_path["write"] = [{"source": "explicit_task_path"}]
        self._assert_refused(self.inter(good, missing_path), "input_rejected")

    def test_observation_incomplete_true_with_available_is_input_incomplete(self):
        left = _base_scope(["g.py"])
        right = _base_scope(["g.py"], incomplete=True)
        self._assert_refused(self.inter(left, right), "input_incomplete")
        self._assert_refused(self.inter(right, left), "input_incomplete")

    def test_left_available_right_incomplete_yields_incomplete_no_paths(self):
        self._assert_refused(
            self.inter(_base_scope(), _base_scope(status="incomplete", write_ex=True)),
            "input_incomplete",
        )

    def test_left_incomplete_right_available_yields_incomplete_no_paths(self):
        self._assert_refused(
            self.inter(_base_scope(status="incomplete"), _base_scope()),
            "input_incomplete",
        )

    def test_incomplete_precedes_identity_mismatch(self):
        left = _base_scope(["g.py"], status="incomplete")
        right = _base_scope(["g.py"], project_id="other")
        self._assert_refused(self.inter(left, right), "input_incomplete")
        self._assert_refused(self.inter(right, left), "input_incomplete")

    def test_rejected_envelope_precedes_incomplete_and_identity(self):
        naked = {"status": "rejected"}
        good = _base_scope(["g.py"])
        incomplete = _base_scope(["g.py"], status="incomplete")
        self._assert_refused(self.inter(naked, good), "input_rejected")
        self._assert_refused(self.inter(good, naked), "input_rejected")
        self._assert_refused(self.inter(naked, incomplete), "input_rejected")
        self._assert_refused(self.inter(incomplete, naked), "input_rejected")
        self._assert_refused(self.inter(naked, naked), "input_rejected")

    def test_wrapper_ok_data_is_input_rejected(self):
        left = {"ok": True, "data": _base_scope(["x.js", "y.js"])}
        right = {"ok": True, "data": _base_scope(["y.js"])}
        self._assert_refused(self.inter(left, right), "input_rejected")
        other_error = {"ok": False, "error": "scope_foo", "status": "rejected"}
        self._assert_refused(self.inter(other_error, _base_scope()), "input_rejected")
        qualified_error = _base_scope(["g.py"])
        qualified_error["error"] = "scope_foo"
        self._assert_refused(self.inter(qualified_error, _base_scope(["g.py"])), "input_rejected")

    def test_scope_impact_not_evaluated_envelope_precedes_wrapper(self):
        envelope = {
            "ok": False,
            "error": "scope_impact_not_evaluated",
            "status": "rejected",
        }
        good = _base_scope(["g.py"])
        incomplete = _base_scope(["g.py"], status="incomplete")
        self._assert_refused(self.inter(envelope, good), "input_not_evaluated")
        self._assert_refused(self.inter(good, envelope), "input_not_evaluated")
        self._assert_refused(self.inter(envelope, incomplete), "input_not_evaluated")
        self._assert_refused(self.inter(incomplete, envelope), "input_not_evaluated")
        qualified = _base_scope(["g.py"])
        qualified["error"] = "scope_impact_not_evaluated"
        self._assert_refused(self.inter(qualified, good), "input_not_evaluated")
        self._assert_refused(self.inter(good, qualified), "input_not_evaluated")

    def test_not_evaluated_status_or_finding_state_precedes_later_gates(self):
        good = _base_scope(["g.py"])
        self._assert_refused(
            self.inter(_base_scope(["g.py"], status="not_evaluated"), good),
            "input_not_evaluated",
        )
        finding = _base_scope(["g.py"])
        finding["findingState"] = "not_evaluated"
        self._assert_refused(self.inter(finding, good), "input_not_evaluated")
        self._assert_refused(self.inter(good, finding), "input_not_evaluated")
        bare = {"findingState": "not_evaluated", "ok": True}
        self._assert_refused(self.inter(bare, good), "input_not_evaluated")

    def test_version_labels_and_revision_gates_are_input_rejected(self):
        good = _base_scope(["g.py"])
        self._assert_refused(
            self.inter(good, _base_scope(["g.py"], schema_version=2)),
            "input_rejected",
        )
        self._assert_refused(
            self.inter(
                good,
                _base_scope(["g.py"], analysis_version="effective-task-scope-v0"),
            ),
            "input_rejected",
        )
        self._assert_refused(
            self.inter(good, _base_scope(["g.py"], labels=["write"])),
            "input_rejected",
        )
        dirty = _base_scope(["g.py"])
        dirty["revisionBinding"]["dirty"] = True
        self._assert_refused(self.inter(good, dirty), "input_rejected")
        unlinked = _base_scope(["g.py"])
        unlinked["revisionBinding"]["isLinkedWorktree"] = False
        self._assert_refused(self.inter(good, unlinked), "input_rejected")
        rev_status = _base_scope(["g.py"])
        rev_status["revisionBinding"]["status"] = "incomplete"
        self._assert_refused(self.inter(good, rev_status), "input_rejected")
        left = _base_scope(["g.py"])
        right = _base_scope(["g.py"])
        left["revisionBinding"]["impactRepositoryId"] = "d" * 64
        right["revisionBinding"]["impactRepositoryId"] = "d" * 64
        self._assert_refused(self.inter(left, right), "input_rejected")

    def test_absent_ids_are_mismatch_not_observed(self):
        good = _base_scope(["g.py"])
        missing_project = _base_scope(["g.py"])
        missing_project.pop("projectId")
        other_missing_project = _base_scope(["g.py"])
        other_missing_project.pop("projectId")
        self._assert_refused(
            self.inter(missing_project, other_missing_project),
            "identity_mismatch",
        )
        self._assert_refused(self.inter(good, missing_project), "identity_mismatch")

        missing_commit = _base_scope(["g.py"])
        missing_commit["revisionBinding"].pop("commitSha")
        other_missing_commit = _base_scope(["g.py"])
        other_missing_commit["revisionBinding"].pop("commitSha")
        self._assert_refused(
            self.inter(missing_commit, other_missing_commit),
            "revision_mismatch",
        )
        self._assert_refused(self.inter(good, missing_commit), "revision_mismatch")

        missing_repo = _base_scope(["g.py"])
        missing_repo["revisionBinding"].pop("repositoryIdentity")
        other_missing_repo = _base_scope(["g.py"])
        other_missing_repo["revisionBinding"].pop("repositoryIdentity")
        # Gate 2: absent repositoryIdentity is not equal to impactRepositoryId.
        self._assert_refused(self.inter(missing_repo, other_missing_repo), "input_rejected")

    def test_present_identity_differences_are_mismatch(self):
        left = _base_scope(["g.py"])
        self._assert_refused(
            self.inter(left, _base_scope(["g.py"], project_id="other")),
            "identity_mismatch",
        )
        self._assert_refused(
            self.inter(left, _base_scope(["g.py"], commit="f" * 40)),
            "revision_mismatch",
        )
        self._assert_refused(
            self.inter(left, _base_scope(["g.py"], repo_id="e" * 64)),
            "revision_mismatch",
        )

    def test_non_qualifying_write_exhaustive_false_no_paths(self):
        self._assert_refused(
            self.inter(_base_scope(write_ex=False), _base_scope()),
            "input_incomplete",
        )

    def test_does_not_mutate_inputs(self):
        left = _base_scope(["p.py"])
        right = _base_scope(["p.py", "q.py"])
        lcopy = deepcopy(left)
        rcopy = deepcopy(right)
        self.inter(left, right)
        self.assertEqual(left, lcopy)
        self.assertEqual(right, rcopy)

    def test_non_dict_is_input_rejected(self):
        self._assert_refused(self.inter(None, _base_scope()), "input_rejected")
        self._assert_refused(self.inter("scope", _base_scope()), "input_rejected")


if __name__ == "__main__":
    unittest.main()
