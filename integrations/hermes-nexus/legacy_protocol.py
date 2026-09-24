"""Strict projection and provenance for legacy Project Map responses."""

from __future__ import annotations

import json
import math
import re
from typing import Any, Callable

from .client import NexusClientError


LEGACY_ENVELOPE_MAX_BYTES = 65_536
_MAX_STRING = 1024
_NODE_ID_MAX = 500
_WINDOWS_ABSOLUTE = re.compile(r"^[A-Za-z]:[/\\]")


def _is_absolute_identity_spelling(value: str) -> bool:
    """Detect spelling of absolute POSIX /..., Windows C:\\ / C:/ or UNC \\... (LM-REVIEW-1 option A: fail-closed; path never in error)."""
    if not isinstance(value, str) or not value:
        return False
    if value.startswith(("/", "\\")):
        return True
    if _WINDOWS_ABSOLUTE.match(value):
        return True
    return False


_MESSAGES = {
    "project_map_health": "Legacy service health was read.",
    "project_map_projects": "Legacy canonical-project summaries were read.",
    "project_map_structure": "Legacy canonical-project structure was read.",
    "project_map_search": "Legacy canonical-project graph search completed.",
    "project_map_expand": "Legacy canonical-project node expansion completed.",
    "project_map_full_graph": "Legacy canonical-project graph was read within requested output limits.",
    "project_map_cache_stats": "Legacy aggregate process-cache statistics were read.",
}

_LIMITATIONS = {
    "project_map_health": ["service_identity_not_proven"],
    "project_map_projects": ["canonical_names_not_revision_bound", "project_list_may_be_incomplete"],
    "project_map_structure": [
        "canonical_project_not_revision_bound",
        "derived_structure_may_be_incomplete",
        "nodejs_structure_may_be_empty",
    ],
    "project_map_search": ["canonical_project_not_revision_bound", "derived_graph_may_be_incomplete"],
    "project_map_expand": ["canonical_project_not_revision_bound", "derived_graph_may_be_incomplete"],
    "project_map_full_graph": [
        "canonical_project_not_revision_bound",
        "derived_graph_may_be_incomplete",
        "output_limits_do_not_bound_server_analysis",
    ],
    "project_map_cache_stats": ["aggregate_cache_metadata_not_freshness_evidence"],
}

_COUNT_FIELDS = (
    "csprojCount",
    "slnCount",
    "tsFileCount",
    "tsxFileCount",
    "jsFileCount",
    "jsxFileCount",
    "sourceFileCount",
)
_NODE_FIELDS = (
    "id",
    "label",
    "kind",
    "category",
    "namespace",
    "projectName",
    "layer",
    "feature",
    "file",
    "subtitle",
)
_EDGE_FIELDS = ("id", "from", "to", "relation", "label")


def _invalid(status: int | None = 200) -> NexusClientError:
    return NexusClientError("nexus_invalid_response", "protocol", status)


def _require(record: Any, key: str) -> Any:
    if not isinstance(record, dict) or key not in record:
        raise _invalid()
    return record[key]


def _text(value: Any, *, maximum: int = _MAX_STRING, nullable: bool = False) -> str | None:
    if nullable and value is None:
        return None
    if not isinstance(value, str) or len(value) > maximum:
        raise _invalid()
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise _invalid()
    return value


def _required_text(value: Any, *, maximum: int = _MAX_STRING) -> str:
    result = _text(value, maximum=maximum)
    assert result is not None
    return result


def _boolean(value: Any) -> bool:
    if type(value) is not bool:
        raise _invalid()
    return value


def _number(value: Any, *, integer: bool = False) -> int | float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _invalid()
    if integer and type(value) is not int:
        raise _invalid()
    try:
        finite = math.isfinite(value)
    except OverflowError:
        raise _invalid() from None
    if not finite or value < 0:
        raise _invalid()
    return value


def _relative_path(value: Any, *, nullable: bool = False, allow_dot: bool = False) -> str | None:
    result = _text(value, nullable=nullable)
    if result is None:
        return None
    if result == "." and allow_dot:
        return result
    if not result or result.startswith(("/", "\\")) or _WINDOWS_ABSOLUTE.match(result):
        raise _invalid()
    if "\\" in result or any(part in {"", ".", ".."} for part in result.split("/")):
        raise _invalid()
    return result


def _optional(record: dict[str, Any], key: str, validator: Callable[[Any], Any], target: dict[str, Any]) -> None:
    if key in record:
        target[key] = validator(record[key])


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise _invalid()
    return [_required_text(item) for item in value]


def _project_health(data: dict[str, Any], _arguments: dict[str, Any]) -> dict[str, Any]:
    status = _text(_require(data, "status"))
    if status != "ok":
        raise _invalid()
    return {
        "status": status,
        "uptime": _number(_require(data, "uptime")),
        "timestamp": _text(_require(data, "timestamp")),
    }


