# Effective Task Scope — adapter completeness-witness pass-through

**Slice:** Slice 4 (bounded) — ETS adapter completeness-witness pass-through (C1)
**Date:** 2026-10-07 (PT)
**policyVersion:** `step4-foundation-6` (bumped by the N-12 full-chain amendment, R5-FC; `-5` was bumped by D3, the absence-witness lift; unchanged by this seam itself; the earlier `step4-foundation-3` / `-4` / `-5` values here are historical)
**schemaVersion / analysisVersion:** unchanged (`2` / `effective-task-scope-v2`)

## Contract

`composeEffectiveTaskScopeFromEnvelopes` accepts envelopes with exact keys:

- required: `pack`, `impact` (success envelopes `{ ok: true, data }`, optional `message`)
- optional: any subset of `symbolTargetCompletenessWitness` and `createDestinationAbsenceWitness`
  (same ok/data discipline); exactly 2, 3 or 4 keys matching the keys present. Every other key,
  including near-miss spellings, refuses.

When the optional symbol witness envelope is present, its `.data` is forwarded into
`composeEffectiveTaskScope` as `evidence.symbolTargetCompletenessWitness`, and
`checkInputBudget` counts the witness in the total compact input. When absent,
behavior matches the prior pack+impact-only seam.

**Create-destination absence witness (D2, absence-witness evidence contract r3.4 D2 / A5).** When the
`createDestinationAbsenceWitness` envelope is present, the adapter validates only its envelope (never the
witness content) and forwards its `.data` unchanged as `evidence.createDestinationAbsenceWitness`, after
`symbolTargetCompletenessWitness` when both are present. Budget: the adapter then calls
`checkCreateAbsenceInputBudget(request, pack, impact, symbolWitness | undefined, absenceWitness)`
instead of `checkInputBudget`: pack and impact stay ≤ 131072 compact bytes each, and one total over
request + pack + impact + [symbol witness] + absence witness must stay ≤ 327680 (`MAX_COMPACT_INPUT`).
There is **no** separate witness sub-cap; the 49152-byte `maxWitnessBytes` is enforced only by the
producer and, later, the composer (N32-1). Without the absence key, `checkInputBudget` runs exactly as
before and is unchanged. From `step4-foundation-5` (D3) the composer consumes the absence witness:
for a create intent it validates, binds and evaluates it (refuse codes `create_absence_evidence_invalid`,
`create_absence_binding_mismatch`, `create_absence_evidence_inconsistent`) and lifts only when every
target is proven absent (see [create intent](effective-task-scope-create-intent.md)); on a READ or
delete request the key gives `rejected` / `create_absence_witness_unexpected`. The adapter itself is
unchanged. The HTTP route never sends this key.

The adapter stays **data-only**: no producer, A1, analyzer, Git, FS, HTTP, or Hermes calls.
Callers/tests produce either witness outside the adapter. Empty-symbols behavior is unchanged.
Malformed envelopes refuse with `invalid_effective_task_scope_envelope`.

## Hard flags

This feature record does **not** flip `IMPLEMENTATION_AUTHORIZED`, `SLICE4`,
`STEP4_SLICE4_READY_TO_IMPLEMENT`, or confinement flags. HTTP/plugin/RESERVED remain out of scope.
