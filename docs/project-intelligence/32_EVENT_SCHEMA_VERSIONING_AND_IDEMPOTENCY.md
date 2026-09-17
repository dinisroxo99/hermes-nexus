# Event Schema, Versioning and Idempotency

> **Roundtable review v4:** NEW — approved after roundtable — 2026-09-17  
> Companion review: `reviews/32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

Make telemetry reliable enough for debugging, analytics and future training.

Logging the same event twice or receiving events out of order must not corrupt learning data.

## Event envelope

Every normalized event uses a common envelope:

```json
{
  "eventId": "evt_...",
  "schemaVersion": 1,
  "eventType": "TOOL_CALLED",
  "occurredAt": "...",
  "ingestedAt": "...",
  "source": "hermes|project-map|human",
  "projectId": "...",
  "taskId": "...",
  "runId": "...",
  "sessionId": "...",
  "turnId": "...",
  "sequence": 42,
  "payload": {}
}
```

Identifiers may be null when the source genuinely lacks them.

## Event ID

Prefer a stable source event identifier.

If the source has none, derive one from a deterministic tuple where safe:

```text
source
source-record-id
event type
run/task id
```

Do not use a random new ID on every retry of the same ingestion operation.

## Idempotent ingestion

Insert semantics:

```text
eventId already exists
→ no duplicate logical event
```

The ingestion consumer may retry safely.

## Ordering

Do not assume global ordering.

Ordering guarantees should be scoped to the strongest available key:

```text
run sequence
turn sequence
source timestamp
```

Use event type/state semantics instead of relying only on timestamps.

## Schema evolution

Rules:

1. additive optional fields are preferred;
2. breaking payload changes increment `schemaVersion`;
3. old events remain readable;
4. export jobs record the schema versions used;
5. training pipelines pin accepted schema versions.

## Event registry

Maintain a small registry/documentation for each event:

```text
event type
producer
required identifiers
payload schema
retention class
sensitivity
```

## Correlation

Preserve native Hermes correlation IDs where available:

```text
task_id
session_id
turn_id
api_request_id
tool_call_id
```

Project Map adds `projectId` and derived snapshot references.

## Late events

An event arriving after task completion remains valid historical data.

Do not reopen task state merely because telemetry arrived late.

## Tombstones and deletion

If project policy requires deletion/redaction, maintain a deletion/tombstone record so derived training exports can exclude removed data.

## Acceptance criteria

- ingestion retry cannot create duplicate logical events;
- out-of-order events do not corrupt task/run truth;
- schema changes are versioned;
- event sensitivity/retention is documented;
- training export can reproduce exactly which event schema versions were used.
