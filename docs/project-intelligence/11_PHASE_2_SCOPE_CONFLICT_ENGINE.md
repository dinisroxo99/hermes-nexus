# Phase 2 Implementation — Scope and Conflict Engine

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/11_PHASE_2_SCOPE_CONFLICT_ENGINE_ROUNDTABLE.md`


Status: **PLANNED**

## Objective

Convert Project Intelligence impact into enforceable task coordination metadata.

## Input

```text
task
projectId
git revision
requested module/symbol/path
change type
impact graph
```

## Output

```text
WRITE
RESERVED
WATCH
IMPACT
```

plus evidence and confidence.

## Component split

Suggested logical modules:

```text
impact-normalizer
scope-resolver
conflict-detector
scope-policy
```

Use existing folder conventions; names are not mandatory.

## Step 1 — Normalize impact

Create a stable internal representation independent of analyzer provider.

Example:

```json
{
  "node": "RecipeService",
  "relation": "caller",
  "distance": 1,
  "file": "...",
  "symbol": "...",
  "evidence": "..."
}
```

## Step 2 — Change classification

Initial categories:

```text
documentation
local implementation
public signature
interface/contract
schema/migration
test-only
unknown
```

Do not require LLM classification for obvious cases.

## Step 3 — Resolve scope

Rules should be policy-driven.

Example baseline:

```text
explicit targets                 → WRITE
strong direct coupled nodes      → RESERVED
affected direct consumers/tests  → WATCH
transitive weak nodes            → IMPACT
```

## Step 4 — Detect task conflicts

Given scope A and scope B:

```text
file overlap
symbol overlap
semantic/dependency overlap
```

Produce:

```json
{
  "conflict": true,
  "severity": "...",
  "reasons": [],
  "recommendedAction": "wait|replan|allow-with-revalidation"
}
```

## Step 5 — Revision invalidation

Scope includes the analyzed revision.

Recompute when relevant repository state changed.

## Step 6 — Expose tool/API

Candidate operations:

```text
task_scope
task_conflicts
```

Project Map calculates; Hermes decides task lifecycle.

## Tests

- WRITE/WRITE conflict;
- WRITE/RESERVED conflict;
- WRITE/WATCH policy;
- WATCH/WATCH allowed;
- transitive impact does not become automatic hard lock;
- interface signature produces stronger propagation than comment change;
- stale revision detected;
- unrelated project IDs never conflict.

## Done criteria

- scope is deterministic/explainable;
- no graph-wide blanket hard lock;
- conflict engine can compare active task snapshots;
- source evidence returned for every non-trivial classification.

## Invariants

The implementation must satisfy:

```text
WRITE ∩ RESERVED for same task may be normalized, never ambiguous
another task WRITE vs current WRITE => conflict
cross-project scopes never conflict by accident
stale scope cannot authorize new mutation
IMPACT alone never grants write authority
```

Add property/invariant tests in addition to example-based tests.
