# Roundtable Review — 07_MEMORY_HONCHO_AND_PROJECT_EXPERT.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `07_MEMORY_HONCHO_AND_PROJECT_EXPERT.md`
- `13_PHASE_4_PROJECT_EXPERT.md`
- `26_PROJECT_EXPERT_DATA_PIPELINE.md`
- `28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md`

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
| **Distributed Systems Architect** | `Memory, Honcho and Project Expert` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | Approves the separation between current truth, retrieved history and model synthesis; this is essential to prevent agent memory from becoming authority. |
| **Application Security / Trust Engineer** | Requires provenance, secret redaction and poisoning controls before data from `Memory, Honcho and Project Expert` is reused for Project Expert answers or training. |
| **SRE / Observability Engineer** | `Memory, Honcho and Project Expert` is operationally acceptable if its derived state can be rebuilt and its dependencies expose health/readiness and bounded timeouts. |
| **Git / SCM & Developer Tooling Engineer** | Requires every code-related historical claim in `Memory, Honcho and Project Expert` to preserve the repository revision that produced it. |
| **Data / Knowledge Architect** | Approves the revised source-of-truth, provenance and lifecycle model; stable IDs and schema/policy versions are necessary for future learning. |
| **ML / MLOps Engineer** | Approves retrieval-first learning, but insists on validated labels, frozen evaluation sets and reproducible exports before fine-tuning/router learning. |
| **API / MCP Integration Engineer** | `Memory, Honcho and Project Expert` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | `Memory, Honcho and Project Expert` is useful as long as operators can inspect the reason behind decisions (impact, scope, conflict, routing) instead of receiving opaque automation. |
| **QA / Verification Engineer** | `Memory, Honcho and Project Expert` should define acceptance criteria that can be asserted without trusting an LLM's own claim of success; evidence and revision linkage remain mandatory. |

## Consensus

Keep memory separation; add an admission gate for durable project knowledge.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Added candidate/active/superseded lifecycle.
- Prevented Honcho conclusions from becoming code truth.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
