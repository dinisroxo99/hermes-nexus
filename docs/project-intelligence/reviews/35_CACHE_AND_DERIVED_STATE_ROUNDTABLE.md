# Roundtable Review — 35_CACHE_AND_DERIVED_STATE.md

**Decision:** NEW — approved after roundtable

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `35_CACHE_AND_DERIVED_STATE.md`
- `04_ICM_AND_CONTEXT_PACK.md`
- `06_SCOPE_IMPACT_CONFLICTS.md`
- `28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md`

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
| **Distributed Systems Architect** | `Cache, Invalidation and Derived State` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | `Cache, Invalidation and Derived State` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | Requires provenance, secret redaction and poisoning controls before data from `Cache, Invalidation and Derived State` is reused for Project Expert answers or training. |
| **SRE / Observability Engineer** | Approves once idempotent telemetry, retention, health and recovery semantics are explicit; 24/7 claims require measurable operational limits. |
| **Git / SCM & Developer Tooling Engineer** | Strongly supports revision/worktree-aware semantics; a commit SHA alone is insufficient for dirty worktrees, and final diff remains the mutation audit. |
| **Data / Knowledge Architect** | Approves the revised source-of-truth, provenance and lifecycle model; stable IDs and schema/policy versions are necessary for future learning. |
| **ML / MLOps Engineer** | Approves retrieval-first learning, but insists on validated labels, frozen evaluation sets and reproducible exports before fine-tuning/router learning. |
| **API / MCP Integration Engineer** | `Cache, Invalidation and Derived State` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Cache, Invalidation and Derived State` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Cache, Invalidation and Derived State` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Create. Token-saving depends on reuse, but stale derived state is a major correctness risk.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Defined revision/dirty-state cache keys.
- Added invalidation, single-flight and cache metrics.

## Outcome

This file was created because the roundtable identified a cross-cutting concern that could not be safely left implicit or scattered across other documents.
