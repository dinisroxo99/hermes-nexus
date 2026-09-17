# Evolve `hermes-project-map` into the Project Intelligence Service

## Goal

Make `hermes-project-map` the deterministic, bounded, HTTP-based Project Intelligence Service that Hermes agents and the future Global Orchestrator use before inspecting repositories directly.

## Current context / assumptions

- Repository root: `/home/dinis/projects/hermes-project-map`.
- Branch inspected: `feat/project-intelligence-service`.
- Current tests verified with `npm test`: `28` tests passing, `0` failing.
- Current syntax check verified with `npm run check`: exits `0`.
- Current project size excluding `.git`, `node_modules`, `.hermes`: `54` files, `10310` text lines.
- Runtime is Node ESM with no framework dependency; routing uses `src/utils/router.js` over `node:http`.
- The service is already independent HTTP infrastructure. Keep it independent; do not move project analysis into Hermes core.
- `project-map-main` in `AGENTS.md` is a Hermes profile/role for maintaining this repository. It is **not** the future Global Orchestrator.
- The production code owner rule from `AGENTS.md` applies: agents may plan, review, document, test, and comment. Implementation requires explicit follow-up permission.

## Architecture / proposed approach

Evolve the service vertically, not by rewrite: keep existing low-level graph/search endpoints, add a higher-level `intelligence` layer that composes discovery, registry, structure, graph intelligence, ICM metadata, routing, and impact. Make all new outputs bounded by explicit defaults and maximums, deterministic by default, and testable with temporary fixture projects. Hermes should expose thin tools that call these high-level HTTP endpoints and should not duplicate analyzers or repository walking logic.

### Surgical revision — 2026-09-12

This revision intentionally keeps the original assessment, endpoint inventory, analyzer analysis,
test baseline, HTTP-service boundary, bounded-response strategy, and most of the detailed
RED/GREEN/micro-commit plan.

The changes are deliberately surgical:

1. add a Phase 0 before discovery;
2. centralize project-root/environment configuration;
3. use JSON as the canonical multi-root format;
4. separate human/manual registry state from machine-discovered registry state;
5. use atomic writes only for machine-managed discovery state;
6. make discovery understand repository/project/module/workspace boundaries;
7. separate discovery scanning from explicit registration;
8. hide configured absolute root paths from high-level responses by default;
9. distinguish unknown analysis values from real zero values;
10. detect package managers from metadata/lockfiles rather than assuming npm;
11. define the canonical ICM contract now, while implementing it later;
12. explicitly separate Project Intelligence routing resolution from Hermes OS enforcement;
13. reorder later phases so ICM exists before task routing.

All test examples added by this revision must use temporary fixture directories or neutral sample
projects. They must not depend on old machines or previously available projects such as SampleDotnetSolution.


---

## 1. Current architecture assessment

### Existing runtime shape

- `src/server.js`
  - Creates `node:http` server.
  - Registers API routes manually through `createRouter()`.
  - Serves static UI from `src/public`.
  - Current API groups:
    - health/projects: `src/routes/projects.routes.js`
    - graph exploration: `src/routes/explore.routes.js`
    - indexing: `src/routes/index.routes.js`
    - cache stats/clear: `src/routes/cache.routes.js`

- `src/utils/router.js`
  - Minimal exact/parameterized router.
  - No middleware stack, no body parsing, no framework dependency.

- `src/utils/response.js`
  - Consistent envelope: `{ ok: true, data, message }` / `{ ok: false, error, message }`.
  - UI unwraps this envelope in `src/public/api-client.js` while preserving old raw payload compatibility.

- `src/utils/validation.js`
  - Validates project names, node ids, search queries, and numeric limits.
  - Contains `isPathSafe()` but it currently assumes `/` separators after normalization.

### Registry and project resolution

- `data/projects.json`
  - Current shape is a legacy array:
    ```json
    [
      { "name": "sample-dotnet-solution", "relativePath": "SampleDotnetSolution", "addedAt": "2026-07-08T09:55:00" },
      { "name": "sample-ts-monorepo", "relativePath": "sample-ts-monorepo", "addedAt": "2026-07-08T09:47:39" }
    ]
    ```

- `src/lib/projects.js`
  - Reads `.env` manually for `DATA_DIR`, `PROJECTS_ROOT`, and `PROJECTS_ROOT_CONTAINER`.
  - Computes absolute paths as `PROJECTS_ROOT_CONTAINER + relativePath`.
  - Supports Windows host path conversion to WSL paths.
  - `getProjectByName(name)` throws if registry entry is absent or if the computed folder does not exist.
  - `listProjectSummaries()` detects type and counts files on demand.

### Analyzer architecture

- `src/analyzers/common/analyzer-detection.js`
  - Detects `dotnet`, `typescript`, `nodejs`, `python`, or `unknown` from files in/near the root.
  - Only `dotnet` and `typescript` are supported analyzers.

- `src/analyzers/common/analyzer-registry.js`
  - Registers analyzers in a process-local map.
  - Resolves analyzer by calling `detectProjectType(project.absolutePath)`.

- `src/lib/analyzer-service.js`
  - Facade used by routes.
  - Provides `analyzeProject`, `searchSymbols`, `expandNode`, `getFullGraph`, `getAnalysisGraph`, `getImpact`, `getSymbolContext`, and `getProjectInsights`.
  - Composes `src/lib/graph-intelligence.js` for agent-oriented impact/context/insights.

### .NET analyzer

- `src/analyzers/dotnet/dotnet-analyzer.js`
  - Thin wrapper around `src/lib/symbol-index.js`.
  - Preserves `.NET` search, expand, and full graph behavior.

- `src/lib/symbol-index.js`
  - Legacy .NET symbol index.
  - Extracts C# class/interface/record/struct/enum symbols.
  - Infers layer and feature with `src/lib/project-structure.js`.
  - Builds `uses` and `references` edges from constructors, readonly fields, `new`, and identifier matching.
  - Provides node-based graph, search, expand, full graph, cache.

### TypeScript analyzer

- `src/analyzers/typescript/typescript-analyzer.js`
  - Uses `ts-morph`.
  - Extracts classes, functions, interfaces, type aliases, CapitalCase components, hooks, providers, named/default exports.
  - Resolves relative imports, default imports, simple re-exports/barrels, and simple `tsconfig.paths` aliases.
  - Creates compatible graph nodes and `imports` edges.
  - Bounded by `nodeLimit` and `edgeLimit`.

### Structure and graph intelligence

- `src/lib/project-structure.js`
  - Produces `.NET` solution/project/layer/feature summary.
  - Produces TypeScript layer/feature summary.
  - Provides shared layer/feature inference.

- `src/lib/graph-intelligence.js`
  - `analyzeImpact(graph, nodeId, options)` returns direct dependencies, dependents, transitive dependents, affected files, and an impact score.
  - `buildContext(graph, options)` returns compact symbol context.
  - `buildProjectInsights(graph, options)` returns counts, hubs, simple cycles, orphan symbols, and largest modules.

### Caching and indexing

- `src/lib/analysis-cache.js`
  - In-memory TTL cache keyed by project name, type, and absolute path.
  - Invalidates by project name.
  - Uses file count and newest mtime signature over analyzer extensions.

- `src/lib/indexer.js`
  - Runs `dotnet restore` and `scip-dotnet index` in a temp copy.
  - Writes `index.scip` under `DATA_DIR/indexes/<project>`.
  - This is currently `.NET` oriented and uses shell commands inside Docker-like `/app` assumptions.

### Documentation and Hermes integration

- `README.md`
  - Describes current service, endpoints, analyzers, UI, Docker, short-term roadmap.

- `docs/hermes-tool-integration.md`
  - Recommends thin Hermes tool/plugin over HTTP.
  - Current suggested tools are low-level `project_map_*` names.

- `docs/hermes-plugin-installation.md`
  - Contains a complete local Hermes plugin example with tools:
    - `project_map_health`
    - `project_map_projects`
    - `project_map_structure`
    - `project_map_search`
    - `project_map_expand`
    - `project_map_full_graph`
    - `project_map_index`
    - `project_map_cache_stats`
    - `project_map_clear_cache`
  - The plugin calls HTTP endpoints and does not reimplement analysis.

### UI

- `src/public/index.html`, `src/public/app.js`, `src/public/style.css`
  - Static graph explorer UI.
  - Supports project selection, symbol search, node expansion, bounded full graph, insights, 2D Cytoscape, 3D force graph, categories, layers, and features.

---

## 2. Existing strengths worth preserving

1. **Independent HTTP service boundary**
   - Already decoupled from Hermes internals and UI.
   - Keep as the source of truth for project intelligence.

2. **Small dependency surface**
   - No Express/Fastify dependency.
   - Node built-ins + `ts-morph`/`typescript` for analysis.

3. **Stable response envelope**
   - `{ ok, data, error, message }` is simple and tool-friendly.

4. **Analyzer registry pattern**
   - Existing dispatch makes adding analyzers possible without rewriting routes.

5. **Backwards-compatible `.NET` wrapper**
   - `dotnet-analyzer.js` keeps legacy `.NET` functionality intact.

6. **Bounded graph endpoints already exist**
   - `nodeLimit`, `edgeLimit`, `depth`, and `limit` provide a foundation for LLM-safe payloads.

7. **Tests cover core behavior**
   - Current 28 tests cover route matching, validation, envelopes, structure, analyzer dispatch, TypeScript import resolution, graph metadata, and agent-oriented impact/context/insights.

8. **Hermes plugin docs already choose the right integration direction**
   - Thin HTTP plugin is documented and avoids duplicate analysis logic.

---

## 3. Gaps

### Product gaps

- No automatic project discovery from configured roots.
- No server-side project registration API; registration currently happens by PowerShell scripts or manual JSON edits.
- No high-level project overview endpoint for agents.
- No natural-language task context endpoint.
- No ICM ingestion for `PROJECT.md`, `AGENTS.md`, `AGENT.md`, `CONTEXT.md`, ADRs, workspaces, owners, executor agents, reviewers, routing, or preconditions.
- No task routing contract.
- Impact only starts from one graph node id; no file, multi-file, or git diff impact yet.
- No explicit security model for multiple configured roots and path access.
- Hermes tool names in docs are low-level graph-map names, not the future Orchestrator-facing Project Intelligence contract.

### Architecture gaps

- `src/lib/projects.js` mixes `.env` parsing, registry reading, path conversion, summary generation, and project lookup.
- Registry shape has no `source`, `rootId`, `discoveredAt`, `lastSeenAt`, `manual` preservation marker, `metadata`, or freshness fields.
- Analyzer outputs are graph-compatible but not rich enough for task-context ranking without additional file index metadata.
- `analysis-cache.js` is process-memory only; no durable freshness metadata beyond current cache stats.
- Discovery needs robust root parsing and safe relative-path checks before any writes.
- Routes have no request body parser yet; POST endpoints currently do not need JSON bodies.
- Documentation has stale test count in `docs/analyzers-execution.md` (`15/15`) while current verified count is 28.

