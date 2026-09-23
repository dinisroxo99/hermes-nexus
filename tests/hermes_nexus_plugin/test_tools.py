from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


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


class Handle:
    def __init__(self, name, owner):
        self.name = name
        self.owner = owner
        self.disposed = False

    def dispose(self):
        self.disposed = True
        self.owner.pop(self.name, None)


class FakeContext:
    def __init__(self, base_url="http://127.0.0.1:8770", registry=None, refuse=None, profile_name="architect", real_context=False):
        self.base_url = base_url
        self.registry = registry if registry is not None else {}
        self.refuse = refuse
        self.profile_name = profile_name
        self.calls = []
        if real_context:
            self._manager = object()

    def get_config(self, key, default=None):
        self.calls.append(("get_config", key))
        return self.base_url if key == "base_url" else default

    def register_tool(self, **kwargs):
        name = kwargs["name"]
        self.calls.append(("register_tool", name))
        if name == self.refuse or name in self.registry:
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

    def test_existing_low_level_tools_are_not_changed(self):
        sentinel = {"name": "project_map_search", "owner": "legacy"}
        registry = {"project_map_search": sentinel}
        ctx = FakeContext(registry=registry)
        self.plugin.register(ctx)
        self.assertIs(registry["project_map_search"], sentinel)
        self.assertEqual(set(registry), {"project_map_search", "project_task_context", "project_impact"})

    def test_profile_enablement_is_loader_scoped_not_global(self):
        homes = {
            name: FakeContext(profile_name=name)
            for name in ("architect", "default", "workspace-manager", "orchestrator", "implementer", "tester", "reviewer", "documenter")
        }
        self.plugin.register(homes["architect"])
        self.assertEqual(set(homes["architect"].registry), {"project_task_context", "project_impact"})
        for name, ctx in homes.items():
            if name != "architect":
                self.assertEqual(ctx.registry, {})

    def test_schema_advertisement_and_handler_validation_agree_on_unknown_fields(self):
        ctx = FakeContext()
        self.plugin.register(ctx)
        for registration in ctx.registry.values():
            self.assertFalse(registration["schema"]["parameters"]["additionalProperties"])


if __name__ == "__main__":
    unittest.main()
