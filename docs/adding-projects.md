# Adding projects

[← README](../README.md) · [Implementation](./analyzers-implementation.md) · [Execution](./analyzers-execution.md) · [Hermes integration](./hermes-tool-integration.md)

## Purpose

This guide explains how to add, list, and remove projects in `hermes-project-map`.

Manual projects are stored in `data/projects.json`; explicitly enrolled discovered projects are stored in `data/discovered-projects.json`. The API uses the effective registry through `src/lib/projects.js`.

## How it works

Registry locations use relative paths, not absolute source paths. A legacy record remains valid without a projectId:

```json
{
  "name": "faturas-backend",
  "relativePath": "Faturas",
  "addedAt": "2026-07-03T13:59:01"
}
```

The real path is calculated like this:

```txt
configured root selected by rootId + relativePath
```

Omitted rootId means `default`; legacy configuration still supplies that root through `PROJECTS_ROOT_CONTAINER`/`PROJECTS_ROOT`. Both legacy and intelligence lookup use the selected root, reject unknown roots and verify realpath containment. Name ambiguity is an error, not a first-match selection.

## Stable project identity

Explicit registration now assigns an opaque `prj_<UUID>` ID once, then preserves it on subsequent updates. A supplied `projectId` must be 1–128 ASCII characters, begin with a letter/digit, and otherwise use only letters, digits, `_` or `-`. Values are case-sensitive and are never normalized. Do not derive IDs from names, paths, remotes or commits.

Existing records without IDs are still valid. Reading, listing, discovery and overview do not migrate them. To assign an ID deliberately:

- for a manual record, invoke the existing registration script for that record or edit the manual registry explicitly;
- for a discovered record, explicitly request it through the guarded discovery-registration API. Only requested ID-less discovered records acquire IDs;
- never use the discovered-registry writer to rewrite the manual registry.

An absent persisted ID appears as `project.projectId: null` in overview. Explicit `projectId: null` in registry data is invalid, not equivalent to omission.

### Moves, renames, clones and forks

Retain the existing ID and update the existing locator when moving a project. The PowerShell script preserves an ID when re-adding the same name at a new path or renaming the same path; if name and path identify different records it fails without writing. The script remains a legacy single-root registration tool; use explicit registry edits for multi-root locator changes.

Do not delete/re-enroll a moved project and expect automatic identity recovery. Arbitrary moved-and-renamed checkout recognition is not implemented. A colliding identified alias must be relocated explicitly rather than registered as a new project.

Clones and forks are separate registrations by default, even when history/remotes match. Keep aliases distinct within a root. Same-name projects across roots remain separate, but name-only HTTP lookup returns an ambiguity error; internal consumers can use exact ID lookup. Discovered workspace modules remain modules, not new projects.

### Worktrees and revision evidence

Linked worktrees retain their identified registered parent's projectId. Discovery verifies common Git metadata, logical project subdirectory and actual worktree membership. Registering a verified worktree returns `already_registered` with the parent ID and creates no second project record. Unresolved parents or inaccessible Git-file metadata reject the whole registration request before writing.

Do not manually enroll task worktrees as unrelated projects. Project Map reads worktree evidence; Hermes continues to own their lifecycle. Git metadata must be reachable in the runtime/container, otherwise revision evidence is unavailable.

Overview exposes safe revision metadata, not absolute Git paths or remote URLs. `repositoryIdentity` and `worktreeId` are local checkout evidence and can change after a move or remount; neither replaces the stable persisted projectId. Both existing caches bypass dirty, unborn and unavailable Git checkouts. Non-Git compatibility caching remains available without Git revision guarantees.

See [the canonical identity contract](./project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md) for errors, internal lookup APIs and remaining boundaries.

### Docker location example

In Docker, `docker-compose.yml` mounts the host directory at `/projects`:

```yaml
volumes:
  - "${PROJECTS_ROOT}:/projects:ro"
```

Therefore:

```txt
Host:      C:/Users/aiino/Documents/Faturas
Container: /projects/Faturas
Record:    relativePath = "Faturas"
```

## Configure `PROJECTS_ROOT`

Create `.env` from the example file:

```powershell
copy .env.example .env
```

Current example:

```env
PROJECTS_ROOT=C:/Users/aiino/Documents
PORT=8770
DOTNET_VERSION=10.0
```

