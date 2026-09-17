# Observability, Event Store and Learning Data

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/08_OBSERVABILITY_AND_LEARNING_ROUNDTABLE.md`


## Goal

Every agent execution should produce structured data that can later improve:

- project QA;
- model routing;
- context selection;
- failure prediction;
- task complexity prediction;
- future Project Expert training/distillation.

This is not merely application logging.


## Reuse Hermes telemetry first

Before creating a parallel raw event stream, ingest the runtime data Hermes already owns:

```text
Kanban task_events
run history
worker lifecycle
tool hooks
provider/API usage
token usage
correlation ids
```

Project Map adds only project-aware metadata such as `projectId`, revision, Context Pack, ICM, impact and scope.

See `19_HERMES_TELEMETRY_INGESTION.md`.

## Storage categories

### Structured relational state

Recommended:

```text
PostgreSQL
```

Entities:

```text
projects
tasks
runs
agents/profiles
models/providers
context_packs
scope_snapshots
tool_calls
test_results
reviews
feedback
project_observations
```

### Immutable event stream

A `run_events` structure:

```text
sequence
runId
eventType
timestamp
payload
```

### Large raw artifacts

Store externally from relational rows:

```text
prompts
responses
patches
diffs
test output
logs
context snapshots
```

Filesystem/object storage is sufficient initially.

### Analytics/training export

Produce versioned:

```text
JSONL
Parquet
```

datasets from validated runs.

## Suggested event vocabulary

```text
TASK_SEEN
TASK_CLAIMED
PROJECT_RESOLVED
ICM_RESOLVED
CONTEXT_PACK_BUILT
IMPACT_CALCULATED
SCOPE_RESOLVED
CONFLICT_DETECTED
MODEL_SELECTED
AGENT_STARTED
TOOL_CALLED
TOOL_BLOCKED
PATCH_CREATED
TEST_STARTED
TEST_FAILED
TEST_PASSED
REVIEW_STARTED
REVIEW_REJECTED
REVIEW_APPROVED
HUMAN_FEEDBACK
TASK_COMPLETED
TASK_FAILED
```

## Run record

Minimum useful fields:

```text
runId
taskId
projectId
profile
model
provider
gitShaBefore
gitShaAfter
contextPackId
contextTokens
promptTokens
completionTokens
toolCallCount
duration
attempt
buildResult
testResult
reviewResult
humanAccepted
failureReason
startedAt
completedAt
```

## Training-quality labels

Do not treat every completed run as a positive example.

A high-quality run may require:

```text
tests pass
+ review approved
+ human accepted or no manual correction
```

Record manual correction when possible.

## Future learning tasks

### Router learning

Predict:

```text
best model/profile policy
```

from:

```text
task type
language
impact
complexity
context size
historical outcomes
```

### Context ranking

Learn which evidence was actually useful for successful tasks.

### Complexity prediction

Predict likely:

```text
files touched
retries
tokens
duration
review depth
```

### Project Expert improvement

Create QA pairs from:

```text
question
retrieved evidence
accepted answer
current revision
```

## Data hygiene

Every training sample must retain:

```text
projectId
git revision
source evidence
validation outcome
timestamp
```

Exclude or separately label:

```text
failed runs
stale context
unverified guesses
superseded decisions
```

## Privacy / secrets

Before exporting training datasets:

- strip credentials;
- strip API keys/tokens;
- avoid raw environment dumps;
- allow repository/project-level exclusion policies;
- keep private source-code datasets local unless explicitly approved.

## Event reliability

Normalized telemetry must follow:

```text
32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md
```

Specifically:

```text
stable event IDs
schema versions
idempotent ingestion
late-event handling
retention/sensitivity classification
```

## Trace interoperability

Where practical, preserve standard trace/correlation concepts rather than inventing incompatible identifiers. Native Hermes IDs remain authoritative for Hermes-originated events.
