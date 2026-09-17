# Runtime Security and Enforcement

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/21_RUNTIME_SECURITY_AND_ENFORCEMENT_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

Prevent an agent from mutating code outside the scope assigned to its task.

## Important limitation

A Hermes `pre_tool_call` plugin can block a tool call, but the plugin mechanism must not be treated as a complete sandbox.

If the integration callback itself fails unexpectedly, runtime behavior may continue depending on the host.

Therefore use defense in depth.

## Enforcement layers

### Layer 1 — Project identity

Resolve the exact project and worktree before execution.

### Layer 2 — Dedicated workspace

Prefer task-specific Git worktrees for coding tasks.

### Layer 3 — Path boundary

Mutation targets must remain under the authorized workspace root.

Reject:

```text
absolute external paths
../ traversal
other project roots
other task worktrees
```

### Layer 4 — Semantic scope

Project Map calculates:

```text
WRITE
RESERVED
WATCH
IMPACT
```

Only WRITE is automatically writable by the current task.

### Layer 5 — `pre_tool_call` guard

Before mutation tools execute:

```text
resolve target
validate workspace
validate scope
validate conflict state
ALLOW | BLOCK | REQUIRE_REPLAN
```

### Layer 6 — Post-run diff validation

Before accepting completion, compare Git diff against allowed scope.

This catches mutation paths missed by command interpretation.

## Terminal commands

Terminal is the hardest surface because arbitrary scripts may mutate files.

Use categories:

```text
READ_ONLY
KNOWN_MUTATION
UNKNOWN
```

Examples of usually read-only:

```text
git status
git diff
grep
cat
dotnet test
npm test
```

Commands/scripts that may change files require stricter policy.

Do not attempt to perfectly parse every shell language in the first version.

The final Git diff is the authoritative mutation audit.

## Guard failure behavior

Inside the guard callback, catch integration exceptions and intentionally return a block for mutation-capable calls when Project Map cannot validate the operation.

Do not throw uncaught exceptions as the intended failure policy.

## Dashboard/network security

Keep Hermes dashboard bound to localhost by default.

If remote access is later required:

```text
reverse proxy/authentication
network restriction
TLS
explicit exposure policy
```

Do not expose plugin/Kanban endpoints directly to an untrusted network.

## Project Map service security

For local deployment:

```text
bind localhost / private interface
authenticate non-local callers
do not expose raw filesystem paths unnecessarily
```

## Secrets

Never persist:

```text
API keys
OAuth material
.env contents
provider credentials
```

in training datasets or task metadata.

## Acceptance criteria

- outside-workspace write blocked;
- cross-project traversal blocked;
- semantic out-of-scope write blocked;
- guard integration outage blocks mutation by policy;
- final diff detects unauthorized mutation;
- dashboard remains local-only in default deployment.

## Threat model dependency

This document specifies enforcement controls.

The system-level threat inventory and trust-boundary assumptions live in:

```text
31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md
```

Security tests should include prompt-injection fixtures inside repository files and malicious/incorrect MCP responses, not only path traversal.