### Testing gaps

- No tests for registry write/preserve behavior.
- No tests for discovery scanning.
- No tests for overview output bounds.
- No route tests for HTTP handlers beyond the router utility.
- No integration tests for the documented Hermes plugin contracts.

---

## 4. Target architecture

```txt
Hermes Agent / Global Orchestrator / Specialist Agents
  └─ thin Hermes tools or MCP client
      └─ HTTP calls to hermes-project-map
          ├─ high-level Project Intelligence API
          │   ├─ discovery
          │   ├─ overview
          │   ├─ task context
          │   ├─ routing
          │   ├─ impact
          │   └─ refresh/freshness
          ├─ low-level graph/search API (existing /api/explore/*)
          ├─ analyzer registry
          │   ├─ .NET analyzer
          │   ├─ TypeScript analyzer
          │   └─ future analyzers
          ├─ project registry + root access policy
          ├─ ICM metadata index
          └─ bounded response builders
```

Target rule: the Orchestrator asks this service first. Specialist agents may still use low-level graph/search endpoints when they need details, but ordinary task setup should use `project_overview`, `project_task_context`, `project_route_task`, and `project_impact`.

---

## 5. Component responsibilities

### `src/lib/project-config.js` — new/extracted in Phase 0

- Centralize the repository's existing `.env` / `process.env` resolution instead of introducing a second configuration path.
- Preserve current single-root compatibility:
  - `PROJECTS_ROOT_CONTAINER`
  - `PROJECTS_ROOT`
  - `DATA_DIR`
- Add canonical multi-root configuration:
  - `PROJECTS_ROOTS` as a **JSON array only**.
- Do not make delimiter-separated roots canonical: Windows drive letters contain `:` and this project runs across Windows/WSL.
- Keep environment precedence compatible with current behavior.

### `src/lib/project-roots.js` — new

- Consume the centralized project configuration.
- Parse configured roots deterministically.
- Normalize trusted configured root paths, including existing Windows-host-to-WSL behavior when applicable.
- Keep trusted-root normalization separate from untrusted relative-path validation.
- Reject candidate paths that escape their declared root.
- Return root objects:
  ```js
  {
    id: "default",
    path: "/projects",
    source: "env",
    writableRegistry: true
  }
  ```
- High-level agent-facing APIs expose `rootId` by default, not the configured absolute root path.

### `src/lib/project-registry.js` — new or extracted from `src/lib/projects.js`

Own three separate concepts:

1. **Manual registry**
   - `data/projects.json`
   - current human/legacy state;
   - remains readable exactly as today;
   - automatic discovery never rewrites unrelated manual objects.

2. **Discovered registry**
   - `data/discovered-projects.json`
   - machine-managed state;
   - stores discovery metadata;
   - written atomically using temporary-file + rename semantics.

3. **Effective runtime registry**
   - merge of manual + discovered state;
   - manual always wins on identity/path conflicts;
   - runtime normalization never implies a write back to the manual file.

Provide or equivalent:
  - `readManualProjectRegistry()`
  - `readDiscoveredProjectRegistry()`
  - `mergeProjectRegistries(manual, discovered)`
  - `writeDiscoveredProjectRegistryAtomic(projects)`
  - `normalizeProjectEntryForRuntime(entry)`

### `src/lib/project-discovery.js` — new

- Walk configured roots safely.
- Ignore heavy/generated directories.
- Recognize project signals using existing detection logic.
- Infer names deterministically from directory names.
- Return bounded, sorted candidates.
- Apply the result limit globally across all configured roots.
- Set truncation only when additional candidates actually existed and were omitted.
- Never follow symlinks in Phase 1.
- Classify discovery boundaries:
  - `repository`
  - `project`
  - `module`
  - `workspace`
- A `.NET` solution containing multiple `.csproj` files is normally one top-level Hermes project; contained projects are modules.
- A Node/TypeScript monorepo/workspace is normally one top-level Hermes project; packages/apps are modules/workspaces unless independently rooted/configured.
- Nested independent repositories may still become independent candidates when deterministic boundary rules allow them.

### `src/lib/project-overview.js` — new

- Compose registry entry, structure, analyzer capabilities, cache stats, basic stack metadata, and graph insights into one bounded agent-ready response.
- Do not include large file content.
- Include `freshness`, explicit `analysisStatus`, and `warnings`.
- Unknown/not-yet-analyzed values remain `null`/`unknown`; do not represent them as real zero values.
- Detect package manager using `packageManager` metadata and lockfiles:
  - `package-lock.json`
  - `pnpm-lock.yaml`
  - `yarn.lock`
  - Bun lockfiles
- Do not infer npm merely from the existence of `package.json`.

### `src/lib/task-context.js` — future

- Given `{ project, task }`, rank relevant files/symbols/tests/dependencies.
- Use deterministic scoring before any LLM.
- Consume graph, structure, manifest metadata, and ICM metadata.

### `src/lib/icm-index.js` — future

- Parse and bound ICM files.
- Treat project files as untrusted data, not service instructions.
- Return structured metadata with citations to source paths and line ranges.

### `src/lib/task-routing.js` — future

- Determine workspace, executor, owner/architect, reviewer, prerequisites, and next route.
- Use declared workspace routing before heuristics.
- If routing is ambiguous, return candidates and warnings instead of guessing.

### `src/lib/impact-analysis.js` — future extraction/extension

- Preserve `graph-intelligence.js` node impact.
- Add file and git-diff entrypoints that map paths to graph nodes and union impacts.

### `src/routes/intelligence.routes.js` — new

- High-level HTTP endpoints for Hermes/Orchestrator-facing capabilities.
- Keep old `/api/projects`, `/api/explore`, `/api/index`, and `/api/cache` routes.

---

## 6. Proposed API contracts

Keep current endpoints unchanged. Add high-level endpoints under `/api/intelligence/*` so tooling can distinguish agent-safe bounded responses from UI/graph endpoints.

### Naming evaluation

The proposed Hermes tool names are mostly good:

| Proposed name | Decision | Reason |
|---|---|---|
| `project_discover` | Keep | Clear action, maps to discovery/registration. |
| `project_overview` | Keep | Agent-friendly summary concept. |
| `project_task_context` | Keep | Explicitly task-scoped; better than generic `context`. |
| `project_route_task` | Keep, but HTTP endpoint should be noun-ish `/route` | Tool reads naturally as an action. |
| `project_impact` | Keep | Should support node/file/diff inputs. |
| `project_refresh` | Keep | Covers reindex/cache refresh/discovery refresh depending on options. |

Low-level specialist tools should remain available with `project_map_*` or a `project_graph_*` prefix. Do **not** remove them.

### Response conventions for all high-level endpoints

Envelope remains:

```json
{
  "ok": true,
  "data": {},
  "message": "optional human-readable summary"
}
```

Every high-level `data` payload must include:

```json
{
  "schemaVersion": 1,
  "bounded": true,
  "limits": {},
  "warnings": []
}
```

### `GET /api/intelligence/discover`

Dry-run project discovery. No registry writes.

Query params:

- `rootId` optional.
- `maxDepth` default `3`, max `6`.
- `limit` default `100`, max `500`.
- `includeRegistered` default `false`.
- `includeAbsolutePaths` default `false`; local/debug only.

Response:

```json
{
  "ok": true,
  "data": {
    "schemaVersion": 1,
    "bounded": true,
    "limits": { "maxDepth": 3, "limit": 100 },
    "roots": [{ "id": "default" }],
    "candidates": [
      {
        "name": "hermes-project-map",
        "relativePath": "hermes-project-map",
        "rootId": "default",
        "projectType": "typescript",
        "typeLabel": "TypeScript",
        "supported": true,
        "registered": false,
        "boundaryKind": "repository",
        "modules": [],
        "signals": ["package.json", "tsconfig.json"]
      }
    ],
    "warnings": []
  }
}
```

The discovery result `limit` applies globally across all roots. The response should expose a `truncated` boolean that is true only when additional candidates were actually omitted.

### `POST /api/intelligence/discover/register`

Explicitly register accepted discovery candidates.

Scanning and registration are separate actions:

```txt
GET /api/intelligence/discover
  = dry-run only

POST /api/intelligence/discover/register
  = explicit mutation
```

This endpoint writes only machine-managed `data/discovered-projects.json`.
It never rewrites human-managed `data/projects.json`.

Registry mutation is intended for localhost/trusted-network operation in Phase 1 and must be gated by an explicit configuration flag such as:

```txt
INTELLIGENCE_REGISTRY_WRITES_ENABLED=true
```

If the service is bound externally, do not expose this endpoint unauthenticated.

Example request:

```json
{
  "rootId": "default",
  "projects": [
    "hermes-project-map",
    "sample-dotnet-solution"
  ]
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "schemaVersion": 1,
    "bounded": true,
    "discoveredCount": 12,
    "registeredCount": 3,
    "manualRegistryTouched": false,
    "projects": [
      { "name": "api-service", "relativePath": "api-service", "source": "discovered", "projectType": "dotnet" }
    ],
    "warnings": []
  }
}
```

### `GET /api/intelligence/projects/:name/overview`

Agent-safe bounded project summary.

Query params:

- `graphLimit` default `20`, max `100` for insights lists.
- `includePaths` default `relative`, accepted: `none|relative|absolute`; default must not expose absolute paths to Hermes tools unless requested.

Response:

```json
{
  "ok": true,
  "data": {
    "schemaVersion": 1,
    "bounded": true,
    "project": {
      "name": "hermes-project-map",
      "relativePath": "hermes-project-map",
      "projectType": "typescript",
      "typeLabel": "TypeScript",
      "supported": true,
      "source": "manual"
    },
    "stack": {
      "languages": ["JavaScript"],
      "frameworks": [],
      "packageManager": "npm",
      "runtime": "node",
      "scripts": ["start", "check", "test"]
    },
    "architecture": {
      "layers": [],
      "features": [],
      "entryPoints": ["src/server.js"],
      "testCommands": ["npm test", "npm run check"]
    },
    "statistics": {
      "sourceFileCount": 32,
      "nodeCount": null,
      "edgeCount": null
    },
    "analyzers": [{ "projectType": "typescript", "name": "TypeScript analyzer", "capabilities": {} }],
    "freshness": {
      "analysisStatus": "not_analyzed|fresh|stale|unknown",
      "cacheStatus": "miss|fresh|stale|unknown",
      "lastAnalyzedAt": null,
      "signature": null
    },
    "warnings": []
  }
}
```

### `POST /api/intelligence/projects/:name/task-context`

Future Phase 2/3 endpoint. Do not implement in Phase 1.

Request:

