# Current status

[Home](../README.md) · [Vision](VISION.md) · [Concepts](CONCEPTS.md) · [Architecture](ARCHITECTURE.md)

## Verification boundary

This is a linked public summary of the implementation checkpoint, not a separate
implementation plan or a live view of another checkout.

- Repository: `dinisroxo99/hermes-nexus`.
- Implementation branch: `feat/project-intelligence-service`.
- Exact base revision: **`be0cb2c7b30d9f082e02df24a4113ddffc8c9ab2`**
  (`be0cb2c`, `docs: checkpoint polyglot analyzer provider step`).
- Implementation authority: the [active plan](../.hermes/plans/2026-09-17_002050-project-intelligence-service-active.md),
  read with current source and the detailed contracts linked below.
- Documentation branch: `docs/project-intelligence-public-overview`, rebased onto
  that exact locally available revision. Later or uncommitted work is excluded.

**Steps 1, 2 and 2.5 are COMPLETE. Step 3 — Impact v2 is NEXT and NOT STARTED.**
No additional implementation task is represented as in progress at this checkpoint.

The implementation checkpoint reports **306 tests passed, 0 failed, 0 skipped**,
plus passing `npm run check`, explicit syntax checks and `git diff --check`.
That is the implementation verification record, not a claim that every command
was rerun by a reader of this page. Older test counts and historical snapshots
are not the current baseline.

## Implemented

| Capability | What is present | Detailed evidence / contract |
|---|---|---|
| Project foundation | Local HTTP API and graph UI; configured roots, manual/discovered registry, bounded discovery/overview, ICM indexing and workspace-path matching. | [Service reference](SERVICE_REFERENCE.md), [route registration](../src/routes/intelligence.routes.js), [ICM contract](project-icm.md) |
| Step 1 — Project Identity / Revision | Optional persisted opaque projectId, independent of name/path/HEAD/remote; compatible legacy records; unambiguous configured-root-bound lookup; safe overview identity/revision projection. Linked worktrees reuse verified parent identity. Both existing analysis and .NET symbol caches are revision/worktree-aware. | [Identity contract](project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md), [project resolution](../src/lib/projects.js), [revision tests](../tests/project-revision.test.js) |
| Step 2 — Task Context Pack | Bounded, project/revision-scoped composition of task, ICM, files, symbols, direct references and heuristic tests, with provenance and omission indicators. Deterministic selection, not a repository prompt dump or arbitrary LLM summary. Read-only; no persistent pack cache. | [Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md), [builder](../src/lib/task-context.js), [HTTP tests](../tests/task-context-routes.test.js) |
| Step 2.5 — Analyzer Provider Layer | Normalized contract and native adapters; deterministic selection/fallback; provider/version/capability/language metadata; bounded snapshot-scoped external evidence validation; polyglot symbol-name normalization. Task Context Pack consumes normalized providers and exposes partial/not_analyzed coverage. | [Provider contract](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md), [provider selection](../src/analyzers/common/analyzer-providers.js), [data validator](../src/analyzers/external/snapshot-provider.js), [pack/provider tests](../tests/task-context-providers.test.js) |
| Existing graph impact | Bounded node-based impact, symbol context and graph insights. This is not Step 3 Impact v2. | [Graph intelligence](../src/lib/graph-intelligence.js), [analyzer service tests](../tests/analyzer-service.test.js) |

### Current intelligence endpoints

Verified in [route registration](../src/routes/intelligence.routes.js):

```text
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
POST /api/intelligence/projects/:projectId/task-context
```

Registration is state-changing and disabled by default. The task-context POST
is **read-only**, requires an existing persisted projectId and does not enroll
projects. Analyzer descriptors/responses are server-side inputs, not public
task-context request fields. No provider-execution, dedicated ICM or task-scope/
conflict endpoint is introduced by Step 2.5. HTTP support does not imply an
installed Hermes tool or automatic guard integration.

### Current language evidence

| Language | Default evidence at this checkpoint |
|---|---|
| C# / .NET | Native structural analysis. |
| TypeScript | Native structural analysis. |
| JavaScript / JSX | Native structural analysis through the TypeScript provider. |
| Python / Go / Rust / Java | Language observation only; no semantic analysis by default. |
| Bash / PowerShell | Bounded text observation, without execution; no semantic analysis by default. |

The levels `unsupported`, `structural` and `semantic` are per-operation capability
declarations. Native precise definitions, implementations and compiler diagnostics
are unsupported. Observed languages, protocol fixtures and provider extensibility
are not compiler-level semantic truth or proof of installed LSP support.
See [the full matrix](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md#languagecapability-matrix).

### Limits that still apply

- Source collection requires Linux/WSL `/proc/self/fd` verification; unavailable
  verification fails closed to partial metadata-only evidence.
- Packs are bounded working-tree observations with change checks, not atomic
  whole-repository snapshots. Test candidates are heuristic, not coverage proof.
- Partial language/operation coverage remains explicit. A single provider is
  selected; graph union is not automatic. Missing analysis is not an empty result
  proving there are no relevant symbols or references.
- External JSON is untrusted evidence bound to an authorized snapshot and
  provider request. The adapter executes no tools and is not a sandbox for
  arbitrary plugins. Existing ICM, identity/revision and cache ownership remain.
- Workspace scope matching and declared ICM constraints do not grant or enforce
  WRITE permissions. Legacy ID-less records need explicit enrollment before
  ID-required operations; moves require explicit locator maintenance.
- The server binds to all interfaces by default. Local retrieval boundaries
  are not a hardened public-deployment or agent-sandbox guarantee.

## Planned next layers

Following the [active implementation plan](../.hermes/plans/2026-09-17_002050-project-intelligence-service-active.md):

**Impact v2 (next, not started)** → Effective Task Scope → Conflict Engine →
Hermes Guard integration → Telemetry / validated project history → Project Expert
→ Learning / evaluation.

Existing context selection is not Impact v2; workspace matching is not effective
scope or conflict analysis. Hermes retains profiles, agents, models/providers,
Kanban/task lifecycle, workers, sessions, worktrees and retries. These are not
features to reimplement inside this service. Project-specific training/adapters
remain deferred; current code facts should be retrieved.

## Proposed: optional external semantic integration

**Serena/LSP runtime integration is PROPOSED ONLY**, requiring separate approval.
Step 2.5 did not install Serena, start language servers or implement semantic
analysis for Python/Go/Rust/Java.

The first candidate is optional local Python with pinned Serena/Pyright,
read-only exported snapshots, no live repository or `.git`/HOME/credentials/
container socket, no network egress, bounded resources and a semantic read-only
tool allowlist. See the [public proposal boundary](ARCHITECTURE.md#proposed-serena--lsp-integration)
and [exact technical proposal](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md#exact-serenalsp-integration-proposal--approval-required).
Real-server conformance is an approval gate, not something the data-only fixtures
have already demonstrated.

## Keeping this summary current

For a later checkpoint, inspect its source/routes and active plan, rerun the
existing checks and update this revision and the README together. Preserve the
distinction between completed contracts, unstarted layers and optional proposals.
The earlier post-Step-2.5 refresh is now reflected here; no pending completion
claim remains for that step.

Historical records in [current-state checkpoints](project-intelligence/01_CURRENT_STATE.md)
and phase-design documents retain their original context. Consult their explicit
checkpoint and the current active plan rather than equating every older phase
number or test count with the current implementation.
