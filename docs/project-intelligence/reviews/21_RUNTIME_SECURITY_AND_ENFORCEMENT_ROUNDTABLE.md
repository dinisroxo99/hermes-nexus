# Roundtable Review — 21_RUNTIME_SECURITY_AND_ENFORCEMENT.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md`
- `31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md`
- `12_PHASE_3_HERMES_GUARD_PLUGIN.md`
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
| **Distributed Systems Architect** | The state transitions in `Runtime Security and Enforcement` need revision binding and deterministic conflict semantics; the added lifecycle/invariants address that. |
| **Multi-Agent / LLM Systems Engineer** | `Runtime Security and Enforcement` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | Requires defense in depth, explicit trust zones and fail-closed mutation decisions; the revised text is acceptable only with final diff validation. |
| **SRE / Observability Engineer** | `Runtime Security and Enforcement` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | Strongly supports revision/worktree-aware semantics; a commit SHA alone is insufficient for dirty worktrees, and final diff remains the mutation audit. |
| **Data / Knowledge Architect** | `Runtime Security and Enforcement` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `Runtime Security and Enforcement` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `Runtime Security and Enforcement` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Runtime Security and Enforcement` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | Requires deterministic fixtures, invariants and regression gates; the decision is accepted because the revised document now states testable outcomes. |

## Consensus

Keep controls but move full threat inventory into a dedicated threat-model file.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added threat-model dependency.
- Added prompt-injection and malicious MCP test cases.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
