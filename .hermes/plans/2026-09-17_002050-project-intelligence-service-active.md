# Project Intelligence Service — Active Implementation Plan

## Current checkpoint

Branch:

`feat/project-intelligence-service`

Verified implementation checkpoint:

`9544613 feat: match task paths to workspace scopes`

Latest branch documentation checkpoint:

`44f4fa9 docs: old plan`

Architecture pack checkpoint:

`14d9ee0 docs: align project intelligence roadmap with current architecture`

Verification baseline:

- workspace-scope tests: 24 passing
- complete suite: 200 passing
- failures: 0
- npm run check: passed
- git diff --check: passed

## Implemented capabilities

- centralized project configuration
- safe project roots
- manual/discovered/effective registry
- atomic discovered registry persistence
- deterministic project discovery
- bounded project overview
- canonical AGENT.md manifest parser
- Workspace Index
- bounded contextual ICM document index
- canonical Project ICM Index
- workspace scope contracts
- task paths → workspace scope matching

## Architecture boundary

### Hermes owns

- profiles and SOULs
- agents
- model/provider execution
- Kanban
- dispatcher
- task lifecycle
- worktrees
- runtime execution

### hermes-project-map owns

- project discovery and registry
- Project Intelligence
- ICM
- Context Packs
- impact analysis
- effective task scopes
- conflict intelligence
- Project Expert project knowledge

### Git owns

- current repository content
- repository revision truth
- final code diff

### Honcho owns

- experiential long-term memory

Honcho is not authoritative current-code truth.

## Current development frontier

### Step 1 — Verify project identity/revision model

Inspect the existing registry first.

Do not create a second project identity system if the existing model can
be extended safely.

Required result:

- stable project identity
- repository revision identity
- worktree → parent project relationship
- no cross-project ambiguity

### Step 2 — Task Context Pack

Build a bounded, deterministic, revision-aware task context from:

- task
- task paths
- workspace matches
- Project ICM Index
- relevant files
- relevant symbols
- relevant tests
- architecture constraints
- provenance

No LLM.

No routing.

No agent selection.

### Step 3 — Impact v2

Implement incrementally:

1. file impact
2. multi-file impact
3. affected tests
4. git diff impact later

### Step 4 — Effective Task Scope

Derive:

- WRITE
- RESERVED
- WATCH
- IMPACT

from:

- explicit task targets
- workspace scopes
- Project Intelligence
- impact
- change semantics

### Step 5 — Conflict Engine

Compare active task scopes and return explainable conflict evidence.

### Step 6 — Hermes Guard integration

Project Map calculates context/scope.

Hermes enforces execution.

### Step 7 — Hermes telemetry ingestion

Reuse Hermes task/run/tool/model telemetry.

Do not create a competing task runtime.

### Step 8 — Project Expert

Read-only and retrieval-first.

### Step 9 — Learning and evaluation

Only after sufficient validated execution data exists.

## Deferred

Do not implement now:

- custom Hermes Agent OS
- custom Kanban
- Global Orchestrator inside Project Map
- Agent Factory
- Team Factory
- Project Factory
- model/provider execution inside Project Map
- Project Expert fine-tuning
- autonomous agent swarm generation