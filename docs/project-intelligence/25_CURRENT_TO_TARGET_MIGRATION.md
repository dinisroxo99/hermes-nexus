# Current-to-Target Migration Plan

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/25_CURRENT_TO_TARGET_MIGRATION_ROUNDTABLE.md`


Status: **PLANNED**

## Objective

Reach the target architecture without destabilizing the working Project Intelligence branch.

## Preserve

Do not rewrite working foundations solely for naming consistency.

Preserve:

```text
config/root safety
registry
project discovery
atomic discovered state
analyzer service
search/context/impact/insights
HTTP server/routing foundation
ICM foundation already documented
tests
```

## Migration strategy

Prefer additive slices.

### Slice A — Verify

Create:

```text
docs/current-state-verified.md
```

from the actual current branch.

Record:

```text
commit SHA
routes
modules
test count
known gaps
```

### Slice B — Stabilize project identity

Ensure:

```text
projectId
Git root
worktree → parent project
```

are represented consistently.

Do this before adding cross-project memory/history.

### Slice C — ICM resolver

Build on existing ICM modules.

Do not introduce a second ICM model beside the existing one.

### Slice D — Context Pack

Add a composition layer over existing analyzer outputs.

Do not replace `search/context/impact/insights`.

### Slice E — Scope/conflicts

Consume normalized existing impact output.

Do not change analyzer semantics merely to suit locking.

### Slice F — Hermes adapter/plugin

Keep integration outside the Project Map core business logic.

Core services must remain testable without Hermes installed.

### Slice G — telemetry adapter

Consume Hermes events/runs and attach Project Map metadata.

Do not build a competing task state machine.

### Slice H — Project Expert

Build read-only retrieval over the already stable APIs/history.

## Compatibility rule

Each slice should keep old public behavior working unless an intentional versioned API change is approved.

## Tests before each merge

```bash
npm test
npm run check
git diff --check
```

plus new slice-specific tests.

## Commit style

Recommended:

```text
test: define ...
feat: add ...
refactor: ...
docs: ...
```

Small commits make rollback and architecture review easier.

## Stop conditions

Pause a phase if it requires:

```text
duplicating Hermes orchestration
introducing provider credentials into Project Map
breaking project isolation
turning memory into source of current code truth
unbounded prompt/context generation
```

Re-evaluate the boundary instead of forcing the implementation.

## Feature flags and rollback

New cross-cutting behavior should be activatable independently where practical:

```text
ICM Context Pack
scope/conflict analysis
guard enforcement
telemetry ingestion
Project Expert
```

This allows baseline comparison and rollback.

Do not make a single irreversible migration that simultaneously changes all agent behavior.
