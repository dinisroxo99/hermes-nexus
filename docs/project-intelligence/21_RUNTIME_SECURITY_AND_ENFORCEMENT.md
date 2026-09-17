# Runtime Security and Enforcement

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/21_RUNTIME_SECURITY_AND_ENFORCEMENT_ROUNDTABLE.md`


Status: **PLANNED**

## Implemented exception: optional semantic-analysis sandbox

The broader Hermes task/agent enforcement design below remains planned. The
Serena/Python AnalyzerProvider now has a narrower implemented Docker boundary:
only a fresh exported snapshot mounted read-only, read-only root, UID 65532,
dropped capabilities/no-new-privileges, network disabled, bounded tmpfs, 2 CPUs,
1 GiB RAM, 30-second process deadline budget and 256 KiB response limit.
No live checkout, `.git`, host HOME, credentials or Docker socket enters the
container. No shell/edit/memory/project-switching/agent operations are exposed;
the worker calls only fixed SolidLSP semantic operations and lifecycle methods.
Source code is not executed. No runtime dependency download is possible.

The host uses the local Docker CLI as a trusted semantic subprocess boundary,
not a task scheduler or Hermes runtime. Timeout/crash/overflow removes the named
container; cleanup failures suppress evidence. Real Docker tests probe isolation,
PID-1 deadline handling and cleanup. Host/daemon failure is not a guaranteed
cleanup case. See `19_ANALYZER_PROVIDER_LAYER.md` and
[`docker/serena-python/README.md`](../../docker/serena-python/README.md).

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
