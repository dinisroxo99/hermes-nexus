# Project Intelligence Service — Active Implementation Plan

## Current checkpoint

2026-09-26: Step 3 is historically accepted at
`4d8d23e564e355d84916b93d890762ac0c7498ee`. This checkout is
`9fdcae32479ca688d49aab7c85ad83e704636ced`. Plugin/caller pin
`6ebb7aaa7ae7027c3e590a51bdbf5b5935651776`. Service pin
`85e511e7f65061cda861c98cd1acfbe9d79526b1`. Current adoption source baseline is
`feat/nexus-profile-integration@10d1f348fd4c6ddbb5319d972c71b426e51e574a`.
[DEV-ADOPTION-1](../../docs/hermes-plugin-installation.md#dev-adoption-1--approved-development-adoption)
approves the tracked Context/Impact plugin for six development profiles, including
concurrent workers. Two-tool publication and six-profile H-only offline adoption
are accepted in
[plugin installation](../../docs/hermes-plugin-installation.md#dev-adoption-1--approved-development-adoption).
INFRA-1 current operation is accepted at the service pin, with WSL-restart boot
not demonstrated and rollback not proved; that is not a boot, 24/7, G1 PASS, or
unit-runs-this-HEAD claim. G1 remains REJECTED; R1/R2 remain open/deferred, HIGH
severity and LOW/non-blocking development priority. Nine legacy tools remain
deferred. ETS WRITE/WATCH classification exists and is not Step 4, Conflict
Engine, or Guard. **Step 4 is not initiated as coordination/enforcement.**

### Next pipeline (distinct from Steps 1–9)

These etapas are not a renumbering of historical Steps 1–9.

1. Etapa 1 — this documentation recenter.
2. Etapa 2 — after this merge only: the docstring at
   `integrations/hermes-nexus/__init__.py:29`. Out of this change.
3. Etapa 3A — only after Etapa 2: observable WRITE∩WRITE, without blocking,
   RESERVED, leases, Guard, or WRITE×WATCH.
4. Etapa 3B — only after ACK of 3A. Hermes 0.21.5 does not prove a hook.
5. Etapa 4 — measure that slice only if real logs exist; otherwise Step 7 stays
   intact.

3A before 3B. Do not execute 2, 3A, 3B, or 4 here.

### Historical pre-acceptance MC10 checkpoint

Branch:

`feat/impact-v2`

Latest implementation checkpoint (pending independent MC10 validation/acceptance):

`080b15c fix: avoid duplicate impact response writes`

Impact v2 Step 3 now has the accepted pure single/multi-target composer, optional
affected-test candidates, an observation-bound live project service, and a
read-only `POST /api/intelligence/projects/:projectId/impact` operation. The live
boundary resolves persisted identity/worktrees, excludes nested projects, uses
the existing trusted single-provider policy, and reobserves sources, revision,
project identity and exclusions before returning success. Domain compact-result
bytes remain 64 KiB default / 128 KiB maximum; the complete compact HTTP success
body has a separate fixed 160 KiB ceiling. This checkpoint is implemented and
locally verified. The full suite reports 502 tests: 488 passed, 0 failed and 14
skipped opt-in real Docker/Serena cases. It is not yet an independent acceptance
record.

Previous Serena/Python implementation/test checkpoint:

`bd8fce6 fix: harden Serena sandbox conformance and cleanup`

Optional Serena/Python integration: **COMPLETE**, disabled by default until a
trusted immutable local image is configured. This checkpoint's documentation
update records its canonical contract. It is historical context for the later
Impact v2 work above.

Previous Serena/Python final verification:

- 46 focused provider/Context Pack/integration tests passed; 0 failed/skipped.
- 338 full-suite tests passed; 0 failed/skipped (`SERENA_DOCKER_TESTS=1 npm test`).
- 14 explicit real Docker tests passed; 0 failed/skipped.
- npm run check and git diff --check passed; 14 changed JS files and 2 Python
  files passed explicit syntax checks.
- independent final re-review: no remaining concrete security or logic blockers;
  reviewer independently ran 29 targeted tests, all passing.
- real container probes verify non-root, network none, read-only source/root,
  no live/.git/HOME/socket exposure, bounded tmpfs/CPU/memory/PIDs and cleanup.
- native .NET/TypeScript/JavaScript behavior preserved; identity/revision,
  source collection, Context Pack composer and existing cache implementations
  are unchanged.
- no host dependency installation, host Docker configuration change, Git config
  mutation, persistent external project index, Hermes/Honcho integration or push.

Implementation micro-commits:

1. `1e82e15 feat: add pinned Serena Python semantic image`
2. `1478205 feat: normalize Serena Python definitions and references`
3. `4b72225 feat: sandbox snapshot-bound Serena provider requests`
4. `7372b7b feat: consume optional Serena evidence in task context`
5. `bd8fce6 fix: harden Serena sandbox conformance and cleanup`

The Step 1/2/2.5 checkpoints and working-tree notes below are historical records
from `feat/project-intelligence-service`, not the current checkout status.

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
- Node.js projects resolved through the existing JavaScript-capable native
  TypeScript analyzer while retaining `nodejs` project classification
- deterministic single-provider priority/fallback with explicit partial coverage
- snapshot-bound, data-only external/LSP adapter boundary (no tool execution)
- provider-independent Context Pack provenance and capability-aware statuses
- optional pinned Serena SolidLSP/Pyright semantic symbols/definitions/references
  for Python, through a fixed offline snapshot-only Docker worker
- observed mounted-source binding, explicit transport failure/fallback reasons,
  real sandbox conformance and default-off trusted image configuration
- Impact v2 pure bounded single/multi-target reverse-impact evidence
- optional affected-test candidates with retained per-origin witnesses
- live persisted-project/worktree Impact observation and fail-closed reobservation
- read-only project-ID Impact HTTP endpoint with independent domain/transport caps

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

### hermes-nexus owns

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
- Node.js graph/search/context/expand routes through the existing native
  TypeScript/JavaScript analyzer; no separate Node.js provider is registered;
- bounded external JSON must match project, revision/worktree snapshot,
  provider ID/version and normalized descriptor request token;
- unauthorized paths/URIs, absent files, undeclared operations, invalid locations
  and ambiguous IDs fail validation; external input cannot execute code or IO;
- Context Pack retains schema/sections and existing security, with additive
  provider/coverage metadata, per-item external trust, source lines where known,
  and partial/not_analyzed statuses preserved through byte trimming;
- printable bounded polyglot symbol names no longer require JavaScript syntax.

Original Step 2.5 limitations and approval gate (historical; Python gate fulfilled below):

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

### Optional external provider — Serena/Python: COMPLETE

Separately authorized continuation of Step 2.5, **not Step 3**.

- Pipeline: existing authorized bounded snapshot → private exported `.py` sources
  → fixed Docker sandbox → Serena SolidLSP/Pyright → normalized external evidence
  → existing Context Pack sections. Case-insensitive suffixes preserve paths.
- Serena source `f8f53b77f04e50aadf9e5789841ec6a95c874514` / `1.7.1.dev0`,
  Pyright `1.1.403`, Python `3.11.13`, Node `22.18.0`; base image digests and
  dependency/artifact hashes pinned, with exact inventory in
  `docker/serena-python/versions.json` and `requirements.lock`.
- Verified local image:
  `sha256:77379ee3d115e8f2b9f8b4223fbf1195b2d4b6b9b06b385a2bc30949d4af26c8`.
  Rebuilds must record their own immutable ID; runtime tags/pulls are rejected.
- Structural detection/bounded analysis; semantic symbols/definitions/references.
  Dependencies, implementations and diagnostics remain unsupported.
- 2 CPUs / 1 GiB / 30-second request budget / 256 KiB response. Non-root,
  read-only source/root, network none, capabilities dropped, no-new-privileges,
  64 MiB tmpfs, 1 MiB shared memory, 64 PIDs; separate 2-second cleanup budget.
- Existing projectId/revision/worktree/descriptor token bindings plus recomputed
  mounted-source observation token; strict URI/path/location/ID/edge validation.
- No agent/MCP server, edits, shell tools, memory, project switching or runtime
  dependency download. No live checkout, `.git`, HOME, credentials or socket mount.
- Optional trusted `SERENA_PYTHON_IMAGE` or internal `serena: { image }` option;
  no HTTP-body runtime controls. Single-provider native-first selection remains.
  Unavailable/timeout/crash/invalid/oversize/cleanup failure permits explicit
  fallback; missing Python semantics stays incomplete/not_analyzed.
- Remaining limitations: synchronous bounded transport blocks Node; incomplete
  snapshots/dependencies and dynamic Python may limit evidence; no `.pyi`
  extension expansion, persistent index/cache, whole-worktree snapshot or complete
  DLP. Host/daemon outage may prevent cleanup. Other languages remain deferred.

Canonical runtime contract: `docs/project-intelligence/19_ANALYZER_PROVIDER_LAYER.md`.
Build/enablement guide: `docker/serena-python/README.md`.

## Current development frontier

<a id="step-3--impact-v2-implemented-pending-independent-mc10-acceptance"></a>

### Step 3 — Impact v2: ACCEPTED

Accepted historical revision: `4d8d23e564e355d84916b93d890762ac0c7498ee`.
The former pending-MC10 status above is retained as historical evidence.

The bounded file/multi-file traversal, project composer, optional affected-test
candidates, live service and HTTP operation are implemented on `feat/impact-v2`.
Impact v2 remains separate from legacy exploration impact. Results are
revision/worktree-bound evidence only, never authorization or effective scope.
The canonical contract is documented in
`docs/project-intelligence/06_SCOPE_IMPACT_CONFLICTS.md`.

Approved foundation constraints:

- statuses: `available`, `partial`, `unsupported`, `unavailable` and
  `not_requested` for optional sections;
- per-evidence outcomes: `evidence_found`, `no_evidence_found`, `not_evaluated`,
  where `no_evidence_found` is not proof of safety or no impact;
- completeness dimensions: source, provider, traversal and output;
- evidence basis: semantic, structural, heuristic or unknown;
- one selected provider graph per result; no cross-provider federation;
- optional Serena/Python references can be conservative evidence, but definitions
  are not dependency edges and `<module>` reference owners are not proven callers;
- traversal depth default `2`, maximum `5`; depth `0` does not expand neighbors;
- multi-target results require a witness for every retained origin;
- affected tests are candidates, not coverage guarantees;
- no LLM, persistent Impact cache, telemetry, Project Expert, Git-diff impact,
  Effective Scope, Conflict Engine or Guard in this foundation slice.

Implemented incrementally:

1. file impact
2. multi-file impact
3. affected tests
4. live project service and bounded HTTP operation

Git-diff impact remains deferred. Step 4 is not authorized by this checkpoint.

### Step 4 — Effective Task Scope

**NOT INITIATED as coordination/enforcement.** Two-tool publication and
six-profile H-only offline adoption are accepted. ETS WRITE/WATCH classification
is not this step. The following remains target work.

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

Hermes Nexus calculates context/scope.

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
- Global Orchestrator inside Hermes Nexus
- Agent Factory
- Team Factory
- Project Factory
- model/provider execution inside Hermes Nexus
- Project Expert fine-tuning
- autonomous agent swarm generation