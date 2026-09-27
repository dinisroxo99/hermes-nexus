"""Pure read_dirty(observation) for E7/D2.

Computes local dirty classification from captured porcelain v1 -z without
side effects, Git, network or mutation. Matches porcelainIndicatesDirty
+ isOmittedUntrackedBytecode semantics from src/lib/project-revision.js
at the D2 contract (leading-space pathnames kept dirty; .pyc + .pyo omitted
only for untracked exact __pycache__ segments or basenames without leading
space; malformed porcelain refused, never invented clean).
"""

from __future__ import annotations

from typing import Any


def _is_omitted_untracked_bytecode(pathname: str) -> bool:
    """Case-sensitive __pycache__ segment or *.pyc/*.pyo basename (after / or \\).

    Untracked pathname beginning with additional literal space is NOT eligible
    for bytecode omission (retains dirty=true, omitted=false).
    """
    if not pathname or pathname[0] == " ":
        return False
    # normalize separators for split
    normalized = pathname.replace("\\", "/")
    segments = [s for s in normalized.split("/") if s]
    if any(s == "__pycache__" for s in segments):
        return True
    basename = segments[-1] if segments else ""
    return basename.endswith(".pyc") or basename.endswith(".pyo")


def _classify_porcelain(porcelain: str) -> tuple[bool, bool]:
    """Return (dirty, omitted_untracked_bytecode) or raise on malformed.

    Full scan (porcelain is bounded) to correctly or the omitted flag even when
    omitted tokens appear after a dirtying entry (rename + pycache case).
    Validates complete NUL-terminated records, two-char XY + separator,
    nonempty raw pathname, paired paths for R/C; rejects short/malformed/
    truncated/missing-NUL/interior-bad including after dirty entry.
    Leading-space variants and .pyo per D2 contract.
    Matches porcelainIndicatesDirty + isOmittedUntrackedBytecode.
    """
    if not porcelain or len(porcelain) == 0:
        return False, False
    if not porcelain.endswith("\0"):
        raise ValueError("malformed porcelain: missing final NUL")
    tokens = [t for t in porcelain.split("\0") if t]
    i = 0
    dirty = False
    omitted = False
    while i < len(tokens):
        tok = tokens[i]
        if len(tok) < 2:
            raise ValueError("malformed porcelain: short record")
        if tok[2] != " ":
            raise ValueError("malformed porcelain: missing separator")
        xy = tok[:2]
        path = tok[3:]  # exactly after structural separator at offset 2; no lstrip
        if len(path) == 0:
            raise ValueError("malformed porcelain: empty pathname")
        i += 1
        if xy[0] in ("R", "C") or xy[1] in ("R", "C"):
            if i < len(tokens):
                second = tokens[i]
                if len(second) == 0:
                    raise ValueError("truncated rename/copy")
                i += 1
            else:
                raise ValueError("truncated rename/copy")
        if xy == "??" and _is_omitted_untracked_bytecode(path):
            omitted = True
            continue
        dirty = True
        # continue scanning to catch omitted tokens that may follow; malformed after
        # a dirtying entry still raises (validate entire input)
    return dirty, omitted


def read_dirty(observation: dict[str, Any]) -> dict[str, Any]:
    """read_dirty(observation) -> closed dict or not_evaluated refusal.

    Pure. Requires exactly the three keys with correct types; extras ignored.
    Never mutates observation. Never emits dirty from input.
    """
    if not isinstance(observation, dict):
        return {
            "status": "not_evaluated",
            "reason": "input_incomplete",
            "analysisVersion": "reader-dirty-v1",
        }

    porcelain = observation.get("porcelain")
    has_filter = observation.get("serviceHasPycacheFilter")
    linked = observation.get("linkedWorktree")

    if (
        not isinstance(porcelain, str)
        or not isinstance(has_filter, bool)
        or not isinstance(linked, bool)
    ):
        return {
            "status": "not_evaluated",
            "reason": "input_incomplete",
            "analysisVersion": "reader-dirty-v1",
        }

    try:
        dirty, omitted = _classify_porcelain(porcelain)
    except Exception:
        # bounded parse-failure (malformed porcelain, short, truncated, missing NUL,
        # empty path, missing separator etc) -> existing refusal shape, no dirty key
        return {
            "status": "not_evaluated",
            "reason": "input_incomplete",
            "analysisVersion": "reader-dirty-v1",
        }
    unfiltered_length_dirty = len(porcelain) > 0
    disagree = (not has_filter) and unfiltered_length_dirty and (not dirty) and omitted

    result: dict[str, Any] = {
        "status": "observed",
        "schemaVersion": 1,
        "analysisVersion": "reader-dirty-v1",
        "dirty": dirty,
        "unfilteredLengthDirty": unfiltered_length_dirty,
        "linkedWorktree": linked,
        "omittedUntrackedBytecode": omitted,
        "disagreeWithUnfilteredService": disagree,
        "notServiceUpdate": True,
        "notInventedClean": True,
    }
    if has_filter:
        result["serviceFilter"] = True
    # serviceFilter absent when not has_filter (per test 7 vs 8)
    return result
