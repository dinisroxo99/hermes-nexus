# Roundtable Review — 13_PHASE_4_PROJECT_EXPERT.md

**Decision:** REVISED — approved with refinements

## Context sent to the panel

The simulated panel reviewed the **full content** of this file together with the following dependency/context documents:

- `13_PHASE_4_PROJECT_EXPERT.md`
- `07_MEMORY_HONCHO_AND_PROJECT_EXPERT.md`
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
| **Distributed Systems Architect** | `Phase 4 Implementation — Project Expert` fits the overall boundary, but must continue to name its owner, inputs and failure behavior rather than becoming an implicit shared state machine. |
| **Multi-Agent / LLM Systems Engineer** | Approves the separation between current truth, retrieved history and model synthesis; this is essential to prevent agent memory from becoming authority. |
| **Application Security / Trust Engineer** | Requires provenance, secret redaction and poisoning controls before data from `Phase 4 Implementation — Project Expert` is reused for Project Expert answers or training. |
| **SRE / Observability Engineer** | Requests phase gates, rollback and observability before autonomous rollout; the v4 refinements make the phase implementable in production increments. |
| **Git / SCM & Developer Tooling Engineer** | Requires every code-related historical claim in `Phase 4 Implementation — Project Expert` to preserve the repository revision that produced it. |
| **Data / Knowledge Architect** | Approves the revised source-of-truth, provenance and lifecycle model; stable IDs and schema/policy versions are necessary for future learning. |
| **ML / MLOps Engineer** | Approves retrieval-first learning, but insists on validated labels, frozen evaluation sets and reproducible exports before fine-tuning/router learning. |
| **API / MCP Integration Engineer** | `Phase 4 Implementation — Project Expert` should refer to stable domain contracts and avoid leaking provider-specific schemas into Project Map core logic. |
| **Developer Experience / Product Engineer** | Approves the document if it reduces cognitive load and tells an implementer what to read/do next; the explicit reading order and phase gates improve this. |
| **QA / Verification Engineer** | Requires deterministic fixtures, invariants and regression gates; the decision is accepted because the revised document now states testable outcomes. |

## Consensus

Keep retrieval-first MVP; add retrieval fusion and an evaluation gate before training.

## Why this decision

The panel accepted the document's responsibility boundary but required the changes below so that the text can be implemented without duplicating Hermes, mixing sources of truth, or creating untestable autonomous behavior.

## Changes applied to the delivered file

- Structural evidence outranks similarity-only matches.
- Requires frozen evaluation before adapters.

## Outcome

The file remains in the pack and the v4 refinements are part of the accepted target design.
