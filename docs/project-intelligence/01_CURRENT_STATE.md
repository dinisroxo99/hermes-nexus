# Current State Snapshot

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/01_CURRENT_STATE_ROUNDTABLE.md`


Snapshot date: **2026-09-17**

This document is intentionally conservative. It records only state that was confirmed in the project conversations. Before editing production code, verify the repository again.

## Repository

**VERIFIED/CURRENT**

- Repository: `/home/dinis/projects/hermes-project-map`
- Branch discussed: `feat/project-intelligence-service`
- Architectural role: **Project Intelligence Service**, separate from Hermes agent/runtime orchestration.

## Latest verified checkpoint from conversation

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
hermes-project-map
  = project understanding / context / impact / ICM

Hermes
  = runtime / profiles / agents / providers / execution
```

Do not add provider/model routing to `hermes-project-map`.

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
