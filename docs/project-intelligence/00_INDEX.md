# Hermes Project Map — Architecture & Implementation Pack

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/00_INDEX_ROUNDTABLE.md`


Status: **Consolidated from project conversations up to 2026-09-17**

This pack consolidates the decisions made across the recent `hermes-project-map` / Hermes conversations and turns them into implementation-oriented Markdown documents.

## Reading order

1. `01_CURRENT_STATE.md` — verified snapshot of what already exists.
2. `02_DECISIONS_FROM_CHATS.md` — consolidated decisions from the conversations.
3. `03_TARGET_ARCHITECTURE.md` — target architecture and responsibility boundaries.
4. `04_ICM_AND_CONTEXT_PACK.md` — ICM integration and bounded context construction.
5. `05_HERMES_INTEGRATION.md` — how Hermes, Kanban, profiles, Honcho and Project Map fit together.
6. `06_SCOPE_IMPACT_CONFLICTS.md` — impact-aware WRITE / RESERVED / WATCH / IMPACT scopes.
7. `07_MEMORY_HONCHO_AND_PROJECT_EXPERT.md` — memory boundaries and the Project Expert.
8. `08_OBSERVABILITY_AND_LEARNING.md` — logs, event store, datasets and future learning.
9. `09_IMPLEMENTATION_ROADMAP.md` — recommended implementation order.
10. `10_PHASE_1_ICM_CONTEXT_PACK.md`
11. `11_PHASE_2_SCOPE_CONFLICT_ENGINE.md`
12. `12_PHASE_3_HERMES_GUARD_PLUGIN.md`
13. `13_PHASE_4_PROJECT_EXPERT.md`
14. `14_PHASE_5_OBSERVABILITY_TRAINING_DATA.md`
15. `15_ACCEPTANCE_AND_BENCHMARKS.md`
16. `16_DEFERRED_AND_REJECTED.md`
17. `17_REVIEW_FINDINGS.md` — second-pass gaps and corrections.
18. `18_PROJECT_IDENTITY_AND_ISOLATION.md` — project/board/worktree scoping.
19. `19_HERMES_TELEMETRY_INGESTION.md` — reuse Hermes runtime telemetry.
20. `20_API_MCP_CONTRACTS.md` — stable external tool contracts.
21. `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md` — defense-in-depth guard model.
22. `22_MODEL_ROUTING_AND_TOKEN_BUDGETS.md` — runtime hints, FAST/STANDARD/DEEP.
23. `23_24_7_DEPLOYMENT_AND_OPERATIONS.md` — continuous operation topology.
24. `24_EXTERNAL_COMPONENT_REUSE_MATRIX.md` — what to reuse vs defer.
25. `25_CURRENT_TO_TARGET_MIGRATION.md` — additive migration from current branch.
26. `26_PROJECT_EXPERT_DATA_PIPELINE.md` — validated history → Project Expert.
27. `27_DESIGN_MEMORY_AND_IDEA_LIFECYCLE.md` — separate current truth from proposals/ideas.
28. `28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md` — source priority, staleness and supersession.
29. `29_PROFILE_CATALOG_AND_CAPABILITIES.md` — reusable Hermes roles and routing hints.

## Status labels

- **VERIFIED/CURRENT** — confirmed in the conversations, commits or test results.
- **PLANNED** — target architecture not yet confirmed as implemented.
- **DEFERRED** — intentionally not implemented now.
- **REJECTED** — architecture explicitly avoided.

## Core principle

`hermes-project-map` is a **shared Project Intelligence / Context / Impact tool** used by agents.

It is **not** the agent runtime, global orchestrator, provider router, Kanban implementation, or general memory system.

The target relationship is:

```text
Hermes
  ├─ Profiles / SOULs
  ├─ Model/provider execution
  ├─ Kanban / tasks / dispatcher / worktrees
  ├─ Sessions
  └─ Honcho memory
          │
          │ tool/plugin integration
          ▼
hermes-project-map
  ├─ Project discovery / registry
  ├─ Project Intelligence
  ├─ ICM resolver
  ├─ Context Pack builder
  ├─ Impact analysis
  ├─ Scope resolver
  ├─ Conflict intelligence
  ├─ Project Expert retrieval
  └─ Execution telemetry / project knowledge
```

## Second-review correction

The second review explicitly reuses Hermes Kanban/run telemetry instead of duplicating it, adds board↔project identity, and treats tool hooks as one enforcement layer rather than a complete sandbox.

## v4 usage rule

For implementation work, read in this order:

```text
01 current state
02 decisions
03 target architecture
30 canonical data model
09 roadmap
phase document
relevant cross-cutting documents
```

The companion `reviews/` directory is an audit trail, not required prompt context for every coding task.

New cross-cutting documents introduced by the roundtable:

```text
30_STATE_AND_DATA_MODEL.md
31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md
32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md
33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md
34_BACKUP_RECOVERY_AND_RUNBOOKS.md
35_CACHE_AND_DERIVED_STATE.md
36_CONVERSATION_EXTRACTION_LEDGER.md
```
