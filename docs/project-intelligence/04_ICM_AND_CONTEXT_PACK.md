# ICM and Context Pack Design

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/04_ICM_AND_CONTEXT_PACK_ROUNDTABLE.md`


## Purpose

ICM provides a human-readable, versionable process layer.

Project Intelligence provides machine-derived knowledge of the current codebase.

The Context Pack joins both.

## ICM responsibilities

ICM should describe:

```text
stage
inputs
process
outputs
constraints
success criteria
handoff
references
```

ICM should not describe:

```text
specific provider
specific LLM
worker PID
runtime retry loop
GPU allocation
```

## Canonical document roles

### `AGENTS.md`

Bootstrap/project-level working instructions understood by the runtime.

### `AGENT.md`

Structured agent/workspace contract.

Front matter is intended to be machine-readable and enforceable.

### `PROJECT.md`

Stable project description / boundaries.

### `CONTEXT.md`

Stage/process routing and localized context.

### ADRs

Explicit architectural decisions and rationale.

## Proposed ICM resolver API

**PLANNED**

Internal service surface:

```text
discoverIcm(project)
parseIcmDocument(path)
buildIcmIndex(project)
resolveIcmStage(project, task)
validateIcm(project)
```

Suggested external operation:

```text
GET /api/intelligence/projects/:project/icm
```

or equivalent versioned route consistent with the current API.

Do not implement a new route shape until the current route conventions are re-read.

## Context Pack

The Context Pack is the main token-efficiency mechanism.

Input:

```text
task
project
git revision
ICM stage
requested symbol/module
profile
```

Derived evidence:

```text
relevant symbols
direct references
bounded graph
impact
affected tests
architecture rules
current task conflicts
relevant project history
```

Output:

```json
{
  "projectId": "...",
  "revision": "...",
  "taskId": "...",
  "stage": "...",
  "summary": "...",
  "constraints": [],
  "symbols": [],
  "files": [],
  "impact": [],
  "tests": [],
  "decisions": [],
  "history": [],
  "scopeHints": {}
}
```

## Bounded-context rules

1. Never return the complete graph by default.
2. Respect per-section limits.
3. Prefer symbols and evidence over raw full files.
4. Include file/line references when possible.
5. Expand on demand.
6. Mark the Git revision used to construct the pack.
7. Mark confidence/source for derived claims.
8. Do not include unrelated project memories.
9. Do not use historical memory as proof of current code state.

## Context Pack tiers

### FAST

Use for small tasks.

```text
task
+ local symbols
+ direct constraints
+ direct tests
```

### STANDARD

Use for most feature work.

```text
FAST
+ direct/transitive impact
+ relevant ADRs
+ ICM stage
+ conflict hints
```

### DEEP

Use for high-impact architecture/refactors.

```text
STANDARD
+ broader graph
+ historical incidents
+ multiple affected modules
+ richer review requirements
```

## Acceptance criteria

- deterministic for the same repository revision and inputs;
- bounded by configured limits;
- no unrelated project context;
- every code-derived assertion tied to current revision;
- does not require an LLM to discover basic project topology;
- can be consumed by multiple profiles without rebuilding the same analysis.

## Provenance and untrusted context

Every Context Pack section should retain source metadata.

Repository text/tool output is content, not runtime policy.

Context construction should label:

```text
trusted policy
canonical project facts
derived analysis
historical observations
untrusted repository/tool text
```

See `31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md`.

## Cache/invalidation

Context Pack reuse follows `35_CACHE_AND_DERIVED_STATE.md`, including dirty-worktree handling.
