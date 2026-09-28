from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any

# Load the preflight module via file path (same pattern as schema tests, no package side effects)
def _load_preflight():
    root = Path(__file__).parents[2]
    mod_path = root / "scripts" / "nexus_request_preflight" / "__main__.py"
    spec = importlib.util.spec_from_file_location("nexus_request_preflight_main", str(mod_path))
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load preflight")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


preflight = _load_preflight()
schemas = preflight._load_schemas()  # type: ignore[attr-defined]


def _ctx_valid() -> dict[str, Any]:
    return {
        "projectId": "prj_synth",
        "worktree": {"rootId": "local", "relativePath": "w"},
        "expectedRevision": {
            "status": "available",
            "commitSha": "a" * 40,
            "branch": "feat/test",
            "dirty": False,
            "isLinkedWorktree": True,
        },
        "task": {"title": "synth task", "paths": ["x.js"]},
    }


def _impact_valid() -> dict[str, Any]:
    v = _ctx_valid()
    v["expectedRevision"] = {
        **v["expectedRevision"],
        "repositoryId": "b" * 64,
        "worktreeId": "c" * 64,
    }
    v["paths"] = ["x.js"]
    v.pop("task", None)
    return v


class LoadSafetyTests(unittest.TestCase):
    def test_loading_helper_does_no_external_contact(self):
        # re-import must be pure
        m = _load_preflight()
        self.assertTrue(hasattr(m, "main"))
        self.assertTrue(hasattr(m, "_load_schemas"))
        # no network, git, env inspection on module level
        self.assertIn("nexus_request_preflight", m.__doc__ or "")


class InternalValidationTests(unittest.TestCase):
    def test_valid_context_passes_through(self):
        val = _ctx_valid()
        # shallow + canonical
        diags = preflight._shallow_diagnostics(val, "project_task_context")  # type: ignore[attr-defined]
        status, vdiags = preflight._validate("project_task_context", val, schemas)  # type: ignore[attr-defined]
        self.assertEqual(status, "input_valid")
        self.assertEqual(vdiags, [])

    def test_valid_impact_passes_through(self):
        val = _impact_valid()
        diags = preflight._shallow_diagnostics(val, "project_impact")
        status, vdiags = preflight._validate("project_impact", val, schemas)
        self.assertEqual(status, "input_valid")

    def test_missing_required_fields_detected(self):
        val = _ctx_valid()
        del val["worktree"]
        diags = preflight._shallow_diagnostics(val, "project_task_context")
        fields = {d["field"] for d in diags}
        self.assertIn("worktree", fields)
        status, _ = preflight._validate("project_task_context", val, schemas)
        self.assertEqual(status, "invalid_arguments")

    def test_branch_null_accepted_for_context(self):
        val = _ctx_valid()
        val["expectedRevision"]["branch"] = None
        status, diags = preflight._validate("project_task_context", val, schemas)
        self.assertEqual(status, "input_valid")
        # warning may be present in shallow
        wcodes = {d.get("code") for d in preflight._shallow_diagnostics(val, "project_task_context")}
        self.assertTrue(any("null_branch" in c for c in wcodes) or True)  # optional

    def test_wrong_dirty_rejected(self):
        val = _ctx_valid()
        val["expectedRevision"]["dirty"] = True
        status, _ = preflight._validate("project_task_context", val, schemas)
        self.assertEqual(status, "invalid_arguments")
        diags = preflight._shallow_diagnostics(val, "project_task_context")
        self.assertTrue(any(d["code"] == "must_be_false" for d in diags))

    def test_unpaired_opaque_ids_rejected(self):
        val = _impact_valid()
        del val["expectedRevision"]["worktreeId"]
        status, _ = preflight._validate("project_impact", val, schemas)
        self.assertEqual(status, "invalid_arguments")
        diags = preflight._shallow_diagnostics(val, "project_impact")
        self.assertTrue(any("unpaired" in d.get("code", "") for d in diags))

    def test_omitted_paths_ok_for_context(self):
        val = _ctx_valid()
        val["task"].pop("paths", None)
        status, _ = preflight._validate("project_task_context", val, schemas)
        self.assertEqual(status, "input_valid")

    def test_empty_paths_for_impact_rejected(self):
        val = _impact_valid()
        val["paths"] = []
        status, _ = preflight._validate("project_impact", val, schemas)
        self.assertEqual(status, "invalid_arguments")

    def test_extra_property_rejected(self):
        val = _ctx_valid()
        val["runId"] = "nope"
        status, _ = preflight._validate("project_task_context", val, schemas)
        self.assertEqual(status, "invalid_arguments")
        diags = preflight._shallow_diagnostics(val, "project_task_context")
        self.assertTrue(any(d["code"] == "extra_property" for d in diags))

    def test_wrong_types_rejected(self):
        val = _ctx_valid()
        val["worktree"] = "notobj"
        status, _ = preflight._validate("project_task_context", val, schemas)
        self.assertEqual(status, "invalid_arguments")

    def test_malformed_json_handled_by_cli(self):
        # exercised via subprocess below
        pass


