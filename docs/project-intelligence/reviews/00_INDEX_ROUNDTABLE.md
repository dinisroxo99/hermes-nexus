# Roundtable Review — 00_INDEX.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `00_INDEX.md`
- `01_CURRENT_STATE.md`
- `02_DECISIONS_FROM_CHATS.md`
- `03_TARGET_ARCHITECTURE.md`
- `09_IMPLEMENTATION_ROADMAP.md`

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
| **Distributed Systems Architect** | `Hermes Project Map — Architecture & Implementation Pack` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | `Hermes Project Map — Architecture & Implementation Pack` should minimize what every worker must read; only task-relevant outputs should enter agent context, with the full document remaining operator/design documentation. |
| **Application Security / Trust Engineer** | No architectural objection, but any repository/tool text referenced by `Hermes Project Map — Architecture & Implementation Pack` must be treated as untrusted data rather than executable policy. |
| **SRE / Observability Engineer** | `Hermes Project Map — Architecture & Implementation Pack` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | `Hermes Project Map — Architecture & Implementation Pack` should remain compatible with normal Git workflows and avoid inventing a second source-code state outside Git/worktrees. |
| **Data / Knowledge Architect** | `Hermes Project Map — Architecture & Implementation Pack` needs references to canonical entities rather than free-form duplicated fields; the new state model should be used by implementations. |
| **ML / MLOps Engineer** | `Hermes Project Map — Architecture & Implementation Pack` should emit measurable features/outcomes rather than subjective success claims so later routing and evaluation datasets are usable. |
| **API / MCP Integration Engineer** | `Hermes Project Map — Architecture & Implementation Pack` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | Approves the document if it reduces cognitive load and tells an implementer what to read/do next; the explicit reading order and phase gates improve this. |
| **QA / Verification Engineer** | `Hermes Project Map — Architecture & Implementation Pack` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Keep as the entry point but make the reading path implementation-oriented.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added v4 reading order and cross-cutting documents.
- Kept reviews out of the default implementation prompt path.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