def _project_projects(data: dict[str, Any], _arguments: dict[str, Any]) -> dict[str, Any]:
    projects = _require(data, "projects")
    if not isinstance(projects, list):
        raise _invalid()
    projected = []
    for item in projects:
        if not isinstance(item, dict):
            raise _invalid()
        output = {
            "name": _text(_require(item, "name")),
            "relativePath": _relative_path(_require(item, "relativePath"), allow_dot=True),
        }
        for key, validator in (
            ("exists", _boolean),
            ("projectType", _text),
            ("typeLabel", _text),
            ("supported", _boolean),
        ):
            _optional(item, key, validator, output)
        for key in _COUNT_FIELDS:
            _optional(item, key, lambda value: _number(value, integer=True), output)
        projected.append(output)
    return {"projects": projected}


def _project_solution(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _invalid()
    return {
        "name": _text(_require(value, "name")),
        "path": _relative_path(_require(value, "path"), nullable=True),
        "count": _number(_require(value, "count"), integer=True),
    }


def _structure_projects(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise _invalid()
    output = []
    for item in value:
        if not isinstance(item, dict):
            raise _invalid()
        projected = {
            "name": _text(_require(item, "name")),
            "layer": _text(_require(item, "layer")),
            "path": _relative_path(_require(item, "path")),
            # LM-REVIEW-2: accept "" ONLY for structure.projects[].directory (from .NET root csproj);
            # project to "." . Reject "" in every other path field. Never generalize "empty=root".
            "directory": "." if _require(item, "directory") == "" else _relative_path(_require(item, "directory"), allow_dot=True),
            "featureCount": _number(_require(item, "featureCount"), integer=True),
        }
        count_keys = [key for key in ("csFileCount", "sourceFileCount") if key in item]
        if len(count_keys) != 1:
            raise _invalid()
        projected[count_keys[0]] = _number(item[count_keys[0]], integer=True)
        output.append(projected)
    return output


def _structure_layers(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise _invalid()
    output = []
    for item in value:
        if not isinstance(item, dict):
            raise _invalid()
        projected = {
            "name": _text(_require(item, "name")),
            "projectCount": _number(_require(item, "projectCount"), integer=True),
            "projects": _string_list(_require(item, "projects")),
        }
        count_keys = [key for key in ("csFileCount", "sourceFileCount") if key in item]
        if len(count_keys) != 1:
            raise _invalid()
        projected[count_keys[0]] = _number(item[count_keys[0]], integer=True)
        output.append(projected)
    return output


def _structure_features(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise _invalid()
    output = []
    for item in value:
        if not isinstance(item, dict):
            raise _invalid()
        output.append({
            "name": _text(_require(item, "name")),
            "symbolCount": _number(_require(item, "symbolCount"), integer=True),
            "projectNames": _string_list(_require(item, "projectNames")),
            "layers": _string_list(_require(item, "layers")),
        })
    return output


def _project_structure(data: dict[str, Any], arguments: dict[str, Any]) -> dict[str, Any]:
    project = _text(_require(data, "project"))
    if project != arguments["project"]:
        raise _invalid()
    output = {
        "project": project,
        "solution": _project_solution(_require(data, "solution")),
        "projects": _structure_projects(_require(data, "projects")),
        "layers": _structure_layers(_require(data, "layers")),
        "features": _structure_features(_require(data, "features")),
        "canSubdivide": _boolean(_require(data, "canSubdivide")),
        "suggestedModes": _string_list(_require(data, "suggestedModes")),
    }
    _optional(data, "projectType", _text, output)
    return output


def _graph_node(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _invalid()
    node_id = _require(value, "id")
    if _is_absolute_identity_spelling(node_id):
        raise _invalid()
    output = {
        "id": _text(node_id, maximum=_NODE_ID_MAX),
        "label": _text(_require(value, "label")),
    }
    for key in _NODE_FIELDS[2:]:
        validator = (
            (lambda candidate: _relative_path(candidate, nullable=True))
            if key == "file"
            else (lambda candidate: _text(candidate, nullable=True))
        )
        _optional(value, key, validator, output)
    return output


def _graph_edge(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _invalid()
    for key in ("id", "from", "to"):
        val = _require(value, key)
        if _is_absolute_identity_spelling(val):
            raise _invalid()
    output = {
        key: _text(_require(value, key), maximum=_NODE_ID_MAX if key in {"from", "to"} else _MAX_STRING)
        for key in ("id", "from", "to", "relation")
    }
    _optional(value, "label", lambda candidate: _text(candidate, nullable=True), output)
    return output


def _project_graph(data: dict[str, Any], arguments: dict[str, Any], *, full: bool) -> dict[str, Any]:
    if "success" in data:
        success = _boolean(data["success"])
        if not success:
            raise NexusClientError(
                "nexus_legacy_analysis_unavailable",
                "analysis",
                200,
                message="Legacy analysis is unavailable for this request.",
            )
    nodes_value = _require(data, "nodes")
    edges_value = _require(data, "edges")
    if not isinstance(nodes_value, list) or not isinstance(edges_value, list):
        raise _invalid()
    nodes = [_graph_node(node) for node in nodes_value]
    edges = [_graph_edge(edge) for edge in edges_value]
    ids = [node["id"] for node in nodes]
    edge_ids = [edge["id"] for edge in edges]
    if len(ids) != len(set(ids)) or len(edge_ids) != len(set(edge_ids)):
        raise _invalid()
    known_ids = set(ids)
    if any(edge["from"] not in known_ids or edge["to"] not in known_ids for edge in edges):
        raise _invalid()
    if full and (len(nodes) > arguments["nodeLimit"] or len(edges) > arguments["edgeLimit"]):
        raise _invalid()
    output: dict[str, Any] = {"nodes": nodes, "edges": edges}
    if "success" in data:
        output["success"] = True
    _optional(data, "projectType", _text, output)
    _optional(data, "limited", _boolean, output)
    for key in ("originalNodeCount", "originalEdgeCount"):
        _optional(data, key, lambda value: _number(value, integer=True), output)
    if full:
        original_nodes = output.get("originalNodeCount")
        original_edges = output.get("originalEdgeCount")
        # LM-REVIEW-4: when limited=false, check each *present* originalCount independently vs returned len.
        # Absence of the counterpart does NOT infer 0 or unlimited. limited=false + one mismatch (other absent) rejects.
        # limited=true: do not infer missing dimension or synthesize counts.
        # Scope limited to this full-graph block (no extension to search/expand).
        if original_nodes is not None and original_nodes < len(nodes):
            raise _invalid()
        if original_edges is not None and original_edges < len(edges):
            raise _invalid()
        limited = output.get("limited")
        if limited is False:
            if original_nodes is not None and original_nodes != len(nodes):
                raise _invalid()
            if original_edges is not None and original_edges != len(edges):
                raise _invalid()
        if limited is not None and original_nodes is not None and original_edges is not None:
            expected_limited = original_nodes > len(nodes) or original_edges > len(edges)
            if limited is not expected_limited:
                raise _invalid()
    return output


def _project_cache(data: dict[str, Any], _arguments: dict[str, Any]) -> dict[str, Any]:
    symbols = _require(data, "symbols")
    analysis = _require(data, "analysis")
    if not isinstance(symbols, dict) or not isinstance(analysis, dict):
        raise _invalid()
    return {
        "symbols": {
            "ttlMs": _number(_require(symbols, "ttlMs"), integer=True),
            "size": _number(_require(symbols, "size"), integer=True),
        },
        "analysis": {
            key: _number(_require(analysis, key), integer=True)
            for key in ("ttlMs", "maxEntries", "size", "hits", "misses", "stale", "evictions")
        },
    }


_PROJECTORS: dict[str, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "project_map_health": _project_health,
    "project_map_projects": _project_projects,
    "project_map_structure": _project_structure,
    "project_map_search": lambda data, arguments: _project_graph(data, arguments, full=False),
    "project_map_expand": lambda data, arguments: _project_graph(data, arguments, full=False),
    "project_map_full_graph": lambda data, arguments: _project_graph(data, arguments, full=True),
    "project_map_cache_stats": _project_cache,
}


def _provenance(tool: str, arguments: dict[str, Any]) -> dict[str, Any]:
    project_scoped = "project" in arguments
    cache_behavior = (
        "may_reuse_process_cache"
        if tool in {"project_map_search", "project_map_expand", "project_map_full_graph"}
        else "not_applicable"
    )
    return {
        "contractVersion": "legacy-map-v1",
        "basis": "legacy_http",
        "scope": "canonical_project" if project_scoped else "service",
        "requestedProject": arguments.get("project"),
        "revisionBinding": "not_provided",
        "cacheBehavior": cache_behavior,
        "trust": "untrusted_service_data",
    }


def validate_legacy_success(tool: str, envelope: dict[str, Any], arguments: dict[str, Any]) -> dict[str, Any]:
    """Validate one HTTP 200 legacy envelope and emit a bounded adapter envelope."""
    projector = _PROJECTORS.get(tool)
    if projector is None or not isinstance(envelope, dict):
        raise _invalid()
    if envelope.get("ok") is not True or "error" in envelope or not isinstance(envelope.get("data"), dict):
        raise _invalid()
    data = envelope["data"]
    if tool in {"project_map_search", "project_map_expand", "project_map_full_graph"} and data.get("success") is False:
        raise NexusClientError(
            "nexus_legacy_analysis_unavailable",
            "analysis",
            200,
            message="Legacy analysis is unavailable for this request.",
        )
    result = {
        "tool": tool,
        "ok": True,
        "data": projector(data, arguments),
        "message": _MESSAGES[tool],
        "provenance": _provenance(tool, arguments),
        "limitations": list(_LIMITATIONS[tool]),
    }
    try:
        encoded = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise _invalid() from None
    if len(encoded) > LEGACY_ENVELOPE_MAX_BYTES:
        raise NexusClientError(
            "nexus_client_response_too_large",
            "transport",
            200,
        )
    return result
