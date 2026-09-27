"""In-memory tests for hermes-nexus plugin install copy (flat six files) per E4 contract.

Copy exactly the documented six into tempfile.TemporaryDirectory()/hermes-nexus/ (flat).
Load register(ctx) from the copied __init__.py via spec_from_file_location using module name
hermes_nexus_install_copy_test (with submodule_search_locations for relative imports).
Probe ctx implements get_config / has_registered_tool / register_tool and has NO _manager attr.

- scope_enabled=false registers exactly project_task_context + project_impact
- scope_enabled=true registers those two plus project_effective_task_scope (runtime only)
Never reads plugin.yaml, never contacts Nexus.

If Hermes plugin APIs absent: ImportError propagates (fail closed; no skipTest).

Gate:
PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s tests/hermes_nexus_plugin -p test_plugin_install_copy.py
"""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from shutil import copy2
from typing import Any

SOURCE_DIR = Path(__file__).parents[2] / "integrations" / "hermes-nexus"

DOCUMENTED_SIX = [
    "plugin.yaml",
    "__init__.py",
    "schemas.py",
    "client.py",
    "tools.py",
    "effective_task_scope.py",
]


def _copy_six(dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for fname in DOCUMENTED_SIX:
        src = SOURCE_DIR / fname
        if not src.exists():
            raise FileNotFoundError(f"documented source missing: {src}")
        copy2(src, dest / fname)


class ProbeCtx:
    """Minimal ctx probe per contract: implements the three methods, never sets _manager."""

    def __init__(self, *, scope_enabled: bool = False) -> None:
        self.calls: list[tuple[str, str]] = []
        self.registry: dict[str, dict[str, Any]] = {}
        self._config: dict[str, Any] = {
            "base_url": "http://127.0.0.1:8770",
            "scope_enabled": scope_enabled,
        }

    def get_config(self, key: str, default: Any = None) -> Any:
        self.calls.append(("get_config", key))
        if key in self._config:
            return self._config[key]
        return default

    def has_registered_tool(self, name: str) -> bool:
        self.calls.append(("has_registered_tool", name))
        return name in self.registry

    def register_tool(self, **kwargs: Any) -> object:
        name = kwargs["name"]
        self.calls.append(("register_tool", name))
        # simulate success (non-None) for a ctx without _manager
        if name in self.registry:
            return None
        self.registry[name] = kwargs
        return object()  # truthy handle


class PluginInstallCopyTests(unittest.TestCase):
    def test_install_copy_contains_exactly_documented_six_files(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "hermes-nexus"
            _copy_six(dest)
            present = sorted(p.name for p in dest.iterdir() if p.is_file())
            self.assertEqual(present, sorted(DOCUMENTED_SIX))
            # exactly six, flat, no extras, no subdirs created by copy
            self.assertEqual(len([p for p in dest.iterdir()]), 6)
            for fname in DOCUMENTED_SIX:
                self.assertTrue((dest / fname).is_file())

    def _load_register_from_copy(self, copy_root: Path):
        name = "hermes_nexus_install_copy_test"
        for key in list(sys.modules.keys()):
            if key == name or key.startswith(name + "."):
                del sys.modules[key]
        spec = importlib.util.spec_from_file_location(
            name,
            copy_root / "__init__.py",
            submodule_search_locations=[str(copy_root)],
        )
        module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        sys.modules[name] = module
        spec.loader.exec_module(module)  # type: ignore[union-attr]
        return module

    def test_register_from_install_copy_when_scope_enabled_false(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "hermes-nexus"
            _copy_six(dest)
            copy2(SOURCE_DIR / "collect_forward_log.py", dest / "collect_forward_log.py")
            plugin = self._load_register_from_copy(dest)
            ctx = ProbeCtx(scope_enabled=False)
            plugin.register(ctx)
            self.assertEqual(
                set(ctx.registry.keys()), {"project_task_context", "project_impact"}
            )
            self.assertNotIn("project_effective_task_scope", ctx.registry)
            # config calls happened; no _manager path taken
            self.assertTrue(any(c == ("get_config", "scope_enabled") for c in ctx.calls))
            self.assertFalse(hasattr(ctx, "_manager"))

    def test_register_from_install_copy_when_scope_enabled_true(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "hermes-nexus"
            _copy_six(dest)
            copy2(SOURCE_DIR / "collect_forward_log.py", dest / "collect_forward_log.py")
            plugin = self._load_register_from_copy(dest)
            ctx = ProbeCtx(scope_enabled=True)
            plugin.register(ctx)
            names = set(ctx.registry.keys())
            self.assertEqual(
                names,
                {"project_task_context", "project_impact", "project_effective_task_scope"},
            )
            reg = ctx.registry["project_effective_task_scope"]
            self.assertEqual(reg["name"], "project_effective_task_scope")
            self.assertEqual(reg["toolset"], "project_intelligence")
            self.assertTrue(reg["is_async"])
            self.assertFalse(reg["override"])
            self.assertTrue(callable(reg.get("handler")))
            self.assertTrue(callable(reg.get("check_fn")))
            self.assertFalse(hasattr(ctx, "_manager"))
