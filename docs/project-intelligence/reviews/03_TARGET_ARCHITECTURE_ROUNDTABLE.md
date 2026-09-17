# Roundtable Review — 03_TARGET_ARCHITECTURE.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `03_TARGET_ARCHITECTURE.md`
- `02_DECISIONS_FROM_CHATS.md`
- `30_STATE_AND_DATA_MODEL.md`
- `31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md`

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
| **Distributed Systems Architect** | Supports `Target Architecture` provided ownership and failure boundaries remain explicit; the v4 changes reduce duplicated state and ambiguous recovery. |
| **Multi-Agent / LLM Systems Engineer** | `Target Architecture` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `Target Architecture` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | `Target Architecture` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | `Target Architecture` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | Approves the revised source-of-truth, provenance and lifecycle model; stable IDs and schema/policy versions are necessary for future learning. |
| **ML / MLOps Engineer** | `Target Architecture` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `Target Architecture` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Target Architecture` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Target Architecture` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Keep the boundary; add explicit control/data/knowledge planes and state ownership.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added three-plane model.
- Linked canonical state ownership.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
