# Project Identity and Multi-Project Isolation

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/18_PROJECT_IDENTITY_AND_ISOLATION_ROUNDTABLE.md`


Status: **Step 1 identity/revision foundation implemented. Board, task/run, memory and enforcement integration remain planned.**

## Implemented Step 1 contract

The existing manual/discovered/effective registry is the only project identity store. No marker file, second registry or automatic live-data migration was added.

### Persisted identity and explicit migration

- `projectId` is optional on legacy array records. Reads do not allocate or persist an ID. Overview represents an unassigned ID as `null`; do not persist `null` as an explicit ID.
- Explicit IDs are opaque, case-sensitive strings: 1–128 ASCII characters, starting with a letter or digit and otherwise containing only letters, digits, `_` or `-`. Invalid explicit values throw `invalid_project_identity`; they are never trimmed, repaired or replaced.
- Explicit discovered registration assigns `prj_` plus a random UUID to requested new/ID-less discovered records and preserves existing IDs. Client identity/Git metadata is not authoritative.
- The existing PowerShell manual-registration script assigns/preserves IDs when explicitly invoked. Re-adding the same name at a new path, or renaming at the same path, retains the ID; conflicting name/path matches fail without writing.
- `name` is a compatibility alias. `(rootId, relativePath)` is a locator. Neither is the durable identity.
- Move a project by explicitly updating its existing registry locator while retaining its ID. Missing paths never cause replacement IDs to be allocated. Automatic moved-and-renamed repository recognition is not implemented.
- Separate clones and forks receive separate registrations by default. Shared commits or remote URLs never merge identities. Use distinct aliases within one root. Discovered monorepo modules remain modules; explicitly registered logical projects retain their own IDs/subdirectory boundaries.

### Lookup and conflict behavior

Manual-first ordering and same-root legacy precedence remain. Same names in different roots are not collapsed. A manual entry at exactly the same locator may inherit an already persisted discovered ID in the effective in-memory view; no file is rewritten. Conflicting explicit IDs on one locator, one ID on different locators, or conflicting identified same-root aliases fail with `project_identity_conflict`.

Both legacy and intelligence name lookups reject multiple matches. Internal callers can qualify names by root or call `getProjectByIdForIntelligence(projectId, options)` for exact ID-only lookup. HTTP name endpoints are not automatically reinterpreted as ID endpoints.

Location resolution selects the configured root and verifies directory/realpath containment. Unknown roots never fall back to the legacy root. Missing paths can remain in listings; unsafe/unavailable locations have no usable path. Legacy ID-less records continue to work where their aliases are unambiguous.

### Git revision and worktree evidence

The optional Serena/Python integration preserves this model unchanged. Git reads
remain in Project Map on the host. The semantic container receives safe revision
metadata and snapshot/request tokens, never `.git` or a live checkout. Its
`observedSourceToken` describes only exported source bytes, not a new project ID,
revision algorithm or dirty-worktree fingerprint. Replay across project,
revision/worktree or changed source snapshots is rejected. See
`19_ANALYZER_PROVIDER_LAYER.md` for the external evidence boundary.

`src/lib/project-revision.js` captures live Git evidence using shell-free argument arrays, a 2-second timeout and a 1 MiB output limit **per Git invocation**. Locator-related inherited Git environment overrides are removed; optional locks and filesystem-monitor execution are disabled for the read. No persistent Git configuration is changed and no remote URL is read.

The safe revision projection contains:

```text
status: available | unborn | not_git | unavailable
commitSha: full Git object ID or null
branch: branch name or null for detached HEAD
dirty: true | false | null when unknown
repositoryIdentity: opaque local common-directory evidence or null
worktreeId: opaque local checkout evidence or null
isLinkedWorktree: true | false | null when unknown
capturedAt
```

Local evidence identifiers are hashes of canonical metadata locations. They may change after relocation/remounting and are **not projectId**. Git paths remain internal; overview returns a safe projection. Staged, unstaged, untracked and submodule changes are included in dirty-state detection. Unborn/unavailable repositories are never presented as a known clean commit.

`resolveProjectWorktree(projectId, locator, options)` resolves a configured-root checkout under the parent's persisted ID. It requires matching common-directory evidence and logical project subdirectory, plus membership in Git's actual worktree listing. Branch/name/SHA equality or a copied `.git` file is insufficient. The result retains the parent's name and ID, adds `parentProjectId`/`canonicalLocation`, and uses the selected checkout's locator/path. It does not persist a worktree project record.

Discovery recognizes `.git` files as well as directories, distinguishes linked worktrees from separate-Git-directory layouts, and supplies `isLinkedWorktree`/`parentProjectId` for linked candidates. Exactly one identified registered parent must match. Resolved worktree registration returns `already_registered` with the parent ID, without enrolling another project. An unresolved parent or inaccessible `.git`-file metadata rejects the registration batch with `worktree_parent_unresolved` before any write.

### Existing cache and overview behavior

Both the analysis cache and direct .NET symbol-index cache include exact project/location/revision/worktree identity. Dirty, unborn or Git-unavailable requests bypass cache reads and writes. Confirmed non-Git projects retain the previous TTL/signature compatibility behavior; they do not gain Git freshness guarantees. Name-based cache clearing remains available. The .NET cache replaces prior revisions for the same project/location rather than retaining unbounded revision history.

Overview adds `project.projectId` and the safe `revision` block, retaining schemaVersion 1. It requires exact cache identity matching and never labels a different revision or dirty worktree fresh; unmatched analysis has `not_analyzed` and null graph counts. Intelligence identity conflicts return 409; malformed explicit IDs return 400. Legacy routes retain their existing error-envelope conventions. ICM `workspace.project` still refers to the registry name, not projectId.

### Verification boundaries and limitations

- Automated coverage uses real temporary Git repositories, commits, clones, linked worktrees, separate Git directories and actual PowerShell script execution. Production code only reads worktree metadata; fixture creation/cleanup is confined to disposable test repositories.
- PowerShell tests run with `pwsh` or Windows PowerShell when available. On WSL, Windows PowerShell fixtures use the Windows temporary directory and an explicitly authorized process-only execution-policy override. Tests report a skip when no PowerShell executable exists; a skip is not evidence that the manual script passed.
- Git invocation bounds are not a global wall-clock deadline for discovery. Large dirty output, inaccessible metadata and Git trust failures return unavailable rather than bypassing trust controls.
- Read-only container mounts must expose usable Git metadata, including parent metadata referenced by linked worktrees. No `safe.directory=*` workaround is installed.
- No immutable concurrent-filesystem snapshot, dirty-content fingerprint, ignored-file content fingerprint, remote-identity matching, persistent cache redesign or general multi-clone binding was added.
- General source traversal/enforcement, board bindings, Context Pack, Impact v2, effective scopes, conflicts and all Hermes runtime/task ownership remain outside Step 1.

The remaining sections describe the wider isolation roadmap; they are not a claim that those later integrations are implemented.

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

## Wider isolation acceptance tests (partly future)

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

The implemented Step 1 policy above uses explicit persisted random IDs and tested locator/worktree boundaries, not a remote- or content-derived identity algorithm.

For the initial implementation, explicit persisted project identity is preferable to guessing identity solely from remote URL.
