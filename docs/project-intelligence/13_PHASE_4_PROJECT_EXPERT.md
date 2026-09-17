# Phase 4 Implementation — Project Expert

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/13_PHASE_4_PROJECT_EXPERT_ROUNDTABLE.md`


Status: **PLANNED**

## Objective

Provide a read-only specialist that answers project questions for all Hermes profiles.

## Core rule

The Project Expert is a **knowledge interface**, not a coding agent.

## MVP architecture

```text
ask_project
   ↓
projectId/taskId
   ↓
question analysis
   ↓
Project Map retrieval
   ├─ current graph
   ├─ ICM
   ├─ ADRs
   ├─ relevant files/symbols
   └─ historical project events
   ↓
small local model
   ↓
evidence-backed answer
```

## No fine-tuning in MVP

Start with a shared base model and project-scoped retrieval.

Benefits:

- current code remains current;
- one model serves multiple projects;
- no per-project heavyweight model storage;
- easier evaluation.

## Retrieval namespaces

Must isolate:

```text
projectId
```

Optional narrower filters:

```text
module
taskId
time range
decision category
```

Do not automatically retrieve another project's data.

## Answer contract

```json
{
  "projectId": "...",
  "revision": "...",
  "question": "...",
  "answer": "...",
  "evidence": [],
  "historicalEvidence": [],
  "confidence": 0.0,
  "staleWarnings": []
}
```

## Evidence hierarchy

Prefer:

```text
current code/graph
canonical docs/ADRs
current task state
validated history
```

Historical observations never override current code facts.

## Initial question classes

```text
location
architecture
impact
tests
history
parallelism/conflict
conventions
```

## Tool interface

Expose one simple tool first:

```text
ask_project
```

Avoid exposing internal retrieval complexity to each agent.

## Tests

- project isolation;
- same question against two projects uses different evidence;
- answer cites current revision;
- stale historical claim is superseded by current code;
- read-only permissions;
- no code mutation tools exposed;
- low evidence produces explicit uncertainty.

## Later training

Only after enough validated data:

```text
accepted question
+ evidence
+ accepted answer
```

Create supervised/distillation datasets.

Train behavior/evidence ranking, not current project facts as the sole knowledge store.

## Retrieval fusion

The MVP retrieval layer should be able to combine:

```text
current symbol/graph evidence
canonical docs/ADRs
current task context
validated historical observations
```

with explicit precedence.

Do not allow semantic similarity alone to outrank current structural evidence.

## Evaluation gate before training

The Project Expert must have a fixed evaluation set before any fine-tuning/adapters are introduced.
