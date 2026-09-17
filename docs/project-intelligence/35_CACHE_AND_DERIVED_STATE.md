# Cache, Invalidation and Derived State

> **Roundtable review v4:** NEW — approved after roundtable — 2026-09-17  
> Companion review: `reviews/35_CACHE_AND_DERIVED_STATE_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

Use caching to reduce repeated analysis/tokens without serving stale project context.

## What may be cached

```text
symbol index
search index
Context Pack
impact snapshot
scope snapshot
Project Expert retrieval result
test mapping
```

## What is never replaced by cache

```text
Git repository
canonical project documents
Hermes task/run truth
explicit approvals
```

## Cache key

Derived artifacts should include relevant identity:

```text
projectId
revision fingerprint
worktree/dirty fingerprint when relevant
analysis version
policy version
query/task semantic key
```

## Clean commit vs dirty worktree

A commit SHA is insufficient when files are modified but uncommitted.

Use an additional dirty-state fingerprint or disable reuse for affected artifacts.

## Invalidation triggers

### Repository change

Invalidate entries whose dependencies changed.

### ICM/ADR change

Invalidate Context Packs depending on those documents.

### Analyzer version change

Invalidate analysis output affected by analyzer semantics.

### Scope policy change

Invalidate scope/conflict snapshots.

### Knowledge-status change

Invalidate Project Expert caches when an observation becomes superseded/rejected.

## Dependency-aware invalidation

Prefer targeted invalidation when dependency metadata exists.

Fallback:

```text
revision changed
→ recompute task-critical derived state
```

Safety is more important than maximizing cache hits.

## TTL

Revision-bound code facts do not need a time-only TTL if revision identity is strong.

External/historical sources may require TTL or freshness checks.

## Cache stampede

For expensive analysis:

```text
single-flight / in-progress key
```

prevents several agents from rebuilding the same artifact simultaneously.

## Cache observability

Track:

```text
hit
miss
stale reject
recompute duration
artifact size
dependency count
```

This is required to prove token/latency savings.

## Acceptance criteria

- stale revision cannot return a task-critical Context Pack as current;
- dirty worktree state is represented;
- analyzer/policy version changes invalidate derived results;
- multiple agents can reuse one valid Context Pack;
- all caches can be deleted without losing canonical project truth.
