# Impact-Aware Scope and Conflict Design

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/06_SCOPE_IMPACT_CONFLICTS_ROUNDTABLE.md`


## Goal

Prevent agents from colliding without serializing the entire project.

## Bad approach

Do not convert every impacted/referencing file into an exclusive hard lock.

That would destroy useful parallelism.

## Impact v2 evidence contract — implemented Step 3 boundary

Impact v2 is implemented as a bounded pure composer, a live project service and a
read-only project-ID HTTP operation. It remains separate from the existing legacy
graph impact used by exploration and analyzer-service callers; legacy responses
keep their compatibility behavior and do not satisfy this contract.

Impact v2 output is evidence, never authorization. It does not grant WRITE,
RESERVED, WATCH or IMPACT scope; it does not enforce conflicts; it does not
drive Hermes Guard decisions by itself. Effective Scope, the Conflict Engine,
Guard integration, telemetry, Project Expert, Git-diff impact and persistent
Impact caches are explicit non-goals for the Impact v2 foundation.

### Identity and revision binding

Every Impact v2 result is bound to current project truth:

- persisted `projectId` when available and required by the operation;
- safe revision projection: Git status, commit, dirty state, repository identity
  and worktree identity as applicable;
- selected worktree locator, without exposing raw Git metadata paths;
- the selected provider graph snapshot and the source observation that produced
  it.

Dirty, unborn, non-Git and unavailable Git states remain supported working-tree
observations. They are not clean committed snapshots and must not be cached or
replayed as such.

### Status and evidence vocabulary

Top-level and section statuses use the existing provider vocabulary where it
applies:

- `available` — requested evidence was evaluated within limits;
- `partial` — the requested analysis completed with known incompleteness in
  source observation, provider coverage, traversal or output. Some useful
  analysis state may exist, but retained nodes, edges or evidence items are not
  required for `status=partial`;
- `unsupported` — the selected provider/source class cannot supply the requested
  operation;
- `unavailable` — the operation could not run or failed closed;
- `not_requested` — optional sections, such as future affected-test candidates,
  were deliberately not requested.

Per target or relation, Impact v2 distinguishes:

- `evidence_found` — retained evidence supports a relationship;
- `no_evidence_found` — the evaluated evidence did not contain a relationship;
- `not_evaluated` — the relationship was not checked or evidence was omitted.

`no_evidence_found` is not proof of safety, no-impact or sufficient test
coverage. It only describes the bounded evidence that was actually evaluated.
Evaluated absence is different from omitted or not-evaluated evidence: an empty
retained evidence array can still be `partial` when relevant input was omitted
during source observation, selected-provider coverage is incomplete, traversal
was bounded, output was trimmed to zero, or provider analysis itself reported
incomplete evidence. Completeness dimensions survive empty result arrays; zero
returned nodes, edges or items must not erase known source, provider, traversal
or output incompleteness.

Completeness is reported independently across four dimensions:

- `source` — source files or directories may be omitted by collection bounds,
  exclusions or descriptor verification;
- `provider` — the selected analyzer may cover only some observed languages or
  operations;
- `traversal` — configured depth or graph traversal limits may stop expansion;
- `output` — serialization/item budgets may omit otherwise discovered evidence.

Evidence basis is labelled per item where possible:

- `semantic` — provider reports semantic symbols/definitions/references;
- `structural` — analyzer-derived AST/regex/import graph structure;
- `heuristic` — filename, basename, convention or other non-semantic inference;
- `unknown` — retained only for legacy or degraded evidence that cannot honestly
  claim a stronger basis.

### Provider graph rules

Impact v2 consumes one selected provider graph per result. It does not federate,
merge or stitch graphs across providers. Native .NET, native TypeScript/JavaScript
and optional Serena/Python keep their existing selection and fallback semantics.
Node.js classification continues to reuse the existing JavaScript-capable native
TypeScript analyzer; there is no separate Node.js provider.

Serena/Python can provide semantic symbols, definitions and references when the
trusted immutable image is configured. It does not provide dependencies,
implementations or compiler diagnostics. Python references may be used
conservatively as impact evidence, but a reference owner can be an enclosing
symbol or `<module>`; do not call it a caller unless the evidence proves a call.
Definition locations are not dependency edges.

### Traversal and origin witnesses

The default traversal depth is `2`; the maximum accepted depth is `5`. Depth `0`
means only the requested origin/target is reported with its direct evidence and
identity binding; no neighbor expansion is performed.

Multi-target Impact v2 results require a witness for every retained
origin. If an output item is retained because multiple origins reached it, each
origin must have its own retained witness path or relation. Output trimming must
not leave an item whose origin cannot be explained.

Existing source, provider, Docker transport and JSON output budgets continue to
apply. Provider item limits are unchanged. Affected tests are candidates derived
from evidence and heuristics; they are not guaranteed sufficient coverage.

### Live service and HTTP boundary

`buildProjectImpact(projectId, input, options)` resolves an existing persisted
project or verified linked worktree through configured roots and registries. It
collects one bounded source observation with registered/nested project exclusions,
binds a safe revision and immutable provider snapshot, invokes the existing
native-first single-provider facade (including configured Serena/Python), and
passes only that trusted observation to the pure composer. Request callers cannot
supply graphs, snapshots, sources, provider configuration, commands, credentials,
cache policy or execution policy.

After successful composition, the service recollects sources and compares digest,
truncation and deterministic diagnostics; rereads the safe revision; then
reresolves project/worktree identity and nested exclusions. Conflicts fail closed
in source → revision → project order. Composition errors stop before reobservation.
There is no retry, recompose, registry write, persistent cache or replay.

The public operation is:

```text
POST /api/intelligence/projects/:projectId/impact
```

The body accepts only `paths` (1–32 raw entries), optional verified `worktree`,
optional `includeTests`, and existing Impact `limits`. The route ID is authoritative;
a body `projectId` and unknown provider/evidence/execution controls are rejected.
The route counts at most 65,536 actual incoming bytes, decodes strict UTF-8 only
after the complete bounded body is collected, and maps request overflow to HTTP
413. Successful data is the unchanged accepted `ImpactResult` in a compact
`{ok:true,data,message}` envelope with no-store headers.

Domain and transport budgets are independent. `ImpactResult` compact JSON remains
65,536 bytes by default and 131,072 maximum. The complete compact HTTP success body
is serialized once, measured as UTF-8, and capped at 163,840 bytes. The exact bytes
measured are the bytes emitted. Overflow is HTTP 500 /
`impact_response_too_large`; it never retrims or relabels a valid result. With the
fixed 59-byte wrapper, a current valid maximum domain result is at most 131,131
wire bytes, so overflow coverage is a defensive adapter-boundary test rather than
a fabricated live-domain case.

Dirty, unborn, non-Git and unavailable revisions remain working-tree evidence.
`generatedAt` is null and `observation.cacheReuse` is `disabled`. The before/after
checks are bounded observations, not an atomic filesystem snapshot, a whole dirty
content fingerprint, a complete DLP guarantee or protection from mutation after
the final check.

### Explicit non-goals for this contract

Impact v2 foundation work does not implement:

- Effective Scope or WRITE/RESERVED/WATCH authorization;
- Conflict Engine, Hermes Guard or mutation enforcement;
- task scheduling, telemetry ingestion or Project Expert retrieval;
- LLM-based impact computation;
- cross-provider graph merging;
- Git-diff impact;
- persistent Impact caches;
- dependency inference from definition locations;
- coverage guarantees from affected-test candidates.

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
