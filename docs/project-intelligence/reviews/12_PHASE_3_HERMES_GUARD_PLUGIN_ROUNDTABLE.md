# Roundtable Review — 12_PHASE_3_HERMES_GUARD_PLUGIN.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `12_PHASE_3_HERMES_GUARD_PLUGIN.md`
- `05_HERMES_INTEGRATION.md`
- `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md`
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
| **Distributed Systems Architect** | Supports `Phase 3 Implementation — Hermes Guard Plugin` provided ownership and failure boundaries remain explicit; the v4 changes reduce duplicated state and ambiguous recovery. |
| **Multi-Agent / LLM Systems Engineer** | `Phase 3 Implementation — Hermes Guard Plugin` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | Requires defense in depth, explicit trust zones and fail-closed mutation decisions; the revised text is acceptable only with final diff validation. |
| **SRE / Observability Engineer** | Requests phase gates, rollback and observability before autonomous rollout; the v4 refinements make the phase implementable in production increments. |
| **Git / SCM & Developer Tooling Engineer** | `Phase 3 Implementation — Hermes Guard Plugin` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `Phase 3 Implementation — Hermes Guard Plugin` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `Phase 3 Implementation — Hermes Guard Plugin` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | Approves a transport-independent domain API with version/capability discovery, timeouts and idempotency; adapters must not diverge semantically. |
| **Developer Experience / Product Engineer** | Approves the document if it reduces cognitive load and tells an implementer what to read/do next; the explicit reading order and phase gates improve this. |
| **QA / Verification Engineer** | Requires deterministic fixtures, invariants and regression gates; the decision is accepted because the revised document now states testable outcomes. |

## Consensus

Keep; make hooks fail intentionally and validate final diff.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added exception/timeout policy.
- Added completion-time diff validation.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
