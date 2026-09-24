from __future__ import annotations

import asyncio
import ast
import importlib
import importlib.util
import json
import logging
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, cast

import httpx


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


def context_args():
    return {
        "projectId": "prj_123",
        "worktree": {"rootId": "local", "relativePath": "checkout"},
        "expectedRevision": {
            "status": "available",
            "commitSha": HEX40,
            "branch": "feat/test",
            "dirty": False,
            "isLinkedWorktree": True,
        },
        "task": {"title": "Inspect", "paths": ["src/a.js"]},
    }


def impact_args():
    value = context_args()
    return {
        "projectId": value["projectId"],
        "worktree": value["worktree"],
        "expectedRevision": {
            **value["expectedRevision"],
            "repositoryId": HEX64,
            "worktreeId": WORKTREE_ID,
        },
        "paths": ["src/a.js"],
    }


class RecordingClient:
    instances = []
    result = {"tool": "unused", "ok": True, "data": {}, "message": "ok"}
    error = None

    def __init__(self, base_url):
        self.base_url = base_url
        self.calls = []
        self.__class__.instances.append(self)

    async def request(self, tool, arguments, body):
        self.calls.append((tool, arguments, body))
        if self.__class__.error is not None:
            raise self.__class__.error
        return {**self.__class__.result, "tool": tool}


class HandlerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.plugin = _load_package()
        self.tools = sys.modules[self.plugin.__name__ + ".tools"]
        self.client = sys.modules[self.plugin.__name__ + ".client"]
        RecordingClient.instances = []
        RecordingClient.error = None
        self.tools.NexusClient = RecordingClient
        self.context_handler, self.impact_handler = self.tools.create_handlers("http://127.0.0.1:8770")

    async def test_context_validates_and_projects_only_server_fields(self):
        args = context_args()
        args.update(limits={"files": 1.5}, includeExcerpts=False)
        result = json.loads(await self.context_handler(args))
        self.assertTrue(result["ok"])
        self.assertEqual(len(RecordingClient.instances), 1)
        tool, validated, body = RecordingClient.instances[0].calls[0]
        self.assertEqual(tool, "project_task_context")
        self.assertEqual(validated, args)
        self.assertEqual(
            body,
            {
                "task": args["task"],
                "worktree": args["worktree"],
                "limits": args["limits"],
                "includeExcerpts": False,
            },
        )
        self.assertNotIn("projectId", body)
        self.assertNotIn("expectedRevision", body)

    async def test_impact_projects_only_supplied_server_fields(self):
        args = impact_args()
        args["includeTests"] = True
        result = json.loads(await self.impact_handler(args))
        self.assertTrue(result["ok"])
        tool, _validated, body = RecordingClient.instances[0].calls[0]
        self.assertEqual(tool, "project_impact")
        self.assertEqual(
            body,
            {"paths": args["paths"], "worktree": args["worktree"], "includeTests": True},
        )

    async def test_omitted_options_remain_omitted(self):
        await self.context_handler(context_args())
        body = RecordingClient.instances[0].calls[0][2]
        self.assertNotIn("limits", body)
        self.assertNotIn("includeExcerpts", body)

    async def test_invalid_arguments_make_zero_clients_and_return_static_error(self):
        invalid = context_args()
        invalid["provider"] = "injected"
        result = json.loads(await self.context_handler(invalid))
        self.assertEqual(result, {
            "tool": "project_task_context",
            "ok": False,
            "error": "nexus_invalid_arguments",
            "category": "input",
            "httpStatus": None,
            "message": "The tool arguments are invalid.",
        })
        self.assertEqual(RecordingClient.instances, [])

    async def test_client_error_is_returned_without_data(self):
        RecordingClient.error = self.client.NexusClientError(
            "nexus_context_mismatch",
            "identity",
            200,
            ("commitSha",),
        )
        result = json.loads(await self.impact_handler(impact_args()))
        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatchedFields"], ["commitSha"])
        self.assertNotIn("data", result)

    async def test_unexpected_exception_is_sanitized(self):
        RecordingClient.error = RuntimeError("SECRET /home/person http://user:pass@host")
        result = json.loads(await self.context_handler(context_args()))
        self.assertEqual(result["error"], "nexus_client_failed")
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("/home/person", json.dumps(result))

    async def test_cancellation_is_not_swallowed(self):
        RecordingClient.error = asyncio.CancelledError()
        with self.assertRaises(asyncio.CancelledError):
            await self.context_handler(context_args())

    async def test_both_real_handlers_propagate_corrected_client_cancellation(self):
        for tool_name, args_factory in (
            ("project_task_context", context_args),
            ("project_impact", impact_args),
        ):
            entered = asyncio.Event()

            async def transport_handler(_request):
                entered.set()
                await asyncio.Event().wait()
                raise AssertionError("unreachable finite test seam")

            transport = httpx.MockTransport(transport_handler)
            setattr(
                self.tools,
                "NexusClient",
                lambda base_url, current=transport: self.client.NexusClient(
                    base_url, transport=current
                ),
            )
            context_handler, impact_handler = self.tools.create_handlers(
                "http://127.0.0.1:8770"
            )
            handler = context_handler if tool_name == "project_task_context" else impact_handler
            task = asyncio.create_task(handler(args_factory()))
            await asyncio.wait_for(entered.wait(), 1)
            task.cancel()
            with self.subTest(tool=tool_name), self.assertRaises(asyncio.CancelledError):
                await task

    async def test_both_real_handlers_return_sanitized_timeout(self):
        original = self.client.TOTAL_TIMEOUT_SECONDS
        setattr(self.client, "TOTAL_TIMEOUT_SECONDS", 0.01)
        try:
            async def transport_handler(_request):
                await asyncio.Event().wait()
                raise AssertionError("unreachable finite test seam")

            transport = httpx.MockTransport(transport_handler)
            setattr(
                self.tools,
                "NexusClient",
                lambda base_url: self.client.NexusClient(base_url, transport=transport),
            )
            handlers = self.tools.create_handlers("http://127.0.0.1:8770")
            for handler, args_factory, tool_name in (
                (handlers[0], context_args, "project_task_context"),
                (handlers[1], impact_args, "project_impact"),
            ):
                result = json.loads(await handler(args_factory()))
                self.assertEqual(result["tool"], tool_name)
                self.assertEqual(result["error"], "nexus_timeout")
                self.assertEqual(result["category"], "transport")
                self.assertIsNone(result["httpStatus"])
                self.assertNotIn("data", result)
        finally:
            setattr(self.client, "TOTAL_TIMEOUT_SECONDS", original)

    async def test_both_real_handlers_return_sanitized_cleanup_failure(self):
        class FailingCloseClient(httpx.AsyncClient):
            async def aclose(self):
                try:
                    await super().aclose()
                finally:
                    raise RuntimeError("TEST_ONLY_CLEANUP_SECRET")

        async def transport_handler(_request):
            return httpx.Response(
                200,
                content=b"{}",
                headers={"content-type": "text/plain"},
            )

        transport = httpx.MockTransport(transport_handler)
        setattr(
            self.tools,
            "NexusClient",
            lambda base_url: self.client.NexusClient(
                base_url,
                transport=transport,
                client_factory=FailingCloseClient,
            ),
        )
        handlers = self.tools.create_handlers("http://127.0.0.1:8770")
        for handler, args_factory, tool_name in (
            (handlers[0], context_args, "project_task_context"),
            (handlers[1], impact_args, "project_impact"),
        ):
            result = json.loads(await handler(args_factory()))
            self.assertEqual(result["tool"], tool_name)
            self.assertEqual(result["error"], "nexus_cleanup_failed")
            self.assertEqual(result["category"], "transport")
            self.assertEqual(result["httpStatus"], 200)
            self.assertNotIn("SECRET", json.dumps(result))
            self.assertNotIn("data", result)

    async def test_numeric_overflow_is_returned_as_protocol_error_with_received_status(self):
        async def handler(_request):
            return httpx.Response(
                409,
                content=b'{"ok":false,"error":"impact_revision_changed","nested":[1e999]}',
                headers={"content-type": "application/json"},
            )

        transport = httpx.MockTransport(handler)
        setattr(
            self.tools,
            "NexusClient",
            lambda base_url: self.client.NexusClient(base_url, transport=transport),
        )
        _context_handler, impact_handler = self.tools.create_handlers("http://127.0.0.1:8770")
        result = json.loads(await impact_handler(impact_args()))
        self.assertEqual(result["error"], "nexus_invalid_response")
        self.assertEqual(result["category"], "protocol")
        self.assertEqual(result["httpStatus"], 409)
        self.assertNotIn("data", result)

    async def test_large_integer_limits_reach_both_tools_unchanged(self):
        cases = (
            (self.context_handler, context_args, "files"),
            (self.impact_handler, impact_args, "depth"),
        )
        for handler, factory, key in cases:
            for candidate in (10 ** 400, -(10 ** 400)):
                with self.subTest(key=key, positive=candidate > 0):
                    args = factory()
                    args["limits"] = {key: candidate}
                    result = json.loads(await handler(args))
                    self.assertTrue(result["ok"])
                    _tool, validated, body = RecordingClient.instances[-1].calls[0]
                    self.assertEqual(validated["limits"][key], candidate)
                    self.assertEqual(body["limits"][key], candidate)

    async def test_limit_numeric_type_failures_are_static_and_pre_network(self):
        cases = (
            (self.context_handler, context_args, "files", (True, float("nan"), float("inf"))),
            (self.impact_handler, impact_args, "depth", (True, 1.5, float("nan"), float("inf"))),
        )
        for handler, factory, key, invalid_values in cases:
            for invalid in invalid_values:
                before = len(RecordingClient.instances)
                with self.subTest(key=key, invalid=repr(invalid)):
                    args = factory()
                    args["limits"] = {key: invalid}
                    result = json.loads(await handler(args))
                    self.assertEqual(result["error"], "nexus_invalid_arguments")
                    self.assertEqual(result["category"], "input")
                    self.assertEqual(len(RecordingClient.instances), before)


