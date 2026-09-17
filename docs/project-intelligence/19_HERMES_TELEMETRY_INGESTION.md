# Hermes Telemetry Ingestion

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/19_HERMES_TELEMETRY_INGESTION_ROUNDTABLE.md`


Status: **PLANNED**

## Objective

Reuse Hermes runtime telemetry instead of creating a duplicate orchestration event system.

## Hermes data to consume

The integration should prefer runtime-native data for:

```text
Kanban task lifecycle
task runs/attempts
worker state
task_events
tool calls
LLM/provider requests
token usage
API errors/retries
model/provider identity
session/task correlation ids
```

## Project Map data to add

Project Map owns the additional project-aware envelope:

```text
projectId
git revision
ICM stage
Context Pack id
impact snapshot
scope snapshot
conflict snapshot
Project Expert queries
validated project observations
human/project-specific labels
```

## Correlation model

Normalize around:

```text
projectId
taskId
runId
sessionId
turnId
apiRequestId
```

Not every event contains every identifier.

The ingestion layer must preserve the identifiers provided by Hermes rather than generating replacements unnecessarily.

## Event pipeline

```text
Hermes hooks / Kanban DB
          │
          ▼
Telemetry Adapter
          │
          ├─ normalize
          ├─ add projectId
          ├─ add git revision
          └─ attach Project Map snapshots
          │
          ▼
Learning / Observability Store
```

## Recommended runtime hooks

Use observer hooks for telemetry.

Examples of useful categories:

```text
post_tool_call
pre/post API request
API request error
Kanban task lifecycle
worker spawned/exited/stale
task updated
dispatch tick where operationally useful
```

Use `pre_llm_call` and `pre_tool_call` for control/context, not as the only source of historical telemetry.

## Token accounting

Record actual runtime token usage when available.

Do not infer token consumption solely from stored prompt text.

Minimum fields:

```text
prompt/input tokens
completion/output tokens
cached tokens if exposed
model
provider
taskId
runId
turnId
timestamp
```

## Data minimization

Do not automatically persist full provider payloads forever.

Prefer:

```text
metadata
usage
hashes
artifact references
bounded/sanitized payload
```

Raw prompt/response retention should be configurable per project.

## Hermes DB ownership

Do not write directly into Hermes internal Kanban tables from Project Map unless an official integration contract explicitly requires it.

Treat Hermes as owner of its DB.

Ingest via:

```text
hooks
REST/plugin API
read-only adapter where stable and explicitly supported
```

## Training data construction

Training/export data is derived, not raw.

Example:

```text
Hermes run
+ Context Pack
+ scope/impact
+ test/review outcome
+ human acceptance
        ↓
validated training example
```

## Acceptance criteria

- no duplicate task lifecycle state machine;
- a single run can be reconstructed across Hermes and Project Map data;
- token metrics use runtime usage;
- events are project-scoped;
- raw sensitive payload retention is configurable;
- ingestion failure does not corrupt Hermes task execution.

## Delivery semantics

Assume telemetry delivery can be:

```text
at-least-once
late
partially ordered
```

The adapter must therefore use the event rules in `32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md`.

Telemetry ingestion must never block or corrupt the Hermes execution path if the analytics store is temporarily unavailable.
