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
    max_groups: int = 20,
) -> dict[str, Any]:
    """Read-only streaming validation of the JSONL.

    Returns a report dict. Never writes. Does not follow symlinks.
    If the file changes size/mtime while reading, sets changed_during_read and limited.
    Incomplete last line (no trailing newline + unparsable) is limited, not corruption.
    """
    report, _ = read_jsonl_capture(input_path, max_bytes=max_bytes, max_records=max_records,
                                   max_line_bytes=max_line_bytes, max_groups=max_groups)
    return report


def read_jsonl_capture(input_path: str | Path, *, max_bytes: int, max_records: int, max_line_bytes: int,
                       max_groups: int) -> tuple[dict[str, Any], tuple[int, int] | None]:
    """Return the public observation and the separately held identity of the file actually read."""
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
        return report, None
    if not _is_regular_file(p):
        report["status"] = "error"
        report["error"] = "not_regular_file_or_symlink"
        return report, None

    try:
        before = p.lstat()
        size_before = before.st_size
    except OSError as e:
        report["status"] = "error"
        report["error"] = f"stat_failed: {e}"
        return report, None

    report["file_size_before"] = size_before

    seen_corrs: set[tuple[str, str, str]] = set()
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    invalids: list[dict[str, Any]] = []
    bytes_obs = 0
    rec_obs = 0
    limited = False
    limited_reason: str | None = None
    incomplete_last = False

    try:
        def open_for_read(name, flags):
            return os.open(name, flags | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))

        # Latin-1 is a lossless byte view for bounded Universal Newline reads. Decode admitted lines as UTF-8 below.
        with open(p, "r", encoding="latin-1", newline="", opener=open_for_read) as f:
            opened = os.fstat(f.fileno())
            if not stat.S_ISREG(opened.st_mode) or not os.path.samestat(before, opened):
                report.update(status="error", error="not_regular_file_or_symlink")
                return report, None
            while True:
                remaining = max_bytes - bytes_obs
                read_limit = 1 if rec_obs >= max_records else max(1, min(max_line_bytes, remaining) + 1)
                raw_line = f.readline(read_limit)
                if not raw_line:
                    break
                line_bytes = len(raw_line)
                lineno = rec_obs + 1

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

                stripped = raw_line.encode("latin-1").decode("utf-8").rstrip("\n\r")
                if not stripped:
                    # blank line: treat as examined but invalid? per contract, skip or invalid
                    # contract expects records, blank is invalid json context
                    invalids.append({"line": lineno, "code": "blank_line"})
                    report["invalid"] += 1
                    continue

                try:
                    rec = json.loads(stripped, object_pairs_hook=_object_pairs_hook)
                except json.JSONDecodeError:
                    invalids.append({"line": lineno, "code": "invalid_json"})
                    report["invalid"] += 1
                    incomplete_last = not raw_line.endswith(("\n", "\r"))
                    continue
                except _DuplicateKeyError as e:
                    invalids.append({"line": lineno, "code": "duplicate_keys", "field": e.key})
                    report["invalid"] += 1
                    continue

                except (RecursionError, ValueError):
                    invalids.append({"line": lineno, "code": "invalid_json"})
                    report["invalid"] += 1
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
                    groups[gkey] = {
                        "count": 0, "run_ids": set(), "nexus_tools_true_records": 0,
                        "declared_write_path_entries": 0, "declared_watch_path_entries": 0,
                    }
                groups[gkey]["count"] += 1
                groups[gkey]["nexus_tools_true_records"] += nexus_tools
                groups[gkey]["declared_write_path_entries"] += len(write_paths)
                groups[gkey]["declared_watch_path_entries"] += len(watch_paths)
                groups[gkey]["run_ids"].add(run_id)

                report["declared_write_path_entries"] += len(write_paths)
                report["declared_watch_path_entries"] += len(watch_paths)

                # do not abort read on diagnostic cap (invalids already truncated on report);
                # continue so later valids are counted (O2-READ-CAP)

    except (OSError, UnicodeDecodeError) as e:
        report["status"] = "error"
        report["error"] = f"read_failed: {e}"
        return report, None

    # post check for change / truncate
    try:
        after = p.lstat()
        size_after = after.st_size
        changed = (not os.path.samestat(before, after) or size_after != size_before
                   or after.st_mtime_ns != before.st_mtime_ns)
    except OSError:
        size_after = None
        changed = True

    report["file_size_after"] = size_after
    if changed:
        report["changed_during_read"] = True
        limited = True
        if limited_reason is None:
            limited_reason = "file_changed_during_read"

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
    for gk, gv in list(groups.items())[:max_groups]:
        if isinstance(gk, tuple) and len(gk) == 2:
            gk_str = json.dumps([gk[0], gk[1]], ensure_ascii=True)
        else:
            gk_str = str(gk)
        capped_groups[gk_str] = {
            "count": gv["count"],
            "distinct_correlation_keys": len(gv["run_ids"]),
            "nexus_tools_true_records": gv["nexus_tools_true_records"],
            "declared_write_path_entries": gv["declared_write_path_entries"],
            "declared_watch_path_entries": gv["declared_watch_path_entries"],
            "run_ids_sample": sorted(list(gv["run_ids"]))[:5],
        }
    report["profile_sha_groups"] = capped_groups
    if len(groups) > max_groups:
        report["profile_sha_groups_truncated"] = True

    report["distinct_correlation_keys"] = len(seen_corrs)
    report["status"] = "ok"
    identity = (opened.st_dev, opened.st_ino) if opened.st_ino else None
    return report, identity


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
