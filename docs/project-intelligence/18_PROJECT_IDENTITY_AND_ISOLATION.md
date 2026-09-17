# Project Identity and Multi-Project Isolation

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/18_PROJECT_IDENTITY_AND_ISOLATION_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

Allow the same global Hermes profiles to work across many repositories without contaminating:

```text
tasks
memory
project history
impact data
scope data
worktrees
Project Expert retrieval
```

## Canonical identities

### `projectId`

Stable Project Map identifier.

Must not depend only on directory name.

Example:

```text
prj_92af0d
```

### Git identity

Store enough evidence to recognize the repository:

```text
git root
remote identity when available
repository metadata
```

### Hermes board identity

Map a Hermes Kanban board to one Project Map project by default.

```text
boardSlug → projectId
```

A board may later support multi-repo work, but that must be explicit.

## Mapping record

Suggested logical structure:

```json
{
  "projectId": "prj_92af0d",
  "board": "cookation",
  "gitRoot": "/projects/cookation",
  "repositoryIdentity": "...",
  "status": "active"
}
```

## Run identity

Each worker run is scoped by:

```text
runId
taskId
projectId
boardId
profile
workspace/worktree
git revision
```

## Isolation rules

### Code

A run may only read/write within its authorized project/worktree policy.

### Project Intelligence

Every query includes or resolves a `projectId`.

### Project Expert

Retrieval defaults to:

```text
current project
+
current task
+
allowed global memory
```

No cross-project retrieval unless explicitly requested.

### Historical data

Every execution event and observation is tagged with:

```text
projectId
revision
taskId/runId where relevant
```

### Honcho

Honcho may retain global experiential memory, but project-specific retrieval must be filtered by the active project context where the integration allows it.

Do not rely on conversational wording alone to prevent contamination.

## Board strategy

Recommended initial rule:

```text
one software repository/project
→ one Hermes Kanban board
→ one Project Map projectId
```

This gives a simple default isolation model.

Later multi-repo epics can introduce an explicit higher-level workspace identity.

## Worktrees

A task-specific worktree is a runtime workspace, not a new project.

```text
projectId remains constant
taskId/runId changes
workspace path changes
```

## Acceptance tests

- same profile can run on two projects concurrently;
- Context Pack for project A never includes project B files;
- Project Expert query for A cannot retrieve B's project observations by default;
- scope comparisons occur only within the intended project;
- board → project mapping is deterministic;
- moving the repository directory does not silently create a second project identity;
- worktree is recognized as belonging to the parent project.

## Clone, fork and monorepo considerations

Identity policy must distinguish:

```text
same project moved locally
same remote cloned twice
fork intentionally treated as new project
monorepo root with multiple logical projects
Git worktree of same project
```

Do not finalize the `projectId` algorithm until these cases have tests.

For the initial implementation, explicit persisted project identity is preferable to guessing identity solely from remote URL.
