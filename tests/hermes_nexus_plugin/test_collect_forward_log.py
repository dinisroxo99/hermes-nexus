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
import json
import os
import subprocess
import tempfile
from unittest.mock import patch

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

    def _collect_isolated(self, fields: dict[str, Any]) -> dict[str, Any]:
        """Every valid collect call uses its own temp DATA_DIR.
        Never writes the checkout data/ or ~/.hermes.
        Use explicit /tmp dir to avoid env TMPDIR under .hermes (which would trigger forbidden-sink).
        """
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            with patch.dict(os.environ, {"DATA_DIR": tmp}):
                return self.collect(fields)

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
        res = self._collect_isolated(_base_fields(nexus_tools=True))
        self.assertEqual(res["status"], "collected")
        self.assertEqual(res["nexusTools"], True)
        # False
        res = self._collect_isolated(_base_fields(nexus_tools=False))
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
        res = self._collect_isolated(f)
        self.assertEqual(res["status"], "collected")
        self.assertEqual(res["writePathCount"], 3)
        self.assertEqual(res["watchPathCount"], 1)

        f2 = _base_fields(write_paths=[], watch_paths=[])
        res2 = self._collect_isolated(f2)
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
        res = self._collect_isolated(f)
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
        res = self._collect_isolated(f)
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

    # D3 semantic coverage tests (replaces historical byte-hash pin at former :530)
    # All valid calls use isolated temp DATA_DIR.

    def test_persist_appends_exact_six_input_keys_as_jsonl(self):
        fields = _base_fields(
            run_id="run-42",
            profile="d3-tester",
            sha="cafef00d" * 5,
            nexus_tools=False,
            write_paths=["a/b/c.py", "a/b/c.py"],
            watch_paths=[],
        )
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            with patch.dict(os.environ, {"DATA_DIR": tmp}):
                res = self.collect(fields)
                self.assertEqual(res["status"], "collected")
                log_path = Path(tmp) / "collect-forward-log.jsonl"
                self.assertTrue(log_path.is_file())
                content = log_path.read_text(encoding="utf-8")
                lines = [ln for ln in content.splitlines() if ln.strip()]
                self.assertEqual(len(lines), 1)
                rec = json.loads(lines[0])
                self.assertEqual(
                    set(rec.keys()),
                    {"runId", "profile", "sha", "nexusTools", "writePaths", "watchPaths"},
                )
                self.assertEqual(rec["runId"], "run-42")
                self.assertEqual(rec["profile"], "d3-tester")
                self.assertEqual(rec["sha"], "cafef00d" * 5)
                self.assertIs(rec["nexusTools"], False)
                self.assertEqual(rec["writePaths"], ["a/b/c.py", "a/b/c.py"])
                self.assertEqual(rec["watchPaths"], [])
                # repeated calls append
                fields2 = _base_fields(
                    run_id="r2", profile="p2", sha="s2", nexus_tools=True, write_paths=[], watch_paths=["w"]
                )
                res2 = self.collect(fields2)
                self.assertEqual(res2["status"], "collected")
                lines2 = [ln for ln in log_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
                self.assertEqual(len(lines2), 2)
                rec2 = json.loads(lines2[1])
                self.assertEqual(rec2["runId"], "r2")
                self.assertEqual(rec2["writePaths"], [])
                self.assertEqual(rec2["watchPaths"], ["w"])

    def test_persist_preserves_closed_count_only_return(self):
        fields = _base_fields(write_paths=["p1", "p2"], watch_paths=["w"])
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            with patch.dict(os.environ, {"DATA_DIR": tmp}):
                res = self.collect(fields)
                self.assertEqual(res["status"], "collected")
                expected_keys = {
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
                self.assertEqual(set(res.keys()), expected_keys)
                self.assertNotIn("writePaths", res)
                self.assertNotIn("watchPaths", res)
                self.assertEqual(res["writePathCount"], 2)
                self.assertEqual(res["watchPathCount"], 1)

    def test_invalid_input_performs_no_persist_io(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            with patch.dict(os.environ, {"DATA_DIR": tmp}):
                log_path = Path(tmp) / "collect-forward-log.jsonl"
                self.assertFalse(log_path.exists())
                self._assert_refused(self.collect(None))
                self.assertFalse(log_path.exists())
                self._assert_refused(self.collect({"runId": "r"}))
                self.assertFalse(log_path.exists())
                f = _base_fields()
                f["writePaths"] = ["ok", ""]
                self._assert_refused(self.collect(f))
                self.assertFalse(log_path.exists())
                f = _base_fields(nexus_tools="yes")
                self._assert_refused(self.collect(f))
                self.assertFalse(log_path.exists())

    def _make_source_layout_fixture(self, *, pkg_name: str = "hermes-nexus", with_cfg: bool = True):
        """Temp source layout fixture for testing root resolution and unbound cases.
        Never touches real checkout data or ~/.hermes.
        """
        td = tempfile.TemporaryDirectory(dir="/tmp")
        root = Path(td.name)
        integ = root / "integrations" / "hermes-nexus"
        integ.mkdir(parents=True)
        fake_coll = integ / "collect_forward_log.py"
        fake_coll.write_text("# marker for __file__ only\n", encoding="utf-8")
        pkg = root / "package.json"
        pkg.write_text(json.dumps({"name": pkg_name}), encoding="utf-8")
        if with_cfg:
            cfgp = root / "src" / "lib" / "project-config.js"
            cfgp.parent.mkdir(parents=True, exist_ok=True)
            cfgp.write_text("// config marker\n", encoding="utf-8")
        return td, root, fake_coll

    def test_data_dir_override_and_source_root_default(self):
        # absolute override
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            abs_dd = str(Path(tmp) / "abs_d3")
            with patch.dict(os.environ, {"DATA_DIR": abs_dd}):
                res = self.collect(_base_fields(run_id="absd"))
                self.assertEqual(res["status"], "collected")
                self.assertTrue((Path(abs_dd) / "collect-forward-log.jsonl").exists())
        # relative + default via temp source layout fixture (avoids real data/)
        td, root, fake_coll = self._make_source_layout_fixture()
        try:
            coll_mod = importlib.import_module(self.plugin.__name__ + ".collect_forward_log")
            with patch.dict(os.environ, {"DATA_DIR": "relsub"}):
                with patch.object(coll_mod, "__file__", str(fake_coll)):
                    res = self.collect(_base_fields(run_id="reld"))
                    self.assertEqual(res["status"], "collected")
                    self.assertTrue((root / "relsub" / "collect-forward-log.jsonl").exists())
            # default (no DATA_DIR)
            with patch.dict(os.environ, {}, clear=True):
                with patch.object(coll_mod, "__file__", str(fake_coll)):
                    res = self.collect(_base_fields(run_id="defd"))
                    self.assertEqual(res["status"], "collected")
                    self.assertTrue((root / "data" / "collect-forward-log.jsonl").exists())
        finally:
            td.cleanup()

    def test_unbound_copy_and_forbidden_sink_fail_closed(self):
        # unbound layout without abs DATA_DIR -> raise (fail closed), no IO
        td, root, fake_coll = self._make_source_layout_fixture(pkg_name="not-hermes-nexus")
        try:
            coll_mod = importlib.import_module(self.plugin.__name__ + ".collect_forward_log")
            with patch.dict(os.environ, {}, clear=True):
                with patch.object(coll_mod, "__file__", str(fake_coll)):
                    with self.assertRaises(RuntimeError) as cm:
                        self.collect(_base_fields())
                    self.assertIn("unbound", str(cm.exception).lower())
        finally:
            td.cleanup()
        # abs DATA_DIR allows even unbound copy (no root guess)
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            abs_dd = str(Path(tmp) / "abs_unb")
            coll_mod = importlib.import_module(self.plugin.__name__ + ".collect_forward_log")
            with patch.dict(os.environ, {"DATA_DIR": abs_dd}):
                with patch.object(coll_mod, "__file__", "/fake/unbound/collect_forward_log.py"):
                    res = self.collect(_base_fields(run_id="unba"))
                    self.assertEqual(res["status"], "collected")
                    self.assertTrue((Path(abs_dd) / "collect-forward-log.jsonl").exists())
        # forbidden sink through .hermes raises before any write
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            bad = str(Path(tmp) / ".hermes" / "d3" / "data")
            with patch.dict(os.environ, {"DATA_DIR": bad}):
                with self.assertRaises(RuntimeError) as cm:
                    self.collect(_base_fields())
                self.assertIn("hermes", str(cm.exception).lower())

    def test_disk_failures_do_not_return_collected(self):
        with tempfile.TemporaryDirectory(dir="/tmp") as tmp:
            with patch.dict(os.environ, {"DATA_DIR": tmp}):
                with patch("pathlib.Path.mkdir", side_effect=PermissionError("disk mkdir")):
                    with self.assertRaises(PermissionError):
                        self.collect(_base_fields())
                with patch("builtins.open", side_effect=OSError("disk full")):
                    with self.assertRaises(OSError):
                        self.collect(_base_fields())

    def test_real_collector_git_default_dest_ignore_append_isolated(self):
        """Focused real collector + real git test per recon item 8.

        Uses candidate's real .gitignore (post /data/collect... rule), temp layout
        outside .hermes, real persistence (no mock of collector or jsonl), env isolation.
        __file__ is simulated only for collector layout verify (real write happens);
        boundary noted in handoff. This is not a live Hermes session.
        """
        # capture current worktree .gitignore content (has the exact rule)
        gitignore_src = Path(__file__).parents[2] / ".gitignore"
        gitignore_content = gitignore_src.read_text(encoding="utf-8")
        self.assertIn("/data/collect-forward-log.jsonl", gitignore_content)

        with tempfile.TemporaryDirectory(dir="/tmp", prefix="hn-recon-") as tmp:
            src = Path(tmp)
            # minimal valid source layout so collector _verify... passes using simulated __file__
            (src / "package.json").write_text('{"name": "hermes-nexus"}', encoding="utf-8")
            (src / "src" / "lib").mkdir(parents=True, exist_ok=True)
            (src / "src" / "lib" / "project-config.js").write_text("// stub for layout verify\n", encoding="utf-8")
            integ = src / "integrations" / "hermes-nexus"
            integ.mkdir(parents=True, exist_ok=True)
            coll_py = integ / "collect_forward_log.py"
            coll_py.write_text("# stub; __file__ points here for verify only\n", encoding="utf-8")
            # real .gitignore at repo root for git
            (src / ".gitignore").write_text(gitignore_content, encoding="utf-8")

            # isolated git + env
            home = src / "h"
            home.mkdir()
            base_env = {
                "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_CONFIG_SYSTEM": "/dev/null",
                "HOME": str(home),
                "PATH": os.environ.get("PATH", ""),
                # ensure no DATA_DIR leaks to trigger default
                "DATA_DIR": "",
            }

            def _git(args, cwd=src, env=None):
                e = dict(base_env)
                if env:
                    e.update(env)
                cp = subprocess.run(["git"] + list(args), cwd=cwd, env=e, capture_output=True, text=True)
                if cp.returncode != 0:
                    raise AssertionError(f"git {args} failed: {cp.stderr}")
                return cp

            _git(["init", "-q"])
            _git(["config", "user.email", "t@example"])
            _git(["config", "user.name", "t"])
            # commit the layout stubs + .gitignore so initial state clean (stubs required only for __file__ verify)
            _git(["add", ".gitignore", "package.json", "src/lib/project-config.js", "integrations/hermes-nexus/collect_forward_log.py"])
            _git(["commit", "-q", "-m", "init"])
            self.assertEqual(_git(["status", "--porcelain"]).stdout.strip(), "")

            # load the collect module and simulate __file__ (real I/O still occurs)
            collect_mod = importlib.import_module(self.plugin.__name__ + ".collect_forward_log")
            orig_file = getattr(collect_mod, "__file__", None)
            try:
                collect_mod.__file__ = str(coll_py)
                fields = _base_fields(
                    run_id="run-g1",
                    profile="impl",
                    sha="643eb3ab6433389f99264bc2b0a1aff7389ddc5d",
                    nexus_tools=True,
                    write_paths=[".gitignore"],
                    watch_paths=["AGENTS.md"],
                )
                # call with empty DATA_DIR (no patch override)
                with patch.dict(os.environ, {"DATA_DIR": ""}, clear=False):
                    res = self.collect(fields)
                jsonl = src / "data" / "collect-forward-log.jsonl"
                self.assertTrue(jsonl.is_file(), "real jsonl must be written")
                txt = jsonl.read_text(encoding="utf-8")
                self.assertIn('"runId": "run-g1"', txt)
                self.assertIn('"writePaths"', txt)
                self.assertIn('"watchPaths"', txt)
                # exactly the six keys in the persisted record
                rec = json.loads(txt.strip().splitlines()[0])
                for k in ("runId", "profile", "sha", "nexusTools", "writePaths", "watchPaths"):
                    self.assertIn(k, rec)
                # count-only return preserved
                self.assertEqual(res.get("status"), "collected")
                self.assertEqual(res.get("writePathCount"), 1)
                self.assertEqual(res.get("watchPathCount"), 1)

                # jsonl ignored by the real .gitignore rule
                chk = subprocess.run(
                    ["git", "check-ignore", "-q", "data/collect-forward-log.jsonl"],
                    cwd=src, env=base_env, capture_output=True
                )
                self.assertEqual(chk.returncode, 0)
                self.assertEqual(_git(["ls-files", "data/collect-forward-log.jsonl"]).stdout.strip(), "")

                # second append preserves prior content
                fields2 = _base_fields(run_id="run-g2", profile="impl2", sha="deadbeef", write_paths=["x"], watch_paths=[])
                with patch.dict(os.environ, {"DATA_DIR": ""}, clear=False):
                    res2 = self.collect(fields2)
                txt2 = jsonl.read_text(encoding="utf-8")
                self.assertIn("run-g1", txt2)
                self.assertIn("run-g2", txt2)
                self.assertEqual(txt2.count("\n"), 2)

                # unrelated other file remains visible untracked
                (src / "other-unrelated.txt").write_text("u")
                st = _git(["status", "--porcelain"]).stdout
                self.assertIn("?? other-unrelated.txt", st)

                # another jsonl is NOT generically ignored
                (src / "data" / "other-log.jsonl").write_text("{}\n")
                chk3 = subprocess.run(
                    ["git", "check-ignore", "-q", "data/other-log.jsonl"],
                    cwd=src, env=base_env, capture_output=True
                )
                self.assertNotEqual(chk3.returncode, 0)

                # change to a tracked file remains dirty
                (src / ".gitignore").write_text(gitignore_content + "\n# touch\n", encoding="utf-8")
                st2 = _git(["status", "--porcelain"]).stdout
                self.assertIn(" M .gitignore", st2)
            finally:
                if orig_file is not None:
                    collect_mod.__file__ = orig_file


import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch


class CallerTests(unittest.TestCase):
    """In-memory caller tests for _collect_forward_after_accepted per contract.
    Must run via the named discover command; keeps collector tests.
    """

    def setUp(self):
        self.plugin = _load_package()
        self.tools = importlib.import_module(self.plugin.__name__ + ".tools")
        # ensure fresh client each subtest
        self.orig_nexus = getattr(self.tools, "NexusClient", None)

    def tearDown(self):
        if self.orig_nexus is not None:
            self.tools.NexusClient = self.orig_nexus

    def _mk_accepted_context_result(self, sha="c" * 40, paths=None):
        if paths is None:
            paths = ["src/a.py"]
        return {
            "tool": "project_task_context",
            "ok": True,
            "data": {
                "schemaVersion": 1,
                "analysisVersion": "task-context-v1",
                "projectId": "prj_x",
                "revision": {
                    "status": "available",
                    "commitSha": sha,
                    "branch": "feat/x",
                    "dirty": False,
                    "isLinkedWorktree": True,
                },
                "sections": {"task": {"items": [{"paths": paths}]}},
            },
            "message": "ok",
        }

    def _mk_accepted_impact_result(self, sha="d" * 40):
        return {
            "tool": "project_impact",
            "ok": True,
            "data": {
                "schemaVersion": 1,
                "analysisVersion": "impact-v2",
                "projectId": "prj_x",
                "revision": {
                    "status": "available",
                    "commitSha": sha,
                    "branch": "feat/x",
                    "repositoryId": "a" * 64,
                    "worktreeId": "b" * 64,
                    "dirty": False,
                    "isLinkedWorktree": True,
                },
                "status": "available",
                "findingState": "evidence_found",
                "affectedFiles": [{"path": "other.js"}],
            },
            "message": "ok",
        }

    def _mk_pack(self, paths=None):
        if paths is None:
            paths = ["f.py"]
        return {
            "ok": True,
            "data": {
                "schemaVersion": 1,
                "analysisVersion": "task-context-v1",
                "projectId": "p1",
                "project": {"rootId": "local", "relativePath": "w"},
                "revision": {
                    "status": "available",
                    "commitSha": "e" * 40,
                    "branch": "b",
                    "dirty": False,
                    "isLinkedWorktree": True,
                    "worktreeId": "a" * 64,
                    "repositoryIdentity": "b" * 64,
                },
                "sections": {"task": {"items": [{"id": "t1", "title": "T", "paths": paths, "symbols": []}]}},
                "observation": {"incomplete": False},
            },
        }

    def _mk_impact(self, paths=None, finding="evidence_found", status="available"):
        if paths is None:
            paths = ["f.py"]
        return {
            "ok": True,
            "data": {
                "schemaVersion": 1,
                "analysisVersion": "impact-v2",
                "projectId": "p1",
                "project": {"rootId": "local", "relativePath": "w"},
                "revision": {
                    "status": "available",
                    "commitSha": "e" * 40,
                    "branch": "b",
                    "dirty": False,
                    "isLinkedWorktree": True,
                    "worktreeId": "a" * 64,
                    "repositoryId": "b" * 64,
                },
                "status": status,
                "findingState": finding,
                "targets": [{"originPath": p} for p in paths],
                "observation": {"incomplete": False},
                "completeness": {"source": [], "provider": [], "traversal": [], "output": []},
                "affectedFiles": [],
            },
        }

    def test_1_accepted_context_calls_collect_with_exact_six_keys(self):
        tools = self.tools
        ctx_args = {
            "projectId": "p",
            "worktree": {"rootId": "local", "relativePath": "w"},
            "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True},
            "task": {"title": "t", "paths": ["src/a.py", "src/a.py", "src/b.py"]},
        }
        result = self._mk_accepted_context_result(sha="c"*40, paths=["src/a.py", "src/a.py", "src/b.py"])
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                handler = tools.create_handlers("http://127.0.0.1:1")[0]
                out = asyncio.run(handler(ctx_args, runId="run-123", profile="impl"))
                out_d = json.loads(out)
                self.assertTrue(out_d["ok"])
                self.assertEqual(mock_c.call_count, 1)
                fields = mock_c.call_args[0][0]
                self.assertEqual(set(fields.keys()), {"runId", "profile", "sha", "nexusTools", "writePaths", "watchPaths"})
                self.assertEqual(fields["runId"], "run-123")
                self.assertEqual(fields["profile"], "impl")
                self.assertEqual(fields["sha"], "c"*40)
                self.assertTrue(fields["nexusTools"])
                self.assertEqual(fields["writePaths"], ["src/a.py", "src/a.py", "src/b.py"])  # copy, order, dups
                self.assertEqual(fields["watchPaths"], [])
                # tool json unchanged
                self.assertIn("ok", out_d)
                self.assertTrue(out_d["ok"])

    def test_2_accepted_impact_calls_once_true_write_watch_empty(self):
        tools = self.tools
        imp_args = {
            "projectId": "p",
            "worktree": {"rootId": "local", "relativePath": "w"},
            "expectedRevision": {"status": "available", "commitSha": "d"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True, "repositoryId": "a"*64, "worktreeId": "b"*64},
            "paths": ["x/y.js"],
        }
        result = self._mk_accepted_impact_result(sha="d"*40)
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                handler = tools.create_handlers("http://127.0.0.1:1")[1]
                out = asyncio.run(handler(imp_args, runId="r2", profile="p2"))
                out_d = json.loads(out)
                self.assertTrue(out_d.get("ok"))
                self.assertEqual(mock_c.call_count, 1)
                fields = mock_c.call_args[0][0]
                self.assertTrue(fields["nexusTools"])
                self.assertEqual(fields["writePaths"], [])
                self.assertEqual(fields["watchPaths"], [])
                self.assertEqual(fields["sha"], "d"*40)
                # request paths and affected not copied
                self.assertNotIn("x/y.js", str(fields))

    def test_3_accepted_ets_incomplete_calls_with_nexusTools_false(self):
        tools = self.tools
        pack, impact = self._mk_pack(["w.py", "w.py"]), self._mk_impact(["w.py", "w.py"])
        # force incomplete by not passing includeTests (treated False)
        scope_args = {"pack": pack, "impact": impact}
        with patch.object(tools, "collect_forward_log") as mock_c:
            scope_h = tools.create_scope_handler()
            out = asyncio.run(scope_h(scope_args, runId="r3", profile="p3"))
            out_d = json.loads(out)
            self.assertEqual(out_d.get("analysisVersion"), "effective-task-scope-v1")
            self.assertIn(out_d.get("status"), ("available", "incomplete"))
            self.assertEqual(mock_c.call_count, 1)
            fields = mock_c.call_args[0][0]
            self.assertFalse(fields["nexusTools"])
            self.assertEqual(fields["sha"], "e"*40)
            self.assertEqual(fields["writePaths"], ["w.py", "w.py"])  # order dups
            self.assertEqual(fields["watchPaths"], [])

    def test_4_ets_reject_does_not_call(self):
        tools = self.tools
        pack, impact = self._mk_pack(), self._mk_impact(finding="not_evaluated", status="partial")
        scope_args = {"pack": pack, "impact": impact}
        with patch.object(tools, "collect_forward_log") as mock_c:
            scope_h = tools.create_scope_handler()
            out = asyncio.run(scope_h(scope_args, runId="r4", profile="p4"))
            out_d = json.loads(out)
            self.assertEqual(out_d.get("status"), "rejected")
            self.assertEqual(mock_c.call_count, 0)

    def test_5_missing_or_blank_runid_profile_skips_even_with_task_session(self):
        tools = self.tools
        ctx_args = {
            "projectId": "p",
            "worktree": {"rootId": "local", "relativePath": "w"},
            "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True},
            "task": {"title": "t", "paths": ["ok.py"]},
        }
        result = self._mk_accepted_context_result()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    # has task_id etc but no run/profile
                    out = asyncio.run(handler(ctx_args, task_id="t1", session_id="s1", user_task="u"))
                    self.assertEqual(mock_c.call_count, 0)
                    out_d = json.loads(out)
                    self.assertTrue(out_d["ok"])
                    # blank
                    out2 = asyncio.run(handler(ctx_args, runId="   ", profile="p"))
                    self.assertEqual(mock_c.call_count, 0)

    def test_6_context_without_task_paths_or_bad_path_skips(self):
        tools = self.tools
        result = self._mk_accepted_context_result(paths=["ok"])
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                handler = tools.create_handlers("http://127.0.0.1:1")[0]
                # no task key -> validate fail for context (still no collect)
                args1 = {"projectId": "p", "worktree": {"rootId": "local", "relativePath": "w"}, "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True}, "task": {"title": "t"}}
                asyncio.run(handler(args1, runId="r", profile="p"))
                self.assertEqual(mock_c.call_count, 0)
                # task but no paths key -> reaches success, helper skips
                args2 = {"projectId": "p", "worktree": {"rootId": "local", "relativePath": "w"}, "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True}, "task": {"title": "t"}}
                asyncio.run(handler(args2, runId="r", profile="p"))
                self.assertEqual(mock_c.call_count, 0)
                # bad path in list -> skip in helper
                args3 = {"projectId": "p", "worktree": {"rootId": "local", "relativePath": "w"}, "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True}, "task": {"title": "t", "paths": ["ok", ""]}}
                asyncio.run(handler(args3, runId="r", profile="p"))
                self.assertEqual(mock_c.call_count, 0)

    def test_7_client_error_invalid_args_cancelled_do_not_call_collect(self):
        tools = self.tools
        handler = tools.create_handlers("http://127.0.0.1:1")[0]
        with patch.object(tools, "collect_forward_log") as mock_c:
            # invalid args -> failure without client
            bad = {"foo": 1}
            out = asyncio.run(handler(bad, runId="r", profile="p"))
            out_d = json.loads(out)
            self.assertFalse(out_d["ok"])
            self.assertEqual(mock_c.call_count, 0)
            # client error
            with patch.object(tools, "NexusClient") as mock_cls:
                mock_inst = MagicMock()
                mock_inst.request = AsyncMock(side_effect=tools.NexusClientError("nexus_timeout", "transport"))
                mock_cls.return_value = mock_inst
                out2 = asyncio.run(handler({"projectId": "p", "worktree": {"rootId": "local", "relativePath": "w"}, "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True}, "task": {"title": "t", "paths": ["a"]}}, runId="r", profile="p"))
                out2d = json.loads(out2)
                self.assertFalse(out2d.get("ok", True))
                self.assertEqual(mock_c.call_count, 0)
        # cancelled must propagate, no collect
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            async def raise_cancel(*a, **k):
                raise asyncio.CancelledError()
            mock_inst.request = raise_cancel
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with self.assertRaises(asyncio.CancelledError):
                    asyncio.run(handler({"projectId": "p", "worktree": {"rootId": "local", "relativePath": "w"}, "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True}, "task": {"title": "t", "paths": ["a"]}}, runId="r", profile="p"))
                self.assertEqual(mock_c.call_count, 0)

    def test_8_collect_raises_still_returns_accepted_tool_json(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log", side_effect=RuntimeError("boom")) as mock_c:
                handler = tools.create_handlers("http://127.0.0.1:1")[0]
                out = asyncio.run(handler({"projectId": "p", "worktree": {"rootId": "local", "relativePath": "w"}, "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True}, "task": {"title": "t", "paths": ["a.py"]}}, runId="r", profile="p"))
                out_d = json.loads(out)
                self.assertTrue(out_d["ok"])
                self.assertEqual(mock_c.call_count, 1)

    def test_9_no_open_of_paths_no_new_file(self):
        tools = self.tools
        result = self._mk_accepted_context_result(paths=["/tmp/should_not_open.txt"])
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch("builtins.open") as mock_open:
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler({"projectId": "p", "worktree": {"rootId": "local", "relativePath": "w"}, "expectedRevision": {"status": "available", "commitSha": "c"*40, "branch": "f", "dirty": False, "isLinkedWorktree": True}, "task": {"title": "t", "paths": ["/tmp/should_not_open.txt"]}}, runId="r", profile="p"))
                    self.assertEqual(mock_open.call_count, 0)
                    self.assertEqual(mock_c.call_count, 1)

    def test_10_provides_tools_unchanged(self):
        # collector byte-hash replaced by semantic D3 coverage (the named tests below).
        # provides_tools pin retained exactly.
        plug_path = PLUGIN_DIR / "plugin.yaml"
        with open(plug_path) as f:
            lines = f.readlines()
        names = []
        for i, line in enumerate(lines):
            if line.strip() == "provides_tools:":
                for j in range(i + 1, len(lines)):
                    l = lines[j]
                    if l.startswith("  - "):
                        name = l[4:].strip()
                        if name:
                            names.append(name)
                    else:
                        break
                break
        prov = names
        self.assertEqual(prov, ["project_task_context", "project_impact"])
        self.assertEqual(len(prov), 2)

    def test_disk_failure_preserves_exact_accepted_tool_json(self):
        # disk failure inside collect must still let caller return the exact accepted tool result
        # (existing isolation in tools.py; this named test adds explicit disk case)
        tools = self.tools
        result = self._mk_accepted_context_result()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log", side_effect=OSError("disk full on jsonl append")) as mock_c:
                handler = tools.create_handlers("http://127.0.0.1:1")[0]
                out = asyncio.run(
                    handler(
                        {
                            "projectId": "p",
                            "worktree": {"rootId": "local", "relativePath": "w"},
                            "expectedRevision": {
                                "status": "available",
                                "commitSha": "c" * 40,
                                "branch": "f",
                                "dirty": False,
                                "isLinkedWorktree": True,
                            },
                            "task": {"title": "t", "paths": ["a.py"]},
                        },
                        runId="r",
                        profile="p",
                    )
                )
                out_d = json.loads(out)
                self.assertTrue(out_d["ok"])
                self.assertEqual(mock_c.call_count, 1)

    # --- mapping cases for ordered runId/profile resolution (hermetic env) ---

    def _mk_ctx(self):
        return {
            "projectId": "p",
            "worktree": {"rootId": "local", "relativePath": "w"},
            "expectedRevision": {"status": "available", "commitSha": "c" * 40, "branch": "f", "dirty": False, "isLinkedWorktree": True},
            "task": {"title": "t", "paths": ["a.py"]},
        }

    def test_mapping_profile_kwargs_wins(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "env-p", "HERMES_KANBAN_RUN_ID": "env-r"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx, runId="kw-r", profile="kw-p"))
                    self.assertEqual(mock_c.call_count, 1)
                    f = mock_c.call_args[0][0]
                    self.assertEqual(f["runId"], "kw-r")
                    self.assertEqual(f["profile"], "kw-p")

    def test_mapping_fallback_to_env(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "env-prof", "HERMES_KANBAN_RUN_ID": "env-rid"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx))  # absent in kwargs
                    self.assertEqual(mock_c.call_count, 1)
                    f = mock_c.call_args[0][0]
                    self.assertEqual(f["runId"], "env-rid")
                    self.assertEqual(f["profile"], "env-prof")

    def test_mapping_runid_from_session_id(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "p"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx, profile="p", session_id="sess-123"))
                    self.assertEqual(mock_c.call_count, 1)
                    self.assertEqual(mock_c.call_args[0][0]["runId"], "sess-123")

    def test_mapping_runid_from_task_id_fallback(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "p"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx, profile="p", task_id="task-456"))
                    self.assertEqual(mock_c.call_count, 1)
                    self.assertEqual(mock_c.call_args[0][0]["runId"], "task-456")

    def test_mapping_session_id_wins_over_task_id(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "p"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx, profile="p", session_id="s-win", task_id="t-lose"))
                    self.assertEqual(mock_c.call_count, 1)
                    self.assertEqual(mock_c.call_args[0][0]["runId"], "s-win")

    def test_mapping_hermes_kanban_run_id_wins(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "p", "HERMES_KANBAN_RUN_ID": "kan-run"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx, profile="p", session_id="s", task_id="t"))
                    self.assertEqual(mock_c.call_count, 1)
                    self.assertEqual(mock_c.call_args[0][0]["runId"], "kan-run")

    def test_mapping_unresolved_identity_skips_collect(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    # no profile at all
                    out = asyncio.run(handler(ctx, session_id="s123", task_id="t456"))
                    self.assertEqual(mock_c.call_count, 0)
                    # blank runId still skips
                    out2 = asyncio.run(handler(ctx, runId="   ", profile="p"))
                    self.assertEqual(mock_c.call_count, 0)

    # --- native profile resolution via HOME / __file__ (exact layouts only) ---

    def _assert_six_keys(self, fields):
        self.assertEqual(set(fields.keys()), {"runId", "profile", "sha", "nexusTools", "writePaths", "watchPaths"})

    def test_profile_via_kwargs_wins_over_env_and_inferences(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "env-p", "HERMES_HOME": "/x/profiles/inf-p", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/x/profiles/inf-p/plugins/hermes-nexus/integrations/hermes-nexus/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx, profile="kw-p"))
                        self.assertEqual(mock_c.call_count, 1)
                        f = mock_c.call_args[0][0]
                        self.assertEqual(f["profile"], "kw-p")
                        self._assert_six_keys(f)

    def test_profile_via_HERMES_PROFILE(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "env-prof", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/tmp/unrelated/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 1)
                        f = mock_c.call_args[0][0]
                        self.assertEqual(f["profile"], "env-prof")
                        self._assert_six_keys(f)

    def test_profile_via_HERMES_HOME_exact_layout(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_HOME": "/home/dinis/.hermes/profiles/home-prof", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/tmp/unrelated/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 1)
                        f = mock_c.call_args[0][0]
                        self.assertEqual(f["profile"], "home-prof")
                        self._assert_six_keys(f)

    def test_profile_via___file___exact_layout(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/home/dinis/.hermes/profiles/file-prof/plugins/hermes-nexus/integrations/hermes-nexus/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 1)
                        f = mock_c.call_args[0][0]
                        self.assertEqual(f["profile"], "file-prof")
                        self._assert_six_keys(f)

    def test_profile_via___file___flat_installed_layout(self):
        """Flat contract layout: .../profiles/<name>/plugins/hermes-nexus/tools.py (no nested integrations)
        must succeed with runId present, no other profile sources.
        """
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/home/dinis/.hermes/profiles/flat-prof/plugins/hermes-nexus/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 1)
                        f = mock_c.call_args[0][0]
                        self.assertEqual(f["profile"], "flat-prof")
                        self._assert_six_keys(f)

    def test_kwargs_profile_wins_despite_HOME___file___conflict(self):
        """kwargs.profile (and runId) must win and collect even if HOME and __file__ conflict."""
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_HOME": "/x/profiles/home-p", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/x/profiles/file-p/plugins/hermes-nexus/integrations/hermes-nexus/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx, profile="kw-p"))
                        self.assertEqual(mock_c.call_count, 1)
                        f = mock_c.call_args[0][0]
                        self.assertEqual(f["profile"], "kw-p")
                        self._assert_six_keys(f)

    def test_HERMES_PROFILE_wins_despite_HOME___file___conflict(self):
        """HERMES_PROFILE (and runId) must win and collect even if HOME and __file__ conflict."""
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "env-p", "HERMES_HOME": "/x/profiles/home-p", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/x/profiles/file-p/plugins/hermes-nexus/integrations/hermes-nexus/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 1)
                        f = mock_c.call_args[0][0]
                        self.assertEqual(f["profile"], "env-p")
                        self._assert_six_keys(f)

    def test_HOME___file___conflict_skips_when_no_kwargs_or_HERMES_PROFILE(self):
        """With runId present but no kwargs.profile and no HERMES_PROFILE, conflicting HOME/__file__ must skip."""
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_HOME": "/x/profiles/home-p", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/x/profiles/file-p/plugins/hermes-nexus/integrations/hermes-nexus/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 0)

    def test_relative_HERMES_HOME_literal_parent_not_profiles_skips(self):
        """Relative HERMES_HOME whose .parent.name != 'profiles' must skip (no cwd inference, no resolve).
        Even if cwd basename looks like profiles.
        """
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_HOME": "rel-prof", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    with patch("os.getcwd", return_value="/tmp/some/profiles"):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 0)

    def test_absolute_symlink_literal_parent_not_profiles_skips(self):
        """Absolute path whose literal parent.name != 'profiles' (e.g. symlink path) must skip;
        do not follow to target or persist target name.
        """
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_HOME": "/tmp/symlink-to-profiles/prof", "HERMES_KANBAN_RUN_ID": "r"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx))
                    self.assertEqual(mock_c.call_count, 0)

    def test_HERMES_HOME_vs___file___conflict_skips_collect(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_HOME": "/x/profiles/home-p"}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/x/profiles/file-p/plugins/hermes-nexus/integrations/hermes-nexus/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 0)

    def test_invalid_HERMES_HOME_layout_skips(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_HOME": "/not/profiles/layout"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx))
                    self.assertEqual(mock_c.call_count, 0)

    def test_invalid___file___layout_skips(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/wrong/layout/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 0)

    def test_no_profile_source_skips_collect(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {}, clear=True):
                    with patch.dict(tools.__dict__, {"__file__": "/tmp/other/tools.py"}):
                        handler = tools.create_handlers("http://127.0.0.1:1")[0]
                        out = asyncio.run(handler(ctx))
                        self.assertEqual(mock_c.call_count, 0)

    def test_runId_precedence_preserved_and_six_keys(self):
        tools = self.tools
        result = self._mk_accepted_context_result()
        ctx = self._mk_ctx()
        with patch.object(tools, "NexusClient") as mock_cls:
            mock_inst = MagicMock()
            mock_inst.request = AsyncMock(return_value=result)
            mock_cls.return_value = mock_inst
            with patch.object(tools, "collect_forward_log") as mock_c:
                with patch.dict(os.environ, {"HERMES_PROFILE": "p", "HERMES_KANBAN_RUN_ID": "kan-run"}, clear=True):
                    handler = tools.create_handlers("http://127.0.0.1:1")[0]
                    out = asyncio.run(handler(ctx, session_id="s", task_id="t"))
                    self.assertEqual(mock_c.call_count, 1)
                    f = mock_c.call_args[0][0]
                    self.assertEqual(f["runId"], "kan-run")
                    self.assertEqual(f["profile"], "p")
                    self._assert_six_keys(f)


if __name__ == "__main__":
    unittest.main()

