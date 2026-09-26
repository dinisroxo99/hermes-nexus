"""Pure in-memory collect_forward_log for E3 contract (no side effects).

collect_forward_log(fields: Any) -> dict[str, Any]

One positional argument. No default. Pure. Does not mutate fields.
Allowed imports: __future__ and typing only.
No Git, network, Nexus, Honcho, filesystem, subprocess, env, or ~/.hermes harvest.

Required input keys (all present + valid or whole call refuses):
- runId: non-empty str (strip() != ""); echo original verbatim
- profile: same
- sha: same (key is exactly "sha")
- nexusTools: exactly bool (True or False); reject 1/0/None/str etc. Never probe.
- writePaths: list[str] of non-empty (empty-after-strip rejects whole); count = len as-is
- watchPaths: same

Duplicates preserved in count; no dedupe/sort/normalize. Paths never opened.
Missing list key or non-list or bad entry -> refuse (count never echoed as 0 on refuse).
Caller-supplied *Count keys ignored. Extra keys (honcho, token, ...) ignored and never copied.

On success (JSON-serializable, closed shape, no secrets, no path lists):
{
  "status": "collected",
  "schemaVersion": 1,
  "analysisVersion": "collect-forward-log-v1",
  "runId": <echo>,
  "profile": <echo>,
  "sha": <echo>,
  "nexusTools": <echo bool>,
  "writePathCount": <int len>,
  "watchPathCount": <int len>,
  "notIngest": true,
  "notHoncho": true,
  "notDispatch": true,
  "notConflictEngine": true,
}

On any invalid/missing/non-dict: exactly
{"status": "not_evaluated", "reason": "input_incomplete", "analysisVersion": "collect-forward-log-v1"}
(omits runId/profile/sha/... ; no partial echo; one reason)
"""

from __future__ import annotations

from typing import Any

_ANALYSIS = "collect-forward-log-v1"


def _refuse() -> dict[str, Any]:
    return {
        "status": "not_evaluated",
        "reason": "input_incomplete",
        "analysisVersion": _ANALYSIS,
    }


def collect_forward_log(fields: Any) -> dict[str, Any]:
    """Collect caller-supplied forward log fields or refuse with closed incomplete shape."""
    if not isinstance(fields, dict):
        return _refuse()

    required = ("runId", "profile", "sha", "nexusTools", "writePaths", "watchPaths")
    for key in required:
        if key not in fields:
            return _refuse()

    run_id = fields["runId"]
    if not isinstance(run_id, str) or run_id.strip() == "":
        return _refuse()

    profile = fields["profile"]
    if not isinstance(profile, str) or profile.strip() == "":
        return _refuse()

    sha = fields["sha"]
    if not isinstance(sha, str) or sha.strip() == "":
        return _refuse()

    nexus_tools = fields["nexusTools"]
    if not isinstance(nexus_tools, bool):
        return _refuse()

    write_paths = fields["writePaths"]
    if not isinstance(write_paths, list):
        return _refuse()
    for p in write_paths:
        if not isinstance(p, str) or p.strip() == "":
            return _refuse()

    watch_paths = fields["watchPaths"]
    if not isinstance(watch_paths, list):
        return _refuse()
    for p in watch_paths:
        if not isinstance(p, str) or p.strip() == "":
            return _refuse()

    return {
        "status": "collected",
        "schemaVersion": 1,
        "analysisVersion": _ANALYSIS,
        "runId": run_id,
        "profile": profile,
        "sha": sha,
        "nexusTools": nexus_tools,
        "writePathCount": len(write_paths),
        "watchPathCount": len(watch_paths),
        "notIngest": True,
        "notHoncho": True,
        "notDispatch": True,
        "notConflictEngine": True,
    }


__all__ = ["collect_forward_log"]
