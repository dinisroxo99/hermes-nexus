# Roundtable Review — 11_PHASE_2_SCOPE_CONFLICT_ENGINE.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `11_PHASE_2_SCOPE_CONFLICT_ENGINE.md`
- `06_SCOPE_IMPACT_CONFLICTS.md`
- `30_STATE_AND_DATA_MODEL.md`
- `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md`

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
| **Distributed Systems Architect** | The state transitions in `Phase 2 Implementation — Scope and Conflict Engine` need revision binding and deterministic conflict semantics; the added lifecycle/invariants address that. |
| **Multi-Agent / LLM Systems Engineer** | `Phase 2 Implementation — Scope and Conflict Engine` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `Phase 2 Implementation — Scope and Conflict Engine` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | Requests phase gates, rollback and observability before autonomous rollout; the v4 refinements make the phase implementable in production increments. |
| **Git / SCM & Developer Tooling Engineer** | Strongly supports revision/worktree-aware semantics; a commit SHA alone is insufficient for dirty worktrees, and final diff remains the mutation audit. |
| **Data / Knowledge Architect** | `Phase 2 Implementation — Scope and Conflict Engine` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `Phase 2 Implementation — Scope and Conflict Engine` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `Phase 2 Implementation — Scope and Conflict Engine` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | Approves the document if it reduces cognitive load and tells an implementer what to read/do next; the explicit reading order and phase gates improve this. |
| **QA / Verification Engineer** | Requires deterministic fixtures, invariants and regression gates; the decision is accepted because the revised document now states testable outcomes. |

## Consensus

Keep; add invariants/property tests to avoid policy contradictions.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added formal invariants.
- Clarified stale scope cannot authorize writes.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
