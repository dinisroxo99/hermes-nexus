from __future__ import annotations

import importlib.util
import math
import sys
import unittest
from copy import deepcopy
from pathlib import Path


def _load_module():
    path = Path(__file__).parents[2] / "integrations" / "hermes-nexus" / "schemas.py"
    spec = importlib.util.spec_from_file_location("hermes_nexus_test_schemas", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


schemas = _load_module()
HEX40 = "a" * 40
HEX64 = "b" * 64


def context_args():
    return {
        "projectId": "prj_123",
        "worktree": {"rootId": "local", "relativePath": "checkout"},
        "expectedRevision": {
            "status": "available",
            "commitSha": HEX40,
            "branch": "feature/test",
            "dirty": False,
            "isLinkedWorktree": True,
        },
        "task": {"title": "Review route", "paths": ["src/route.js"]},
    }


def impact_args():
    value = context_args()
    return {
        "projectId": value["projectId"],
        "worktree": value["worktree"],
        "expectedRevision": {
            **value["expectedRevision"],
            "repositoryId": HEX64,
            "worktreeId": "c" * 64,
        },
        "paths": ["src/route.js"],
    }


class SchemaShapeTests(unittest.TestCase):
    def test_public_tool_schemas_are_strict_and_named(self):
        for expected, schema in (
            ("project_task_context", schemas.PROJECT_TASK_CONTEXT_SCHEMA),
            ("project_impact", schemas.PROJECT_IMPACT_SCHEMA),
        ):
            self.assertEqual(schema["name"], expected)
            self.assertFalse(schema["parameters"]["additionalProperties"])
            self.assertIn("read-only", schema["description"].lower())
            self.assertIn("partial", schema["description"].lower())
            self.assertIn("untrusted", schema["description"].lower())

    def test_context_schema_pairs_optional_opaque_ids(self):
        revision = schemas.CONTEXT_EXPECTED_REVISION_SCHEMA
        self.assertIn("oneOf", revision)
        self.assertNotIn("repositoryId", revision["required"])

    def test_impact_schema_requires_opaque_ids(self):
        required = schemas.IMPACT_EXPECTED_REVISION_SCHEMA["required"]
        self.assertIn("repositoryId", required)
        self.assertIn("worktreeId", required)


class ValidationTests(unittest.TestCase):
    def assert_context_rejected(self, mutate):
        value = context_args()
        mutate(value)
        with self.assertRaises(schemas.ArgumentsError):
            schemas.validate_task_context_arguments(value)

    def assert_impact_rejected(self, mutate):
        value = impact_args()
        mutate(value)
        with self.assertRaises(schemas.ArgumentsError):
            schemas.validate_impact_arguments(value)

    def test_valid_context_accepts_detached_and_paired_ids_without_mutation(self):
        value = context_args()
        value["expectedRevision"]["branch"] = None
        value["expectedRevision"].update(repositoryId=HEX64, worktreeId="c" * 64)
        value["task"].update(id="", description="", symbols=[])
        value["limits"] = {"files": 1.5, "maxBytes": -2}
        value["includeExcerpts"] = False
        result = schemas.validate_task_context_arguments(value)
        self.assertEqual(result, value)
        self.assertIsNot(result, value)

    def test_valid_impact_preserves_duplicates_order_and_server_owned_limits(self):
        value = impact_args()
        value["paths"] = ["b.js", "a.js", "b.js"]
        value["limits"] = {"depth": -1, "compactBytes": 999999999}
        value["includeTests"] = True
        self.assertEqual(schemas.validate_impact_arguments(value), value)

    def test_missing_required_and_unknown_top_level_rejected(self):
        self.assert_context_rejected(lambda value: value.pop("task"))
        self.assert_context_rejected(lambda value: value.update(provider="bad"))
        self.assert_impact_rejected(lambda value: value.pop("paths"))
        self.assert_impact_rejected(lambda value: value.update(base_url="http://127.0.0.1:1"))

    def test_every_required_field_is_enforced(self):
        context_cases: list = [
            lambda value, field=field: value.pop(field)
            for field in ("projectId", "worktree", "expectedRevision", "task")
        ]
        context_cases.extend((
            lambda value: value["worktree"].pop("rootId"),
            lambda value: value["worktree"].pop("relativePath"),
            lambda value: value["task"].pop("title"),
        ))
        for field in ("status", "commitSha", "branch", "dirty", "isLinkedWorktree"):
            context_cases.append(lambda value, name=field: value["expectedRevision"].pop(name))
        for index, mutate in enumerate(context_cases):
            with self.subTest(tool="context", case=index):
                self.assert_context_rejected(mutate)

        impact_cases: list = [
            lambda value, field=field: value.pop(field)
            for field in ("projectId", "worktree", "expectedRevision", "paths")
        ]
        impact_cases.extend((
            lambda value: value["worktree"].pop("rootId"),
            lambda value: value["worktree"].pop("relativePath"),
        ))
        for field in (
            "status", "commitSha", "branch", "dirty", "isLinkedWorktree",
            "repositoryId", "worktreeId",
        ):
            impact_cases.append(lambda value, name=field: value["expectedRevision"].pop(name))
        for index, mutate in enumerate(impact_cases):
            with self.subTest(tool="impact", case=index):
                self.assert_impact_rejected(mutate)

    def test_unknown_nested_fields_rejected(self):
        self.assert_context_rejected(lambda value: value["worktree"].update(extra=True))
        self.assert_context_rejected(lambda value: value["task"].update(extra=True))
        self.assert_context_rejected(lambda value: value["expectedRevision"].update(revision="bad"))
        self.assert_impact_rejected(lambda value: value.update(limits={"files": 1}))
        self.assert_context_rejected(lambda value: value.update(limits={"extra": 1}))
        self.assert_impact_rejected(lambda value: value["worktree"].update(extra=True))
        self.assert_impact_rejected(lambda value: value["expectedRevision"].update(extra=True))

    def test_top_level_and_nested_type_matrix_rejected(self):
        context_cases = (
            lambda value: value.update(projectId=1),
            lambda value: value.update(worktree=[]),
            lambda value: value.update(expectedRevision=[]),
            lambda value: value.update(task="task"),
            lambda value: value.update(limits=[]),
            lambda value: value.update(includeExcerpts=0),
            lambda value: value["worktree"].update(rootId=1),
            lambda value: value["worktree"].update(relativePath=1),
            lambda value: value["expectedRevision"].update(branch=1),
            lambda value: value["task"].update(id=1),
            lambda value: value["task"].update(description=1),
            lambda value: value["task"].update(symbols="symbol"),
        )
        impact_cases = (
            lambda value: value.update(projectId=1),
            lambda value: value.update(worktree=[]),
            lambda value: value.update(expectedRevision=[]),
            lambda value: value.update(paths="path"),
            lambda value: value.update(limits=[]),
            lambda value: value.update(includeTests=0),
            lambda value: value["expectedRevision"].update(repositoryId=1),
            lambda value: value["expectedRevision"].update(worktreeId=1),
            lambda value: value.update(paths=[1]),
        )
        for index, mutate in enumerate(context_cases):
            with self.subTest(tool="context", case=index):
                self.assert_context_rejected(mutate)
        for index, mutate in enumerate(impact_cases):
            with self.subTest(tool="impact", case=index):
                self.assert_impact_rejected(mutate)

    def test_project_id_syntax_and_string_bounds_rejected(self):
        for project_id in ("", "-bad", "bad space", "x" * 129):
            self.assert_context_rejected(lambda value, candidate=project_id: value.update(projectId=candidate))
        self.assert_context_rejected(lambda value: value["worktree"].update(rootId=""))
        self.assert_context_rejected(lambda value: value["task"].update(title="x" * 201))
        self.assert_impact_rejected(lambda value: value.update(paths=[]))
        self.assert_impact_rejected(lambda value: value.update(paths=["x"] * 33))

    def test_revision_is_explicit_clean_available_linked_subset(self):
        for field, invalid in (
            ("status", "unavailable"),
            ("dirty", True),
            ("isLinkedWorktree", False),
            ("commitSha", "HEAD"),
            ("commitSha", "A" * 40),
            ("branch", ""),
        ):
            self.assert_context_rejected(
                lambda value, name=field, candidate=invalid: value["expectedRevision"].update({name: candidate})
            )

    def test_context_opaque_ids_are_both_present_or_both_absent(self):
        self.assert_context_rejected(lambda value: value["expectedRevision"].update(repositoryId=HEX64))
        self.assert_context_rejected(lambda value: value["expectedRevision"].update(worktreeId=HEX64))
        self.assert_context_rejected(
            lambda value: value["expectedRevision"].update(repositoryId="f" * 63, worktreeId=HEX64)
        )

    def test_impact_opaque_ids_are_mandatory(self):
        self.assert_impact_rejected(lambda value: value["expectedRevision"].pop("repositoryId"))
        self.assert_impact_rejected(lambda value: value["expectedRevision"].pop("worktreeId"))

    def test_bool_nonfinite_fractional_integer_and_coercion_rejected(self):
        for invalid in (True, math.nan, math.inf, "1"):
            self.assert_context_rejected(
                lambda value, candidate=invalid: value.update(limits={"files": candidate})
            )
        for invalid in (True, 1.0, math.nan, math.inf, "1"):
            self.assert_impact_rejected(
                lambda value, candidate=invalid: value.update(limits={"depth": candidate})
            )
        self.assert_context_rejected(lambda value: value.update(includeExcerpts=1))
        self.assert_impact_rejected(lambda value: value.update(includeTests="false"))

    def test_wrong_container_and_item_types_rejected(self):
        self.assert_context_rejected(lambda value: value.update(task=[]))
        self.assert_context_rejected(lambda value: value["task"].update(paths=[1]))
        self.assert_impact_rejected(lambda value: value.update(paths="src/a.js"))
        self.assert_impact_rejected(lambda value: value.update(worktree=None))


if __name__ == "__main__":
    unittest.main()
