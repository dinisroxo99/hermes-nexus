# Effective Task Scope — explicit create-intent classification

**Slice:** Slice 4 (bounded) — explicit create-intent classification (C2), reopened by the absence-witness lift (D3/D4/D5)
**Date:** 2026-10-07 (PT); D3 update 2026-10-09 (PT)
**policyVersion:** `step4-foundation-6` (bumped from `step4-foundation-5` by the N-12 full-chain amendment, R5-FC, because a create rule changed; `-5` had been bumped from `step4-foundation-4` by D3 because the create rules changed; `-4` had been bumped from `step4-foundation-3` by the PR #60 fix `1c382eb`)
**schemaVersion / analysisVersion:** unchanged (`2` / `effective-task-scope-v2`)

## Contract

Declared `operationIntent.kind === "create"` with targets `{ oldPath: null, newPath }` on
**explicit** `task.paths` is recognized by `composeEffectiveTaskScope` (lib only). Per declared
`newPath`, after request normalization, the existing composer gates (echo, identity/locator,
revision, token, provider, origin form/set, terminal, stale, non-clean, symbol witness) and
whole-proof validation of Pack + Impact:

- **EXISTS** (a Context `files` item or a non-null Impact `targetSource` for the path, or an
  absence-witness record with verdict `exists`): `not_evaluated` / `create_destination_exists`.
- **Scope-out** (absence witness): the last ancestor is absent → `not_evaluated` /
  `create_parent_directory_absent`; an ancestor is a symlink, mount, nested repository or another
  boundary → `not_evaluated` / `create_ancestor_boundary`.
- **UNKNOWN** (the default): `not_evaluated` / `create_destination_absence_not_proven`. This covers
  no absence witness at all (the request is then classified exactly as under `step4-foundation-4`),
  incomplete records, a name-key collision (dual key `K`/`Kk`) with a listed entry or between two
  declared targets, the S2a secret rule, the shape rule, an empty parent, and a runtime that does not
  report `process.versions.unicode === "17.0"` (every target UNKNOWN; a later Unicode version disables
  lifts until a new contract revision re-pins it).
- **PROVEN-ABSENT** for **every** declared target (no positive observation, and an optional
  `createDestinationAbsenceWitness` evidence record (v1, S2a only) that is valid, bound to the request
  and the Pack snapshot, complete and consistent): the binder returns the lift
  `create_destination_proven_absent` and the composer classifies. Each declared `newPath` becomes a
  WRITE item with ruleIds `["explicit_create_intent", "explicit_task_path"]`, the result carries
  `operationIntent { kind: "create", targets }`, the resolver completeness gains
  `create_destination_proven_absent`, and the status is `incomplete`. There is no
  `create_intent_awareness` READ/WATCH rule.

Precedence: EXISTS › `parent_absent` › `ancestor_boundary` › UNKNOWN › lift. The lift is all or
nothing: one UNKNOWN target means no WRITE for any target.

**Impact gate (D3-c).** A proven-absent create usually comes with an Impact whose global
`findingState` is `not_evaluated` (no source for the new paths). Only that disjunct of the
`impact_not_evaluated` gate is relaxed, and only through the total, lazy
`isCreateGateRelaxed(normalizedRequest, impact, absenceCandidate)`: create intent; every candidate
verdict `absent`; `impact.status === "partial"`; `affectedFiles` an array; global completeness exactly
`{ source: ["source_unavailable"], provider: [], traversal: [], output: [] }`; every `not_evaluated`
target a declared `newPath` with `targetSource: null`, status `partial` and that completeness; every
other target `evidence_found` / `no_evidence_found`. The other gate disjuncts are unchanged, and for
every non-create request the gate behaves exactly as before.

**Absence-witness refusals** (`not_evaluated`, no containers): `create_absence_evidence_invalid`
(shape, constants, any option other than S2a), `create_absence_binding_mismatch` (identity, revision,
snapshot token or target set differs; or a retained observation contradicts the witness listing),
`create_absence_evidence_inconsistent` (sizes, structure, arithmetic, digests, fail-closed matrix,
filesystem allow-list, producer verdict ≠ recomputed verdict; from `step4-foundation-6`, a `complete:true`
record without the full ancestor chain `D(p)`, every element `directory`, R5-FC). A witness on a READ or delete request
is `rejected` / `create_absence_witness_unexpected`. With the witness present, the input budget is
`checkCreateAbsenceInputBudget` (327680 total); oversize → `rejected` / `scope_budget_exceeded`. The
producer throws `create_absence_witness_byte_cap_exceeded` and `invalid_create_absence_witness_request`
are not composer reason codes. The composer and policy never import the fs producer and do no IO.

**Single-target caveat (NG-9, C-13).** A single-path request makes Impact emit the legacy origin form,
which the composer rejects as `origin_form_mismatch` before any create rule. So only creates with ≥ 2
targets in one request can reach the lift. A fix belongs to a separate Impact/ETS form slice.

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
(identical to base `95ea609`) before any config, producer or compose call. A body carrying
`createDestinationAbsenceWitness` is refused by the request normalizer (`400 unexpected_field`).
`invalid_create_intent` and the `create_*` codes are lib-only.

**Out of scope:** rename, directory expansion, silent path invent, filesystem create,
HTTP/plugin, RESERVED/Track B, confinement. WRITE remains classification, not authorization:
nothing is created on disk.

## Hard flags

This feature record does **not** flip `IMPLEMENTATION_AUTHORIZED`, `SLICE4`,
`STEP4_SLICE4_READY_TO_IMPLEMENT`, or confinement flags.
