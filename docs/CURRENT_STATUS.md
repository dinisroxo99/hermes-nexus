# Current status

[Home](../README.md) · [Vision](VISION.md) · [Concepts](CONCEPTS.md) · [Architecture](ARCHITECTURE.md)

## Verification boundary

This is a linked public summary of the implementation checkpoint, not a separate
implementation plan or a live view of another checkout.

The documentation gate lives in the orchestrator and reviewer SOUL.

Current repository revision (2026-09-26):
`9fdcae32479ca688d49aab7c85ad83e704636ced` (tree
`1ff8944347df384674b6a1d675afc8226a5297ce`).
Plugin/caller pin: `6ebb7aaa7ae7027c3e590a51bdbf5b5935651776` (tree
`8e97d59c406e9a1e195fcff4213c941d4f07f5de`; merge of the gated ETS caller).
Service pin: `85e511e7f65061cda861c98cd1acfbe9d79526b1` (tree
`6f96db4a43043764f266920872a844825bb59482`). These three SHAs are not
interchangeable. Composer `e9faf6a3f1e18224479e45b0f1afa2f1ac8405c5` and caller
`cc4fcbcbad68de2d6e8d4bed9df9eaff29a60acb` are ancestors of the plugin pin.
The previous public-docs checkpoint
`725729f4d9d78e669dcd74d7cdb08210c8828b14` (main merge
`ef32c8c9c721e251a53240c264e315ab42817bb7`) is also an ancestor.
Step 3 was independently accepted at historical SHA
`4d8d23e564e355d84916b93d890762ac0c7498ee`, an ancestor of this candidate.
**Steps 1, 2, 2.5 and 3 are complete. Step 4 is NOT INITIATED as coordination/enforcement.**
`787f662` / adapter 1A do **not** enter this delta.

