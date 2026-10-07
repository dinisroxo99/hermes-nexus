# Effective Task Scope — explicit create-intent classification

**Slice:** Slice 4 (bounded) — explicit create-intent classification (C2)
**Date:** 2026-10-07 (PT)
**policyVersion:** `step4-foundation-4` (bumped from `step4-foundation-3` by the PR #60 fix `1c382eb` because the create rules changed)
**schemaVersion / analysisVersion:** unchanged (`2` / `effective-task-scope-v2`)

## Contract

Declared `operationIntent.kind === "create"` with targets `{ oldPath: null, newPath }` on
**explicit** `task.paths` is recognized and **refused fail-closed** (refuse-only since fix
`1c382eb`). Per declared `newPath`, after request normalization, the existing composer gates
and whole-proof validation of Pack + Impact:

- **EXISTS** (a Context `files` item or a non-null Impact `targetSource` for the path):
  `not_evaluated` / `create_destination_exists`.
- **UNKNOWN** (no positive observation; the default, whatever the completeness flags say):
  `not_evaluated` / `create_destination_absence_not_proven`.
- **PROVEN-ABSENT** is unreachable: no current pure input can prove that a path is absent.
  It needs a future absence-witness slice, which is out of scope here.

Any EXISTS path takes precedence over UNKNOWN. Create never emits WRITE, WATCH or
`operationIntent`; there is no `explicit_create_intent` / `create_intent_awareness` emission,
and create is not authorized in any reachable case.

Rejected (`status: "rejected"`, unchanged discipline): `invalid_create_intent` (malformed
intent), `create_intent_target_mismatch` (declared set differs from `task.paths`),
`create_source_binding_mismatch` (hash conflict, wrong trust/reason, malformed record) and
`scope_budget_exceeded`. Through the composer, a `newPath` with no Impact target is rejected
earlier by the existing origin gate as `origin_set_mismatch`; `bindCreateIntent` called directly
still throws `create_intent_target_mismatch` for that case. The former codes
`create_source_not_evaluated` and `create_target_not_evaluated` were removed.

**Route barrier:** `normalizeEffectiveTaskScopeRequest` denies create by default. Only
`composeEffectiveTaskScope` opts in, with `{ allowCreateIntent: true }` (strictly `=== true`).
The HTTP route passes no option, so any create body returns HTTP 400 `invalid_delete_intent`
(identical to base `95ea609`) before any config, producer or compose call.
`invalid_create_intent` and the `create_destination_*` codes are lib-only.

**Out of scope:** rename, directory expansion, silent path invent, filesystem create,
HTTP/plugin, RESERVED/Track B. WRITE remains classification, not authorization.

## Hard flags

This feature record does **not** flip `IMPLEMENTATION_AUTHORIZED`, `SLICE4`,
`STEP4_SLICE4_READY_TO_IMPLEMENT`, or confinement flags.
