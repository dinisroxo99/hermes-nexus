# Roundtable Review — 04_ICM_AND_CONTEXT_PACK.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `04_ICM_AND_CONTEXT_PACK.md`
- `03_TARGET_ARCHITECTURE.md`
- `10_PHASE_1_ICM_CONTEXT_PACK.md`
- `35_CACHE_AND_DERIVED_STATE.md`

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
| **Distributed Systems Architect** | `ICM and Context Pack Design` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | Approves ICM as process context rather than an agent definition; provenance and bounded Context Packs reduce prompt growth and instruction collisions. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `ICM and Context Pack Design` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | `ICM and Context Pack Design` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | `ICM and Context Pack Design` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `ICM and Context Pack Design` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `ICM and Context Pack Design` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `ICM and Context Pack Design` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `ICM and Context Pack Design` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `ICM and Context Pack Design` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Keep; add provenance, untrusted-context labeling and cache invalidation rules.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Separated trusted policy from repository/tool text.
- Linked cache and threat-model policies.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
