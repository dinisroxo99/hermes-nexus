# Hermes Nexus plugin installation for Hermes profiles

[← README](../README.md) · [Hermes tool integration](./hermes-tool-integration.md) · [Project ICM](./project-icm.md) · [Adding projects](./adding-projects.md)

[Documentation index](README.md) · [Public architecture](ARCHITECTURE.md) · [Current status](CURRENT_STATUS.md)

## DEV-ADOPTION-1 — approved development adoption

As of 2026-09-24, the delivered repository plugin is
[`integrations/hermes-nexus/`](../integrations/hermes-nexus/), plugin key
`hermes-nexus`, toolset `project_intelligence`, with exactly
`project_task_context` and `project_impact`. Delivery in Git is not installation
or operational acceptance. Publication and six-profile adoption are still
pending; this documentation change performs neither. Step 3 was accepted at
`4d8d23e564e355d84916b93d890762ac0c7498ee`; Step 4 has **not been initiated**.

DEV-ADOPTION-1 authorizes normal development use, including concurrent workers,
in exactly **orchestrator, architect, implementer, tester, reviewer, documenter**.
`default` and `workspace-manager` are excluded from installation, configuration
and instruction changes. The source baseline is
`feat/nexus-profile-integration@10d1f348fd4c6ddbb5319d972c71b426e51e574a`;
installation must use the subsequently published, independently accepted revision,
not assume that baseline has already been published. No new adapter implementation
is required for this two-tool path.

