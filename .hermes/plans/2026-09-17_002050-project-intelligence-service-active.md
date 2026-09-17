# Project Intelligence Service — Active Implementation Plan

## Current checkpoint

Branch:

`feat/project-intelligence-service`

Step 1 starting checkpoint:

`775ef78 feat: validate persisted project identities`

Final Step 1 checkpoint:

`f8adc7c docs: describe stable project identity and revision boundaries`

Architecture pack checkpoint:

`14d9ee0 docs: align project intelligence roadmap with current architecture`

Step 1 final verification (at `f8adc7c`):

- 252 tests passed
- 0 failed
- 0 skipped
- npm run check: passed
- git diff --check: passed
- working tree: clean

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
- stable persisted projectId
- legacy ID-less records remain supported
- ambiguous lookup fails safely
- configured-root isolation
- Git revision metadata
- linked worktrees resolve under parent project identity
- worktrees are not enrolled as separate projects through discovery registration
- analysis cache revision/worktree isolation
- .NET symbol cache revision/worktree isolation
- safe identity/revision overview

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

## Completed implementation step

### Step 1 — Project Identity / Revision Model: COMPLETE

Completed by extending the existing registry without introducing a second identity store.

Do not create a second project identity system if the existing model can
be extended safely.

Verified result:

- stable project identity
- repository revision identity
- worktree → parent project relationship
- no cross-project ambiguity

Known Step 1 limitations:

- legacy records require explicit identity assignment before ID-dependent workflows;
- relocation remains explicit registry maintenance;
- public HTTP lookup is still name-based and fails on ambiguity;
- PowerShell registration remains a legacy single-root tool;
- dirty-content fingerprints are deferred.

## Current development frontier

### Step 2 — Task Context Pack

Next implementation frontier. Not started.

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