The tracked `hermes-nexus` plugin delivers `project_task_context` and
`project_impact` in `project_intelligence`. `provides_tools` remains exactly
those two names; `project_effective_task_scope` does **not** enter the global yaml.
[DEV-ADOPTION-1](hermes-plugin-installation.md#dev-adoption-1--approved-development-adoption)
approves normal development adoption, including concurrent workers, for
orchestrator, architect, implementer, tester, reviewer and documenter; default
and workspace-manager are excluded. Two-tool publication and six-profile H-only
offline adoption are accepted as recorded in that installation contract. ETS is
read-only classification, not Step 4, Conflict Engine or Guard.
Nine legacy Project Map tools remain deferred (LEGACY/DEFERRED), not a blocker
for the two-tool path.
**G1 remains REJECTED; R1/R2 remain OPEN / HIGH**, HIGH severity and
LOW/non-blocking development priority, with original R2 MEDIUM retained in
[known issues](KNOWN_ISSUES.md). This is not production readiness, G1 PASS,
or a lifecycle fix. This documentation does not claim boot after WSL restart,
24/7 availability, or that the systemd unit runs this repository HEAD.

Dated 2026-09-25 handoffs (not live probes in this documentation task) record
ETS caller exposure on independent pinned plugin copies, not symlinks, with
`scope_enabled: true` for orchestrator, architect, implementer, tester,
reviewer and documenter. Pin, `scope_enabled`, SOUL (instructions, not a
wrapper) and proofs: [ETS profile exposure](ETS_PROFILE_EXPOSURE.md).
`default` and `workspace-manager` remain excluded;
workspace-manager has no flag. Hide-by-omit: `register()` adds
`project_effective_task_scope` only when `scope_enabled` is exactly true
(omitted or false ≠ true). `includeTests` omitted in the plugin ≠ true; SOUL
paragraphs are instructions, not a wrapper. ETS is read-only classification;
WRITE does not authorize edit, lock, dispatch or new cards, and does not open
Step 4, Conflict Engine, Guard, legacy tools or extra documentation work.
Incomplete / partial / unsupported / unavailable / `not_evaluated` ≠ safety.
Test candidates ≠ results. Do not invent `dirty: false` or opaque IDs.
The service revision reader no longer treats untracked `__pycache__/` and `*.pyc` as dirty; other untracked paths and all tracked dirt still count; `dirty: false` is never invented.
When obtaining ETS: Context, then Impact and ETS with `includeTests` true;
standalone Impact keeps the tool default (omitted ≠ true). Byte reviews of
those six copies recorded APPROVE with 0 material findings. Orchestrator card
`t_8318a878` is the old TUI / long session: tools were not loaded (marker
`ETS_ORCHESTRATOR_EXPOSE_LIVE_PROOF_JS_NOT_EXECUTED`); that card is not the
session that ran the tools. After that TUI quit, a new session ran the
orchestrator live proof. Operator-authorized record only: `evidence_found`;
ETS `incomplete`; WRITE 1; WATCH 5. Incomplete ≠ safety; WRITE does not
authorize; not G1 PASS; Step 4 not initiated.
Operator-authorized implementer, tester, and reviewer SOUL hashes and inspect live proofs for ETS profile exposure are recorded in [ETS profile exposure](ETS_PROFILE_EXPOSURE.md).

[INFRA-1](hermes-plugin-installation.md#infra-1--approved-implementation-pending)
current operation is accepted at the service pin, with WSL-restart boot not
demonstrated and rollback not proved. That acceptance is not liveness, boot
PASS, 24/7 availability, G1 PASS, or a claim that the unit runs this HEAD.
The old PMW expired at `2026-09-24T11:16:43+01:00`; no extension,
shutdown or live-state check is demonstrated here.

### Historical Serena/mainline consolidation evidence

The following pins and test counts describe that earlier integration, not the
current branch or a new test run:

- Repository: `dinisroxo99/hermes-nexus`.
- Consolidation branch: `integration/serena-main-baseline`.
- Exact mainline base revision: **`ba2ea1df6188a6026afc29a8f457ede105344dcd`**
  (`ba2ea1d`, `docs: finish Hermes Nexus naming consistency`).
- Exact Serena/Node.js revision integrated: **`87fc6b59e71ee93f40bc4ffdb0c0663365b50a1a`**
  (`87fc6b5`, `chore: ignore discovered project registry state`).
- Implementation authority: the [active plan](../.hermes/plans/2026-09-17_002050-project-intelligence-service-active.md),
  read with current source and the detailed contracts linked below.
- Documentation is refreshed on the same branch for that implementation revision.

At that consolidation checkpoint, Steps 1, 2 and 2.5 were complete and Step 3
had not started. The optional Serena/Python continuation remains opt-in.

The Node.js routing fix has passed architecture review, testing and code review.
The previous Serena/Python implementation checkpoint reports **338 tests passed, 0 failed, 0 skipped**
with `SERENA_DOCKER_TESTS=1 npm test`; 46 focused tests and 14 explicit real Docker
tests also pass with no skips. `npm run check`, syntax checks of 14 changed JS
and 2 Python files, and `git diff --check` pass. Final independent re-review found
no remaining concrete security/logic blockers (29 targeted tests independently passed).
That is the implementation verification record, not a claim that every command
was rerun by a reader of this page. Those test counts are historical, not a new
candidate verification or plugin lifecycle acceptance.

## Implemented

| Capability | What is present | Detailed evidence / contract |
|---|---|---|
| Project foundation | Local HTTP API and graph UI; configured roots, manual/discovered registry, bounded discovery/overview, ICM indexing and workspace-path matching. | [Service reference](SERVICE_REFERENCE.md), [route registration](../src/routes/intelligence.routes.js), [ICM contract](project-icm.md) |
| Step 1 — Project Identity / Revision | Optional persisted opaque projectId, independent of name/path/HEAD/remote; compatible legacy records; unambiguous configured-root-bound lookup; safe overview identity/revision projection. Linked worktrees reuse verified parent identity. Both existing analysis and .NET symbol caches are revision/worktree-aware. | [Identity contract](project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md), [project resolution](../src/lib/projects.js), [revision tests](../tests/project-revision.test.js) |
| Step 2 — Task Context Pack | Bounded, project/revision-scoped composition of task, ICM, files, symbols, direct references and heuristic tests, with provenance and omission indicators. Deterministic selection, not a repository prompt dump or arbitrary LLM summary. Read-only; no persistent pack cache. | [Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md), [builder](../src/lib/task-context.js), [HTTP tests](../tests/task-context-routes.test.js) |
| Step 2.5 — Analyzer Provider Layer | Normalized contract and native adapters; deterministic selection/fallback; provider/version/capability/language metadata; bounded snapshot-scoped external evidence validation; polyglot symbol-name normalization. Node.js projects remain classified as `nodejs` while resolving to the existing JavaScript-capable native TypeScript analyzer. Task Context Pack consumes normalized providers and exposes partial/not_analyzed coverage. | [Provider contract](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md), [provider selection](../src/analyzers/common/analyzer-providers.js), [data validator](../src/analyzers/external/snapshot-provider.js), [pack/provider tests](../tests/task-context-providers.test.js), [Node.js routing tests](../tests/nodejs-analyzer-routing.test.js) |
| Existing graph impact | Bounded node-based impact, symbol context and graph insights. This is not Step 3 Impact v2. | [Graph intelligence](../src/lib/graph-intelligence.js), [analyzer service tests](../tests/analyzer-service.test.js) |
| Step 3 — Impact v2 | Bounded file/multi-file reverse-impact evidence and optional affected-test candidates, resolved against persisted project/worktree/revision, with reobservation and independent output caps. | [Impact contract](project-intelligence/06_SCOPE_IMPACT_CONFLICTS.md), [HTTP route](../src/routes/project-impact.routes.js), [service tests](../tests/project-impact-service.test.js) |
| Hermes thin plugin | Exactly two tracked read-only tools (`project_task_context`, `project_impact`); `compose_effective_task_scope` exists in plugin at `e9faf6a3f1e18224479e45b0f1afa2f1ac8405c5`, read-only local, sem tool/rota/schemas; labels only WRITE e WATCH; RESERVED/IMPACT `not_emitted`. `feat/legacy-project-map-t_d032c9fe@787f662df941ea8461efeb0db86f51ad569a461c` / adapter 1A do not enter this delta. Two-tool publication is accepted as recorded in the installation contract, not automatic installation or Guard. | [Usage contract](hermes-tool-integration.md#dev-adoption-1--two-tool-usage-contract), [open limitations](KNOWN_ISSUES.md), [composer](../integrations/hermes-nexus/effective_task_scope.py) |
| Gated ETS caller | `project_effective_task_scope` (local compose from accepted pack+impact) exists at ancestor `cc4fcbcbad68de2d6e8d4bed9df9eaff29a60acb` on pin `6ebb7aaa7ae7027c3e590a51bdbf5b5935651776`. Hidden via `register_tool` omission unless `scope_enabled` is exactly true. `provides_tools` lists exactly the two core tools. Six development profiles have independent pin copies with `scope_enabled: true`; `default` and `workspace-manager` excluded. Read-only classification, not Step 4 coordination/enforcement. | pin 6ebb7aaa; [effective_task_scope](../integrations/hermes-nexus/effective_task_scope.py) |
| Optional Serena/Python | Real semantic symbols, definitions and references through a pinned offline snapshot-only Docker worker; mounted-source binding, strict validation, bounded cleanup and explicit fallback. | [Runtime guide](../docker/serena-python/README.md), [provider contract](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md), [real semantic tests](../tests/serena-python-docker.test.js), [real sandbox tests](../tests/serena-sandbox-docker.test.js) |

### Current intelligence endpoints

Verified in [route registration](../src/routes/intelligence.routes.js):

```text
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
POST /api/intelligence/projects/:projectId/task-context
POST /api/intelligence/projects/:projectId/impact
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

**Effective Task Scope (Step 4, not initiated as coordination/enforcement)** → Conflict Engine →
Hermes Guard integration → Telemetry / validated project history → Project Expert
→ Learning / evaluation.

Context selection and the now separate Impact v2 operation are distinct;
workspace matching is not effective scope or conflict analysis. Hermes retains profiles, agents, models/providers,
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
