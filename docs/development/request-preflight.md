# Request Preflight (local CLI helper)

Local, syntax-only validator for `project_task_context` and `project_impact` tool argument JSON.

- Not a Hermes tool, not an endpoint, not a Context Pack, not runtime integration.
- Reuses the canonical validators from `integrations/hermes-nexus/schemas.py` (loaded from checkout-relative path only).
- Pure stdlib. No new dependencies. No network, no Git, no `~/.hermes`, no handlers, no service contact.
- Intended for one local run to list missing fields (worktree, rootId, status, branch, opaque IDs, ...) before sending a request.

## Invocation (exact shape required by acceptance)

```sh
python3 -B -m scripts.nexus_request_preflight --tool project_task_context --input pedido.json
python3 -B -m scripts.nexus_request_preflight --tool project_impact --input -
python3 -B -m scripts.nexus_request_preflight --tool project_task_context --input ctx.json --json --echo-input
```

- `--tool` (required): `project_task_context` | `project_impact`
- `--input` (optional): path to JSON file, or `-` / omitted for stdin
- `--json`: emit machine-readable report (default: human text)
- `--echo-input`: include original payload (explicit flag only; never default; never mutates the validated object)

Exit codes:
- 0: `input_valid`
- 1: `invalid_json` or `invalid_arguments`
- 2: usage / file not found

## Output states (local helper only)

- `invalid_json`: UTF-8, duplicate keys, NaN/Infinity, top-level not object, oversized (>1 MiB), malformed
- `invalid_arguments`: rejected by canonical `validate_task_context_arguments` / `validate_impact_arguments`
- `input_valid`: accepted by canonical validator
- warnings (do not change validity): e.g. branch null, task.paths omitted, empty paths for Context

Always includes:
- `validationScope: "syntax_only"`
- `limits.maxInputBytes: 1048576`
- diagnostic entries with `field` and `code`

Example human (valid):

```
status: input_valid
tool: project_task_context
validationScope: syntax_only
limits.maxInputBytes: 1048576
```

Example (invalid dirty):

```
status: invalid_arguments
tool: project_task_context
validationScope: syntax_only
...
diagnostics:
  - expectedRevision.dirty: must_be_false
  - <validator>: canonical_rejected ...
```

JSON output contains the same keys plus optional `diagnostics`, `warnings`, `echoInput` (only on flag).

## Synthetic example (for testing only; never real IDs)

Context (valid shape):

```json
{
  "projectId": "prj_synth",
  "worktree": { "rootId": "local", "relativePath": "w" },
  "expectedRevision": {
    "status": "available",
    "commitSha": "a".repeat(40),
    "branch": "feat/test",
    "dirty": false,
    "isLinkedWorktree": true
  },
  "task": { "title": "synth", "paths": ["x.js"] }
}
```

Impact requires both opaque IDs in expectedRevision and non-empty paths.

## What this does / does not

- Lists missing required fields (top + nested) as diagnostics.
- Enforces Context vs Impact differences (both/none opaque IDs; branch null; paths rules).
- Rejects extras, wrong types, booleans as numbers where validator does.
- 1 MiB hard cap before decode (no traceback containing payload).
- Pass-through: final accept/reject is always the canonical validator (no fork, no reimplementation of full schema).

It does **not**:
- Verify that IDs exist, revision is real, worktree is clean/linked, status is actually available, or that the project contains the paths.
- Perform collection, Git ops, or service calls.
- Eliminate runtime refusals from Nexus (partial evidence, source limits, provider coverage, policy, etc. can still reject a syntactically valid request).
- Default-fill any field (dirty, IDs, status, branch, ...).
- Accept or normalize globs, absolute paths, or user-specific locators.

After a `input_valid` diagnosis:
- Use the exact validated object (or a strict subset) when calling the real tool.
- Still obtain real Context then Impact evidence using the authoritative service for the actual revision before editing.
- Treat any later refusal as a signal to narrow the task description or paths.

## Relation to Effective Task Scope / ETS

This preflight is a local syntax gate. ETS (`project_effective_task_scope`) is a separate post-Context+Impact composition step that classifies WRITE/WATCH using the actual pack and impact results. Syntax-valid arguments can still produce `not_evaluated`, `incomplete`, or empty evidence when targets are new or outside provider coverage.

## Limits and scope

- Input size limit is a helper constant (documented); independent of any Nexus transport cap.
- Synthetic IDs and fixtures only in tests.
- The helper must load its schemas relative to the current checkout (never from env, JSON, argv paths, or ~/.hermes).

See:
- `integrations/hermes-nexus/schemas.py` (validators + shapes)
- `tests/hermes_nexus_plugin/test_request_preflight.py` (coverage of CLI + internal cases)
- `scripts/nexus_request_preflight/__main__.py` (implementation)

Do not rely on this to replace a live Context/Impact round-trip or ETS classification for edit authorization.
