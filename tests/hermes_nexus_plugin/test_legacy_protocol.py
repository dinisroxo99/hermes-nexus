from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


PLUGIN_DIR = Path(__file__).parents[2] / "integrations" / "hermes-nexus"
PACKAGE = "hermes_nexus_test_legacy_protocol"


def _load_package_module(module_name: str):
    for key in tuple(sys.modules):
        if key == PACKAGE or key.startswith(PACKAGE + "."):
            del sys.modules[key]
    package_spec = importlib.util.spec_from_file_location(
        PACKAGE,
        PLUGIN_DIR / "__init__.py",
        submodule_search_locations=[str(PLUGIN_DIR)],
    )
    package = importlib.util.module_from_spec(package_spec)
    sys.modules[PACKAGE] = package
    package_spec.loader.exec_module(package)
    return __import__(f"{PACKAGE}.{module_name}", fromlist=[module_name])


protocol = _load_package_module("legacy_protocol")
client = sys.modules[PACKAGE + ".client"]


def envelope(data):
    return {"ok": True, "data": data, "message": "localized and ignored", "extra": "ignored"}


def graph_data(**extra):
    return {
        "nodes": [
            {
                "id": "node-1",
                "label": "One",
                "kind": "class",
                "category": "service",
                "namespace": "App",
                "projectName": None,
                "layer": "Domain",
                "feature": "Search",
                "file": "src/one.js",
                "subtitle": "src/one.js:1",
                "absolutePath": "/secret/one.js",
                "metadata": {"secret": True},
            },
            {"id": "node-2", "label": "Two", "file": None},
        ],
        "edges": [
            {
                "id": "edge-1",
                "from": "node-1",
                "to": "node-2",
                "relation": "uses",
                "label": "uses",
                "metadata": {"secret": True},
            }
        ],
        **extra,
    }


class LegacyProtocolSuccessTests(unittest.TestCase):
    def test_health_projection_and_adapter_provenance(self):
        result = protocol.validate_legacy_success(
            "project_map_health",
            envelope({"status": "ok", "uptime": 1.5, "timestamp": "2026-01-01", "pid": 42}),
            {},
        )
        self.assertEqual(result["data"], {"status": "ok", "uptime": 1.5, "timestamp": "2026-01-01"})
        self.assertEqual(result["provenance"], {
            "contractVersion": "legacy-map-v1",
            "basis": "legacy_http",
            "scope": "service",
            "requestedProject": None,
            "revisionBinding": "not_provided",
            "cacheBehavior": "not_applicable",
            "trust": "untrusted_service_data",
        })
        self.assertNotIn("pid", json.dumps(result))

    def test_projects_projection_omits_absolute_paths_ids_and_added_at(self):
        data = {
            "projects": [{
                "name": "demo",
                "relativePath": "demo",
                "absolutePath": "/secret/demo",
                "addedAt": "now",
                "projectId": "invented",
                "exists": True,
                "projectType": "typescript",
                "typeLabel": "TypeScript",
                "supported": True,
                "csprojCount": 0,
                "slnCount": 0,
                "tsFileCount": 2,
                "tsxFileCount": 0,
                "jsFileCount": 1,
                "jsxFileCount": 0,
                "sourceFileCount": 3,
            }]
        }
        result = protocol.validate_legacy_success("project_map_projects", envelope(data), {})
        serialized = json.dumps(result)
        self.assertEqual(result["data"]["projects"][0]["name"], "demo")
        self.assertNotIn("absolutePath", serialized)
        self.assertNotIn("addedAt", serialized)
        self.assertNotIn("projectId", serialized)
        self.assertEqual(result["provenance"]["scope"], "service")

    def test_structure_projection_omits_root_and_absolute_directories(self):
        data = {
            "project": "demo",
            "projectType": "typescript",
            "rootPath": "/secret/demo",
            "solution": {"name": "demo", "path": "package.json", "count": 1, "rootPath": "/secret"},
            "projects": [{
                "name": "demo", "layer": "frontend", "path": "package.json", "directory": ".",
                "sourceFileCount": 2, "featureCount": 1, "absoluteDir": "/secret/demo",
            }],
            "layers": [{"name": "common", "projectCount": 1, "projects": ["demo"], "sourceFileCount": 2}],
            "features": [{"name": "Search", "symbolCount": 1, "projectNames": ["demo"], "layers": ["common"]}],
            "canSubdivide": False,
            "suggestedModes": ["all"],
        }
        result = protocol.validate_legacy_success("project_map_structure", envelope(data), {"project": "demo"})
        serialized = json.dumps(result)
        self.assertEqual(result["data"]["project"], "demo")
        self.assertNotIn("rootPath", serialized)
        self.assertNotIn("absoluteDir", serialized)
        self.assertEqual(result["provenance"]["requestedProject"], "demo")
        self.assertEqual(result["provenance"]["revisionBinding"], "not_provided")

    def test_graph_projection_allowlists_fields_and_preserves_typed_flags(self):
        cases = (
            ("project_map_search", {"project": "demo", "query": "One"}, {}),
            ("project_map_expand", {"project": "demo", "nodeId": "node-1", "direction": "out"}, {"projectType": "typescript"}),
            (
                "project_map_full_graph",
                {"project": "demo", "nodeLimit": 20, "edgeLimit": 40, "layers": [], "features": []},
                {"limited": True, "originalNodeCount": 30, "originalEdgeCount": 50},
            ),
        )
        for tool, arguments, extra in cases:
            with self.subTest(tool=tool):
                result = protocol.validate_legacy_success(tool, envelope(graph_data(**extra)), arguments)
                serialized = json.dumps(result)
                self.assertNotIn("absolutePath", serialized)
                self.assertNotIn("metadata", serialized)
                self.assertNotIn("message", result["data"])
                for forbidden in ("projectId", "repositoryId", "worktreeId", "revision", "snapshotToken"):
                    self.assertNotIn(forbidden, result)
                    self.assertNotIn(forbidden, result["data"])
                    self.assertNotIn(forbidden, result["provenance"])
                self.assertEqual(result["provenance"]["cacheBehavior"], "may_reuse_process_cache")

    def test_cache_projection_contains_only_aggregates(self):
        data = {
            "symbols": {"ttlMs": 100, "size": 2, "entries": [{"key": "/secret"}]},
            "analysis": {
                "ttlMs": 200, "maxEntries": 10, "size": 1, "hits": 2, "misses": 3,
                "stale": 4, "evictions": 5, "entries": [{"identityKey": "/secret"}],
            },
        }
        result = protocol.validate_legacy_success("project_map_cache_stats", envelope(data), {})
        serialized = json.dumps(result)
        self.assertNotIn("entries", serialized)
        self.assertNotIn("identityKey", serialized)
        self.assertEqual(result["data"]["analysis"]["hits"], 2)


