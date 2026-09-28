#!/usr/bin/env python3
"""Local syntax-only preflight for project_task_context / project_impact arguments.

Usage:
  python3 -B -m scripts.nexus_request_preflight --tool project_task_context --input args.json
  python3 -B -m scripts.nexus_request_preflight --tool project_impact --input -   # stdin
  ... --json   # machine readable
  ... --echo-input   # dump original payload (explicit flag only)

- Syntax only. Reuses canonical validators from checkout.
- Never contacts network, git, ~/.hermes or any service.
- 1 MiB input limit (independent of transport).
- Reports: invalid_json, invalid_arguments, input_valid + diagnostics.
- validationScope: syntax_only (does not prove revision truth or project availability).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

MAX_INPUT_BYTES = 1 * 1024 * 1024  # 1 MiB; documented limit, independent of Nexus
VALID_TOOLS = ("project_task_context", "project_impact")


def _load_schemas():
    """Derive schema module ONLY from this checkout (no env/JSON/user path)."""
    # __main__.py is at scripts/nexus_request_preflight/__main__.py
    # parents[2] reaches workspace root
    script_dir = Path(__file__).resolve().parent
    # from scripts/nexus_request_preflight/  -> parents[1] reaches workspace root containing integrations/
    schemas_path = script_dir.parents[1] / "integrations" / "hermes-nexus" / "schemas.py"
    if not schemas_path.exists():
        raise RuntimeError(f"canonical schemas not found at checkout-relative path: {schemas_path}")
    spec = importlib.util.spec_from_file_location("nexus_request_preflight_schemas", str(schemas_path))
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to create spec for schemas")
    module = importlib.util.module_from_spec(spec)
    # do not pollute sys.modules with real name to avoid any registration side effects
    spec.loader.exec_module(module)
    return module


def _load_input(input_path: str | None) -> bytes:
    """Read at most MAX+1 bytes; return raw bytes. No external contact."""
    if input_path is None or input_path == "-":
        # bounded stdin
        data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    else:
        p = Path(input_path)
        if not p.exists():
            raise FileNotFoundError(f"input not found: {input_path}")
        # bounded read
        with p.open("rb") as f:
            data = f.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError("input_oversized")
    return data


def _parse_json_bounded(raw: bytes) -> Any:
    """UTF-8 + duplicate key + NaN/Inf rejection. No payload dump on error."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise ValueError(f"invalid_utf8: {e}") from None

    # detect duplicate keys (last-wins in std json) -- per object, not document-global
    def _pairs_hook(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        seen: set[str] = set()
        d: dict[str, Any] = {}
        for k, v in pairs:
            if not isinstance(k, str):
                raise ValueError("non_string_key")
            if k in seen:
                raise ValueError("duplicate_key")
            seen.add(k)
            d[k] = v
        return d

    try:
        obj = json.loads(text, object_pairs_hook=_pairs_hook)
    except json.JSONDecodeError as e:
        raise ValueError(f"json_decode: {e}") from None

    # NaN / Infinity are rejected by std json by default; double-check floats
    def _check_finite(o: Any) -> None:
        if isinstance(o, float) and not math.isfinite(o):
            raise ValueError("non_finite_number")
        if isinstance(o, dict):
            for v in o.values():
                _check_finite(v)
        elif isinstance(o, list):
            for v in o:
                _check_finite(v)

    _check_finite(obj)
    return obj


def _top_level_object(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise ValueError("top_level_not_object")
    return obj


def _shallow_diagnostics(obj: dict[str, Any], tool: str) -> list[dict[str, str]]:
    """Supplementary missing-field / shape diagnostics (diagnostic only)."""
    diags: list[dict[str, str]] = []
    required_top = ["projectId", "worktree", "expectedRevision", "task" if tool == "project_task_context" else "paths"]
    for f in required_top:
        if f not in obj:
            diags.append({"field": f, "code": "missing_required"})

    if "worktree" in obj:
        wt = obj["worktree"]
        if isinstance(wt, dict):
            for sub in ("rootId", "relativePath"):
                if sub not in wt:
                    diags.append({"field": f"worktree.{sub}", "code": "missing_required"})
        else:
            diags.append({"field": "worktree", "code": "wrong_type"})

    if "expectedRevision" in obj:
        rev = obj["expectedRevision"]
        if isinstance(rev, dict):
            rev_req = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree"]
            if tool == "project_impact":
                rev_req += ["repositoryId", "worktreeId"]
            for f in rev_req:
                if f not in rev:
                    diags.append({"field": f"expectedRevision.{f}", "code": "missing_required"})
            # common shape notes (not full validation)
            if "dirty" in rev and rev["dirty"] is not False:
                diags.append({"field": "expectedRevision.dirty", "code": "must_be_false"})
            if "isLinkedWorktree" in rev and rev["isLinkedWorktree"] is not True:
                diags.append({"field": "expectedRevision.isLinkedWorktree", "code": "must_be_true"})
            has_repo = "repositoryId" in rev
            has_wt = "worktreeId" in rev
            if has_repo != has_wt:
                diags.append({"field": "expectedRevision", "code": "unpaired_opaque_ids"})
            if tool == "project_impact" and not (has_repo and has_wt):
                diags.append({"field": "expectedRevision", "code": "missing_opaque_ids"})
        else:
            diags.append({"field": "expectedRevision", "code": "wrong_type"})

    if tool == "project_task_context" and "task" in obj:
        t = obj["task"]
        if isinstance(t, dict):
            if "title" not in t:
                diags.append({"field": "task.title", "code": "missing_required"})
            if "paths" in t:
                if not isinstance(t["paths"], list):
                    diags.append({"field": "task.paths", "code": "wrong_type"})
                elif len(t["paths"]) == 0:
                    diags.append({"field": "task.paths", "code": "empty_paths_warning", "note": "syntactically valid for Context; collection may be skipped"})
        else:
            diags.append({"field": "task", "code": "wrong_type"})

    if tool == "project_impact" and "paths" in obj:
        p = obj["paths"]
        if isinstance(p, list):
            if len(p) == 0:
                diags.append({"field": "paths", "code": "empty_paths"})
        else:
            diags.append({"field": "paths", "code": "wrong_type"})

    if "branch" in (obj.get("expectedRevision") or {}):
        br = obj["expectedRevision"]["branch"]
        if br is None:
            diags.append({"field": "expectedRevision.branch", "code": "null_branch_warning", "note": "schema-valid for Context (no Git observation)"})

    # extra top-level (will also be caught by validator)
    allowed = set(required_top) | {"limits"}
    if tool == "project_task_context":
        allowed |= {"includeExcerpts"}
    else:
        allowed |= {"includeTests"}
    for k in obj:
        if k not in allowed:
            diags.append({"field": k, "code": "extra_property"})

    return diags


def _validate(tool: str, obj: dict[str, Any], schemas: Any) -> tuple[str, list[dict[str, str]]]:
    """Return (status, diagnostics). Final decision by canonical validator."""
    try:
        if tool == "project_task_context":
            schemas.validate_task_context_arguments(obj)
        else:
            schemas.validate_impact_arguments(obj)
        return "input_valid", []
    except schemas.ArgumentsError as e:
        # validator gives no field details; use our diags + generic
        return "invalid_arguments", [{"field": "<validator>", "code": "canonical_rejected", "message": str(e)}]
    except Exception as e:  # safety, do not leak
        return "invalid_arguments", [{"field": "<internal>", "code": "unexpected", "message": type(e).__name__}]


def _format_report(
    status: str,
    tool: str,
    diags: list[dict[str, str]],
    warnings: list[str],
    json_out: bool,
    echo: dict[str, Any] | None,
) -> str:
    report: dict[str, Any] = {
        "status": status,
        "tool": tool,
        "validationScope": "syntax_only",
        "limits": {"maxInputBytes": MAX_INPUT_BYTES, "note": "local helper limit; not a transport cap"},
    }
    if diags:
        report["diagnostics"] = diags
    if warnings:
        report["warnings"] = warnings
    if echo is not None:
        report["echoInput"] = echo  # only when explicit flag

    if json_out:
        return json.dumps(report, indent=2, sort_keys=True) + "\n"

    # human readable
    lines = [
        f"status: {status}",
        f"tool: {tool}",
        "validationScope: syntax_only",
        f"limits.maxInputBytes: {MAX_INPUT_BYTES}",
    ]
    if warnings:
        for w in warnings:
            lines.append(f"warning: {w}")
    if diags:
        lines.append("diagnostics:")
        for d in diags:
            f = d.get("field", "?")
            c = d.get("code", "?")
            note = d.get("note") or d.get("message") or ""
            lines.append(f"  - {f}: {c} {note}".rstrip())
    if echo is not None:
        lines.append("echoInput:")
        lines.append(json.dumps(echo, indent=2))
    lines.append("")  # trailing nl
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="nexus_request_preflight",
        description="Local syntax preflight for Context/Impact request arguments (syntax_only).",
    )
    ap.add_argument("--tool", required=True, choices=VALID_TOOLS, help="which argument shape to validate")
    ap.add_argument("--input", default=None, help="JSON file path, or - for stdin (default stdin)")
    ap.add_argument("--json", action="store_true", help="emit JSON report instead of human text")
    ap.add_argument("--echo-input", dest="echo", action="store_true", help="include original payload in output (explicit; never default)")
    args = ap.parse_args(argv)

    try:
        schemas = _load_schemas()
        raw = _load_input(args.input)
        obj = _parse_json_bounded(raw)
        obj = _top_level_object(obj)
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except ValueError as e:
        msg = str(e)
        if "oversized" in msg or "input_oversized" in msg:
            status = "invalid_json"
            diags = [{"field": "<input>", "code": "oversized", "note": f"exceeds {MAX_INPUT_BYTES} bytes"}]
        elif "utf8" in msg or "duplicate" in msg or "non_finite" in msg or "json_decode" in msg or "top_level" in msg:
            status = "invalid_json"
            diags = [{"field": "<json>", "code": msg.split(":")[0] if ":" in msg else msg}]
        else:
            status = "invalid_json"
            diags = [{"field": "<json>", "code": "invalid"}]
        echo_on_error = None
        report = _format_report(status, args.tool, diags, [], args.json, echo_on_error)
        print(report, end="")
        return 1

    diags = _shallow_diagnostics(obj, args.tool)
    warnings: list[str] = []
    # pull some warnings from diags
    for d in list(diags):
        if d.get("code", "").endswith("_warning"):
            warnings.append(f"{d['field']}: {d.get('note', '')}")
            # keep in diags too? or remove; task allows warnings separate
    # final canonical
    status, vdiags = _validate(args.tool, obj, schemas)
    diags.extend(vdiags)

    echo = deepcopy(obj) if args.echo else None
    # never inject fields into the object itself
    report = _format_report(status, args.tool, diags, warnings, args.json, echo)
    print(report, end="")

    if status == "input_valid":
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
