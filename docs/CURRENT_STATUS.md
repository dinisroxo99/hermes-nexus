# Current status

[Home](../README.md) · [Vision](VISION.md) · [Concepts](CONCEPTS.md) · [Architecture](ARCHITECTURE.md)

## Verification boundary

This is a linked public summary of the implementation checkpoint, not a separate
implementation plan or a live view of another checkout. A versioned document
does **not** automatically track `origin/main` HEAD. Use dated checkpoints and
named handoffs.

The documentation gate lives in the orchestrator and reviewer SOUL.

Keep evidence categories separate:

- **Current code:** observed Git revision, contracts, tests.
- **Reported install:** dated inventories/hashes/handoffs; not a new machine
  inspection. This documentation mission did **not** recopy plugins or restart
  Hermes/Nexus.
- **Executed proof:** command/session, revision, relevant config, observed
  result. The six controlled collect-persist proofs remain historical; they
  were **not** re-run here.
- **Intent/authorization:** operator decisions, task contract, roadmap; they
  do not prove implementation.

Merge is not deployment. Installed files are not loaded modules. Collector
success is not all tools. Tool `ok=true` is not a persistence receipt. Six
controlled proofs are not continuous collection on CLI, gateway, or workers.
Acceptance-with-limitations is not production, no-leaks, or 24/7.

Git proves content, not ancestry of a different commit, and does not authorize
operations. This page does not invent `dirty: false` or opaque IDs. Untracked
`__pycache__` is not Nexus dirty. Other untracked paths and all tracked dirt
still count.

## Checkpoint 2026-09-29

### Current code

Dated **2026-09-29**, helper CLIs
`python3 -B -m scripts.nexus_request_preflight` and
`python3 -B -m scripts.nexus_log_inspector` are present in the code
baseline **`4d6a78632e772e7ca43fadf37b287213d6f9ea93`** (merge of PR #41;
tree `6e31798f3bf5b334fa94183714c6bfcb43b9df12`). They are **not**
pending merge, **not** Hermes tools, and **not** Roadmap Step 4. The
helper classification on this page is a documentation delta on top of
that baseline and is **not** contained in that baseline commit.
Roadmap Step 4 remains Effective Task Scope as
coordination/enforcement and is **not started**.

Present here (verified in this worktree; invocation from repo root):

- **Request-preflight helper CLI** (PR #39 merge
  `07845ba0fc86440a080f81ffe4ad3fe125ec726d`, ancestor of the code
  baseline):
  `python3 -B -m scripts.nexus_request_preflight`
  (`scripts/nexus_request_preflight/__main__.py`). Local syntax-only
  validator for `project_task_context` / `project_impact` argument JSON.
  Not a Hermes tool, not an HTTP endpoint, not Context/Impact/ETS, and
  not Step 4 coordination/enforcement. Guide:
  [request-preflight](development/request-preflight.md).
