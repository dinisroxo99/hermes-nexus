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

## Current Project Intelligence foundation status

Implemented in Phase 0:

- centralized project configuration for `DATA_DIR`, `PROJECTS_ROOT`, `PROJECTS_ROOT_CONTAINER`, and JSON-only `PROJECTS_ROOTS`;
- trusted configured-root normalization and untrusted relative project-path validation;
- manual/discovered/effective registry separation;
- existing project lookup/listing over the effective runtime registry;
- atomic persistence helper for the future machine-managed discovered registry.

Not yet implemented:

- automatic project discovery;
- `/api/intelligence/*` endpoints;
- project overview, task context, task routing, ICM, or impact v2;
- high-level Hermes `project_discover`, `project_overview`, `project_task_context`, `project_route_task`, `project_impact`, or `project_refresh` tools;
- Hermes Agent OS orchestration or policy enforcement.

The currently available integration surface is still the existing low-level project map HTTP API documented below.

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

## Planned future high-level tools

After the corresponding HTTP endpoints exist, Hermes can add thin high-level tools such as:

```txt
project_discover
project_overview
project_task_context
project_route_task
project_impact
project_refresh
```

These tools are planned only. They are not available from this service yet and should not be documented as installed Hermes tools until the HTTP contracts are implemented.

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
