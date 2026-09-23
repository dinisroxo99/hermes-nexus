# Documentation

[Project home](../README.md)

## Start here

| Question | Read |
|---|---|
| Why does this project exist? | [Vision](VISION.md) |
| What do the terms mean? | [Concepts](CONCEPTS.md) |
| How does it fit with Hermes? | [Public architecture](ARCHITECTURE.md) |
| What can I use now? | [Current status](CURRENT_STATUS.md) |
| What defects remain open or deferred? | [Known issues and deferred technical debt](KNOWN_ISSUES.md) |
| How do I run it or call the API? | [Service reference](SERVICE_REFERENCE.md) |

The [current checkpoint](CURRENT_STATUS.md) includes completed Project Identity /
Revision, Task Context Pack and Analyzer Provider Layer, plus optional sandboxed
Serena/Python semantic analysis. Impact v2 is **NOT STARTED**; scope/conflicts,
runtime guard integration and project knowledge remain planned.

## Setup and service guides

- [Service reference](SERVICE_REFERENCE.md) — local/Docker quick starts, current
  endpoints, discovery/registration, configuration and examples formerly in README.
- [Adding projects](adding-projects.md) — registration, identity and locations.
- [Analyzer implementation](analyzers-implementation.md) — analyzer internals.
- [Analyzer execution and troubleshooting](analyzers-execution.md) — operation
  and troubleshooting.
- [Hermes HTTP tool integration](hermes-tool-integration.md) — thin-client design
  and separation between HTTP endpoints and candidate tool interfaces.
- [Hermes plugin setup guide](hermes-plugin-installation.md) — low-level
  `project_map_*` client example; not an automatic task/scope guard.
- [Project ICM](project-icm.md) — canonical manifest and index contracts.

The integration guides contain examples for a separately configured Hermes
runtime, not a bundled or automatically installed plugin. For current Hermes
commands and runtime capabilities, use the
[official Hermes documentation](https://hermes-agent.nousresearch.com/docs/).

## Technical architecture

Start with the [Project Intelligence technical index](project-intelligence/00_INDEX.md).
It links the existing detailed contracts, target design and cross-cutting
architecture without duplicating them in the public overview.

Useful entry points:

- [Architecture decisions](project-intelligence/02_DECISIONS_FROM_CHATS.md).
- [Target architecture](project-intelligence/03_TARGET_ARCHITECTURE.md).
- [Implemented Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md).
- [Project identity and revision contract](project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md).
- [Analyzer Provider Layer](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md) —
  implemented normalization, external data validation and optional Serena/Python execution.
- [Serena/Python runtime](../docker/serena-python/README.md) — pinned image build,
  opt-in configuration, sandbox contract and real integration tests.
- [Scope, impact and conflicts](project-intelligence/06_SCOPE_IMPACT_CONFLICTS.md).
- [State ownership and data model](project-intelligence/30_STATE_AND_DATA_MODEL.md).
- [Project Expert data pipeline](project-intelligence/26_PROJECT_EXPERT_DATA_PIPELINE.md).
- [Knowledge precedence and drift](project-intelligence/28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md).
- [Technical roadmap](project-intelligence/09_IMPLEMENTATION_ROADMAP.md).

For implementation, follow [AGENTS.md](../AGENTS.md) and its active-plan pointer.
This public documentation does not supersede that plan or authorize another
implementation phase. Historical phase numbers and active-plan step numbers
are different sequences; use capability names and verified commits to compare.

## Reusable diagrams

All diagrams are Mermaid text; no binary image assets are required.

| Diagram | Location |
|---|---|
| Codex → Hermes → Profiles → ICM → Project Intelligence | [Vision](VISION.md#how-the-problem-emerged) |
| User → Hermes → Project Intelligence → repository/knowledge | [Architecture](ARCHITECTURE.md#system-boundary) |
| Current context composition, with a separate planned impact/scope/conflict path | [Task flow](ARCHITECTURE.md#task-flow) |
| WRITE / RESERVED / WATCH / IMPACT across parallel tasks | [Concepts](CONCEPTS.md#write--reserved--watch--impact) |
| Future read-only Project Expert and its evidence sources | [Project Expert](ARCHITECTURE.md#future-project-expert) |

The README also includes a compact system-boundary diagram. Keep implemented,
planned and proposed labels, groups and line styles when reusing diagrams.

## Historical material and naming

The deep architecture directory retains historical checkpoints, decision
provenance and review/audit documents. They are useful for tracing rationale,
not proof of the current implementation. They are not required reading for a
new visitor or normal task context.

**Hermes Nexus** is the current product and repository name. It evolved from
**Hermes Project Map**, the original working name. `project_map_*`, `project_map`
and `PROJECT_MAP_URL` remain backward-compatible integration identifiers. Older
technical material also uses “Project Map” and “Hermes Agent OS”; runtime
responsibilities remain with Hermes, not a new orchestrator in this repository.

Numbered technical filenames are preserved. Two documents use the `19_` prefix:
the implemented analyzer-provider contract and the planned Hermes telemetry
design. Refer to their full filenames rather than renumbering or conflating them.
