# Roundtable Review — 23_24_7_DEPLOYMENT_AND_OPERATIONS.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `23_24_7_DEPLOYMENT_AND_OPERATIONS.md`
- `34_BACKUP_RECOVERY_AND_RUNBOOKS.md`
- `19_HERMES_TELEMETRY_INGESTION.md`
- `22_MODEL_ROUTING_AND_TOKEN_BUDGETS.md`

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
| **Distributed Systems Architect** | Supports `24/7 Deployment and Operations` provided ownership and failure boundaries remain explicit; the v4 changes reduce duplicated state and ambiguous recovery. |
| **Multi-Agent / LLM Systems Engineer** | `24/7 Deployment and Operations` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `24/7 Deployment and Operations` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | Approves once idempotent telemetry, retention, health and recovery semantics are explicit; 24/7 claims require measurable operational limits. |
| **Git / SCM & Developer Tooling Engineer** | `24/7 Deployment and Operations` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `24/7 Deployment and Operations` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `24/7 Deployment and Operations` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `24/7 Deployment and Operations` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `24/7 Deployment and Operations` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `24/7 Deployment and Operations` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Keep; add capacity ceilings and split backup/recovery into a dedicated runbook.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added resource/queue/log bounds.
- Linked recovery document.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
