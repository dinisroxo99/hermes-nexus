# Service reference

[Home](../README.md) · [Documentation](README.md) · [Current status](CURRENT_STATUS.md)

Operational and API details moved from the original README. This reference
covers the service at base commit `be0cb2c`; it is not a specification of the
full target coordination system. See [Current status](CURRENT_STATUS.md) for
implementation boundaries: Steps 1, 2 and 2.5 are complete; Impact v2 is not started.

Use the [canonical Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md)
for task-context inputs, limits and limitations, and the
[identity contract](project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md)
for persisted IDs and revision evidence. The language-support table below
covers the legacy project-type analyzer dispatch; it does not promise complete
mixed-language or semantic analysis.

The server listens on `0.0.0.0` by default. Use a trusted local network or
appropriate network isolation; these quick starts are not a public deployment
security configuration.

## What it does

- Lists projects from the effective runtime registry: human-managed `data/projects.json` plus optional machine-managed `data/discovered-projects.json`.
- Analyzes `.NET` projects using the existing analyzer based on `symbol-index.js`.
- Analyzes TypeScript/React/Next.js projects with initial support based on `ts-morph`.
- Exposes endpoints to:
  - list projects;
  - inspect project structure;
  - search symbols;
  - expand dependencies and references;
  - retrieve the full graph.
- Serves a static web UI from `src/public`.

## Current support

| Type | Status | Notes |
|---|---|---|
| `.NET` | Native structural | Preserves the previous path through a wrapper and fallback to `symbol-index.js`. Not compiler-grade semantics. |
| `TypeScript` / `React` / `Next.js` | Native structural | Extracts files, exports, components, hooks, providers, interfaces/types, and basic internal imports. |
| `Node.js` | Detected project type | No dedicated full project-type analyzer; bounded JavaScript/JSX snapshots use the native TypeScript provider. |
| `Python` | Detected | Detected, but no dedicated analyzer yet. |

