# Effective Task Scope — adapter completeness-witness pass-through

**Slice:** Slice 4 (bounded) — ETS adapter completeness-witness pass-through (C1)
**Date:** 2026-10-07 (PT)
**policyVersion:** `step4-foundation-3` (unchanged; seam-only)
**schemaVersion / analysisVersion:** unchanged (`2` / `effective-task-scope-v2`)

## Contract

`composeEffectiveTaskScopeFromEnvelopes` accepts envelopes with exact keys:

- required: `pack`, `impact` (success envelopes `{ ok: true, data }`, optional `message`)
- optional: `symbolTargetCompletenessWitness` (same ok/data discipline)

When the optional witness envelope is present, its `.data` is forwarded into
`composeEffectiveTaskScope` as `evidence.symbolTargetCompletenessWitness`, and
`checkInputBudget` counts the witness in the total compact input. When absent,
behavior matches the prior pack+impact-only seam.

The adapter stays **data-only**: no producer, A1, analyzer, Git, FS, HTTP, or Hermes calls.
Callers/tests produce the witness outside the adapter. Empty-symbols behavior is unchanged.
Malformed envelopes refuse with `invalid_effective_task_scope_envelope`.

## Hard flags

This feature record does **not** flip `IMPLEMENTATION_AUTHORIZED`, `SLICE4`,
`STEP4_SLICE4_READY_TO_IMPLEMENT`, or confinement flags. HTTP/plugin/RESERVED remain out of scope.
