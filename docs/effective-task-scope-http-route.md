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

Success response: HTTP `200` envelope with `policyVersion` `step4-foundation-2` (value at the time of this slice; see [Operation intent pass-through](#operation-intent-pass-through-later-slices) for the current constant). That value is an **existing constant**, not Step 4 authorization or completion.

- `RESERVED` stays `not_evaluated` with reason `coupling_evidence_not_supported`.
- `WRITE` is a classification, **not** permission to write or publish.

## Operation intent pass-through (later slices)

Observed by code reading on branch `feat/ets-create-intent-classification` at `6250625bd9d302b6a0876355fb22bdb8e6e9b542` (PR #60, **open, not merged**). `src/routes/effective-task-scope.routes.js` is not changed by the later slices described here.

- The route normalizes the body with `normalizeEffectiveTaskScopeRequest` (`projectId` taken from the path) and passes the normalized request, including optional `operationIntent`, unchanged through `composeEffectiveTaskScopeFromEnvelopes` into `composeEffectiveTaskScope`. The adapter does not inspect or rewrite `operationIntent`; intent binding happens in the composer.
- `operationIntent.kind` may be `"delete"` (Slice 3, PR #46; targets `{ oldPath, newPath: null }`) or `"create"` (C2, PR #60 — open, not merged; targets `{ oldPath: null, newPath }`). Exact keys `kind` and `targets`; targets must be non-empty and match the explicit `task.paths`. See [create-intent classification](effective-task-scope-create-intent.md).
- Malformed intents are refused during request normalization: `invalid_create_intent` for a malformed create intent, `invalid_delete_intent` for any other kind or a malformed delete intent. The route maps these request codes to HTTP `400` (`classifyRouteCode`).
- Composer-side binding failures (e.g. `create_intent_target_mismatch`, `create_source_binding_mismatch`) and not-evaluated sources/targets (`create_source_not_evaluated`, `create_target_not_evaluated`) are returned as composer results (`status: "rejected"` or `status: "not_evaluated"`), not thrown.
- This is **classification, not authorization**: WRITE items carrying `explicit_create_intent` / `explicit_delete_intent` are not permission to create, delete, write or publish, and nothing is created or deleted on disk. Rename and directory expansion are not supported.
- The route still passes only the `pack` and `impact` envelopes; it does not supply the optional `symbolTargetCompletenessWitness` envelope that PR #59 (C1, merged) made acceptable at the adapter seam.
- `policyVersion`: `EFFECTIVE_TASK_SCOPE_POLICY_VERSION` on this branch is `step4-foundation-3` (introduced with PR #57; unchanged by PR #59 and PR #60). Hard flags (`IMPLEMENTATION_AUTHORIZED`, `SLICE4`, `STEP4_SLICE4_READY_TO_IMPLEMENT`, confinement) are unchanged.

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
