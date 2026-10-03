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

Success response: HTTP `200` envelope with `policyVersion` `step4-foundation-2`. That value is an **existing constant**, not Step 4 authorization or completion.

- `RESERVED` stays `not_evaluated` with reason `coupling_evidence_not_supported`.
- `WRITE` is a classification, **not** permission to write or publish.

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
