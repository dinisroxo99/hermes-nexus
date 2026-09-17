# Backup, Recovery and Operational Runbooks

> **Roundtable review v4:** NEW — approved after roundtable — 2026-09-17  
> Companion review: `reviews/34_BACKUP_RECOVERY_AND_RUNBOOKS_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

A 24/7 system must recover not only processes, but durable coordination and learning state.

## Data classes

### Reconstructable

```text
derived Context Packs
impact snapshots
scope snapshots
indexes/caches
```

Can be regenerated if source state exists.

### Durable operational

```text
Hermes Kanban/task/run DB
Project Map registry/bindings
configuration
```

Needs backup.

### Durable learning/history

```text
normalized telemetry
validated observations
feedback
design memory
training manifests
```

Needs backup and retention policy.

### Source code

Git remote/repository remains the primary backup mechanism for committed code.

Uncommitted task worktrees require explicit recovery handling.

## Backup policy

Initial simple policy:

```text
daily DB backup
configuration backup after change
periodic historical/object-store snapshot
Git pushes for accepted code
```

Exact schedule is environment policy.

## Restore test

A backup is not trusted until restored.

Regularly test:

```text
restore Hermes task DB copy
restore Project Map DB
resolve a known project
reconstruct one historical run
query one Project Expert observation
```

## Incident runbooks

### Project Map unavailable

```text
stop mutation-dependent dispatch
allow configured read-only workflows
restart/check DB/analyzers
verify project bindings
resume
```

### Hermes/Kanban unavailable

```text
preserve Project Map state
do not invent replacement task status
restart Hermes
reconcile active run/worktree references
```

### Local model unavailable

```text
queue local jobs
or runtime fallback according to model policy
```

### Disk full

```text
stop new artifact-heavy runs
preserve DB integrity
prune configured caches first
never delete canonical history blindly
```

### Corrupt derived cache

```text
invalidate/rebuild
```

### Corrupt durable DB

```text
stop writes
restore backup
reconcile Git/Hermes run state
```

## Orphan worktrees

On startup/recovery, identify:

```text
worktree with active run
worktree with closed run
worktree with missing task/run
```

Do not auto-delete unknown worktrees before inspecting their Git status.

## Recovery metadata

Persist enough to reconnect:

```text
projectId
taskId
runId
worktree path/id
starting revision
latest observed revision
```

## Acceptance criteria

- durable DBs have a documented backup method;
- restore is tested, not assumed;
- orphan worktrees are detectable;
- cache corruption does not require restoring canonical state;
- incident steps identify which system owns the truth.
