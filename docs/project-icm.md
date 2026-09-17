# Project ICM architecture

[← README](../README.md) · [Hermes integration](./hermes-tool-integration.md) · [Execution](./analyzers-execution.md)

## Purpose

The Project ICM foundation describes coordination metadata for one already-resolved project. It is deterministic, bounded, and on-demand. It does not run agents, route tasks, enforce policy, or write a persistent ICM cache/index.

Current implementation modules:

- `src/lib/agent-manifest.js`: canonical `AGENT.md` parser.
- `src/lib/workspace-index.js`: canonical Workspace Index from `AGENT.md` manifests.
- `src/lib/icm-documents.js`: contextual ICM Document Index.
- `src/lib/icm-index.js`: combined Project ICM Index.
- `src/lib/project-overview.js`: compact ICM health/count summary in Project Overview.

## Authority model

Canonical ICM files have separate roles:

| File | Role | Authority |
|---|---|---|
| `PROJECT.md` | Project-level contextual identity/knowledge. | Context only. |
| `AGENTS.md` | Contextual Hermes/LLM instructions. | Context only. |
| `AGENT.md` | Workspace execution contract in YAML front matter plus contextual Markdown body. | YAML front matter is machine-authoritative; Markdown body is context only. |
| `CONTEXT.md` | Local/domain/workspace contextual knowledge. | Context only. |
| ADR Markdown | Architectural decision context. | Context only. |

Most important rule:

```txt
AGENT.md YAML front matter = machine-authoritative contract
AGENT.md Markdown body    = context only
PROJECT.md / AGENTS.md / CONTEXT.md / ADRs = context only
```

Contextual prose cannot override machine-authoritative fields, including:

- `executor`
- `owner`
- `reviewers`
- `permissions`
- `scope`
- `preconditions`
- `routing`

The service can describe `executor.required`, permissions, scope, and routing metadata. It does not enforce them. Future Hermes Agent OS policy enforcement owns ALLOW/DENY/REROUTE decisions.

## `AGENT.md` schema v1

`AGENT.md` must start with YAML front matter delimited by `---`. The YAML front matter is parsed as schema version `1`. Unsupported schema versions are rejected.

Minimum valid manifest:

```md
---
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
---
# Backend workspace

Contextual instructions for humans and models.
```

Implemented canonical fields:

| Field | Required | Notes |
|---|---:|---|
| `schemaVersion` | Yes | Must be `1`. |
| `workspace.id` | Yes | Canonical workspace machine ID. |
| `workspace.project` | No | Canonical project machine ID. If absent, the resolved project identity may be inherited by the Workspace Index. |
| `executor.required` | Yes | Canonical required executor machine ID. Descriptive metadata only in this service. |
| `owner.agent` | No | Canonical owner agent machine ID. |
| `reviewers` | No | List of canonical reviewer agent machine IDs. Defaults to `[]`. |
| `permissions` | No | Mapping with supported boolean keys: `read`, `write`, `executeCommands`, `createAgents`. Defaults to all `false`. |
| `scope.include` | No | List of project-relative scope patterns. Defaults to `[]`. |
| `scope.exclude` | No | List of project-relative scope patterns. Defaults to `[]`. |
| `preconditions` | No | List of bounded metadata IDs. Defaults to `[]`. |
| `routing` | No | Mapping from bounded event name to `{ agent }`. Defaults to `{}`. |

Example with optional fields:

```md
---
schemaVersion: 1
workspace:
  id: sample-backend
  project: sample-project
executor:
  required: sample-backend-engineer
owner:
  agent: sample-owner
reviewers:
  - sample-reviewer
permissions:
  read: true
  write: true
  executeCommands: false
  createAgents: false
scope:
  include:
    - src/backend/**
  exclude:
    - dist/**
preconditions:
  - tests_green
routing:
  onSuccess:
    agent: sample-reviewer
---
# Backend workspace

This Markdown body is contextual only.
```

## Machine-ID rule

Machine IDs for workspace IDs and agent IDs must match the implemented parser rule:

```txt
^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$
```

Additional parser rule: IDs containing `..` are rejected.

Allowed examples:

- `sample-backend`
- `sample-backend-engineer`
- `cookation.engineering.backend`

Properties:

- lowercase ASCII letters and digits are allowed;
- `.` and `-` are allowed only inside the ID;
- the ID must start and end with a lowercase letter or digit;
- maximum length is `100` characters;
- slashes, backslashes, spaces, underscores, traversal segments, absolute paths, and control characters are not valid machine IDs.

## Manifest safety and bounds