```json
{
  "task": "Add validation to order creation",
  "limit": 30,
  "includeSnippets": false,
  "includeTests": true
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "schemaVersion": 1,
    "bounded": true,
    "project": "sample-dotnet-solution",
    "task": "Add validation to order creation",
    "relevantFiles": [
      { "path": "src/Sample.Application/Orders/CreateOrderCommand.cs", "score": 91, "reasons": ["symbol_match", "feature_match"] }
    ],
    "relevantSymbols": [],
    "dependencies": [],
    "references": [],
    "relatedTests": [],
    "impact": { "level": "medium", "affectedFileCount": 4 },
    "architectureContext": { "layer": "Application", "feature": "Orders" },
    "warnings": []
  }
}
```

### `POST /api/intelligence/projects/:name/route`

Future Phase 3 endpoint. Do not implement in Phase 1.

Request:

```json
{
  "task": "Add validation to order creation",
  "changedFiles": [],
  "preferredMode": "auto"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "schemaVersion": 1,
    "bounded": true,
    "workspace": "backend/application",
    "executor": "sample-dotnet-solution-coder",
    "architect": "sample-dotnet-solution-architect",
    "reviewer": "sample-dotnet-solution-reviewer",
    "owners": ["billing-team"],
    "preconditions": ["npm test equivalent passes before change"],
    "nextRoute": "executor",
    "confidence": "high",
    "warnings": []
  }
}
```

### `POST /api/intelligence/projects/:name/impact`

Future extension. Preserve current `GET /api/explore/:project/impact?nodeId=...`.

Request supports exactly one entry mode at a time in Phase 2:

```json
{ "nodeId": "...", "depth": 2, "limit": 80 }
```

Later request modes:

```json
{ "files": ["src/server.js", "src/routes/projects.routes.js"], "depth": 2, "limit": 80 }
```

```json
{ "gitDiff": "...unified diff...", "depth": 2, "limit": 80 }
```

### `POST /api/intelligence/projects/:name/refresh`

Refresh analysis/cache/freshness for a project.

Request:

```json
{
  "analysis": true,
  "icm": true,
  "index": false
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "schemaVersion": 1,
    "bounded": true,
    "project": "hermes-project-map",
    "analysis": { "refreshed": true, "nodeCount": 120, "edgeCount": 80 },
    "icm": { "refreshed": true, "fileCount": 2 },
    "index": { "refreshed": false, "reason": "not_requested" },
    "warnings": []
  }
}
```

---

## 7. Data model evolution

### Preserve `data/projects.json` as human/legacy state

Do not force an immediate migration of the current manual registry.

The current array shape remains valid:

```json
[
  {
    "name": "hermes-project-map",
    "relativePath": "hermes-project-map",
    "addedAt": "2026-09-12T00:00:00"
  }
]
```

A manual entry does not need a persisted `source: "manual"` field.

Runtime code may derive:

```json
{
  "registrySource": "manual"
}
```

in memory, but automatic discovery must not rewrite the original manual object merely to add that field.

### Add `data/discovered-projects.json`

Machine-owned discovery state goes into a separate file.

Example:

```json
[
  {
    "name": "sample-dotnet-solution",
    "relativePath": "sample-dotnet-solution",
    "rootId": "default",
    "source": "discovered",
    "boundaryKind": "repository",
    "addedAt": "2026-09-12T00:20:50.000Z",
    "discoveredAt": "2026-09-12T00:20:50.000Z",
    "lastSeenAt": "2026-09-12T00:20:50.000Z",
    "projectType": "dotnet",
    "metadata": {
      "signals": ["Sample.sln"],
      "modules": [
        "src/Sample.Api/Sample.Api.csproj",
        "src/Sample.Domain/Sample.Domain.csproj"
      ]
    }
  }
]
```

The example is a neutral fixture shape. Tests must create temporary directories and must not assume this project exists on the user's machine.

### Effective registry

At runtime:

```txt
data/projects.json
      │
      │ human-managed
      ▼
 Manual Registry ────────┐
                         │
                         ├──► Effective Runtime Registry
                         │
Discovered Registry ─────┘
      ▲
      │ machine-managed
      │
data/discovered-projects.json
```

Merge rules:

1. manual wins over discovered on the same canonical root/path;
2. manual wins on an explicit identity conflict;
3. discovered entries can update machine-owned metadata;
4. runtime normalization does not imply persistence;
5. invalid discovered entries produce warnings rather than corrupting manual state;
6. missing discovered projects are not automatically deleted in Phase 1.

### Canonical discovered identity

Prefer:

```json
{
  "rootId": "default",
  "relativePath": "hermes-project-map"
}
```

Do not use arbitrary absolute paths as persistent project identity.

### Atomic discovered-registry writes

Use a sibling temporary file and atomic rename:

```txt
discovered-projects.json.tmp-<pid>-<nonce>
        ↓
flush / close
        ↓
rename
        ↓
discovered-projects.json
```

The machine-managed registry may be reformatted because the service owns it.

`data/projects.json` remains untouched by this write path.

### Future durable indexes

Do not add durable Project Intelligence indexes in Phase 0 or Phase 1.

Later phases may add:

```txt
data/intelligence/
  projects/<project-name>/overview.json
  projects/<project-name>/icm.json
  projects/<project-name>/freshness.json
  projects/<project-name>/file-index.json
```

On-demand correctness comes first.

## 8. Project discovery architecture

Discovery is scan-first and registration-second.

### Step 1 — resolve configured roots

Use centralized configuration.

Supported compatibility inputs:

```txt
PROJECTS_ROOT_CONTAINER
PROJECTS_ROOT
```

Canonical multi-root input:

```txt
PROJECTS_ROOTS
```

with JSON:

```json
[
  {
    "id": "personal",
    "path": "/home/dinis/projects",
    "writableRegistry": true
  },
  {
    "id": "work",
    "path": "/work/projects",
    "writableRegistry": false
  }
]
```

Do not make delimiter-separated roots canonical.

### Step 2 — validate roots

For each root:

- confirm it exists;
- confirm it is a directory;
- ensure root IDs are unique;
- normalize trusted configured root paths;
- never follow symlinks in Phase 1.

### Step 3 — walk breadth-first

Defaults:

```txt
maxDepth = 3
limit    = 100
```

Maximums:

```txt
maxDepth <= 6
limit    <= 500
```

The candidate `limit` applies globally across all roots.

The algorithm must distinguish:

```txt
returned exactly N candidates
```

from:

```txt
returned N candidates but more existed
```

Only the second case sets:

```json
{
  "truncated": true
}
```

### Step 4 — ignore generated/dependency directories

At minimum:

```txt
.git
.vs
.vscode
node_modules
bin
obj
.next
dist
build
coverage
```

### Step 5 — collect project signals

Signals remain deterministic:

- `.NET`
  - `.sln`
  - `.slnx`
  - `.csproj`
  - `Directory.Build.props`
- TypeScript/Node
  - `package.json`
  - `tsconfig.json`
  - `.ts`
  - `.tsx`
  - `.js`
- Python
  - `pyproject.toml`
  - `setup.py`
  - `requirements.txt`
  - `.py`

A signal is evidence, not automatically a top-level project.

### Step 6 — classify boundaries

Discovery must understand:

```txt
Repository
Project
Module
Workspace
```

#### Neutral fixture: standalone TypeScript repository

```txt
sample-service/
├── .git/
├── package.json
├── tsconfig.json
├── src/
└── tests/
```

Expected:

```json
{
  "name": "sample-service",
  "boundaryKind": "repository",
  "projectType": "typescript",
  "modules": []
}
```

#### Neutral fixture: .NET solution with modules

```txt
sample-dotnet-solution/
├── Sample.sln
├── src/
│   ├── Sample.Api/
│   │   └── Sample.Api.csproj
│   ├── Sample.Domain/
│   │   └── Sample.Domain.csproj
│   └── Sample.Infrastructure/
│       └── Sample.Infrastructure.csproj
└── tests/
    └── Sample.Tests/
        └── Sample.Tests.csproj
```

Default result:

```txt
sample-dotnet-solution
  = one top-level Hermes project

Sample.Api
Sample.Domain
Sample.Infrastructure
Sample.Tests
  = modules of that project
```

Do not register five top-level Hermes projects.

#### Neutral fixture: Node/TypeScript monorepo

```txt
sample-monorepo/
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   └── web/
│       └── package.json
└── packages/
    └── shared/
        └── package.json
```

Expected:

```txt
sample-monorepo
  = one top-level project/repository

apps/web
packages/shared
  = modules/workspaces
```

Do not blindly register every package.

#### Nested independent repository

A nested repository can become a separate candidate if:

- it is independently rooted;
- it is not generated/vendor content;
- it does not belong to the enclosing workspace model;
- it stays under an allowed configured root;
- it is within the discovery depth.

### Step 7 — candidate identity

Canonical identity uses:

```txt
rootId + normalized relativePath
```

Human/tool name:

- derived from basename by default;
- sanitized deterministically;
- no path separators;
- no traversal;
- stable suffix if collision occurs.

### Step 8 — compare against effective registry

Return whether a candidate is already registered.

Manual registrations always take priority.

### Step 9 — return bounded dry-run result

Default high-level output exposes:

```json
{
  "rootId": "personal",
  "relativePath": "hermes-project-map"
}
```

It does not expose:

```json
{
  "absoluteRoot": "/home/dinis/projects"
}
```

unless explicitly requested in local/debug mode.

### Step 10 — explicit registration

Registration is a separate mutation call.

It:

- revalidates the candidate/root;
- writes only `data/discovered-projects.json`;
- uses atomic persistence;
- never rewrites `data/projects.json`;
- does not delete missing projects in Phase 1.

## 9. Context-building strategy

Do this in phases. Do not jump straight to LLM summarization.

### Deterministic scoring inputs

- Task terms from natural language:
  - lowercase tokens;
  - split camelCase/PascalCase/kebab/snake;
  - keep domain terms longer than 2 chars;
  - remove common stopwords.
- Existing graph nodes:
  - symbol label;
  - kind/category;
  - file path;
  - layer;
  - feature;
  - namespace/projectName.
- File index metadata:
  - relative path;
  - basename;
  - extension;
  - layer/feature;
  - detected test/source classification.
- ICM metadata:
  - workspace declarations;
  - owner/reviewer/executor rules;
  - preconditions;
  - ADR tags.

### Ranking output

Return only bounded lists with reasons:

```json
{
  "path": "src/lib/projects.js",
  "score": 84,
  "reasons": ["path_token:project", "symbol_match:listProjectSummaries", "route_dependency"],
  "symbols": ["listProjectSummaries", "getProjectByName"]
}
```

### Snippets

Do not include file snippets by default. When `includeSnippets=true`, return only small cited snippets:

```json
{
  "path": "src/lib/projects.js",
  "ranges": [{ "startLine": 116, "endLine": 137, "reason": "project resolution" }]
}
```

### Bounded defaults

- `relevantFiles`: default 12, max 50.
- `relevantSymbols`: default 20, max 100.
- `dependencies`: default 20, max 100.
- `references`: default 20, max 100.
- `relatedTests`: default 10, max 50.
- `warnings`: max 20.

---

## 10. ICM ingestion architecture

ICM means project-level coordination metadata, not model prompt injection.

It remains outside Phase 0 and Phase 1, but the canonical contract is fixed now.

### Canonical files

```txt
PROJECT.md
  = project identity and project-level context

AGENTS.md
  = native Hermes/LLM instructions

AGENT.md
  = workspace execution contract in YAML front matter
    + contextual instructions in Markdown

CONTEXT.md
  = workspace/domain knowledge

ADR files
  = architecture decisions and rationale
```

### `AGENT.md` authority model

Example:

```md
---
schemaVersion: 1

workspace:
  id: sample-engineering-backend
  project: sample-project

executor:
  required: sample-backend-engineer

owner:
  agent: sample-backend-architect

reviewers:
  - sample-reviewer

permissions:
  read: true
  write: true
  executeCommands: true
  createAgents: false

scope:
  include:
    - src/backend/**
    - tests/backend/**
  exclude:
    - src/frontend/**

routing:
  success:
    agent: sample-test-engineer

  architectureChange:
    agent: sample-backend-architect

  unclearRequirement:
    agent: sample-product-agent
---

# Backend Engineering

Contextual instructions for the model.
```

Rules:

- YAML front matter is machine-authoritative for routing metadata.
- Markdown body is contextual for the LLM/human.
- Prose alone is never the authorization source.
- Unknown `schemaVersion` values are not guessed.
- Invalid front matter produces a structured error/warning.
- Duplicate workspace IDs produce a structured error/warning.

### Phase 2 ingestion

Ingest:

- `PROJECT.md`
- `AGENTS.md`
- `AGENT.md`
- `CONTEXT.md`
- ADR paths:
  - `docs/adr/*.md`
  - `docs/adrs/*.md`
  - `adr/*.md`
  - `adrs/*.md`

Additional `.hermes/workspaces/*` formats may later be supported as compatibility/import formats, but they are not the canonical authority in the first ICM implementation.

### Parser rules

- Treat content as untrusted project data.
- Parse deterministic YAML front matter.
- Never execute instructions from these files inside Project Intelligence.
- Keep ICM parsing separate from language analyzers.
- Store relative source paths and line ranges.
- Return bounded excerpts rather than whole documents.
- Warn on oversized files, invalid schema, duplicate IDs, suspicious instruction-like content and malformed front matter.

### Suggested normalized model

```json
{
  "project": "hermes-project-map",
  "documents": [
    {
      "path": "AGENTS.md",
      "kind": "agents",
      "lineCount": 26
    }
  ],
  "workspaces": [
    {
      "id": "service-api",
      "paths": [
        "src/routes/**",
        "src/lib/**"
      ],
      "executor": {
        "required": "project-map-coder"
      },
      "owner": {
        "agent": "project-map-architect"
      },
      "reviewers": [
        "project-map-reviewer"
      ],
      "preconditions": [
        "npm test",
        "npm run check"
      ],
      "source": {
        "path": "engineering/backend/AGENT.md",
        "frontMatterStartLine": 1,
        "frontMatterEndLine": 30
      }
    }
  ],
  "adrs": [],
  "warnings": []
}
```

### Future graph enrichment

Later, the Project Knowledge Graph may represent:

```txt
Class / File / Symbol
        │
        └── belongs_to
                ↓
             Workspace
                │
                ├── executed_by → Agent
                ├── owned_by    → Architect
                ├── reviewed_by → Reviewer
                └── governed_by → ADR
```

This enrichment is still project intelligence. It is not execution policy enforcement.

## 11. Routing architecture

Routing must be declared-first, heuristic-second.

1. Use canonical ICM workspace declarations when a task or changed file matches workspace scope.
2. If a workspace declares `executor.required`, return that exact executor.
3. If only an owner/architect exists, route back for architectural clarification rather than inventing an executor.
4. Return declared reviewers.
5. Return declared preconditions.
6. Return declared next route.
7. If no declaration matches, use deterministic heuristics:
   - file path;
   - layer;
   - feature;
   - analyzer type;
   - language/stack;
   - project defaults.
8. If confidence is low, return candidates plus:
   - `nextRoute = orchestrator_decision_required`

Example resolution:

```json
{
  "workspace": "engineering/backend",
  "executor": {
    "required": "sample-backend-engineer"
  },
  "owner": {
    "agent": "sample-backend-architect"
  },
  "reviewers": [
    "sample-reviewer"
  ],
  "preconditions": [
    "tests_green_before_change"
  ],
  "nextRoute": "executor",
  "confidence": "high",
  "warnings": []
}
```

### Hard boundary: resolution vs enforcement

`hermes-project-map` performs **resolution** only.

It determines:

```txt
workspace
required executor
owner / architect
reviewers
preconditions
next route
```

It does not:

- authorize an agent;
- grant permissions;
- invoke an agent;
- execute commands as an agent;
- bypass a policy;
- create an agent.

The future Hermes Agent OS Policy Engine performs **enforcement**.

Example:

```txt
Project Intelligence says:
  required executor = sample-backend-engineer

Orchestrator requests:
  generic-coder

Policy Engine compares:
  generic-coder != sample-backend-engineer

Result:
  DENY
  REROUTE → sample-backend-engineer
```

Critical distinction:

- `hermes-project-map` = global Project Intelligence infrastructure;
- `project-map-main` = local role/profile for maintaining this repository;
- Global Orchestrator = future consumer;
- Policy Engine = future enforcement layer outside this repository.

## 12. Security/path-access model

### Root allowlist

- All project paths must resolve beneath configured roots.
- Persist `rootId + relativePath`, not arbitrary untrusted absolute paths.
- Multiple roots have stable unique IDs.
- Reject before normalization:
  - `..` traversal;
  - absolute POSIX paths where relative input is expected;
  - Windows drive paths where relative input is expected;
  - UNC-like paths where relative input is expected;
  - path separators in project names.

Trusted configured roots are different: they may use existing Windows-host-to-WSL normalization.

### Safe resolution

Use `path.resolve()` + `path.relative()`:

```js
export function isPathInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relativePath = path.relative(root, candidate);

  return relativePath === ""
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
```

But do not rely on that alone for relative user/registry input.

These must be rejected before normalization:

```txt
/absolute
../secret
C:\secret
\\server\share
```

Do not strip the leading absolute marker and then accept the remainder.

### Output path policy

- High-level endpoints default to relative paths and root IDs.
- Configured absolute root paths are hidden by default.
- Absolute paths require explicit local/debug opt-in.
- Do not return source contents by default.
- Do not scan/read secret-like files for overview/task context.
- Discovery ignores generated/dependency/build paths by default.

### Registry ownership

```txt
data/projects.json
  human / legacy managed

data/discovered-projects.json
  machine managed
```

Automatic discovery never rewrites unrelated manual state.

### Atomic writes

Machine-managed discovered state uses:

```txt
temporary sibling file
        ↓
flush / close
        ↓
atomic rename
        ↓
discovered-projects.json
```

### Network trust model

Phase 0/1 assumes localhost or trusted-network operation.

If the service is reachable externally:

- mutation endpoints must not be exposed unauthenticated;
- registry mutation should be disabled until an authentication layer exists.

Use an explicit Phase 1 write gate, for example:

```txt
INTELLIGENCE_REGISTRY_WRITES_ENABLED=true
```

When disabled:

```txt
GET /api/intelligence/discover
  still works

POST /api/intelligence/discover/register
  returns explicit disabled/forbidden error
```

Full authentication/authorization remains outside Phase 1.

### Mutating endpoints

- `POST /api/intelligence/discover/register`
  - writes discovered registry only;
  - requires the explicit write gate.
- future `POST /api/intelligence/projects/:name/refresh`
  - may mutate caches/indexes depending on options.
- existing `DELETE /api/cache/symbols`
  - remains cache-only.

## 13. Hermes tool integration

### High-level tools for Global Orchestrator

Use these as the Orchestrator-facing toolset:

```txt
project_discover
project_overview
project_task_context
project_route_task
project_impact
project_refresh
```

Contracts:

- Tools return JSON strings from HTTP envelope payloads.
- Tools enforce timeouts.
- Tools clamp limits before making requests.
- Tools do not inspect repositories directly.
- Tools do not parse source code themselves.
- Tools do not call LLMs.

### Low-level tools for specialist agents

Keep low-level graph/search available separately:

```txt
project_map_projects
project_map_structure
project_map_search
project_map_expand
project_map_full_graph
project_map_index
project_map_cache_stats
project_map_clear_cache
```

Optionally rename future specialist tools to `project_graph_*`, but do not break existing documented `project_map_*` without aliases.

### Plugin location

Continue local/profile plugin first. Do not make Hermes core changes until contracts stabilize.

### Documentation updates needed

- Update `docs/hermes-tool-integration.md` to distinguish:
  - high-level Project Intelligence tools for Orchestrator;
  - low-level graph tools for specialists.
- Update `docs/hermes-plugin-installation.md` only after the HTTP endpoints are implemented.
- Correct stale `docs/analyzers-execution.md` test count from 15 to current suite behavior once code changes begin.

---

## 14. Testing strategy

Use strict TDD for every production change.

Verification commands:

```bash
npm test
npm run check
node -e "import('./src/lib/analyzer-service.js').then(()=>console.log('import ok')).catch(e=>{console.error(e); process.exit(1)})"
```

Current expected baseline before any implementation:

```txt
npm test
# includes:
# ℹ tests 28
# ℹ pass 28
# ℹ fail 0

npm run check
# exits 0
```

Test categories to add:

1. Root parsing and path safety.
2. Discovery dry-run from fixture project roots.
3. Registry upsert preserving manual entries.
4. Overview response bounds and stack metadata.
5. Route handlers return envelope and status codes.
6. Later: task-context ranking and routing from ICM fixtures.
7. Later: file/multi-file/diff impact mapping.

Avoid tests that depend on real user projects under `/projects`. Use `fs.mkdtempSync()` fixtures like existing tests. In particular, do not depend on old projects from another machine; neutral fixture names such as `sample-service`, `sample-dotnet-solution`, and `sample-monorepo` are preferred.

---

## 15. Backward compatibility strategy

