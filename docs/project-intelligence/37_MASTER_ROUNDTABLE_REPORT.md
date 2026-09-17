# Master Roundtable Report — 37 Architecture Files

Date: **2026-09-17**

## Panel

- **Distributed Systems Architect** — boundaries, ownership, failure modes and state transitions.
- **Multi-Agent / LLM Systems Engineer** — agent roles, context flow, autonomy and token behavior.
- **Application Security / Trust Engineer** — least privilege, prompt injection, secrets and trust boundaries.
- **SRE / Observability Engineer** — 24/7 operation, telemetry, recovery and operability.
- **Git / SCM & Developer Tooling Engineer** — repository identity, revisions, worktrees and merge safety.
- **Data / Knowledge Architect** — schemas, provenance, lifecycle, retention and source of truth.
- **ML / MLOps Engineer** — training quality, drift, evaluation and model-routing data.
- **API / MCP Integration Engineer** — contracts, compatibility, idempotency, timeouts and adapters.
- **Developer Experience / Product Engineer** — operator workflow, clarity, UI impact and maintainability.
- **QA / Verification Engineer** — invariants, acceptance criteria, regression tests and benchmarkability.

## Method

Each file was reviewed using the same 10 expert lenses. The panel context included the full file, its listed dependency documents and the accepted global architecture boundaries. Reviews are stored under `reviews/`.

## Overall consensus

The architecture remains viable and the core boundary is unchanged: Hermes executes agents; Project Map supplies revision-aware project intelligence, ICM, bounded context, impact/scope/conflict analysis and the read-only Project Expert.

The panel did **not** recommend rebuilding Hermes task/runtime features. It instead added missing cross-cutting contracts required for safe implementation.

## New files approved by the panel

- `30_STATE_AND_DATA_MODEL.md` — Create. The previous pack lacked one canonical domain/state model.
- `31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md` — Create. Enforcement controls existed without a complete threat inventory.
- `32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md` — Create. Telemetry intended for training requires reliable event semantics.
- `33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md` — Create. Profile capability alone does not define who may authorize risky actions.
- `34_BACKUP_RECOVERY_AND_RUNBOOKS.md` — Create. 24/7 operation needs tested restore and incident procedures.
- `35_CACHE_AND_DERIVED_STATE.md` — Create. Token-saving depends on reuse, but stale derived state is a major correctness risk.
- `36_CONVERSATION_EXTRACTION_LEDGER.md` — Create. The pack needed traceability back to the chats and superseded ideas.

## Highest-priority implementation consequences

1. Stabilize canonical `projectId` and entity ownership before project-scoped history/memory.
2. Build Context Packs with provenance and dirty-worktree/revision awareness.
3. Treat impact/scope as versioned derived state; validate final Git diff.
4. Implement defense in depth; plugin hooks are not a complete sandbox.
5. Ingest Hermes telemetry idempotently instead of creating a parallel runtime event system.
6. Keep proposed design ideas separate from current project truth.
7. Introduce Project Expert only after retrieval/evidence precedence and evaluation are defined.
8. Capture routing/context/outcome data now so future learning is based on validated executions.

## Document count

- Architecture/implementation documents: **37**
- Companion per-file roundtable reviews: **37**
- Master report: **1**