Implemented `AGENT.md` parser bounds:

| Item | Bound |
|---|---:|
| `AGENT.md` file size | `<= 128 KiB` |
| `reviewers` | `<= 20` |
| `scope.include` | `<= 100` |
| `scope.exclude` | `<= 100` |
| scope pattern length | `<= 200` characters |
| `preconditions` | `<= 50` |
| `routing` entries | `<= 50` |
| unknown top-level warnings | `<= 20` |

Safety behavior:

- duplicate YAML keys are rejected with `duplicate_yaml_key`;
- unsupported `schemaVersion` values are rejected with `unsupported_schema_version`;
- malformed known fields are rejected with structured error codes;
- unknown top-level fields are tolerated but produce bounded `unknown_top_level_field` warnings;
- YAML is parsed with safe deterministic settings (`core` schema, unique keys, merge keys disabled, aliases bounded);
- unsafe/custom executable YAML semantics are not used;
- Markdown body text is never promoted into executor, owner, reviewer, permission, scope, precondition, or routing authority.

## Workspace Index

`buildWorkspaceIndex(project, options)` builds the canonical Workspace Index for one already-resolved project object. It does not resolve or discover projects globally.

Behavior:

- scans only canonical files named `AGENT.md`;
- `AGENTS.md` never creates a workspace;
- parses `AGENT.md` via the canonical manifest parser;
- uses deterministic ordering by `manifestPath`;
- stores project-relative POSIX-style paths by default;
- does not expose absolute filesystem paths;
- skips ignored directories;
- does not follow symlinked directories;
- does not trust symlinked `AGENT.md` files;
- does not resolve routing, select an executor, enforce permissions, create agents, or invoke agents.

Bounds:

| Option / output | Bound |
|---|---:|
| `maxDepth` | default `8`, max `16` |
| `maxWorkspaces` | default `100`, max `500` |
| `errors` | `<= 50` |
| `warnings` | `<= 50` |
| `includeInstructions` | default `false` |
| instructions per workspace when `includeInstructions=true` | `<= 16 KiB` |
| total instructions when `includeInstructions=true` | `<= 64 KiB` |

`truncated` is `true` only when another valid unique workspace exists beyond `maxWorkspaces`. Exact-limit results are not marked truncated.

### Duplicate workspace IDs

Duplicate workspace IDs make the Workspace Index invalid. Neither ambiguous duplicate is kept as authoritative. The reported error code is:

```txt
duplicate_workspace_id
```

There is no automatic conflict resolution.

### Workspace/project mismatch

If an `AGENT.md` explicitly declares another project:

```yaml
workspace:
  id: sample-backend
  project: other-project
```

while indexing `sample-project`:

- the manifest is excluded from authoritative workspace entries;
- the Workspace Index becomes invalid;
- `workspace_project_mismatch` is reported.

If `workspace.project` is absent, the Workspace Index may inherit the already-resolved project identity for the indexed workspace entry.

## Contextual ICM Document Index

`buildIcmDocumentIndex(project, options)` indexes contextual project documents for one already-resolved project. These documents are context only and do not define workspace authority.

Canonical document kinds:

| Kind | Files |
|---|---|
| `project` | root-level `PROJECT.md` only |
| `agents` | root and nested `AGENTS.md` |
| `context` | root and nested `CONTEXT.md` |
| `adr` | Markdown files under canonical ADR roots |

ADR roots:

```txt
docs/adr/
docs/adrs/
adr/
adrs/
```

Only Markdown files under these ADR roots are considered ADR documents. README files, random Markdown files, nested `PROJECT.md` files, and `AGENT.md` files are not contextual ICM documents.

Current limitations are explicit:

- `AGENTS.md` inheritance/merge is not calculated yet;
- this document index does not itself calculate `CONTEXT.md` workspace matches;
- Step 2 task-specific selection now composes this index with workspace/path
  matches and bounded analysis; it does not implement `AGENTS.md` inheritance.

Bounds:

| Option / output | Bound |
|---|---:|
| `maxDepth` | default `8`, max `16` |
| `maxDocuments` | default `200`, max `1000` |
| contextual document file size | `<= 128 KiB` |
| `errors` | `<= 50` |
| `warnings` | `<= 50` |
| `includeContent` | default `false` |
| content per document when `includeContent=true` | `<= 32 KiB` |
| total content when `includeContent=true` | `<= 256 KiB` |

Documents are ordered lexicographically by project-relative path. Example bounded contextual-document issue codes include:

- `document_too_large`
- `document_read_failed`

## Shared scan policy