Every added project must be inside `PROJECTS_ROOT`.

Valid examples:

```txt
C:/Users/aiino/Documents/Faturas
C:/Users/aiino/Documents/my-next-app
C:/Users/aiino/Documents/work/project-a
```

Invalid example when `PROJECTS_ROOT=C:/Users/aiino/Documents`:

```txt
D:/Repos/project-a
```

In that case, either change `PROJECTS_ROOT` or move the project into the configured folder.

## Add a project with the script

Use the PowerShell script:

```powershell
.\scripts\add-hermes-project.ps1 -Name "faturas-backend" -Path "C:\Users\aiino\Documents\Faturas"
```

Registration is generic: it adds the project to `data/projects.json`. The analyzer then detects whether the project is `.NET`, `TypeScript`, `Node.js`, and so on.

### TypeScript / Next.js example

```powershell
.\scripts\add-hermes-project.ps1 -Name "site-next" -Path "C:\Users\aiino\Documents\site-next"
```

If the project has both `package.json` and `tsconfig.json`, it will be detected as `typescript`.

## Naming rules

The name (`-Name`) must match:

```txt
^[a-zA-Z0-9][a-zA-Z0-9\-_]*$
```

Allowed:

```txt
faturas-backend
site_next
Project123
```

Not recommended / invalid:

```txt
faturas backend
../faturas
faturas/backend
```

## List projects

Via script:

```powershell
.\scripts\list-hermes-projects.ps1
```

Via API:

```bash
curl http://localhost:8770/api/projects
```

## Remove a project

Via script:

```powershell
.\scripts\remove-hermes-project.ps1 -Name "faturas-backend"
```

This only removes the record from `data/projects.json`. It does not delete the actual project folder.

## Edit `data/projects.json` manually

You can also edit the file manually:

```json
[
  {
    "name": "faturas-backend",
    "relativePath": "Faturas",
    "addedAt": "2026-07-03T13:59:01"
  },
  {
    "name": "site-next",
    "relativePath": "site-next",
    "addedAt": "2026-07-07T18:00:00"
  }
]
```

Be careful:

- the file must be valid JSON;
- `relativePath` must be relative to `PROJECTS_ROOT`;
- do not use an absolute path in `relativePath`;
- do not point outside `PROJECTS_ROOT`.

## Validate after adding a project

### 1. Confirm that it appears in the API

```bash
curl http://localhost:8770/api/projects
```

### 2. Confirm the structure

```bash
curl http://localhost:8770/api/projects/faturas-backend/structure
```

### 3. Search for a symbol

For `.NET`:

```bash
curl "http://localhost:8770/api/explore/faturas-backend/search?q=InvoiceCreationService"
```

For TypeScript:

```bash
curl "http://localhost:8770/api/explore/site-next/search?q=Provider"
```

### 4. Retrieve the graph

```bash
curl "http://localhost:8770/api/explore/faturas-backend/full?nodeLimit=500&edgeLimit=1200"
```

## Use with Docker

After changing `.env` or `data/projects.json`, restart the service.

If you only changed `data/projects.json`:

```bash
docker compose restart
```

If you changed dependencies, the Dockerfile, or want to guarantee a clean environment:

```bash
docker compose up --build
```

## Troubleshooting

### `Project folder not found in container`

Likely cause:

- `relativePath` does not exist inside `/projects`;
- `PROJECTS_ROOT` points to the wrong folder;
- the container was not restarted after changing `.env`.

Check:

```txt
PROJECTS_ROOT=C:/Users/aiino/Documents
relativePath=Faturas
```

This should map to:

```txt
/projects/Faturas
```

### `The project must be inside PROJECTS_ROOT`

The script blocks projects outside `PROJECTS_ROOT` to keep the Docker mapping simple.

Solution:

- change `PROJECTS_ROOT`; or
- move the project inside `PROJECTS_ROOT`.

### TypeScript project appears empty

Check whether there are relevant files outside ignored directories:

```txt
.ts
.tsx
.js
.jsx
```

Ignored directories:

```txt
node_modules
.next
dist
build
coverage
```

### Dependency error in Docker

If you see something like `Cannot find package 'ts-morph'`, rebuild:

```bash
docker compose up --build
```

## Recommended next steps

- Add tests to validate `data/projects.json`.
- Improve detection for TypeScript monorepos with `tsconfig.json` in subfolders.