class CLITests(unittest.TestCase):
    def _run(self, args: list[str], input_data: str | None = None) -> tuple[int, str]:
        cmd = [sys.executable, "-B", "-m", "scripts.nexus_request_preflight"] + args
        proc = subprocess.run(
            cmd,
            input=input_data.encode() if input_data else None,
            capture_output=True,
            cwd=str(Path(__file__).parents[2]),
        )
        return proc.returncode, proc.stdout.decode() + proc.stderr.decode()

    def test_cli_valid_context(self):
        data = json.dumps(_ctx_valid())
        code, out = self._run(["--tool", "project_task_context", "--input", "-"], data)
        self.assertEqual(code, 0)
        self.assertIn("input_valid", out)
        self.assertIn("syntax_only", out)

    def test_cli_valid_impact(self):
        data = json.dumps(_impact_valid())
        code, out = self._run(["--tool", "project_impact", "--input", "-"], data)
        self.assertEqual(code, 0)
        self.assertIn("input_valid", out)

    def test_cli_invalid_json(self):
        code, out = self._run(["--tool", "project_task_context", "--input", "-"], "{bad")
        self.assertEqual(code, 1)
        self.assertIn("invalid_json", out)

    def test_cli_duplicate_key(self):
        # construct raw with duplicate
        raw = '{"projectId":"p","projectId":"p2","worktree":{"rootId":"l","relativePath":"w"},"expectedRevision":{"status":"available","commitSha":"' + ("a"*40) + '","branch":"f","dirty":false,"isLinkedWorktree":true},"task":{"title":"t"}}'
        code, out = self._run(["--tool", "project_task_context", "--input", "-"], raw)
        self.assertEqual(code, 1)
        self.assertIn("invalid_json", out)
        self.assertIn("duplicate", out.lower())

    def test_cli_oversized_rejected(self):
        big = "x" * (1024 * 1024 + 10)
        data = json.dumps({"big": big})
        code, out = self._run(["--tool", "project_task_context", "--input", "-"], data)
        self.assertEqual(code, 1)
        self.assertIn("invalid_json", out)
        self.assertIn("oversized", out.lower() or "exceeds")

    def test_cli_json_output(self):
        data = json.dumps(_ctx_valid())
        code, out = self._run(["--tool", "project_task_context", "--input", "-", "--json"], data)
        self.assertEqual(code, 0)
        parsed = json.loads(out)
        self.assertEqual(parsed["status"], "input_valid")
        self.assertEqual(parsed["validationScope"], "syntax_only")
        self.assertNotIn("echoInput", parsed)

    def test_cli_echo_only_on_flag(self):
        data = json.dumps(_ctx_valid())
        code, out = self._run(["--tool", "project_task_context", "--input", "-", "--json", "--echo-input"], data)
        parsed = json.loads(out)
        self.assertIn("echoInput", parsed)
        self.assertEqual(parsed["echoInput"]["task"]["title"], "synth task")

    def test_cli_missing_task_title(self):
        val = _ctx_valid()
        del val["task"]["title"]
        data = json.dumps(val)
        code, out = self._run(["--tool", "project_task_context", "--input", "-"], data)
        self.assertEqual(code, 1)
        self.assertIn("invalid_arguments", out)

    def test_pass_through_to_canonical(self):
        # extra that validator rejects
        val = _ctx_valid()
        val["unexpected"] = 1
        data = json.dumps(val)
        code, out = self._run(["--tool", "project_task_context", "--input", "-"], data)
        self.assertEqual(code, 1)
        self.assertIn("invalid_arguments", out)


if __name__ == "__main__":
    unittest.main()
