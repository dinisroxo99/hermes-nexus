# Impact-Aware Scope and Conflict Design

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/06_SCOPE_IMPACT_CONFLICTS_ROUNDTABLE.md`


## Goal

Prevent agents from colliding without serializing the entire project.

## Bad approach

Do not convert every impacted/referencing file into an exclusive hard lock.

That would destroy useful parallelism.

## Impact v2 evidence contract — implemented Step 3 boundary

This section is the canonical contract for the implemented bounded Impact v2
composer, live service and HTTP adapter. Impact v2 remains separate from legacy
exploration impact. Its output is revision/worktree-bound evidence, never
authorization or proof that a change is safe.

### Public operation and strict request DTO

```text
POST /api/intelligence/projects/:projectId/impact
```

The decoded route `projectId` is authoritative and must be a persisted ID. There
is no name fallback, enrollment or ID generation. The JSON body is a strict object:

```text
{
  paths: string[1..32],
  worktree?: { rootId?: string, relativePath: string },
  includeTests?: boolean,
  limits?: {
    depth?, affectedFiles?, affectedTests?, diagnostics?,
    originWitnessesPerItem?, originWitnessRecords?,
    traversalVisitedStates?, traversalEdgeExaminations?, compactBytes?
  }
}
```

`paths` count is checked before normalization/deduplication. Paths and worktree
locations are bounded relative project paths; absolute paths, traversal, URI and
glob forms and control characters are rejected. A missing worktree `rootId` uses
the existing `default` root semantics. `includeTests` defaults to `false`.
Unknown fields are rejected at every request level. In particular, the body may
not contain `projectId`, providers, analyzer/Serena/image/command/credential
controls, graph/snapshot/source evidence, revision, cache/execution policy or a
transport limit.

Every limit is a finite safe integer, is not coerced or clamped, and uses this
unchanged default/maximum pair:

| key | default | maximum |
|---|---:|---:|
| `depth` | 2 | 5 |
| `affectedFiles` | 80 | 250 |
| `affectedTests` | 16 | 32 |
| `diagnostics` | 20 | 40 |
| `originWitnessesPerItem` | 8 | 32 |
| `originWitnessRecords` | 256 | 1024 |
| `traversalVisitedStates` | 2000 | 16000 |
| `traversalEdgeExaminations` | 16000 | 64000 |
| `compactBytes` | 65536 | 131072 |

Only `depth` may be zero. The route independently limits the raw observed request
body to 65,536 bytes. It collects bounded chunks, then performs one strict UTF-8
decode and JSON parse; it does not trust `Content-Length` or split-decode Unicode.

### Exact `ImpactResult` contract

All results use `schemaVersion: 1`, `analysisVersion: "impact-v2"`, the exact
persisted `projectId`, `project: {rootId,relativePath}`, `generatedAt: null`, and
the normalized complete `limits` object. Common fields are:

```text
revision: {
  status, commitSha, branch, repositoryId, worktreeId,
  dirty, isGit, isLinkedWorktree
}
worktree: null | { worktreeId }
snapshotToken
provider: null | { id, version }
coverage: { observed, covered, uncovered }
observation: {
  basis: "working_tree",
  cacheReuse: "disabled",
  digestCoverage: "bounded_collected_sources",
  ...singleTargetFields,
  incomplete
}
status
findingState
affectedFiles
affectedTests
completeness: { source: [], provider: [], traversal: [], output: [] }
```

Safe revision members may be null; raw Git paths and volatile `capturedAt` are not
returned. A single normalized target has `originPath`, no `targets`, and
`observation.targetSource` equal to `{path,hash}` or null. Multiple normalized
targets have no top-level `originPath` and no observation targetSource; they have:

```text
targets: [{
  originPath,
  targetSource: null | { path, hash },
  status,
  findingState,
  completeness: { source: [], provider: [], traversal: [], output: [] }
}]
```

Each affected file is `{path,origins,originSummary}`. Every origin is
`{originPath,minimumDistance,witness}`. A witness is
`{id,provider:{id,version},capability,relationshipKind,source:{path,hash},location,trust,basis}`;
`location` is null or `{path,line,column}`. `originSummary` is
`{discoveredOriginCount,retainedOriginWitnessCount,attributionTruncated,reasons}`.
Multi-target retained items have a retained witness for every attributed origin.

When `includeTests` is omitted or false, output is exactly
`{status:"not_requested",candidates:[]}` and the two modes are byte-compatible.
When true, output is `{status,findingState,candidates,completeness}`. Each
candidate retains the same `path`, exact origins and origin summary as its
qualifying retained affected file, plus:

```text
provenance: {
  trust: "derived_analysis",
  basis: "heuristic",
  reason: "test_path_convention",
  source: { path, hash }
}
```

Affected tests are implemented conservative candidates, not executed tests,
coverage evidence or a guarantee of sufficient testing.

### Status, completeness, trust and deterministic bounds

Statuses are `available`, `partial`, `unsupported`, `unavailable`, plus
`not_requested` for optional sections. Finding states are `evidence_found`,
`no_evidence_found` and `not_evaluated`. Empty retained arrays do not erase known
incompleteness, and `no_evidence_found` is not proof of safety.

Completeness reasons are canonical and separated by dimension:

- source: `source_limit`, `source_unavailable`;
- provider: `provider_partial`, `provider_unsupported`, `uncovered_language`;
- traversal: `depth_limit`, `traversal_work_limit`;
- output: `origin_limit`, `witness_budget`, `output_byte_limit`.

Evidence basis is `semantic`, `structural`, `heuristic` or `unknown`; trust is
`derived_analysis` or `untrusted_external_analysis`. One provider graph is
selected. Native .NET and TypeScript/JavaScript retain priority over configured
external evidence. Optional trusted Serena/Python can provide bounded semantic
symbols/definitions/references, but definitions are not dependency edges and a
reference owner is not necessarily a caller. No graphs are federated.

Depth zero observes only the target and does not expand neighbors. Result ordering,
target attribution, source hashes and witnesses are deterministic. Count, work,
witness and compact-byte bounds retain whole prefixes; items are never split or
backfilled. Requested test candidates are removed before affected files when the
compact byte budget requires trimming. If the mandatory envelope cannot fit,
composition throws `impact_budget_exceeded`.

### Live observation, provider boundary and races

`buildProjectImpact(projectId, input, options)` resolves the existing persisted
project or a verified linked worktree under configured roots. It excludes nested
Git repositories and registered descendants of both selected and canonical
locations, collects descriptor-verified bounded sources, reads a safe revision,
creates an immutable provider snapshot, invokes the existing trusted native-first
single-provider facade once, and composes once. Only server-controlled trusted
configuration can enable Serena. HTTP callers cannot inject providers, responses,
credentials, commands, snapshots, graphs, sources or cache/execution policy.

After successful composition the service recollects the same source boundary and
compares digest, truncation and deterministic diagnostics; rereads the safe
revision; then re-resolves project/worktree identity and registered exclusions.
Mismatch or stage exception fails closed in source → revision → project order as
`impact_sources_changed`, `impact_revision_changed` or `impact_project_changed`.
Composition errors stop before reobservation. There is no retry, recompose,
registry write, persistent cache or replay.

Dirty, unborn, non-Git and unavailable revisions remain working-tree evidence.
These checks are bounded observations, not an atomic filesystem snapshot, lock,
whole dirty-content fingerprint, complete DLP guarantee or protection from a
mutation after the final check.

### HTTP envelopes, byte ownership and errors

Success is compact JSON with no trailing newline:

```text
{"ok":true,"data":ImpactResult,"message":"Project impact constructed."}
```

The fixed wrapper is 59 bytes. The unchanged compact `ImpactResult` owns its
65,536-default/131,072-maximum domain budget. The complete success body is
serialized once to UTF-8, measured independently, and limited to 163,840 bytes;
the exact measured buffer is emitted with exact `Content-Length`. A valid maximum
current result is therefore at most 131,131 wire bytes. Defensive transport
overflow does not retrim, mutate or relabel it.

Every mapped error uses the fixed sanitized standard envelope (pretty-serialized
by the shared error sender):

```text
{
  "ok": false,
  "error": "CODE",
  "message": "Project impact could not be constructed safely."
}
```

All success and error responses set `content-type: application/json; charset=utf-8`,
`cache-control: no-store`, and exact `content-length`. Once response output has
started, synchronous write failure is contained locally and the response is
terminated/destroyed when supported; no generic second JSON writer is invoked.

| HTTP | application code / condition |
|---:|---|
| 400 | `invalid_project_identity`, `project_identity_required`, `invalid_json`, `invalid_impact_request`, `impact_budget_exceeded` |
| 404 | initial `project_not_found`, `project_unavailable` |
| 409 | initial `ambiguous_project`, `project_identity_conflict`, `worktree_parent_mismatch`; live `impact_sources_changed`, `impact_revision_changed`, `impact_project_changed` |
| 413 | `request_body_too_large` for raw request bytes only |
| 500 | measured response overflow `impact_response_too_large`; all other internal/provider/observation/serialization failures become `impact_failed` |

`impact_response_too_large` is only produced by the adapter's actual complete-body
measurement; a service-thrown lookalike is sanitized to `impact_failed`. Request
413 and response 500 are intentionally distinct.

Validation and error precedence is exact:

1. decoded route ID;
2. raw request byte ceiling;
3. strict UTF-8 and JSON;
4. object shape and no body `projectId`;
5. normalized paths/worktree/includeTests/limits and unknown-field rejection;
6. trusted configuration;
7. service validation and initial project/source/revision observation;
8. provider/snapshot/composer binding and domain budget;
9. source, then revision, then project/exclusion reobservation;
10. success serialization, UTF-8 measurement and transport cap;
11. one response write.

Thus invalid request data prevents provider work; composition/binding/domain errors
win over unperformed reobservation; a successful composition's source race wins
over revision and project races; every live race wins over transport measurement;
serialization failure is `impact_failed`, not response overflow.

### Implemented boundary versus later planned work

Implemented Step 3 ends at bounded file/multi-file impact, affected-test candidates,
the live service and this project-ID HTTP adapter. It does not implement Git-diff
impact, Effective Scope, WRITE/RESERVED/WATCH authorization, the later scope schema
below, Conflict Engine/rules, Hermes Guard/enforcement, task scheduling, telemetry,
Project Expert, plugin/profile/MCP integration, cross-provider federation, LLM
impact computation, persistent Impact caches or coverage guarantees. The remaining
sections of this document describe planned Step 4 and conflict design, not current
MC10 behavior.

## Scope levels

### WRITE

The current task is authorized to mutate this path/symbol.

### RESERVED

Strong direct coupling. Another task requesting WRITE should normally wait or replan.

### WATCH

Potential impact. Concurrent work may be allowed but must trigger conflict awareness/revalidation.

### IMPACT

Informational transitive impact only. No lock by default.

## Example

```text
Task changes:
IRecipeService.cs

