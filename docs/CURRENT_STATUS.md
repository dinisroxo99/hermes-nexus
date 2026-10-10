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
coordination/enforcement and is **incomplete**; helpers are **not**
the foundation slice recorded below.

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

**Steps 1, 2, 2.5 and 3 are complete.** Roadmap Step 4 Slice 1 is
implemented as **effective-task-scope-v2** pure domain; Slice 2 is the
merged data-only envelope adapter; Slice 3 is **merged** via PR #46
(`d54315325f37e777bd03b8781ca8b879c9da364d`, tree
`76dc7d69ff6d27f16ef84fb6695423699178234b`) as source-bound explicit
file deletion intent. Slice 4 is **NOT STARTED**
(`STEP4_SLICE4_READY_TO_IMPLEMENT = NO`). Step 4 remains
**incomplete**. This is **not** STEP4_COMPLETE, **not** runtime
exposure, **not** coordination/enforcement, and **not** a RESERVED
producer. RESERVED is no longer a blanket empty `not_evaluated`: when the merged Track B witness is complete, PR #53 emits one incomplete `RESERVED` item (`consistency_obligation`); a missing witness stays `not_evaluated` / `coupling_evidence_not_supported`. This is not Step 4 complete. Step 5 (Conflict Engine)
is **not started**. Step 6 (Guard integration) is **not started**.
WRITE/WATCH classification is not a complete coordination/enforcement
system. Historical local names (Step 4.0/4.1) identify earlier slices;
they do not renumber the roadmap or mark those phases complete.
`787f662` / adapter 1A do **not** enter this delta. **G1 REJECTED**;
**R1/R2 OPEN / DEFERRED**.

### Step 4 entry contract (documentation delta)

