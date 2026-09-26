"""Pure observable WRITE ∩ WRITE for ETAPA3A_CONTRACT.

observe_write_write_intersection(left, right) -> dict
Pure function. No Git, no network, no Nexus, no side-effects.
Does not mutate inputs.

Contract (ETAPA3A_CONTRACT):
- Accepted side only with: status="available", writeExhaustive=true, labelsEmitted exactly ["write","watch"],
  valid "write" list, "revisionBinding" present, revisionBinding.dirty=false, revisionBinding.isLinkedWorktree=true.
- No {ok,data} unwrap ever. Any wrapper (ok present) => status="not_evaluated", reason="input_rejected"
- Compare projectId, revisionBinding.commitSha, revisionBinding.repositoryIdentity (worktreeId is NOT a gate).
- Success: status="observed", schemaVersion=1, analysisVersion="write-write-intersection-v1",
  echo identity (projectId + revisionBinding), paths=unique sorted by code point, emptyIsNotNoConflict=true.
  Never includes conflict/lock/lease.
- Reject: always status="not_evaluated" + closed "reason", NEVER "paths" key.
  scope_impact_not_evaluated or input not_evaluated => "input_not_evaluated"
  wrapper / rejected / bad write => "input_rejected"
  incomplete / !writeExhaustive => "input_incomplete"
  projectId differ => "identity_mismatch"
  commitSha or repositoryIdentity differ => "revision_mismatch"
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any


def _is_wrapper(obj: Any) -> bool:
    """Any presence of ok key means wrapper; treat as input_rejected (no unwrap)."""
    return isinstance(obj, dict) and "ok" in obj


def _get_write_paths(scope: dict[str, Any]) -> list[str]:
    write = scope.get("write") or []
    paths: list[str] = []
    for item in write:
        if isinstance(item, dict):
            p = item.get("path")
            if isinstance(p, str) and p and p not in paths:
                paths.append(p)
    return paths


def _qualifies(s: dict[str, Any]) -> bool:
    if not isinstance(s, dict):
        return False
    if s.get("status") != "available":
        return False
    if s.get("writeExhaustive") is not True:
        return False
    labels = s.get("labelsEmitted") or []
    if labels != ["write", "watch"]:
        return False
    if not isinstance(s.get("write"), list):
        return False
    rb = s.get("revisionBinding") or {}
    if rb.get("dirty") is not False:
        return False
    if rb.get("isLinkedWorktree") is not True:
        return False
    if "revisionBinding" not in s:
        return False
    return True


def observe_write_write_intersection(left: Any, right: Any) -> dict[str, Any]:
    """Return observed intersection or not_evaluated with closed reason. Never mutates, no unwrap."""
    if _is_wrapper(left) or _is_wrapper(right):
        return {"status": "not_evaluated", "reason": "input_rejected"}

    l = deepcopy(left) if isinstance(left, dict) else {}
    r = deepcopy(right) if isinstance(right, dict) else {}

    # map scope_impact_not_evaluated explicitly; direct not_evaluated
    for side in (l, r):
        if side.get("status") == "not_evaluated":
            return {"status": "not_evaluated", "reason": "input_not_evaluated"}
        if side.get("error") == "scope_impact_not_evaluated":
            return {"status": "not_evaluated", "reason": "input_not_evaluated"}

    # identity gates (projectId, commitSha, repositoryIdentity)
    if l.get("projectId") != r.get("projectId"):
        return {"status": "not_evaluated", "reason": "identity_mismatch"}

    lb = l.get("revisionBinding") or {}
    rb = r.get("revisionBinding") or {}
    if lb.get("commitSha") != rb.get("commitSha") or lb.get("repositoryIdentity") != rb.get("repositoryIdentity"):
        return {"status": "not_evaluated", "reason": "revision_mismatch"}

    if not _qualifies(l) or not _qualifies(r):
        ls = l.get("status")
        rs = r.get("status")
        l_we = l.get("writeExhaustive") is True
        r_we = r.get("writeExhaustive") is True
        if ls == "incomplete" or rs == "incomplete" or not l_we or not r_we:
            return {"status": "not_evaluated", "reason": "input_incomplete"}
        return {"status": "not_evaluated", "reason": "input_rejected"}

    left_paths = _get_write_paths(l)
    right_set = set(_get_write_paths(r))
    inter_paths: list[str] = sorted(p for p in left_paths if p in right_set)

    return {
        "status": "observed",
        "schemaVersion": 1,
        "analysisVersion": "write-write-intersection-v1",
        "projectId": l.get("projectId"),
        "revisionBinding": lb,
        "labelsEmitted": ["write", "watch"],
        "writeExhaustive": True,
        "paths": inter_paths,
        "emptyIsNotNoConflict": True,
        # no conflict/lock/lease
    }


__all__ = ["observe_write_write_intersection"]
