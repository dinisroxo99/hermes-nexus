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

Success response: HTTP `200` envelope with `policyVersion` `step4-foundation-2` (value at the time of this slice; see [Operation intent pass-through](#operation-intent-pass-through-later-slices) for the current constant, `step4-foundation-4`). That value is an **existing constant**, not Step 4 authorization or completion.

- `RESERVED` stays `not_evaluated` with reason `coupling_evidence_not_supported`.
- `WRITE` is a classification, **not** permission to write or publish.

## Operation intent pass-through (later slices)

Observed by code reading on `main` at merge `6d570ab7ebdada851e85131271e15b0ceb6dfff6` (PR #60 merged, including fix commit `1c382eb56b554e390e99ce5757b5df8e99166b14`; parents `95ea609` + `1709d53`). `src/routes/effective-task-scope.routes.js` is unchanged since base `95ea609`; the behavior below comes from the shared request normalizer.

- The route calls `normalizeEffectiveTaskScopeRequest({ ...body, projectId })` (`projectId` taken from the path) with **no options**, then passes the normalized request through `composeEffectiveTaskScopeFromEnvelopes` into `composeEffectiveTaskScope`. The adapter does not inspect or rewrite `operationIntent`; intent binding happens in the composer.
- Over HTTP only `operationIntent.kind: "delete"` (Slice 3, PR #46; exact keys `kind` and `targets`, targets `{ oldPath, newPath: null }` matching the explicit `task.paths`) reaches compose. The shared normalizer is default-deny for create: only a caller passing `{ allowCreateIntent: true }` (strictly `=== true`; today only `composeEffectiveTaskScope`) gets create normalization.
- Any body whose `operationIntent` has `kind: "create"` (well-formed, malformed or over-budget) is refused during normalization with HTTP `400` `invalid_delete_intent` (`classifyRouteCode`), identical to base `95ea609`, before `getProjectConfig`, `getConfiguredProjectRoots`, the Context Pack and Impact producers, or compose are called (zero calls; pinned by route tests). Any other non-delete kind or malformed delete intent gets the same `400` `invalid_delete_intent`. `invalid_create_intent` and the `create_destination_*` codes are lib-only and never appear over HTTP. See [create intent (refuse-only)](effective-task-scope-create-intent.md).
- Delete-intent binding failures in the composer are returned as composer results (`status: "rejected"` or `status: "not_evaluated"`), not thrown.
- This is **classification, not authorization**: WRITE items carrying `explicit_delete_intent` are not permission to delete, write or publish, and nothing is deleted on disk. Create, rename and directory expansion are not available over HTTP.
- The route still passes only the `pack` and `impact` envelopes; it does not supply the optional `symbolTargetCompletenessWitness` envelope that PR #59 (C1, merged) made acceptable at the adapter seam.
- `policyVersion`: `EFFECTIVE_TASK_SCOPE_POLICY_VERSION` on main is `step4-foundation-4`, bumped from `step4-foundation-3` (introduced with PR #57) by the PR #60 fix (merged at `6d570ab`) because the create rules changed. The route has no version constant of its own, so route responses now report `step4-foundation-4`; the DTO shape is unchanged. Hard flags (`IMPLEMENTATION_AUTHORIZED`, `SLICE4`, `STEP4_SLICE4_READY_TO_IMPLEMENT`, confinement) are unchanged.

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
