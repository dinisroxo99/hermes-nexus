from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import unittest
from pathlib import Path

import httpx


PLUGIN_DIR = Path(__file__).parents[2] / "integrations" / "hermes-nexus"
PACKAGE = "hermes_nexus_test_legacy_tools"


def _load_package():
    for key in tuple(sys.modules):
        if key == PACKAGE or key.startswith(PACKAGE + "."):
            del sys.modules[key]
    spec = importlib.util.spec_from_file_location(
        PACKAGE,
        PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    return module


def success_data(tool):
    return {
        "project_map_health": {"status": "ok", "uptime": 1, "timestamp": "now"},
        "project_map_projects": {"projects": []},
        "project_map_structure": {
            "project": "demo x", "solution": {"name": "demo x", "path": None, "count": 0},
            "projects": [], "layers": [], "features": [], "canSubdivide": False, "suggestedModes": [],
        },
        "project_map_search": {"nodes": [], "edges": []},
        "project_map_expand": {"nodes": [], "edges": []},
        "project_map_full_graph": {"nodes": [], "edges": [], "limited": False, "originalNodeCount": 0, "originalEdgeCount": 0},
        "project_map_cache_stats": {
            "symbols": {"ttlMs": 1, "size": 0},
            "analysis": {"ttlMs": 1, "maxEntries": 1, "size": 0, "hits": 0, "misses": 0, "stale": 0, "evictions": 0},
        },
    }[tool]


def valid_args(tool):
    return {
        "project_map_health": {},
        "project_map_projects": {},
        "project_map_structure": {"project": "demo x"},
        "project_map_search": {"project": "demo x", "query": "a?b&c#d e"},
        "project_map_expand": {"project": "demo x", "nodeId": "node?x&y#z", "direction": "in"},
        "project_map_full_graph": {
            "project": "demo x", "nodeLimit": 20, "edgeLimit": 40,
            "layers": ["API", "Domain layer"], "features": ["Search"],
        },
        "project_map_cache_stats": {},
        "project_map_index": {"project": "demo x"},
        "project_map_clear_cache": {"scope": "project", "project": "demo x"},
    }[tool]


class RecordingClient:
    instances = []

    def __init__(self, base_url):
        self.base_url = base_url
        self.calls = []
        self.__class__.instances.append(self)

    async def request_legacy(self, tool, arguments):
        self.calls.append((tool, arguments))
        return {"tool": tool, "ok": True, "data": {}, "message": "ok"}


class LegacyHandlerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.plugin = _load_package()
        self.tools = __import__(PACKAGE + ".legacy_tools", fromlist=["legacy_tools"])
        self.tools.NexusClient = RecordingClient
        RecordingClient.instances = []
        self.handlers = self.tools.create_legacy_handlers("http://127.0.0.1:8770")

    async def test_seven_read_handlers_validate_normalize_and_call_once(self):
        read_names = tuple(self.tools.READ_TOOL_NAMES)
        self.assertEqual(len(read_names), 7)
        for tool in read_names:
            with self.subTest(tool=tool):
                before = len(RecordingClient.instances)
                result = json.loads(await self.handlers[tool](valid_args(tool)))
                self.assertTrue(result["ok"])
                self.assertEqual(len(RecordingClient.instances), before + 1)
                called_tool, arguments = RecordingClient.instances[-1].calls[0]
                self.assertEqual(called_tool, tool)
                if tool == "project_map_expand":
                    self.assertEqual(arguments["direction"], "in")
                if tool == "project_map_full_graph":
                    self.assertEqual(arguments["nodeLimit"], 20)

    async def test_invalid_arguments_create_zero_clients_for_all_nine(self):
        for tool in self.handlers:
            with self.subTest(tool=tool):
                before = len(RecordingClient.instances)
                result = json.loads(await self.handlers[tool]({"base_url": "http://evil"}))
                self.assertEqual(result["error"], "nexus_invalid_arguments")
                self.assertEqual(result["category"], "input")
                self.assertEqual(len(RecordingClient.instances), before)

    async def test_admin_valid_requests_are_static_deny_only_and_zero_io(self):
        cases = (
            ("project_map_index", {"project": "demo x"}),
            ("project_map_clear_cache", {"scope": "project", "project": "demo x"}),
            ("project_map_clear_cache", {"scope": "all"}),
        )
        for tool, arguments in cases:
            with self.subTest(tool=tool, arguments=arguments):
                before = len(RecordingClient.instances)
                result = json.loads(await self.handlers[tool](arguments))
                self.assertEqual(result, {
                    "tool": tool,
                    "ok": False,
                    "error": "REQUIRES_EXPLICIT_OPERATION_AUTHORIZATION",
                    "category": "authorization",
                    "httpStatus": None,
                    "message": "This administrative operation requires explicit operation authorization and was not attempted.",
                    "execution": "not_attempted",
                })
                self.assertEqual(len(RecordingClient.instances), before)

    async def test_admin_cancellation_or_model_flags_cannot_open_gate(self):
        for tool in ("project_map_index", "project_map_clear_cache"):
            value = valid_args(tool)
            for extra in ("authorized", "dryRun", "allow_mutations", "admin_enabled"):
                with self.subTest(tool=tool, extra=extra):
                    invalid = {**value, extra: True}
                    result = json.loads(await self.handlers[tool](invalid))
                    self.assertEqual(result["error"], "nexus_invalid_arguments")
        self.assertEqual(RecordingClient.instances, [])


class LegacyTransportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.plugin = _load_package()
        self.client = sys.modules[PACKAGE + ".client"]

    async def test_exact_seven_get_routes_queries_encoding_headers_and_no_body(self):
        cases = (
            ("project_map_health", {}, "/api/health", b""),
            ("project_map_projects", {}, "/api/projects", b""),
            ("project_map_structure", valid_args("project_map_structure"), "/api/projects/demo%20x/structure", b""),
            ("project_map_search", valid_args("project_map_search"), "/api/explore/demo%20x/search", b"q=a%3Fb%26c%23d+e"),
            ("project_map_expand", valid_args("project_map_expand"), "/api/explore/demo%20x/expand", b"nodeId=node%3Fx%26y%23z&direction=in"),
            (
                "project_map_full_graph", valid_args("project_map_full_graph"), "/api/explore/demo%20x/full",
                b"nodeLimit=20&edgeLimit=40&layers=API%2CDomain+layer&features=Search",
            ),
            ("project_map_cache_stats", {}, "/api/cache/symbols", b""),
        )
        for tool, arguments, expected_path, expected_query in cases:
            seen = []

            async def handler(request, current=tool):
                seen.append(request)
                return httpx.Response(
                    200,
                    json={"ok": True, "data": success_data(current), "message": "localized"},
                    headers={"content-type": "application/json"},
                )

            nexus = self.client.NexusClient(
                "http://127.0.0.1:8770",
                transport=httpx.MockTransport(handler),
            )
            with self.subTest(tool=tool):
                result = await nexus.request_legacy(tool, arguments)
                self.assertTrue(result["ok"])
                self.assertEqual(len(seen), 1)
                request = seen[0]
                self.assertEqual(request.method, "GET")
                self.assertEqual(request.url.raw_path.split(b"?", 1)[0].decode(), expected_path)
                self.assertEqual(request.url.query, expected_query)
                self.assertEqual(request.content, b"")
                self.assertNotIn("content-type", request.headers)
                self.assertEqual(request.headers["accept"], "application/json")
                self.assertEqual(request.headers["accept-encoding"], "identity")

    async def test_unknown_legacy_operation_fails_before_client_creation(self):
        created = []

        def factory(**kwargs):
            created.append(kwargs)
            return httpx.AsyncClient(**kwargs)

        nexus = self.client.NexusClient("http://127.0.0.1:8770", client_factory=factory)
        with self.assertRaises(self.client.NexusClientError) as caught:
            await nexus.request_legacy("project_map_index", {"project": "demo"})
        self.assertEqual(caught.exception.code, "nexus_client_failed")
        self.assertEqual(created, [])

    async def test_legacy_http_and_protocol_failures_are_sanitized(self):
        cases = (
            (503, {"ok": False, "error": "SECRET /home/user"}, "nexus_http_error"),
            (302, {"ok": False, "error": "redirect"}, "nexus_redirect_rejected"),
            (200, {"ok": True, "data": {"success": False, "message": "SECRET"}}, "nexus_legacy_analysis_unavailable"),
        )
        for status, payload, expected in cases:
            async def handler(_request, current_status=status, current_payload=payload):
                return httpx.Response(
                    current_status,
                    json=current_payload,
                    headers={"content-type": "application/json"},
                )

            nexus = self.client.NexusClient(
                "http://127.0.0.1:8770",
                transport=httpx.MockTransport(handler),
            )
            with self.subTest(status=status), self.assertRaises(self.client.NexusClientError) as caught:
                await nexus.request_legacy("project_map_search", {"project": "demo", "query": "x"})
            self.assertEqual(caught.exception.code, expected)
            self.assertNotIn("SECRET", str(caught.exception))
            self.assertNotIn("/home/user", str(caught.exception))

    async def test_cancellation_propagates_through_legacy_get(self):
        entered = asyncio.Event()

        async def handler(_request):
            entered.set()
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

        nexus = self.client.NexusClient(
            "http://127.0.0.1:8770",
            transport=httpx.MockTransport(handler),
        )
        task = asyncio.create_task(nexus.request_legacy("project_map_health", {}))
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task


if __name__ == "__main__":
    unittest.main()
