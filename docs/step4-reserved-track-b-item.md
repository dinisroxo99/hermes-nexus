# Step 4 first slice — RESERVED item from Track B witness

Record of the `feat/step4-reserved-track-b-item` slice. This document is the feature record for the same commit as the composer change. It is the **first Step 4 slice**, **not** Step 4 complete. Track A, conflict, and guard stay out. **No second producer.** **No route edit.** **No `repositoryId`.**

## What this slice does

Emits **one** `RESERVED` item from the **merged Track B witness**.

| Field | Value |
| --- | --- |
| Target | `docs/project-icm.md` |
| Role | `consistency_obligation` only (B-side consistency obligation) |
| `ruleIds` | `agent-manifest.machine-id-rule-source-equality` |
| `evidenceRefs` | empty |
| Origins | empty |
| Attribution | `null` |
| Status | `incomplete` |

The item **still emits** when `docs/project-icm.md` is already a task write path (write-path suppression was removed; that filter was incorrect).

A **missing** witness stays `not_evaluated` with reason `coupling_evidence_not_supported`.

## Files in this slice

- `src/lib/effective-task-scope.js`
- `src/lib/reserved-from-track-b-witness.js` (new)
- `tests/effective-task-scope-reserved-track-b.test.js` (new)

Policy and routes untouched. The twelve pre-existing dirty docs (`README.md` and `docs/*` already modified before this slice) are **not** part of this feature record and must stay out of this commit unless separately updated as slice documentation.

## Verification

Branch: `feat/step4-reserved-track-b-item` at `f855ed9da9bba4247ec04a307d67c2f0d9de2bb5` (uncommitted when verified).

**Tester: pass** (recheck after write-path filter removal):

- New file: **4 pass**
- Across the six effective-task-scope test files: **164 pass**

**Reviewer: PASS**

## Explicit non-claims

- First Step 4 slice only — **not** Step 4 complete
- **Not** Track A
- **Not** conflict
- **Not** guard
- **No** second producer
- **No** route edit
- **No** `repositoryId`
