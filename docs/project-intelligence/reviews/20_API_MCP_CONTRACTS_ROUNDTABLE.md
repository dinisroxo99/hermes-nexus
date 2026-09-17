# Roundtable Review — 20_API_MCP_CONTRACTS.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `20_API_MCP_CONTRACTS.md`
- `05_HERMES_INTEGRATION.md`
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
| **Distributed Systems Architect** | Supports `Project Map API / MCP Contracts` provided ownership and failure boundaries remain explicit; the v4 changes reduce duplicated state and ambiguous recovery. |
| **Multi-Agent / LLM Systems Engineer** | `Project Map API / MCP Contracts` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `Project Map API / MCP Contracts` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | `Project Map API / MCP Contracts` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | `Project Map API / MCP Contracts` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `Project Map API / MCP Contracts` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `Project Map API / MCP Contracts` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | Approves a transport-independent domain API with version/capability discovery, timeouts and idempotency; adapters must not diverge semantically. |
| **Developer Experience / Product Engineer** | `Project Map API / MCP Contracts` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Project Map API / MCP Contracts` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Keep; add operational compatibility/version/auth/idempotency requirements.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added capability/version discovery.
- Added payload/timeouts/pagination/idempotency guidance.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