Authority: operator decisions on Kanban `t_779e8e9f` comment 149 and
`t_87a4d9ae` comment 148; additive contract `t_5e427bb2` comment 150.
These supersede the old architect-only restriction for this exact adoption,
not the historical technical findings. **G1 remains REJECTED**;
**OPTION-L-R1/R2 remain OPEN / KNOWN ISSUES — DEFERRED**, currently HIGH severity
and LOW priority/non-blocking for this development adoption. Original finding
severities remain R1 HIGH and R2 MEDIUM. This is risk acceptance, not a fix,
hard cleanup/isolation, absence-of-leaks evidence or production readiness.
See [known issues and subsequent-change triggers](KNOWN_ISSUES.md#dev-adoption-1--current-risk-disposition).

For provenance, schemas, per-role examples and bounded fallback, use the
[current usage contract](hermes-tool-integration.md#dev-adoption-1--two-tool-usage-contract).
The [architect pilot runbook](hermes-nexus-architect-pilot.md) is retained as
historical evidence, not a requirement to repeat the pilot. Hermes owns profiles,
models/providers, dispatch, worktrees and execution; Nexus owns project evidence.

## Revision-pinned installation and configuration

This is the procedure for the later authorized adoption executor, **not a record
of commands executed by this documentation task**. Suggested order: architect
(preserve its existing installation), tester, reviewer, implementer, documenter,
orchestrator. For current CLI details consult the
[official Hermes reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)
and the installed runtime's help; the command forms below were checked against
local help on 2026-09-24.

1. Confirm the published accepted full SHA, actual target profile home and clean
   source identity. Inventory only affected non-secret files, hashes, instruction
   paragraphs, and persisted configuration keys **including presence as well as
   value**. A resolved `config get` value cannot prove that a key was absent on disk.
   Do not dump configuration or read secrets. Architect already has a pilot
   installation: capture that real prestate, not an assumed empty directory.
2. Copy only these five files from that immutable revision into the flat directory
   `/home/dinis/.hermes/profiles/<profile>/plugins/hermes-nexus/`:
   `plugin.yaml`, `__init__.py`, `schemas.py`, `client.py`, `tools.py`.
   Verify source and installed hashes individually against the accepted commit.
   Do not use the old nested `project-map/project-map` layout or a symlink to the
   moving writer. Inventory collisions before replacing any existing file.
3. Check the manifest and existing interpreter/dependencies before enabling.
   The retained Option L baseline uses HTTPX 0.28.1; record HTTPX/httpcore/AnyIO
   and interpreter versions and assess drift. Missing dependencies are not
   permission to install/update them or substitute a transport.
4. Use profile-pinned CLI operations, never YAML hand edits, a global profile
   switch, provider/model changes, or an override grant. `<profile>` below is a
   placeholder for exactly one approved fleet member, not a literal argument:

   ```text
   hermes -p <profile> config get plugins.entries.hermes-nexus.settings.base_url --json
   hermes -p <profile> config get platform_toolsets.cli --json
   hermes -p <profile> config get known_plugin_toolsets --json
   hermes -p <profile> config get agent.disabled_toolsets --json
   hermes -p <profile> config set plugins.entries.hermes-nexus.settings.base_url http://127.0.0.1:8770
   hermes -p <profile> plugins enable hermes-nexus --no-allow-tool-override
   hermes -p <profile> config set platform_toolsets.cli '<complete preserved list plus project_intelligence once>'
   ```

   The final argument must be replaced with the actual serialized list; it is not
   a fixed fleet-wide default. Preserve all unrelated selectors and restrictions.
   Capture/read back changes to `plugins.enabled`, `plugins.disabled`, the plugin
   entry (including override state), and affected toolset keys. Resolve any
   pre-existing override permission explicitly rather than assuming enable removed
   it. Do not copy the historical architect selector list to other profiles.
5. **Omission is not reliable exclusion.** The verified runtime automatically
   includes unknown plugin toolsets unless default-off or already recorded as
   known for that platform and omitted from its saved list. Preserve/reconcile
   `known_plugin_toolsets` and `agent.disabled_toolsets` where affected; the latter
   is a final veto. CLI tool selection is by toolset, not arbitrary individual
   Python tool name. Verify effective catalogues and exclusions on the relevant
   CLI/worker surfaces; do not silently expose new gateway/cron surfaces.
6. Add only the approved role-specific usage paragraph at the existing instruction
   location. Verify installed hashes, exact non-secret configuration deltas and
   both strict schemas in **new sessions/workers**. Do not reload this conversation
   or restart gateways. Installation, exposure and successful domain requests are
   distinct evidence. With no legitimately available service, record unavailable
   and use bounded fallback; do not start one automatically.

## Delta rollback and update

Updates use a newly published accepted SHA, the same five-file hash check and a
fresh prestate inventory. Rollback restores exact persisted presence **and**
values, file contents/hashes, and only the changed instruction paragraphs:

```text
hermes -p <profile> config set <previously-present-allowlisted-key> '<exact previous serialized value>'
hermes -p <profile> config unset <previously-absent-allowlisted-key>
```

These are templates, not executable keys. Restore whole affected lists exactly,
preserving unrelated state and prior restrictions; remove only newly introduced,
inventoried artifacts. Restore the architect's existing pilot files/settings,
never delete them as a new installation. `hermes -p <profile> plugins remove
hermes-nexus` removes the plugin **directory** and does not clear tool selectors;
it is not an exact-delta rollback by itself and is unsuitable for restoring an
existing installation. Read back the restored allowlist and file hashes. Never
signal unowned processes or terminate other sessions. Disk restoration takes
effect in new sessions, not in already loaded workers.

## INFRA-1 — approved, implementation pending

Persistent automatic startup is **APPROVED / IMPLEMENTATION PENDING**, after
candidate verification/publication. The operator approved the comment 152 proposal
on `t_5e427bb2`; coordinator steering on `t_214311ed` records that approval, not
deployment. Implementation and independent verification belong to separate future
tasks; this task changes documentation only. The approved design is a `dinis` user
systemd unit `~/.config/systemd/user/hermes-nexus.service`, wanted by
`default.target`, using the already observed lingering configuration. It starts
when the WSL distribution/user manager starts, **not at Windows boot**, and is
not a 24/7 guarantee: systemd services alone do not keep WSL alive. No root unit,
Windows task, timer or lingering change is implied. See
[Microsoft's WSL systemd documentation](https://learn.microsoft.com/en-us/windows/wsl/systemd)
and [WSL lifetime limitations](https://devblogs.microsoft.com/commandline/systemd-support-is-now-available-in-wsl/).

Approved service checkout/working-directory design (not yet provisioned here):
`/home/dinis/projects/hermes-nexus-service`, pinned to a published accepted SHA,
separate from the writer and human checkout; no startup pull/automatic update.
The supported command is `HOST=127.0.0.1 PORT=8770 npm start` (do not execute
without service authority). The server otherwise defaults to wildcard bind.
The approved unit design uses `/home/dinis/.local/bin/npm start`, explicit minimal PATH,
`Restart=on-failure`, a 5-second delay, and a 3-start/60-second limit; logs remain
in the local user journal with no new retention guarantee. Process supervision
does not fix plugin HTTPX lifecycle findings.

Before startup, the separately assigned executor must identify and preserve the
approved non-secret `DATA_DIR` and root mappings through bounded inspection and
resolve any ambiguity so the new checkout cannot silently create an empty
registry or broaden roots. Those actual paths remain unverified here. Do not copy
secrets, migrate IDs or install dependencies implicitly. The operator stops their
own tmux service (or specifically authorizes a future executor to stop it) before
the unit assumes `127.0.0.1:8770`; unknown port ownership stops the transition, never
justifies killing a process. Update/rollback preserves data/roots and the prior
SHA/unit configuration, operating only on the explicitly owned unit. Live bind,
startup and rollback results require later independent verification.

The previous persistent manual window (PMW) expired at
**2026-09-24T11:16:43+01:00**. No extension, shutdown or live-state check is
demonstrated here. Expired authorization does **not** establish whether a process
is still running. No domain or health request was made for this documentation.

## Legacy catalogue and bounded provenance

All nine earlier names remain **LEGACY/DEFERRED**, not delivered by the tracked
`hermes-nexus` plugin:

| Historical query tools | Historical mutators |
|---|---|
| `project_map_health`, `project_map_projects`, `project_map_structure`, `project_map_search`, `project_map_expand`, `project_map_full_graph`, `project_map_cache_stats` | `project_map_index`, `project_map_clear_cache` |

The bounded local search at `10d1f348fd4c6ddbb5319d972c71b426e51e574a`
(`t_5e427bb2`, comment 151) inspected tracked `integrations/`, `plugins/`, `tools/`,
`scripts/`, `src/` excluding vendor, `tests/`, these two Hermes guides, README and
package.json; history queries were capped at 160 over 157 locally reachable
commits, with a Python/plugin-manifest/legacy-name inventory. No fetch, external
installations, unreachable objects or backups were searched. It found documentary
examples, **no eligible standalone legacy adapter in that scope**:

- `47cb65d618cf6224e88ec04625282f8f87318b05:docs/hermes-plugin-installation.md`,
  blob `aef1271be7282489632dcd91fa96d94ad50b99d5`; at the inspected baseline the
  guide blob was `9f24ff0e59bf5c10e7e5c38ec802167fd872d64b`.
- `32b2999d763e452286bbcf14dcbbb5ffa9b38079:docs/hermes-tool-integration.md`,
  proposal blob `afe77d3dc7657a4ce0505b19b62be5e896ba923b`.

The corresponding API routes/browser capabilities still exist; missing adapter
delivery is not missing server functionality. The examples allow arbitrary
URL/environment configuration, default urllib proxy/redirect behavior, unbounded
reads, raw errors, mixed mutators and no equivalent revision/worktree binding.
Do not promote or reconstruct them without new approval. Legacy deferral does
**not block two-tool publication/adoption**.

`project_map_admin` is **conditional future separation only**, if an eligible
adapter is later recovered: retain tool names and expose mutators only to
implementer/tester, with task-specific operation/project/environment authority.
Indexing may copy sources, run restore/indexer and write an index; cache clearing
may affect every project. Global purge requires specific permission. Installation,
empty results and failed queries never authorize mutations. No administrative
toolset is installed or executed by this contract.

## Historical setup example — not the current installation procedure

The original low-level example below is preserved for provenance, not endorsed
for execution. Its profile names, nested paths, environment/YAML instructions,
startup, indexing, reset and removal advice do not govern DEV-ADOPTION-1.
Use the revision-pinned procedure above instead.

<details>
<summary>Archived project-map example (LEGACY/DEFERRED; do not install)</summary>

## Purpose

This guide explains how to install `hermes-nexus` as a local Hermes plugin so Hermes agents can query the project map directly through tools, without using the web UI.

After this setup, a Hermes profile can call tools such as:

- `project_map_health`
- `project_map_projects`
- `project_map_structure`
- `project_map_search`
- `project_map_expand`
- `project_map_full_graph`
- `project_map_index`
- `project_map_cache_stats`
- `project_map_clear_cache`

The plugin is intentionally small. It does not reimplement the analyzer. It calls the existing `hermes-nexus` HTTP API.

The tools in this example are the low-level `project_map_*` compatibility/specialist
client tier. The service also exposes discovery, guarded registration, overview
and read-only `POST /api/intelligence/projects/:projectId/task-context`. That
endpoint requires an existing persisted ID; it is not a tool implemented by the
plugin example below. Overview includes only a compact ICM summary. Dedicated
ICM and route-task endpoints, high-level tools and automatic guard integration
remain outside this example. See [Current status](CURRENT_STATUS.md) and the
[Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md).

Canonical ICM indexing stays inside `hermes-nexus`. Hermes plugins should remain thin HTTP clients and must not duplicate AGENT.md parsing, Workspace Index scanning, contextual document indexing, task routing, or policy enforcement. See [Project ICM architecture](./project-icm.md).

## Architecture

```txt
Hermes agent/profile
  └─ project_map toolset
      └─ local Python plugin
          └─ HTTP requests to hermes-nexus
              ├─ GET  /api/projects
              ├─ GET  /api/projects/:name/structure
              ├─ GET  /api/explore/:project/search?q=...
              ├─ GET  /api/explore/:project/expand?nodeId=...&direction=...
              ├─ GET  /api/explore/:project/full?nodeLimit=...&edgeLimit=...
              ├─ POST /api/index/:project
              ├─ GET  /api/cache/symbols
              └─ DELETE /api/cache/symbols
```

## Prerequisites

You need:

1. Hermes Agent installed and working.
2. `hermes-nexus` running locally or in Docker.
3. At least one Hermes profile where you want the tools to be available.
4. Python available in the same environment that runs Hermes.

Check Hermes:

```bash
hermes --version
hermes profile list
```

Check `hermes-nexus`:

```bash
curl http://localhost:8770/api/health
```

Expected response shape:

```json
{
  "ok": true,
  "data": {
    "status": "ok"
  }
}
```

If the service is running in Docker, start it first:

```bash
docker compose up --build -d
```

Then verify:

```bash
curl http://localhost:8770/api/health
```

## Recommended plugin location

Install the plugin per Hermes profile:

```txt
~/.hermes/profiles/<profile-name>/plugins/project-map/project-map/
  plugin.yaml
  __init__.py
  tools.py
```

Example for a profile named `project-map-main`:

```txt
~/.hermes/profiles/project-map-main/plugins/project-map/project-map/
  plugin.yaml
  __init__.py
  tools.py
```

Why per profile?

- It avoids changing Hermes core.
- It lets each profile enable or disable the tool independently.
- It keeps local workflow-specific tools isolated.
- It is easy to copy to other project profiles.

## Step 1 — choose the profiles

List profiles:

```bash
hermes profile list
```

Example profiles for this project:

```txt
project-map-main
project-map-architect
project-map-coder
project-map-commenter
project-map-documenter
project-map-git-flow
project-map-reviewer
project-map-tester
```

You can install the plugin into one profile first, then copy it to the others.

## Step 2 — create the plugin folder

Replace `<profile-name>` with the profile you want to configure:

```bash
PROFILE=project-map-main
PLUGIN_DIR="$HOME/.hermes/profiles/$PROFILE/plugins/project-map/project-map"
mkdir -p "$PLUGIN_DIR"
```

On PowerShell, use:

```powershell
$ProfileName = "project-map-main"
$PluginDir = "$env:USERPROFILE\.hermes\profiles\$ProfileName\plugins\project-map\project-map"
New-Item -ItemType Directory -Force -Path $PluginDir
```

## Step 3 — create `plugin.yaml`

Create:

```txt
~/.hermes/profiles/<profile-name>/plugins/project-map/project-map/plugin.yaml
```

Content:

```yaml
name: project-map
version: 0.1.0
description: Hermes Nexus tools for querying project structure, symbol search, graph expansion, and indexing through the local HTTP service.
provides_tools:
  - project_map_health
  - project_map_projects
  - project_map_structure
  - project_map_search
  - project_map_expand
  - project_map_full_graph
  - project_map_index
  - project_map_cache_stats
  - project_map_clear_cache
```

PowerShell example:

```powershell
@'
name: project-map
version: 0.1.0
description: Hermes Nexus tools for querying project structure, symbol search, graph expansion, and indexing through the local HTTP service.
provides_tools:
  - project_map_health
  - project_map_projects
  - project_map_structure
  - project_map_search
  - project_map_expand
  - project_map_full_graph
  - project_map_index
  - project_map_cache_stats
  - project_map_clear_cache
'@ | Set-Content -Encoding UTF8 "$PluginDir\plugin.yaml"
```

## Step 4 — create `__init__.py`

Create:

```txt
~/.hermes/profiles/<profile-name>/plugins/project-map/project-map/__init__.py
```

Content:

```python
"""Hermes Nexus plugin registration."""

from . import tools


def register(ctx):
    for spec in tools.TOOL_SPECS:
        ctx.register_tool(
            name=spec["name"],
            toolset="project_map",
            schema=spec["schema"],
            handler=spec["handler"],
        )
```

PowerShell example:

```powershell
@'
"""Hermes Nexus plugin registration."""

from . import tools


def register(ctx):
    for spec in tools.TOOL_SPECS:
        ctx.register_tool(
            name=spec["name"],
            toolset="project_map",
            schema=spec["schema"],
            handler=spec["handler"],
        )
'@ | Set-Content -Encoding UTF8 "$PluginDir\__init__.py"
```

## Step 5 — create `tools.py`

Create:

```txt
~/.hermes/profiles/<profile-name>/plugins/project-map/project-map/tools.py
```

Content:

```python
"""Hermes Nexus tool handlers.

The tools keep hermes-nexus as the source of truth and call its HTTP API.
Set PROJECT_MAP_URL when the service is not reachable at http://localhost:8770.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_BASE_URL = "http://localhost:8770"
DEFAULT_TIMEOUT_SECONDS = 30
MAX_NODE_LIMIT = 5000
MAX_EDGE_LIMIT = 10000


def _json_response(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _base_url(args: dict[str, Any]) -> str:
    value = str(args.get("base_url") or os.getenv("PROJECT_MAP_URL") or DEFAULT_BASE_URL).strip()
    return value.rstrip("/") or DEFAULT_BASE_URL


def _int_arg(args: dict[str, Any], name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(args.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(value, maximum))


def _csv(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ",".join(str(item).strip() for item in value if str(item).strip())
    return str(value).strip()


def _require_string(args: dict[str, Any], name: str) -> str:
    value = str(args.get(name) or "").strip()
    if not value:
        raise ValueError(f"`{name}` is required")
    return value


def _request(
    args: dict[str, Any],
    path: str,
    *,
    method: str = "GET",
    query: dict[str, Any] | None = None,
) -> str:
    base_url = _base_url(args)
    query = {key: value for key, value in (query or {}).items() if value not in (None, "", [])}
    encoded_query = urllib.parse.urlencode(query, doseq=True)
    url = f"{base_url}{path}"
    if encoded_query:
        url = f"{url}?{encoded_query}"

    request = urllib.request.Request(url, method=method)

    try:
        with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
            return body or _json_response({"ok": True, "data": None})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(body) if body else {}
        except json.JSONDecodeError:
            payload = {"message": body}
        return _json_response({
            "ok": False,
            "error": payload.get("error") or "project_map_http_error",
            "message": payload.get("message") or f"hermes-nexus returned HTTP {exc.code}",
            "status": exc.code,
            "base_url": base_url,
        })
    except urllib.error.URLError as exc:
        return _json_response({
            "ok": False,
            "error": "project_map_unavailable",
            "message": (
                "hermes-nexus is not reachable. Start it with `npm start` "
                "or `docker compose up -d`, or set PROJECT_MAP_URL."
            ),
            "base_url": base_url,
            "details": str(exc.reason),
        })
    except TimeoutError:
        return _json_response({
            "ok": False,
            "error": "project_map_timeout",
            "message": f"hermes-nexus did not respond within {DEFAULT_TIMEOUT_SECONDS}s",
            "base_url": base_url,
        })


def _project_path(project: str) -> str:
    return urllib.parse.quote(project, safe="")


def project_map_health(args: dict[str, Any], **_: Any) -> str:
    """Check whether the hermes-nexus service is reachable."""
    return _request(args, "/api/health")


def project_map_projects(args: dict[str, Any], **_: Any) -> str:
    """List projects registered in hermes-nexus."""
    return _request(args, "/api/projects")


def project_map_structure(args: dict[str, Any], **_: Any) -> str:
    """Return structure/layer/feature information for one project."""
    try:
        project = _require_string(args, "project")
    except ValueError as exc:
        return _json_response({"ok": False, "error": "invalid_input", "message": str(exc)})
    return _request(args, f"/api/projects/{_project_path(project)}/structure")


def project_map_search(args: dict[str, Any], **_: Any) -> str:
    """Search symbols in one project."""
    try:
        project = _require_string(args, "project")
        query = _require_string(args, "query")
    except ValueError as exc:
        return _json_response({"ok": False, "error": "invalid_input", "message": str(exc)})
    return _request(args, f"/api/explore/{_project_path(project)}/search", query={"q": query})


def project_map_expand(args: dict[str, Any], **_: Any) -> str:
    """Expand dependencies/references around a graph node."""
    try:
        project = _require_string(args, "project")
        node_id = _require_string(args, "nodeId")
    except ValueError as exc:
        return _json_response({"ok": False, "error": "invalid_input", "message": str(exc)})

    direction = str(args.get("direction") or "both").strip()
    if direction not in {"both", "in", "out"}:
        return _json_response({
            "ok": False,
            "error": "invalid_input",
            "message": "`direction` must be one of: both, in, out",
        })

    return _request(
        args,
        f"/api/explore/{_project_path(project)}/expand",
        query={"nodeId": node_id, "direction": direction},
    )


def project_map_full_graph(args: dict[str, Any], **_: Any) -> str:
    """Return a bounded full graph for one project."""
    try:
        project = _require_string(args, "project")
    except ValueError as exc:
        return _json_response({"ok": False, "error": "invalid_input", "message": str(exc)})

    node_limit = _int_arg(args, "nodeLimit", 500, 1, MAX_NODE_LIMIT)
    edge_limit = _int_arg(args, "edgeLimit", 1200, 1, MAX_EDGE_LIMIT)
    return _request(
        args,
        f"/api/explore/{_project_path(project)}/full",
        query={
            "nodeLimit": node_limit,
            "edgeLimit": edge_limit,
            "layers": _csv(args.get("layers")),
            "features": _csv(args.get("features")),
        },
    )


def project_map_index(args: dict[str, Any], **_: Any) -> str:
    """Trigger indexing for one project."""
    try:
        project = _require_string(args, "project")
    except ValueError as exc:
        return _json_response({"ok": False, "error": "invalid_input", "message": str(exc)})
    return _request(args, f"/api/index/{_project_path(project)}", method="POST")


def project_map_cache_stats(args: dict[str, Any], **_: Any) -> str:
    """Return symbol cache statistics."""
    return _request(args, "/api/cache/symbols")


def project_map_clear_cache(args: dict[str, Any], **_: Any) -> str:
    """Clear all symbol cache entries or one project's cache."""
    query = {}
    if args.get("project"):
        query["project"] = str(args.get("project")).strip()
    return _request(args, "/api/cache/symbols", method="DELETE", query=query)


def _base_url_property() -> dict[str, Any]:
    return {
        "type": "string",
        "description": "Optional service URL. Defaults to PROJECT_MAP_URL or http://localhost:8770.",
    }


def _schema(name: str, description: str, properties: dict[str, Any] | None = None, required: list[str] | None = None) -> dict[str, Any]:
    props = {"base_url": _base_url_property()}
    props.update(properties or {})
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": props,
            "required": required or [],
        },
    }


TOOL_SPECS = [
    {
        "name": "project_map_health",
        "schema": _schema("project_map_health", "Check whether the Hermes Nexus HTTP service is reachable."),
        "handler": project_map_health,
    },
    {
        "name": "project_map_projects",
        "schema": _schema("project_map_projects", "List projects registered in Hermes Nexus."),
        "handler": project_map_projects,
    },
    {
        "name": "project_map_structure",
        "schema": _schema(
            "project_map_structure",
            "Get structure, layer, and feature information for a registered project.",
            {"project": {"type": "string", "description": "Registered project name."}},
            ["project"],
        ),
        "handler": project_map_structure,
    },
    {
        "name": "project_map_search",
        "schema": _schema(
            "project_map_search",
            "Search symbols in a registered project.",
            {
                "project": {"type": "string", "description": "Registered project name."},
                "query": {"type": "string", "description": "Symbol or text to search for."},
            },
            ["project", "query"],
        ),
        "handler": project_map_search,
    },
    {
        "name": "project_map_expand",
        "schema": _schema(
            "project_map_expand",
            "Expand dependencies/references around a node returned by project_map_search or project_map_full_graph.",
            {
                "project": {"type": "string", "description": "Registered project name."},
                "nodeId": {"type": "string", "description": "Graph node id to expand."},
                "direction": {
                    "type": "string",
                    "description": "Expansion direction.",
                    "enum": ["both", "in", "out"],
                    "default": "both",
                },
            },
            ["project", "nodeId"],
        ),
        "handler": project_map_expand,
    },
    {
        "name": "project_map_full_graph",
        "schema": _schema(
            "project_map_full_graph",
            "Get a bounded full graph for a registered project.",
            {
                "project": {"type": "string", "description": "Registered project name."},
                "nodeLimit": {"type": "integer", "description": "Maximum nodes to return.", "default": 500},
                "edgeLimit": {"type": "integer", "description": "Maximum edges to return.", "default": 1200},
                "layers": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional layer filters.",
                },
                "features": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional feature filters.",
                },
            },
            ["project"],
        ),
        "handler": project_map_full_graph,
    },
    {
        "name": "project_map_index",
        "schema": _schema(
            "project_map_index",
            "Trigger project indexing in Hermes Nexus.",
            {"project": {"type": "string", "description": "Registered project name."}},
            ["project"],
        ),
        "handler": project_map_index,
    },
    {
        "name": "project_map_cache_stats",
        "schema": _schema("project_map_cache_stats", "Get Hermes Nexus symbol cache statistics."),
        "handler": project_map_cache_stats,
    },
    {
        "name": "project_map_clear_cache",
        "schema": _schema(
            "project_map_clear_cache",
            "Clear all symbol cache entries, or one project's cache when project is provided.",
            {"project": {"type": "string", "description": "Optional registered project name."}},
        ),
        "handler": project_map_clear_cache,
    },
]
```

## Step 6 — validate Python syntax

Linux/macOS/WSL:

```bash
python3 -m py_compile \
  "$HOME/.hermes/profiles/$PROFILE/plugins/project-map/project-map/tools.py" \
  "$HOME/.hermes/profiles/$PROFILE/plugins/project-map/project-map/__init__.py"
```

PowerShell:

```powershell
python -m py_compile "$PluginDir\tools.py" "$PluginDir\__init__.py"
```

If `python` is not available on Windows, try:

```powershell
py -m py_compile "$PluginDir\tools.py" "$PluginDir\__init__.py"
```

## Step 7 — enable the plugin for the profile

```bash
hermes -p "$PROFILE" plugins enable project-map
```

PowerShell:

```powershell
hermes -p $ProfileName plugins enable project-map
```

Expected output includes something like:

```txt
✓ Plugin project-map/project-map enabled. Takes effect on next session.
```

The plugin does not override built-in tools. If Hermes asks whether to allow built-in tool overrides, choose **no** or leave the default.

## Step 8 — confirm the toolset is visible

```bash
hermes -p "$PROFILE" plugins list --plain --no-bundled
hermes -p "$PROFILE" tools list
```

Expected plugin list includes:

```txt
enabled  user  0.1.0  project-map
```

Expected toolset list includes:

```txt
✓ enabled  project_map  🔌 Project Map
```

## Step 9 — restart or open a new Hermes session

Plugin changes only apply to new sessions.

If you are inside a Hermes session, run:

```txt
/reset
```

Or start a new session:

```bash
hermes -p "$PROFILE"
```

PowerShell:

```powershell
hermes -p $ProfileName
```

## Step 10 — test the tool from Hermes

In a new Hermes session, ask:

```txt
Call project_map_health and tell me whether ok is true.
```

Expected result:

```txt
true
```

You can also test non-interactively:

```bash
hermes -p "$PROFILE" chat --yolo --max-turns 2 -q "Call project_map_health and report only whether ok is true. Do not use terminal."
```

## Step 11 — copy the plugin to other profiles

After one profile works, copy it to other profiles.

Linux/macOS/WSL example:

```bash
SOURCE_PROFILE=project-map-main
for PROFILE in \
  project-map-architect \
  project-map-coder \
  project-map-commenter \
  project-map-documenter \
  project-map-git-flow \
  project-map-reviewer \
  project-map-tester
 do
  mkdir -p "$HOME/.hermes/profiles/$PROFILE/plugins"
  rm -rf "$HOME/.hermes/profiles/$PROFILE/plugins/project-map"
  cp -a "$HOME/.hermes/profiles/$SOURCE_PROFILE/plugins/project-map" \
        "$HOME/.hermes/profiles/$PROFILE/plugins/project-map"
  hermes -p "$PROFILE" plugins enable project-map
 done
```

PowerShell example:

```powershell
$SourceProfile = "project-map-main"
$Profiles = @(
  "project-map-architect",
  "project-map-coder",
  "project-map-commenter",
  "project-map-documenter",
  "project-map-git-flow",
  "project-map-reviewer",
  "project-map-tester"
)

foreach ($ProfileName in $Profiles) {
  $Source = "$env:USERPROFILE\.hermes\profiles\$SourceProfile\plugins\project-map"
  $DestRoot = "$env:USERPROFILE\.hermes\profiles\$ProfileName\plugins"
  $Dest = "$DestRoot\project-map"

  New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
  if (Test-Path $Dest) {
    Remove-Item -Recurse -Force $Dest
  }
  Copy-Item -Recurse -Force $Source $Dest
  hermes -p $ProfileName plugins enable project-map
}
```

Verify all profiles:

```bash
for PROFILE in \
  project-map-main \
  project-map-architect \
  project-map-coder \
  project-map-commenter \
  project-map-documenter \
  project-map-git-flow \
  project-map-reviewer \
  project-map-tester
 do
  printf '%s: ' "$PROFILE"
  hermes -p "$PROFILE" plugins list --plain --no-bundled | grep project-map || true
 done
```

## Step 12 — configure `PROJECT_MAP_URL` when needed

By default the plugin uses:

```txt
http://localhost:8770
```

Use this when Hermes and `hermes-nexus` run on the same host.

If the service runs elsewhere, set `PROJECT_MAP_URL` before starting Hermes.

### Local shell

```bash
export PROJECT_MAP_URL="http://localhost:8770"
hermes -p project-map-main
```

PowerShell:

```powershell
$env:PROJECT_MAP_URL="http://localhost:8770"
hermes -p project-map-main
```

### Docker service from host Hermes

If `hermes-nexus` is published to the host port `8770`:

```bash
export PROJECT_MAP_URL="http://localhost:8770"
```

### Hermes running in another container

If Hermes runs in a container and needs to reach the host Docker service:

```bash
export PROJECT_MAP_URL="http://host.docker.internal:8770"
```

If Hermes and `hermes-nexus` run in the same Compose network:

```bash
export PROJECT_MAP_URL="http://hermes-nexus:8770"
```

Always verify from the same environment that runs Hermes:

```bash
curl "$PROJECT_MAP_URL/api/health"
```

## Tool reference

### `project_map_health`

Checks whether the service is reachable.

Input:

```json
{}
```

Optional:

```json
{
  "base_url": "http://localhost:8770"
}
```

Calls:

```txt
GET /api/health
```

### `project_map_projects`

Lists registered projects.

Input:

```json
{}
```

Calls:

```txt
GET /api/projects
```

### `project_map_structure`

Returns project structure, layers, features, and subdivision information.

Input:

```json
{
  "project": "my-project"
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
  "project": "my-project",
  "query": "InvoiceService"
}
```

Calls:

```txt
GET /api/explore/:project/search?q=InvoiceService
```

### `project_map_expand`

Expands dependencies/references around a node returned by search or full graph.

Input:

```json
{
  "project": "my-project",
  "nodeId": "ts-abc123",
  "direction": "both"
}
```

Allowed directions:

```txt
both
in
out
```

Calls:

```txt
GET /api/explore/:project/expand?nodeId=...&direction=both
```

### `project_map_full_graph`

Returns a bounded graph.

Input:

```json
{
  "project": "my-project",
  "nodeLimit": 500,
  "edgeLimit": 1200,
  "layers": [],
  "features": []
}
```

Limits are clamped in the plugin:

```txt
nodeLimit: 1..5000
edgeLimit: 1..10000
```

Calls:

```txt
GET /api/explore/:project/full?nodeLimit=500&edgeLimit=1200
```

### `project_map_index`

Triggers indexing for a project.

Input:

```json
{
  "project": "my-project"
}
```

Calls:

```txt
POST /api/index/:project
```

Use this before symbol search for analyzers that need indexing.

### `project_map_cache_stats`

Returns symbol cache statistics.

Input:

```json
{}
```

Calls:

```txt
GET /api/cache/symbols
```

### `project_map_clear_cache`

Clears all cache entries or one project cache.

Input for all cache:

```json
{}
```

Input for one project:

```json
{
  "project": "my-project"
}
```

Calls:

```txt
DELETE /api/cache/symbols
DELETE /api/cache/symbols?project=my-project
```

## Example agent prompts

List projects:

```txt
Use project_map_projects to list the projects available in Hermes Nexus.
```

Search a symbol:

```txt
Use project_map_search in project "my-project" to find "InvoiceService".
```

Expand a symbol after search:

```txt
Use project_map_search to find "InvoiceService" in "my-project". Then use project_map_expand on the matching node with direction "both".
```

Get a bounded graph:

```txt
Use project_map_full_graph for "my-project" with nodeLimit 300 and edgeLimit 800. Summarize the main layers and dependencies.
```

## Troubleshooting

### `project_map` toolset is not listed

Check plugin location:

```bash
find "$HOME/.hermes/profiles/<profile-name>/plugins/project-map" -maxdepth 3 -type f
```

Expected:

```txt
plugin.yaml
__init__.py
tools.py
```

Check plugin status:

```bash
hermes -p <profile-name> plugins list --plain --no-bundled
```

Enable it:

```bash
hermes -p <profile-name> plugins enable project-map
```

Start a new Hermes session or run `/reset`.

### `project_map_unavailable`

The plugin cannot reach the HTTP service.

Check service:

```bash
curl http://localhost:8770/api/health
```

If that fails, start the project map:

```bash
npm start
```

or:

```bash
docker compose up --build -d
```

If Hermes runs somewhere else, set:

```bash
export PROJECT_MAP_URL="http://correct-host:8770"
```

### Project not found

List projects:

```txt
Use project_map_projects.
```

If the project is missing, register it with the project scripts. See [Adding projects](./adding-projects.md).

### Empty search results

Try:

1. Confirm the project exists with `project_map_projects`.
2. Confirm the structure with `project_map_structure`.
3. Run `project_map_index` if the analyzer requires indexing.
4. Search a broader term.

### Response too large

Use lower limits:

```json
{
  "nodeLimit": 200,
  "edgeLimit": 400
}
```

### Plugin edits do not take effect

Start a new session:

```bash
hermes -p <profile-name>
```

Or inside Hermes:

```txt
/reset
```

Tools and plugin changes are loaded at session start.

## Uninstall

Disable the plugin:

```bash
hermes -p <profile-name> plugins disable project-map
```

Remove plugin files:

```bash
rm -rf "$HOME/.hermes/profiles/<profile-name>/plugins/project-map"
```

PowerShell:

```powershell
hermes -p $ProfileName plugins disable project-map
Remove-Item -Recurse -Force "$env:USERPROFILE\.hermes\profiles\$ProfileName\plugins\project-map"
```

Start a new Hermes session after removing it.

## Maintenance notes

- Keep the plugin as a thin HTTP client.
- Do not duplicate analyzer logic inside the plugin.
- Add new tools only when the HTTP API has a stable endpoint.
- Keep outputs as JSON strings.
- Keep default graph limits conservative to avoid filling the agent context.
- Do not put secrets in `plugin.yaml`, `__init__.py`, or `tools.py`.
- Use `PROJECT_MAP_URL` for environment-specific configuration.

## Acceptance checklist

A profile is correctly configured when all of this is true:

```txt
[ ] hermes-nexus is running.
[ ] curl http://localhost:8770/api/health returns ok=true.
[ ] plugin.yaml exists under the profile plugin folder.
[ ] __init__.py exists under the profile plugin folder.
[ ] tools.py exists under the profile plugin folder.
[ ] python py_compile passes for tools.py and __init__.py.
[ ] hermes -p <profile> plugins list shows project-map enabled.
[ ] hermes -p <profile> tools list shows project_map enabled.
[ ] a new Hermes session can call project_map_health.
[ ] project_map_projects returns the expected project list.
```

</details>
