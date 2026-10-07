# Effective Task Scope — explicit create-intent classification

**Slice:** Slice 4 (bounded) — explicit create-intent classification (C2)
**Date:** 2026-10-07 (PT)
**policyVersion:** `step4-foundation-3` (unchanged; additive create sibling to delete)
**schemaVersion / analysisVersion:** unchanged (`2` / `effective-task-scope-v2`)

## Contract

Declared `operationIntent.kind === "create"` with targets `{ oldPath: null, newPath }` on
**explicit** `task.paths` is normalized, bound, and classified (mirror Slice 3 delete-intent
discipline). WRITE items carry `explicit_create_intent`; non-WRITE awareness uses
`create_intent_awareness`. Completeness resolver reasons use `create_*` prefixes.

Fail-closed on malformed create intent, path set mismatch, or source-binding failures
(`invalid_create_intent`, `create_intent_target_mismatch`, `create_source_binding_mismatch`,
`create_source_not_evaluated`, `create_target_not_evaluated`).

**Out of scope:** rename, directory expansion, silent path invent, filesystem create,
HTTP/plugin, RESERVED/Track B. WRITE remains classification, not authorization.

## Hard flags

This feature record does **not** flip `IMPLEMENTATION_AUTHORIZED`, `SLICE4`,
`STEP4_SLICE4_READY_TO_IMPLEMENT`, or confinement flags.
