from __future__ import annotations

import importlib.util
import sys
import unittest
from copy import deepcopy
from pathlib import Path


PLUGIN_DIR = Path(__file__).parents[2] / "integrations" / "hermes-nexus"


def _load_module():
    path = PLUGIN_DIR / "legacy_schemas.py"
    spec = importlib.util.spec_from_file_location("hermes_nexus_test_legacy_schemas", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


legacy = _load_module()

READ_TOOLS = (
    "project_map_health",
    "project_map_projects",
    "project_map_structure",
    "project_map_search",
    "project_map_expand",
    "project_map_full_graph",
    "project_map_cache_stats",
)
ADMIN_TOOLS = ("project_map_index", "project_map_clear_cache")
ALL_TOOLS = READ_TOOLS + ADMIN_TOOLS


def valid_arguments(tool: str):
    values = {
        "project_map_health": {},
        "project_map_projects": {},
        "project_map_structure": {"project": "hermes-project-map"},
        "project_map_search": {"project": "hermes-project-map", "query": "NexusClient"},
        "project_map_expand": {
            "project": "hermes-project-map",
            "nodeId": "src/lib:a?b&c#d",
        },
        "project_map_full_graph": {"project": "hermes-project-map"},
        "project_map_cache_stats": {},
        "project_map_index": {"project": "hermes-project-map"},
        "project_map_clear_cache": {"scope": "project", "project": "hermes-project-map"},
    }
    return deepcopy(values[tool])


class LegacySchemaShapeTests(unittest.TestCase):
    def test_exact_nine_closed_named_schemas(self):
        self.assertEqual(tuple(legacy.LEGACY_SCHEMAS), ALL_TOOLS)
        for name in ALL_TOOLS:
            schema = legacy.LEGACY_SCHEMAS[name]
            self.assertEqual(schema["name"], name)
            self.assertFalse(schema["parameters"]["additionalProperties"])
            self.assertIn("untrusted", schema["description"].lower())

    def test_defaults_and_ranges_are_advertised(self):
        expand = legacy.LEGACY_SCHEMAS["project_map_expand"]["parameters"]
        self.assertEqual(expand["properties"]["direction"]["default"], "both")
        full = legacy.LEGACY_SCHEMAS["project_map_full_graph"]["parameters"]
        self.assertEqual(full["properties"]["nodeLimit"]["minimum"], 1)
        self.assertEqual(full["properties"]["nodeLimit"]["maximum"], 5000)
        self.assertEqual(full["properties"]["nodeLimit"]["default"], 500)
        self.assertEqual(full["properties"]["edgeLimit"]["maximum"], 10000)
        self.assertEqual(full["properties"]["layers"]["maxItems"], 32)

    def test_clear_cache_requires_explicit_scope_and_models_conditional_project(self):
        parameters = legacy.LEGACY_SCHEMAS["project_map_clear_cache"]["parameters"]
        self.assertEqual(parameters["required"], ["scope"])
        self.assertIn("allOf", parameters)
        self.assertNotIn("default", parameters["properties"]["scope"])


class LegacyValidationTests(unittest.TestCase):
    def assert_rejected(self, tool: str, value):
        with self.assertRaises(legacy.LegacyArgumentsError):
            legacy.validate_legacy_arguments(tool, value)

    def test_all_valid_shapes_are_detached_and_defaults_are_applied_only_when_absent(self):
        for tool in ALL_TOOLS:
            value = valid_arguments(tool)
            with self.subTest(tool=tool):
                result = legacy.validate_legacy_arguments(tool, value)
                self.assertIsNot(result, value)
                self.assertEqual(value, valid_arguments(tool))
        self.assertEqual(
            legacy.validate_legacy_arguments("project_map_expand", valid_arguments("project_map_expand"))["direction"],
            "both",
        )
        full = legacy.validate_legacy_arguments("project_map_full_graph", valid_arguments("project_map_full_graph"))
        self.assertEqual(full["nodeLimit"], 500)
        self.assertEqual(full["edgeLimit"], 1200)
        self.assertEqual(full["layers"], [])
        self.assertEqual(full["features"], [])

    def test_unknown_tool_and_unknown_fields_are_rejected(self):
        self.assert_rejected("project_map_unknown", {})
        for tool in ALL_TOOLS:
            value = valid_arguments(tool)
            value["base_url"] = "http://127.0.0.1:1"
            with self.subTest(tool=tool):
                self.assert_rejected(tool, value)
        for forbidden in ("worktree", "expectedRevision", "authorized", "dryRun", "method", "path", "headers"):
            value = valid_arguments("project_map_health")
            value[forbidden] = True
            self.assert_rejected("project_map_health", value)

    def test_project_is_literal_bounded_and_path_safe(self):
        invalid = ("", "   ", "a/b", r"a\b", "a..b", "x" * 201, "a\u0000b", 1)
        for tool in ("project_map_structure", "project_map_search", "project_map_expand", "project_map_full_graph", "project_map_index"):
            for candidate in invalid:
                value = valid_arguments(tool)
                value["project"] = candidate
                with self.subTest(tool=tool, candidate=repr(candidate)):
                    self.assert_rejected(tool, value)
        literal = valid_arguments("project_map_structure")
        literal["project"] = " project "
        self.assertEqual(legacy.validate_legacy_arguments("project_map_structure", literal)["project"], " project ")

    def test_query_and_node_id_are_literal_nonblank_control_free_and_bounded(self):
        for tool, key in (("project_map_search", "query"), ("project_map_expand", "nodeId")):
            for candidate in ("", " \t ", "a\nb", "x" * 501, 1):
                value = valid_arguments(tool)
                value[key] = candidate
                with self.subTest(tool=tool, candidate=repr(candidate)):
                    self.assert_rejected(tool, value)
            value = valid_arguments(tool)
            value[key] = " a?b&c#d "
            self.assertEqual(legacy.validate_legacy_arguments(tool, value)[key], " a?b&c#d ")

    def test_expand_direction_is_strict(self):
        for invalid in (None, "", "sideways", 1, []):
            value = valid_arguments("project_map_expand")
            value["direction"] = invalid
            self.assert_rejected("project_map_expand", value)
        for direction in ("both", "in", "out"):
            value = valid_arguments("project_map_expand")
            value["direction"] = direction
            self.assertEqual(legacy.validate_legacy_arguments("project_map_expand", value)["direction"], direction)

    def test_full_graph_limits_are_strict_integers_and_bounded(self):
        for key, invalid_values in (
            ("nodeLimit", (True, 1.0, 0, 5001, "1")),
            ("edgeLimit", (True, 1.0, 0, 10001, "1")),
        ):
            for invalid in invalid_values:
                value = valid_arguments("project_map_full_graph")
                value[key] = invalid
                with self.subTest(key=key, invalid=repr(invalid)):
                    self.assert_rejected("project_map_full_graph", value)

    def test_full_graph_filters_reject_csv_control_blank_type_and_count_injection(self):
        for key in ("layers", "features"):
            for invalid in ("one", [1], [""], ["   "], ["a,b"], ["a\nb"], ["x" * 201], ["x"] * 33):
                value = valid_arguments("project_map_full_graph")
                value[key] = invalid
                with self.subTest(key=key, invalid=repr(invalid)):
                    self.assert_rejected("project_map_full_graph", value)
        value = valid_arguments("project_map_full_graph")
        value.update(layers=["API", "Domain"], features=["Search"])
        self.assertEqual(legacy.validate_legacy_arguments("project_map_full_graph", value), {
            "project": "hermes-project-map",
            "nodeLimit": 500,
            "edgeLimit": 1200,
            "layers": ["API", "Domain"],
            "features": ["Search"],
        })

    def test_clear_cache_scope_is_explicit_and_conditional(self):
        for invalid in ({}, {"scope": None}, {"scope": ""}, {"scope": "global"}, {"scope": "project"}, {"scope": "all", "project": "p"}):
            self.assert_rejected("project_map_clear_cache", invalid)
        self.assertEqual(
            legacy.validate_legacy_arguments("project_map_clear_cache", {"scope": "all"}),
            {"scope": "all"},
        )
        self.assertEqual(
            legacy.validate_legacy_arguments("project_map_clear_cache", {"scope": "project", "project": "p"}),
            {"scope": "project", "project": "p"},
        )

    def test_json_schema_draft2020_and_runtime_reject_reviewer_counters_and_1a_abs_nodeid(self):
        # LM-REVIEW-3 + 1A: Draft202012Validator MUST reject the five contra-examples
        # (traversal, ASCII ws-only, control, CSV/comma) + abs nodeId spelling.
        # Runtime validate also rejects. Runtime MAY be stricter only for Unicode ws-only
        # (str.strip() vs regex in schema); this slack is documented, never relax Python.
        try:
            from jsonschema import Draft202012Validator
        except ImportError:
            self.skipTest("jsonschema not installed in this env; parity asserted via runtime only")
        contra_examples = [
            # project: traversal / ws / control
            ("project_map_structure", {"project": "../other"}),
            ("project_map_structure", {"project": "   "}),
            ("project_map_search", {"project": "hermes-project-map", "query": "a\nb"}),
            # nodeId abs (1A option A, also in schema)
            ("project_map_expand", {"project": "p", "nodeId": "/abs/path#sym"}),
            ("project_map_expand", {"project": "p", "nodeId": r"C:\foo#bar"}),
            ("project_map_expand", {"project": "p", "nodeId": r"\\unc\share#f"}),
            # layers/features: comma / ws / control
            ("project_map_full_graph", {"project": "p", "layers": ["a,b"]}),
            ("project_map_full_graph", {"project": "p", "layers": ["   "]}),
            ("project_map_full_graph", {"project": "p", "features": ["a\x00b"]}),
        ]
        for tool, val in contra_examples:
            with self.subTest(tool=tool, val=val):
                schema = legacy.LEGACY_SCHEMAS[tool]["parameters"]
                v = Draft202012Validator(schema)
                errs = list(v.iter_errors(val))
                self.assertGreater(len(errs), 0, "Draft2020 must reject")
                self.assert_rejected(tool, val)
        # positives still accepted by both
        for tool in ALL_TOOLS:
            val = valid_arguments(tool)
            schema = legacy.LEGACY_SCHEMAS[tool]["parameters"]
            Draft202012Validator(schema).validate(val)
            legacy.validate_legacy_arguments(tool, val)  # no raise
        # note on slack (unicode ws): e.g. non-ascii ws-only caught by runtime strip but may pass regex
        # this is the only documented difference; schema is not relaxed.


if __name__ == "__main__":
    unittest.main()
