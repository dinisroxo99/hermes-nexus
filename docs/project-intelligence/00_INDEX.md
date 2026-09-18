# Project Intelligence — technical architecture index

[Project home](../../README.md) · [Documentation](../README.md) · [Public architecture](../ARCHITECTURE.md) · [Current status](../CURRENT_STATUS.md)

This directory contains detailed architecture decisions, implemented contracts,
target designs and historical checkpoints for `hermes-nexus`.
For the public story, begin with [Vision](../VISION.md) and [Concepts](../CONCEPTS.md).

## How to read this material

**A target schema or API example is not a claim of implementation.** Use the
commit-pinned [current status](../CURRENT_STATUS.md) for the public capability
snapshot, then check the source and relevant contract. Steps 1, 2 and 2.5 are
complete. Optional snapshot-only Serena/Python semantic execution is implemented
and verified with real Docker tests. Step 3 — Impact v2 is **NOT STARTED**.

For implementation, follow [AGENTS.md](../../AGENTS.md): read its active
implementation plan first, then current state, decisions, target architecture
and the document for the active phase. The active plan takes precedence over
archived plans. Broader roadmap phase numbers and active-plan step numbers are
not interchangeable release numbers.

Read only the relevant cross-cutting documents for a task. Historical reviews
are an audit trail, not required context for normal implementation work.

## Foundations and contracts

1. [Current-state checkpoints](01_CURRENT_STATE.md) — revision-specific evidence;
   historical records below a checkpoint do not become current facts.
2. [Architecture decisions](02_DECISIONS_FROM_CHATS.md) — responsibility boundaries
   and accepted design principles.
3. [Target architecture](03_TARGET_ARCHITECTURE.md) — the intended system.
4. [ICM and Context Pack](04_ICM_AND_CONTEXT_PACK.md) — implemented Step 2 contract,
   additive Step 2.5 provider metadata and longer-term designs.
5. [Hermes integration](05_HERMES_INTEGRATION.md) — client/guard boundary.
6. [Scope, impact and conflicts](06_SCOPE_IMPACT_CONFLICTS.md) — planned coordination
   semantics: WRITE / RESERVED / WATCH / IMPACT.
7. [Memory and Project Expert](07_MEMORY_HONCHO_AND_PROJECT_EXPERT.md) — separate
   current project evidence, experiential memory and a future read-only expert.
8. [Observability and learning](08_OBSERVABILITY_AND_LEARNING.md) — target telemetry
   and validated learning data.
9. [Technical roadmap](09_IMPLEMENTATION_ROADMAP.md) — architectural sequencing,
   not an up-to-date completion checklist.

## Phase designs and evaluation

- [ICM / Context Pack phase design](10_PHASE_1_ICM_CONTEXT_PACK.md).
- [Scope / conflict phase design](11_PHASE_2_SCOPE_CONFLICT_ENGINE.md).
- [Hermes guard phase design](12_PHASE_3_HERMES_GUARD_PLUGIN.md).
- [Project Expert phase design](13_PHASE_4_PROJECT_EXPERT.md).
- [Observability / training-data phase design](14_PHASE_5_OBSERVABILITY_TRAINING_DATA.md).
- [Acceptance and benchmarks](15_ACCEPTANCE_AND_BENCHMARKS.md) — evaluation criteria,
  not measured public performance claims.
- [Deferred and rejected directions](16_DEFERRED_AND_REJECTED.md).

## Cross-cutting architecture

- [Project identity and isolation](18_PROJECT_IDENTITY_AND_ISOLATION.md) — implemented
  identity/revision foundation plus wider planned bindings.
- [Analyzer Provider Layer](19_ANALYZER_PROVIDER_LAYER.md) — completed Step 2.5
  contract, native structural capabilities, external evidence validation and the
  implemented optional Serena/Python execution boundary.
- [Hermes telemetry ingestion](19_HERMES_TELEMETRY_INGESTION.md).
- [API / MCP contract design](20_API_MCP_CONTRACTS.md) — target tool interfaces;
  see [current HTTP endpoints](../CURRENT_STATUS.md#current-intelligence-endpoints).
- [Runtime security and enforcement](21_RUNTIME_SECURITY_AND_ENFORCEMENT.md).
- [Model routing and token budgets](22_MODEL_ROUTING_AND_TOKEN_BUDGETS.md) — Hermes
  runtime policy; this service supplies project evidence, not model execution.
- [Deployment and operations](23_24_7_DEPLOYMENT_AND_OPERATIONS.md).
- [External component reuse](24_EXTERNAL_COMPONENT_REUSE_MATRIX.md).
- [Current-to-target migration](25_CURRENT_TO_TARGET_MIGRATION.md).
- [Project Expert data pipeline](26_PROJECT_EXPERT_DATA_PIPELINE.md).
- [Design memory and idea lifecycle](27_DESIGN_MEMORY_AND_IDEA_LIFECYCLE.md).
- [Knowledge precedence and drift](28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md).
- [Profile catalog and capabilities](29_PROFILE_CATALOG_AND_CAPABILITIES.md).
- [State and data model](30_STATE_AND_DATA_MODEL.md).
- [Threat model and trust boundaries](31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md).
- [Event versioning and idempotency](32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md).
- [Governance and approval](33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md).
- [Backup, recovery and runbooks](34_BACKUP_RECOVERY_AND_RUNBOOKS.md).
- [Cache and derived state](35_CACHE_AND_DERIVED_STATE.md).

## Status and ownership rules

- **Implemented/current** requires source and revision evidence, with limitations.
- **In progress** means partial work, not a completed capability.
- **Planned** describes the target, not an available endpoint or integration.
- **Proposed** requires an explicit approval decision; it does not mean installed
  or in progress.
- **Deferred/rejected** distinguishes later possibilities from intentionally
  excluded architecture.
- Older **VERIFIED/CURRENT** labels apply to the checkpoint named in that document,
  not automatically to the latest branch or working tree.

Hermes owns runtime, agents, profiles/SOULs, models/providers, Kanban/tasks,
workers, dispatch, worktrees, sessions and retries. This project owns project
understanding, ICM, relevant context, impact, effective scope, conflict intelligence
and project knowledge. ICM is one input to this layer, not the runtime or the
entire system. Planned ownership does not imply those features are implemented.

## Audit and historical provenance

Retained for architecture review and traceability, not the public starting point:

- [Review findings](17_REVIEW_FINDINGS.md).
- [Decision extraction ledger](36_CONVERSATION_EXTRACTION_LEDGER.md).
- [Architecture review report](37_MASTER_ROUNDTABLE_REPORT.md).
- [Companion review index](reviews/00_INDEX_ROUNDTABLE.md).

Historical filenames and review documents remain intact. Architecture decisions
are presented by topic in the public navigation without erasing their provenance.
These records are not represented here as independent external expert audits.
