# Integration as a Hermes tool

[← README](../README.md) · [Adding projects](./adding-projects.md) · [Implementation](./analyzers-implementation.md) · [Execution](./analyzers-execution.md)

## Purpose

Expose `hermes-project-map` as an independent Project Intelligence HTTP service that Hermes Agent can use directly, so agents can query project graphs without depending on the UI or duplicating repository analysis logic.

Architecture boundary:

- `hermes-project-map` owns project analysis, project configuration, registry reading/merging, and future discovery/overview APIs.
- Hermes should remain a thin client/consumer that calls this HTTP service.
- The future Hermes Agent OS owns orchestration, policy enforcement, and agent execution. This service may resolve project intelligence; it does not enforce agent policy or run agents.

The integration can be implemented in two ways:

1. **Local Hermes plugin/tool** — a thin Python client registered in Hermes.
2. **MCP wrapper** — useful if the same HTTP service should be consumed by multiple clients.

## Recommended option

For this project, the cleanest option is to keep `hermes-project-map` as an HTTP service and create a Hermes plugin/tool that calls the existing endpoints.

Reasons:

- avoids reimplementing the analysis in Python;
- preserves the existing Node.js server;
- allows the UI and API to evolve independently;
- keeps the Hermes tool small and easy to maintain;
- lets the same backend serve the UI, CLI, Hermes, and future integrations.

Do not duplicate analyzer, registry, path-safety, or future discovery logic inside Hermes. Add that logic to this service and keep Hermes integration code limited to request/response handling, input validation, limits, and timeouts.

## Current Project Intelligence status

Implemented in Phase 0:

- centralized project configuration for `DATA_DIR`, `PROJECTS_ROOT`, `PROJECTS_ROOT_CONTAINER`, and JSON-only `PROJECTS_ROOTS`;
- trusted configured-root normalization and untrusted relative project-path validation;
- manual/discovered/effective registry separation;
- existing project lookup/listing over the effective runtime registry;
- atomic persistence helper for the machine-managed discovered registry.

Implemented in Phase 1:

- project boundary classification;
- bounded deterministic multi-root discovery;
- `GET /api/intelligence/discover`;
- guarded explicit discovered-project registration at `POST /api/intelligence/discover/register`;
- bounded project overview at `GET /api/intelligence/projects/:name/overview`.

Next implementation phase:

- Phase 2: canonical ICM parser and Workspace Index.

Future work:

- task context, task routing, impact v2, high-level Hermes `project_*` tools, and Hermes Agent OS orchestration.

The service does not run agents and does not enforce future Hermes Agent OS policy. Hermes remains a thin HTTP consumer; `hermes-project-map` remains the Project Intelligence source of truth.

## Project Intelligence HTTP API implemented today

```txt
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
```

### `GET /api/intelligence/discover`

Dry-run, non-mutating, bounded, deterministic, multi-root project discovery. The scan is repository/project/module/workspace boundary-aware and hides configured absolute root paths by default.

Query parameters:

- `maxDepth`: default `3`, clamped to `1..6`.
- `limit`: default `100`, clamped to `1..500`, applied globally across all configured roots.
- `includeRegistered=true`: includes registered candidates; absent or any other value excludes registered candidates.

Ordering is configured root order, then candidate `relativePath`. `truncated` means a real additional returnable candidate exists beyond the global limit; exact-limit results are not marked truncated. Root failures are returned as structured warnings bounded to `20`, such as `{ "code": "root_missing", "rootId": "default" }`. Registered matching uses `rootId + relativePath`, with same-root name compatibility for legacy registry entries.

### `POST /api/intelligence/discover/register`

Explicit discovered-project registration. Mutation is disabled by default and controlled by `INTELLIGENCE_REGISTRY_WRITES_ENABLED`. Accepted true values are exactly `true`, `1`, and `yes` after trimming and lowercasing; any other value is false.

Request body limit: `64 KiB`. Maximum requested projects: `100`.

Request shape:

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

The client supplies candidate identity only. The service re-runs current discovery against configured roots, validates requested identities against current allowed candidates, and persists server-derived discovery metadata. Unknown or stale candidates are rejected. Repeated registration updates existing discovered entries instead of duplicating them. Human-managed `data/projects.json` is never written; machine-managed state uses `data/discovered-projects.json` and the existing atomic writer.

