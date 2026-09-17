# External Component Reuse Matrix

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/24_EXTERNAL_COMPONENT_REUSE_MATRIX_ROUNDTABLE.md`


Status: **REFERENCE / EVALUATION**

The goal is to reuse useful primitives without turning the system into a chain of overlapping frameworks.

## Hermes Kanban

**Use now / primary runtime primitive**

Use for:

```text
tasks
board/UI
dependencies
workers
claims
worktrees
run history
task events
model override
```

Do not duplicate these in Project Map.

## Honcho

**Use for experiential memory**

Use for:

```text
user/agent long-term memory
cross-session experiential context
```

Do not use as authoritative current code truth.

## Serena

**Evaluate as analyzer provider**

Useful because language-server-backed symbol intelligence can complement native analyzers, including C# support.

Potential role:

```text
definitions
references
symbol navigation
semantic language-service evidence
```

Do not expose Serena-specific concepts as the canonical Project Map API.

## SourcePrep

**Reference / optional external context provider**

Useful ideas:

```text
code graph
trace expansion
blast-radius context
bounded retrieval
```

Do not replace Project Map's differentiating Context/Impact layer without a deliberate decision.

## MCP Agent Mail

**Deferred optional reservation/messaging provider**

Useful primitives:

```text
TTL file reservations
exclusive/shared reservations
audit
agent messaging
```

Current plan:

```text
Project Map scope
+ Hermes guard/worktree
```

should be tested before adding another coordination service.

## Agent Coordinator

**Reference implementation**

Useful patterns:

```text
lease-based file locks
atomic task claiming
health monitoring
workspace isolation
stale resource recovery
```

Do not integrate the full system while Hermes already owns the task/worker runtime.

## Plane / Taiga / OpenProject

**Deferred**

Only add if external human project-management requirements exceed Hermes Kanban.

Do not maintain two task sources of truth without a specific integration need.

## Reuse decision rule

Before adding an external component ask:

```text
1. Does Hermes already own this responsibility?
2. Does Project Map already own this responsibility?
3. Is the component replacing or complementing?
4. Can it be used behind an adapter?
5. What is the new source of truth?
6. What happens if the component is unavailable?
```

If source-of-truth ownership becomes ambiguous, do not integrate yet.

## Evaluation fields

Before integration, record for each component:

```text
license
maintenance/maturity
self-host requirements
data ownership
failure dependency
API/MCP stability
overlap with Hermes
overlap with Project Map
exit/replacement strategy
```

The matrix is a decision aid, not a shopping list.
