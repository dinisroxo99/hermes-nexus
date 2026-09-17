# Project Intelligence Service — Active Implementation Plan

## Current checkpoint

Branch:

`feat/project-intelligence-service`

Step 1 starting checkpoint:

`775ef78 feat: validate persisted project identities`

Final Step 1 checkpoint:

`f8adc7c docs: describe stable project identity and revision boundaries`

Step 2 starting checkpoint:

`a92d215 docs: checkpoint project identity step`

Final Step 2 implementation/test checkpoint:

`93e2dd3 test: verify task context isolation and bounded output`

Final Step 2 canonical documentation checkpoint:

`5faa91e docs: describe bounded task context pack contract`

Step 2 final verification (at `5faa91e`):

- 285 tests passed
- 0 failed
- 0 skipped
- npm run check: passed
- 23 changed JavaScript files: explicit syntax checks passed
- git diff --check: passed
- independent re-review: no remaining security or logic findings
- real loopback task-context HTTP test: passed
- 40-function fixture: graph + ICM 9,422 compact bytes; targeted pack 4,780 bytes
- working tree: pre-existing `.env` and `data/projects.json` user changes remain
  unstaged; no claim of a globally clean working tree
- no dependency, registry-data or environment changes included in Step 2 commits

Step 2.5 starting checkpoint:

`8b4fb08 docs: checkpoint task context pack step`

Final Step 2.5 implementation checkpoint:

`cf5fd59 refactor: consume analyzer providers in task context`

Final Step 2.5 canonical documentation checkpoint:

`b7a590f docs: describe polyglot analyzer provider boundaries`

Step 2.5 final verification:

- 306 tests passed; 0 failed; 0 skipped
- npm run check: passed
- 14 changed JavaScript files: explicit syntax checks passed
- git diff --check: passed
- final targeted independent review: no remaining security or logic findings
- no dependency/service installation, persistent external index or Impact v2
- project identity/revision semantics and cache ownership unchanged
- pre-existing `.env` and `data/projects.json` edits remain unstaged and excluded
  from all Step 2.5 commits; working tree is not globally clean

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
- bounded project-local source observations with descriptor verification
- existing ICM/analyzer reuse through isolated source snapshot inputs
- deterministic, versioned Task Context Pack with per-section limits/provenance
- declared-only ICM constraints and untrusted-text separation
- current project/worktree revision and observed-change rejection
- read-only projectId-based task-context HTTP endpoint
- no Task Context Pack persistence or cache reuse
- normalized AnalyzerProvider contract and explicit language/capability discovery
- native .NET and TypeScript/JavaScript provider adapters
- deterministic single-provider priority/fallback with explicit partial coverage
- snapshot-bound, data-only external/LSP adapter boundary (no tool execution)
- provider-independent Context Pack provenance and capability-aware statuses

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

## Completed implementation steps

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

### Step 2 — Task Context Pack: COMPLETE

Implemented bounded, deterministic, revision-aware task context from:

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

Verified contract and limitations:

- `POST /api/intelligence/projects/:projectId/task-context` requires an existing
  persisted ID; legacy name-based endpoints remain unchanged.
- Schema version 1 / analysis version `task-context-v1`; safe Git/worktree
  evidence, bounded sections, per-source hashes and explicit trust labels.
- Dirty/unborn/non-Git/unavailable revision states are working-tree observations;
  no cache reuse. Reobserved source/revision changes reject the pack.
- `generatedAt` is null and volatile capturedAt is omitted for determinism.
- Linux/WSL `/proc/self/fd` verification is required for source retrieval;
  unavailable verification fails closed to partial metadata-only results.
- Source limits can omit evidence; no atomic filesystem snapshot, full dirty
  fingerprint, analyzer wall-clock guarantee or complete secret-DLP claim.
- TypeScript/JavaScript and .NET symbol extraction reuse existing analyzers;
  mixed snapshots prefer .NET. Test candidates are heuristic, not coverage proof.
- Excerpts are opt-in bounded prefixes, not full files or symbol-centered views.
  Expansion is resubmission with narrower targets, not a new endpoint.
- No persistent Context Pack cache, stage resolver, Hermes high-level tool,
  scheduling, provider/model routing, agent selection or runtime implementation.

Canonical contract: `docs/project-intelligence/04_ICM_AND_CONTEXT_PACK.md`.

### Step 2.5 — Polyglot Analyzer Provider Layer: COMPLETE

Project Intelligence now consumes a normalized language-analysis provider
contract. This is not Hermes LLM/model/provider routing.

Verified result:

- existing native analyzers retained; snapshot extension recognition is
  case-insensitive without renaming paths;
- explicit unsupported/structural/semantic operation levels for detection,
  bounded source analysis, symbols, definitions, references, dependencies,
  implementations and diagnostics;
- .NET then TypeScript/JavaScript then configured external priority/fallback;
  explicit capability/quality/language requirements; no silent graph merging;
- bounded external JSON must match project, revision/worktree snapshot,
  provider ID/version and normalized descriptor request token;
- unauthorized paths/URIs, absent files, undeclared operations, invalid locations
  and ambiguous IDs fail validation; external input cannot execute code or IO;
- Context Pack retains schema/sections and existing security, with additive
  provider/coverage metadata, per-item external trust, source lines where known,
  and partial/not_analyzed statuses preserved through byte trimming;
- printable bounded polyglot symbol names no longer require JavaScript syntax.

Known limitations and approval gate:

- installed native analysis remains .NET and TypeScript/JavaScript;
  Python/Go/Rust/Java/Bash/PowerShell observation is not semantic support;
- native graph extraction is structural/heuristic; precise definitions,
  implementations and compiler diagnostics are not advertised natively;
- external boundary is data-only, not an installed Serena/LSP transport or a
  sandbox for arbitrary plugins; tests use explicit external protocol fixtures;
- no new dependency/service, persistent external memory/index/database or cache;
- existing Linux/WSL descriptor-verification and bounded-source limitations remain;
- optional Serena/Pyright integration requires separate approval of pinned
  dependencies, a snapshot-only sandbox and real-server conformance tests.

Canonical contract and exact integration proposal:
`docs/project-intelligence/19_ANALYZER_PROVIDER_LAYER.md`.

## Current development frontier

### Step 3 — Impact v2

Next implementation frontier. **NOT STARTED.** Requires separate authorization.

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