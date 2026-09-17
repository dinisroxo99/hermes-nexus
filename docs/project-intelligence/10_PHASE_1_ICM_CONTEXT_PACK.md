# Phase 1 Implementation — ICM Resolver and Context Pack

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/10_PHASE_1_ICM_CONTEXT_PACK_ROUNDTABLE.md`


Status: **PLANNED**

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
- impact/test sections bounded;
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
