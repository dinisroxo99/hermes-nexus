"""Pure observable WRITE ∩ WRITE for ETAPA3A_CONTRACT.

Marker ETAPA3A_CONTRACT_FIX_2.

observe_write_write_intersection(left, right) -> dict
Pure function. No Git, no network, no Nexus, no side-effects.
Does not mutate inputs. Never unwraps {ok, data}.

Per side, before paths and before != :
1. error == scope_impact_not_evaluated, or findingState/status not_evaluated
   -> input_not_evaluated (even when an ok key is present)
2. non-dict / wrapper (ok key) / envelope rejected / schemaVersion != 1 /
   analysisVersion != effective-task-scope-v1 / labelsEmitted != ["write", "watch"] /
   write empty or a bad entry / dirty is not False / isLinkedWorktree is not True /
   revisionBinding.status != available /
   repositoryIdentity absent or != impactRepositoryId
   -> input_rejected
3. status != available, or observation.incomplete is not False,
   or writeExhaustive is not True
   -> input_incomplete

Only if both sides passed 1-3:
4. projectId absent or unequal -> identity_mismatch
5. commitSha or repositoryIdentity absent or unequal -> revision_mismatch

None == None does not pass. One bad write entry rejects that whole side.
The first matching reason in the table wins, independent of argument order.
Refusal is {status: "not_evaluated", reason, analysisVersion} and has no paths.
Success only when both sides pass every gate.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

_ANALYSIS = "write-write-intersection-v1"
_SCOPE_ANALYSIS = "effective-task-scope-v1"
_LABELS = ["write", "watch"]
_PRIORITY = ("input_not_evaluated", "input_rejected", "input_incomplete")


def _refuse(reason: str) -> dict[str, Any]:
    return {
        "status": "not_evaluated",
        "reason": reason,
        "analysisVersion": _ANALYSIS,
    }


def _same_present(left: Any, right: Any) -> bool:
    return left is not None and right is not None and left == right


def _write_is_valid(write: Any) -> bool:
    if not isinstance(write, list) or len(write) == 0:
        return False
    for item in write:
        if not isinstance(item, dict):
            return False
        path = item.get("path")
        if not isinstance(path, str) or path == "":
            return False
        if item.get("source") != "explicit_task_path":
            return False
    return True


def _write_paths(write: list[dict[str, Any]]) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for item in write:
        path = item["path"]
        if path not in seen:
            seen.add(path)
            paths.append(path)
    return paths


def _side_reason(side: Any) -> str | None:
    if not isinstance(side, dict):
        return "input_rejected"
    if side.get("error") == "scope_impact_not_evaluated":
        return "input_not_evaluated"
    if side.get("findingState") == "not_evaluated" or side.get("status") == "not_evaluated":
        return "input_not_evaluated"
    if "ok" in side or side.get("status") == "rejected" or "error" in side:
        return "input_rejected"
    if type(side.get("schemaVersion")) is not int or side.get("schemaVersion") != 1:
        return "input_rejected"
    if side.get("analysisVersion") != _SCOPE_ANALYSIS:
        return "input_rejected"
    if side.get("labelsEmitted") != _LABELS:
        return "input_rejected"
    if not _write_is_valid(side.get("write")):
        return "input_rejected"
    binding = side.get("revisionBinding")
    if not isinstance(binding, dict):
        return "input_rejected"
    if binding.get("dirty") is not False:
        return "input_rejected"
    if binding.get("isLinkedWorktree") is not True:
        return "input_rejected"
    if binding.get("status") != "available":
        return "input_rejected"
    if not _same_present(binding.get("repositoryIdentity"), binding.get("impactRepositoryId")):
        return "input_rejected"
    if side.get("status") != "available":
        return "input_incomplete"
    observation = side.get("observation")
    incomplete = observation.get("incomplete") if isinstance(observation, dict) else None
    if incomplete is not False:
        return "input_incomplete"
    if side.get("writeExhaustive") is not True:
        return "input_incomplete"
    return None


def observe_write_write_intersection(left: Any, right: Any) -> dict[str, Any]:
    """Return observed intersection or not_evaluated with a closed reason."""
    reasons = [reason for reason in (_side_reason(left), _side_reason(right)) if reason is not None]
    if reasons:
        for token in _PRIORITY:
            if token in reasons:
                return _refuse(token)

    if not _same_present(left.get("projectId"), right.get("projectId")):
        return _refuse("identity_mismatch")
    left_binding = left["revisionBinding"]
    right_binding = right["revisionBinding"]
    if not _same_present(left_binding.get("commitSha"), right_binding.get("commitSha")):
        return _refuse("revision_mismatch")
    if not _same_present(
        left_binding.get("repositoryIdentity"),
        right_binding.get("repositoryIdentity"),
    ):
        return _refuse("revision_mismatch")

    right_paths = set(_write_paths(right["write"]))
    paths = sorted(path for path in _write_paths(left["write"]) if path in right_paths)
    return {
        "status": "observed",
        "schemaVersion": 1,
        "analysisVersion": _ANALYSIS,
        "projectId": left.get("projectId"),
        "revisionBinding": deepcopy(left_binding),
        "labelsEmitted": ["write", "watch"],
        "writeExhaustive": True,
        "paths": paths,
        "emptyIsNotNoConflict": True,
    }


__all__ = ["observe_write_write_intersection"]
