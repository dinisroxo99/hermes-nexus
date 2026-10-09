# Effective task scope HTTP route

Record of the `scope-http-route` slice. This document is the feature record for the same commit as the route. It is **not** Step 4, **not** Track A, **not** conflict resolution, and **not** a guard.

## Endpoint

`POST /api/intelligence/projects/:projectId/effective-task-scope`

- `projectId` comes from the path.
- A body `projectId` is rejected.

## Request body

Required / expected fields:

- `task`
- `worktree`
- `expectedRevision`
- `includeTests`

Optional:

- `changeSemantics`
- `operationIntent`
- `limits`

Evidence calls omit `worktree` and `expectedRevision`.

## Behavior

Wires `composeEffectiveTaskScopeFromEnvelopes` then `composeEffectiveTaskScope`.

Success response: HTTP `200` envelope with `policyVersion` `step4-foundation-2` (value at the time of this slice; see [Operation intent pass-through](#operation-intent-pass-through-later-slices) for the current constant, `step4-foundation-5`). That value is an **existing constant**, not Step 4 authorization or completion.

- `RESERVED` stays `not_evaluated` with reason `coupling_evidence_not_supported`.
- `WRITE` is a classification, **not** permission to write or publish.

## Operation intent pass-through (later slices)

Observed by code reading on `main` at merge `6d570ab7ebdada851e85131271e15b0ceb6dfff6` (PR #60 merged, including fix commit `1c382eb56b554e390e99ce5757b5df8e99166b14`; parents `95ea609` + `1709d53`), and re-checked at merge `f9032302fc55b53400257ce44db8ee5581b53b45` (PR #64, absence-witness lift). The operation-intent behavior below comes from the shared request normalizer. Since the task-echo fix (commit `3e85756`, branch `fix/task-echo-mismatch`), `src/routes/effective-task-scope.routes.js` forwards the full normalized request task (`id`, `title`, `paths` and `symbols` from `normalizeEffectiveTaskScopeRequest`, so paths sorted and deduplicated and `symbols` `[]` when absent) to the Context Pack builder, whose task echo the composer binds to the request task; before, only `title` was forwarded and every real request was `rejected` / `task_echo_mismatch`. A task path that the Context Pack refuses (for example `.env`, `id_rsa`, a `.git` path or `node_modules/…`) ends with HTTP `400` `invalid_task_context_request` before any Impact or compose call.

- The route calls `normalizeEffectiveTaskScopeRequest({ ...body, projectId })` (`projectId` taken from the path) with **no options**, then passes the normalized request through `composeEffectiveTaskScopeFromEnvelopes` into `composeEffectiveTaskScope`. The adapter does not inspect or rewrite `operationIntent`; intent binding happens in the composer.
- Over HTTP only `operationIntent.kind: "delete"` (Slice 3, PR #46; exact keys `kind` and `targets`, targets `{ oldPath, newPath: null }` matching the explicit `task.paths`) reaches compose. The shared normalizer is default-deny for create: only a caller passing `{ allowCreateIntent: true }` (strictly `=== true`; today only `composeEffectiveTaskScope`) gets create normalization.
- Any body whose `operationIntent` has `kind: "create"` (well-formed, malformed or over-budget) is refused during normalization with HTTP `400` `invalid_delete_intent` (`classifyRouteCode`), identical to base `95ea609`, before `getProjectConfig`, `getConfiguredProjectRoots`, the Context Pack and Impact producers, or compose are called (zero calls; pinned by route tests). Any other non-delete kind or malformed delete intent gets the same `400` `invalid_delete_intent`. `invalid_create_intent` and the `create_destination_*` codes are lib-only and never appear over HTTP. See [create intent (refuse-only)](effective-task-scope-create-intent.md).
- Delete-intent binding failures in the composer are returned as composer results (`status: "rejected"` or `status: "not_evaluated"`), not thrown.
- This is **classification, not authorization**: WRITE items carrying `explicit_delete_intent` are not permission to delete, write or publish, and nothing is deleted on disk. Create, rename and directory expansion are not available over HTTP.
- Single-path origin form (the single-path origin canonicalization fix): for a one-path task, Impact emits its legacy single-origin form, which the composer rejects as `origin_form_mismatch`. The route now passes its own self-built Impact through a private, pure `canonicalImpactOriginForm(request, impact)`. When the task has exactly one path and the Impact is exactly the legacy form for that path (the exact 18 top-level keys and no `targets`; `originPath === task.paths[0]`; the exact 5 observation keys; `targetSource` is `null` or `{ path, hash }` for that path; string `status`/`findingState`; record `completeness`), the helper returns the same data in the `targets[]` form. Nothing is recomputed: `snapshotToken`, `targetSource.hash` and the affected lists are copied, and the builder output is not mutated. Any other shape passes through unchanged, so the composer still rejects it. This applies to every request the route composes, delete intents included. The composer, adapter, policy and Impact producer are unchanged, `policyVersion` stays `step4-foundation-6`, and create and the absence witness stay refused over HTTP.
- The route still passes only the `pack` and `impact` envelopes; it does not supply the optional `symbolTargetCompletenessWitness` envelope that PR #59 (C1, merged) made acceptable at the adapter seam.
- `policyVersion`: `EFFECTIVE_TASK_SCOPE_POLICY_VERSION` is `step4-foundation-6` from the N-12 full-chain amendment (R5-FC), bumped from `step4-foundation-5` (D3, the absence-witness lift), which was bumped from `step4-foundation-4` (the PR #60 fix, merged at `6d570ab`, had bumped it from `step4-foundation-3`). The route has no version constant of its own, so route responses report the composer's value; the DTO shape is unchanged. Create over HTTP is still `400 invalid_delete_intent`, and a body carrying `createDestinationAbsenceWitness` is refused with `400 unexpected_field` before any config, producer or compose call. Hard flags (`IMPLEMENTATION_AUTHORIZED`, `SLICE4`, `STEP4_SLICE4_READY_TO_IMPLEMENT`, confinement) are unchanged.

## Files in this slice

- `src/routes/effective-task-scope.routes.js` (new)
- `tests/effective-task-scope-routes.test.js` (new)
- `src/routes/intelligence.routes.js` (import and POST registration only)

No ETS lib, policy, adapter, or plugin edits. The twelve pre-existing dirty docs (`README.md` and `docs/*` already modified before this slice) are **not** part of this feature record and must stay out of this commit unless separately updated as slice documentation.

## Verification

Branch: `scope-http-route` at `26f94d9fa1a8b1946792083efb7c1810cb6a67ee` (uncommitted when verified).

**Tester: pass** (tester did not change code; contract held, including `RESERVED` `not_evaluated` and `WRITE` not permission):

- `node --test tests/effective-task-scope-routes.test.js` — 6 pass, 0 fail
- Sibling: `tests/intelligence-routes.test.js`, `tests/project-impact-routes.test.js`, `tests/router.test.js`, `tests/task-context-routes.test.js` — 53 pass, 0 fail

**Reviewer: PASS**

## Explicit non-claims

- Not Step 4
- Not Track A
- Not conflict
- Not guard