class Handle:
    def __init__(self, name, owner):
        self.name = name
        self.owner = owner
        self.disposed = False

    def dispose(self):
        self.disposed = True
        self.owner.pop(self.name, None)


_ABSENT = object()


class FakeContext:
    def __init__(
        self,
        base_url="http://127.0.0.1:8770",
        registry=None,
        global_registry=None,
        refuse=None,
        profile_name="architect",
        real_context=False,
        legacy_enabled=_ABSENT,
    ):
        self.base_url = base_url
        self.registry = registry if registry is not None else {}
        self.global_registry = global_registry if global_registry is not None else {}
        self.refuse = refuse
        self.profile_name = profile_name
        self.legacy_enabled = legacy_enabled
        self.calls = []
        if real_context:
            self._manager = object()

    def get_config(self, key, default=None):
        self.calls.append(("get_config", key))
        if key == "base_url":
            return self.base_url
        if key == "legacy_enabled" and self.legacy_enabled is not _ABSENT:
            return self.legacy_enabled
        return default

    def has_registered_tool(self, name):
        self.calls.append(("has_registered_tool", name))
        return name in self.registry or name in self.global_registry

    def register_tool(self, **kwargs):
        name = kwargs["name"]
        self.calls.append(("register_tool", name))
        if name == self.refuse or name in self.global_registry:
            return None
        existing = self.registry.get(name)
        if existing is not None and existing.get("toolset") != kwargs["toolset"]:
            return None
        self.registry[name] = kwargs
        return Handle(name, self.registry)


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.plugin = _load_package()

    def test_registers_exactly_two_async_nonoverride_tools_without_network(self):
        ctx = FakeContext()
        self.plugin.register(ctx)
        self.assertEqual(set(ctx.registry), {"project_task_context", "project_impact"})
        for name, registration in ctx.registry.items():
            self.assertEqual(registration["schema"]["name"], name)
            self.assertEqual(registration["toolset"], "project_intelligence")
            self.assertTrue(registration["is_async"])
            self.assertFalse(registration["override"])
            self.assertTrue(registration["check_fn"]())
            self.assertTrue(callable(registration["handler"]))
        self.assertEqual(ctx.calls[0], ("get_config", "base_url"))

    def test_explicit_false_preserves_exact_two_tool_surface(self):
        ctx = FakeContext(legacy_enabled=False)
        self.plugin.register(ctx)
        self.assertEqual(set(ctx.registry), {"project_task_context", "project_impact"})

    def test_true_registers_exact_eleven_tools_in_three_toolsets(self):
        ctx = FakeContext(legacy_enabled=True)
        self.plugin.register(ctx)
        expected = {
            "project_task_context": "project_intelligence",
            "project_impact": "project_intelligence",
            "project_map_health": "project_map",
            "project_map_projects": "project_map",
            "project_map_structure": "project_map",
            "project_map_search": "project_map",
            "project_map_expand": "project_map",
            "project_map_full_graph": "project_map",
            "project_map_cache_stats": "project_map",
            "project_map_index": "project_map_admin",
            "project_map_clear_cache": "project_map_admin",
        }
        self.assertEqual({name: item["toolset"] for name, item in ctx.registry.items()}, expected)
        for name, registration in ctx.registry.items():
            self.assertEqual(registration["schema"]["name"], name)
            self.assertTrue(registration["is_async"])
            self.assertFalse(registration["override"])
            self.assertTrue(callable(registration["handler"]))

    def test_invalid_legacy_enabled_is_refused_before_preflight_or_registration(self):
        for invalid in (0, 1, "false", "true", None, [], {}):
            ctx = FakeContext(legacy_enabled=invalid)
            with self.subTest(invalid=repr(invalid)), self.assertRaisesRegex(
                RuntimeError, "legacy_enabled"
            ):
                self.plugin.register(ctx)
            self.assertEqual(ctx.registry, {})
            self.assertNotIn("register_tool", [call[0] for call in ctx.calls])

    def test_true_preflights_every_name_and_preserves_each_collision(self):
        names = (
            "project_task_context", "project_impact", "project_map_health",
            "project_map_projects", "project_map_structure", "project_map_search",
            "project_map_expand", "project_map_full_graph", "project_map_cache_stats",
            "project_map_index", "project_map_clear_cache",
        )
        for collision_name in names:
            for location in ("scoped", "global"):
                sentinel = {"name": collision_name, "toolset": "foreign", "handler": object()}
                scoped = {collision_name: sentinel} if location == "scoped" else {}
                global_registry = {collision_name: sentinel} if location == "global" else {}
                ctx = FakeContext(
                    registry=scoped,
                    global_registry=global_registry,
                    legacy_enabled=True,
                )
                with self.subTest(name=collision_name, location=location):
                    with self.assertRaisesRegex(RuntimeError, "registration was refused"):
                        self.plugin.register(ctx)
                    self.assertNotIn("register_tool", [call[0] for call in ctx.calls])
                    owner = scoped if location == "scoped" else global_registry
                    self.assertIs(owner[collision_name], sentinel)

    def test_true_rolls_back_only_own_handles_for_refusal_at_every_position(self):
        names = (
            "project_task_context", "project_impact", "project_map_health",
            "project_map_projects", "project_map_structure", "project_map_search",
            "project_map_expand", "project_map_full_graph", "project_map_cache_stats",
            "project_map_index", "project_map_clear_cache",
        )
        for refusal in names:
            sentinel = {"name": "foreign_tool", "toolset": "foreign"}
            registry = {"foreign_tool": sentinel}
            ctx = FakeContext(
                registry=registry,
                refuse=refusal,
                real_context=True,
                legacy_enabled=True,
            )
            with self.subTest(refusal=refusal), self.assertRaisesRegex(
                RuntimeError, "registration was refused"
            ):
                self.plugin.register(ctx)
            self.assertEqual(ctx.registry, {"foreign_tool": sentinel})

    def test_manifest_advertises_exact_eleven_tools_and_strict_opt_in(self):
        text = (PLUGIN_DIR / "plugin.yaml").read_text(encoding="utf-8")
        self.assertIn("version: 0.2.0", text)
        provides = text.split("provides_tools:\n", 1)[1].split("config_schema:\n", 1)[0]
        names = [line.removeprefix("  - ") for line in provides.splitlines() if line.startswith("  - ")]
        self.assertEqual(names, [
            "project_task_context", "project_impact", "project_map_health",
            "project_map_projects", "project_map_structure", "project_map_search",
            "project_map_expand", "project_map_full_graph", "project_map_cache_stats",
            "project_map_index", "project_map_clear_cache",
        ])
        self.assertIn("legacy_enabled:", text)
        self.assertIn("default: false", text)

    def test_invalid_local_configuration_makes_tools_unavailable_without_network(self):
        ctx = FakeContext(base_url="http://remote.example:8770")
        self.plugin.register(ctx)
        self.assertFalse(ctx.registry["project_task_context"]["check_fn"]())
        self.assertFalse(ctx.registry["project_impact"]["check_fn"]())

    def test_refused_second_registration_rolls_back_first(self):
        ctx = FakeContext(refuse="project_impact", real_context=True)
        with self.assertRaisesRegex(RuntimeError, "registration was refused"):
            self.plugin.register(ctx)
        self.assertEqual(ctx.registry, {})

    def test_refused_first_registration_changes_nothing(self):
        ctx = FakeContext(refuse="project_task_context", real_context=True)
        with self.assertRaisesRegex(RuntimeError, "registration was refused"):
            self.plugin.register(ctx)
        self.assertEqual(ctx.registry, {})

    def test_preexisting_names_are_refused_before_registration_and_preserved(self):
        for collision_name in ("project_task_context", "project_impact"):
            for location in ("scoped", "global"):
                sentinel = {
                    "name": collision_name,
                    "toolset": "project_intelligence" if location == "scoped" else "other_tools",
                    "handler": object(),
                }
                scoped = {collision_name: sentinel} if location == "scoped" else {}
                global_registry = {collision_name: sentinel} if location == "global" else {}
                ctx = FakeContext(registry=scoped, global_registry=global_registry)
                with self.subTest(name=collision_name, location=location):
                    with self.assertRaisesRegex(RuntimeError, "registration was refused"):
                        self.plugin.register(ctx)
                    self.assertNotIn("register_tool", [call[0] for call in ctx.calls])
                    owner = scoped if location == "scoped" else global_registry
                    self.assertIs(owner[collision_name], sentinel)

    def test_preflight_uses_actual_hermes_merged_scope_semantics(self):
        hermes_root = Path.home() / ".hermes" / "hermes-agent"
        registry_module = None
        original_registry = None
        sys.path.insert(0, str(hermes_root))
        try:
            registry_module = importlib.import_module("tools.registry")
            original_registry = getattr(registry_module, "registry")
            registry_type = getattr(registry_module, "ToolRegistry")
            isolated_registry = registry_type()
            setattr(registry_module, "registry", isolated_registry)
            scope = "/isolated/architect-profile"

            class ActualRegistryContext:
                _manager = SimpleNamespace(scope_key=scope)

                def get_config(self, key, default=None):
                    if key == "base_url":
                        return "http://127.0.0.1:8770"
                    if key == "legacy_enabled":
                        return True
                    return default

                def register_tool(self, **_kwargs):
                    raise AssertionError("preflight must run before registration")

            names = (
                "project_task_context", "project_impact", "project_map_health",
                "project_map_projects", "project_map_structure", "project_map_search",
                "project_map_expand", "project_map_full_graph", "project_map_cache_stats",
                "project_map_index", "project_map_clear_cache",
            )
            for name in names:
                for location in ("scoped", "global"):
                    sentinel = lambda _args: "sentinel"
                    isolated_registry.register(
                        name=name,
                        toolset="foreign",
                        schema={},
                        handler=sentinel,
                        scope=scope if location == "scoped" else None,
                    )
                    with self.subTest(name=name, location=location):
                        with self.assertRaisesRegex(RuntimeError, "registration was refused"):
                            self.plugin.register(ActualRegistryContext())
                        entry = isolated_registry.get_entry(name, scope=scope)
                        self.assertIs(entry.handler, sentinel)
                    isolated_registry = registry_type()
                    setattr(registry_module, "registry", isolated_registry)
        finally:
            if registry_module is not None:
                setattr(registry_module, "registry", original_registry)
            sys.path.remove(str(hermes_root))

    def test_existing_low_level_tools_are_not_changed(self):
        sentinel = {"name": "project_map_search", "owner": "legacy"}
        registry = {"project_map_search": sentinel}
        ctx = FakeContext(registry=registry)
        self.plugin.register(ctx)
        self.assertIs(registry["project_map_search"], sentinel)
        self.assertEqual(set(registry), {"project_map_search", "project_task_context", "project_impact"})

    def test_successful_registration_is_confined_to_architect_merged_scope(self):
        hermes_root = Path.home() / ".hermes" / "hermes-agent"
        registry_module = None
        original_registry = None
        sys.path.insert(0, str(hermes_root))
        try:
            registry_module = importlib.import_module("tools.registry")
            original_registry = registry_module.registry
            registry = registry_module.ToolRegistry()
            setattr(registry_module, "registry", registry)

            tree = ast.parse((hermes_root / "hermes_cli/plugins.py").read_text())
            context_class = next(
                node for node in tree.body
                if isinstance(node, ast.ClassDef) and node.name == "PluginContext"
            )
            register_method = next(
                node for node in context_class.body
                if isinstance(node, ast.FunctionDef) and node.name == "register_tool"
            )
            register_method.decorator_list = []
            isolated_module = ast.Module(
                body=[
                    ast.ImportFrom(
                        module="__future__",
                        names=[ast.alias(name="annotations")],
                        level=0,
                    ),
                    register_method,
                ],
                type_ignores=[],
            )
            namespace = {"logger": logging.getLogger("hermes-nexus-registry-test")}
            exec(
                compile(
                    ast.fix_missing_locations(isolated_module),
                    "isolated_actual_register_tool",
                    "exec",
                ),
                namespace,
            )
            actual_register_tool = cast(Callable[..., object], namespace["register_tool"])

            class Manager:
                def __init__(self, scope):
                    self.scope_key = scope
                    self._plugin_tool_names = set()

                def _remove_tool_name_if_unowned(self, name):
                    self._plugin_tool_names.discard(name)

                def _track_scoped_registration(
                    self, _manifest, _kind, name, owner, current, previous, finalize
                ):
                    scope = self.scope_key

                    class RegistrationHandle:
                        def dispose(self):
                            owner.restore_registration(
                                name, current, previous, scope=scope
                            )
                            finalize()

                    return RegistrationHandle()

            class ActualRegistryContext:
                register_tool = actual_register_tool
                manifest = SimpleNamespace(name="hermes-nexus")

                def __init__(self, scope, legacy_enabled=False):
                    self._manager = Manager(scope)
                    self.legacy_enabled = legacy_enabled

                def get_config(self, key, default=None):
                    if key == "base_url":
                        return "http://127.0.0.1:8770"
                    if key == "legacy_enabled":
                        return self.legacy_enabled
                    return default

            architect_scope = "/isolated/architect"
            sentinel = lambda _args: "legacy"
            registry.register(
                name="project_map_search",
                toolset="project_map",
                schema={},
                handler=sentinel,
            )
            self.plugin.register(ActualRegistryContext(architect_scope))

            names = ("project_task_context", "project_impact")
            for name in names:
                self.assertIsNotNone(registry.get_entry(name, scope=architect_scope))
                self.assertIsNone(registry.snapshot_registration(name, scope=None))
            for profile in (
                "default", "workspace-manager", "orchestrator", "implementer",
                "tester", "reviewer", "documenter",
            ):
                for name in names:
                    self.assertIsNone(
                        registry.get_entry(name, scope=f"/isolated/{profile}")
                    )
            self.assertIs(
                registry.get_entry("project_map_search", scope=architect_scope).handler,
                sentinel,
            )

            rollback_registry = registry_module.ToolRegistry()
            setattr(registry_module, "registry", rollback_registry)

            class RefuseSecond(ActualRegistryContext):
                def register_tool(self, **kwargs):
                    if kwargs["name"] == "project_impact":
                        return None
                    return super().register_tool(**kwargs)

            with self.assertRaisesRegex(RuntimeError, "registration was refused"):
                self.plugin.register(RefuseSecond(architect_scope))
            for name in names:
                self.assertIsNone(
                    rollback_registry.get_entry(name, scope=architect_scope)
                )

            legacy_registry = registry_module.ToolRegistry()
            setattr(registry_module, "registry", legacy_registry)
            legacy_names = (
                "project_task_context", "project_impact", "project_map_health",
                "project_map_projects", "project_map_structure", "project_map_search",
                "project_map_expand", "project_map_full_graph", "project_map_cache_stats",
                "project_map_index", "project_map_clear_cache",
            )
            self.plugin.register(ActualRegistryContext(architect_scope, legacy_enabled=True))
            for name in legacy_names:
                self.assertIsNotNone(legacy_registry.get_entry(name, scope=architect_scope))
                self.assertIsNone(legacy_registry.snapshot_registration(name, scope=None))

            legacy_rollback_registry = registry_module.ToolRegistry()
            setattr(registry_module, "registry", legacy_rollback_registry)

            class RefuseLegacy(ActualRegistryContext):
                def register_tool(self, **kwargs):
                    if kwargs["name"] == "project_map_cache_stats":
                        return None
                    return super().register_tool(**kwargs)

            with self.assertRaisesRegex(RuntimeError, "registration was refused"):
                self.plugin.register(RefuseLegacy(architect_scope, legacy_enabled=True))
            for name in legacy_names:
                self.assertIsNone(
                    legacy_rollback_registry.get_entry(name, scope=architect_scope)
                )
        finally:
            if registry_module is not None:
                setattr(registry_module, "registry", original_registry)
            sys.path.remove(str(hermes_root))

    def test_schema_advertisement_and_handler_validation_agree_on_unknown_fields(self):
        ctx = FakeContext()
        self.plugin.register(ctx)
        for registration in ctx.registry.values():
            self.assertFalse(registration["schema"]["parameters"]["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
