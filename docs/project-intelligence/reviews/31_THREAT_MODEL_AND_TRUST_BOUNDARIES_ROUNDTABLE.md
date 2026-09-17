# Roundtable Review — 31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md

**Decision:** NEW — approved after roundtable

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md`
- `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md`
- `20_API_MCP_CONTRACTS.md`
- `33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md`

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
| **Distributed Systems Architect** | `Threat Model and Trust Boundaries` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | `Threat Model and Trust Boundaries` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | Requires defense in depth, explicit trust zones and fail-closed mutation decisions; the revised text is acceptable only with final diff validation. |
| **SRE / Observability Engineer** | `Threat Model and Trust Boundaries` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | `Threat Model and Trust Boundaries` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `Threat Model and Trust Boundaries` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `Threat Model and Trust Boundaries` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `Threat Model and Trust Boundaries` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Threat Model and Trust Boundaries` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Threat Model and Trust Boundaries` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Create. Enforcement controls existed without a complete threat inventory.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added repository prompt-injection and MCP/tool-output threats.
- Defined trust zones and high-risk approval triggers.

## Outcome

This file was created because the roundtable identified a cross-cutting concern that could not be safely left implicit or scattered across other documents.
