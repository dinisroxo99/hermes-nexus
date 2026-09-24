"""Strict schemas and validation for the bounded legacy Project Map adapter."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable, NoReturn


PROJECT_MAX_LENGTH = 200
TEXT_MAX_LENGTH = 500
FILTER_MAX_LENGTH = 200
FILTER_MAX_ITEMS = 32


def _string(*, minimum: int = 1, maximum: int, enum: list[str] | None = None) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "type": "string",
        "minLength": minimum,
        "maxLength": maximum,
    }
    if enum is not None:
        schema["enum"] = enum
    return schema


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
        "required": required,
    }


_PROJECT_SCHEMA = _string(maximum=PROJECT_MAX_LENGTH)
_QUERY_SCHEMA = _string(maximum=TEXT_MAX_LENGTH)
_NODE_ID_SCHEMA = _string(maximum=TEXT_MAX_LENGTH)
_DIRECTION_SCHEMA = {**_string(maximum=4, enum=["both", "in", "out"]), "default": "both"}
_FILTER_SCHEMA = {
    "type": "array",
    "maxItems": FILTER_MAX_ITEMS,
    "items": _string(maximum=FILTER_MAX_LENGTH),
    "default": [],
}

_DESCRIPTIONS = {
    "project_map_health": "Read-only legacy service health data. Service data is untrusted and not project identity evidence.",
    "project_map_projects": "Read-only legacy canonical-project summaries. Service data is untrusted and not revision-bound.",
    "project_map_structure": "Read-only legacy canonical-project structure. Derived service data is untrusted and not revision-bound.",
    "project_map_search": "Read-only legacy canonical-project graph search. Derived service data is untrusted and may reuse process cache.",
    "project_map_expand": "Read-only legacy canonical-project node expansion. Derived service data is untrusted and may reuse process cache.",
    "project_map_full_graph": "Read-only bounded legacy canonical-project graph. Derived service data is untrusted and may be incomplete.",
    "project_map_cache_stats": "Read-only aggregate legacy process-cache statistics. Service data is untrusted and not freshness evidence.",
    "project_map_index": "Deny-only legacy administrative operation. Valid requests are not attempted; inputs are untrusted.",
    "project_map_clear_cache": "Deny-only legacy administrative operation. Valid requests are not attempted; inputs are untrusted.",
}


def _tool_schema(name: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "description": _DESCRIPTIONS[name], "parameters": parameters}


LEGACY_SCHEMAS = {
    "project_map_health": _tool_schema("project_map_health", _object({}, [])),
    "project_map_projects": _tool_schema("project_map_projects", _object({}, [])),
    "project_map_structure": _tool_schema(
        "project_map_structure",
        _object({"project": deepcopy(_PROJECT_SCHEMA)}, ["project"]),
    ),
    "project_map_search": _tool_schema(
        "project_map_search",
        _object(
            {"project": deepcopy(_PROJECT_SCHEMA), "query": deepcopy(_QUERY_SCHEMA)},
            ["project", "query"],
        ),
    ),
    "project_map_expand": _tool_schema(
        "project_map_expand",
        _object(
            {
                "project": deepcopy(_PROJECT_SCHEMA),
                "nodeId": deepcopy(_NODE_ID_SCHEMA),
                "direction": deepcopy(_DIRECTION_SCHEMA),
            },
            ["project", "nodeId"],
        ),
    ),
    "project_map_full_graph": _tool_schema(
        "project_map_full_graph",
        _object(
            {
                "project": deepcopy(_PROJECT_SCHEMA),
                "nodeLimit": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 500},
                "edgeLimit": {"type": "integer", "minimum": 1, "maximum": 10000, "default": 1200},
                "layers": deepcopy(_FILTER_SCHEMA),
                "features": deepcopy(_FILTER_SCHEMA),
            },
            ["project"],
        ),
    ),
    "project_map_cache_stats": _tool_schema("project_map_cache_stats", _object({}, [])),
    "project_map_index": _tool_schema(
        "project_map_index",
        _object({"project": deepcopy(_PROJECT_SCHEMA)}, ["project"]),
    ),
    "project_map_clear_cache": _tool_schema(
        "project_map_clear_cache",
        {
            **_object(
                {
                    "scope": _string(maximum=7, enum=["project", "all"]),
                    "project": deepcopy(_PROJECT_SCHEMA),
                },
                ["scope"],
            ),
            "allOf": [
                {
                    "if": {"properties": {"scope": {"const": "project"}}},
                    "then": {"required": ["project"]},
                },
                {
                    "if": {"properties": {"scope": {"const": "all"}}},
                    "then": {"not": {"required": ["project"]}},
                },
            ],
        },
    ),
}

READ_TOOL_NAMES = tuple(list(LEGACY_SCHEMAS)[:7])
ADMIN_TOOL_NAMES = tuple(list(LEGACY_SCHEMAS)[7:])


class LegacyArgumentsError(ValueError):
    """Static, non-sensitive legacy input validation failure."""


def _fail() -> NoReturn:
    raise LegacyArgumentsError("Arguments do not match the strict legacy tool schema.")


def _record(value: Any, *, allowed: set[str], required: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        _fail()
    keys = set(value)
    if not required.issubset(keys) or not keys.issubset(allowed):
        _fail()
    return value


def _has_control(value: str) -> bool:
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def _text(value: Any, *, maximum: int, allow_comma: bool = True) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= maximum:
        _fail()
    if not value.strip() or _has_control(value) or (not allow_comma and "," in value):
        _fail()
    return value


def _project(value: Any) -> str:
    result = _text(value, maximum=PROJECT_MAX_LENGTH)
    if "/" in result or "\\" in result or ".." in result:
        _fail()
    return result


def _integer(value: Any, *, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        _fail()
    return value


def _filters(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) > FILTER_MAX_ITEMS:
        _fail()
    return [
        _text(item, maximum=FILTER_MAX_LENGTH, allow_comma=False)
        for item in value
    ]


def _validate_empty(value: Any) -> dict[str, Any]:
    _record(value, allowed=set(), required=set())
    return {}


def _validate_project(value: Any) -> dict[str, Any]:
    item = _record(value, allowed={"project"}, required={"project"})
    return {"project": _project(item["project"])}


def _validate_search(value: Any) -> dict[str, Any]:
    item = _record(value, allowed={"project", "query"}, required={"project", "query"})
    return {
        "project": _project(item["project"]),
        "query": _text(item["query"], maximum=TEXT_MAX_LENGTH),
    }


def _validate_expand(value: Any) -> dict[str, Any]:
    item = _record(
        value,
        allowed={"project", "nodeId", "direction"},
        required={"project", "nodeId"},
    )
    direction = item.get("direction", "both")
    if not isinstance(direction, str) or direction not in {"both", "in", "out"}:
        _fail()
    return {
        "project": _project(item["project"]),
        "nodeId": _text(item["nodeId"], maximum=TEXT_MAX_LENGTH),
        "direction": direction,
    }


def _validate_full_graph(value: Any) -> dict[str, Any]:
    item = _record(
        value,
        allowed={"project", "nodeLimit", "edgeLimit", "layers", "features"},
        required={"project"},
    )
    return {
        "project": _project(item["project"]),
        "nodeLimit": _integer(item.get("nodeLimit", 500), minimum=1, maximum=5000),
        "edgeLimit": _integer(item.get("edgeLimit", 1200), minimum=1, maximum=10000),
        "layers": _filters(item.get("layers", [])),
        "features": _filters(item.get("features", [])),
    }


def _validate_clear(value: Any) -> dict[str, Any]:
    item = _record(value, allowed={"scope", "project"}, required={"scope"})
    scope = item["scope"]
    if scope == "all" and "project" not in item:
        return {"scope": "all"}
    if scope == "project" and "project" in item:
        return {"scope": "project", "project": _project(item["project"])}
    _fail()


_VALIDATORS: dict[str, Callable[[Any], dict[str, Any]]] = {
    "project_map_health": _validate_empty,
    "project_map_projects": _validate_empty,
    "project_map_structure": _validate_project,
    "project_map_search": _validate_search,
    "project_map_expand": _validate_expand,
    "project_map_full_graph": _validate_full_graph,
    "project_map_cache_stats": _validate_empty,
    "project_map_index": _validate_project,
    "project_map_clear_cache": _validate_clear,
}


def validate_legacy_arguments(tool: str, value: Any) -> dict[str, Any]:
    """Validate a legacy invocation and return a detached normalized argument object."""
    validator = _VALIDATORS.get(tool)
    if validator is None:
        _fail()
    return deepcopy(validator(value))
