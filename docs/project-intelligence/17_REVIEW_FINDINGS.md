# Second Architecture Review — Findings

> **Roundtable review v4:** REVISED — keep as historical review log — 2026-09-17  
> Companion review: `reviews/17_REVIEW_FINDINGS_ROUNDTABLE.md`


Review date: **2026-09-17**

This second pass compares the documentation pack against the full project conversation and the current Hermes capabilities that matter to the design.

## Result

The core architecture remains valid:

```text
Hermes
  = runtime / profiles / Kanban / workers / worktrees / models

Honcho
  = experiential long-term memory

hermes-project-map
  = project intelligence / ICM / context / impact / scope / project expert
```

No rewrite of the existing Project Intelligence foundation is required.

However, the first documentation pack underused several Hermes capabilities and needed stronger project-isolation and enforcement rules.

## Gap 1 — Hermes already stores useful task/run telemetry

The initial pack proposed a mostly separate run/event database.

Hermes Kanban already provides useful durable primitives:

```text
task rows
run history
task_events
comments
handoffs
worker lifecycle
workspaces
model/provider overrides
```

Plugin/API hooks also expose correlated provider usage and tool events.

### Revised decision

Do not duplicate raw Hermes runtime telemetry.

Instead:

```text
Hermes telemetry
       ↓
Project Map telemetry adapter
       ↓
normalized project-learning schema
```

Project Map only stores the additional information Hermes does not know:

```text
Context Pack id
ICM stage
impact snapshot
WRITE/RESERVED/WATCH/IMPACT scope
project revision
conflict analysis
project observations
training labels
```

## Gap 2 — Board/project mapping was not explicit enough

Hermes supports separate Kanban boards.

Project Map already has its own project registry.

A canonical mapping is required:

```text
Hermes board
    ↔
Project Map projectId
    ↔
Git repository identity
```

Without this mapping, memory, task history and scope data can become cross-project ambiguous.

## Gap 3 — Hook enforcement needs defense in depth

`pre_tool_call` can block a tool call.

However, a plugin callback that crashes is not a sufficient security boundary by itself.

Therefore mutation safety must use multiple layers:

```text
1. dedicated task worktree
2. project/worktree path boundary
3. Project Map scope policy
4. pre_tool_call guard
5. post-run diff validation
```

Do not describe the plugin hook as an absolute sandbox.

## Gap 4 — Provider/API telemetry can be reused

Hermes exposes hooks around provider API calls with correlation fields and token usage.

That means token/cost measurement should be collected from the runtime directly instead of estimated from prompts.

This materially improves the benchmark plan.

## Gap 5 — Model routing needed a clearer boundary

The conversations include:

```text
local-first execution
fallbacks
FAST / STANDARD / DEEP modes
risk/impact-aware model escalation
```

This belongs to Hermes/runtime policy.

Project Map should output routing hints such as:

```text
complexity
impact severity
context size
risk
required capabilities
review requirement
```

but must not own provider credentials or execution.

## Gap 6 — 24/7 operation needed its own deployment document

The system is intended to run continuously.

The pack needed explicit guidance for:

```text
service topology
health/readiness
GPU concurrency
persistent state
dashboard exposure
backups
telemetry retention
```

## Gap 7 — External components needed a reuse matrix

Several systems were researched:

```text
Serena
SourcePrep
MCP Agent Mail
Agent Coordinator
Plane / Taiga / OpenProject
```

The project should use these as providers/references where useful, not accidentally rebuild or integrate all of them.

## New documents added after this review

```text
18_PROJECT_IDENTITY_AND_ISOLATION.md
19_HERMES_TELEMETRY_INGESTION.md
20_API_MCP_CONTRACTS.md
21_RUNTIME_SECURITY_AND_ENFORCEMENT.md
22_MODEL_ROUTING_AND_TOKEN_BUDGETS.md
23_24_7_DEPLOYMENT_AND_OPERATIONS.md
24_EXTERNAL_COMPONENT_REUSE_MATRIX.md
25_CURRENT_TO_TARGET_MIGRATION.md
26_PROJECT_EXPERT_DATA_PIPELINE.md
```


## Gap 8 — Design memory was missing

Earlier project conversations explicitly separated:

```text
what exists
```

from:

```text
what we are considering
```

The first pack did not preserve this distinction strongly enough.

Added:

```text
27_DESIGN_MEMORY_AND_IDEA_LIFECYCLE.md
28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md
```

## Gap 9 — Profile catalog was implicit

The intended reusable roles (architect, implementer, tester, reviewer, documenter, XML commenter, UI designer, etc.) were discussed across earlier chats but not captured as a stable catalog.

Added:

```text
29_PROFILE_CATALOG_AND_CAPABILITIES.md
```

## Status of this document

This file is an architectural review log.

It is **not** a source of current runtime truth and should not override later accepted decisions.

The v4 roundtable review is recorded separately under `reviews/`.
