# Roundtable Review — 22_MODEL_ROUTING_AND_TOKEN_BUDGETS.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `22_MODEL_ROUTING_AND_TOKEN_BUDGETS.md`
- `29_PROFILE_CATALOG_AND_CAPABILITIES.md`
- `15_ACCEPTANCE_AND_BENCHMARKS.md`
- `08_OBSERVABILITY_AND_LEARNING.md`

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
| **Distributed Systems Architect** | `Model Routing and Token Budgets` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | Approves reusable profiles and bounded execution modes; the runtime should select models while Project Map supplies risk/context features. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `Model Routing and Token Budgets` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | `Model Routing and Token Budgets` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | `Model Routing and Token Budgets` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `Model Routing and Token Budgets` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | Approves retrieval-first learning, but insists on validated labels, frozen evaluation sets and reproducible exports before fine-tuning/router learning. |
| **API / MCP Integration Engineer** | `Model Routing and Token Budgets` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Model Routing and Token Budgets` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Model Routing and Token Budgets` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Keep routing outside Project Map; record routing decisions as future learning data.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added routing decision record.
- Added runtime SLO trade-offs.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
