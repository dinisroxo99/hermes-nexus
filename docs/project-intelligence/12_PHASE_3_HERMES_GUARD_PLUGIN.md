# Phase 3 Implementation — Hermes Guard Plugin

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/12_PHASE_3_HERMES_GUARD_PLUGIN_ROUNDTABLE.md`


Status: **PLANNED**

## Objective

Make Project Map intelligence operational inside Hermes without moving orchestration into Project Map.

## Defense-in-depth requirement

`pre_tool_call` is an important enforcement point, but it is not the only safety boundary. Use task worktrees, workspace path checks, semantic scope validation and final Git-diff validation as additional layers. The integration callback itself must catch failures and deliberately block mutation when validation is unavailable.

## Plugin responsibilities

### Task claimed

Resolve:

```text
board/task
projectId
git root
git revision
worktree
Context Pack
scope
```

Store only minimal runtime linkage.

### Before LLM

Inject:

```text
task
ICM stage
bounded Context Pack
scope summary
active conflicts
```

Do not inject the full graph.

### Before tool call

For mutation-capable tools:

```text
resolve target path/symbol
ensure inside worktree
check WRITE authorization
check active conflict policy
```

Return:

```text
ALLOW
BLOCK
REPLAN_REQUIRED
```

### After tool call

Emit structured event.

### Task completed/blocked

Record:

```text
final revision
diff summary
test/review outcome
scope violations
```

## Tool classification

Maintain categories:

```text
read_only
known_safe
mutation
unknown
```

Unknown commands that may mutate should not silently bypass the guard.

## Fail-safe behavior

When Project Map is unavailable:

Recommended initial policy for mutation:

```text
fail closed
```

Read-only operations may optionally continue.

Make this configurable only after the safe default is proven.

## Worktree boundary

All filesystem mutation must resolve within the active task worktree.

Reject:

```text
../other-project
absolute path outside workspace
other task worktree
```

## Tests

- normal read allowed;
- valid in-scope write allowed;
- out-of-scope write blocked;
- path traversal blocked;
- another project blocked;
- task without resolved scope cannot mutate;
- Project Map unavailable → mutation fails closed;
- structured event emitted for block/allow;
- Context Pack bounded before LLM.

## Done criteria

A Hermes worker can execute a real task while Project Map:

1. injects context;
2. limits mutation scope;
3. records decisions;
4. does not own the Hermes task lifecycle.

## Hook failure and latency

A control-path callback must:

```text
catch its own exceptions
return an intentional policy result
use strict timeout budgets
avoid long synchronous Project Expert work
```

The guard is one layer in the security design; see `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md` and `31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md`.

## Completion validation

Before accepting task completion, compare final Git diff with the active ScopeSnapshot.
