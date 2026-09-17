# Impact-Aware Scope and Conflict Design

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/06_SCOPE_IMPACT_CONFLICTS_ROUNDTABLE.md`


## Goal

Prevent agents from colliding without serializing the entire project.

## Bad approach

Do not convert every impacted/referencing file into an exclusive hard lock.

That would destroy useful parallelism.

## Scope levels

### WRITE

The current task is authorized to mutate this path/symbol.

### RESERVED

Strong direct coupling. Another task requesting WRITE should normally wait or replan.

### WATCH

Potential impact. Concurrent work may be allowed but must trigger conflict awareness/revalidation.

### IMPACT

Informational transitive impact only. No lock by default.

## Example

```text
Task changes:
IRecipeService.cs

Resolved:
IRecipeService.cs        WRITE
RecipeService.cs         RESERVED
RecipeController.cs      WATCH
RecipeTests.cs           WATCH
OtherFeature.cs          IMPACT
```

## Evidence used by the resolver

```text
explicit requested scope
task semantics
symbol type
direct references
call graph
implementation relationships
dependency distance
affected tests
change type
public API surface
current task scopes
```

## Suggested baseline policy

This is a starting policy, not a permanent hard-coded truth.

```text
distance 0 + direct mutation       → WRITE
distance 1 + strong coupling       → RESERVED
distance 1-2 affected consumer     → WATCH
distance 3+                        → IMPACT
```

Modify classification by change type.

Example:

```text
comment-only change
  → minimal propagation

private implementation change
  → WATCH direct consumers

public interface/signature change
  → stronger RESERVED/WATCH propagation
```

## Scope result schema

```json
{
  "taskId": "TASK-142",
  "projectId": "...",
  "revision": "...",
  "write": [],
  "reserved": [],
  "watch": [],
  "impact": [],
  "evidence": [],
  "confidence": 0.0
}
```

## Conflict rules

### WRITE vs WRITE

Block or serialize.

### WRITE vs RESERVED

Block by default.

### WRITE vs WATCH

Allow only according to policy; require revalidation before merge.

### WATCH vs WATCH

Usually allow.

### IMPACT

Informational.

## Semantic conflict

Two tasks can conflict without editing the same file.

Example:

```text
Task A modifies IRecipeService
Task B modifies RecipeController
```

The graph may show a semantic relationship.

Conflict Intelligence should therefore compare:

```text
file overlap
+
symbol overlap
+
dependency/impact overlap
```

## Git/worktree relationship

Worktrees provide physical isolation.

Scope provides semantic coordination.

They solve different problems:

```text
worktree
  → prevents direct working-directory collision

scope/conflict engine
  → prevents logically conflicting concurrent work
```

## Revision invalidation

Every impact/scope result must include the Git revision.

If the repository/worktree moves beyond the analyzed revision and relevant nodes changed:

```text
scope = stale
→ recompute
```

## Acceptance criteria

- no blanket lock over the entire impact graph;
- scope derivation is deterministic and explainable;
- conflict response includes evidence;
- write operations outside authorized scope can be blocked;
- current Git revision is always recorded.

## Scope lifecycle

Scope is a revision-bound snapshot, not a permanent lock:

```text
PROPOSED
→ RESOLVED
→ ACTIVE
→ STALE | RELEASED
```

A scope becomes `STALE` when relevant revision/policy inputs change.

## Merge-time validation

Before accepting a completed run:

```text
final diff
vs
authorized WRITE scope
```

must be checked even if all tool hooks previously allowed operations.
