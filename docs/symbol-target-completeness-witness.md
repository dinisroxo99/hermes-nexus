# Symbol-target completeness witness (in-repo producer)

Record of the in-repo **symbol-target completeness witness** producer as implemented at commit `f1151a397e532af95eb4c8f1f02262caa03a9b8b` on branch `feat/symbol-target-completeness-witness` (PR #56). This document is the feature record for the documentation commit on that branch. It documents the **repeatable in-repo producer** only. Prior closed slices (completeness definition and any out-of-repo witness) are context only. This record is **not** Slice 4 selection, **not** confinement, **not** ETS / `composeEffectiveTaskScope` consumption or HTTP wiring, **not** conflict, and **not** a guard.

## What this producer does

Emits an **ArchW-shaped** symbol-target completeness witness from an explicit request binding. For uniqueness citations it calls **only** `resolveTypeScriptDeclarationEvidence` (Track A1 adapter). It does **not** consume ETS, `composeEffectiveTaskScope`, or HTTP routes, and it does **not** flip hard flags.

Completeness means **all required names evaluated under fail-closed rules** — **not** “all unique”. Composition rule:

`uniqueness_holds_for_domain_of_evaluated_names AND completeness_obligations_1_through_4_hold`

A1 alone is insufficient (`a1AloneInsufficient` / `a1AloneInsufficientForNogo2` are always `true` on the witness).

## Export

| Export | Module | Role |
| --- | --- | --- |
| `produceSymbolTargetCompletenessWitness(request)` | `src/lib/symbol-target-completeness-witness.js` | Build one ArchW-shaped completeness witness from a request object |

### Request (golden / live path)

Supply real `fileContents` for admitted task paths. The producer builds a live `createProviderSnapshot`, then calls `resolveTypeScriptDeclarationEvidence` once per required name.

Required binding fields (missing any ⇒ fail-closed, values not invented):

- `taskPaths` — non-empty string array
- `requiredNames` — string array (may be empty only if caller intends that; golden uses one name)
- `projectId`, `repositoryId`, `worktreeId`, `snapshotToken`, `admittedCommit` — non-empty strings
- `sourceHashes` — plain object mapping path → sha256

Live evaluation also needs either:

- `fileContents` — plain object mapping path → UTF-8 text for each task path, **or**
- `observation` without `fileContents` — for negative / forged-token fixtures only

Optional / supporting fields used by the producer:

- `revision`, `worktree`, `taskId`, `createdAt`
- `nameListTruncated` — when `true`, completeness fails closed
- `pathStatusOverrides` — per-path coverage status override
- `forceCompletenessHolds` / `claimCompletenessDespiteFailClosed` — attempted upgrades; still fail closed

### Witness identity

| Field | Value |
| --- | --- |
| `kind` | `symbol-target-completeness-witness` |
| `producerIdentity` | `hermes-nexus-in-repo-symbol-target-completeness-witness` |
| `version` | `symbol-target-completeness-witness-v1` |

### Claimed domain / A1 citation stamp

| Field | Value |
| --- | --- |
| Claimed domain | `typescript-javascript-direct-declarations-tsjs-direct-declarations-1` |
| Query domain (adapter) | `tsjs_source_file_direct_declarations_v1` |
| Citation `entryPoint` | `resolveTypeScriptDeclarationEvidence` |
| Citation `schemaVersion` | `1` |
| Citation `analysisVersion` | `symbol-resolution-evidence-v1` |
| Citation `policyVersion` | `tsjs-direct-declarations-1` |

### Fail-closed matrix

Always stamped on the witness:

| Flag | Meaning |
| --- | --- |
| `partialImpliesCompletenessFalse` | Partial / incomplete evaluations ⇒ `completenessHolds=false` |
| `truncatedImpliesCompletenessFalse` | Truncated name list ⇒ `completenessHolds=false` |
| `uncoveredLanguageImpliesCompletenessFalse` | Non-TS/JS path coverage ⇒ `completenessHolds=false` |
| `bindingMismatchImpliesCompletenessFalse` | Snapshot / hash / revision binding mismatch ⇒ `completenessHolds=false` |

Path coverage statuses: `covered` (TS/JS extensions), `uncovered_language`, or `unevaluated`.

Per-name evaluation outcomes: `unique`, `not_found`, `ambiguous`, `unevaluated`.

`uniquenessHolds` is true only when every evaluation outcome is `unique` and binding did not mismatch. `completenessHolds` requires fail-closed obligations to hold; uniqueness is separate.

### Hard flags stamped on every witness

| Flag | Value |
| --- | --- |
| `IMPLEMENTATION_AUTHORIZED` | `NO` |
| `SLICE4` | `NOT_STARTED` |
| `STEP4_SLICE4_READY_TO_IMPLEMENT` | `NO` |
| `confinementFlipped` | `false` |
| `pr53ReservedUntouched` | `true` |
| `trackBUntouched` | `true` |

These are **witness metadata**, not changes to `docs/CURRENT_STATUS.md`.

## Files in this slice

- `src/lib/symbol-target-completeness-witness.js`
- `tests/symbol-target-completeness-witness.test.js`
- `tests/fixtures/symbol-target-completeness-witness/README.md` (notes that golden uses live worktree ETS bytes, not fixture files)

No ETS consumption, HTTP route, Slice 4 selection, confinement, conflict, or guard wiring in this producer. `CURRENT_STATUS` / `IMPLEMENTATION_AUTHORIZED` and related hard flags are **not** flipped by the producer or by this documentation commit.

## How to run / verify

From the repository root:

```bash
node --test tests/symbol-target-completeness-witness.test.js
```

Or the full suite:

```bash
npm test
```

Covered cases (see the test file):

- **Golden:** real `src/lib/effective-task-scope.js` bytes + live `resolveTypeScriptDeclarationEvidence` for `composeEffectiveTaskScope` → `completenessHolds` and `uniquenessHolds` true; ArchW keys and P1 Accept 1–26 / Reject 1–14 scored in-test
- **Negatives:** truncated name list; `snapshotToken` / `sourceHashes` binding mismatch; missing required binding (no invented ids); uncovered language (e.g. `.py`); forced completeness upgrade attempts; non-satisfiers list; observation-only forged token

Fixture README: `tests/fixtures/symbol-target-completeness-witness/README.md`.

## Explicit non-claims / boundaries

- **Not** Slice 4 selection or Step 4 complete
- **Not** confinement epic start
- **Not** ETS / `composeEffectiveTaskScope` / HTTP consumption of A1 or completeness evidence
- **Not** A0 / A2 as code tracks
- **Not** conflict (Step 5)
- **Not** guard (Step 6)
- **No** hard-flag flips in `CURRENT_STATUS` (`IMPLEMENTATION_AUTHORIZED`, `SLICE4`, `STEP4_SLICE4_READY_TO_IMPLEMENT`, RESERVED blanket, confinement)
- **No** PR #53 RESERVED / Track B incomplete-item rule changes
- Non-satisfiers explicitly reject Context Pack retained symbols/rows, Impact imports/uses/references/minimumDistance, bare declaration-count / text search / export greps, and flat `resolveTrackA1` outcomes alone as completeness evidence