### `GET /api/intelligence/projects/:name/overview`

Returns a compact bounded project summary for registered manual or discovered projects. The default response uses `rootId` and `relativePath`; it does not include `absolutePath`.

Returned categories:

- project identity, type/support, and registry source;
- stack languages, frameworks, package manager, runtime, and scripts;
- architecture layers, features, entry points, and test commands;
- statistics: `sourceFileCount`, `nodeCount`, `edgeCount`;
- analysis cache state and analyzer capabilities;
- warnings.

Bounds: `scripts <= 50`, `frameworks <= 20`, `layers <= 20`, `features <= 20`, `entryPoints <= 20`, `testCommands <= 20`, `warnings <= 20`. `graphLimit` defaults to `20` and clamps to `1..100`.

Package-manager precedence: `package.json.packageManager`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lock`/`bun.lockb`, `package.json` without evidence as `"unknown"`, and no package metadata as `null`.

Overview does not trigger a full analyzer/index run. It uses current structure/cache information. If no analysis exists, `analysis.status` is `"not_analyzed"` and `nodeCount`/`edgeCount` are `null`. If a cached analyzed graph exists and contains zero nodes or edges, those values are `0`.

## Endpoints used by the tool

The Hermes tool should call these endpoints:

```txt
GET /api/projects
GET /api/projects/:name/structure
GET /api/explore/:project/search?q=...
GET /api/explore/:project/expand?nodeId=...&direction=both|in|out
GET /api/explore/:project/full?nodeLimit=500&edgeLimit=1200
POST /api/index/:project
GET /api/cache/symbols
DELETE /api/cache/symbols
```

## Currently suggested low-level Hermes tools

These are low-level graph/project-map tools for the existing endpoints. They are distinct from planned future high-level Project Intelligence tools.

### `project_map_projects`

Lists the projects available in `hermes-project-map`.

Input:

```json
{}
```

Output:

```json
{
  "projects": [
    {
      "name": "faturas-backend",
      "relativePath": "...",
      "exists": true,
      "csprojCount": 4,
      "slnCount": 1
    }
  ]
}
```

### `project_map_structure`

Gets the structure of a project.

Input:

```json
{
  "project": "faturas-backend"
}
```

Calls:

```txt
GET /api/projects/:name/structure
```

### `project_map_search`

Searches for symbols in a project.

Input:

```json
{
  "project": "faturas-backend",
  "query": "InvoiceCreationService"
}
```

Calls:

```txt
GET /api/explore/:project/search?q=...
```

### `project_map_expand`

Expands the dependencies/references of a node.

Input:

```json
{
  "project": "faturas-backend",
  "nodeId": "...",
  "direction": "both"
}
```

Calls:

```txt
GET /api/explore/:project/expand?nodeId=...&direction=...
```

### `project_map_full_graph`

Gets the full graph with limits.

Input:

```json
{
  "project": "faturas-backend",
  "nodeLimit": 500,
  "edgeLimit": 1200,
  "layers": [],
  "features": []
}
```

Calls:

```txt
GET /api/explore/:project/full?nodeLimit=...&edgeLimit=...
```

## Recommended Python tool shape

In a Hermes core tool or plugin, keep the implementation small:

```python
import json
import os
import urllib.parse
import urllib.request

from tools.registry import registry

BASE_URL = os.getenv("PROJECT_MAP_URL", "http://localhost:8770")


def _request(path: str) -> dict:
    url = f"{BASE_URL}{path}"
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def project_map_search(project: str, query: str) -> str:
    encoded_project = urllib.parse.quote(project, safe="")
    encoded_query = urllib.parse.quote(query, safe="")
    data = _request(f"/api/explore/{encoded_project}/search?q={encoded_query}")
    return json.dumps(data, ensure_ascii=False)
