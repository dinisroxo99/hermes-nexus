# Acceptance Tests and Benchmarks

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/15_ACCEPTANCE_AND_BENCHMARKS_ROUNDTABLE.md`


## Why this matters

The architecture is intended to improve:

```text
context quality
token efficiency
parallel safety
24/7 operation
project knowledge reuse
```

Those claims must be measured.

## Benchmark groups

### Baseline A

Hermes worker without Project Map Context Pack.

### Baseline B

Hermes + existing Project Intelligence calls, but no Context Pack/scope.

### Candidate

Hermes + ICM + Context Pack + impact/scope + guard.

## Task classes

Use repeated representative tasks:

```text
small/local bug
single-module feature
cross-module feature
public API change
test-only task
documentation task
refactor
```

## Metrics

### Efficiency

```text
prompt tokens
completion tokens
total tokens
tool calls
files opened
context bytes
wall-clock time
```

### Quality

```text
build pass
tests pass
review pass
human accepted
manual edits required
regressions
```

### Coordination

```text
task conflicts detected before execution
out-of-scope writes blocked
merge conflicts
stale scope incidents
parallel task throughput
```

### Project Expert

```text
answer correctness
evidence precision
evidence recall
stale-knowledge errors
cross-project contamination
answer tokens
latency
```

## Token target

Do not declare a fixed percentage in advance.

Measure whether bounded Context Packs reduce exploratory tool calls and total prompt-token reuse.

A meaningful win should be demonstrated across medium/large tasks, not cherry-picked tiny tasks.

## 24/7 test

Run:

```text
Hermes gateway
Project Map
Kanban dispatcher
local inference provider
Honcho
event store
```

for an extended test window.

Measure:

```text
idle resource usage
worker recovery
stale task behavior
event completeness
DB growth
model queue behavior
```

## Regression gates

For every Project Map release:

```bash
npm test
npm run check
git diff --check
```

Add architecture-specific tests for:

```text
project isolation
bounded context
revision invalidation
scope conflict
guard enforcement
training/event schema compatibility
```

## Experimental design

Prefer paired comparisons on the same or equivalently seeded task fixtures.

For each benchmark record:

```text
repository revision
task prompt
model/provider
profile
execution mode
context policy
randomness/settings where configurable
```

Report distributions, not only averages.

At minimum track:

```text
median
p90/p95 where useful
failure count
first-pass success
manual-correction rate
```

Maintain a small frozen golden set for Project Expert correctness/regression.