Resolved:
IRecipeService.cs        WRITE
RecipeService.cs         RESERVED
RecipeController.cs      WATCH
RecipeTests.cs           WATCH
OtherFeature.cs          IMPACT
```

## Evidence used by the resolver

```text
explicit requested scope
task semantics
symbol type
direct references
call graph
implementation relationships
dependency distance
affected tests
change type
public API surface
current task scopes
```

## Suggested baseline policy

This is a starting policy, not a permanent hard-coded truth.

```text
distance 0 + direct mutation       → WRITE
distance 1 + strong coupling       → RESERVED
distance 1-2 affected consumer     → WATCH
distance 3+                        → IMPACT
```

Modify classification by change type.

Example:

```text
comment-only change
  → minimal propagation

private implementation change
  → WATCH direct consumers

public interface/signature change
  → stronger RESERVED/WATCH propagation
```

## Scope result schema

```json
{
  "taskId": "TASK-142",
  "projectId": "...",
  "revision": "...",
  "write": [],
  "reserved": [],
  "watch": [],
  "impact": [],
  "evidence": [],
  "confidence": 0.0
}
```

## Conflict rules

### WRITE vs WRITE

Block or serialize.

### WRITE vs RESERVED

Block by default.

### WRITE vs WATCH

Allow only according to policy; require revalidation before merge.

### WATCH vs WATCH

Usually allow.

### IMPACT

Informational.

## Semantic conflict

Two tasks can conflict without editing the same file.

Example:

```text
Task A modifies IRecipeService
Task B modifies RecipeController
```

The graph may show a semantic relationship.

Conflict Intelligence should therefore compare:

```text
file overlap
+
symbol overlap
+
dependency/impact overlap
```

## Git/worktree relationship

Worktrees provide physical isolation.

Scope provides semantic coordination.

They solve different problems:

```text
worktree
  → prevents direct working-directory collision

scope/conflict engine
  → prevents logically conflicting concurrent work
```

## Revision invalidation

Every impact/scope result must include the Git revision.

If the repository/worktree moves beyond the analyzed revision and relevant nodes changed:

```text
scope = stale
→ recompute
```

## Acceptance criteria

- no blanket lock over the entire impact graph;
- scope derivation is deterministic and explainable;
- conflict response includes evidence;
- write operations outside authorized scope can be blocked;
- current Git revision is always recorded.

## Scope lifecycle

Scope is a revision-bound snapshot, not a permanent lock:

```text
PROPOSED
→ RESOLVED
→ ACTIVE
→ STALE | RELEASED
```

A scope becomes `STALE` when relevant revision/policy inputs change.

## Merge-time validation

Before accepting a completed run:

```text
final diff
vs
authorized WRITE scope
```

must be checked even if all tool hooks previously allowed operations.