Project discovery and ICM scans share ignored directory policy where applicable. Current ignored directory names:

```txt
.git
.vs
.vscode
node_modules
bin
obj
dist
build
coverage
.next
```

ICM scans do not follow symlinked directories. Workspace scans also do not trust symlinked `AGENT.md` files, and contextual document scans do not trust symlinked contextual document files.

## Project ICM Index

`buildProjectIcmIndex(project, options)` composes:

```txt
buildWorkspaceIndex(...)
+
buildIcmDocumentIndex(...)
```

It does not introduce another scanner. It preserves both subsystem outputs and their authority boundary.

Current authority metadata:

```json
{
  "workspaceContracts": "agent_manifest_front_matter",
  "contextualDocuments": "context_only"
}
```

The combined index is built on demand in memory. No persistent ICM index or cache is currently written.

Combined output uses independent truncation flags:

```json
{
  "truncated": {
    "workspaces": false,
    "documents": false
  }
}
```

There is no single ambiguous ICM truncation boolean.

### Combined validity semantics

Machine-authoritative workspace problems can make the combined Project ICM Index invalid:

- invalid `AGENT.md`;
- duplicate workspace IDs;
- workspace project mismatch.

Contextual document problems are preserved as issues but do not by themselves invalidate otherwise valid workspace authority:

- `document_too_large`;
- `document_read_failed`.

Fatal project-level availability problems can still make the combined index invalid. An empty project with no ICM files is a valid empty ICM index.

Combined issue bounds:

| Output | Bound |
|---|---:|
| `errors` | `<= 100` |
| `warnings` | `<= 100` |

Issue provenance is preserved with `source` values:

- `workspace`
- `document`
- `icm`

## Project Overview ICM summary

`GET /api/intelligence/projects/:name/overview` includes a compact `icm` summary. It intentionally does not return the full Project ICM Index.

Implemented field shape:

```json
{
  "icm": {
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
}
```

Status semantics:

| Status | Meaning |
|---|---|
| `not_configured` | Valid index with no workspaces, no documents, no issues, and no truncation. |
| `available` | Valid ICM with workspace/document content or bounded issues/truncation. |
| `invalid` | Machine-authoritative Project ICM Index is invalid. |

Overview-specific ICM bounds:

| Subsystem | Bounds |
|---|---|
| Workspace | `maxDepth: 8`, `maxWorkspaces: 50`, `includeInstructions: false` |
| Documents | `maxDepth: 8`, `maxDocuments: 100`, `includeContent: false` |

The overview privacy boundary is deliberate. Project Overview does not return:

- `AGENT.md` Markdown instructions;
- contextual document content;
- workspace executor IDs;
- owner/reviewer identities;
- routing maps;
- permission contracts;
- scope patterns.

It exposes only ICM availability, validity, counts, issue counts, and truncation
metadata. Task-specific evidence belongs to the separate Task Context Pack API,
not the overview response.

## HTTP API status

Implemented Project Intelligence endpoints:

```txt
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
POST /api/intelligence/projects/:projectId/task-context
```

Not implemented:

```txt
GET  /api/intelligence/projects/:name/icm
POST /api/intelligence/projects/:name/route
```

## Architecture boundary

```txt
hermes-nexus
  = Project Intelligence service and source of truth

Hermes
  = thin consumer/client of the HTTP service

future Hermes Agent OS
  = orchestration, policy enforcement, and execution
```

Current Project Intelligence can describe workspace contracts and contextual documents. It does not enforce workspace contracts. Future Hermes Agent OS policy enforcement remains responsible for authorization and ALLOW/DENY/REROUTE decisions.

## Phase status

Completed:

- Phase 0: config/roots/registry foundation.
- Phase 1: discovery, registration, overview.
- Phase 2: canonical `AGENT.md` parser, Workspace Index, contextual ICM Document Index, combined Project ICM Index, compact overview ICM summary.

Completed under the tracked active plan:

- Step 2: bounded, deterministic, revision-aware Task Context Pack service and
  read-only HTTP endpoint using persisted projectId. The high-level Hermes
  `project_task_context` tool is not implemented. See the
  [implemented contract](./project-intelligence/04_ICM_AND_CONTEXT_PACK.md) for
  limits, trust labels, source snapshot mode and Linux/WSL descriptor verification.
- Step 3 — Impact v2 remains not started. The earlier foundation phase numbering
  above is historical and does not supersede the tracked active plan.

Future:

- task routing;
- impact v2;
- high-level Hermes `project_*` tools;
- Hermes Agent OS / Policy Engine.

Future capabilities are not implemented in this repository yet.
