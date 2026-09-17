# Canonical State and Data Model

> **Roundtable review v4:** NEW — approved after roundtable — 2026-09-17  
> Companion review: `reviews/30_STATE_AND_DATA_MODEL_ROUNDTABLE.md`


Status: **PLANNED**

## Purpose

Provide one canonical vocabulary for the entities that appear throughout the architecture.

Without this document, `projectId`, tasks, runs, Context Packs, scopes, observations and ideas risk acquiring slightly different meanings in different modules.

## Ownership rule

Every entity has exactly one primary owner.

```text
Hermes owns runtime/task execution state.
Project Map owns derived project intelligence state.
Git owns repository content/revision truth.
Honcho owns external experiential memory.
Design Memory owns proposals/ideas.
Learning Store owns normalized analytical/training records.
```

## Core entities

### Project

```text
projectId
displayName
repositoryIdentity
canonicalGitRoot
status
createdAt
```

`projectId` is stable across directory moves and worktrees.

### RepositoryRevision

```text
projectId
commitSha
dirtyStateFingerprint (optional)
worktreeId (optional)
capturedAt
```

A dirty worktree must never be silently represented only by its parent commit.

### HermesBoardBinding

```text
projectId
boardId / boardSlug
bindingStatus
createdAt
```

Initial rule: one normal software project maps to one board unless explicitly configured otherwise.

### TaskReference

Project Map does not own the task lifecycle.

It stores a reference:

```text
projectId
hermesTaskId
boardId
parentTaskId (optional)
```

### RunReference

```text
projectId
taskId
hermesRunId
sessionId
profile
worktreeId
startedRevision
endedRevision
```

### ContextPack

```text
contextPackId
projectId
taskId
revisionFingerprint
icmVersion
analysisVersion
budgetPolicy
contentSections
evidenceRefs
createdAt
```

Context Packs are derived and disposable.

The implemented Step 2 DTO refines this logical sketch: `schemaVersion: 1`,
`analysisVersion: "task-context-v1"`, `contextPackId`, persisted `projectId`, safe
`revision`, `observation`, `limits` and provenance-labelled `sections`. The task
reference is `sections.task.items[0].id`; no task lifecycle is persisted.
`generatedAt` is null and volatile observation timestamps are omitted from the
deterministic payload. `observation.sourceDigest` hashes bounded collected
sources, not the entire worktree; it is not a new RepositoryRevision fingerprint
or identity store. No Context Pack state is persisted. See the implemented
contract in `04_ICM_AND_CONTEXT_PACK.md`; other entity sketches here remain planned.

### ImpactSnapshot

```text
impactId
projectId
taskId
revisionFingerprint
rootTargets
nodes
edges/evidence
confidence
analysisVersion
```

### ScopeSnapshot

```text
scopeId
impactId
write
reserved
watch
impact
policyVersion
createdAt
```

### ConflictSnapshot

```text
conflictId
taskA
taskB
scopeA
scopeB
severity
reasons
recommendedAction
createdAt
```

### ProjectObservation

Validated historical knowledge:

```text
observationId
projectId
status
statement
evidenceRefs
validFromRevision
validToRevision
confidence
supersededBy
```

### DesignIdea

Defined in `27_DESIGN_MEMORY_AND_IDEA_LIFECYCLE.md`.

### TelemetryEvent

Defined in `32_EVENT_SCHEMA_VERSIONING_AND_IDEMPOTENCY.md`.

## Derived vs authoritative state

### Authoritative

```text
Git repository content
canonical ICM/ADR/project documents
Hermes task/run state
explicit human approvals
```

### Derived / recomputable

```text
Context Pack
impact
scope
conflict analysis
search indexes
Project Expert retrieval cache
```

Derived state must be disposable and reproducible from authoritative state wherever practical.

## Persistence principle

Persist derived state only when it provides one of:

```text
performance
auditability
historical learning
reproducibility
```

Do not persist derived state merely because it exists.

## Version fields

All long-lived derived objects should record relevant producer versions:

```text
schemaVersion
analysisVersion
policyVersion
modelVersion where applicable
```

## Deletion / retention

Deleting a project should support separate policies for:

```text
runtime binding
derived caches
historical telemetry
training exports
design ideas
```

Do not automatically delete historical/audit data without an explicit project policy.

## Acceptance criteria

- every persisted entity has a primary owner;
- a run can be linked from Hermes task → Project Map context → Git revision;
- dirty worktree state is distinguishable from a clean commit;
- derived state can be invalidated by revision/policy/version;
- no duplicate task lifecycle is introduced into Project Map.
