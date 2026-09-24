"""Read-only Effective Task Scope composer for ETS-4/contract-1.

Consumes already-accepted pack and impact (from project_task_context and
project_impact) and emits only WRITE + WATCH classification bound to that
revision. Fail-closed with exact contract error codes. No Git, no network,
no side effects, no schema changes to the two adopted tools.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

def _extract(obj: Any, label: str) -> dict[str, Any]:
    """Return inner data if wrapper with ok=true+data, else the obj if it looks like data."""
    if isinstance(obj, dict):
        if obj.get("ok") is True and isinstance(obj.get("data"), dict):
            return deepcopy(obj["data"])
        if obj.get("schemaVersion") == 1:
            return deepcopy(obj)
    raise ValueError(f"invalid {label} (missing ok/data or schema)")


def _fail(code: str, message: str) -> dict[str, Any]:
    """Rejected result (no consumable classification data)."""
    return {
        "ok": False,
        "error": code,
        "category": "validation",
        "message": message,
        "status": "rejected",
    }


def _get_write_paths(pack_data: dict[str, Any]) -> list[str]:
    try:
        items = pack_data["sections"]["task"]["items"]
        if not items:
            return []
        return list(items[0].get("paths", []))
    except (KeyError, TypeError, IndexError):
        return []


def _get_impact_origin_paths(impact_data: dict[str, Any]) -> list[str]:
    if "originPath" in impact_data:
        op = impact_data["originPath"]
        return [op] if op else []
    if "targets" in impact_data:
        res: list[str] = []
        for t in impact_data.get("targets", []) or []:
            if isinstance(t, dict):
                op = t.get("originPath")
                if op:
                    res.append(op)
        return res
    return []


def _make_watch_entry(item: dict[str, Any], roles: list[str]) -> dict[str, Any]:
    origins = item.get("origins", []) or []
    min_d = min((o.get("minimumDistance", 999) for o in origins if isinstance(o, dict)), default=None)
    rels: list[str] = sorted(
        {o.get("witness", {}).get("relationshipKind") for o in origins if isinstance(o, dict) and o.get("witness")}
        - {None}
    )
    evrefs: list[dict[str, Any]] = []
    for o in origins:
        if not isinstance(o, dict):
            continue
        w = o.get("witness", {}) or {}
        evrefs.append(
            {
                "originPath": o.get("originPath"),
                "minimumDistance": o.get("minimumDistance"),
                "witness": {
                    "id": w.get("id"),
                    "relationshipKind": w.get("relationshipKind"),
                    "trust": w.get("trust"),
                    "basis": w.get("basis"),
                },
            }
        )
    osum = item.get("originSummary", {}) or {}
    return {
        "path": item.get("path"),
        "roles": roles,
        "minimumDistance": min_d if min_d is not None and min_d < 999 else None,
        "relationshipKinds": rels,
        "evidenceRefs": evrefs,
        "attributionTruncated": bool(osum.get("attributionTruncated")),
    }


def compose_effective_task_scope(
    pack: Any,
    impact: Any,
    *,
    include_tests: bool | None = None,
    task: Any | None = None,
) -> dict[str, Any]:
    """Return effective-task-scope-v1 classification or reject shape.

    pack/impact: full handler result {"ok":true,"data":...} or the inner data.
    include_tests: the value supplied to impact call (inferred from affectedTests if None).
    task: optional original task for echo mismatch check.
    """
    try:
        pack_data = _extract(pack, "pack")
        impact_data = _extract(impact, "impact")
    except Exception:
        return _fail("scope_input_rejected", "pack or impact missing or not accepted")

    if pack_data.get("schemaVersion") != 1 or pack_data.get("analysisVersion") != "task-context-v1":
        return _fail("scope_input_rejected", "pack schemaVersion or analysisVersion mismatch")
    if impact_data.get("schemaVersion") != 1 or impact_data.get("analysisVersion") != "impact-v2":
        return _fail("scope_input_rejected", "impact schemaVersion or analysisVersion mismatch")

    # identity
    if pack_data.get("projectId") != impact_data.get("projectId"):
        return _fail("scope_identity_mismatch", "projectId differs between pack and impact")
    pp = pack_data.get("project") or {}
    ip = impact_data.get("project") or {}
    if pp.get("rootId") != ip.get("rootId") or pp.get("relativePath") != ip.get("relativePath"):
        return _fail("scope_identity_mismatch", "worktree rootId/relativePath mismatch")

    # revision binding (exact contract)
    pr = pack_data.get("revision") or {}
    ir = impact_data.get("revision") or {}
    for k in ("status", "commitSha", "dirty", "isLinkedWorktree"):
        if pr.get(k) != ir.get(k):
            return _fail("scope_revision_mismatch", f"revision.{k} mismatch")
    if pr.get("branch") != ir.get("branch"):
        return _fail("scope_revision_mismatch", "revision branch mismatch")
    p_wtid = pr.get("worktreeId")
    i_wtid = ir.get("worktreeId")
    if p_wtid and i_wtid and p_wtid != i_wtid:
        return _fail("scope_revision_mismatch", "worktreeId mismatch")
    p_repo = pr.get("repositoryIdentity") or pr.get("repositoryId")
    i_repo = ir.get("repositoryId") or ir.get("repositoryIdentity")
    if p_repo != i_repo:
        return _fail("scope_identity_mismatch", "repositoryIdentity / repositoryId mismatch")

    # task echo from pack (sections.task.items[0])
    try:
        tsec = pack_data["sections"]["task"]
        titems = tsec["items"]
        if not titems:
            raise KeyError("empty")
        echo = titems[0]
    except (KeyError, TypeError, IndexError):
        return _fail("scope_task_mismatch", "task echo missing in pack")

    if not echo.get("title"):
        return _fail("scope_task_mismatch", "task echo has no title")

    # optional task arg check (echo without provenance/desc vs supplied)
    if task is not None and isinstance(task, dict):
        echo_stripped = {k: v for k, v in echo.items() if k not in ("provenance", "description")}
        tsup = {k: v for k, v in task.items() if k not in ("provenance", "description")}
        # compare core fields that must match
        for k in ("id", "title", "paths", "symbols"):
            if echo_stripped.get(k) != tsup.get(k):
                return _fail("scope_task_mismatch", "echoed task does not match supplied task")

    write_paths: list[str] = _get_write_paths(pack_data)
    if not write_paths:
        return _fail("scope_insufficient_targets", "task.paths empty after normalization")

    impact_paths = _get_impact_origin_paths(impact_data)
    if set(write_paths) != set(impact_paths):
        return _fail("scope_path_set_mismatch", "pack task paths differ from impact originPaths")

    # impact evaluation gate
    if impact_data.get("findingState") == "not_evaluated":
        return _fail("scope_impact_not_evaluated", "impact.findingState is not_evaluated")
    if impact_data.get("status") in ("unavailable", "unsupported"):
        return _fail("scope_impact_not_evaluated", "impact.status is unavailable or unsupported")

    # includeTests inference
    at = impact_data.get("affectedTests") or {}
    if include_tests is None:
        include_tests = at.get("status") != "not_requested"

    # WRITE (exact order from pack)
    write = [{"path": p, "source": "explicit_task_path"} for p in write_paths]
    write_set = set(write_paths)

    # WATCH = retained impact evidence minus WRITE paths; dedup; order affected then new cands
    watch: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in (impact_data.get("affectedFiles") or []):
        if not isinstance(item, dict):
            continue
        p = item.get("path")
        if p and p not in write_set and p not in seen:
            seen.add(p)
            watch.append(_make_watch_entry(item, ["affected_file"]))

    if include_tests:
        for item in (at.get("candidates") or []):
            if not isinstance(item, dict):
                continue
            p = item.get("path")
            if p and p not in write_set and p not in seen:
                seen.add(p)
                watch.append(_make_watch_entry(item, ["affected_test_candidate"]))

    # classify available vs incomplete (contract rules)
    pack_obs = pack_data.get("observation") or {}
    impact_obs = impact_data.get("observation") or {}
    impact_comp = impact_data.get("completeness") or {}
    pack_incomplete = bool(pack_obs.get("incomplete"))
    impact_incomplete = bool(impact_obs.get("incomplete"))
    impact_status = impact_data.get("status")
    impact_fs = impact_data.get("findingState")

    comp_reasons: list[str] = []
    for dim in ("source", "provider", "traversal", "output"):
        comp_reasons.extend(impact_comp.get(dim, []) or [])

    tests_incomplete = False
    if include_tests:
        at_comp = at.get("completeness") or {}
        tests_incomplete = bool(at_comp.get("source") or at_comp.get("provider") or at_comp.get("traversal") or at_comp.get("output"))

    has_trunc = any(bool(w.get("attributionTruncated")) for w in watch)

    is_available = (
        not pack_incomplete
        and not impact_incomplete
        and impact_status == "available"
        and impact_fs in ("evidence_found", "no_evidence_found")
        and len(comp_reasons) == 0
        and include_tests
        and not tests_incomplete
        and not has_trunc
    )

    if is_available:
        status = "available"
        watch_exhaustive = True
        obs_incomplete = False
        reasons: list[str] = []
    else:
        status = "incomplete"
        watch_exhaustive = False
        obs_incomplete = True
        reasons = []
        if pack_incomplete:
            reasons.append("pack_observation_incomplete")
        if impact_incomplete:
            reasons.append("impact_observation_incomplete")
        if impact_status != "available":
            reasons.append("impact_status_partial")
        reasons.extend(comp_reasons)
        if not include_tests:
            reasons.append("tests_not_requested")
        elif include_tests:
            if at.get("status") == "not_requested":
                reasons.append("tests_not_requested")
            elif tests_incomplete:
                reasons.append("impact_tests_incomplete")
        if has_trunc:
            reasons.append("attribution_truncated")
        # dedup order preserving
        seen_r: set[str] = set()
        reasons = [r for r in reasons if not (r in seen_r or seen_r.add(r))]

    observation: dict[str, Any] = {"incomplete": obs_incomplete}
    if reasons:
        observation["reasons"] = reasons

    # task echo (no description)
    task_echo = {
        "id": echo.get("id"),
        "title": echo.get("title"),
        "paths": write_paths,
        "symbols": echo.get("symbols", []),
    }

    return {
        "schemaVersion": 1,
        "analysisVersion": "effective-task-scope-v1",
        "projectId": pack_data["projectId"],
        "project": {"rootId": pp.get("rootId"), "relativePath": pp.get("relativePath")},
        "revisionBinding": {
            "status": pr.get("status"),
            "commitSha": pr.get("commitSha"),
            "branch": pr.get("branch"),
            "dirty": pr.get("dirty"),
            "isLinkedWorktree": pr.get("isLinkedWorktree"),
            "worktreeId": p_wtid or i_wtid,
            "repositoryIdentity": p_repo,
            "impactRepositoryId": i_repo,
            "contextPackId": pack_data.get("contextPackId"),
            "snapshotToken": impact_data.get("snapshotToken"),
        },
        "task": task_echo,
        "labelsEmitted": ["write", "watch"],
        "labelsNotEmitted": [
            "reserved reason not_observable_without_coupling_or_conflict_engine",
            "impact reason not_observable_without_adopted_distance_or_change_semantics",
        ],
        "write": write,
        "watch": watch,
        "writeExhaustive": True,
        "watchExhaustive": watch_exhaustive,
        "observation": observation,
        "status": status,
        "generatedAt": None,
    }


__all__ = ["compose_effective_task_scope"]
