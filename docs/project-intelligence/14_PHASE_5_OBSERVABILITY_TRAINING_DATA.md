# Phase 5 Implementation — Observability and Training Data

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/14_PHASE_5_OBSERVABILITY_TRAINING_DATA_ROUNDTABLE.md`


Status: **PLANNED**

## Objective

Create a durable execution history suitable for:

- debugging;
- project historical QA;
- benchmark analysis;
- router optimization;
- future Project Expert training.

## Hermes telemetry adapter

Do not recreate Hermes task/run lifecycle tables. Ingest Hermes task events, run metadata, worker lifecycle and provider/token usage, then attach Project Map-specific metadata.

## MVP storage

Recommended:

```text
PostgreSQL
+
filesystem/object artifacts
```

Do not introduce a complex event platform until load requires it.

## Tables / logical entities

### `runs`

```text
id
task_id
project_id
profile
provider
model
git_sha_before
git_sha_after
context_pack_id
context_tokens
prompt_tokens
completion_tokens
tool_calls
duration_ms
attempt
status
failure_reason
started_at
completed_at
```

### `run_events`

```text
id
run_id
sequence
event_type
payload_json
created_at
```

### `scope_snapshots`

```text
id
run_id
revision
write_json
reserved_json
watch_json
impact_json
confidence
```

### `feedback`

```text
run_id
source
accepted
rating
manual_fix_required
notes
```

### `project_observations`

Only validated durable observations.

Fields should track:

```text
projectId
revision/range
source
status
supersededBy
confidence
```

## Artifact references

Do not put every large payload directly into DB rows.

Store references to:

```text
prompt
response
diff
patch
test output
review report
Context Pack
```

## Dataset export

Provide versioned export command/service:

```text
export successful runs
export project QA
export router dataset
```

Formats:

```text
JSONL
Parquet
```

## Quality filters

A training example should record validation state.

Preferred positive signal:

```text
tests pass
review approved
human accepted / no correction
```

Do not silently treat `TASK_COMPLETED` as ground truth quality.

## Metrics

Track:

```text
tokens/task
tool calls/task
time/task
first-pass success
retry count
review rejection rate
manual-fix rate
context size
blocked mutation count
conflict incidents
```

## Done criteria

- every worker run has stable runId;
- critical lifecycle events are persisted;
- data can be queried by project/task/model/profile;
- export strips configured secrets;
- Project Expert can consume validated project history;
- benchmark can compare baseline vs bounded-context flow.

## Ingestion guarantees

Implement:

```text
idempotent event writes
schemaVersion
source event correlation
retention class
sensitivity class
redaction status
```

before relying on data for training.

Training exports must include a manifest with:

```text
query/filter
schema versions
code/export version
timestamp
sample count
hash/checksum
```