```

## Registration with `registry.register`

Example for `project_map_search`:

```python
registry.register(
    name="project_map_search",
    toolset="project_map",
    schema={
        "name": "project_map_search",
        "description": "Search symbols in a project registered in hermes-project-map.",
        "parameters": {
            "type": "object",
            "properties": {
                "project": {
                    "type": "string",
                    "description": "Registered project name, e.g. faturas-backend."
                },
                "query": {
                    "type": "string",
                    "description": "Symbol or text to search for."
                }
            },
            "required": ["project", "query"]
        }
    },
    handler=lambda args, **kw: project_map_search(
        project=args["project"],
        query=args["query"],
    ),
    check_fn=lambda: True,
)
```

## Hermes configuration

### Environment variable

Add this to the Hermes environment:

```bash
PROJECT_MAP_URL=http://localhost:8770
```

If Hermes runs in another container or host, use the correct hostname:

```bash
PROJECT_MAP_URL=http://hermes-project-map:8770
```

### Toolset

Add the tools to a dedicated toolset:

```txt
project_map
```

Alternatively, include them in existing toolsets only where appropriate.

## Plugin alternative

If you do not want to modify Hermes core, creating a local plugin is the better option.

Suggested structure:

```txt
~/.hermes/plugins/project_map/
  plugin.yaml
  tools/
    project_map_tool.py
```

Advantages:

- does not change Hermes core;
- can be enabled or disabled per profile;
- makes local testing easier;
- fits well if this project is specific to your workflow.

## MCP alternative

Another option is to expose `hermes-project-map` as an MCP server.

Use MCP when:

- you want to consume the same analysis from Hermes, Claude Desktop, Cursor, or other MCP clients;
- you want a standard interface for external tools;
- the project map evolves into an independent service with multiple operations.

Conceptual MCP shape:

```txt
tools/list_projects
tools/project_structure
tools/search_symbols
tools/expand_symbol
tools/full_graph
```

## Future high-level Hermes tools

Hermes high-level `project_*` tools are not implemented yet. When added, they should be thin HTTP clients over this service.

```txt
project_discover
project_overview
project_task_context
project_route_task
project_impact
project_refresh
```

Underlying HTTP support exists today for discovery, discovery registration, and overview. HTTP support does not yet exist for task context, task routing, impact v2, refresh, or ICM-backed workspace indexing. Existing low-level `project_map_*` tools remain the current specialist/compatibility tool tier.

## Important rules for the tool

- The tool must return a valid JSON string.
- It must not print HTML or free-form text on error.
- It must return clear errors when the service is unavailable.
- It must use an explicit timeout.
- It must validate minimum inputs (`project`, `query`, `nodeId`).
- It must not expose sensitive local paths beyond what the API already returns.
- It must keep default limits (`nodeLimit`, `edgeLimit`) to avoid overfilling context.

## Errors the tool should handle

### Service unavailable

Suggested message:

```json
{
  "success": false,
  "error": "project_map_unavailable",
  "message": "hermes-project-map is not reachable at PROJECT_MAP_URL. Start it with npm start or docker compose up."
}
```

### Project not found

Propagate the API error:

```json
{
  "success": false,
  "error": "not_found",
  "message": "Project not found: ..."
}
```

### Response too large

Apply limits:

```json
{
  "nodeLimit": 500,
  "edgeLimit": 1200
}
```

## Acceptance criteria for implementing the tool

- `project_map_projects` lists real projects.
- `project_map_search` works for `faturas-backend`.
- `project_map_expand` expands a node obtained from search.
- `project_map_full_graph` respects `nodeLimit` and `edgeLimit`.
- The service-unavailable error is readable.
- The toolset can be enabled or disabled in Hermes.
- There is no dependency on the UI.

## Suggested implementation plan

### Commit 1 — minimal plugin/tool

```txt
feat(project-map): add Hermes project map tool
```

Includes:

- HTTP client;
- `project_map_projects`;
- `project_map_search`;
- `PROJECT_MAP_URL` configuration.

### Commit 2 — expansion and graph

```txt
feat(project-map): add expand and full graph tools
```

Includes:

- `project_map_expand`;
- `project_map_full_graph`;
- limits and validation.

### Commit 3 — documentation and examples

```txt
docs(project-map): document Hermes tool integration
```

Includes:

- usage examples;
- troubleshooting;
- Docker/local configuration.

## Recommended next step

Create the tool as a local plugin first, not in core. After the input/output shape stabilizes, decide whether it is worth promoting to a Hermes core toolset.
