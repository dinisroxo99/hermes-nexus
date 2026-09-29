# Offline JSONL Log Inspector (NX-PAR-01/O2)

Stdlib-only reader/validator for persisted D3 `collect-forward-log.jsonl` records.

**Location (in this worktree):** `scripts/nexus_log_inspector/`

**Invocation (from repo root):**
```
python3 -B -m scripts.nexus_log_inspector --input /explicit/path/to/collect-forward-log.jsonl --format json
```

- Explicit `--input` only. No auto-pick of `~/.hermes`, `DATA_DIR`, or service logs.
- Regular files only. Symlinks refused (conservative policy). No FIFO/socket.
- Read-only. Never mutates or overwrites input.
- Streaming with budgets. Exceeding = limited observation (not a claim about collector correctness).

## Record contract (from collector)

Exactly these six keys (no more, no less, no extra after validation):

- `runId`: non-empty string (verbatim)
- `profile`: non-empty string (verbatim)
- `sha`: non-empty string (verbatim; the commit sha of the call site)
- `nexusTools`: boolean (True/False; never int/str/None)
- `writePaths`: list[str] (may be empty; each entry non-empty after strip; order+duplicates preserved)
- `watchPaths`: list[str] (same rules)

Path lists are caller-declared; they are **not** a list of files that were actually written in this run.

## Output (JSON)

```json
{
  "status": "ok",
  "input": "...",
  "examined": 12,
  "valid": 11,
  "invalid": 1,
  "complete": false,
  "limited": true,
  "limited_reason": "max_bytes_exceeded",
  "bytes_observed": 1048576,
  "records_observed": 10001,
  "file_size_before": 123456,
  "file_size_after": 123456,
  "changed_during_read": false,
  "incomplete_last_line": true,
  "invalid_records": [
    {"line": 7, "code": "not_bool", "field": "nexusTools"}
  ],
  "profile_sha_groups": {
    "impl:050540d0...": {"count": 5, "run_ids_sample": ["run-1", "run-2"]}
  },
  "distinct_correlation_keys": 3,
  "declared_write_path_entries": 7,
  "declared_watch_path_entries": 2,
  "budgets": {"max_bytes": 10485760, "max_records": 10000, "max_line_bytes": 1048576}
}
```

- `complete`: true only if no limits, no change, no incomplete last line.
- `distinct_correlation_keys`: `(profile, sha, runId)` tuples. Not a Kanban run count.
- Declared counts: sums of list lengths in the records (data, not filesystem effect).
- `invalid_records` capped (20). Diagnostics use line+code+field only. No raw values (to avoid control chars in terminal).
- Limited groupings capped.

Text format (`--format text`) produces a human summary of the same fields.

## Budgets (defaults, overridable via CLI flags)

- `--max-bytes` 10 MiB
- `--max-records` 10000
- `--max-line-bytes` 1 MiB

Exceeding any budget during streaming read marks `limited` + reason. The observation is partial by design for large logs.

## Incomplete / edge cases

- Empty file: `examined=0`, `complete=true`.
- Truncated last line (file ends without `\n` and final JSON parse fails): `incomplete_last_line=true`, treated as limited observation.
- File grew or mtime changed while reading: `changed_during_read=true`, limited.
- Concurrent writers: not atomic snapshot. Use for offline analysis only.
- Blank lines, duplicate keys in JSON, non-finite numbers, wrong types: invalid record.

## Privacy / guarantees

- Reads only the explicit file you name.
- No PII scrubbing beyond "do not dump raw values in diagnostics".
- No delivery, idempotency, or exactly-once guarantees from the log itself. Repeats may be distinct calls. No timestamps or cost in the persisted records.
- `nexusTools` boolean only indicates whether the *call* to Context/Impact was accepted by the tools layer at that moment; does not imply experiment groups, test coverage, task success, write authorization, or conflicts.
- Correlation key `(profile, sha, runId)` is for grouping records from the same logical call site + identity; it is **not** guaranteed to equal Kanban run count.

## Example synthetic input (for tests/docs)

```jsonl
{"runId":"run-42","profile":"impl","sha":"050540d0ebb3899198a5695eaec913de59cb1b8d","nexusTools":true,"writePaths":["scripts/nexus_log_inspector/inspector.py"],"watchPaths":[]}
{"runId":"run-42","profile":"impl","sha":"050540d0ebb3899198a5695eaec913de59cb1b8d","nexusTools":true,"writePaths":[],"watchPaths":["tests/hermes_nexus_plugin/test_log_inspector.py"]}
```

## Exit codes (CLI)

- 0: read finished (report may show limited/invalid/empty)
- 1: input error (missing, permission, not regular file, symlink, etc.)

## Development notes

- Pure stdlib (json, pathlib, argparse, os, stat).
- No collector, no runtime, no network, no ~/.hermes.
- Tests use only synthetic TemporaryDirectory data.
- This tool does not redefine D3; it only observes persisted records against the contract published by `collect_forward_log`.

See also: `docs/CURRENT_STATUS.md` (D3 section), collector contract, and task `t_debe5242`.
