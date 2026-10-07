# Effective Task Scope — symbol-target completeness consume

**Slice:** Slice 4 (bounded) — ETS A1+completeness consume
**Date:** 2026-10-07 (PT)
**policyVersion:** `step4-foundation-3`
**schemaVersion / analysisVersion:** unchanged (`2` / `effective-task-scope-v2`)

## Contract

When `task.symbols` is nonempty, `composeEffectiveTaskScope` may proceed past the former hard `symbol_targets_not_supported` gate **only if** an already-produced `evidence.symbolTargetCompletenessWitness` binds request ↔ paths/names ↔ identity ↔ revision ↔ snapshot and both `uniquenessHolds` and `completenessHolds` are true in the admitted TS/JS direct-declaration domain.

Before lift, the composer also checks witness **structure and consistency** (evaluations, pathCoverage, sourceHashes, name↔evaluation↔citation correspondence, boolean↔details when holds are true, and sourceHashes vs retained pack/impact hashes). When holds are true, each evaluation `pathScope` must equal the full `taskPaths` domain (not a subset or `[]`); detailed evaluation citations must carry `snapshotToken` equal to the exterior witness token (summary `a1Citations` may omit it; if present it must match); and `evidenceComplete===true` must cohere with `runStatus`/outcome and completeness dimensions (present non-object `completeness` is refused). Binding or consistency failure refuses with `not_evaluated` and no WRITE containers. Honest holds-false with consistent structure yields the existing not_established codes (still no lift).

The total compact input budget includes the witness when present (`checkInputBudget` 4th argument).

The composer stays **pure**: it does not call `produceSymbolTargetCompletenessWitness`, `resolveTypeScriptDeclarationEvidence`, or `resolveTrackA1`. Callers/tests produce the witness outside compose.

## Reason codes

| Condition | Code |
|---|---|
| Missing / wrong kind / producerIdentity / version | `symbol_target_evidence_missing` |
| Paths / symbols / project / repository / worktree / snapshot mismatch; name↔eval↔citation / pathCoverage set / hash vs retained pack·impact mismatch | `symbol_target_binding_mismatch` |
| Missing required structure (evaluations / pathCoverage / sourceHashes); holds===true contradict details | `symbol_target_evidence_inconsistent` |
| `completenessHolds !== true` (structure OK) | `symbol_target_completeness_not_established` |
| `uniquenessHolds !== true` (structure OK) | `symbol_target_uniqueness_not_established` |
| Claimed domain / A1 stamp not admitted | `symbol_target_domain_unsupported` |

## WRITE

Classification only on explicit `task.paths`. No silent symbol→whole-file widen. No `kind: "symbol"` WRITE items. WRITE is not authorization.

## Hard flags

This feature record does **not** flip `IMPLEMENTATION_AUTHORIZED`, `SLICE4`, `STEP4_SLICE4_READY_TO_IMPLEMENT`, or confinement flags. Witness `hardFlags` remain NO / NOT_STARTED / NO.