- Do not remove or change existing endpoints:
  - `GET /api/health`
  - `GET /api/projects`
  - `GET /api/projects/:name`
  - `GET /api/projects/:name/structure`
  - `GET /api/explore/:project/search`
  - `GET /api/explore/:project/expand`
  - `GET /api/explore/:project/full`
  - `GET /api/explore/:project/impact`
  - `GET /api/explore/:project/context`
  - `GET /api/explore/:project/insights`
  - `POST /api/index/:project`
  - `GET /api/cache/symbols`
  - `DELETE /api/cache/symbols`
- Keep `data/projects.json` legacy array readable.
- Keep current UI working against existing routes.
- Keep `project_map_*` Hermes plugin docs valid until new tools exist.
- Add new high-level endpoints beside old endpoints.
- Keep `.NET` path through `symbol-index.js` wrapper intact.
- Keep default limits equal or stricter, never broader by accident.

---

## 16. Migration strategy

1. **Phase 0** centralizes configuration and establishes registry ownership without changing current HTTP behavior.
2. Keep `data/projects.json` readable and human-managed.
3. Add `data/discovered-projects.json` as machine-managed state.
4. Move internal lookup gradually to the effective runtime registry where manual entries win.
5. **Phase 1** adds bounded discovery + overview beside existing routes.
6. **Phase 2** adds canonical ICM parsing + Workspace Index.
7. **Phase 3** adds deterministic task context.
8. **Phase 4** adds task-routing resolution.
9. **Phase 5** adds Impact v2.
10. **Phase 6** adds the high-level Hermes Project Intelligence tools.
11. **Phase 7** begins the separate Hermes Agent OS:
    - Global Orchestrator;
    - Policy Engine;
    - Agent Registry;
    - Project Factory;
    - Agent Factory.
12. **Phase 8** validates one real project team end-to-end.
13. **Phase 9** introduces dynamic team generation/reconciliation.

No big-bang schema migration.

No analyzer rewrite.

No Project Intelligence duplication inside Hermes core.

## 17. Implementation phases

### Phase 0 — Configuration and Registry Foundation

Scope:

- centralize `.env` / environment configuration used for project roots and data paths;
- preserve `PROJECTS_ROOT` and `PROJECTS_ROOT_CONTAINER`;
- define JSON `PROJECTS_ROOTS` as canonical multi-root format;
- separate trusted configured-root normalization from untrusted relative-path validation;
- introduce manual/discovered/effective registry concepts;
- keep `data/projects.json` human-managed;
- add `data/discovered-projects.json` as machine-managed state;
- atomic discovered-registry writes;
- runtime merge where manual wins.

Expected end state:

- current 28 baseline tests still pass;
- existing HTTP behavior unchanged;
- existing UI unchanged;
- existing analyzers unchanged;
- configuration and registry foundation covered by new tests.

### Phase 1 — Discovery and Project Overview

Scope:

- deterministic discovery dry-run;
- repository/project/module/workspace boundary classification;
- global discovery bounds/truncation;
- `GET /api/intelligence/discover`;
- explicit `POST /api/intelligence/discover/register`;
- registry mutation write gate;
- bounded project overview;
- package-manager detection from metadata/lockfiles;
- unknown-vs-zero analysis semantics;
- documentation.

Expected end state:

- Phase 0 behavior remains valid;
- discovery never mutates by itself;
- explicit registration writes only discovered state;
- root absolute paths hidden by default;
- existing UI/routes remain compatible.

### Phase 2 — Canonical ICM parser + Workspace Index

- parse `PROJECT.md`, `AGENTS.md`, `AGENT.md`, `CONTEXT.md`, ADRs;
- YAML front matter in `AGENT.md` is machine-authoritative;
- normalize workspace/owner/executor/reviewer/preconditions;
- store provenance;
- no execution/enforcement.

### Phase 3 — Task Context

- add file metadata index;
- deterministic tokenization/scoring;
- add `POST /api/intelligence/projects/:name/task-context`;
- combine graph + structure + ICM;
- include relevant tests;
- bounded snippets only when requested.

### Phase 4 — Task Routing

- add `POST /api/intelligence/projects/:name/route`;
- declared workspace routing first;
- deterministic fallback heuristics;
- ambiguity returns candidates;
- resolution only, no enforcement.

### Phase 5 — Impact v2

- keep current node impact;
- symbol impact;
- file impact;
- multi-file impact;
- git diff impact.

### Phase 6 — Hermes Project Intelligence tools

- `project_discover`
- `project_overview`
- `project_task_context`
- `project_route_task`
- `project_impact`
- `project_refresh`

Keep existing `project_map_*` tools for specialists and compatibility.

### Phase 7 — Hermes Agent OS

Separate system/repository:

- Global Orchestrator;
- Policy Engine;
- Agent Registry;
- Project Factory;
- Agent Factory;
- Team Factory;
- audit;
- model/tool/permission routing.

The Policy Engine enforces `AGENT.md` required executors.

### Phase 8 — First real project team

Use one real project only after the Project Intelligence contracts are stable.

This phase validates:

```txt
overview
→ task context
→ route resolution
→ policy enforcement
→ project-specific executor
→ tests
→ reviewer
```

### Phase 9 — Dynamic team generation

- permanent project roles;
- ephemeral specialists;
- controlled agent creation requests;
- team lifecycle/reconciliation;
- governance and audit;
- no uncontrolled agent swarms.

## 18. Micro-commit sequence for Phase 1

The original Phase 1 sequence is preserved where it still fits, but its foundation is split into
Phase 0 so discovery does not accidentally become the owner of configuration or manual registry state.

Every production change follows:

```txt
RED
→ GREEN
→ REFACTOR
→ full regression
→ small commit
```

All new filesystem tests must create temporary fixtures. Do not depend on old projects or paths from another machine.


### Phase 0 / Commit 1 — centralize project configuration loading

Commit message:

```txt
refactor: centralize project configuration loading
```

#### 0.1 RED — add config tests

Create `tests/project-config.test.js` with temporary/injected configuration only.

Do not rely on projects from another machine.

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveProjectConfig,
  parseProjectRootsJson
} from "../src/lib/project-config.js";

test("preserves PROJECTS_ROOT_CONTAINER compatibility", () => {
  const config = resolveProjectConfig({
    env: {
      DATA_DIR: "/tmp/project-map-data",
      PROJECTS_ROOT_CONTAINER: "/tmp/projects"
    },
    envFileValues: {}
  });

  assert.equal(config.dataDir, "/tmp/project-map-data");
  assert.equal(config.legacyProjectsRootContainer, "/tmp/projects");
});

test("preserves PROJECTS_ROOT compatibility", () => {
  const config = resolveProjectConfig({
    env: {
      PROJECTS_ROOT: "C:\\Users\\Example\\projects"
    },
    envFileValues: {}
  });

  assert.equal(config.legacyProjectsRoot, "C:\\Users\\Example\\projects");
});

test("PROJECTS_ROOTS accepts canonical JSON array", () => {
  const roots = parseProjectRootsJson(JSON.stringify([
    { id: "personal", path: "/tmp/personal-projects" },
    { id: "work", path: "/tmp/work-projects", writableRegistry: false }
  ]));

  assert.deepEqual(roots, [
    { id: "personal", path: "/tmp/personal-projects", writableRegistry: true },
    { id: "work", path: "/tmp/work-projects", writableRegistry: false }
  ]);
});

test("PROJECTS_ROOTS rejects delimiter strings", () => {
  assert.throws(
    () => parseProjectRootsJson("/one:/two"),
    /JSON array/
  );
});

test("PROJECTS_ROOTS rejects duplicate ids", () => {
  assert.throws(
    () => parseProjectRootsJson(JSON.stringify([
      { id: "same", path: "/tmp/one" },
      { id: "same", path: "/tmp/two" }
    ])),
    /duplicate/i
  );
});
```

Run RED:

```bash
node --test tests/project-config.test.js
```

Expected:

```txt
Cannot find module ... src/lib/project-config.js
```

#### 0.2 GREEN — extract shared config

Add `src/lib/project-config.js`.

Requirements:

- reuse/extract the current `.env` behavior rather than create a parallel parser;
- preserve current precedence;
- expose existing `DATA_DIR`;
- expose legacy roots;
- parse `PROJECTS_ROOTS` as JSON only;
- fail clearly on malformed JSON/duplicate IDs.

The exact implementation should follow the existing repository code discovered during implementation rather than blindly copying pseudo-code from the plan.

#### 0.3 REFACTOR — use shared config from existing project lookup

Refactor `src/lib/projects.js` only enough to consume the centralized configuration.

Do not change route behavior.

Verification:

```bash
npm test
npm run check
```

#### 0.4 Commit

```bash
git status --short
git add src/lib/project-config.js src/lib/projects.js tests/project-config.test.js
git commit -m "refactor: centralize project configuration loading"
```


### Phase 0 / Commit 2 — safe project root resolution

Commit message:

```txt
feat: add project root resolution helpers
```

#### 1.1 RED — add root parsing tests

Create `tests/project-roots.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  getConfiguredProjectRoots,
  isPathInsideRoot,
  normalizeRootPath
} from "../src/lib/project-roots.js";

test("getConfiguredProjectRoots preserves the current PROJECTS_ROOT_CONTAINER default", () => {
  const roots = getConfiguredProjectRoots({
    env: {
      PROJECTS_ROOT_CONTAINER: "/projects"
    },
    envFileValues: {}
  });

  assert.deepEqual(roots, [{
    id: "default",
    path: "/projects",
    source: "env",
    writableRegistry: true
  }]);
});

test("getConfiguredProjectRoots accepts PROJECTS_ROOTS json array", () => {
  const roots = getConfiguredProjectRoots({
    env: {
      PROJECTS_ROOTS: JSON.stringify([
        { id: "work", path: "/work" },
        { id: "oss", path: "/oss", writableRegistry: false }
      ])
    },
    envFileValues: {}
  });

  assert.deepEqual(roots, [
    { id: "work", path: "/work", source: "env", writableRegistry: true },
    { id: "oss", path: "/oss", source: "env", writableRegistry: false }
  ]);
});

test("normalizeRootPath converts Windows paths to WSL paths on linux", () => {
  const actual = normalizeRootPath("C:\\Users\\Example\\Projects", { platform: "linux" });
  assert.equal(actual, "/mnt/c/Users/Example/Projects");
});

test("isPathInsideRoot rejects sibling paths", () => {
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/sample/src/File.cs"), true);
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/sample"), true);
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/sample2/src/File.cs"), false);
  assert.equal(isPathInsideRoot("/projects/sample", path.resolve("/projects/sample/../secret")), false);
});
```

Run RED:

```bash
node --test tests/project-roots.test.js
```

Expected output:

```txt
not ok ... Cannot find module ... src/lib/project-roots.js
# fail 1
```


Add RED tests for untrusted relative paths:

```js
import { validateRelativeProjectPath } from "../src/lib/project-roots.js";

test("rejects traversal before normalization", () => {
  assert.equal(validateRelativeProjectPath("../secret").valid, false);
});

