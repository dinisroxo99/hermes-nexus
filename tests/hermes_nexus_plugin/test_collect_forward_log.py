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

    def test_10_shas_and_provides_tools_unchanged(self):
        # verify pins after all caller work (run via named cmd which also runs test_tools)
        import hashlib
        coll_path = PLUGIN_DIR / "collect_forward_log.py"
        with open(coll_path, "rb") as f:
            csha = hashlib.sha256(f.read()).hexdigest()
        self.assertEqual(csha, "deba50d7418ccd520655fca1d7e06c75953a8fd30b4961bcdb55174f2949f94f")
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


if __name__ == "__main__":
    unittest.main()
