# Track A1 — symbol resolution

Record of the Track A1 symbol uniqueness / resolution slice as implemented at merge commit `5ab214c5a1901a32ffaf4f754edf0ac98e47b470` on `main` (PR 54). This document is the feature record for the documentation commit on branch `docs/track-a1-symbol-resolution`. It is **not** A0 or A2, **not** Step 4 symbol completeness, **not** conflict, and **not** a guard.

## What this slice does

Produces **bounded TypeScript/JavaScript direct source-file declaration evidence** for Track A1: resolve a symbol request against snapshot bytes and report uniqueness / not-found / not-evaluated outcomes under a fixed identity stamp and parser pin.

Qualifying direct declarations are SourceFile `FunctionDeclaration`, `ClassDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, and `EnumDeclaration` nodes with Identifier names, plus each Identifier `VariableDeclaration` directly inside a source-file `VariableStatement`. Nested declarations, members, parameters, aliases, and anonymous defaults are out of domain.

## Exports

Both live in `src/lib/track-a-symbol-resolution.js`:

| Export | Role |
| --- | --- |
| `resolveTrackA1(input)` | Flat, legacy-compatible single-argument entry. May reach `resolved_unique` and `not_found` for tests and migration. |
| `resolveTypeScriptDeclarationEvidence(request, observation)` | Contract-shaped two-argument adapter over the same shared body. Validates the request/observation split, then delegates. |

**A1 acceptance evidence** counts **only** from `resolveTypeScriptDeclarationEvidence`. A flat-entry `resolved_unique` / `not_found` is not A1 acceptance evidence.

## Stamped identity

Every result carries:

| Field | Value |
| --- | --- |
| `schemaVersion` | `1` |
| `analysisVersion` | `symbol-resolution-evidence-v1` |
| `policyVersion` | `tsjs-direct-declarations-1` |

## Parser pin

Contract parser pin: `typescript/6.0.3`. The installed TypeScript version is read at runtime; if it differs from the pin, results note that the parser version is not the contract parser.

## Files in this slice

- `src/lib/track-a-symbol-resolution.js`
- `tests/track-a1-symbol-resolution.test.js`

No `composeEffectiveTaskScope`, analyzer, provider-contract, or identity redesign in this docs slice. `CURRENT_STATUS` / `IMPLEMENTATION_AUTHORIZED` are **not** flipped by this documentation commit.

## Operator contracts (observation pointers)

Match operator contracts **r2** / **r3** only where the merged module already implements them. Full contracts and adapter evidence live outside the repo:

- `/home/dinis/icm/evidence/hermes-nexus/track-a1-observation/a1-contract-739-r2.md`
- `/home/dinis/icm/evidence/hermes-nexus/track-a1-observation/a1-contract-739-r3.md`
- `/home/dinis/icm/evidence/hermes-nexus/track-a1-observation/2026-10-06T145843Z-adapter-on-real-bytes.json` (`a1Approved`: true)

Do not treat those files as in-repo sources of truth for this commit; cite them as observation pointers only.

## Verification

Merged implementation at HEAD `5ab214c5a1901a32ffaf4f754edf0ac98e47b470`. Verification is the merged suite in `tests/track-a1-symbol-resolution.test.js` (and the adapter acceptance evidence cited above). This documentation commit adds **only** this feature doc.

## Explicit non-claims

- **Not** A0
- **Not** A2
- **Not** Step 4 symbol completeness
- **Not** conflict
- **Not** guard
- **No** `composeEffectiveTaskScope` / analyzer / provider-contract / identity redesign in this docs slice
- `CURRENT_STATUS` / `IMPLEMENTATION_AUTHORIZED` **not** flipped by this docs slice
