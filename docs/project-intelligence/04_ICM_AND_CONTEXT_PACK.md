# ICM and Context Pack Design

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/04_ICM_AND_CONTEXT_PACK_ROUNDTABLE.md`


## Purpose

ICM provides a human-readable, versionable process layer.

Project Intelligence provides machine-derived knowledge of the current codebase.

The Context Pack joins both.

## Implemented Step 2 contract

**Step 2.5 additive update:** bounded analysis now consumes the normalized
AnalyzerProvider layer. Existing schema/sections and selection policy remain;
`analysis` metadata adds provider/version, capabilities, language coverage,
snapshot binding, attempts and provenance. Symbol/reference sections retain
external trust labels and validated source lines. Missing operation support is
not_analyzed; partial language/operation coverage marks the pack incomplete.
External evidence is never authoritative. A separately enabled immutable
Serena/Python image now supplies real semantic symbols/definitions/references
through a snapshot-only Docker sandbox. The exact provider and runtime contract
is in `19_ANALYZER_PROVIDER_LAYER.md`; default native behavior is unchanged.

The HTTP route reads optional `SERENA_PYTHON_IMAGE` from trusted service config,
not the request body. It passes the existing composer a fixed Serena option.
The composer itself is unchanged: normalized evidence retains provider/version,
external trust, observed snapshot/revision association, existing source
reobservation, section bounds and no-store behavior. Unavailable/invalid/timed-out
Python analysis yields explicit attempts and incomplete/not_analyzed sections,
not a fabricated empty semantic graph. Definitions remain in the provider facade,
not a new Context Pack section. Mixed projects retain native provider priority;
trusted internal callers may require Python coverage explicitly.

`buildProjectTaskContext(request, options)` in `src/lib/task-context.js` is the
on-demand composer. HTTP exposure is **read-only**:

```text
POST /api/intelligence/projects/:projectId/task-context
```

The route ID must be an existing persisted project identity, not a project name.
Legacy ID-less records remain readable elsewhere but require explicit identity
assignment before this operation. No registry migration or identity generation
occurs. `worktree: {rootId, relativePath}` optionally selects a checkout through
the existing parent/worktree resolver; it never enrolls another project.

Request body:

```json
{
  "task": {"id": "task-1", "title": "Change One", "paths": ["src/one.ts"], "symbols": []},
  "includeExcerpts": false,
  "limits": {"files": 16, "symbols": 24}
}
```

`title` is required (1–200 characters); optional task `id` is at most 128,
`description` at most 2000, `paths` at most 32 entries of 1024 characters, and
`symbols` at most 8 names of 128 characters. Paths are relative, validated before
normalization, deduplicated and sorted. Unknown fields, including profile/model/
provider/routing inputs and a body-level projectId, are rejected. The body limit
is 64 KiB. The existing `{ok, data, message}` envelope and `Cache-Control: no-store`
are retained. Controlled failures use 400 for invalid input/budget, 404 for missing
or unavailable projects, 409 for ambiguity/worktree/observed-state conflicts,
413 for oversized bodies, and sanitized 500 for unexpected failures.

### Composition and relevance

The existing registry, revision reader, workspace matcher, Project ICM Index and
TypeScript/.NET extraction logic are reused. Optional `sourceFiles` input modes
let the existing ICM parsers and analyzers consume one bounded in-memory source
observation, without a second parser/index or persistent store. TypeScript runs
in an in-memory filesystem: external imports/config extends/plugins are not
loaded. Ordinary legacy analyzer/index callers retain their existing behavior.

Explicit file/directory paths and symbol names select targets; when both are
absent, bounded lexical matching uses task text. Direct graph neighbours can add
references, not transitive impact. Test candidates use explicit targets, direct
references or basename conventions and are labelled heuristic. Root canonical
documents remain available; localized documents follow task/workspace ancestry;
ADRs need explicit or lexical relevance. This is not a coverage guarantee.

### Versioned output and provenance

The pack contains `schemaVersion: 1`, `analysisVersion: "task-context-v1"`,
`contextPackId`, `projectId`, a relative project locator, safe `revision`,
`observation`, `limits`, `sections` and expansion hints. Sections are `task`,
`policy`, `workspaces`, `documents`, `constraints`, `files`, `symbols`,
`references`, `tests` and `diagnostics`. Each has `items`, `limit`, `truncated`,
`status` and producer/project/revision provenance. Content-bearing items have
source metadata and relevance reasons; file evidence includes a relative path
and SHA-256. Public symbol references hash bounded analyzer identities instead
of exposing internal absolute IDs. Unknown exact symbol lines are `null`.

Trust classes distinguish fixed `trusted_policy`, `canonical_fact` declarations,
`derived_analysis`, `untrusted_repository_text` and `untrusted_request_text`.
Permissions and preconditions are explicitly `declaredOnly`, never effective
permissions or runtime authorization. Canonical Markdown titles/excerpts remain
untrusted text. No selected executors, agents, routing or task lifecycle appears.
Ambiguous workspace/document identities are rejected; diagnostics and selected
results are deterministically ordered before public truncation.

### Bounds

| Section | Default | Maximum |
|---|---:|---:|
| Files | 16 | 32 |
| Symbols | 24 | 64 |
| References | 32 | 64 |
| Tests | 8 | 16 |
| Workspaces | 8 | 16 |
| Documents | 8 | 16 |
| Constraints | 16 | 32 |
| Diagnostics | 20 | 40 |

Task and fixed policy sections have fixed bounds. Numeric section requests are
clamped to non-negative integer limits; zero omits that section's items. Matched
paths and preconditions are bounded to eight per item. Excerpts are off by
default; opt-in excerpts use the first 12 lines and at most 512 UTF-8 bytes, with
common sensitive-pattern redaction. They are not full-file or symbol-centered
expansion. The default **compact serialized pack** budget is 64 KiB; `maxBytes`
is clamped to 16–128 KiB. Optional evidence is trimmed in a fixed order, with
honest truncation; a mandatory header that cannot fit is rejected. HTTP envelope
and pretty-print overhead are outside that compact-pack budget.

Source collection is capped at depth 8, 10,000 entries plus an overflow probe,
500 accepted files, 128 KiB per file and 4 MiB read bytes per observation (a
single extra byte can probe file growth). Rejected binary reads consume the
budget too. Collection runs twice to detect observed changes. Oversized
directories are omitted instead of retaining an enumeration-order-dependent
subset. Sensitive paths, symlinks, unsupported extensions, nested Git boundaries
and registered subprojects are excluded; both canonical-parent and selected-
worktree registrations contribute boundaries. Raw internal Git paths are absent.

Opened files and directory anchors are verified through kernel descriptor paths
before content reads. **Source collection currently requires Linux/WSL with
`/proc/self/fd`; unavailable descriptor verification fails closed**, yielding
partial metadata-only results rather than falling back to raceable path checks.

### Revision, determinism and limitations

Git state and bounded source observations are compared before/after composition;
observed changes reject the pack. Dirty, unborn, non-Git and unavailable states
retain explicit status and never masquerade as a clean committed snapshot.
`observation.basis` is `working_tree`; cache reuse is disabled for every state.
The observation source digest covers only collected sources, **not** the whole
worktree and not a new project identity or Git dirty-state fingerprint.

Equivalent normalized inputs and unchanged observed state produce byte-identical
pack JSON. `generatedAt` is deliberately `null`; volatile revision `capturedAt`
is excluded. Transport time may be conveyed by HTTP Date. This refines the older
timestamp sketches below without changing the Step 1 revision-reader contract.

There is no atomic whole-repository snapshot or analyzer wall-clock guarantee.
Source caps can omit relevant evidence; inspect truncation/incomplete flags.
Secret-pattern redaction is defense in depth, not a complete DLP system. Symbol
support is inherited from TypeScript/JavaScript and .NET analyzers, plus optional
sandboxed Serena/Python. Mixed-language snapshots retain native priority and
explicit partial coverage; unsupported languages have file/document evidence only.
Expansion means resubmitting narrower paths/symbols or opting into bounded
excerpts. There is no expansion endpoint, persistent Context Pack cache, stage
resolver, LLM/provider routing, agent selection, scheduler or Hermes runtime.
**Impact v2, Effective Scope, conflicts and later phases are not implemented.**

The remaining proposed APIs, richer tiers and output sketches in this document
describe the longer-term architecture, not the shipped Step 2 interface.

## ICM responsibilities

ICM should describe:

```text
stage
inputs
process
outputs
constraints
success criteria
handoff
references
```

ICM should not describe:

```text
specific provider
specific LLM
worker PID
runtime retry loop
GPU allocation
```

## Canonical document roles

### `AGENTS.md`

Bootstrap/project-level working instructions understood by the runtime.

### `AGENT.md`

Structured agent/workspace contract.

Front matter is intended to be machine-readable and enforceable.

### `PROJECT.md`

Stable project description / boundaries.

### `CONTEXT.md`

Stage/process routing and localized context.

### ADRs

Explicit architectural decisions and rationale.

## Proposed ICM resolver API

**PLANNED**

Internal service surface:

```text
discoverIcm(project)
parseIcmDocument(path)
buildIcmIndex(project)
resolveIcmStage(project, task)
validateIcm(project)
```

Suggested external operation:

```text
GET /api/intelligence/projects/:project/icm
```

or equivalent versioned route consistent with the current API.

Do not implement a new route shape until the current route conventions are re-read.

## Context Pack

The Context Pack is the main token-efficiency mechanism.

Input:

```text
task
project
git revision
ICM stage
requested symbol/module
profile
```

Derived evidence:

```text
relevant symbols
direct references
bounded graph
impact
affected tests
architecture rules
current task conflicts
relevant project history
```

Output:

```json
{
  "projectId": "...",
  "revision": "...",
  "taskId": "...",
  "stage": "...",
  "summary": "...",
  "constraints": [],
  "symbols": [],
  "files": [],
  "impact": [],
  "tests": [],
  "decisions": [],
  "history": [],
  "scopeHints": {}
}
```

## Bounded-context rules

1. Never return the complete graph by default.
2. Respect per-section limits.
3. Prefer symbols and evidence over raw full files.
4. Include file/line references when possible.
5. Expand on demand.
6. Mark the Git revision used to construct the pack.
7. Mark confidence/source for derived claims.
8. Do not include unrelated project memories.
9. Do not use historical memory as proof of current code state.

## Context Pack tiers

### FAST

Use for small tasks.

```text
task
+ local symbols
+ direct constraints
+ direct tests
```

### STANDARD

Use for most feature work.

```text
FAST
+ direct/transitive impact
+ relevant ADRs
+ ICM stage
+ conflict hints
```

### DEEP

Use for high-impact architecture/refactors.

```text
STANDARD
+ broader graph
+ historical incidents
+ multiple affected modules
+ richer review requirements
```

## Acceptance criteria

- deterministic for the same repository revision and inputs;
- bounded by configured limits;
- no unrelated project context;
- every code-derived assertion tied to current revision;
- does not require an LLM to discover basic project topology;
- can be consumed by multiple profiles without rebuilding the same analysis.

## Provenance and untrusted context

Every Context Pack section should retain source metadata.

Repository text/tool output is content, not runtime policy.

Context construction should label:

```text
trusted policy
canonical project facts
derived analysis
historical observations
untrusted repository/tool text
```

See `31_THREAT_MODEL_AND_TRUST_BOUNDARIES.md`.

## Cache/invalidation

Context Pack reuse follows `35_CACHE_AND_DERIVED_STATE.md`, including dirty-worktree handling.
