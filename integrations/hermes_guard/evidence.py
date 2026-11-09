"""Validate the optional current-evidence envelope separately from operator grants."""
import hashlib
import json
import re


HEX = re.compile(r"[a-f0-9]{64}\Z")


def validate_evidence(value, authority, view):
    if value is None:
        return
    required = {"projectId", "taskId", "revision", "snapshotToken"}
    if (not isinstance(value, dict) or not required <= value.keys()
            or value.keys() - required - {"sources", "symbols", "relevantPaths"}
            or len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()) > 16384):
        raise ValueError("invalid_nexus_context")
    if not isinstance(value["projectId"], str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", value["projectId"]):
        raise ValueError("invalid_nexus_context")
    if (value["taskId"] != authority["task"] or value["revision"] != authority["revision"]
            or not isinstance(value["snapshotToken"], str) or not HEX.fullmatch(value["snapshotToken"])):
        raise ValueError("nexus_context_binding_mismatch")
    for field in ("sources", "symbols", "relevantPaths"):
        items = value.get(field, [])
        if not isinstance(items, list) or len(items) > 16:
            raise ValueError("invalid_nexus_context")
        for item in items:
            if field != "relevantPaths" and not isinstance(item, dict):
                raise ValueError("invalid_nexus_context")
            path = item if field == "relevantPaths" else item.get("path")
            if path not in authority["read"]:
                raise ValueError("nexus_context_path_outside_grant")
            if field == "sources":
                if set(item) != {"path", "sha256"} or item["sha256"] != hashlib.sha256((view / path).read_bytes()).hexdigest():
                    raise ValueError("nexus_source_mismatch")
            elif field == "symbols":
                name = item.get("name")
                if set(item) != {"name", "path"} or not isinstance(name, str) or not 1 <= len(name) <= 128 or not name.isprintable():
                    raise ValueError("invalid_nexus_context")
        if field == "sources" and len({item["path"] for item in items}) != len(items):
            raise ValueError("duplicate_nexus_source")
