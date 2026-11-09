"""Compare observations in two explicitly supplied D3 captures."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.nexus_log_inspector.inspector import read_jsonl_capture

MAX_BYTES = 10 * 1024 * 1024
MAX_RECORDS = 10_000
MAX_LINE_BYTES = 1024 * 1024
MAX_ROWS = 20
METRICS = (
    "records", "distinct_correlation_keys", "nexus_tools_true_records", "nexus_tools_false_records",
    "declared_write_path_entries", "declared_watch_path_entries",
)


def _metrics(group: dict) -> dict[str, int]:
    return {
        "records": group["count"],
        "distinct_correlation_keys": group["distinct_correlation_keys"],
        "nexus_tools_true_records": group["nexus_tools_true_records"],
        "nexus_tools_false_records": group["count"] - group["nexus_tools_true_records"],
        "declared_write_path_entries": group["declared_write_path_entries"],
        "declared_watch_path_entries": group["declared_watch_path_entries"],
    }


def _capture(path: str | Path, role: str, budgets: dict) -> tuple[dict, dict, list[str], tuple[int, int] | None]:
    report, identity = read_jsonl_capture(path, max_groups=budgets["max_records"], **budgets)
    if report["status"] == "error":
        error = report["error"].split(":", 1)[0]
        return {"read_status": "error", "error": error, "observed": None}, {}, [role + "_input_error"], None

    # The inspector's JSON-encoded [profile, sha] keys preserve arbitrary punctuation.
    groups = {tuple(json.loads(key)): _metrics(value) for key, value in report["profile_sha_groups"].items()}
    reasons = []
    if not report["complete"]:
        reasons.append(role + "_incomplete")
    if report["invalid"]:
        reasons.append(role + "_invalid_records")
    if not report["valid"]:
        reasons.append(role + "_no_valid_records")
    summary = {key: report[key] for key in (
        "complete", "examined", "valid", "invalid", "limited_reason", "changed_during_read", "incomplete_last_line",
    )}
    summary["read_status"] = "ok"
    summary["observed"] = {m: sum(g[m] for g in groups.values()) for m in METRICS}
    return summary, groups, reasons, identity


def compare_captures(baseline: str | Path, candidate: str | Path, *, max_bytes: int = MAX_BYTES,
                     max_records: int = MAX_RECORDS, max_line_bytes: int = MAX_LINE_BYTES) -> dict:
    budgets = {"max_bytes": max_bytes, "max_records": max_records, "max_line_bytes": max_line_bytes}
    for key, limit in (("max_bytes", MAX_BYTES), ("max_records", MAX_RECORDS), ("max_line_bytes", MAX_LINE_BYTES)):
        if type(budgets[key]) is not int or not 1 <= budgets[key] <= limit:
            raise ValueError(f"{key} must be an integer between 1 and {limit}")
    left, left_groups, reasons, left_identity = _capture(baseline, "baseline", budgets)
    right, right_groups, right_reasons, right_identity = _capture(candidate, "candidate", budgets)
    reasons.extend(right_reasons)
    input_error = "error" in (left["read_status"], right["read_status"])
    if not input_error:
        if left_identity is None or right_identity is None:
            reasons.append("identity_unavailable")
        elif left_identity == right_identity:
            reasons.append("same_file")

    shared = sorted(left_groups.keys() & right_groups.keys())
    if not shared and not reasons:
        reasons.append("no_shared_profile_sha")
    rows = []
    for profile, sha in shared:
        # Avoid leaking huge arbitrary identity strings into a report; oversized identities still count in coverage.
        if len(profile) > 128 or len(sha) > 128:
            continue
        a, b = left_groups[(profile, sha)], right_groups[(profile, sha)]
        rows.append({
            "profile": profile, "sha": sha, "baseline": a, "candidate": b,
            "candidate_minus_baseline": None if reasons else {metric: b[metric] - a[metric] for metric in METRICS},
        })
        if len(rows) == MAX_ROWS:
            break
    status = "input_error" if input_error else "not_comparable" if reasons else "compared"
    return {
        "schema_version": 1, "status": status, "reasons": reasons, "budgets_per_capture": budgets,
        "baseline": left, "candidate": right,
        "observed_cohorts": None if input_error else {
            "shared": len(shared), "baseline_only": len(left_groups) - len(shared),
            "candidate_only": len(right_groups) - len(shared), "shared_omitted": len(shared) - len(rows),
            "candidate_minus_baseline": None if reasons else {
                metric: sum(right_groups[key][metric] - left_groups[key][metric] for key in shared) for metric in METRICS
            },
            "rows": rows,
        },
        "unavailable_from_d3": [
            "project_id", "paired_tasks", "model", "provider", "prompt_tokens", "completion_tokens", "elapsed_time", "cost",
            "task_outcomes", "actual_writes", "total_tool_calls", "conflict_incidents",
        ],
    }