test("rejects absolute POSIX paths where relative paths are required", () => {
  assert.equal(validateRelativeProjectPath("/absolute").valid, false);
});

test("rejects Windows drive paths where relative paths are required", () => {
  assert.equal(validateRelativeProjectPath("C:\\secret").valid, false);
});
```

Trusted configured-root normalization and untrusted relative-path validation are separate operations.
Do not strip an absolute marker and then accept the remainder.

#### 1.2 GREEN — add `src/lib/project-roots.js`

Create `src/lib/project-roots.js`:

```js
import path from "node:path";

export function getConfiguredProjectRoots(options = {}) {
  const env = options.env || process.env;
  const envFileValues = options.envFileValues || {};
  const rootsValue = env.PROJECTS_ROOTS || envFileValues.PROJECTS_ROOTS;

  if (rootsValue) {
    return parseProjectRootsValue(rootsValue);
  }

  const rootPath = env.PROJECTS_ROOT_CONTAINER
    || envFileValues.PROJECTS_ROOT_CONTAINER
    || normalizeRootPath(env.PROJECTS_ROOT || envFileValues.PROJECTS_ROOT)
    || "/projects";

  return [{
    id: "default",
    path: normalizeRootPath(rootPath),
    source: "env",
    writableRegistry: true
  }];
}

export function normalizeRootPath(value, options = {}) {
  if (!value) return null;

  const platform = options.platform || process.platform;
  const normalized = String(value).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const windowsDriveMatch = normalized.match(/^([a-zA-Z]):\/(.*)$/);

  if (platform === "linux" && windowsDriveMatch) {
    return `/mnt/${windowsDriveMatch[1].toLowerCase()}/${windowsDriveMatch[2]}`;
  }

  return normalized || null;
}

export function isPathInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relativePath = path.relative(root, candidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function parseProjectRootsValue(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed).map((item, index) => normalizeRootEntry(item, index));
  }

  throw new Error("PROJECTS_ROOTS must be a JSON array.");
}

function normalizeRootEntry(item, index) {
  const id = String(item.id || `root-${index + 1}`).trim();
  const rootPath = normalizeRootPath(item.path);

  if (!id || !rootPath) {
    throw new Error("Invalid project root entry.");
  }

  return {
    id,
    path: rootPath,
    source: "env",
    writableRegistry: item.writableRegistry !== false
  };
}
```

Run GREEN:

```bash
node --test tests/project-roots.test.js
```

Expected output:

```txt
# pass 4
# fail 0
```

Run full verification:

```bash
npm test
npm run check
```

Expected output:

```txt
# npm test includes fail 0 and pass 32 or higher
# npm run check exits 0
```

#### 1.3 Commit

```bash
git status --short
git add src/lib/project-roots.js tests/project-roots.test.js
git commit -m "feat: add safe project root resolution"
```

Expected status before commit includes only:

```txt
A  src/lib/project-roots.js
A  tests/project-roots.test.js
```


### Phase 0 / Commit 3 — separate registry ownership

Commit message:

```txt
refactor: separate manual and discovered project registries
```

#### 3.1 RED — registry merge tests

Use neutral in-memory objects and temporary files.

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  readManualProjectRegistry,
  readDiscoveredProjectRegistry,
  mergeProjectRegistries,
  normalizeProjectEntryForRuntime
} from "../src/lib/project-registry.js";

test("manual legacy objects remain valid and are not mutated", () => {
  const input = [{
    name: "manual-service",
    relativePath: "manual-service",
    addedAt: "2026-01-01T00:00:00"
  }];

  const normalized = normalizeProjectEntryForRuntime(input[0], {
    registrySource: "manual"
  });

  assert.equal(normalized.registrySource, "manual");

  assert.deepEqual(input, [{
    name: "manual-service",
    relativePath: "manual-service",
    addedAt: "2026-01-01T00:00:00"
  }]);
});

test("manual project wins over discovered path conflict", () => {
  const result = mergeProjectRegistries(
    [{
      name: "custom-service",
      relativePath: "service"
    }],
    [{
      name: "auto-service",
      rootId: "default",
      relativePath: "service",
      source: "discovered"
    }]
  );

  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].name, "custom-service");
  assert.equal(result.projects[0].registrySource, "manual");
});

test("non-conflicting discovered project appears in effective registry", () => {
  const result = mergeProjectRegistries(
    [{ name: "manual-service", relativePath: "manual-service" }],
    [{ name: "auto-service", rootId: "default", relativePath: "auto-service" }]
  );

  assert.deepEqual(
    result.projects.map((item) => item.name).sort(),
    ["auto-service", "manual-service"]
  );
});

test("manual reader accepts current legacy array format", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-manual-"));
  const file = path.join(dir, "projects.json");

  fs.writeFileSync(file, JSON.stringify([
    { name: "hermes-project-map", relativePath: "hermes-project-map" }
  ]));

  assert.equal(readManualProjectRegistry(file).length, 1);
});

test("missing discovered registry reads as empty", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-discovered-"));
  const file = path.join(dir, "discovered-projects.json");

  assert.deepEqual(readDiscoveredProjectRegistry(file), []);
});
```

#### 3.2 GREEN — add `src/lib/project-registry.js`

Implement:

```txt
readManualProjectRegistry
readDiscoveredProjectRegistry
normalizeProjectEntryForRuntime
mergeProjectRegistries
```

Do not add automatic persistence yet; that is the next commit.

Refactor `src/lib/projects.js` to read the effective registry while preserving current public behavior.

#### 3.3 Verification

```bash
node --test tests/project-registry.test.js
npm test
npm run check
```

#### 3.4 Commit

```bash
git status --short
git add src/lib/project-registry.js src/lib/projects.js tests/project-registry.test.js
git commit -m "refactor: separate manual and discovered project registries"
```



### Phase 0 / Commit 4 — atomic discovered-registry persistence

Commit message:

```txt
feat: persist discovered project registry atomically
```

#### 4.1 RED — atomic write tests

Add tests to `tests/project-registry.test.js`.

All tests use `fs.mkdtempSync()`.

Required cases:

```txt
writes valid discovered-projects.json
does not touch projects.json
replaces the target with complete JSON
does not leave a half-written target
repeated writes remain valid
```

Example test shape:

```js
test("writeDiscoveredProjectRegistryAtomic writes only discovered state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-write-"));
  const manualFile = path.join(dir, "projects.json");
  const discoveredFile = path.join(dir, "discovered-projects.json");

  fs.writeFileSync(manualFile, '[{"name":"manual","relativePath":"manual"}]\\n');

  writeDiscoveredProjectRegistryAtomic(discoveredFile, [{
    name: "auto",
    rootId: "default",
    relativePath: "auto",
    source: "discovered"
  }]);

  assert.match(
    fs.readFileSync(discoveredFile, "utf8"),
    /"name": "auto"/
  );

  assert.equal(
    fs.readFileSync(manualFile, "utf8"),
    '[{"name":"manual","relativePath":"manual"}]\\n'
  );
});
```

#### 4.2 GREEN — atomic writer

Implement a sibling temporary-file strategy.

Illustrative algorithm:

```txt
target:
  /data/discovered-projects.json

temp:
  /data/.discovered-projects.json.tmp-<pid>-<nonce>

write full JSON
flush / close where practical
rename(temp, target)
cleanup temp on handled error
```

Do not route manual registry writes through this helper.

#### 4.3 Verification

```bash
node --test tests/project-registry.test.js
npm test
npm run check
```

#### 4.4 Commit

```bash
git status --short
git add src/lib/project-registry.js tests/project-registry.test.js
git commit -m "feat: persist discovered project registry atomically"
```



### Phase 0 / Commit 5 — document the foundation

Commit message:

```txt
docs: document project intelligence registry foundation
```

Document:

- canonical JSON `PROJECTS_ROOTS`;
- legacy single-root compatibility;
- manual vs discovered vs effective registry;
- manual-wins semantics;
- atomic discovered-registry ownership;
- localhost/trusted-network assumption;
- no discovery implementation yet.

Verification:

```bash
npm test
npm run check
git status --short
```



### Phase 1 / Commit 1 — classify project boundaries

Commit message:

```txt
feat: classify discovered project boundaries
```

#### 1.1 RED — add boundary fixture tests

Create `tests/project-discovery-boundaries.test.js`.

Use only temporary fixture trees.

##### Standalone TypeScript repository

```js
test("classifies a standalone TypeScript repository as one top-level candidate", () => {
  const root = makeRoot();

  fs.mkdirSync(path.join(root, "sample-service", "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "sample-service", ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, "sample-service", "package.json"), "{}\\n");
  fs.writeFileSync(path.join(root, "sample-service", "tsconfig.json"), "{}\\n");
  fs.writeFileSync(
    path.join(root, "sample-service", "src", "server.ts"),
    "export function start() {}\\n"
  );

  const result = discoverProjects({
    roots: [{ id: "default", path: root }],
    registeredProjects: [],
    maxDepth: 3,
    limit: 20
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "sample-service");
  assert.equal(result.candidates[0].boundaryKind, "repository");
});
```

##### .NET solution fixture

```js
test("classifies csproj files under a solution as modules, not top-level projects", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-dotnet-solution");

  fs.mkdirSync(path.join(repo, "src", "Sample.Api"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "Sample.Domain"), { recursive: true });

  fs.writeFileSync(path.join(repo, "Sample.sln"), "solution\\n");
  fs.writeFileSync(
    path.join(repo, "src", "Sample.Api", "Sample.Api.csproj"),
    "<Project />\\n"
  );
  fs.writeFileSync(
    path.join(repo, "src", "Sample.Domain", "Sample.Domain.csproj"),
    "<Project />\\n"
  );

  const result = discoverProjects({
    roots: [{ id: "default", path: root }],
    registeredProjects: [],
    maxDepth: 4,
    limit: 20
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "sample-dotnet-solution");
  assert.equal(result.candidates[0].modules.length, 2);
});
```

##### TypeScript monorepo fixture

```js
test("classifies workspace packages as modules of one monorepo candidate", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-monorepo");

  fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true });
  fs.mkdirSync(path.join(repo, "packages", "shared"), { recursive: true });

  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ private: true, workspaces: ["apps/*", "packages/*"] })
  );
  fs.writeFileSync(path.join(repo, "apps", "web", "package.json"), "{}\\n");
  fs.writeFileSync(path.join(repo, "packages", "shared", "package.json"), "{}\\n");

  const result = discoverProjects({
    roots: [{ id: "default", path: root }],
    registeredProjects: [],
    maxDepth: 4,
    limit: 20
  });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "sample-monorepo");
  assert.equal(result.candidates[0].modules.length, 2);
});
```

Also test:

- ignored `node_modules`;
- ignored `bin/obj`;
- nested independent repository;
- deterministic ordering;
- no symlink traversal.

