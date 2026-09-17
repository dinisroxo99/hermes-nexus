# Phase 1 Implementation — ICM Resolver and Context Pack

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/10_PHASE_1_ICM_CONTEXT_PACK_ROUNDTABLE.md`


Status: **Step 2 Task Context Pack IMPLEMENTED**. Broader stage/tool sketches
below remain planned; they are not authorization for later implementation.

## Verified implementation

- `buildProjectTaskContext` resolves persisted projectId and an optional verified
  worktree, collects bounded local sources, and reuses the Project ICM Index,
  workspace matcher and existing snapshot-mode analyzers.
- `POST /api/intelligence/projects/:projectId/task-context` is the read-only HTTP
  operation. There is no Hermes tool/runtime implementation or stage resolver.
- The versioned pack has independently bounded sections and provenance, no
  default full files/graphs, and no cache reuse. Dirty/unavailable Git is explicit.
- `generatedAt: null` and omission of volatile `revision.capturedAt` preserve
  deterministic serialization. No whole-repository dirty fingerprint is added.
- Linux/WSL kernel descriptor verification is required for source collection;
  unavailable verification fails closed to partial metadata-only results.
- `tests/task-context-benchmark.test.js` is a reproducible task-to-pack fixture;
  `tests/task-context-routes.test.js` exercises a real loopback HTTP request.
- The 40-function fixture measured 9,422 compact bytes for graph + ICM versus
  4,780 for the targeted pack, with two facade calls versus one. These are
  synthetic response-size measurements, not production latency/token claims.

The exact request, response, limits, trust model and remaining limitations are in
`04_ICM_AND_CONTEXT_PACK.md` under **Implemented Step 2 contract**. The candidate
DTOs/functions below are retained as architecture sketches, not current APIs.

## Objective

Turn the existing ICM foundation into a stable, queryable source for task-specific context.

## Constraints

- preserve current Project Intelligence behavior;
- do not add model/provider routing;
- do not add task scheduling;
- do not create persistent ICM caches unless required by measured performance;
- reuse existing project discovery/registry/path safety;
- keep results bounded.

## Step 1 — Verify existing modules

Inspect and document current contracts for:

```text
agent-manifest.js
workspace-index.js
icm-documents.js
icm-index.js
analyzer-service.js
```

Do not duplicate an existing parser/index.

## Step 2 — Define canonical ICM DTO

Suggested logical contract:

```json
{
  "projectId": "...",
  "revision": "...",
  "documents": [],
  "stages": [],
  "agents": [],
  "workspaces": [],
  "validation": {
    "errors": [],
    "warnings": []
  }
}
```

## Step 3 — Add/complete ICM resolver

Candidate internal functions:

```text
resolveProjectIcm(project)
resolveTaskIcm(project, task)
resolveStage(project, task)
validateIcm(project)
```

Use existing naming conventions where possible.

## Step 4 — Build Context Pack service

Candidate:

```text
buildProjectTaskContext({
  project,
  task,
  profile,
  limits
})
```

Compose:

```text
ICM
+ symbol context
+ bounded graph
+ impact
+ relevant tests
+ canonical constraints
```

## Step 5 — Revision metadata

Every Context Pack includes:

```text
git root identity
projectId
git SHA / revision
generatedAt
```

## Step 6 — HTTP/tool exposure

Expose only after internal service tests are stable.

Potential operations:

```text
project_icm
project_task_context
```

Follow current route style instead of inventing a parallel API convention.

## Tests

### ICM tests

- valid project documents resolve;
- missing optional docs do not crash;
- invalid contract returns structured diagnostics;
- paths cannot escape project root;
- deterministic ordering;
- duplicate canonical source handling.

### Context Pack tests

- limits are enforced;
- unrelated symbols excluded;
- current revision included;
- reference/test sections bounded (Impact v2 remains outside Step 2);
- empty/simple projects handled;
- output is agent-friendly.

## Done criteria

- all existing tests remain green;
- new tests cover resolver and Context Pack;
- no provider/model logic introduced;
- documentation describes canonical ICM flow;
- one fixture/walk-through proves task → Context Pack.

## Additional implementation requirements from roundtable

- attach provenance to every Context Pack section;
- distinguish trusted policy from repository text;
- include `schemaVersion` / `analysisVersion`;
- handle dirty worktrees or explicitly reject unsafe cache reuse;
- capture a baseline of current context size/tool calls before optimization;
- define deterministic serialization for tests.
