# Adding projects

[← README](../README.md) · [Implementation](./analyzers-implementation.md) · [Execution](./analyzers-execution.md) · [Hermes integration](./hermes-tool-integration.md)

## Purpose

This guide explains how to add, list, and remove projects in `hermes-project-map`.

Manual projects are stored in `data/projects.json`; explicitly enrolled discovered projects are stored in `data/discovered-projects.json`. The API uses the effective registry through `src/lib/projects.js`.

## First-run setup

Run these steps from the repository root. `.env` and `data/projects.json` are
**local, untracked configuration**, ignored by Git. A fresh checkout supplies
[`.env.example`](../.env.example) and
[`data/projects.example.json`](../data/projects.example.json), not your local
configuration. Do not commit personal paths or force-add either local file.

### 1. Initialize only missing files

Choose the commands for your shell. Keep any existing configuration; do not
replace it with the examples when updating or re-running setup.

Bash (Linux/WSL):

```bash
cp -n .env.example .env
cp -n data/projects.example.json data/projects.json
```

`-n` prevents overwriting existing destinations.

PowerShell:

```powershell
if (!(Test-Path -LiteralPath .env)) {
  Copy-Item -LiteralPath .env.example -Destination .env
}
if (!(Test-Path -LiteralPath data/projects.json)) {
  Copy-Item -LiteralPath data/projects.example.json -Destination data/projects.json
}
```

Copying the registry example does not create a project directory, discover
projects or assign an ID. Edit only the local copies in the following steps.

### 2. Configure the roots

#### Configure `PROJECTS_ROOT`

For the simplest single-root setup, edit `.env` and replace the example root
with the existing parent directory containing your projects:

```env
PROJECTS_ROOT=/home/user/projects
PORT=8770
DOTNET_VERSION=10.0
```

- **Local Node.js:** use a root accessible to the Node process. Leave
  `PROJECTS_ROOT_CONTAINER` and `PROJECTS_ROOTS` unset for this single-root path.
- **Windows/WSL:** a Windows root such as `C:/Users/Example/Projects` is converted
  to `/mnt/c/Users/Example/Projects` by the Linux runtime. When using the
  PowerShell registration script, `.env`'s `PROJECTS_ROOT` must also be resolvable
  by the PowerShell process: use a Windows path in Windows PowerShell, or a Linux
  path in PowerShell running under WSL/Linux.
- **Docker Compose:** `PROJECTS_ROOT` is the host directory mounted read-only at
  `/projects`. Compose sets `PROJECTS_ROOT_CONTAINER=/projects` inside the
  container. Keep the registry locator relative to that root, not to the host
  filesystem.

Project configuration uses process environment values before `.env` values,
then defaults. Check for existing overrides if changing `.env` has no effect.
`PROJECTS_ROOT_CONTAINER` overrides the single-root runtime location. `PORT` is
different: local `npm start` reads it from the process environment, not `.env`;
Compose uses `.env`'s `PORT` for the host port mapping. The default is `8770`.

For multiple roots, `PROJECTS_ROOTS` must be a JSON array, for example:

```env
PROJECTS_ROOTS=[{"id":"personal","path":"/home/user/projects","writableRegistry":true},{"id":"work","path":"/work/projects","writableRegistry":false}]
```

This replaces the single `default` root; each registry record's `rootId` must
match a configured ID. Use paths accessible to the service runtime. The supplied
Compose file mounts only `PROJECTS_ROOT` and does not pass through
`PROJECTS_ROOTS` or `INTELLIGENCE_REGISTRY_WRITES_ENABLED`; setting those in the
host `.env` alone does not enable them inside the container. Multi-root Docker
setups need explicit mounts and container environment configuration.

This procedure uses the default `<repo>/data` directory. If you configure
`DATA_DIR` for local Node.js, initialize `projects.json` there instead; the
PowerShell scripts still use `<repo>/data/projects.json` and do not honor that
override. Compose explicitly uses `/app/data`, bind-mounted from `./data`.

### 3. Adapt the example project locator

The copied example contains this valid legacy ID-less record:

```json
[
  {
    "name": "example-project",
    "rootId": "default",
    "relativePath": "example-project"
  }
]
```

In your local `data/projects.json`:

- Set `name` to the alias you will use in name-based API URLs; follow the
  [naming rules](#naming-rules).
- Keep `rootId: "default"` for the single-root setup, or change it to an ID
  from `PROJECTS_ROOTS` (for example, `personal`). Omitting it means `default`,
  not the first configured root.
- Set `relativePath` to an existing project subdirectory under that root,
  such as `example-project` or `team/service`. Do not use an absolute path,
  `.` or `..` segments, or a symlink escaping the root.

For the single-root example, `/home/user/projects/example-project` on the host
maps to `/projects/example-project` in Docker; both use
`relativePath: "example-project"`. The directory must already exist. Remove
the placeholder record if it does not represent a project you want to register;
an empty manual registry is `[]`.

### 4. Assign an ID explicitly for Task Context Pack

The example deliberately omits `projectId`. It is valid for legacy listing and
name-based lookup once the locator is configured, but **Task Context Pack
requires a persisted `projectId`**. Reading, listing, discovery and overview do
not generate one. An unassigned project's overview has `project.projectId: null`;
do not add `"projectId": null` to the registry, because an explicit null is invalid.

For the manual example, follow [Add a project with the script](#add-a-project-with-the-script)
below, using the adapted record's name and actual directory. This explicit
registration assigns `prj_<UUID>` to the selected ID-less record and writes it
to `data/projects.json`. Re-registering that record preserves its existing ID;
it does not bulk-migrate other legacy entries.

The script is a single-root, default-data-directory tool. For multi-root or
custom-`DATA_DIR` manual registries, edit the selected record explicitly instead:
generate a fresh opaque UUID-based ID once, persist it as `projectId`, and retain
it on later edits. Follow the [stable identity rules](#stable-project-identity).

For a project managed through discovery instead, use the existing
[explicit discovered-project registration workflow](./SERVICE_REFERENCE.md#explicit-discovered-project-registration).
It is disabled by default and writes only `data/discovered-projects.json`,
assigning IDs to requested new or ID-less discovered records. **It cannot assign
an ID to the copied manual record:** a matching manual entry is skipped as
`already_registered`, without migrating it. Do not use this API as a manual
registry migration command.

### 5. Start and verify

For local Node.js, install the locked dependencies and start the service:

```bash
npm ci
npm start
```

Or, for the supplied single-root Docker setup:

```bash
docker compose up --build
```

In another terminal, check health and the configured project's overview
(replace `example-project` with your alias, and the port if changed):

```bash
curl http://localhost:8770/api/health
curl http://localhost:8770/api/projects
curl http://localhost:8770/api/intelligence/projects/example-project/overview
```

The overview response's `data.project.projectId` must contain the persisted ID
before requesting a pack. Use that exact value, not the project name or locator,
in `POST /api/intelligence/projects/:projectId/task-context`; the request body
requires a task such as `{"task":{"title":"Inspect this project"}}`.
See the [Task Context Pack reference](./SERVICE_REFERENCE.md#task-context-pack)
for its read-only contract and source-retrieval limitations. The server binds
to all interfaces by default; use a trusted local network.

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

## Add a project with the script

After initializing configuration and adapting the locator, use the PowerShell
script on the host. For example, in Windows PowerShell, with
`PROJECTS_ROOT=C:/Users/Example/Projects` in `.env`:

```powershell
.\scripts\add-hermes-project.ps1 -Name "example-project" -Path "C:\Users\Example\Projects\example-project"
```

Or from Bash with PowerShell (`pwsh`) installed on Linux/WSL and
`PROJECTS_ROOT=/home/user/projects` in `.env`:

```bash
pwsh -NoProfile -File ./scripts/add-hermes-project.ps1 -Name "example-project" -Path "/home/user/projects/example-project"
```

Replace the example name and path with your chosen values. Both directories must
exist, and the project must be a subdirectory of `PROJECTS_ROOT`, not the root
itself. The script reads `PROJECTS_ROOT` directly from the repository's `.env`
and writes `data/projects.json`; it does not use `PROJECTS_ROOTS`,
`PROJECTS_ROOT_CONTAINER` or `DATA_DIR`.

Registration matches an existing record by name **or** relative path. If those
select different records, it fails without writing. Otherwise it replaces the
selected record with `projectId`, `name`, `relativePath` and `addedAt`, generating
an ID only if one was absent. It omits `rootId`, which means `default`; do not
use it to update non-default-root records or preserve custom record metadata.

Registration is generic: the analyzer subsequently detects the project type.
After registering, verify the persisted ID through the overview in
[Start and verify](#5-start-and-verify).

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

Registry files are read on request from the bind-mounted `./data` directory;
editing `data/projects.json` does not require rebuilding the image. To restart
the running service if needed:

```bash
docker compose restart
```

After changing `.env` values used by Compose (such as `PROJECTS_ROOT` or `PORT`),
recreate the container to apply the new mount or port mapping; `restart` alone
does not apply changed Compose configuration:

```bash
docker compose up -d --force-recreate
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
- the container was not recreated after changing `.env`'s `PROJECTS_ROOT`.

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