- **Log-inspector helper CLI** (PR #41, code baseline merge):
  `python3 -B -m scripts.nexus_log_inspector`
  (`scripts/nexus_log_inspector/__main__.py`,
  `scripts/nexus_log_inspector/inspector.py`). Offline stdlib reader for
  an explicit `collect-forward-log.jsonl` path. Not a Hermes tool, not
  live collection, and not Step 4. Guide:
  [log-inspector](development/log-inspector.md).

Public checkpoint **`050540d0ebb3899198a5695eaec913de59cb1b8d`**
(merge of PR #38; parents `643eb3ab` and `66262a83`) is an ancestor
included in this revision. The PR #38 docs/code delta is implemented at
that checkpoint and is **not copied into local installations**. Git
presence is not profile installation. Live worker Context → Impact →
ETS use is not demonstrated in this documentation batch. `050540d0` does
**not** inventory the PR #39 / PR #41 helper CLIs; those exist on the
code baseline.

Dated **2026-09-28**, code on `origin/main` was observed as
`643eb3ab6433389f99264bc2b0a1aff7389ddc5d` (merge of PR #37 `--merge`).
That SHA is **not** live service and is now an ancestor of `050540d0`.

Live service (untouched; cwd `/home/dinis/projects/hermes-nexus-service`,
not the human checkout, detached HEAD) remains
`bc8b52d7280e7adc83f05cb20df97fbb3199804c` (merge of PR #30; tree
`7f1d5c337999e0592c25bfdb9799c31fe0c747c1`) after accepted human service
move (operator; 2026-09-28). Do not treat `origin/main` as live.
`/api/health` 200 has no SHA field; revision proof is that cwd HEAD, not
health.

**Steps 1, 2, 2.5 and 3 are complete. Step 4 is NOT INITIATED as
coordination/enforcement.** Step 4 = Effective Task Scope as
coordination/enforcement; Step 5 = Conflict Engine; Step 6 = Guard
integration. WRITE/WATCH classification is not a complete
coordination/enforcement system. Historical local names (Step 4.0/4.1)
identify earlier slices; they do not renumber the roadmap or mark those
phases complete. `787f662` / adapter 1A do **not** enter this delta.

### Canonicalization of the native caller (RESOLVIDO as Git on main)

At `643eb3ab` and still at checkpoint `050540d0`, canonical Git
`integrations/hermes-nexus/tools.py` is overlay sha256
`5dabeda0c30dd742e2b463fe1959d1cd133790e7a5a37e28422543a8ab5349e0`.

Historical content origin (**not** a proven ancestor of main):
`e62463eba49640448e42425b9e500497c4f02af0` on
`feat/caller-profile-native-context`. Architect `t_f32991a5` CLASSIFIED on
`643eb3ab`. **Do not present the native caller as code absent from main.**

Content equality of `tools.py` ≠ commit ancestry of `e62463e` on main, and
≠ byte equality of every installed file.

### PR #38 Git delta (included in this revision; not recopied)

<a id="candidate-only-git-delta-not-on-originmain-not-recopied"></a>

Implementer `t_ff92494d` recorded these commits on
`fix/post-canonicalization-reconciliation`; both are ancestors of
checkpoint `050540d0` (included in this revision, **not copied into local
installations**):

- `6152cea409589561852d2fd4c9b112ec3797c35c` — ETS handler description
  qualified: composer is pure (no IO); the handler may append a local
  collect-forward record. **Not recopied** to profile plugin copies. Do
  **not** declare Git/runtime byte equality. The new `schemas.py` text is
  in this revision and is **not** claimed installed.
- `4a61aba14bc73d2b6d3b44a710e5fb33d49798ed` — `.gitignore` rule exactly
  `/data/collect-forward-log.jsonl`. That rule is this repo's **default
  destination only**, not every `DATA_DIR`. Isolated real collector+Git
  unittest is **not** a live Hermes session. JSONL was not tracked.

Do not recopy. Do not restart.

### Reported install (dated 2026-09-28 handoffs)

Copied from named Kanban cards, not a personal dest-hash inspection and not
repeated by this documentation mission. File counts are **that handoff's
inventory**, not "always ten files" or "always seven files".

plugin instalado (local `~/.hermes/profiles/<name>/plugins/hermes-nexus`)
at those handoffs:

- nine files match `28e9815b1a6efed8bae41f0d513d9856c8a44858`
- `tools.py` overlay sha256
  `5dabeda0c30dd742e2b463fe1959d1cd133790e7a5a37e28422543a8ab5349e0`
  (same **tools.py** bytes as `e62463e` content and as the six-profile
  install at that date). Canonical Git `integrations/hermes-nexus/tools.py`
  **is** that overlay blob, **not** the `28e9815` `tools.py` blob
  (`54c0fdcf9547cb8f6d98a52a13d5cbb937f0759b`)
- `default` and `workspace-manager` were **not** installed (plugin
  install/config/exposure exclusion). That does **not** forbid using the
  workspace-manager **role**.

`provides_tools` still exactly two names (`project_task_context`,
`project_impact`). Two names are compatible with ETS gated by
`scope_enabled`. Do not add a third name to the manifest.

Local copies do **not** include the new `schemas.py` handler description
from `6152cea` (that text is in Git at `050540d0` and is **not copied
into local installations**). This documentation update does not authorize recopy or
restart.

The previous mixed install (`reader_dirty.py` blob from
`bc8b52d7280e7adc83f05cb20df97fbb3199804c:integrations/hermes-nexus/reader_dirty.py`;
resto `6ebb7aaa7ae7027c3e590a51bdbf5b5935651776`, tree
`8e97d59c406e9a1e195fcff4213c941d4f07f5de`) is **historical**, not the
2026-09-28 six-profile install handoff.

Hash-gate remaining 5: `t_cd20ab7c` PASS. Architect dest `tools.py`
`5dabeda0…` (`t_d215eea4` / `t_defcbfd1`). Recopy remaining 5:
`t_f8a1aba6`. **No recopy** of the six profiles in this mission. Profile-native
caller tests `t_a2277b22` CallerTests 33/33, test_tools 60/60; review
`t_56e363fe` PASS. Code gates: implementer `t_3110d536`, tester
`t_9ec8c071`, reviewer `t_463c224e`.

### Collect-forward semantics (current code on this revision; no code change)

<a id="collect-forward-semantics-current-code-on-this-candidate-no-code-change"></a>

Confirmed read-only against canonicalized plugin on this revision:

- Persisted INPUT contains **exactly** `runId`, `profile`, `sha`,
  `nexusTools`, `writePaths`, `watchPaths`.
- The collector's count-only return is **not** the persisted JSONL record.
- For Context, the caller requires `task.paths` to be a **list** to
  collect. Omission vs `[]` may be accepted by the tool and have
  **different** collection effects (omission skips persist; `[]` may
  persist empty `writePaths`).
- Collection depends on resolved identity (profile and `runId`) and a
  valid writable destination. The tool JSON result may be preserved even
  when there is no persistence.
- Hermes/collector process `DATA_DIR` is **not** automatically the Node
  service's. The collector does **not** run `resolveProjectConfig` and does
  **not** read `.env` directly.
- Installed copies need config the collector admits. Prior proofs used
  **explicit `DATA_DIR`**.
- `runId` is a correlation field with fallback (`kwargs.runId` →
  `HERMES_KANBAN_RUN_ID` → `session_id` → `task_id`). It may carry a
  Kanban run, a session, or a task. It does **not** necessarily identify a
  Kanban attempt and is **not** unique per call.
- `nexusTools` is boolean (`true` for accepted Context/Impact; `false` for
  accepted ETS). Mapping to Context/Impact/ETS does **not** mean "with
  Nexus vs without Nexus" in an experiment.
- `writePaths` / `watchPaths` are declared/derived call data, **not** an
  audit of edits made and **not** a permission grant.
- Minimal JSONL does **not** prove exactly-once, idempotence, concurrency,
  retention, coverage of all hooks, cross-run comparability, or
  training-data quality.

PR #33 (merge `003a5ed1b73bd9b82f36f6b462fdf132e96a1bc5`) integrated
source-local persist of `collect_forward_log` to
`<dataDir>/collect-forward-log.jsonl` with the six-key INPUT and count-only
return, without live-service change, recopy, or restart.

### Executed proofs (historical; not re-run)

Six-profile live collect persist (2026-09-28; no `HERMES_PROFILE`; `DATA_DIR`
prefix only; locator `expectedRevision.branch: null`, `task.paths: []`;
stored `runId` = kwargs.session_id; JSONL +1). Native profile from
`HERMES_HOME` exact `.../profiles/<name>` and/or `__file__`
`.../profiles/<name>/plugins/hermes-nexus/tools.py`. Fail-closed if neither;
HOME/`__file__` conflict skips persist. Hermes 0.21.5 `-p` does not export
`HERMES_PROFILE`. Live service HEAD throughout:
`bc8b52d7280e7adc83f05cb20df97fbb3199804c` (untouched).

| profile | card | session / stored runId | jsonl_after sha256 |
|---|---|---|---|
| architect | `t_30cbb71f` | `20260928_163841_aee965` | `000de80caaea6fc71d74bea2d5517c78721c02418e6af66f02528767a34b014f` (`t_30cbb71f` `jsonl_after.sha256`) |
| implementer | `t_ae7af4ff` | `20260928_170741_ac0c09` | `a1bd9974fad4964318b2116f1d84eeed199ae12e2749bbfa04bc3e2aeceb0e07` |
| tester | `t_d286e24a` | `20260928_171743_709433` | `165ab22d5566a3f4cfb56d1b6092dfee9c214ec2ab0810e3753c7451f229ae03` |
| reviewer | `t_8695e990` | `20260928_172135_ed86b2` | `5e22fc801570c38f112e3cabfbd6f4b971c2ab1fb91d6e725f4d13989da1ba06` |
| documenter | `t_2c324855` | `20260928_172518_08cdc7` | `0d26d286ff37094e71c262abb85cb389a052366cb3d56938d2877a881f7b0af2` |
| orchestrator | `t_29a66ff6` | `20260928_172918_30fdb4` | `ad48a803f2d579c0ab22becdcb4dae67f2750308c468c822972db0d1ecdf66de` |

Those six records do not declare continuous collection on CLI, gateway, or
workers. Empty lists and controlled trials do not automatically demonstrate
comparable logs, concurrency, or validated training data. Do not unblock
cards because six proof records exist.

The tracked `hermes-nexus` plugin delivers `project_task_context` and
`project_impact` in `project_intelligence`. `provides_tools` remains exactly
those two names; `project_effective_task_scope` does **not** enter the global yaml.
[DEV-ADOPTION-1](hermes-plugin-installation.md#dev-adoption-1--approved-development-adoption)
approves normal development adoption, including concurrent workers, for
orchestrator, architect, implementer, tester, reviewer and documenter; default
and workspace-manager are excluded from plugin install/config/exposure.
Two-tool publication and six-profile H-only offline adoption are accepted as
recorded in that installation contract. ETS is read-only classification, not
Step 4, Conflict Engine or Guard.

At repository revision `2ded0de4529ff65ac4c52cf55d992fd3cf6081d3`, the
[installation guide](hermes-plugin-installation.md#revision-pinned-installation-and-configuration)
listed **seven** plugin files including `collect_forward_log.py`. That is
**that revision's inventory**, not "always seven files". Historical rollback
pin `85e511e7f65061cda861c98cd1acfbe9d79526b1` retained five without
`effective_task_scope.py` or `collect_forward_log.py`. This documentation
alignment performs no profile copy or service change.

Etapa 3B: SOUL, installed hermes-nexus plugin.yaml, Hermes skills, and gateway
on the install with baseVersion 0.21.5 (commit
903a57c540917cedd30c7d971938f1af7bdf60e2, tag null) do not prove a hook for
Guard.
Closed-pipeline Main `44baa8678974614bc6cc4519c71772e6648434e4`. Dispatcher `t_01dc13a8` PASS.
Pipeline 1 docs · 2 docstring · 3A WRITE∩WRITE · 3B hook gap · 4 inventory is closed.
etapa 4 `NO_COMPARABLE_LOGS` (inventory `t_85a6ae43`; Historical Step 7 remains; no comparison table).
3B stands: Hermes 0.21.5 does not prove a hook.
Nine legacy Project Map tools remain deferred (LEGACY/DEFERRED), not a blocker
for the two-tool path.
**G1 remains REJECTED; R1/R2 remain OPEN / HIGH**, HIGH severity and
LOW/non-blocking development priority, with original R2 MEDIUM retained in
[known issues](KNOWN_ISSUES.md). This is not production readiness, G1 PASS,
or a lifecycle fix. This documentation does not claim boot after WSL restart
or 24/7 availability. The live unit's WorkingDirectory is
`/home/dinis/projects/hermes-nexus-service`, not the human checkout.

Dated 2026-09-25 handoffs (not live probes in this documentation task) record
ETS caller exposure on independent pinned plugin copies, not symlinks, with
`scope_enabled: true` for orchestrator, architect, implementer, tester,
reviewer and documenter. Pin, `scope_enabled`, SOUL (instructions, not a
wrapper) and proofs: [ETS profile exposure](ETS_PROFILE_EXPOSURE.md).
`default` and `workspace-manager` remain excluded from plugin
install/config/exposure; workspace-manager has no flag. Hide-by-omit:
`register()` adds `project_effective_task_scope` only when `scope_enabled`
is exactly true (omitted or false ≠ true). `includeTests` omitted in the
plugin ≠ true; SOUL paragraphs are instructions, not a wrapper. ETS is
read-only classification; WRITE does not authorize edit, lock, dispatch or
new cards, and does not open Step 4, Conflict Engine, Guard, legacy tools or
extra documentation work. Incomplete / partial / unsupported / unavailable /
`not_evaluated` ≠ safety. Test candidates ≠ results.
The service revision reader no longer treats untracked `__pycache__/` and `*.pyc` as dirty; other untracked paths and all tracked dirt still count; `dirty: false` is never invented.
D2 aligns the repository JavaScript and Python dirty readers to keep leading-space paths dirty, omit only eligible untracked exact `__pycache__` segments or `*.pyc`/`*.pyo` basenames, and reject malformed porcelain without inventing a clean result (JavaScript `dirty: null`; Python `not_evaluated` without `dirty`), without updating the live service.
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
current operation is accepted at live service
`bc8b52d7280e7adc83f05cb20df97fbb3199804c`, with WSL-restart boot not
demonstrated and rollback not proved. Rollback pin is
`75e0079489d3966548f3d70bd571419d4a6b13b7`.
`85e511e7f65061cda861c98cd1acfbe9d79526b1` remains historical only. That
acceptance is not liveness, boot PASS, 24/7 availability, or G1 PASS.
The old PMW expired at `2026-09-24T11:16:43+01:00`; no extension,
shutdown or live-state check is demonstrated here.

### Historical repository checkpoints

These SHAs are ancestors or earlier docs pins, **not** the public
checkpoint `050540d0` (PR #38) and **not** the dated 2026-09-28
`origin/main` observation `643eb3ab`:

- Docs previously named current `origin/main` as
  `354747661839f374d0b0e5bd811731a332666b54` (merge of PR #36; tree
  `f7b5704358cb93039a121e7f8de07fd9a998618f`) — historical checkpoint.
- `167293d72fef9fb3d2c8b82328ebefd8c81c4d3d` (docs PR #31) — historical.
- `28e9815b1a6efed8bae41f0d513d9856c8a44858` — historical install-set
  ancestor used in the dated nine-file match, not current `origin/main`.
- E8 recenter `c7aaf44ed2f407b4941b020160ccf1178f36eb69` (PR #24) —
  historical; not "this checkout".
- Rollback pin `75e0079489d3966548f3d70bd571419d4a6b13b7` (merge of PR #27;
  tree `d09d905194a656fd66f5e632ef3538ca1cc2200a`): restore by
  `checkout --detach` that SHA in the service worktree plus a human restart.
- `85e511e7f65061cda861c98cd1acfbe9d79526b1` (tree
  `6f96db4a43043764f266920872a844825bb59482`) — historical service pin
  only, not current live and not the current rollback pin.
- Composer `e9faf6a3f1e18224479e45b0f1afa2f1ac8405c5` and caller
  `cc4fcbcbad68de2d6e8d4bed9df9eaff29a60acb` are ancestors of resto
  `6ebb7aaa7ae7027c3e590a51bdbf5b5935651776`.
- Public-docs checkpoint / closed pipeline
  `44baa8678974614bc6cc4519c71772e6648434e4` (2026-09-26, PR #16) and
  `725729f4d9d78e669dcd74d7cdb08210c8828b14` (main merge
  `ef32c8c9c721e251a53240c264e315ab42817bb7`) are historical ancestors.
- Step 3 independently accepted at
  `4d8d23e564e355d84916b93d890762ac0c7498ee`.

These identities are not interchangeable even though `85e511e` is an
ancestor of resto `6ebb7aaa`, that resto SHA is an ancestor of `c7aaf44`
(PR #24), PR #24 is an ancestor of `75e0079`, that SHA is an ancestor of
live `bc8b52d`, which is an ancestor of `167293d` (docs PR #31), which is
an ancestor of `28e9815`, which is an ancestor of historical docs pin
`35474766`, which is an ancestor of observed 2026-09-28 `origin/main`
`643eb3ab`, which is an ancestor of public checkpoint `050540d0` (PR #38).

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
| Hermes thin plugin | Exactly two tracked read-only tools (`project_task_context`, `project_impact`); `compose_effective_task_scope` exists in plugin at historical `e9faf6a3f1e18224479e45b0f1afa2f1ac8405c5`, read-only local, without HTTP tool/route/schemas; labels only WRITE and WATCH; RESERVED/IMPACT `not_emitted`. `feat/legacy-project-map-t_d032c9fe@787f662df941ea8461efeb0db86f51ad569a461c` / adapter 1A do not enter this delta. Two-tool publication is accepted as recorded in the installation contract, not automatic installation or Guard. | [Usage contract](hermes-tool-integration.md#dev-adoption-1--two-tool-usage-contract), [open limitations](KNOWN_ISSUES.md), [composer](../integrations/hermes-nexus/effective_task_scope.py) |
| Gated ETS caller | `project_effective_task_scope` (local compose from accepted pack+impact) exists at ancestor `cc4fcbcbad68de2d6e8d4bed9df9eaff29a60acb`. Hidden via `register_tool` omission unless `scope_enabled` is exactly true. `provides_tools` lists exactly the two core tools. Dated 2026-09-28 six-profile install handoff: independent copies with `scope_enabled: true`; `default` and `workspace-manager` excluded from install/config/exposure (not a ban on the workspace-manager role). Canonical Git `tools.py` overlay is on main at `643eb3ab` and remains at checkpoint `050540d0`; that is not byte equality of every installed file, and the `6152cea` `schemas.py` text is in this revision and is **not copied into local installations**. Read-only classification, not Step 4 coordination/enforcement. | [ETS profile exposure](ETS_PROFILE_EXPOSURE.md); [effective_task_scope](../integrations/hermes-nexus/effective_task_scope.py) |
| Request-preflight helper CLI | Present in the code baseline (`4d6a78632e772e7ca43fadf37b287213d6f9ea93`) via PR #39 merge `07845ba0fc86440a080f81ffe4ad3fe125ec726d`. Invoke `python3 -B -m scripts.nexus_request_preflight`. Syntax-only local helper; not a Hermes tool; not pending merge; not Step 4. Helper classification is a documentation delta, not content of that baseline commit. | [request-preflight](development/request-preflight.md), [`scripts/nexus_request_preflight/__main__.py`](../scripts/nexus_request_preflight/__main__.py) |
| Log-inspector helper CLI | Present in the code baseline via PR #41 (merge `4d6a78632e772e7ca43fadf37b287213d6f9ea93`). Invoke `python3 -B -m scripts.nexus_log_inspector`. Offline JSONL observer; not a Hermes tool; not pending merge; not Step 4. Helper classification is a documentation delta, not content of that baseline commit. | [log-inspector](development/log-inspector.md), [`scripts/nexus_log_inspector/`](../scripts/nexus_log_inspector/) |
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

**Effective Task Scope (Step 4, not initiated as coordination/enforcement)** → Conflict Engine (Step 5) →
Hermes Guard integration (Step 6) → Telemetry / validated project history → Project Expert
→ Learning / evaluation.

E0–E7 merged as PRs #17–#24: E0 #17
`d929a125b6a975c16c5630984c9bc8b835f1d02d`; E1 #18
`9939c197761e2a0d6c4d11ad6d1feb9c1b04274b`; E2 #19
`fb98b7e82f97ae3267231d04a8a2517420d0551e`; E3 #20
`b9dc4b0618cf8b8a9cdd4e575a286e694b33fcb3`; E4 #21
`fdff6494fa8dc5ee97691b37842cdd0e2669f724`; E5 #22
`a86ac94fbdf0e8c1c28c52011f4c30bc8743f781`; E6 #23
`1ed21b597136cd15cc26359ff4af51ae01a17df0`; E7 #24
`c7aaf44ed2f407b4941b020160ccf1178f36eb69`. E7 `reader_dirty` is plugin Python
only (`integrations/hermes-nexus/reader_dirty.py` and
`tests/hermes_nexus_plugin/test_reader_dirty.py` in the PR #24 merge); that merge
did not by itself change the live process. Accepted cutover 2026-09-27 moved live service to
`75e0079489d3966548f3d70bd571419d4a6b13b7`. Accepted human service move
2026-09-28 moved live service to
`bc8b52d7280e7adc83f05cb20df97fbb3199804c`; `75e0079` is rollback only;
`85e511e` remains historical. B1–B4 remain existing holds, not implemented.
WRITE/WATCH do not dispatch cards.

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
existing checks and update this dated checkpoint and the README together.
Do not write `origin/main atual = X` as if this file auto-tracks HEAD.
Preserve the distinction between completed contracts, unstarted layers and
optional proposals. The earlier post-Step-2.5 refresh is now reflected here;
no pending completion claim remains for that step.

Historical records in [current-state checkpoints](project-intelligence/01_CURRENT_STATE.md)
and phase-design documents retain their original context. Consult their explicit
checkpoint and [this page](CURRENT_STATUS.md) rather than equating every older
phase number or test count with the current implementation.