#### 1.2 GREEN — implement boundary classifier

Add or split helpers as needed:

```txt
detectProjectSignals
classifyProjectBoundary
detectDotnetModules
detectNodeWorkspaceModules
```

Keep the implementation deterministic.

Do not add HTTP routes yet.

#### 1.3 Verification

```bash
node --test tests/project-discovery-boundaries.test.js
npm test
npm run check
```

#### 1.4 Commit

```bash
git status --short
git add src/lib/project-discovery.js tests/project-discovery-boundaries.test.js
git commit -m "feat: classify discovered project boundaries"
```



### Phase 1 / Commit 2 — bounded deterministic discovery

Commit message:

```txt
feat: add bounded deterministic project discovery
```

#### 2.1 RED — add bounds/registry recognition tests

Create or extend `tests/project-discovery.test.js`.

Use temporary fixtures such as:

```txt
/tmp/.../a-service
/tmp/.../b-service
/tmp/.../c-service
```

Test:

- supported candidate detection;
- effective-registry recognition;
- `includeRegistered`;
- global result limit across multiple roots;
- stable sort;
- true truncation semantics;
- missing root warning;
- ignored directories;
- no state mutation.

Important global-limit test:

```js
test("discovery limit applies globally across roots", () => {
  const rootA = makeRoot();
  const rootB = makeRoot();

  makeNodeProject(rootA, "a-one");
  makeNodeProject(rootA, "a-two");
  makeNodeProject(rootB, "b-one");
  makeNodeProject(rootB, "b-two");

  const result = discoverProjects({
    roots: [
      { id: "a", path: rootA },
      { id: "b", path: rootB }
    ],
    registeredProjects: [],
    maxDepth: 2,
    limit: 3
  });

  assert.equal(result.candidates.length, 3);
  assert.equal(result.truncated, true);
});
```

And:

```js
test("truncated is false when exactly limit candidates exist", () => {
  const root = makeRoot();

  makeNodeProject(root, "a");
  makeNodeProject(root, "b");

  const result = discoverProjects({
    roots: [{ id: "default", path: root }],
    registeredProjects: [],
    maxDepth: 2,
    limit: 2
  });

  assert.equal(result.candidates.length, 2);
  assert.equal(result.truncated, false);
});
```

#### 2.2 GREEN — finish `discoverProjects`

The scan should be deterministic and bounded.

Do not expose absolute root paths in its high-level result by default.

#### 2.3 Verification

```bash
node --test tests/project-discovery.test.js
npm test
npm run check
```

#### 2.4 Commit

```bash
git status --short
git add src/lib/project-discovery.js tests/project-discovery.test.js
git commit -m "feat: add bounded deterministic project discovery"
```



### Phase 1 / Commit 3 — expose discovery dry-run API

Commit message:

```txt
feat: expose project discovery API
```

#### 3.1 RED — route tests

Create `tests/intelligence-routes.test.js`.

Fixture projects live under `fs.mkdtempSync()` roots.

Test:

- `GET /api/intelligence/discover` returns candidates;
- no registry file is changed;
- response exposes root IDs;
- response does not expose configured absolute root paths by default;
- query bounds are clamped/validated;
- response envelope remains `{ ok, data, message }`.

Example assertion:

```js
assert.deepEqual(payload.data.roots, [{ id: "default" }]);
assert.equal(JSON.stringify(payload).includes(fixture.root), false);
```

#### 3.2 GREEN — add dry-run route

Add:

```txt
GET /api/intelligence/discover
```

Keep existing routes unchanged.

#### 3.3 Verification

```bash
node --test tests/intelligence-routes.test.js
npm test
npm run check
```

#### 3.4 Commit

```bash
git status --short
git add src/routes/intelligence.routes.js src/server.js tests/intelligence-routes.test.js
git commit -m "feat: expose project discovery API"
```



### Phase 1 / Commit 4 — explicit discovered-project registration

Commit message:

```txt
feat: register discovered projects explicitly
```

#### 4.1 RED — mutation tests

Extend `tests/intelligence-routes.test.js`.

Use temporary:

```txt
projects.json
discovered-projects.json
project root
```

Required cases:

1. write gate disabled => explicit forbidden/disabled result;
2. write gate enabled => accepted candidate persisted;
3. manual registry file unchanged;
4. discovered registry receives machine entry;
5. unknown/stale candidate rejected;
6. candidate escaping root rejected;
7. repeated registration updates machine metadata rather than duplicating the same canonical project.

Example:

```js
test("registration never rewrites manual registry", async () => {
  const fixture = makeFixture();

  const originalManual = '[{"name":"manual-service","relativePath":"manual-service"}]\\n';
  fs.writeFileSync(fixture.manualProjectsFile, originalManual);

  // invoke registration with write gate enabled

  assert.equal(
    fs.readFileSync(fixture.manualProjectsFile, "utf8"),
    originalManual
  );
});
```

#### 4.2 GREEN — add mutation endpoint

Add:

```txt
POST /api/intelligence/discover/register
```

Rules:

- explicit write gate required;
- revalidate candidate;
- write only machine registry;
- atomic persistence;
- preserve response envelope.

#### 4.3 Verification

```bash
node --test tests/intelligence-routes.test.js
npm test
npm run check
```

#### 4.4 Commit

```bash
git status --short
git add src/routes/intelligence.routes.js src/server.js tests/intelligence-routes.test.js
git commit -m "feat: register discovered projects explicitly"
```


### Phase 1 / Commit 5 — high-level project overview

Commit message:

```txt
feat: add bounded project overview API
```

#### 5.1 RED — add overview tests

Create `tests/project-overview.test.js`:

```js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectOverview } from "../src/lib/project-overview.js";

function makeTsProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-project-overview-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    type: "module",
    scripts: { start: "node src/server.js", test: "node --test tests/*.test.js", check: "node --check src/server.js" },
    dependencies: { typescript: "^6.0.3" }
  }, null, 2));
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{}\n");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "server.ts"), "export function start() {}\n");
  return { name: "sample-service", relativePath: "sample-service", absolutePath: root, source: "manual" };
}

test("buildProjectOverview returns bounded stack and architecture summary", () => {
  const overview = buildProjectOverview(makeTsProject(), { graphLimit: 5 });

  assert.equal(overview.schemaVersion, 1);
  assert.equal(overview.bounded, true);
  assert.equal(overview.project.name, "sample-service");
  assert.equal(overview.project.projectType, "typescript");
  assert.equal(overview.stack.packageManager, "npm");
  assert.deepEqual(overview.stack.scripts.sort(), ["check", "start", "test"]);
  assert.ok(overview.architecture.entryPoints.includes("src/server.ts"));
  assert.ok(overview.analyzers.some((item) => item.projectType === "typescript"));
});

test("buildProjectOverview omits absolute paths by default", () => {
  const project = makeTsProject();
  const overview = buildProjectOverview(project);

  assert.equal(Object.prototype.hasOwnProperty.call(overview.project, "absolutePath"), false);
});

test("buildProjectOverview reports unknown analysis counts as null", () => {
  const overview = buildProjectOverview(makeTsProject());

  assert.equal(overview.freshness.analysisStatus, "not_analyzed");
  assert.equal(overview.statistics.nodeCount, null);
  assert.equal(overview.statistics.edgeCount, null);
});

test("buildProjectOverview detects package manager from lockfile or packageManager metadata", () => {
  const project = makeTsProject();

  fs.writeFileSync(
    path.join(project.absolutePath, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@10.0.0",
      scripts: { test: "node --test" }
    })
  );

  const overview = buildProjectOverview(project);
  assert.equal(overview.stack.packageManager, "pnpm");
});
```

Run RED:

```bash
node --test tests/project-overview.test.js
```

Expected output:

```txt
not ok ... Cannot find module ... src/lib/project-overview.js
# fail 1
```

#### 5.2 GREEN — add `src/lib/project-overview.js`

Create `src/lib/project-overview.js`:

```js
import fs from "node:fs";
import path from "node:path";

import {
  detectProjectType,
  getProjectTypeLabel,
  isSupportedProjectType
} from "../analyzers/common/analyzer-detection.js";
import { listAnalyzerCapabilities } from "../analyzers/common/analyzer-registry.js";
import { getAnalysisCacheStats } from "./analysis-cache.js";
import { analyzeProjectStructure } from "./project-structure.js";

export function buildProjectOverview(project, options = {}) {
  const includePaths = options.includePaths || "relative";
  const projectType = detectProjectType(project.absolutePath);
  const packageJson = readJson(path.join(project.absolutePath, "package.json"));
  const structure = safeStructure(project);
  const cacheStats = getAnalysisCacheStats();
  const cacheEntry = cacheStats.entries.find((entry) => entry.project === project.name && entry.projectType === projectType);

  return {
    schemaVersion: 1,
    bounded: true,
    limits: {
      graphLimit: clamp(options.graphLimit, 20, 1, 100),
      includePaths
    },
    project: projectSummary(project, projectType, includePaths),
    stack: buildStack(packageJson, projectType),
    architecture: buildArchitecture(project, packageJson, structure),
    statistics: buildStatistics(project, structure, cacheEntry),
    analyzers: listAnalyzerCapabilities(),
    freshness: {
      analysisStatus: cacheEntry ? "fresh" : "not_analyzed",
      cacheStatus: cacheEntry ? "fresh" : "unknown",
      lastAnalyzedAt: null,
      signature: null
    },
    warnings: []
  };
}

function projectSummary(project, projectType, includePaths) {
  const summary = {
    name: project.name,
    relativePath: project.relativePath,
    projectType,
    typeLabel: getProjectTypeLabel(projectType),
    supported: isSupportedProjectType(projectType),
    source: project.source || "manual"
  };

  if (includePaths === "absolute") {
    summary.absolutePath = project.absolutePath;
  }

  return summary;
}

function buildStack(packageJson, projectType) {
  const scripts = Object.keys(packageJson?.scripts || {}).sort();
  const dependencies = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {})
  };

  return {
    languages: projectType === "typescript" ? ["JavaScript", "TypeScript"] : projectType === "dotnet" ? ["C#"] : [],
    frameworks: detectFrameworks(dependencies),
    packageManager: detectPackageManager(project.absolutePath, packageJson),
    runtime: packageJson ? "node" : projectType,
    scripts
  };
}

function buildArchitecture(project, packageJson, structure) {
  return {
    layers: (structure.layers || []).slice(0, 20),
    features: (structure.features || []).slice(0, 20),
    entryPoints: detectEntryPoints(project.absolutePath, packageJson),
    testCommands: detectTestCommands(packageJson)
  };
}

function buildStatistics(project, structure, cacheEntry) {
  return {
    sourceFileCount: structure.projects?.reduce((sum, item) => sum + Number(item.sourceFileCount || item.csFileCount || 0), 0) || 0,
    nodeCount: cacheEntry ? cacheEntry.nodeCount : null,
    edgeCount: cacheEntry ? cacheEntry.edgeCount : null,
    featureCount: structure.features?.length || 0,
    layerCount: structure.layers?.length || 0
  };
}

function safeStructure(project) {
  try {
    return analyzeProjectStructure(project);
  } catch {
    return { layers: [], features: [], projects: [] };
  }
}

function detectFrameworks(dependencies) {
  const frameworks = [];
  for (const name of ["react", "next", "vue", "svelte", "express", "fastify"]) {
    if (dependencies[name]) frameworks.push(name);
  }
  return frameworks;
}

function detectEntryPoints(rootPath, packageJson) {
  const candidates = [
    packageJson?.main,
    "src/server.js",
    "src/server.ts",
    "src/index.js",
    "src/index.ts",
    "server.js",
    "index.js"
  ].filter(Boolean);

  return candidates
    .map((candidate) => String(candidate).replace(/\\/g, "/"))
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .filter((candidate) => fs.existsSync(path.join(rootPath, candidate)));
}

function detectTestCommands(packageJson) {
  const scripts = packageJson?.scripts || {};
  return Object.keys(scripts)
    .filter((name) => /test|check|lint/i.test(name))
    .sort()
    .map((name) => `npm run ${name}`.replace("npm run test", "npm test"));
}


function detectPackageManager(rootPath, packageJson) {
  const declared = String(packageJson?.packageManager || "").trim();

  if (declared) {
    return declared.split("@")[0] || null;
  }

  if (fs.existsSync(path.join(rootPath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(rootPath, "yarn.lock"))) return "yarn";
  if (
    fs.existsSync(path.join(rootPath, "bun.lock"))
    || fs.existsSync(path.join(rootPath, "bun.lockb"))
  ) return "bun";
  if (fs.existsSync(path.join(rootPath, "package-lock.json"))) return "npm";

  return packageJson ? "unknown" : null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function clamp(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
```

