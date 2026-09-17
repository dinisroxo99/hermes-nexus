# Roundtable Review — 32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md

**Decision:** NEW — approved after roundtable

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md`
- `19_HERMES_TELEMETRY_INGESTION.md`
- `14_PHASE_5_OBSERVABILITY_TRAINING_DATA.md`
- `30_STATE_AND_DATA_MODEL.md`

Global architecture assumptions supplied to every expert:

- Hermes remains the runtime/orchestrator and Kanban owner.
- `hermes-project-map` remains the project-intelligence / ICM / impact / scope layer.
- Honcho is experiential memory, not current-code truth.
- Git/revision-aware Project Intelligence is authoritative for current repository facts.
- The Project Expert is read-only and retrieval-first.
- Context should be bounded and measurable rather than dumping the repository.

## 10-expert roundtable

| Expert | Assessment |
|---|---|
| **Distributed Systems Architect** | `Event Schema, Versioning and Idempotency` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | `Event Schema, Versioning and Idempotency` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | Requires provenance, secret redaction and poisoning controls before data from `Event Schema, Versioning and Idempotency` is reused for Project Expert answers or training. |
| **SRE / Observability Engineer** | Approves once idempotent telemetry, retention, health and recovery semantics are explicit; 24/7 claims require measurable operational limits. |
| **Git / SCM & Developer Tooling Engineer** | Requires every code-related historical claim in `Event Schema, Versioning and Idempotency` to preserve the repository revision that produced it. |
| **Data / Knowledge Architect** | Approves the revised source-of-truth, provenance and lifecycle model; stable IDs and schema/policy versions are necessary for future learning. |
| **ML / MLOps Engineer** | Approves retrieval-first learning, but insists on validated labels, frozen evaluation sets and reproducible exports before fine-tuning/router learning. |
| **API / MCP Integration Engineer** | `Event Schema, Versioning and Idempotency` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Event Schema, Versioning and Idempotency` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Event Schema, Versioning and Idempotency` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Create. Telemetry intended for training requires reliable event semantics.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Defined event envelope, deduplication and ordering.
- Defined schema evolution and training pinning.

## Outcome

This file was created because the roundtable identified a cross-cutting concern that could not be safely left implicit or scattered across other documents.
