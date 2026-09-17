# 24/7 Deployment and Operations

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/23_24_7_DEPLOYMENT_AND_OPERATIONS_ROUNDTABLE.md`


Status: **PLANNED**

## Objective

Keep the agent environment continuously available while consuming inference resources only when work exists.

## Logical services

```text
Hermes gateway/runtime
Hermes Kanban dispatcher/dashboard
Project Map service
local inference service
Honcho / memory provider
learning/observability database
optional MCP/analyzer services
```

## Process supervision

Long-running local services should be supervised by the OS.

Examples:

```text
systemd user services
systemd system services where appropriate
```

Required properties:

```text
restart on crash
start after reboot
bounded restart backoff
logs available
explicit dependencies
```

## Idle behavior

24/7 uptime must not mean 24/7 LLM usage.

The dispatcher and Project Map can remain idle with no inference call until a task/question requires one.

## GPU policy

The RTX A2000 12 GB is the scarce local resource.

Recommended initial behavior:

```text
one heavy local inference at a time
queue additional heavy local tasks
allow non-inference services concurrently
```

Smaller models can later be benchmarked for higher concurrency.

## Persistence

Back up:

```text
Project Map registry/state
Hermes Kanban databases
learning/observability DB
validated project observations
configuration
```

Do not back up transient worktrees as the only copy of important completed work.

## Health checks

Track:

```text
Hermes available
dispatcher alive
Project Map health/readiness
local model endpoint available
memory provider available
DB writable
disk space
GPU memory pressure
```

## Readiness vs liveness

### Liveness

Process is running.

### Readiness

Process can safely accept a new task.

Example:

```text
Project Map alive but analyzer initialization failed
→ alive=true
→ ready=false
```

## Telemetry retention

Use different retention classes:

```text
operational logs        short/medium
normalized run metrics  long
validated observations  long
raw prompts/responses   project policy
temporary tool output   short
```

## Dashboard exposure

Default:

```text
localhost only
```

Remote viewing requires an authenticated reverse-proxy pattern.

## Failure policy

If Project Map is unavailable:

```text
read-only Hermes work may continue by policy
code mutation requiring scope validation should not silently proceed
```

## Recovery

After restart, reconstruct from durable sources:

```text
Hermes Kanban task/run state
Git/worktrees
Project Map snapshots
telemetry DB
```

Do not depend on in-memory agent state as the only truth.

## Operational acceptance

A 24/7 soak test should measure:

```text
idle CPU/RAM
DB growth
service restarts
stale workers/tasks
GPU queue behavior
telemetry gaps
failed context/scope resolutions
```

## Capacity limits

Define explicit resource limits for:

```text
concurrent workers
heavy local-model concurrency
queued tasks
artifact disk usage
DB growth
raw telemetry retention
```

Unbounded queues/logs are operational failures.

## Recovery

Detailed backup/restore/runbook policy lives in `34_BACKUP_RECOVERY_AND_RUNBOOKS.md`.
