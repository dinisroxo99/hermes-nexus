# Roundtable Review — 25_CURRENT_TO_TARGET_MIGRATION.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `25_CURRENT_TO_TARGET_MIGRATION.md`
- `01_CURRENT_STATE.md`
- `09_IMPLEMENTATION_ROADMAP.md`
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
| **Distributed Systems Architect** | `Current-to-Target Migration Plan` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | `Current-to-Target Migration Plan` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `Current-to-Target Migration Plan` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | Requests phase gates, rollback and observability before autonomous rollout; the v4 refinements make the phase implementable in production increments. |
| **Git / SCM & Developer Tooling Engineer** | `Current-to-Target Migration Plan` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `Current-to-Target Migration Plan` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `Current-to-Target Migration Plan` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `Current-to-Target Migration Plan` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | Approves the document if it reduces cognitive load and tells an implementer what to read/do next; the explicit reading order and phase gates improve this. |
| **QA / Verification Engineer** | Requires deterministic fixtures, invariants and regression gates; the decision is accepted because the revised document now states testable outcomes. |

## Consensus

Keep additive migration; add feature flags and rollback for cross-cutting behavior.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added independent activation paths.
- Protected baseline comparisons.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
