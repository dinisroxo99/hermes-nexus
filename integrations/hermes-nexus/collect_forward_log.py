"""collect_forward_log(fields: Any) -> dict[str, Any]

One positional argument. No default. Does not mutate fields.
Validates six caller INPUT keys strictly (see below). Returns closed count-only shape on success.
Additionally (D3): after full validation and before returning "collected", resolves dataDir lazily
and appends exactly the six-key INPUT (runId, profile, sha, nexusTools, writePaths, watchPaths)
as one JSON object + newline (UTF-8) to dataDir/collect-forward-log.jsonl. Appends only;
never truncates. mkdir(parents,exist_ok) + write + flush + close complete before return.

dataDir resolution (Python-local, no JS/.env read, lazy on valid call only):
- nonempty DATA_DIR env: use it (absolute as-is; relative anchored to verified repoRoot)
- else: <verified repoRoot>/data
repoRoot: from collector __file__ only when layout exactly matches
  integrations/hermes-nexus/collect_forward_log.py + package.json name=="hermes-nexus"
  + src/lib/project-config.js exists; then parents[2]. No cwd/ancestor/hardcode/installed.
Unbound layout (bad parents/pkg/cfg) WITHOUT absolute DATA_DIR raises BEFORE any dir/file write.
Reject any destination whose resolved path contains a ".hermes" component (even with DATA_DIR).
Never fall back to profile/home/cwd. Absolute DATA_DIR skips root guess. Exceptions propagate.

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
Only the six INPUT keys are projected to disk JSONL (no counts, versions, status, timestamps, sink).

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

import json
import os
from pathlib import Path
from typing import Any

_ANALYSIS = "collect-forward-log-v1"


def _verify_source_layout_and_get_repo_root() -> Path:
    """Return repo root only for exact source layout; raise otherwise.
    Called only for relative DATA_DIR or default (never for absolute DATA_DIR).
    """
    coll = Path(__file__).resolve()
    if not (
        coll.name == "collect_forward_log.py"
        and coll.parent.name == "hermes-nexus"
        and coll.parent.parent.name == "integrations"
    ):
        raise RuntimeError("unbound collector copy: exact source layout required")
    repo_root = coll.parents[2]
    # verify package.json name
    pkg = repo_root / "package.json"
    if not pkg.is_file():
        raise RuntimeError("unbound collector copy: missing package.json")
    try:
        pkg_json = json.loads(pkg.read_text(encoding="utf-8"))
        if not isinstance(pkg_json, dict) or pkg_json.get("name") != "hermes-nexus":
            raise RuntimeError("unbound collector copy: package name must be hermes-nexus")
    except Exception:
        raise RuntimeError("unbound collector copy: invalid package.json") from None
    # verify src/lib/project-config.js
    cfg = repo_root / "src" / "lib" / "project-config.js"
    if not cfg.is_file():
        raise RuntimeError("unbound collector copy: missing src/lib/project-config.js")
    return repo_root


def _resolve_data_dir() -> Path:
    """Resolve dataDir lazily per contract. Raises on unbound (when no abs DATA_DIR)
    or forbidden .hermes sink, before any mkdir/write.
    """
    env_dd = os.environ.get("DATA_DIR") or ""
    env_dd = env_dd.strip()
    if env_dd:
        dd = Path(env_dd)
        if dd.is_absolute():
            data_dir = dd
        else:
            repo_root = _verify_source_layout_and_get_repo_root()
            data_dir = repo_root / dd
    else:
        repo_root = _verify_source_layout_and_get_repo_root()
        data_dir = repo_root / "data"
    # reject destinations through .hermes (check resolved parts)
    try:
        resolved = data_dir.resolve(strict=False)
        parts = resolved.parts
    except Exception:
        parts = data_dir.parts
    if any(p == ".hermes" for p in parts):
        raise RuntimeError("forbidden sink through .hermes path")
    return data_dir


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

    # Persist ONLY after full validation, before any return of collected.
    # Project exactly the six INPUT keys (preserve values, order, dups, empty lists, bools).
    # Do not mutate fields; do not open path entries.
    data_dir = _resolve_data_dir()
    log_path = data_dir / "collect-forward-log.jsonl"
    record = {
        "runId": run_id,
        "profile": profile,
        "sha": sha,
        "nexusTools": nexus_tools,
        "writePaths": write_paths,
        "watchPaths": watch_paths,
    }
    json_line = json.dumps(record, ensure_ascii=False) + "\n"
    data_dir.mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json_line)
        f.flush()
    # close happens; exception would propagate (no collected on failure)

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
