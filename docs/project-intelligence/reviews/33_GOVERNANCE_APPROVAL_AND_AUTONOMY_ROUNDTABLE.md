# Roundtable Review — 33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md

**Decision:** NEW — approved after roundtable

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md`
- `29_PROFILE_CATALOG_AND_CAPABILITIES.md`
- `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md`
- `27_DESIGN_MEMORY_AND_IDEA_LIFECYCLE.md`

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
| **Distributed Systems Architect** | `Governance, Approval and Agent Autonomy` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | Approves reusable profiles and bounded execution modes; the runtime should select models while Project Map supplies risk/context features. |
| **Application Security / Trust Engineer** | Requires defense in depth, explicit trust zones and fail-closed mutation decisions; the revised text is acceptable only with final diff validation. |
| **SRE / Observability Engineer** | `Governance, Approval and Agent Autonomy` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | `Governance, Approval and Agent Autonomy` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `Governance, Approval and Agent Autonomy` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | Approves retrieval-first learning, but insists on validated labels, frozen evaluation sets and reproducible exports before fine-tuning/router learning. |
| **API / MCP Integration Engineer** | `Governance, Approval and Agent Autonomy` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Governance, Approval and Agent Autonomy` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Governance, Approval and Agent Autonomy` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Create. Profile capability alone does not define who may authorize risky actions.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Defined autonomy levels and risk classes.
- Separated technical reviewer approval from human authority.

## Outcome

This file was created because the roundtable identified a cross-cutting concern that could not be safely left implicit or scattered across other documents.