#### 5.3 Add route handler

Patch `src/routes/intelligence.routes.js`:

```diff
 import { discoverProjects } from "../lib/project-discovery.js";
+import { getProjectByName } from "../lib/projects.js";
+import { buildProjectOverview } from "../lib/project-overview.js";
...
 import { parseLimit } from "../utils/validation.js";
+import { validateProjectName } from "../utils/validation.js";
+
+export async function handleProjectOverview(req, res, params, query) {
+  const v = validateProjectName(params.name);
+  if (!v.valid) {
+    sendError(res, 400, "invalid_project", v.error);
+    return;
+  }
+
+  try {
+    const project = getProjectByName(params.name);
+    const overview = buildProjectOverview(project, {
+      graphLimit: parseLimit(query.get("graphLimit"), 20, 1, 100),
+      includePaths: query.get("includePaths") || "relative"
+    });
+    sendOk(res, 200, overview, "Overview carregado.");
+  } catch (error) {
+    const msg = error.message || `Projeto "${params.name}" não disponível.`;
+    sendError(res, msg.includes("não encontrado") ? 404 : 502, msg.includes("não encontrado") ? "not_found" : "project_unavailable", msg);
+  }
+}
```

Patch `src/server.js`:

```diff
 import {
   handleDiscoverAndRegisterProjects,
-  handleDiscoverProjectsDryRun
+  handleDiscoverProjectsDryRun,
+  handleProjectOverview
 } from "./routes/intelligence.routes.js";
...
 router.add("POST", "/api/intelligence/discover", handleDiscoverAndRegisterProjects);
+router.add("GET", "/api/intelligence/projects/:name/overview", handleProjectOverview);
```

Run GREEN:

```bash
node --test tests/project-overview.test.js
npm test
npm run check
```

Expected output:

```txt
# overview test pass 2 fail 0
# npm test includes fail 0 and pass 43 or higher
# npm run check exits 0
```

#### 5.4 Commit

```bash
git status --short
git add src/lib/project-overview.js src/routes/intelligence.routes.js src/server.js tests/project-overview.test.js
git commit -m "feat: add bounded project overview API"
```

### Phase 1 / Commit 6 — documentation-only Phase 1 contracts

Commit message:

```txt
docs: document project intelligence phase one API
```

#### 6.1 Update docs

Patch `README.md`:

- Add high-level endpoints section after existing endpoint list:

```md
### Project Intelligence

```txt
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
```

These endpoints are bounded, agent-oriented contracts intended for Hermes and future Orchestrator use. Discovery scanning is dry-run; explicit registration writes only machine-managed discovered state. Existing `/api/projects` and `/api/explore` endpoints remain available for UI and specialist graph workflows.
```

Patch `docs/hermes-tool-integration.md`:

- Add a section before `Suggested Hermes tools`:

```md
## Tool tiers

Use two tiers of Hermes tools:

1. High-level Project Intelligence tools for the Global Orchestrator:
   - `project_discover`
   - `project_overview`
   - `project_task_context`
   - `project_route_task`
   - `project_impact`
   - `project_refresh`
2. Low-level graph/search tools for specialist agents:
   - existing `project_map_*` tools.

Hermes tools must remain thin HTTP clients. Do not duplicate analyzer, discovery, graph, ICM, or routing logic inside Hermes.
```

Patch `docs/analyzers-execution.md`:

- Replace stale expected result:

```diff
-15/15 tests passing
+The exact count changes as coverage grows. The required result is `fail 0`; the current baseline before Project Intelligence work was `28` tests passing.
```

Run verification:

```bash
npm test
npm run check
```

Expected output:

```txt
# npm test includes fail 0 and pass 43 or higher
# npm run check exits 0
```

#### 6.2 Commit

```bash
git status --short
git add README.md docs/hermes-tool-integration.md docs/analyzers-execution.md
git commit -m "docs: document project intelligence phase one API"
```

---

## 19. Explicit list of things that should NOT be implemented in Phase 1

Do **not** implement these in Phase 0 or Phase 1:

1. Natural-language task-context endpoint.
2. LLM calls inside the service.
3. ICM ingestion/parsing.
4. Task routing endpoint.
5. Workspace authorization/enforcement.
6. Agent invocation/execution.
7. File-based impact.
8. Multi-file impact.
9. Git diff impact.
10. Durable `data/intelligence/*` indexes.
11. Background watchers.
12. Automatic discovery on server startup.
13. Automatic deletion of missing discovered projects.
14. Symlink traversal.
15. Public/external unauthenticated mutation.
16. Full authentication/authorization framework.
17. Express/Fastify migration.
18. Analyzer rewrite.
19. UI redesign.
20. Hermes core changes.
21. Renaming/removing existing `project_map_*` tools.
22. Breaking current `data/projects.json`.
23. Automatic rewriting/enrichment of manual registry objects.
24. Returning source file contents in overview.
25. Returning configured absolute root paths by default.
26. Changing current `/api/explore/*` payloads.
27. Changing `.NET` `symbol-index.js` behavior beyond a small compatibility refactor required by tests.
28. Building the Hermes Agent OS inside `hermes-project-map`.
29. Dynamic agent/team generation.
30. Tests that assume previously available local projects such as SampleDotnetSolution.

Phase 0/1 are foundations only.

## Risks, tradeoffs, and open questions

### Risks

- Discovery can accidentally identify every nested project file as a top-level Hermes project.
  - Mitigate with explicit repository/project/module/workspace boundary tests.
- Registry automation can damage human state.
  - Mitigate with separate manual/discovered files and atomic machine writes.
- Windows/WSL path handling can become ambiguous.
  - Mitigate with JSON multi-root configuration and separate trusted-root vs untrusted-relative validation.
- High-level endpoints can accidentally leak local filesystem topology.
  - Mitigate with root IDs and relative paths by default.
- Mutating HTTP endpoints are dangerous when exposed outside localhost/trusted networks.
  - Mitigate with explicit write gate now and authentication before external exposure.
- High-level overview may accidentally report unknown as zero.
  - Mitigate with explicit `analysisStatus` and nullable counts.
- ICM files can contain prompt-injection-like text.
  - Mitigate by treating them as untrusted data and making YAML front matter the machine-authoritative contract.
- Routing may overstate certainty.
  - Mitigate with confidence, warnings, and `orchestrator_decision_required`.

### Tradeoffs

- Two registry files are slightly more operationally complex than one, but ownership is much clearer.
- Keeping the legacy manual file untouched avoids surprising diffs and backwards-compatibility problems.
- Strict canonical ICM is less flexible than parsing many ad-hoc formats, but makes deterministic routing possible.
- On-demand overview may be slower than durable indexes, but avoids premature persistence complexity.
- Minimal router stays simple but requires explicit validation/body parsing rather than framework conveniences.

### Open questions

1. Should `PROJECTS_ROOTS` remain environment-only or later also support a local config file?
2. What exact request contract should `POST /api/intelligence/discover/register` stabilize on?
3. Should nested independent Git repositories always win over an enclosing monorepo classification, or only when explicitly configured?
4. What exact package/workspace metadata should overview expose for monorepos?
5. Which real project should be the Phase 8 pilot?
6. What will the separate Hermes Agent OS repository be called?

## Final acceptance criteria for Phase 1

### Phase 0 acceptance

- `npm test` exits `0`.
- `npm run check` exits `0`.
- Existing 28 baseline tests remain passing.
- Current routes remain behaviorally compatible.
- Current UI remains usable.
- Current analyzers remain unchanged in behavior.
- Configuration loading is centralized.
- Legacy `PROJECTS_ROOT` / `PROJECTS_ROOT_CONTAINER` still work.
- `PROJECTS_ROOTS` JSON works.
- Unsafe relative paths are rejected before normalization.
- `data/projects.json` remains human/legacy managed.
- `data/discovered-projects.json` is machine managed.
- Effective registry merges both with manual precedence.
- Machine registry writes are atomic.

### Phase 1 acceptance

- all Phase 0 criteria remain true;
- `GET /api/intelligence/discover` exists and is dry-run only;
- discovery uses deterministic repository/project/module/workspace boundaries;
- `.NET` solution fixtures do not explode into multiple top-level projects by default;
- Node/TypeScript workspace fixtures do not explode into every package by default;
- discovery `limit` applies globally across roots;
- `truncated` means actual omission;
- configured absolute root paths are hidden by default;
- `POST /api/intelligence/discover/register` is explicit and gated;
- registration writes only `data/discovered-projects.json`;
- manual registry is untouched by automatic registration;
- `GET /api/intelligence/projects/:name/overview` returns a bounded payload;
- unknown node/edge counts are `null` rather than fake zeroes;
- package manager is inferred from metadata/lockfiles;
- existing UI continues to use existing endpoints;
- existing low-level Hermes plugin documentation remains valid;
- no task context, ICM, routing, impact-v2 or Hermes Agent OS implementation is included yet.