Dated **2026-09-29**, this page records a documentation delta on contract
baseline observation
**`ef3df8d36561d56b90c535e1b8ad85993200a674`** (tree
`c9c89b1568ffc06c243b7169ef1251f71aea684d`; merge of PR #42). That SHA
is the contract baseline **observation**, not a future merge SHA, not
live service, and not a claim that this documentation checkout is
deployed. Helper-CLI inventory above remains the `4d6a786` code
baseline; this delta does not recopy that inventory into this SHA.

Canonical contract:
[38_STEP4_ENTRY_CONTRACT.md](project-intelligence/38_STEP4_ENTRY_CONTRACT.md).
That file remains the prepared entry contract; it is **not** a claim
that Step 4 is complete.

### Step 4 foundation slice (this checkout)

Dated **2026-09-29**, accepted code candidate
**`b3026dccc4c86ddcf1af5707c451b004eb8fa80d`** (tree
`897e54540f49ec869ab216bd44e67daed369b9f0`; branch
`feat/step4-slice1-ets-v2`) contains the first Roadmap Step 4
foundation slice: **effective-task-scope-v2** pure domain only
(`src/lib/effective-task-scope-policy.js`,
`src/lib/effective-task-scope.js`, and isolated tests). That SHA is
the code-candidate observation, **not** a future merge SHA, **not**
live service, and **not** a plugin/service/install recopy. This
documentation commit is a status delta on top of that code; it does
**not** change those four blobs.

- First slice: **implemented**, pure domain only.
- Step 4 remains **incomplete**. Not STEP4_COMPLETE. Not Slice 2
  (this "not Slice 2" wording described the Slice 1 delta, not later
  Git absence of Slice 2).
- RESERVED producer still **not implemented**.
- No runtime exposure: no HTTP route, Hermes tool, plugin.yaml, or
  `provides_tools` change in this slice.
- Step 5 **not started**. Step 6 **not started**.
- Risk-entry disposition unchanged as operational facts: **G1 REJECTED**;
  **R1/R2 OPEN / DEFERRED**. Architectural notes:
  `STEP4_CORE_DEV_ALLOWED_WITH_EXISTING_DEFERRED_RISKS`;
  `RUNTIME_EXPOSURE_REQUIRES_SEPARATE_RISK_GATE`. Neither green tests nor
  this documentation close G1/R1/R2.
- This documentation mission did **not** recopy plugins, restart
  Hermes/Nexus, or change `provides_tools` / `scope_enabled`.

Subsequent Git checkpoint: Slice 1 is IMPLEMENTED + VERIFIED + MERGED at
bc0e4eaa71efb92f47f159770e240010d8b7f87a. The candidate record above is
historical; Step 4 remains INCOMPLETE and v2 runtime exposure remains NO.

### Step 4 Slice 2 (merged data-only adapter)

Dated **2026-09-30**, Slice 2 is implemented as
`composeEffectiveTaskScopeFromEnvelopes` in
`src/lib/effective-task-scope-adapter.js` with tests
`tests/effective-task-scope-adapter.test.js`. Implementation
`02d5784701c4c0cbc1688e04a38b8a73dd238b38`; merge
`c6be8caf436405924d22b812e3aa84b12f64f725`. Data-only envelope adapter;
not runtime exposure; not coordination/enforcement.

### Step 4 Slice 3 (merged source-bound deletion intent)

Dated **2026-09-30**, Slice 3 is **MERGED** via PR #46:
source-bound explicit file deletion intent; `schemaVersion=2` /
`effective-task-scope-v2` / `policyVersion` `step4-foundation-2`. Merge
SHA `d54315325f37e777bd03b8781ca8b879c9da364d` (tree
`76dc7d69ff6d27f16ef84fb6695423699178234b`). Historical code candidate
`f4d09cedf374872c865125d4c27fdcc602af523d` (tree
`d0dac0ceeb258200dbe0280887f06e028a5ba247`; tester PASS `t_6be11146`;
reviewer PASS `t_5ddd7738`) remains candidate evidence, not a
“not merged” claim.

- Step 4 remains **INCOMPLETE**. Not STEP4_COMPLETE. Not
  coordination/enforcement.
- RESERVED: PR #53 emits one incomplete `consistency_obligation` item when the Track B witness is complete; a missing witness stays `not_evaluated` / `coupling_evidence_not_supported`. Not Step 4 complete.
- v2 runtime exposure remains **NO**.
- Step 5 **NOT STARTED**. Step 6 **NOT STARTED**.
- **G1 REJECTED**; **R1/R2 OPEN / DEFERRED**.

### Step 4 Slice 4 (NOT STARTED — selection NO-GO)

Dated **2026-09-30**, Slice 4 selection was evaluated (`t_b563da81`
run 730) and produced **NO-GO**.
`STEP4_SLICE4_READY_TO_IMPLEMENT = NO`. **SLICE4 = NOT STARTED**.
No implementation slice was selected. This note does not invent a
Slice 4 merge SHA and does not call any prerequisite itself “Slice 4”.
Create / rename / directory expansion were not selected at that
selection date. Delete is already Slice 3. Since then, C2 adds
create-intent **recognition with fail-closed refusal**: no create WRITE
until absence can be proven. PR #60 is **MERGED** at
`6d570ab7ebdada851e85131271e15b0ceb6dfff6` (parents `95ea609` + `1709d53`;
head `1709d53`); merge is not deployment. Rename and directory expansion
remain **not selected**. The absence-witness track D0–D5 has since merged
(PR #62, #63, #64; track merge point `f9032302fc55b53400257ce44db8ee5581b53b45`;
main has since advanced, last recorded at `986f83ae8f2a877879d7646e82e2639f79fb30e7`): a create WRITE
is now classified only when a create-destination absence witness (v1, S2a)
proves **every** declared target absent (all or nothing). PR #64 shipped this
under `policyVersion` `step4-foundation-5`; PR #67 (N-12, **MERGED** at
`ecc4e7de06c69151cda14fbe4d5e706949ef5a88`) bumped it to `step4-foundation-6` with the R5-FC full-chain rule: a `complete:true` absence record is refused with `create_absence_evidence_inconsistent` unless its `ancestors` chain is exactly the derived full chain D(p): full length, `ancestors[j].path === D(p)[j]` and every entry `directory` (any verdict).
Over HTTP, a single-path task no longer fails with `origin_form_mismatch`:
the ETS route canonicalizes its own single-origin Impact into the `targets[]`
form (PR #70). The single-target limitation now applies only to direct
composer/adapter callers that pass the legacy single-origin Impact; they are
still rejected with `origin_form_mismatch`. Create stays blocked over HTTP
(400 `invalid_delete_intent`). WRITE is classification, not authorization;
there is no filesystem create; no flag change.

No implementation slice was selected because:

1. RESERVED lacks approved producer-backed strong-coupling evidence.
   Impact v2 currently proves only imports / uses / references; those
   and minimumDistance do **not** prove strong direct coupling. No
   heuristic fallback is authorized.
2. Complete symbol-target support lacks producer-backed
   uniqueness/completeness evidence. Retained Context Pack symbols do
   not prove unique resolution inside the explicit task-path domain.
   Partial/truncated ≠ uniqueness.

The 2026-09-30 Slice 4 selection NO-GO still stands
(`STEP4_SLICE4_READY_TO_IMPLEMENT = NO`; **SLICE4 = NOT STARTED**).
Observed later merges on the evidence tracks (not a Slice 4 selection flip;
product-wide auth still NO):

- Track B direct-coupling producer — PR #51 (merged).
- [Effective task scope HTTP route](effective-task-scope-http-route.md) — PR #52 (merged).
- [First Step 4 RESERVED item (Track B witness)](step4-reserved-track-b-item.md) — PR #53 (merged).
- [Track A1 symbol resolution](track-a1-symbol-resolution.md) — PR #54 (merged).
- Docs discovery/status for those records — PR #55 (merged).
- [Symbol-target completeness witness](symbol-target-completeness-witness.md) producer — PR #56 (merged).
- [ETS A1+completeness consume (Slice 4 bounded)](effective-task-scope-symbol-consume.md) — PR #57 **MERGED** at `a277ee43d082102ab7589621dcc5670ba305eeba` (parents `4741b82ce4dcc46451a82a1f1100d83a7693ffb6` + `7c3799cce57345f83e08b04e5525b8d17f6cbb18`). Bounded consumer of A1+completeness on main; consumer fixes r1 (bind/budget/whitespace + digest pin), r2 (pathScope domain / citation snapshot / evidenceComplete), r3 (producer-compat citation + invalid completeness type). Feature record already on main.
- [ETS adapter completeness-witness pass-through (C1)](effective-task-scope-adapter-witness-passthrough.md) — PR #59 **MERGED** at `95ea60990cbb637022945a74007f29f396828dde` (parents `01c54a6586362cf227bae1fab5cfc11c31c20b74` + `df1dcc3c7a218b78e661298d1a94cc95b2350b2f`; head `df1dcc3`). Data-only adapter seam: `composeEffectiveTaskScopeFromEnvelopes` accepts an optional `symbolTargetCompletenessWitness` envelope, forwards its `.data` into compose and counts it in the input budget. `policyVersion` unchanged (`step4-foundation-3`). The HTTP route still passes only pack + impact envelopes.
- [ETS explicit create intent, refuse-only (C2)](effective-task-scope-create-intent.md) — PR #60 **MERGED** at `6d570ab7ebdada851e85131271e15b0ceb6dfff6` (parents `95ea609` + `1709d53`; head `1709d53`): C2 code `6250625bd9d302b6a0876355fb22bdb8e6e9b542` (parent `95ea609`) plus fix `1c382eb56b554e390e99ce5757b5df8e99166b14`. Explicit `operationIntent.kind: "create"` on explicit `task.paths` is recognized and refused fail-closed: an observed destination gives `not_evaluated` / `create_destination_exists`, otherwise `not_evaluated` / `create_destination_absence_not_proven` (absence is not provable from current inputs; an absence witness is a future slice). No create WRITE or `operationIntent`. The HTTP route refuses create with 400 `invalid_delete_intent` (base-identical, zero producer calls). `policyVersion` `step4-foundation-4` (bumped from `-3` by the fix). Rename / directory expansion not selected; no filesystem create. Historical as of PR #60; for create this is superseded by the absence-witness lift (PR #64) below.
- [Create-destination absence witness producer (D0+D1)](create-destination-absence-witness.md) — PR #62 **MERGED** at `60e04a1232850823cc2bdf9982be5b5a25997e78` (parents `55f606cf5dc9fcb987f4af976061274cffd8c884` + `16e6ad88a5b9c519600fa5f98f83ded5cb902ae3`; head `16e6ad8`). D0 moves the collector secret predicate to `context-path-secret-policy.js`; D1 adds the read-only producer `buildCreateDestinationAbsenceWitness` (v1, S2a), its pure constants and the Unicode 17.0 name key. Library only: no route, plugin or composer path calls the producer. `policyVersion` unchanged (`step4-foundation-4`) at that merge.
- [ETS adapter absence-witness allow-list (D2)](effective-task-scope-adapter-witness-passthrough.md) — PR #63 **MERGED** at `4b8e213cc4e13f7df5aa09482f67a38412281104` (parents `60e04a1` + `0f2aa646374f0d4721e61c2d6498e0d99200aff6`; head `0f2aa64`). The adapter accepts an optional `createDestinationAbsenceWitness` envelope, forwards its `.data` and checks the combined input budget (`checkCreateAbsenceInputBudget`, 327680 total). At that merge the composer did not consume it and create stayed refused (`step4-foundation-4`).
- [ETS create intent, absence-witness lift (D3/D4/D5)](effective-task-scope-create-intent.md) — PR #64 **MERGED** at `f9032302fc55b53400257ce44db8ee5581b53b45` (parents `4b8e213` + `e1104d39a6c3393faa1171fa315050945282e6e6`; head `e1104d3`; code `3ff8130`). Completes the absence-witness track D0–D5 on main. The composer consumes an optional `createDestinationAbsenceWitness` (v1, S2a) for create intents: refuse codes `create_absence_evidence_invalid` / `create_absence_binding_mismatch` / `create_absence_evidence_inconsistent`, scope-outs `create_parent_directory_absent` / `create_ancestor_boundary`, `rejected create_absence_witness_unexpected` on READ/delete; lift `create_destination_proven_absent` → create WRITE (`explicit_create_intent`) and `operationIntent` only when every target is proven absent. Without a witness, outcomes equal `step4-foundation-4` except the version label. Single-target creates still fail with `origin_form_mismatch`. HTTP unchanged (create → 400 `invalid_delete_intent`). `policyVersion` `step4-foundation-5` (bumped from `-4`). WRITE is classification, not authorization; no filesystem create; product-wide flags unchanged.
- [ETS create intent, R5-FC full-chain absence rule (N-12)](effective-task-scope-create-intent.md) — PR #67 **MERGED** at `ecc4e7de06c69151cda14fbe4d5e706949ef5a88` (parents `4c4e8e4bd294fb3712fd2fb42bdd346ebd634a2d` + `024c1a0175874ab23221615f246761ca592fe0ec`; head `024c1a0`; code `406ea33`). Implements the N-12 full-chain amendment to the absence-witness contract r3.4: in `absenceRecordConsistent` (`src/lib/effective-task-scope-policy.js`), a `complete:true` absence record is refused with `create_absence_evidence_inconsistent` unless its `ancestors` chain is exactly the derived full chain D(p): full length, `ancestors[j].path === D(p)[j]` and every entry `directory` (any verdict). One such record refuses the whole witness. `policyVersion` `step4-foundation-6` (bumped from `-5`). Only the policy module changes in src; the composer, HTTP route, adapter, producer and constants are unchanged. Closes the short-chain class only; a forged self-consistent full-length chain stays an accepted residual (consistency, not authenticity). Classification, not authorization; no filesystem create; product-wide flags unchanged.
- [ETS HTTP route, full request task to the Context Pack](effective-task-scope-http-route.md) — PR #69 **MERGED** at `bc11227a959033b16260c3f38c4cd7605590a1e3` (parents `a06f8d7` + `e76b263e649806aee3478cf10567e98abba6ae42`; head `e76b263`). Route only: the ETS route forwards the full normalized request task (`id`, `title`, `paths`, `symbols`) to the Context Pack builder, so the pack's task echo matches the request and a bound request no longer fails with `task_echo_mismatch`. Composer, adapter, policy and Impact unchanged; `policyVersion` stays `step4-foundation-6`. Create stays blocked over HTTP (400 `invalid_delete_intent`); classification, not authorization; no filesystem create; product-wide flags unchanged.
- [ETS HTTP route, single-path origin canonicalization](effective-task-scope-http-route.md) — PR #70 **MERGED** at `e0976fd8b9df1570c27e868341a9b7bb6294efd8` (parents `bc11227a959033b16260c3f38c4cd7605590a1e3` + `55ac03e9d811fb2990270034a53b2c094005d763`; head `55ac03e`). Route only: the ETS route passes its own self-built single-path Impact through the private, pure `canonicalImpactOriginForm`, which re-expresses the exact legacy single-origin form as `targets[]` (nothing recomputed; any other shape passes through unchanged and is still rejected). A single-path task over HTTP no longer fails with `origin_form_mismatch`; direct composer/adapter callers with the legacy form still do. Composer, adapter, policy and Impact unchanged; `policyVersion` stays `step4-foundation-6`. Create stays blocked over HTTP (400 `invalid_delete_intent`); classification, not authorization; no filesystem create; product-wide flags unchanged.
- [ETS HTTP route, `includeTests` forwarding](effective-task-scope-http-route.md) — PR #71 **MERGED** at `0f72ca58217cfbc8c8597c317d525e888083f0c7` (parents `e0976fd8b9df1570c27e868341a9b7bb6294efd8` + `f8747b906fad676dd73360b216b97381953456b5`; head `f8747b9`). Route only: the Impact request is built from the normalized request as `{ paths, includeTests }`, so `includeTests: true` on a clean linked worktree no longer fails as `includeTests_true_not_requested_mismatch`; absent or non-boolean `includeTests` is still 400 `invalid_effective_task_scope_request`. The composer's request/evidence `includeTests` checks are unchanged; `policyVersion` stays `step4-foundation-6`. Create stays blocked over HTTP; classification, not authorization; no filesystem create; product-wide flags unchanged.
- [ETS HTTP route, Impact request contract (S-1)](effective-task-scope-http-route.md) — PR #72 **MERGED** at `ffdc0eddca21554d5699b4bf9b0c4888e88f1d5b` (parents `0f72ca58217cfbc8c8597c317d525e888083f0c7` + `b92191537add362b6c6937e3bd9275952d45ff68`; head `b921915`; code `7329313`). Route only: the Impact request is exactly `{ paths, includeTests }`, fields of Impact's public request contract (`REQUEST_FIELDS`); the route no longer copies `repositoryId` / `worktreeId` from the Context Pack revision into it (a pack carrying those aliases would have made the call `400` `invalid_impact_request`). Its decision D2 ("don't forward the worktree") is superseded by PR #74 (SB-2) below, which adds `worktree` only for a non-registered locator. Composer, adapter, policy and Impact unchanged; `policyVersion` stays `step4-foundation-6`. Classification, not authorization; product-wide flags unchanged.
- Analyzer: symbol-less import edges (F1) — PR #73 **MERGED** at `6c58a0b31860a5eb67be829d18e20584c558e58a` (parents `ffdc0ed` + `3cfb3e73f03459d32a94eb1523c3f8b3e396894b`; head `3cfb3e7`; code `8972609`). In snapshot (provider) mode only, a TS/JS source file with no top-level symbols that imports a local module gets one module anchor node (`kind: "module"`, label `<module>`) so its imports become graph edges. Anchors never enter the name or per-file symbol maps, so they are never import targets, re-export aliases or name matches, and the Context Pack filters them out. Local module references the graph still cannot represent are counted as `unrepresentedImports`, which makes the provider `partial`. The `native.typescript` provider version is `2`. Legacy (non-snapshot) analysis is unchanged. ETS composer, adapter, policy and route unchanged; `policyVersion` stays `step4-foundation-6`. Analysis evidence only, not authorization; product-wide flags unchanged.
- [Analyzer: `export *` / re-export barrels (N1)](typescript-barrel-reexports.md) — local branch `fix/analyzer-barrel-reexports` on `f1195c6b5a7f29a73130d1766a5c99caaa4ef89c`, **NOT MERGED**. Snapshot mode only: imports and re-exports through barrels resolve to their defining symbols via the compiler export table (stars, chains, cycles, aliases, default-as, `export * as ns`, type-only, tsconfig paths over snapshot files only); only the root `tsconfig.json` is read, once, by TypeScript's JSONC config parser for both the resolver and the checker, any other `tsconfig.json`/`jsconfig.json` (nested, root jsconfig, case variants) or root `references` makes the result `partial` (one issue per project; not read), `extends` is followed only within the snapshot, and an invalid config, an unresolved or cyclic `extends`, or an alias that matches `paths` but resolves to no snapshot file is counted (`partial`); a pure barrel (every top-level statement is an `export … from`, including the type-only forms `export type * from` and `export type { T } from`; local declarations and exports without `from` are outside) as Impact target reaches its importers through file-level edges into its anchor. A barrel made only of `export { default } from` has its own `default` symbol and no anchor; default imports link that symbol, so Impact on it finds its consumers (review A-3). Residual: a barrel that re-exports `default` plus other names misses consumers that import only named bindings when the barrel is the Impact target, but reports `partial`, never silently complete. **Amends the F1 anchor wording (D11):** only pure-barrel anchors may receive file-level edges from importers and outer barrels; anchors are still never name matches, never symbol-resolution targets, and anchors of non-barrel files receive no edges. Ambiguous `export *` names and unlinked mixed barrels make the provider `partial`. `native.typescript` provider version `3`; legacy analysis, caps, ETS composer and `policyVersion` (`step4-foundation-6`) unchanged; D7 and F2 stay open. Analysis evidence only, not authorization; product-wide flags unchanged.
- [ETS HTTP route, worktree locator forwarding (SB-2)](effective-task-scope-http-route.md) — PR #74 **MERGED** at `986f83ae8f2a877879d7646e82e2639f79fb30e7` (parents `6c58a0b31860a5eb67be829d18e20584c558e58a` + `bfad96415e4a8091174d21bffc0a36ab035b89e8`; head `bfad964`; code `ae464b0`). Route only: when the body `worktree` locator differs from the project's registered location, the ETS route forwards it to the Context Pack builder and in the Impact request (`{ paths, includeTests, worktree }`), after a pure Impact request pre-check; a parent project plus a linked-worktree locator is no longer always `200` `rejected` / `worktree_locator_mismatch`. Self-located requests and lookup failures forward nothing (byte-identical evidence requests). Invalid or mismatched locators now get the builders' codes instead of `200` `rejected`: `404` `project_unavailable` (unregistered root or missing directory) / `409` `worktree_parent_mismatch` (not a linked worktree of the project); a locator outside Impact's request contract is `400` `invalid_impact_request`, and one the Context Pack normalizer refuses is `400` `invalid_task_context_request`; an unknown `projectId` stays `404` `project_not_found`. **Supersedes S-1 (#72) decision D2** ("don't forward the worktree"). Composer, adapter, policy and Impact unchanged; `policyVersion` stays `step4-foundation-6`. Create and the absence witness stay blocked over HTTP; classification, not authorization; no filesystem create; product-wide flags unchanged.

PR #57 landed on main; it does **not** flip `IMPLEMENTATION_AUTHORIZED`,
`SLICE4`, or `STEP4_SLICE4_READY_TO_IMPLEMENT`. This does **not** mark Step 4
complete, coordination/enforcement, or product-wide Slice 4 readiness.

PR #59 (merged), PR #60 (merged at `6d570ab`) and the absence-witness PRs
#62–#64 (merged at `f903230`), plus PR #66 (merged at `4c4e8e4`) and PR #67
(merged at `ecc4e7d`), and the route fixes PR #69 (merged at `bc11227`), PR #70
(merged at `e0976fd`) and PR #71 (merged at `0f72ca5`), and PR #72 (merged at `ffdc0ed`),
PR #73 (merged at `6c58a0b`) and PR #74 (merged at `986f83a`), likewise do **not** flip those flags; they
are bounded evidence-track slices, not a Slice 4 selection flip and not Step 4
complete.

**Absence-witness track D0–D5: complete on main** (PR #62 D0+D1, PR #63 D2,
PR #64 D3/D4/D5; track merge point `f9032302fc55b53400257ce44db8ee5581b53b45`),
with the R5-FC full-chain rule from PR #67 (merged at `ecc4e7d`; main has since
advanced, last recorded at `986f83ae8f2a877879d7646e82e2639f79fb30e7`). Current create behavior
(`policyVersion` `step4-foundation-6` since PR #67; `step4-foundation-5` at PR #64): WRITE (`explicit_create_intent`,
`explicit_task_path`) and `operationIntent` are emitted only when **every**
declared target is PROVEN-ABSENT under a valid, bound absence witness, all or
nothing; otherwise the result is `not_evaluated` with the specific create or
absence reason. R5-FC (PR #67, merged at `ecc4e7d`; `absenceRecordConsistent` in
`src/lib/effective-task-scope-policy.js`): a `complete:true` absence record is refused with `create_absence_evidence_inconsistent` unless its `ancestors` chain is exactly the derived full chain D(p): full length, `ancestors[j].path === D(p)[j]` and every entry `directory` (any verdict). One such record
refuses the whole witness. R5-FC closes the short-chain class only: the witness
is consistency-checked, not authenticated, so a forged self-consistent
full-length chain remains an accepted residual (N-12). Direct composer/adapter callers that pass the legacy single-origin Impact still get `origin_form_mismatch`;
over HTTP the route canonicalizes it (PR #70), and create stays refused there. WRITE is classification,
not authorization; there is no filesystem create. HTTP still refuses create
(400 `invalid_delete_intent`) and the witness field (400 `unexpected_field`).
HTTP-visible fix (PR #71, route only, `policyVersion` stays `step4-foundation-6`, no flag change): the ETS route now forwards the request's `includeTests` boolean to Impact; before, it was dropped, so a bound request with `includeTests: true` on a clean linked worktree was rejected with `includeTests_true_not_requested_mismatch`.
HTTP-visible fix (PR #74, SB-2, route only, `policyVersion` stays `step4-foundation-6`, no flag change): a parent project plus a linked-worktree `worktree` locator now reaches both builders instead of always ending as `200` `rejected` / `worktree_locator_mismatch`; invalid or mismatched locators are now `404` `project_unavailable`, `409` `worktree_parent_mismatch`, `400` `invalid_impact_request` or `400` `invalid_task_context_request` instead of `200` `rejected`.
This is not Slice 4 readiness, product-wide authorization or Step 4 completion.

Absence-witness follow-ups.

Done:

- **N-12 full-chain contract amendment:** done. PR #67 **MERGED** at
  `ecc4e7de06c69151cda14fbe4d5e706949ef5a88` (parents `4c4e8e4` + `024c1a0`; head
  `024c1a0`) as R5-FC / `step4-foundation-6`: a `complete:true` record needs the
  full-length, all-directory ancestor chain.
- **`tests/project-revision.test.js:45` `/tmp` isolation:** done. PR #66 **MERGED**
  at `4c4e8e4bd294fb3712fd2fb42bdd346ebd634a2d` (parents `5a76630` + `22c459a`; head
  `22c459a`). It isolates the no-repo cases in project-revision, task-context and
  project-overview from a stray ancestor `.git`. Its one src change is a test-only
  seam: `buildProjectOverview` (`src/lib/project-overview.js`) forwards an optional
  `revisionOptions.execFileSync` to the revision reader only when it is a function
  (otherwise the identity options are exactly `{ now }` as before). The only
  production caller, the overview route in `src/routes/intelligence.routes.js`,
  passes only `graphLimit`, so HTTP cannot reach the seam.

Open (not done):

- **B-63 strengthening:** assert per case that no B-63 case lifts (`not_evaluated`,
  no `write` / `operationIntent`) before asserting the code, or add the Tester
  harness "R3 removed" double mutant, so the R5-FC per-index path check is pinned.
- **Mixed EXISTS row:** optional redundancy for "EXISTS beats refuse" (one row,
  B-62f, kills those mutants today), e.g. a truncated exists record next to a
  truncated absent co-target.
- **Overview seam spy test:** a clean-environment test that a function
  `revisionOptions.execFileSync` is called and a non-function value is ignored.
- **Temp-dir leak cleanup:** other `project-overview` and intelligence-routes tests
  still leak temp dirs (`makeTempRoot()` without cleanup); pre-existing.
- **Optional i2d test:** a mutant that drops the binder's "observed path →
  exists" rule is not caught by the current suite; it cannot produce a WRITE.
- **O-1:** the D0 collector (`project-context-files.js`) still compares
  realpath/readlink results as decoded strings; out of scope for D0/D1.
- **Forged full-length chain (accepted risk):** R5-FC closes only the short-chain
  class; the witness is consistency-checked, not authenticated, so a forged
  self-consistent full-length chain remains an accepted residual (N-12).

Route and analyzer follow-ups from the PR #72–#74 reviews (open, not done):

- **F2 edge compaction:** compact the import fan-out (file anchors as the
  compaction unit) instead of raising the 4000-edge cap. Until then the F1 recall
  on large graphs such as hermes-nexus (for example `router.test.js`) stays hidden
  by the cap.
- **N1 `export *` barrel:** on `main`, re-export barrel origins stay silently
  complete: Impact on an `export *` barrel can report available with no affected
  files although other files import it, because the counter accepts alias-target
  edges. Pre-existing. Addressed on the local branch
  `fix/analyzer-barrel-reexports` (N1 above, **NOT MERGED**); open on `main` until
  it merges. Residual on the branch: a barrel re-exporting `default` plus other
  names misses named-import consumers as Impact target, reported `partial`.
  Open on the branch (not counted, so Impact can be `available` while missing a
  dependant): `.js` specifiers the compiler maps to `.ts` sources (relative
  specifiers, and `x.js` linked when both `x.js` and `x.ts` exist), relative
  `.d.ts` targets (alias `.d.ts` targets are now counted), `baseUrl`-only bare
  specifiers (B7), the `paths` overlap guard (B6) and an `export *` whose
  source contributes no names (no file edge, no count). Also unmodelled
  (B-4), so they can yield a false complete: `#subpath` imports
  (`package.json` `imports`), package self-reference, symlinked workspaces,
  `typesVersions`, `rootDirs`, `moduleSuffixes`, `allowArbitraryExtensions`,
  folder imports via `package.json` `main`/`types`, `/// <reference>`,
  `.mts`/`.cts`/`.mjs`/`.cjs` files, and targets under `bin/` and `dist/`.
  Follow-ups: B-2(c) read the nearest config per directory and the referenced
  configs (today any non-root `tsconfig.json`/`jsconfig.json` or root
  `references` only makes the result partial); B-4 model or count the
  unmodelled features above; the catch-all `*` also counts `node:` builtins
  (precision only).
- **SB-4 alphabetical cap bias:** the edge-cap prefix is alphabetical by `from`
  id, so test and route importers are dropped first, which biases affected tests
  (part of F2).
- **SB-2 advisories A-3 to A-9:** A-3 a symlink alias inside a configured root
  that points to a genuine linked worktree is accepted and the response echoes the
  alias spelling; A-4 the ETS and Context Pack normalizers disagree on rootId
  whitespace (fail-closed, but a Pack is built before Impact refuses); A-5
  equivalent or untested defensive branches; A-6 docs nits (addressed by this
  status refresh); A-7 smoke hygiene (SIGTERM only, no SIGKILL fallback, no
  per-request fetch timeout); A-8 a corrupt registry gives `500`
  `task_context_failed` (pre-existing); A-9 count wording in the design note.
- **Flaky analyzer-service cache test:** `tests/analyzer-service.test.js`
  "analysis cache reuses TypeScript analysis and invalidates per project" is
  timing-sensitive and fails intermittently under concurrent load; pre-existing,
  not a regression.

`NEXT_PREREQUISITE` at the NO-GO date was producer-backed evidence contract; A/B
producers have since merged as named above. The [DIRECT-COUPLING-EVIDENCE-CONTRACT record in the active plan](../.hermes/plans/2026-09-17_002050-project-intelligence-service-active.md#direct-coupling-evidence-contract--accepted-definition) remains historical definition text in the plan.

### Accepted Option B — deferred Hermes runtime dependency

Dated **2026-10-01**, architecture decision `t_00e97e20` (run 766)
and independent review **PASS** `t_e3f0d399` (run 767) accept **Option B**:
do not start `HERMES_PROJECT_MUTATION_CONFINEMENT_EPIC` now. Those are
named decision/review handoffs, not new runtime probes. This documentation
delta is based on observed Git baseline
`8553325d82d942943bc9845d4ede60e379664d4f` (tree
`d70bb9cdec74ca75fe8743c5d8859fb56a5eeb32`), not a future merge or
deployment claim.

```text
START_CONFINEMENT_EPIC_NOW=NO
STEP4_BLOCKED_BY_HERMES_CONFINEMENT=YES
CONFINEMENT_EPIC_FEASIBLE=UNKNOWN
CONFINEMENT_EPIC_REQUIRED_FOR_CURRENT_THREAT_MODEL=UNKNOWN
TRACK_A_STATUS=A1_MERGED_PR54
SLICE4=NOT_STARTED
STEP4=INCOMPLETE
IMPLEMENTATION_AUTHORIZED=NO
SELECTED_MODEL=NONE
OS_CONFINEMENT_REQUIRED=UNKNOWN
CURRENT_POLICY_DISPOSITION=keep
G1=REJECTED
R1/R2=OPEN / DEFERRED
```

The accepted pre-edit runtime candidate has no defined effect boundary,
closed guarded surface or immutable run toolset and does not satisfy the
documented hostile-agent requirement. The held Step 4/Track A path therefore
remains blocked on a missing Hermes-owned runtime capability. WRITE remains
classification; Nexus has no execution/admission/mutation-permission
authority. No enforcement model or backend is selected.

Deferral is a **roadmap choice**, not safety acceptance, proof of
impossibility or an OS-sandbox mandate. The inspected Hermes primitives do
not establish end-to-end confinement across integrations and lifecycle;
feasibility and necessity of this specific epic remain UNKNOWN. The
hostile-agent requirement remains intact and unsatisfied. This operational
hold does not prove that pure classification intrinsically needs an OS
sandbox. Track A1 symbol-resolution producer/adapter is **merged** via PR #54
at `5ab214c5a1901a32ffaf4f754edf0ac98e47b470`; feature record:
[track-a1-symbol-resolution.md](track-a1-symbol-resolution.md). A0/A2 remain
out of this flag. Slice 4 remains unselected and NOT STARTED. No previous finding or hold is
closed, including `t_b563da81`, `t_89d07972` and `t_09a34d2b`. Steps 5/6
remain NOT STARTED; RESERVED follows the PR #53 incomplete-item / missing-witness rule above; and v2 runtime
exposure remains NO. This documentation authorization is not implementation,
push, publication or merge permission.

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
authorize; not G1 PASS; Step 4 was not initiated by that historical v1 proof;
the current foundation state is recorded above.
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
| Step 4 foundation (pure domain) | First Roadmap Step 4 foundation slice implemented on this checkout (`b3026dcc…`): `analysisVersion` `effective-task-scope-v2`, `policyVersion` `step4-foundation-1`. Pure `composeEffectiveTaskScope` in `src/lib/` with isolated tests. No HTTP, tool, or plugin wiring. RESERVED producer not implemented. Step 4 remains incomplete. | [policy](../src/lib/effective-task-scope-policy.js), [composer](../src/lib/effective-task-scope.js) |
| Step 4 Slice 2 (data-only adapter) | Merged data-only envelope adapter `composeEffectiveTaskScopeFromEnvelopes`. Implementation `02d5784701c4c0cbc1688e04a38b8a73dd238b38`; merge `c6be8caf436405924d22b812e3aa84b12f64f725`. Not runtime exposure; not coordination/enforcement. | [adapter](../src/lib/effective-task-scope-adapter.js), [adapter tests](../tests/effective-task-scope-adapter.test.js) |
| Step 4 Slice 3 (merged deletion intent) | Merged via PR #46: source-bound explicit file deletion intent; `schemaVersion=2` / `effective-task-scope-v2` / `policyVersion` `step4-foundation-2`. Merge `d54315325f37e777bd03b8781ca8b879c9da364d` / tree `76dc7d69ff6d27f16ef84fb6695423699178234b`. Historical code candidate `f4d09cedf374872c865125d4c27fdcc602af523d` remains candidate evidence, not a not-merged claim. Step 4 remains incomplete. Later PR #53 qualifies RESERVED (one incomplete item when Track B witness complete; missing witness stays `not_evaluated`). Runtime exposure NO. | [policy](../src/lib/effective-task-scope-policy.js), [composer](../src/lib/effective-task-scope.js) |
| Step 4 Slice 4 (NOT STARTED) | Selection evaluated (`t_b563da81` run 730) produced NO-GO. `STEP4_SLICE4_READY_TO_IMPLEMENT = NO`. **SLICE4 remains NOT STARTED** (product-wide readiness unchanged). Create/rename/directory expansion not selected at selection; Delete is Slice 3. Create-intent recognition with fail-closed refusal (no create WRITE until absence can be proven) merged via PR #60 (merge `6d570ab`); rename/directory expansion still not selected. Later observed evidence-track merges (not a readiness flip): Track B producer PR #51; [ETS HTTP route](effective-task-scope-http-route.md) PR #52; [RESERVED Track B item](step4-reserved-track-b-item.md) PR #53; [Track A1](track-a1-symbol-resolution.md) PR #54; docs follow-up PR #55; [completeness witness](symbol-target-completeness-witness.md) PR #56; [ETS A1+completeness consume (bounded)](effective-task-scope-symbol-consume.md) PR #57; [ETS adapter witness pass-through (C1)](effective-task-scope-adapter-witness-passthrough.md) PR #59 (merged); [ETS create intent, refuse-only (C2)](effective-task-scope-create-intent.md) PR #60 (merged, `6d570ab`). Absence-witness track D0–D5 merged: [absence witness](create-destination-absence-witness.md) PR #62 (D0+D1), PR #63 (D2), PR #64 (D3/D4/D5, `step4-foundation-5`; create WRITE only when every target is proven absent, all or nothing); not a readiness flip. | [active plan](../.hermes/plans/2026-09-17_002050-project-intelligence-service-active.md) |
| Track B direct-coupling producer (PR #51) | Merged Track B producer-backed coupling evidence used by later RESERVED composition. Not Slice 4 selection; not Step 4 complete. | [step4-reserved-track-b-item.md](step4-reserved-track-b-item.md) (cites the witness) |
| Effective task scope HTTP route (PR #52) | Merged `POST /api/intelligence/projects/:projectId/effective-task-scope`. Not Step 4 complete; not conflict/guard. | [effective-task-scope-http-route.md](effective-task-scope-http-route.md) |
| Step 4 first RESERVED item (PR #53) | When the Track B witness is complete, emits one incomplete `RESERVED` item (`consistency_obligation` → `docs/project-icm.md`). Missing witness stays `not_evaluated` / `coupling_evidence_not_supported`. First Step 4 RESERVED slice only — not Step 4 complete. | [step4-reserved-track-b-item.md](step4-reserved-track-b-item.md) |
| Track A1 symbol resolution (PR #54) | Merged Track A1 declaration-evidence producer/adapter (`resolveTrackA1` / `resolveTypeScriptDeclarationEvidence`). Discovery/status docs merged via PR #55. Not A0/A2; not Step 4 complete. | [track-a1-symbol-resolution.md](track-a1-symbol-resolution.md) |
| Symbol-target completeness witness (PR #56) | Merged in-repo ArchW completeness witness producer. Consumed by later PR #57 ETS compose path. Not product-wide Slice 4 readiness; not Step 4 complete. | [symbol-target-completeness-witness.md](symbol-target-completeness-witness.md) |
| ETS A1+completeness consume (PR #57) | **MERGED** at `a277ee43d082102ab7589621dcc5670ba305eeba` (parents `4741b82` + `7c3799c`). Slice 4 (bounded) ETS A1+completeness consume on main; `policyVersion` `step4-foundation-3`. Consumer fixes r1 (bind/budget/whitespace + digest pin), r2 (pathScope domain / citation snapshot / evidenceComplete), r3 (producer-compat citation + invalid completeness type). Landed on main; product-wide `IMPLEMENTATION_AUTHORIZED` / `SLICE4` / `STEP4_SLICE4_READY_TO_IMPLEMENT` still NO / NOT_STARTED / NO. Not Step 4 complete; not coordination/enforcement. | [effective-task-scope-symbol-consume.md](effective-task-scope-symbol-consume.md) |
| ETS adapter witness pass-through (PR #59) | **MERGED** at `95ea60990cbb637022945a74007f29f396828dde` (parents `01c54a6` + `df1dcc3`). C1, Slice 4 (bounded) data-only seam: `composeEffectiveTaskScopeFromEnvelopes` accepts an optional `symbolTargetCompletenessWitness` envelope (same ok/data discipline), forwards its `.data` into `composeEffectiveTaskScope` and counts it in the input budget; absent witness keeps the prior pack+impact behavior. `policyVersion` `step4-foundation-3` unchanged. No producer/A1/IO in the adapter; HTTP route still passes only pack + impact. Product-wide `IMPLEMENTATION_AUTHORIZED` / `SLICE4` / `STEP4_SLICE4_READY_TO_IMPLEMENT` unchanged. Not Step 4 complete. | [effective-task-scope-adapter-witness-passthrough.md](effective-task-scope-adapter-witness-passthrough.md) |
| ETS create intent, refuse-only (PR #60) | **MERGED** at `6d570ab7ebdada851e85131271e15b0ceb6dfff6` (parents `95ea609` + `1709d53`; head `1709d53`): C2 code `6250625bd9d302b6a0876355fb22bdb8e6e9b542` (parent `95ea609`) plus fix `1c382eb56b554e390e99ce5757b5df8e99166b14`. C2, Slice 4 (bounded): explicit `operationIntent.kind: "create"` with targets `{ oldPath: null, newPath }` on explicit `task.paths` is recognized and refused fail-closed after the existing gates and whole-proof validation. EXISTS (Context `files` item or Impact `targetSource`) → `not_evaluated` / `create_destination_exists`; UNKNOWN (default) → `not_evaluated` / `create_destination_absence_not_proven`; PROVEN-ABSENT unreachable until a future absence-witness slice. No create WRITE, WATCH or `operationIntent`. Rejected: `invalid_create_intent`, `create_intent_target_mismatch`, `create_source_binding_mismatch`, `scope_budget_exceeded` (through the composer a missing Impact target is rejected earlier as `origin_set_mismatch`). Normalizer default-deny (`allowCreateIntent === true` opt-in, composer only); the HTTP route returns 400 `invalid_delete_intent` for create with zero producer, config or compose calls. `policyVersion` `step4-foundation-4`. Rename / directory expansion not selected; no filesystem create. Product-wide flags unchanged. Not Step 4 complete. Historical as of PR #60; for create this is superseded by the absence-witness lift (PR #64). | [effective-task-scope-create-intent.md](effective-task-scope-create-intent.md) |
| Create-destination absence witness producer (PR #62, D0+D1) | **MERGED** at `60e04a1232850823cc2bdf9982be5b5a25997e78` (parents `55f606c` + `16e6ad8`). D0: collector secret predicate moved to `context-path-secret-policy.js` (behavior parity). D1: read-only `buildCreateDestinationAbsenceWitness` (v1, S2a), pure constants and the Unicode 17.0 name key. Library only; no route, plugin or composer call. `policyVersion` unchanged at that merge (`step4-foundation-4`). Not Step 4 complete. | [create-destination-absence-witness.md](create-destination-absence-witness.md) |
| ETS adapter absence-witness allow-list (PR #63, D2) | **MERGED** at `4b8e213cc4e13f7df5aa09482f67a38412281104` (parents `60e04a1` + `0f2aa64`). The adapter accepts an optional `createDestinationAbsenceWitness` envelope and forwards its `.data` with the combined input budget (`checkCreateAbsenceInputBudget`, 327680 total). The composer did not consume it at that merge; create stayed refused (`step4-foundation-4`). Not Step 4 complete. | [effective-task-scope-adapter-witness-passthrough.md](effective-task-scope-adapter-witness-passthrough.md) |
| ETS create intent, absence-witness lift (PR #64, D3/D4/D5) | **MERGED** at `f9032302fc55b53400257ce44db8ee5581b53b45` (parents `4b8e213` + `e1104d3`; code `3ff8130`). Completes the absence-witness track D0–D5 on main. The composer evaluates an optional `createDestinationAbsenceWitness` (v1, S2a; the policy imports only the pure D1 constants/name-key modules and the D0 secret predicate, never the fs producer) for create intents; create WRITE (`explicit_create_intent`, `explicit_task_path`) and `operationIntent` only when every declared target is PROVEN-ABSENT (EXISTS › parent_absent › ancestor_boundary › UNKNOWN › lift); the `impact_not_evaluated` gate relaxed only by the total `isCreateGateRelaxed`. Needs a runtime reporting Unicode 17.0 (else every create UNKNOWN). Single-target create still fails with `origin_form_mismatch` (NG-9). `policyVersion` `step4-foundation-5`. Classification, not authorization; no filesystem create; HTTP unchanged; product-wide flags unchanged. Open follow-ups: N-12 full-chain contract amendment, `project-revision` test `/tmp` isolation, optional i2d test, O-1. Not Step 4 complete. | [effective-task-scope-create-intent.md](effective-task-scope-create-intent.md) |
| ETS create intent, R5-FC full-chain absence rule (PR #67, N-12) | **MERGED** at `ecc4e7de06c69151cda14fbe4d5e706949ef5a88` (parents `4c4e8e4` + `024c1a0`; head `024c1a0`; code `406ea33`). In `absenceRecordConsistent` (`src/lib/effective-task-scope-policy.js`), a `complete:true` absence record is refused with `create_absence_evidence_inconsistent` unless its `ancestors` chain is exactly the derived full chain D(p): full length, `ancestors[j].path === D(p)[j]` and every entry `directory` (any verdict); one such record refuses the whole witness. `policyVersion` `step4-foundation-6` (bumped from `-5`). Composer, HTTP route, adapter, producer and constants unchanged. Closes the short-chain class only; a forged self-consistent full-length chain stays an accepted residual (consistency, not authenticity). Classification, not authorization; no filesystem create; product-wide flags unchanged. Not Step 4 complete. | [effective-task-scope-create-intent.md](effective-task-scope-create-intent.md) |
| ETS HTTP route, full request task to the Context Pack (PR #69) | **MERGED** at `bc11227a959033b16260c3f38c4cd7605590a1e3` (parents `a06f8d7` + `e76b263`; head `e76b263`). The route forwards the full normalized request task (`id`, `title`, `paths`, `symbols`) to the Context Pack builder; a bound request no longer fails with `task_echo_mismatch`. Composer, adapter, policy and Impact unchanged; `policyVersion` `step4-foundation-6`. Create blocked over HTTP; classification, not authorization; no filesystem create; product-wide flags unchanged. Not Step 4 complete. | [effective-task-scope-http-route.md](effective-task-scope-http-route.md) |
| ETS HTTP route, single-path origin canonicalization (PR #70) | **MERGED** at `e0976fd8b9df1570c27e868341a9b7bb6294efd8` (parents `bc11227` + `55ac03e`; head `55ac03e`). Route-private, pure `canonicalImpactOriginForm` re-expresses the route's own exact legacy single-origin Impact as `targets[]`; any other shape passes through and is still rejected. Single-path tasks over HTTP no longer fail with `origin_form_mismatch`; direct composer/adapter callers with the legacy form still do. Composer, adapter, policy and Impact unchanged; `policyVersion` `step4-foundation-6`. Create blocked over HTTP; classification, not authorization; no filesystem create; product-wide flags unchanged. Not Step 4 complete. | [effective-task-scope-http-route.md](effective-task-scope-http-route.md) |
| ETS HTTP route, `includeTests` forwarding (PR #71) | **MERGED** at `0f72ca58217cfbc8c8597c317d525e888083f0c7` (parents `e0976fd` + `f8747b9`; head `f8747b9`). The route builds the Impact request as `{ paths, includeTests }` from the normalized request; `includeTests: true` on a clean linked worktree no longer fails as `includeTests_true_not_requested_mismatch`. Composer checks unchanged; `policyVersion` `step4-foundation-6`. Create blocked over HTTP; classification, not authorization; no filesystem create; product-wide flags unchanged. Not Step 4 complete. | [effective-task-scope-http-route.md](effective-task-scope-http-route.md) |
| ETS HTTP route, Impact request contract (PR #72, S-1) | **MERGED** at `ffdc0eddca21554d5699b4bf9b0c4888e88f1d5b` (parents `0f72ca5` + `b921915`; head `b921915`; code `7329313`). The Impact request is exactly `{ paths, includeTests }` (Impact's public request contract); the route no longer copies `repositoryId` / `worktreeId` from the pack revision. Decision D2 (don't forward the worktree) is superseded by PR #74. Composer, adapter, policy and Impact unchanged; `policyVersion` stays `step4-foundation-6`. Not Step 4 complete. | [effective-task-scope-http-route.md](effective-task-scope-http-route.md) |
| Analyzer symbol-less import edges (PR #73, F1) | **MERGED** at `6c58a0b31860a5eb67be829d18e20584c558e58a` (parents `ffdc0ed` + `3cfb3e7`; head `3cfb3e7`; code `8972609`). Snapshot mode only: a symbol-less TS/JS file with local imports gets one module anchor (`kind: "module"`, `<module>`) so its imports become edges; anchors are never targets and never reach the Context Pack. `unrepresentedImports` makes the provider `partial`; `native.typescript` provider version `2`. ETS unchanged; `policyVersion` stays `step4-foundation-6`. Open: F2, N1, SB-4. Not Step 4 complete. | [`typescript-analyzer.js`](../src/analyzers/typescript/typescript-analyzer.js) |
| ETS HTTP route, worktree locator forwarding (PR #74, SB-2) | **MERGED** at `986f83ae8f2a877879d7646e82e2639f79fb30e7` (parents `6c58a0b` + `bfad964`; head `bfad964`; code `ae464b0`). The body `worktree` locator is forwarded to both builders only when it differs from the registered location, after a pure Impact request pre-check. Invalid or mismatched locators: `404` `project_unavailable`, `409` `worktree_parent_mismatch`, `400` `invalid_impact_request`, `400` `invalid_task_context_request` (before: `200` `rejected`). Supersedes S-1 decision D2. Composer, adapter, policy and Impact unchanged; `policyVersion` stays `step4-foundation-6`. Open: advisories A-3 to A-9. Not Step 4 complete. | [effective-task-scope-http-route.md](effective-task-scope-http-route.md) |
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

**Effective Task Scope (Step 4: Slice 1 v2 pure domain implemented;
Slice 2 data-only adapter merged; Slice 3 merged via PR #46; Slice 4
NOT STARTED / NO-GO; Step 4 remains incomplete and is not
coordination/enforcement; RESERVED follows PR #53 incomplete-item / missing-witness rule (not Step 4 complete); no v2
runtime exposure)** →
Conflict Engine (Step 5, **not started**) →
Hermes Guard integration (Step 6, **not started**) → Telemetry / validated project history → Project Expert
→ Learning / evaluation.

See
[38_STEP4_ENTRY_CONTRACT.md](project-intelligence/38_STEP4_ENTRY_CONTRACT.md)
for the prepared entry contract. G1 remains REJECTED; R1/R2 remain OPEN /
DEFERRED. The historical isolated-core-development disposition does not
authorize the currently held Step 4/Track A path; the accepted Option B
checkpoint above records its operational hold. Runtime exposure still
needs a separate risk gate.

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
