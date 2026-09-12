# Hermes Project Map

A project map for exploring structure, symbols, and dependencies through a local API and a web UI.

The project provides an incremental foundation for supporting multiple project types while preserving `.NET` support and adding an initial TypeScript analyzer.

## Documentation

- [Adding projects](./docs/adding-projects.md)
- [Analyzer implementation](./docs/analyzers-implementation.md)
- [Analyzer execution and troubleshooting](./docs/analyzers-execution.md)
- [Hermes tool integration](./docs/hermes-tool-integration.md)
- [Hermes plugin installation for profiles](./docs/hermes-plugin-installation.md)

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

## Project Intelligence foundation

Phase 0 adds the shared foundation for future Project Intelligence features without adding discovery or new HTTP routes yet.

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

Future writes to the machine-managed discovered registry use an atomic helper that writes a complete sibling temporary file, fsyncs it, closes it, and renames it over `data/discovered-projects.json`. That helper is intentionally scoped to `discovered-projects.json` and never writes `data/projects.json`.

The service currently assumes localhost or trusted-network operation. Registry mutation endpoints are not implemented yet; if they are added later, they should be gated appropriately before exposure beyond a trusted environment.

Implemented in Phase 0: central configuration, safe root/path helpers, split manual/discovered/effective registry ownership, effective registry consumption by existing project lookup, and atomic discovered-registry persistence. Not yet implemented: automatic project discovery, Project Intelligence HTTP endpoints, project overview, ICM, task context, task routing, impact v2, high-level Hermes `project_*` tools, or the future Hermes Agent OS.

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