For bounded Context Packs, the provider layer also observes Python/Go/Rust/Java
languages and Bash/PowerShell text without supplying native semantic analysis.
See the [capability matrix](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md#languagecapability-matrix).

## Main structure

```txt
src/
  server.js                         # HTTP entry point
  routes/                           # API routes
  lib/
    analyzer-service.js             # multi-analyzer dispatcher
    project-config.js               # DATA_DIR and project-root configuration
    project-roots.js                # trusted root normalization and relative-path safety
    project-registry.js             # manual/discovered/effective registry helpers
    agent-manifest.js               # canonical AGENT.md schema v1 parser
    workspace-index.js              # canonical workspace index from AGENT.md manifests
    icm-documents.js                # contextual ICM document index
    icm-index.js                    # combined Project ICM Index
    projects.js                     # existing project listing/lookup API over the effective registry
    symbol-index.js                 # existing .NET analyzer
  analyzers/
    common/analyzer-detection.js    # project-type detection
    dotnet/dotnet-analyzer.js       # .NET wrapper
    typescript/typescript-analyzer.js
  public/                           # web UI
scripts/
  add-hermes-project.ps1
  list-hermes-projects.ps1
  remove-hermes-project.ps1
data/
  projects.json                     # human-managed legacy/manual registry
  discovered-projects.json          # machine-managed registry; absent is valid
```

## Local quick start

Run commands from the repository root. Complete the
[first-run setup](adding-projects.md#first-run-setup): initialize local, untracked
`.env` and `data/projects.json` without overwriting existing files, configure
roots and the project locator, and explicitly assign an ID if using Task Context
Pack. Install locked dependencies:

```bash
npm ci
```

Validate syntax:

```bash
npm run check
```

Run tests:

```bash
npm test
```

Start the server:

```bash
npm start
```

By default, the server runs at:

```txt
http://localhost:8770
```

Health check:

```bash
curl http://localhost:8770/api/health
```

## Docker quick start

Complete the [first-run setup](adding-projects.md#first-run-setup) for both local
configuration files, using the Docker root mapping described there. Do not
overwrite an existing `.env` or manual registry with the examples.

Start with a rebuild:

```bash
docker compose up --build
```

The `PROJECTS_ROOT` folder is mounted inside the container at `/projects`.

## Project Intelligence API

Project Intelligence endpoints are bounded, agent-oriented contracts for Hermes and other HTTP clients. Discovery ordering remains deterministic; live revision timestamps are explicit. These routes remain separate from the existing UI/specialist graph endpoints. Legacy ID-less records remain supported, while ambiguous names and unsafe locations now fail rather than resolving a different project.

Currently implemented:

```txt
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
POST /api/intelligence/projects/:projectId/task-context
```

Implemented ICM support is on-demand and bounded: a canonical `AGENT.md` parser, Workspace Index, contextual ICM Document Index, combined Project ICM Index, compact overview ICM summary, and revision-aware Task Context Pack. Not implemented yet: task routing, impact v2, Hermes high-level `project_*` tools, and Hermes guard integration.

### Task Context Pack

`POST /api/intelligence/projects/:projectId/task-context` accepts a task with a
required title and optional relative paths/symbol names, limits, bounded excerpts
and verified worktree locator. It is read-only and requires a persisted projectId;
it neither assigns IDs nor owns task execution. The deterministic, versioned pack
includes current Git/worktree evidence, matched ICM declarations, relevant file/
symbol/reference/test candidates, canonical document references and provenance.
No full files/graphs are returned by default and no Context Pack cache is used.

Source retrieval currently requires Linux/WSL `/proc/self/fd` descriptor
verification and fails closed elsewhere. Dirty/unavailable revisions remain
explicit, and observed changes during construction reject the pack. See the
[implemented contract](./project-intelligence/04_ICM_AND_CONTEXT_PACK.md)
for input/output limits, trust labels, HTTP errors and remaining limitations.

### Analyzer providers

Step 2.5 is complete. Task Context Packs consume normalized AnalyzerProvider
evidence from the retained native .NET and TypeScript/JavaScript analyzers.
Provider/version/capability/language metadata, deterministic selection/fallback,
snapshot binding and explicit partial coverage are part of that contract.
Missing section operations are `not_analyzed`, not evidence of an empty graph.

The external boundary validates bounded, snapshot-scoped JSON data; it does not
execute tools, launch LSP servers or provide a sandbox for arbitrary plugins.
Descriptors and response maps are supplied through trusted server-side options,
not fields accepted from a task-context HTTP body. JSON evidence remains
untrusted. Legacy UI/graph APIs and cache ownership
remain unchanged. There is no new public provider-execution endpoint.

Serena/Pyright runtime integration is **proposed only**, not installed or enabled
by the provider layer. See the [exact contract and approval proposal](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md).

### Canonical Project ICM

Project ICM separates machine-authoritative workspace contracts from contextual project knowledge:

- `AGENT.md` YAML front matter is the canonical machine-readable workspace execution contract.
- `AGENT.md` Markdown body is context only.
- `PROJECT.md`, `AGENTS.md`, `CONTEXT.md`, and ADR Markdown are context only.

Contextual prose cannot override executor, owner, reviewers, permissions, scope, preconditions, or routing metadata. The service can describe those fields but does not enforce them; planned Hermes-side policy enforcement remains responsible for ALLOW/DENY/REROUTE decisions.

The combined Project ICM Index composes the Workspace Index and contextual document index in memory. It does not write a persistent ICM cache/index and does not expose a dedicated ICM HTTP endpoint. See [Project ICM architecture](./project-icm.md) for schema, bounds, and validity semantics.

### Discovery dry run

`GET /api/intelligence/discover` scans configured roots without mutating registry files. It is multi-root, boundary-aware, and hides configured absolute root paths by default.

Query parameters:

- `maxDepth`: default `3`, clamped to `1..6`.
- `limit`: default `100`, clamped to `1..500`; applied globally across all roots.
- `includeRegistered=true`: includes effective-registry matches; absent or any other value excludes them.

Results are ordered by configured root order, then candidate `relativePath`. `truncated` is true only when an additional returnable candidate exists beyond the global limit. Root problems are returned as structured warnings bounded to `20`, such as `{ "code": "root_missing", "rootId": "default" }`. Registered matching uses `rootId + relativePath`, with same-root name compatibility for legacy entries.

Linked worktree candidates additionally expose `isLinkedWorktree` and `parentProjectId` (null when unresolved). A verified parent makes the worktree registered without assigning another projectId. Inaccessible Git-file metadata is marked `identityStatus: "unavailable"`; discovery never invents a parent or persists an ID.

### Explicit discovered-project registration

`POST /api/intelligence/discover/register` writes only machine-managed discovery state and is disabled by default. Enable it explicitly with:

```env
INTELLIGENCE_REGISTRY_WRITES_ENABLED=true
```

Accepted true values are exactly `true`, `1`, and `yes` after trimming and lowercasing; all other values are false.

Request body is bounded JSON, max `64 KiB`, with at most `100` requested projects:

```json
{
  "projects": [
    {
      "rootId": "default",
      "relativePath": "sample-service"
    }
  ]
}
```

The client supplies candidate identity only. The server re-runs current discovery from configured roots, validates requested identities against current candidates, and persists server-derived metadata. Unknown or stale candidates are rejected. Repeated registration is idempotent/update-oriented. Manual `data/projects.json` is never written; machine state is persisted atomically to `data/discovered-projects.json`.

Explicit enrollment assigns `prj_<UUID>` to requested new/ID-less discovered records and preserves existing IDs. Per-result projectId is additive when known. Client projectId/parentProjectId/Git fields are ignored. A verified linked worktree returns `already_registered` with its parent ID and no second registry record. Unresolved worktrees reject the entire batch with `worktree_parent_unresolved` before a write. Identity conflicts return 409; malformed explicit persisted IDs return 400.

### Bounded project overview

`GET /api/intelligence/projects/:name/overview` returns a compact high-level summary for registered manual or discovered projects. It uses root IDs and relative paths by default and does not expose `absolutePath`.

The schemaVersion remains 1. `project.projectId` is the persisted opaque ID, or null for an unassigned legacy record. The additive `revision` block contains `status` (available/unborn/not_git/unavailable), `commitSha`, `branch`, `dirty`, `repositoryIdentity`, `worktreeId`, `isLinkedWorktree` and `capturedAt`. Unknown evidence is null; detached HEAD has no branch. Local repository/worktree evidence can change after relocation and is not a durable projectId. No raw Git metadata paths or remote URLs are returned.

Ambiguous name/identity lookup returns 409 in the existing error envelope. Internal by-ID/worktree resolution is available. There is no standalone public project-by-ID lookup or worktree-resolution endpoint; the task-context POST above accepts a persisted ID and optional verified worktree locator.

Returned categories:

- project identity, project type/support, and registry source;
- stack languages, frameworks, package manager, runtime, and scripts;
- architecture layers, features, entry points, and test commands;
- source/graph statistics;
- compact ICM availability/health/count metadata;
- analysis cache state and analyzer capabilities;
- bounded warnings.

Bounds: `scripts <= 50`, `frameworks <= 20`, `layers <= 20`, `features <= 20`, `entryPoints <= 20`, `testCommands <= 20`, `warnings <= 20`. `graphLimit` defaults to `20` and is clamped to `1..100`.

The overview `icm` field contains only:

```json
{
  "status": "available",
  "valid": true,
  "workspaceCount": 1,
  "documentCount": 3,
  "errorCount": 0,
  "warningCount": 0,
  "truncated": {
    "workspaces": false,
    "documents": false
  }
}
```

`status` is `not_configured` for a valid empty ICM index, `available` for valid ICM with workspace/document content or bounded issues/truncation, and `invalid` when the machine-authoritative Project ICM Index is invalid. Overview ICM bounds are `maxWorkspaces: 50`, `maxDocuments: 100`, scan depth `8`, with `includeInstructions: false` and `includeContent: false`.

Project Overview deliberately does not return `AGENT.md` Markdown instructions, contextual document content, executor IDs, owner/reviewer identities, routing maps, permission contracts, or scope patterns.

Package-manager precedence is: `package.json.packageManager`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lock`/`bun.lockb`, `package.json` without evidence as `"unknown"`, and no package metadata as `null`.

Overview does not trigger a full analyzer/index run. It uses current structure/cache information. If no analysis exists, `analysis.status` is `"not_analyzed"` and `statistics.nodeCount`/`edgeCount` are `null`. If an analyzed cached graph exists and contains zero nodes or edges, those values are `0`.

Freshness requires exact project/revision/worktree cache identity. Dirty, unborn or Git-unavailable requests bypass both existing caches; overview does not label those graphs fresh. Confirmed non-Git inputs retain compatibility caching without Git freshness guarantees. Git reads have per-command time/output bounds, not a global discovery deadline or an immutable filesystem snapshot guarantee.

### Project root configuration

Configuration is resolved in this order:

```txt
process.env → .env → repository defaults
```

Supported compatibility variables:

- `DATA_DIR`: registry and index data directory; default is `<repo>/data`.
- `PROJECTS_ROOT_CONTAINER`: runtime path used by existing project lookup, commonly `/projects` in Docker.
- `PROJECTS_ROOT`: legacy host/project root; Windows paths can be converted to WSL-style paths when used as trusted configured roots.

Canonical multi-root configuration uses `PROJECTS_ROOTS` as a JSON array only. Do not use delimiter-separated path strings.

```env
PROJECTS_ROOTS=[{"id":"personal","path":"/home/user/projects","writableRegistry":true},{"id":"work","path":"/work/projects","writableRegistry":false}]
```

### Registry ownership

- `data/projects.json` is the human-managed legacy/manual registry. Existing array entries with `name`, `relativePath`, and optional metadata remain valid.
- `data/discovered-projects.json` contains explicitly registered machine-managed discovery state. Its absence is valid and does not cause an error.
- The effective runtime registry is `manual + discovered`; manual entries retain same-root legacy name/path precedence. Equal names across roots are not collapsed. Conflicting explicit IDs are errors, not silent reassignment.

Runtime normalization may add fields such as `registrySource` and default `rootId` in memory, but it does not rewrite `data/projects.json`. Persisted machine-managed discovered entries use `source: "discovered"`; runtime-only `registrySource` is not persisted.

Both registries accept optional opaque projectIds. Same-location manual overlays may retain a persisted discovered ID in memory. Move/rename a project by updating its existing record while preserving its ID; separate clones/forks remain separate registrations. IDs are never derived from location, name, HEAD or remote. See [identity and migration boundaries](./project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md).

### Path safety and persistence

Trusted configured roots and untrusted project-relative paths are validated separately. Trusted roots may be absolute POSIX paths such as `/home/user/projects` or `/projects`, and trusted Windows roots such as `C:\Users\Example\Projects` may normalize to `/mnt/c/Users/Example/Projects` on Linux/WSL. Untrusted project-relative paths reject traversal and absolute forms such as `../secret`, `/absolute`, `C:\secret`, `C:/secret`, and UNC paths.

Machine-managed discovered registry writes use an atomic helper that writes a complete sibling temporary file, fsyncs it, closes it, and renames it over `data/discovered-projects.json`. That helper is intentionally scoped to `discovered-projects.json` and never writes `data/projects.json`.

## Adding projects

See the full guide:

- [docs/adding-projects.md](./adding-projects.md)

PowerShell example:

```powershell
.\scripts\add-hermes-project.ps1 -Name "faturas-backend" -Path "C:\Users\aiino\Documents\Faturas"
```

Project registration is generic. The actual project type is detected by the analyzer.

## Main endpoints

### Health

```txt
GET /api/health
```

### Projects

```txt
GET /api/projects
GET /api/projects/:name
GET /api/projects/:name/structure
```

### Exploration

```txt
GET /api/explore/:project/search?q=...
GET /api/explore/:project/expand?nodeId=...&direction=both|in|out
GET /api/explore/:project/full?nodeLimit=500&edgeLimit=1200
GET /api/explore/:project/impact?nodeId=...&depth=2
GET /api/explore/:project/context?symbol=...&depth=1
GET /api/explore/:project/insights?limit=20
```

The impact, context, and insights endpoints return bounded graph intelligence for Hermes agents and UI workflows.
TypeScript analysis now resolves default imports, named re-exports/barrel files, and simple `tsconfig.paths` aliases.

### Indexing and cache

```txt
POST /api/index/:project
GET /api/cache/symbols
DELETE /api/cache/symbols
```

Cache stats include the legacy .NET symbol-index cache and the shared analyzer analysis cache.

## Usage examples

Search for a `.NET` symbol:

```bash
curl "http://localhost:8770/api/explore/faturas-backend/search?q=InvoiceCreationService"
```

Search for a TypeScript symbol:

```bash
curl "http://localhost:8770/api/explore/site-next/search?q=Provider"
```

Retrieve the full graph:

```bash
curl "http://localhost:8770/api/explore/faturas-backend/full?nodeLimit=500&edgeLimit=1200"
```

## Development

Available npm commands:

```bash
npm run check
npm test
npm start
```

When changing ESM imports, also validate the import path directly:

```bash
node -e "import('./src/lib/analyzer-service.js').then(()=>console.log('import ok')).catch(e=>{console.error(e); process.exit(1)})"
```

## Troubleshooting

### `ERR_MODULE_NOT_FOUND`

Check relative imports. Example of correct imports from `src/lib/analyzer-service.js`:

```js
../analyzers/common/analyzer-detection.js
../analyzers/dotnet/dotnet-analyzer.js
../analyzers/typescript/typescript-analyzer.js
```

More details:

- [Analyzer execution and troubleshooting](./analyzers-execution.md)

### New Docker dependencies

If npm dependencies were added, rebuild the container:

```bash
docker compose up --build
```
