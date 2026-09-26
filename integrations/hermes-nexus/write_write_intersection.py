"""Pure observable WRITE ∩ WRITE for ETAPA3A_CONTRACT.

observe_write_write_intersection(left, right) -> dict
Pure function. No Git, no network, no Nexus, no side-effects.
Does not mutate inputs.

Contract rules (exact):
- available + writeExhaustive + labels write/watch => compute exact intersection of write[].path
- result has "paths" (may be []), "writeExhaustive", "labelsEmitted", "emptyIsNotNoConflict": true
- [] case still emits "paths": [] + emptyIsNotNoConflict (emptyIsNotNoConflict)
- incomplete/rejected/not_evaluated (or non-qualifying) => no "paths" key
- never emit conflict/lock/lease keys
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def _extract(obj: Any, label: str) -> dict[str, Any]:
    """Return inner data if wrapper with ok=true+data, else deepcopy if dict."""
    if isinstance(obj, dict):
        if obj.get("ok") is True and isinstance(obj.get("data"), dict):
            return deepcopy(obj["data"])
        if obj.get("schemaVersion") == 1:
            return deepcopy(obj)
    return deepcopy(obj) if isinstance(obj, dict) else {}


def _get_write_paths(scope: dict[str, Any]) -> list[str]:
    write = scope.get("write") or []
    paths: list[str] = []
    for item in write:
        if isinstance(item, dict):
            p = item.get("path")
            if isinstance(p, str) and p and p not in paths:
                paths.append(p)
    return paths


def _qualifies(left_or_right: dict[str, Any]) -> bool:
    if not isinstance(left_or_right, dict):
        return False
    if left_or_right.get("status") != "available":
        return False
    if left_or_right.get("writeExhaustive") is not True:
        return False
    labels = left_or_right.get("labelsEmitted") or []
    if "write" not in labels or "watch" not in labels:
        return False
    return True


def observe_write_write_intersection(left: Any, right: Any) -> dict[str, Any]:
    """Return intersection observation or fail shape. Never mutates inputs."""
    l = _extract(left, "left")
    r = _extract(right, "right")

    if not _qualifies(l) or not _qualifies(r):
        l_status = l.get("status") if isinstance(l, dict) else None
        r_status = r.get("status") if isinstance(r, dict) else None
        l_fs = l.get("findingState") if isinstance(l, dict) else None
        r_fs = r.get("findingState") if isinstance(r, dict) else None
        if l_status == "not_evaluated" or r_status == "not_evaluated" or l_fs == "not_evaluated" or r_fs == "not_evaluated":
            status = "not_evaluated"
        elif l_status == "incomplete" or r_status == "incomplete":
            status = "incomplete"
        else:
            status = "rejected"
        res: dict[str, Any] = {"status": status, "writeExhaustive": False}
        err = (l.get("error") if isinstance(l, dict) else None) or (r.get("error") if isinstance(r, dict) else None)
        if err:
            res["error"] = err
        return res

    left_paths = _get_write_paths(l)
    right_set = set(_get_write_paths(r))
    inter_paths: list[str] = [p for p in left_paths if p in right_set]

    return {
        "status": "available",
        "writeExhaustive": True,
        "labelsEmitted": ["write", "watch"],
        "paths": inter_paths,
        "emptyIsNotNoConflict": True,
        # no conflict/lock/lease keys per contract
    }


__all__ = ["observe_write_write_intersection"]
