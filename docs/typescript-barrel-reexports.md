# TypeScript analyzer: `export *` / re-export barrels (N1)

Feature record for branch `fix/analyzer-barrel-reexports` (base `main` @ `f1195c6b5a7f29a73130d1766a5c99caaa4ef89c`).
Binding design: Architect note N1 (`hermes-nexus-arch-n1-export-star-barrel.md`) and addendum 1
(`hermes-nexus-arch-n1-export-star-barrel-addendum1.md`). Analysis evidence only: not authorization, not Step 4.

## Scope

Snapshot (provider) mode of `src/analyzers/typescript/typescript-analyzer.js` only. Legacy (non-snapshot) analysis is
byte-identical (D4). No new nodes or kinds (D9): N1 adds edges and changes `unrepresentedImports` only. The provider
`native.typescript` version is `3` (D8); capability levels are unchanged (`structural`). The ETS composer, adapter,
policy, route and Impact are unchanged; `policyVersion` stays `step4-foundation-6`; caps are unchanged
(2000 nodes / 4000 edges at the provider).

## Definitions

- **Barrel:** a code file with at least one `export … from '<module>'` declaration.
- **Pure barrel** (verifiable, syntactic; `isPureBarrel` in the analyzer): a file is a PURE barrel iff it has at
  least one top-level statement and EVERY top-level statement is a re-export declaration with a module specifier
  (`export * from`, `export * as ns from`, `export { a, b as c } from`, `export type { T } from`). A pure barrel
  therefore declares nothing, exports nothing of its own, imports nothing and runs no side-effect statement.
- Having no recognised graph symbols is **NOT** sufficient: a symbol-less file with a re-export plus anything else
  (a lowercase `export const`, an import, a local `export { x }`, a side-effect statement) is a **mixed barrel** and
  never receives an anchor edge. Files that do not re-export at all (side-effect-only, imports-only, type-only files
  with local `export type { T }` or type declarations) are not barrels.
- A pure barrel has a module anchor (`kind: "module"`, label `<module>`) only under the F1 rule: it has no graph
  symbols and at least one of its re-exports resolves to a file in the snapshot.

Pinned by `tests/typescript-barrel-boundaries.test.js` P-1…P-8 (positives: plain and type-only re-export barrels;
negatives: imports-only, side-effect-only, mixed barrel with a symbol, four symbol-less mixed barrels, type-only files,
and a symbol-less mixed barrel as Impact target).

## Anchor contract (D11, amends the F1 invariant)

A module anchor is never a name match, never a re-export alias, never in `symbolsByName` or `fileSymbolsByPath`, and
never the target of a symbol import or of symbol resolution through a barrel. The ONLY edges into an anchor are
file-level dependency edges into a PURE BARREL's anchor, snapshot mode only: importer -> pure barrel (`importa barrel`)
and outer barrel -> pure barrel (`re-exporta barrel`). Anchors of every other file (side-effect-only, imports-only,
type-only, symbol-less mixed barrels, any non-barrel) receive no edges.

This replaces the F1 wording "anchors are never import targets" for pure barrels only. Pinned by the F1 tests A-1 and
`g` (unchanged), N1-30, and D11-1…D11-4 (no name match, no symbol resolution, no edge into non-pure-barrel anchors,
exact set of edges into anchors).

## Behaviour

- **Resolution (C, D2):** each named, aliased or default import from a barrel and each re-exported name is resolved
  through the compiler's export table (`getExportedDeclarations`), which follows star chains and cycles, aliases,
  default-as, `export * as ns` and type-only re-exports. Edges go to the defining symbols.
- **Barrel as Impact target (D10):** an importer of a pure barrel gets one edge into the barrel's anchor, and a barrel
  re-exporting from a pure barrel gets one, so Impact with the barrel itself as target reaches its importers.
  Guard: every import from a barrel and every barrel -> barrel re-export must link the barrel file (anchor edge or an
  edge to one of its own symbols); otherwise it is counted as unrepresented (mixed barrels, namespace imports of mixed
  barrels), so the provider is partial instead of silently complete.
- **Namespace imports (D5 revised):** per-member resolution of `import * as m` stays out of scope; a namespace import
  from a barrel is never silent (anchor edge for pure barrels, otherwise the guard).
- **Ambiguous star names (D3 + D3a):** a name provided by two or more `export *` sources (TS2308) is linked to the
  candidates the union walk finds (a conservative union, not a resolution) and is also counted as unrepresented, so
  the result is `partial`. Nothing in the output marks one candidate as "the" resolution. The walk is bounded by a
  `seen` set on cycles. When node/edge caps are hit the provider is `partial` (`limited`) and the ambiguity is still
  counted, because the counter runs before the caps. Pinned by N1-15, N1-29, D3a-1…D3a-3.
- **tsconfig paths (D6a):** the checker receives the snapshot `tsconfig.json` `baseUrl`/`paths`. It runs on the
  in-memory file system that holds only the snapshot sources (`skipFileDependencyResolution`, `noLib`), so an alias
  resolves only to a file admitted to the snapshot; no host or out-of-project file is read. Unresolved aliases (target
  missing, outside the project, or on disk but not admitted) stay counted, so the result stays partial. Pinned by
  N1-28, D6a-1 (compiler-host and `node:fs` spies) and D6a-2.

## Not changed / still open

- D7 (side bug S1): the global name fallback for unresolved non-barrel targets is unchanged (wrong-target edges are
  possible; it never hides a dependant silently).
- The remaining TypeScript analyzer findings (lowercase `export const` has no graph symbol and stays partial; legacy
  mode has no counter; per-member namespace imports) and F2 stay open.
- The Context Pack still drops `kind === "module"` items, so anchors never become Pack symbols (N1-18).
