# Hermes Project Map

A project map for exploring structure, symbols, and dependencies through a local API and a web UI.

The project provides an incremental foundation for supporting multiple project types while preserving `.NET` support and adding an initial TypeScript analyzer.

## Documentation

- [Adding projects](./docs/adding-projects.md)
- [Analyzer implementation](./docs/analyzers-implementation.md)
- [Analyzer execution and troubleshooting](./docs/analyzers-execution.md)
- [Hermes tool integration](./docs/hermes-tool-integration.md)
- [Hermes plugin installation for profiles](./docs/hermes-plugin-installation.md)
- [Project ICM architecture](./docs/project-icm.md)

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
| `.NET` | Supported | Preserves the previous path through a wrapper and fallback to `symbol-index.js`. |
| `TypeScript` / `React` / `Next.js` | Initial | Extracts files, exports, components, hooks, providers, interfaces/types, and basic internal imports. |
| `Node.js` | Detected | Detected, but no dedicated full analyzer yet. |
| `Python` | Detected | Detected, but no dedicated analyzer yet. |

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
  discovered-projects.json          # future machine-managed registry; absent is valid
```

## Local quick start

Install dependencies:

```bash
npm install
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

Create `.env`:

```powershell
copy .env.example .env
```

Example:

```env
PROJECTS_ROOT=/home/user/projects
PORT=8770
DOTNET_VERSION=10.0
```

Start with a rebuild:

```bash
docker compose up --build
```

The `PROJECTS_ROOT` folder is mounted inside the container at `/projects`.

## Project Intelligence API

Project Intelligence endpoints are bounded, deterministic, agent-oriented contracts for Hermes and future orchestrators. They are separate from the existing UI/specialist graph endpoints and do not change `/api/projects` or `/api/explore` payloads.

Currently implemented:

```txt
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
```

Implemented ICM support is on-demand and bounded: a canonical `AGENT.md` parser, Workspace Index, contextual ICM Document Index, combined Project ICM Index, and compact overview ICM summary. Not implemented yet: task context, task routing, impact v2, Hermes high-level `project_*` tools, and Hermes Agent OS orchestration.

### Canonical Project ICM

Project ICM separates machine-authoritative workspace contracts from contextual project knowledge:

- `AGENT.md` YAML front matter is the canonical machine-readable workspace execution contract.
- `AGENT.md` Markdown body is context only.
- `PROJECT.md`, `AGENTS.md`, `CONTEXT.md`, and ADR Markdown are context only.

Contextual prose cannot override executor, owner, reviewers, permissions, scope, preconditions, or routing metadata. The service can describe those fields but does not enforce them; future Hermes Agent OS policy enforcement remains responsible for ALLOW/DENY/REROUTE decisions.

The combined Project ICM Index composes the Workspace Index and contextual document index in memory. It does not write a persistent ICM cache/index and does not expose a dedicated ICM HTTP endpoint. See [Project ICM architecture](./docs/project-icm.md) for schema, bounds, and validity semantics.

### Discovery dry run

`GET /api/intelligence/discover` scans configured roots without mutating registry files. It is multi-root, boundary-aware, and hides configured absolute root paths by default.

Query parameters:

- `maxDepth`: default `3`, clamped to `1..6`.
- `limit`: default `100`, clamped to `1..500`; applied globally across all roots.
- `includeRegistered=true`: includes effective-registry matches; absent or any other value excludes them.

Results are ordered by configured root order, then candidate `relativePath`. `truncated` is true only when an additional returnable candidate exists beyond the global limit. Root problems are returned as structured warnings bounded to `20`, such as `{ "code": "root_missing", "rootId": "default" }`. Registered matching uses `rootId + relativePath`, with same-root name compatibility for legacy entries.

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

### Bounded project overview

`GET /api/intelligence/projects/:name/overview` returns a compact high-level summary for registered manual or discovered projects. It uses root IDs and relative paths by default and does not expose `absolutePath`.

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

### Phase status

Completed:

- Phase 0: centralized config, safe roots/path handling, registry ownership, atomic discovered-registry persistence.
- Phase 1: boundary classification, bounded deterministic discovery, discovery dry-run HTTP API, explicit guarded registration, bounded project overview.
- Phase 2: canonical `AGENT.md` parser, Workspace Index, contextual ICM Document Index, combined Project ICM Index, compact overview ICM summary.

Next:

- Phase 3: bounded Task Context / `project_task_context` functionality that uses the Project ICM Index to select bounded relevant context for a task.

Future:

- task routing, impact v2, Hermes high-level tools, and Hermes Agent OS / Policy Engine.

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
- `data/discovered-projects.json` is reserved for future machine-managed discovery state. Its absence is valid and does not cause an error.
- The effective runtime registry is `manual + discovered`; manual entries win on project-name conflicts and on `rootId + relativePath` conflicts.

Runtime normalization may add fields such as `registrySource` and default `rootId` in memory, but it does not rewrite `data/projects.json`. Persisted machine-managed discovered entries use `source: "discovered"`; runtime-only `registrySource` is not persisted.

### Path safety and persistence

Trusted configured roots and untrusted project-relative paths are validated separately. Trusted roots may be absolute POSIX paths such as `/home/user/projects` or `/projects`, and trusted Windows roots such as `C:\Users\Example\Projects` may normalize to `/mnt/c/Users/Example/Projects` on Linux/WSL. Untrusted project-relative paths reject traversal and absolute forms such as `../secret`, `/absolute`, `C:\secret`, `C:/secret`, and UNC paths.

Machine-managed discovered registry writes use an atomic helper that writes a complete sibling temporary file, fsyncs it, closes it, and renames it over `data/discovered-projects.json`. That helper is intentionally scoped to `discovered-projects.json` and never writes `data/projects.json`.

## Adding projects

See the full guide:

- [docs/adding-projects.md](./docs/adding-projects.md)

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

- [Analyzer execution and troubleshooting](./docs/analyzers-execution.md)

### New Docker dependencies

If npm dependencies were added, rebuild the container:

```bash
docker compose up --build
```

## Short-term roadmap

- Deepen TypeScript references without turning the analyzer into a language server.
- Add dedicated analyzers for other detected project types only when the value justifies the scope.
- Create a Hermes tool or plugin that consumes the impact/context API directly.

## Navigation

- [Adding projects](./docs/adding-projects.md)
- [Analyzer implementation](./docs/analyzers-implementation.md)
- [Analyzer execution and troubleshooting](./docs/analyzers-execution.md)
- [Hermes tool integration](./docs/hermes-tool-integration.md)
- [Hermes plugin installation for profiles](./docs/hermes-plugin-installation.md)
- [Project ICM architecture](./docs/project-icm.md)
