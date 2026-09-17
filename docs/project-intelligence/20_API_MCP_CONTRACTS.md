# Project Map API / MCP Contracts

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/20_API_MCP_CONTRACTS_ROUNDTABLE.md`


Status: **PLANNED**

## Principle

Expose a small stable semantic surface.

Do not expose every internal analyzer primitive as a separate agent tool.

## Read-oriented tools

### `project_info`

Purpose:

```text
identify project
revision
language/workspace summary
ICM availability
```

### `project_search`

Purpose:

```text
bounded semantic/structural search
```

### `project_context`

Purpose:

```text
bounded context around symbol/file/module
```

### `project_impact`

Purpose:

```text
direct/transitive blast radius
affected tests
evidence
```

### `project_insights`

Purpose:

```text
bounded higher-level architecture/project summary
```

### `icm_context`

Purpose:

```text
resolve applicable process/stage/constraints
```

### `task_context`

Purpose:

```text
build complete bounded Context Pack for a task
```

### `task_scope`

Purpose:

```text
resolve WRITE / RESERVED / WATCH / IMPACT
```

### `task_conflicts`

Purpose:

```text
compare task scopes / active work
```

### `ask_project`

Purpose:

```text
read-only Project Expert question answering
```

## Tool output requirements

Every current-code-aware response should carry:

```text
projectId
revision
generatedAt
evidence/source metadata
boundedness/limit metadata
```

## Suggested `task_context` result

```json
{
  "projectId": "...",
  "taskId": "...",
  "revision": "...",
  "icm": {},
  "summary": "...",
  "symbols": [],
  "files": [],
  "tests": [],
  "constraints": [],
  "decisions": [],
  "history": [],
  "impact": {},
  "scopeHints": {}
}
```

## Suggested `task_scope` result

```json
{
  "projectId": "...",
  "taskId": "...",
  "revision": "...",
  "write": [],
  "reserved": [],
  "watch": [],
  "impact": [],
  "confidence": 0.0,
  "evidence": []
}
```

## Suggested `task_conflicts` result

```json
{
  "taskId": "...",
  "conflicts": [
    {
      "otherTaskId": "...",
      "severity": "...",
      "reason": "...",
      "overlap": [],
      "recommendedAction": "wait|allow|revalidate|replan"
    }
  ]
}
```

## API vs MCP

The core business logic must be transport-independent.

```text
service functions
    ├─ HTTP adapter
    └─ MCP adapter
```

Do not implement different semantics for HTTP and MCP.

## Write surface

Keep Project Map write operations narrow.

Allowed examples:

```text
record technical task snapshot
record project observation
record telemetry link
invalidate derived snapshot
```

Project Map should not become the owner of:

```text
Kanban status
worker assignment
model credentials
provider configuration
```

## Versioning

Version external DTOs once multiple consumers depend on them.

Internal module types can evolve more rapidly.

## Error model

Prefer structured errors:

```json
{
  "code": "STALE_REVISION",
  "message": "...",
  "retryable": true,
  "details": {}
}
```

Useful classes:

```text
PROJECT_NOT_FOUND
OUTSIDE_PROJECT_ROOT
STALE_REVISION
ANALYZER_UNAVAILABLE
ICM_INVALID
CONTEXT_LIMIT_EXCEEDED
SCOPE_UNRESOLVED
CONFLICT_DETECTED
```

## Operational contract

External adapters should define:

```text
authentication/authorization when non-local
timeouts
maximum payload size
pagination for list/search endpoints
idempotency for write-like recording calls
capability/version discovery
```

MCP/HTTP transport errors must map to the same domain error model where possible.

## Compatibility

Expose an API capability/version endpoint so a Hermes plugin can refuse an incompatible Project Map version instead of failing unpredictably.