class LegacyProtocolFailureTests(unittest.TestCase):
    def assert_error(self, tool, data, arguments, code="nexus_invalid_response"):
        with self.assertRaises(client.NexusClientError) as caught:
            protocol.validate_legacy_success(tool, envelope(data), arguments)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_http_200_success_false_becomes_static_analysis_error_without_raw_text(self):
        error = self.assert_error(
            "project_map_search",
            {"success": False, "message": "SECRET /home/user", "error": "raw"},
            {"project": "demo", "query": "x"},
            "nexus_legacy_analysis_unavailable",
        )
        self.assertEqual(error.category, "analysis")
        self.assertEqual(error.http_status, 200)
        self.assertNotIn("SECRET", str(error))

    def test_invalid_envelope_health_and_project_mismatch_fail_closed(self):
        for bad in ({}, {"ok": False, "error": "raw"}, {"ok": True, "data": []}):
            with self.subTest(bad=bad):
                with self.assertRaises(client.NexusClientError):
                    protocol.validate_legacy_success("project_map_health", bad, {})
        self.assert_error(
            "project_map_health",
            {"status": "degraded", "uptime": 1, "timestamp": "now"},
            {},
        )
        structure = {
            "project": "other", "solution": {"name": "other", "path": None, "count": 0},
            "projects": [], "layers": [], "features": [], "canSubdivide": False, "suggestedModes": [],
        }
        self.assert_error("project_map_structure", structure, {"project": "demo"})

    def test_paths_traversal_types_nonfinite_negative_and_long_strings_fail_closed(self):
        projects = {"projects": [{"name": "demo", "relativePath": "../secret"}]}
        self.assert_error("project_map_projects", projects, {})
        health = {"status": "ok", "uptime": float("inf"), "timestamp": "now"}
        self.assert_error("project_map_health", health, {})
        health = {"status": "ok", "uptime": 10 ** 400, "timestamp": "now"}
        self.assert_error("project_map_health", health, {})
        cache = {"symbols": {"ttlMs": -1, "size": 0}, "analysis": {"ttlMs": 1, "maxEntries": 1, "size": 0, "hits": 0, "misses": 0, "stale": 0, "evictions": 0}}
        self.assert_error("project_map_cache_stats", cache, {})
        bad_graph = graph_data()
        bad_graph["nodes"][0]["label"] = "x" * 1025
        self.assert_error("project_map_search", bad_graph, {"project": "demo", "query": "x"})

    def test_duplicate_nodes_dangling_edges_and_full_limit_contradictions_fail_closed(self):
        duplicate = graph_data()
        duplicate["nodes"].append({"id": "node-1", "label": "duplicate"})
        self.assert_error("project_map_search", duplicate, {"project": "demo", "query": "x"})
        dangling = graph_data()
        dangling["edges"][0]["to"] = "missing"
        self.assert_error("project_map_expand", dangling, {"project": "demo", "nodeId": "node-1", "direction": "both"})
        duplicate_edge = graph_data()
        duplicate_edge["edges"].append(dict(duplicate_edge["edges"][0]))
        self.assert_error("project_map_search", duplicate_edge, {"project": "demo", "query": "x"})
        excessive = graph_data()
        self.assert_error(
            "project_map_full_graph",
            excessive,
            {"project": "demo", "nodeLimit": 1, "edgeLimit": 40, "layers": [], "features": []},
        )
        contradictory = graph_data(limited=False, originalNodeCount=3, originalEdgeCount=1)
        self.assert_error(
            "project_map_full_graph",
            contradictory,
            {"project": "demo", "nodeLimit": 20, "edgeLimit": 40, "layers": [], "features": []},
        )

    def test_compact_adapter_envelope_overflow_fails_without_truncation(self):
        original = protocol.LEGACY_ENVELOPE_MAX_BYTES
        protocol.LEGACY_ENVELOPE_MAX_BYTES = 300
        try:
            with self.assertRaises(client.NexusClientError) as caught:
                protocol.validate_legacy_success(
                    "project_map_search",
                    envelope(graph_data()),
                    {"project": "demo", "query": "x"},
                )
            self.assertEqual(caught.exception.code, "nexus_client_response_too_large")
            self.assertEqual(caught.exception.http_status, 200)
        finally:
            protocol.LEGACY_ENVELOPE_MAX_BYTES = original


if __name__ == "__main__":
    unittest.main()
