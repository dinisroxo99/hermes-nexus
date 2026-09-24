# Current State Snapshot

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/01_CURRENT_STATE_ROUNDTABLE.md`


Snapshot date: **2026-09-17**

This document distinguishes repository-verified checkpoints from the original
conversation-derived snapshot. Before editing production code, verify the
repository again; the tracked active plan remains the implementation authority.

## Current adoption checkpoint — 2026-09-24

Step 3 is historically accepted at `4d8d23e564e355d84916b93d890762ac0c7498ee`.
The adoption source baseline is
`feat/nexus-profile-integration@10d1f348fd4c6ddbb5319d972c71b426e51e574a`, with
tracked `project_task_context` and `project_impact` tools. See
[DEV-ADOPTION-1](../hermes-plugin-installation.md#dev-adoption-1--approved-development-adoption)
for the approved six-profile development scope, legacy deferral, configuration
and rollback. G1 remains REJECTED and R1/R2 open/deferred; the current HIGH
severity / LOW non-blocking disposition is not a lifecycle fix. Publication,
fleet adoption and final verified operational docs remain pending. INFRA-1 is
approved, implementation pending after candidate verification/publication, not
deployed. **Step 4 is not initiated.**

<a id="repository-verified-impact-v2-implementation-checkpoint"></a>

## Historical pre-acceptance Impact v2 implementation checkpoint

On branch `feat/impact-v2`, implementation checkpoint `f238349` adds the live
read-only `POST /api/intelligence/projects/:projectId/impact` operation after the
accepted pure Impact v2 composer. It resolves persisted project/worktree identity,
collects bounded authorized sources, uses the existing native-first optional-
provider policy, composes once, and rechecks sources, safe revision, resolved
identity and nested-project exclusions before success. It does not persist Impact
results or reuse a cache.

The accepted domain budget remains 65,536 bytes by default and 131,072 bytes
maximum for compact `ImpactResult`. The compact HTTP success envelope is measured
separately and capped at 163,840 UTF-8 bytes; response overflow fails closed with
HTTP 500 / `impact_response_too_large`, without retrimming the domain result.
Request bodies remain capped at 65,536 observed bytes. At that historical
checkpoint, independent MC10 validation and acceptance were pending. It did not
claim Step 4, Git-diff impact, Effective Scope, conflicts or Hermes integration;
the later accepted/adoption status is recorded above.

## Historical repository-verified Step 2 checkpoint

Subsequent Step 2.5 adds the AnalyzerProvider abstraction, native adapters,
deterministic capability/coverage/fallback reporting and a data-only external
evidence boundary. Task Context Pack consumes the normalized output. Native
structural analysis remains .NET and TypeScript/JavaScript. Node.js projects
remain classified as `nodejs` and resolve to the existing JavaScript-capable
TypeScript analyzer; no separate Node.js analyzer/provider was introduced. The subsequent
`feat/serena-external-provider` checkpoint adds opt-in, snapshot-only Docker
Serena/Pyright semantic symbols, definitions and references for Python, verified
with real containers; no runtime network or persistent project index. It does
not change identity/revision semantics or start Step 3. See
`19_ANALYZER_PROVIDER_LAYER.md` and the tracked active
plan for the latest provider verification checkpoint. The Step 2 record below is
retained as historical evidence; it is not the current Impact v2 status.

At `93e2dd3 test: verify task context isolation and bounded output`:

- Step 1 identity/revision model is preserved.
- Step 2 Task Context Pack is implemented, including the read-only
  `POST /api/intelligence/projects/:projectId/task-context` operation.
- 285 tests pass, 0 fail, 0 skip; npm run check and git diff --check pass.
- 23 changed JavaScript files pass explicit syntax checks.
- User changes in `.env` and `data/projects.json` remain unstaged and were not
  included in implementation commits; the working tree is not globally clean.
- No dependency, persistent Context Pack cache, registry migration, Hermes
  runtime implementation or later phase was introduced.

See `04_ICM_AND_CONTEXT_PACK.md` for the exact Context Pack contract, provenance,
bounded retrieval, Linux/WSL descriptor requirement and limitations. Historical
foundation records below are retained as historical evidence, not as the latest
source/test checkpoint.

## Repository

**VERIFIED/CURRENT**

- Repository: `/home/dinis/projects/hermes-project-map`
- Branch discussed: `feat/project-intelligence-service`
- Architectural role: **Project Intelligence Service**, separate from Hermes agent/runtime orchestration.

## Historical verified checkpoint from conversation

**VERIFIED/CURRENT**

Commit:

```text
a642414 docs: document canonical project ICM foundation
```

Verification reported after the commit:

```text
npm test       → 176 passing, fail 0
npm run check  → passed
git diff --check → passed
working tree   → clean
```

Additional checks reported:

- no registry state changed;
- no persistent ICM cache/index created;
- no production ICM fixture files created;
- production `src/` files were not changed by that documentation commit.

## Existing Project Intelligence foundation

**VERIFIED/CURRENT**

The project has already contained the following foundations across the branch evolution.

### Configuration and roots

- centralized project configuration;
- legacy root support;
- support for multiple project roots via `PROJECTS_ROOTS`;
- safe relative path/root resolution;
- traversal / absolute / UNC rejection in the safe project path flow.

Earlier confirmed commits included:

```text
c39c5f2  centralize configuration
2aafa23  feat: add safe project root resolution
```

### Registry

- manual project registry;
- discovered project registry;
- effective registry merge;
- conflict/deduplication validation;
- atomic persistence for discovered project state.

### Project discovery

`src/lib/project-discovery.js` was confirmed to cover:

- discovery;
- project boundaries;
- classification/signals;
- .NET workspace detection;
- Node workspace detection;
- ignored build/VCS directories;
- symlink handling;
- bounded depth/results;
- public results hiding absolute roots.

### Analyzer service

`src/lib/analyzer-service.js` was confirmed to expose:

```text
analyzeProject
getImpact
getSymbolContext
getProjectInsights
```

Tests explicitly verified bounded, agent-friendly context/graph results.

### HTTP / intelligence routes

The branch has had Project Intelligence HTTP routing, including project discovery and intelligence operations.

Earlier confirmed route:

```text
GET /api/intelligence/discover
```

The exact current route surface must be re-read from the repository before implementation because local/remote state evolved during the conversations.

## ICM foundation

**VERIFIED/CURRENT**

The conversations confirmed the existence of an internal ICM foundation around:

```text
agent-manifest.js
workspace-index.js
icm-documents.js
icm-index.js
```

The documented architecture distinguishes:

- `AGENT.md` front matter as structured/enforceable contract;
- Markdown documents such as `AGENTS.md`, `CONTEXT.md`, `PROJECT.md`, ADRs as contextual/canonical project material;
- ICM index as metadata/index, **not** as a prompt dump.

The latest documented checkpoint intentionally did **not** introduce:

- a persistent ICM cache/index runtime store;
- registry mutation;
- production fixtures.

## Existing architecture boundary

**VERIFIED/CURRENT**

The accepted boundary is:

```text
hermes-nexus
  = project understanding / context / impact / ICM

Hermes
  = runtime / profiles / agents / providers / execution
```

Do not add provider/model routing to `hermes-nexus`.

## Things that must be verified again before coding

The following were discussed at different moments and should be checked directly in the working tree:

- exact current intelligence route names;
- whether ICM HTTP exposure is already present;
- exact shape of workspace index output;
- current register/discover API shape;
- exact plugin integration currently present;
- current README accuracy;
- current Docker/multi-root behavior;
- whether later commits after `a642414` changed source code.

## Rule for the next implementation

Start every new implementation phase by running:

```bash
git status
git log --oneline -15
npm test
npm run check
```

Then inspect the exact current source before applying this roadmap.

## Checkpoint age warning

The `a642414` / 176-test checkpoint is the latest state explicitly confirmed in the conversations used to build this pack. It is not a guarantee that the live repository is still on that commit.

Phase 0 must always re-verify the actual repository before implementation.

## Verification record template

When Phase 0 is executed, replace uncertainty with a checked record:

```text
Verified commit:
Verified branch:
Working tree:
Test count:
Check result:
Current routes:
Current ICM modules:
Current Hermes integration:
Reviewer/date:
```

Do not silently convert conversation-derived state into repository-verified state.
