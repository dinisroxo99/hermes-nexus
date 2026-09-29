"""Stdlib-only offline inspector for D3 collect-forward-log.jsonl.

Validates records have exactly the six fields per collector contract.
Distinguishes valid records, invalid records, complete vs limited/incomplete reads.
Never mutates input. Conservative on symlinks and concurrent change.

Budgets (hard defaults, overridable in API):
- max_bytes: 10 MiB
- max_records: 10000
- max_line_bytes: 1 MiB

CLI: python3 -B -m scripts.nexus_log_inspector --input path/to/log.jsonl --format json

Exit codes:
  0: read completed (may contain invalids or limited observation)
  1: input error (no such file, permission, not regular, etc.)
"""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path
from typing import Any

REQUIRED_KEYS = frozenset({"runId", "profile", "sha", "nexusTools", "writePaths", "watchPaths"})


class _DuplicateKeyError(ValueError):
    """Raised from object_pairs_hook when a JSON object has duplicate keys."""

    def __init__(self, key: str) -> None:
        self.key = key
        super().__init__(f"duplicate key: {key}")


def _object_pairs_hook(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Stdlib-only hook: detect duplicate keys so json.loads last-wins cannot hide them.

    Returns normal dict if no dups; raises _DuplicateKeyError with .key on first dup.
    """
    d: dict[str, Any] = {}
    for k, v in pairs:
        if k in d:
            raise _DuplicateKeyError(str(k))
        d[k] = v
    return d


def _is_regular_file(p: Path) -> bool:
    try:
        st = os.lstat(p)
        if stat.S_ISLNK(st.st_mode):
            return False
        st = p.stat()
        return stat.S_ISREG(st.st_mode)
    except OSError:
        return False


def inspect_jsonl_log(
    input_path: str | Path,
    *,
    max_bytes: int = 10 * 1024 * 1024,
    max_records: int = 10000,
    max_line_bytes: int = 1024 * 1024,
) -> dict[str, Any]:
    """Read-only streaming validation of the JSONL.

    Returns a report dict. Never writes. Does not follow symlinks.
    If the file changes size/mtime while reading, sets changed_during_read and limited.
    Incomplete last line (no trailing newline + unparsable) is limited, not corruption.
    """
    p = Path(input_path)
    report: dict[str, Any] = {
        "examined": 0,
        "valid": 0,
        "invalid": 0,
        "complete": True,
        "limited": False,
        "limited_reason": None,
        "bytes_observed": 0,
        "records_observed": 0,
        "file_size_before": 0,
        "file_size_after": 0,
        "changed_during_read": False,
        "incomplete_last_line": False,
        "invalid_records": [],
        "profile_sha_groups": {},
        "distinct_correlation_keys": 0,
        "declared_write_path_entries": 0,
        "declared_watch_path_entries": 0,
        "budgets": {
            "max_bytes": max_bytes,
            "max_records": max_records,
            "max_line_bytes": max_line_bytes,
        },
        "input": str(p),
    }

    if not p.exists():
        report["status"] = "error"
        report["error"] = "no_such_file"
        return report
    if not _is_regular_file(p):
        report["status"] = "error"
        report["error"] = "not_regular_file_or_symlink"
        return report

    try:
        size_before = p.stat().st_size
        mtime_before = p.stat().st_mtime
    except OSError as e:
        report["status"] = "error"
        report["error"] = f"stat_failed: {e}"
        return report

    report["file_size_before"] = size_before

    seen_corrs: set[tuple[str, str, str]] = set()
    groups: dict[str, dict[str, Any]] = {}
    invalids: list[dict[str, Any]] = []
    bytes_obs = 0
    rec_obs = 0
    limited = False
    limited_reason: str | None = None
    incomplete_last = False
    last_line_was_invalid_json = False  # for O2-INCOMPLETE-HEURISTIC: track only final examined line

    try:
        with p.open("r", encoding="utf-8", newline="") as f:
            for lineno, raw_line in enumerate(f, 1):
                line_bytes = len(raw_line.encode("utf-8"))

                if rec_obs + 1 > max_records:
                    limited = True
                    limited_reason = "max_records_exceeded"
                    break
                if bytes_obs + line_bytes > max_bytes:
                    limited = True
                    limited_reason = "max_bytes_exceeded"
                    break
                if line_bytes > max_line_bytes:
                    limited = True
                    limited_reason = "max_line_bytes_exceeded"
                    break

                bytes_obs += line_bytes
                rec_obs += 1
                report["bytes_observed"] = bytes_obs
                report["records_observed"] = rec_obs
                report["examined"] = rec_obs

                stripped = raw_line.rstrip("\n\r")
                if not stripped:
                    # blank line: treat as examined but invalid? per contract, skip or invalid
                    # contract expects records, blank is invalid json context
                    invalids.append({"line": lineno, "code": "blank_line"})
                    report["invalid"] += 1
                    last_line_was_invalid_json = False
                    continue

                try:
                    rec = json.loads(stripped, object_pairs_hook=_object_pairs_hook)
                except json.JSONDecodeError:
                    invalids.append({"line": lineno, "code": "invalid_json"})
                    report["invalid"] += 1
                    last_line_was_invalid_json = True
                    # if this is last and no \n originally? but since rstrip, check later
                    continue
                except _DuplicateKeyError as e:
                    invalids.append({"line": lineno, "code": "duplicate_keys", "field": e.key})
                    report["invalid"] += 1
                    last_line_was_invalid_json = False
                    continue

                if not isinstance(rec, dict):
                    invalids.append({"line": lineno, "code": "not_object"})
                    report["invalid"] += 1
                    continue

                keys = set(rec.keys())
                if keys != REQUIRED_KEYS:
                    extra = keys - REQUIRED_KEYS
                    missing = REQUIRED_KEYS - keys
                    code = "extra_keys" if extra else "missing_keys"
                    invalids.append({
                        "line": lineno,
                        "code": code,
                        "fields": sorted(extra or missing),
                    })
                    report["invalid"] += 1
                    continue

                # type checks
                run_id = rec["runId"]
                profile = rec["profile"]
                sha = rec["sha"]
                nexus_tools = rec["nexusTools"]
                write_paths = rec["writePaths"]
                watch_paths = rec["watchPaths"]

                err = None
                if not (isinstance(run_id, str) and run_id.strip()):
                    err = ("runId", "empty_or_non_str")
                elif not (isinstance(profile, str) and profile.strip()):
                    err = ("profile", "empty_or_non_str")
                elif not (isinstance(sha, str) and sha.strip()):
                    err = ("sha", "empty_or_non_str")
                elif not isinstance(nexus_tools, bool):
                    err = ("nexusTools", "not_bool")
                elif not (isinstance(write_paths, list) and all(isinstance(x, str) and x.strip() for x in write_paths)):
                    err = ("writePaths", "not_list_of_nonempty_str")
                elif not (isinstance(watch_paths, list) and all(isinstance(x, str) and x.strip() for x in watch_paths)):
                    err = ("watchPaths", "not_list_of_nonempty_str")

                if err:
                    field, code = err
                    invalids.append({"line": lineno, "code": code, "field": field})
                    report["invalid"] += 1
                    continue

                # valid
                report["valid"] += 1
                corr = (profile, sha, run_id)
                seen_corrs.add(corr)

                # structured group identity (tuple) to avoid colon-collision in profile or sha (O2-GROUP-COLLIDE)
                gkey = (profile, sha)
                if gkey not in groups:
                    groups[gkey] = {"count": 0, "run_ids": set()}
                groups[gkey]["count"] += 1
                groups[gkey]["run_ids"].add(run_id)

                report["declared_write_path_entries"] += len(write_paths)
                report["declared_watch_path_entries"] += len(watch_paths)

                last_line_was_invalid_json = False

                # do not abort read on diagnostic cap (invalids already truncated on report);
                # continue so later valids are counted (O2-READ-CAP)

    except OSError as e:
        report["status"] = "error"
        report["error"] = f"read_failed: {e}"
        return report

    # post check for change / truncate
    try:
        size_after = p.stat().st_size
        mtime_after = p.stat().st_mtime
    except OSError:
        size_after = size_before
        mtime_after = mtime_before

    report["file_size_after"] = size_after
    if size_after != size_before or mtime_after != mtime_before:
        report["changed_during_read"] = True
        limited = True
        if limited_reason is None:
            limited_reason = "file_changed_during_read"

    # if we broke on last partial line without full parse, mark
    # heuristic: if limited on record limit or bytes, and last attempt failed parse, already counted invalid
    # for truncated file ending without \n that caused json fail on last:
    if limited and limited_reason in (None, "max_bytes_exceeded", "max_records_exceeded"):
        # already set
        pass

    # O2-INCOMPLETE-HEURISTIC: set only when the *final examined line* failed JSON *and* file had no trailing newline
    if last_line_was_invalid_json:
        try:
            with p.open("rb") as fb:
                fb.seek(max(0, size_before - 4096))
                tail = fb.read()
            if tail and not tail.endswith(b"\n") and not tail.endswith(b"\r"):
                # final examined line was the unterminated json fail
                incomplete_last = True
        except Exception:
            pass

    report["incomplete_last_line"] = incomplete_last
    report["limited"] = limited
    report["limited_reason"] = limited_reason
    report["complete"] = not limited and not incomplete_last and not report.get("changed_during_read", False)

    # cap diags
    report["invalid_records"] = invalids[:20]
    if len(invalids) > 20:
        report["invalid_records_truncated"] = True

    # groups: cap
    # use safe str key from structured tuple gkey so colon in profile/sha cannot collide (O2-GROUP-COLLIDE)
    capped_groups: dict[str, Any] = {}
    for gk, gv in list(groups.items())[:20]:
        if isinstance(gk, tuple) and len(gk) == 2:
            gk_str = json.dumps([gk[0], gk[1]], ensure_ascii=True)
        else:
            gk_str = str(gk)
        capped_groups[gk_str] = {
            "count": gv["count"],
            "run_ids_sample": sorted(list(gv["run_ids"]))[:5],
        }
    report["profile_sha_groups"] = capped_groups
    if len(groups) > 20:
        report["profile_sha_groups_truncated"] = True

    report["distinct_correlation_keys"] = len(seen_corrs)
    report["status"] = "ok"
    return report


def _escape_controls_for_text(s: Any) -> str:
    """Escape C0 controls and ESC for safe text output only (O2-TEXT-ESC).
    Keep original values in JSON report (records remain valid).
    """
    if s is None:
        return ""
    t = str(s)
    out: list[str] = []
    for ch in t:
        o = ord(ch)
        if o < 0x20 or o == 0x7f or o == 0x1b:
            if o == 0x1b:
                out.append("\\x1b")
            else:
                out.append(f"\\x{o:02x}")
        else:
            out.append(ch)
    return "".join(out)


def format_text(report: dict[str, Any]) -> str:
    lines = []
    lines.append(f"input: {_escape_controls_for_text(report.get('input'))}")
    lines.append(f"examined: {report['examined']}  valid: {report['valid']}  invalid: {report['invalid']}")
    lines.append(f"complete: {report['complete']}  limited: {report['limited']}  reason: {report['limited_reason']}")
    lines.append(f"bytes_observed: {report['bytes_observed']}  records_observed: {report['records_observed']}")
    lines.append(f"changed_during_read: {report['changed_during_read']}  incomplete_last_line: {report['incomplete_last_line']}")
    lines.append(f"distinct_correlation_keys: {report['distinct_correlation_keys']}")
    lines.append(f"declared_write_path_entries: {report['declared_write_path_entries']}")
    lines.append(f"declared_watch_path_entries: {report['declared_watch_path_entries']}")
    if report.get("invalid_records"):
        lines.append("invalid_records (capped):")
        for d in report["invalid_records"]:
            fld = _escape_controls_for_text(d.get("field", ""))
            lines.append(f"  line {d['line']}: {d['code']} {fld}")
    if report.get("profile_sha_groups"):
        lines.append("profile_sha_groups (capped):")
        for k, v in report["profile_sha_groups"].items():
            ks = _escape_controls_for_text(k)
            lines.append(f"  {ks}: count={v['count']} sample_runids={v['run_ids_sample']}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    # direct exec support
    pass
