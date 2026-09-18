# Current status

[Home](../README.md) · [Vision](VISION.md) · [Concepts](CONCEPTS.md) · [Architecture](ARCHITECTURE.md)

## Verification boundary

This is a linked public summary of the implementation checkpoint, not a separate
implementation plan or a live view of another checkout.

- Repository: `dinisroxo99/hermes-nexus`.
- Consolidation branch: `integration/serena-main-baseline`.
- Exact mainline base revision: **`ba2ea1df6188a6026afc29a8f457ede105344dcd`**
  (`ba2ea1d`, `docs: finish Hermes Nexus naming consistency`).
- Exact Serena/Node.js revision integrated: **`87fc6b59e71ee93f40bc4ffdb0c0663365b50a1a`**
  (`87fc6b5`, `chore: ignore discovered project registry state`).
- Implementation authority: the [active plan](../.hermes/plans/2026-09-17_002050-project-intelligence-service-active.md),
  read with current source and the detailed contracts linked below.
- Documentation is refreshed on the same branch for that implementation revision.

**Steps 1, 2 and 2.5 are COMPLETE. Step 3 — Impact v2 is NEXT and NOT STARTED.**
The optional Serena/Python continuation is also complete and remains opt-in.

The Node.js routing fix has passed architecture review, testing and code review.
The previous Serena/Python implementation checkpoint reports **338 tests passed, 0 failed, 0 skipped**
with `SERENA_DOCKER_TESTS=1 npm test`; 46 focused tests and 14 explicit real Docker
tests also pass with no skips. `npm run check`, syntax checks of 14 changed JS
and 2 Python files, and `git diff --check` pass. Final independent re-review found
no remaining concrete security/logic blockers (29 targeted tests independently passed).
That is the implementation verification record, not a claim that every command
was rerun by a reader of this page. Older test counts and historical snapshots
are not the current baseline.

## Implemented

| Capability | What is present | Detailed evidence / contract |
|---|---|---|
| Project foundation | Local HTTP API and graph UI; configured roots, manual/discovered registry, bounded discovery/overview, ICM indexing and workspace-path matching. | [Service reference](SERVICE_REFERENCE.md), [route registration](../src/routes/intelligence.routes.js), [ICM contract](project-icm.md) |
| Step 1 — Project Identity / Revision | Optional persisted opaque projectId, independent of name/path/HEAD/remote; compatible legacy records; unambiguous configured-root-bound lookup; safe overview identity/revision projection. Linked worktrees reuse verified parent identity. Both existing analysis and .NET symbol caches are revision/worktree-aware. | [Identity contract](project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md), [project resolution](../src/lib/projects.js), [revision tests](../tests/project-revision.test.js) |
| Step 2 — Task Context Pack | Bounded, project/revision-scoped composition of task, ICM, files, symbols, direct references and heuristic tests, with provenance and omission indicators. Deterministic selection, not a repository prompt dump or arbitrary LLM summary. Read-only; no persistent pack cache. | [Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md), [builder](../src/lib/task-context.js), [HTTP tests](../tests/task-context-routes.test.js) |
| Step 2.5 — Analyzer Provider Layer | Normalized contract and native adapters; deterministic selection/fallback; provider/version/capability/language metadata; bounded snapshot-scoped external evidence validation; polyglot symbol-name normalization. Node.js projects remain classified as `nodejs` while resolving to the existing JavaScript-capable native TypeScript analyzer. Task Context Pack consumes normalized providers and exposes partial/not_analyzed coverage. | [Provider contract](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md), [provider selection](../src/analyzers/common/analyzer-providers.js), [data validator](../src/analyzers/external/snapshot-provider.js), [pack/provider tests](../tests/task-context-providers.test.js), [Node.js routing tests](../tests/nodejs-analyzer-routing.test.js) |
| Existing graph impact | Bounded node-based impact, symbol context and graph insights. This is not Step 3 Impact v2. | [Graph intelligence](../src/lib/graph-intelligence.js), [analyzer service tests](../tests/analyzer-service.test.js) |
| Optional Serena/Python | Real semantic symbols, definitions and references through a pinned offline snapshot-only Docker worker; mounted-source binding, strict validation, bounded cleanup and explicit fallback. | [Runtime guide](../docker/serena-python/README.md), [provider contract](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md), [real semantic tests](../tests/serena-python-docker.test.js), [real sandbox tests](../tests/serena-sandbox-docker.test.js) |

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
| JavaScript / JSX / Node.js | Native structural analysis through the TypeScript provider; `nodejs` remains a project classification, not a separate analyzer identity. |
| Python | Observation by default; optional image enables semantic symbols, definitions and references. |
| Go / Rust / Java | Language observation only; no semantic analysis. |
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
- Native JavaScript/Node.js evidence is structural. CommonJS `require()`
  relationships are not fully modeled, and `.mjs`/`.cjs` coverage remains limited
  or unsupported where the native analyzer cannot observe it.
- External JSON is untrusted evidence bound to an authorized snapshot and
  provider request. The codec executes no tools; the separate optional Serena
  transport runs only its fixed semantic image, not arbitrary plugins. Existing
  ICM, identity/revision and cache ownership remain unchanged.
- Optional transport is synchronous and can block Node for its bounded request;
  missing project packages or out-of-snapshot targets may limit analysis or fail
  closed. No Python diagnostics/implementations/dependencies are advertised.
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

## Optional external semantic integration

Serena SolidLSP/Pyright is implemented for Python only, disabled by default until
the operator builds/verifies the pinned image and supplies its immutable local
ID through trusted `SERENA_PYTHON_IMAGE` configuration. No host Python package
installation, runtime download, Docker host reconfiguration or service startup
is performed automatically. The image is not pushed by this checkpoint.

The worker has no live repository, `.git`, host HOME, credentials or Docker
socket, and no runtime network. It is non-root with read-only input/root, bounded
tmpfs, CPU/memory/PID limits, deadline/output limits and verified cleanup.
Serena editing/shell/memory/project-switching/agent operations are not exposed.
See the [public boundary](ARCHITECTURE.md#optional-serena--python-integration),
[exact technical contract](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md#implemented-optional-serenapython-checkpoint)
and [pinned version inventory](../docker/serena-python/versions.json).

Existing native .NET/TypeScript/JavaScript results remain unchanged. Failed
external evidence permits deterministic fallback without graph merging; missing
analysis remains explicit. Other language integrations are deferred.

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
