# Implementation Roadmap

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/09_IMPLEMENTATION_ROADMAP_ROUNDTABLE.md`


## Guiding rule

Do not start by building more orchestration.

Strengthen the Project Intelligence path and integrate it with the orchestration Hermes already provides.

## Phase order

```text
0. Re-verify repository state
0.5 Stabilize projectId / board / worktree identity
1. ICM Resolver + Context Pack
2. Impact → Scope → Conflict Engine
3. Hermes Guard / Kanban integration
4. Hermes telemetry ingestion
5. Project Expert
6. Observability / Learning Data
7. Benchmark and optimize
```

## Phase 0 — Re-verify repository

Before changing code:

```bash
git status
git log --oneline -15
npm test
npm run check
```

Then inspect:

```text
src/lib/analyzer-service.js
src/lib/project-discovery.js
src/lib/project-registry.js
intelligence route files
ICM modules
existing Hermes plugin/integration
tests/
docs/
```

Output:

```text
docs/current-state-verified.md
```

Do not implement from assumptions contained in this pack if the repository has evolved.

## Phase 0.5 — Project identity and isolation

Deliver:

```text
stable projectId
board → project mapping
worktree → parent project resolution
cross-project query guards
```

Do this before project-scoped memory/history is added.

## Phase 1 — ICM Resolver + Context Pack

Deliver:

```text
ICM discovery/parse/validate/resolve
project task context
bounded Context Pack
revision/source metadata
```

No agent routing.

No provider routing.

No Kanban implementation.

## Phase 2 — Scope/Conflict Engine

Deliver:

```text
impact normalization
WRITE/RESERVED/WATCH/IMPACT
task-to-task overlap detection
revision invalidation
explainable conflict result
```

Do not build a distributed scheduler.

## Phase 3 — Hermes integration

Deliver a thin integration/plugin:

```text
task claim → prepare context/scope
pre LLM → inject bounded context
pre tool → scope guard
completion → record result
```

Reuse Hermes Kanban/worktrees.

## Phase 4 — Hermes telemetry ingestion

Ingest runtime-native task/run/tool/API/token telemetry and attach Project Map context/scope metadata. Do not build a competing task lifecycle database.

## Phase 5 — Project Expert

Start without fine-tuning.

Deliver:

```text
ask_project
project-scoped retrieval
read-only answer synthesis
evidence/citations to code/project artifacts
history retrieval
```

Use a small local model if viable.

## Phase 6 — Observability / training data

Deliver:

```text
runs
events
metrics
feedback
artifact references
dataset export
```

Do not train a new model yet.

Collect clean data first.

## Phase 7 — Evaluation

Compare:

```text
Hermes baseline
vs
Hermes + Project Map bounded context
```

Measure:

```text
success rate
prompt tokens
completion tokens
tool calls
time
retries
human corrections
conflict incidents
```

Only after evidence should further architecture be added.

## Recommended merge discipline

Each phase should be split into micro-commits:

```text
tests first / contract first
implementation
routes/integration
docs
```

After every commit:

```bash
npm test
npm run check
git diff --check
git status
```

## Phase gates

A phase does not start solely because the previous code was merged.

Required gates:

```text
tests green
docs updated
source-of-truth owner clear
rollback/rebuild path defined
security implications reviewed
benchmark baseline captured when relevant
```

Cross-cutting Phase 0.5 also includes the canonical entity model from `30_STATE_AND_DATA_MODEL.md`.
