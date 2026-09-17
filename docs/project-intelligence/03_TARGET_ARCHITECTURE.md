# Target Architecture

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/03_TARGET_ARCHITECTURE_ROUNDTABLE.md`


## Goal

Build an impact-aware Project Intelligence layer that makes Hermes agents:

- receive smaller and more relevant context;
- understand the active project;
- coordinate safely;
- avoid editing overlapping code;
- reuse project history;
- generate structured data for continuous improvement.

## High-level architecture

```text
                         USER
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                       HERMES                            │
│                                                         │
│ Profiles / SOULs / Providers / Models                  │
│                                                         │
│ Kanban                                                  │
│ ├─ tasks                                                │
│ ├─ dependencies                                         │
│ ├─ dispatcher                                           │
│ ├─ workers                                              │
│ ├─ claims                                               │
│ └─ worktrees                                            │
│                                                         │
│ Honcho                                                  │
│ └─ long-term agent/user memory                          │
│                                                         │
│ Project Guard Plugin                                    │
│ ├─ task-claimed integration                             │
│ ├─ bounded context injection                            │
│ ├─ mutation guard                                       │
│ └─ completion telemetry                                 │
└───────────────────────────┬─────────────────────────────┘
                            │
                         MCP/HTTP
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                 HERMES PROJECT MAP                      │
│                                                         │
│ Project Registry / Discovery                            │
│           │                                             │
│           ▼                                             │
│ Project Intelligence                                    │
│ ├─ structure                                            │
│ ├─ symbols                                              │
│ ├─ references                                           │
│ ├─ dependency graph                                     │
│ ├─ tests                                                │
│ └─ bounded project context                              │
│           │                                             │
│           ├───────────────┐                             │
│           ▼               ▼                             │
│        ICM Resolver    Impact Engine                     │
│           │               │                             │
│           └───────┬───────┘                             │
│                   ▼                                     │
│             Context Pack                                │
│                   │                                     │
│                   ▼                                     │
│             Scope Resolver                              │
│        WRITE / RESERVED / WATCH / IMPACT                │
│                   │                                     │
│                   ▼                                     │
│            Conflict Intelligence                        │
│                                                         │
│ Project Expert                                          │
│ └─ read-only QA over current + historical knowledge     │
│                                                         │
│ Learning / Observability                                │
│ └─ events, runs, metrics, feedback, training data       │
└─────────────────────────────────────────────────────────┘
```

## Responsibility boundary

### Hermes

Must remain responsible for execution mechanics:

```text
agent lifecycle
profile/SOUL
provider/model usage
task lifecycle
worker scheduling
worktrees
runtime sessions
```

### Project Map

Must remain responsible for project-specific intelligence:

```text
where am I?
what exists?
what is relevant?
what will this change affect?
what context should the agent see?
can this task safely run beside another task?
what does the project history say?
```

## Primary data flow

```text
Kanban Task
   ↓
Resolve project / git revision
   ↓
Resolve ICM stage / contract
   ↓
Project Intelligence search
   ↓
Relevant symbols
   ↓
Impact
   ↓
Context Pack
   ↓
Scope Resolver
   ↓
Conflict Check
   ↓
Hermes worker starts
   ↓
Guard enforces allowed mutation scope
   ↓
Tests/review/result
   ↓
Execution events + historical project knowledge
```

## Read path vs write path

### Read path

Agents can ask Project Map for:

```text
project_info
project_search
project_context
project_impact
project_insights
icm_context
task_context
ask_project
```

### Write/control path

The Project Map should have only narrowly scoped state writes:

```text
task technical metadata
scope snapshots
conflict snapshots
execution events
project-history observations
```

It should not become the owner of Hermes task lifecycle.

## Source-of-truth hierarchy

Current code facts:

```text
Git revision
→ project analyzers / language services
→ Project Intelligence
```

Process truth:

```text
canonical ICM/project docs
```

Task runtime truth:

```text
Hermes Kanban / worker state
```

Experiential memory:

```text
Honcho / project historical event store
```

Never reverse that hierarchy.


## Separate design-memory plane

Future ideas/proposals must not be mixed with current project truth.

```text
Project Map
  = what exists now

Design Memory
  = what is proposed / considered / rejected / planned
```

Project Expert may query both, but must label proposed/historical material and obey source precedence.

See:

```text
27_DESIGN_MEMORY_AND_IDEA_LIFECYCLE.md
28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md
```

## Control, data and knowledge planes

To avoid accidental responsibility overlap, treat the design as three planes:

```text
CONTROL PLANE
Hermes tasks/workers/profiles + scope/conflict policy

DATA PLANE
Git/worktrees/tool execution/build/tests

KNOWLEDGE PLANE
Project Intelligence + ICM + Project Expert + validated history
```

Cross-plane state ownership follows `30_STATE_AND_DATA_MODEL.md`.
