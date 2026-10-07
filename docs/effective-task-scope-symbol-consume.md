# Effective Task Scope — symbol-target completeness consume

**Slice:** Slice 4 (bounded) — ETS A1+completeness consume  
**Date:** 2026-10-07 (PT)  
**policyVersion:** `step4-foundation-3`  
**schemaVersion / analysisVersion:** unchanged (`2` / `effective-task-scope-v2`)

## Contract

When `task.symbols` is nonempty, `composeEffectiveTaskScope` may proceed past the former hard `symbol_targets_not_supported` gate **only if** an already-produced `evidence.symbolTargetCompletenessWitness` binds request ↔ paths/names ↔ identity ↔ revision ↔ snapshot and both `uniquenessHolds` and `completenessHolds` are true in the admitted TS/JS direct-declaration domain.

The composer stays **pure**: it does not call `produceSymbolTargetCompletenessWitness`, `resolveTypeScriptDeclarationEvidence`, or `resolveTrackA1`. Callers/tests produce the witness outside compose.

## Reason codes

| Condition | Code |
|---|---|
| Missing / wrong kind / producerIdentity / version | `symbol_target_evidence_missing` |
| Paths / symbols / project / repository / worktree / snapshot mismatch | `symbol_target_binding_mismatch` |
| `completenessHolds !== true` | `symbol_target_completeness_not_established` |
| `uniquenessHolds !== true` | `symbol_target_uniqueness_not_established` |
| Claimed domain / A1 stamp not admitted | `symbol_target_domain_unsupported` |

## WRITE

Classification only on explicit `task.paths`. No silent symbol→whole-file widen. No `kind: "symbol"` WRITE items. WRITE is not authorization.

## Hard flags

This feature record does **not** flip `IMPLEMENTATION_AUTHORIZED`, `SLICE4`, `STEP4_SLICE4_READY_TO_IMPLEMENT`, or confinement flags. Witness `hardFlags` remain NO / NOT_STARTED / NO.
