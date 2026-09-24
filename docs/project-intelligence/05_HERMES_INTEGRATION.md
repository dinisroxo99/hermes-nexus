# Hermes Integration

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/05_HERMES_INTEGRATION_ROUNDTABLE.md`


## Principle

This page retains the target architecture. The delivered thin plugin currently
contains only `project_task_context` and `project_impact`; see the
[DEV-ADOPTION-1 usage contract](../hermes-tool-integration.md#dev-adoption-1--two-tool-usage-contract)
for approved development scope and limitations. MCP, automatic Guard and the
other candidate operations below remain planned, not installed functionality.

Hermes remains the runtime.

Project Map becomes a specialized intelligence/control dependency.

## Reuse from Hermes

Do not duplicate the following unless a concrete limitation is proven:

```text
profiles
SOULs
Kanban board/UI
task lifecycle
dependencies
dispatcher
claims
workers
worktrees
runtime sessions
model/provider execution
```

## Integration surfaces

Use two complementary mechanisms.

### 1. MCP / HTTP

Used when the agent explicitly asks Project Map for information.

Candidate operations:

```text
project_info
project_search
project_context
project_impact
project_insights
icm_context
task_context
task_scope
task_conflicts
ask_project
```

### 2. Hermes guard/integration plugin

Used for automatic context injection and enforcement.

Responsibilities:

```text
on task claim
  → resolve project/task/revision
  → request Context Pack + Scope

before LLM execution
  → inject only bounded context

before mutation-capable tool call
  → validate project/worktree/scope

after tool call
  → emit telemetry

on task complete/block/fail
  → emit outcome and release technical state
```

## Tool enforcement

The agent must not be the authority on its own allowed scope.

Expected flow:

```text
Agent wants to modify path
        ↓
Hermes guard
        ↓
Project Map scope policy
        ↓
ALLOW | BLOCK | REQUIRE_REPLAN
```

## Shell/terminal caveat

Guarding file tools alone is insufficient because terminal commands can mutate files.

The plugin should classify tool calls into:

```text
read-only
known-safe
mutation
unknown/potential mutation
```

Unknown mutation-capable commands should require stricter handling.

## Project isolation

For every run resolve:

```text
projectId
gitRoot
gitRevision
taskId
worktreeRoot
```

All path checks are relative to the authorized workspace boundary.

Do not allow path traversal into another project/worktree.

## Profile model

Profiles are reusable globally:

```text
architect
implementer
tester
reviewer
documenter
ui-designer
```

A run binds the profile to a project:

```json
{
  "profile": "implementer",
  "projectId": "cookation",
  "taskId": "TASK-142",
  "worktree": "...",
  "revision": "..."
}
```

No project-specific clone of the profile is required.

## Honcho

Honcho is used for persistent experiential memory.

Project Map should provide current project truth.

If a memory says something that conflicts with current analysis, current analysis wins.

## Integration resilience

Project Map calls from Hermes require:

```text
bounded timeout
structured retryability
clear read-only degradation policy
fail-closed mutation validation
correlation IDs
```

Do not make a long Project Expert query block every control-path hook.

Control-path calls and analytical/background calls should have different timeout budgets.
