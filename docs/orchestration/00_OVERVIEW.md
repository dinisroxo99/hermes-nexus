# Orchestration V1

## Purpose and authority

This is the canonical operating-model documentation for bounded, coordinator-managed
Hermes work on board `hermes-nexus`. The operator-supplied contract and planning
manifest are recorded in `t_1994a059`; authoring is `t_007865ce`, tenant
`orchestration-docs-v1`.

**Planner plans. Orchestrator admits. Dispatcher schedules. Specialists execute.**

Hermes owns profiles, agents, models/providers, Kanban, dispatch, worktrees and
runtime execution. Hermes Nexus owns project intelligence, ICM, context, impact,
scope and conflict analysis. This model does not add an orchestrator to the Nexus
product or transfer those ownership boundaries.

## Evidence and policy

- **Recorded orchestration behavior:** the completed smoke has native task/run
  identities and start/end records supporting bounded parallel execution and fan-in.
  Its supplied outcomes and provenance are in [Operations](07_OPERATIONS.md).
- **Supplied deployed configuration:** role/settings facts come from the operator
  contract, not a fresh inspection of configuration or profile files.
- **Policy:** admission, routing, workspace restrictions and publication gates below
  prescribe authorized operation; documentation does not install enforcement.
- **Unknowns:** the smoke does not prove runtime model identity, absence of unexpected
  writes or broader system guarantees. See [Limitations](08_LIMITATIONS.md).

The docs pipeline is intentionally serial W → DOC → V → R → P. Candidate SHA/tree
are execution outputs, not planner-invented values. Independent review and publication
are separately admitted stages; this documentation does not assert they completed.

## Scope and non-goals

This set documents the supplied model, not permission for product work. It does not
authorize Step 4/5/6, Track A, Slice 4, Guard or confinement; resolve historical gates;
modify profiles/configuration/plugins; or start Nexus. ETS WRITE classification is
not write authorization. This documentation is **not Step 4 authorization**.
Held product statuses are preserved verbatim in [Limitations](08_LIMITATIONS.md),
without changing their source documents.

Authoring is limited to `docs/orchestration/**` and one minimal `docs/README.md` link.
No implementation, dependencies, tooling, product tests/builds, extra execution cards,
push or merge is authorized in this authoring phase.

## Navigation

| Document | Concern |
|---|---|
| [Profiles](01_PROFILES.md) | Roles, fleet and bounded planner authority |
| [Board model](02_BOARD_MODEL.md) | Board, tenants, identities and prerequisites |
| [Planning and admission](03_PLANNING_AND_ADMISSION.md) | Required bounded context and complete blocked DAG |
| [Task lifecycle](04_TASK_LIFECYCLE.md) | Orientation, blockers, completion and independent review |
| [Concurrency](05_CONCURRENCY.md) | Capacity, independence and smoke timings |
| [Model routing](06_MODEL_ROUTING.md) | Four tiers, evidence-based scores and overrides |
| [Operations](07_OPERATIONS.md) | Workspaces, handoffs, publication and smoke provenance |
| [Limitations](08_LIMITATIONS.md) | Unknowns, unenforced restrictions and product holds |

For Hermes commands/runtime capabilities use the
[official Hermes documentation](https://hermes-agent.nousresearch.com/docs/).
Repository contribution boundaries remain in [AGENTS.md](../../AGENTS.md).
