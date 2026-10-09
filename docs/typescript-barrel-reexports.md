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
  (`export * from`, `export * as ns from`, `export { a, b as c } from`, and the type-only forms `export type * from`
  and `export type { T } from`). The type-only forms are accepted because the relation they express is a structural
  type-level dependency, not runtime execution. Local declarations (including local type declarations such as
  `type T = …` or `interface I {}`) and local exports without `from` (`export {}`, `export { x }`,
  `export type { T }`) stay outside the definition. A pure barrel therefore declares nothing, exports nothing of its
  own, imports nothing and runs no side-effect statement.
- Having no recognised graph symbols is **NOT** sufficient: a symbol-less file with a re-export plus anything else
  (a lowercase `export const`, an import, a local `export { x }` or `export {}`, a side-effect statement) is a **mixed barrel** and
  never receives an anchor edge. Files that do not re-export at all (side-effect-only, imports-only, type-only files
  with local `export type { T }` or type declarations) are not barrels.
- A pure barrel has a module anchor (`kind: "module"`, label `<module>`) only under the F1 rule: it has no graph
  symbols and at least one of its re-exports resolves to a file in the snapshot.

Pinned by `tests/typescript-barrel-boundaries.test.js` P-1…P-10 and N1-35 (positives: plain re-export barrels and the
type-only forms `export type { T } from` (P-2) and `export type * from` (P-9); negatives: imports-only, side-effect-only,
mixed barrel with a symbol, four symbol-less mixed barrels, local `export type { T }` and type declarations (P-7), a
local type declaration next to a type-only re-export (P-10), `export {}` plus a re-export (N1-35), and a symbol-less
mixed barrel as Impact target). N1-34 pins the barrel -> barrel guard: an outer barrel re-exporting through a mixed
inner barrel that it does not link is counted, so the inner barrel as Impact target is partial, not silently complete.

## Anchor contract (D11, amends the F1 invariant)

A module anchor is never a name match, never a re-export alias, never in `symbolsByName` or `fileSymbolsByPath`, and
never the target of a symbol import or of symbol resolution through a barrel. The ONLY edges into an anchor are
file-level dependency edges into a PURE BARREL's anchor, snapshot mode only: importer -> pure barrel (`importa barrel`)
and outer barrel -> pure barrel (`re-exporta barrel`). Anchors of every other file (side-effect-only, imports-only,
type-only files without `from` such as a local `export type { T }`, symbol-less mixed barrels, any non-barrel) receive
no edges. Type-only re-export files (`export type * from`, `export type { T } from`) are pure barrels and do receive
them (P-2, P-9).

This replaces the F1 wording "anchors are never import targets" for pure barrels only. Pinned by the F1 tests A-1 and
`g` (unchanged), N1-30, and D11-1…D11-4 (no name match, no symbol resolution, no edge into non-pure-barrel anchors,
exact set of edges into anchors).

## Behaviour

- **Resolution (C, D2):** each named, aliased or default import from a barrel and each re-exported name is resolved
  through the compiler's export table (`getExportedDeclarations`), which follows star chains and cycles, aliases,
  default-as, `export * as ns` and type-only re-exports. Edges go to the defining symbols.
- **Barrel as Impact target (D10):** an importer of a pure barrel gets one edge into the barrel's anchor, and a barrel
  re-exporting from a pure barrel gets one, so Impact with the barrel itself as target reaches its importers.
  A barrel whose only statement is `export { default } from './lib'` is syntactically pure, but the compiler gives it
  its own default export, which the analyzer registers as a regular graph symbol (label `default`), so it has no
  anchor. A default import from such a barrel links the defining symbol in `lib` and also that own `default` symbol
  (as the base did), so Impact finds the consumer with the barrel and with `lib` as target. No anchor is involved, so
  D11 is unchanged; `export { default as x } from` stays an anchored pure barrel (N1-31). Pinned by N1-36 and N1-37.
  The barrel's own `default` symbol is linked only for a `default` binding; nothing else is linked in its place: no
  fallback to the barrel's anchor (N1-38), no default of the defining file for another name (N1-39), no own default for
  a named import (N1-40), no star source's default (N1-41).
  **Residual (A-3):** a barrel that re-exports `default` plus other names (`export { default, helper } from`, or
  `export *` plus `export { default } from`) has its own `default` symbol and so no anchor; a consumer that imports
  only a named binding is not linked to the barrel. Impact with that barrel as target misses the consumer, but the
  import is counted and the result is `partial`, never silently complete (N1-40).
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
- **tsconfig paths (D6a):** the checker runs on the in-memory file system that holds only the snapshot sources
  (`skipFileDependencyResolution`, `noLib`), so an alias resolves only to a file admitted to the snapshot; no host or
  out-of-project file is read. Pinned by N1-28, D6a-1 (compiler-host and `node:fs` spies) and D6a-2.
- **tsconfig reading (snapshot mode only):** the snapshot `tsconfig.json` is read once, by TypeScript's own config
  parser (JSONC: comments, trailing commas, `/*` or `*/` inside strings such as `"include": ["src/**/*.ts"]`), and
  that one reading feeds both the alias resolver and the checker. `extends` is followed only through configs admitted
  to the snapshot (the parse host answers from snapshot entries only; no host reads). `paths` are relative to
  `baseUrl` or to the config that declares them. Each config diagnostic (invalid JSONC or option, an unresolved
  `extends` such as a missing file or a package base, since the snapshot has no `node_modules`, or an `extends`
  cycle) is counted as unrepresented, so the result is `partial`; whatever TypeScript could still read stays in use,
  so the config never silently becomes empty. Legacy analysis keeps its own reader. Pinned by C-1…C-7, C-14, C-15.
- **Alias selection and counting (snapshot mode only):** the `paths` pattern is chosen as TypeScript does (exact,
  then the longest prefix before `*`, ties in tsconfig order) and only that pattern's targets are tried; legacy keeps
  first-match. A specifier that matches a pattern but resolves to no snapshot file is counted, even when the name
  fallback (D7) draws an edge for it, because that edge is not a module resolution. A catch-all `*` pattern therefore
  also counts bare package imports. This counts what the analyzer's resolver cannot resolve; it does not make every
  alias divergence from the compiler visible (see the open gaps below). Pinned by R1-1…R1-4, C-8…C-13.

## Not changed / still open

- D7 (side bug S1): the global name fallback for unresolved non-barrel targets is unchanged. It can draw
  wrong-target edges, and where the analyzer's resolver picks a different file than the compiler (the gaps below),
  Impact can report `available` while missing a dependant.
- Known open resolver gaps (not fixed in N1; can be silently complete):
  - `.js` / `.jsx` specifiers that the compiler maps to `.ts` / `.tsx` sources. Relative specifiers (`./index.js`
    for an `index.ts` barrel) resolve to nothing and are not counted. Alias specifiers in snapshot mode are now
    counted (partial). When both `x.js` and `x.ts` exist, the analyzer links `x.js` while the compiler picks `x.ts`,
    so Impact on `x.ts` can be `available` without the importer.
  - `.d.ts` targets and `baseUrl`-only bare specifiers (no `paths` pattern matches) are not resolved and not counted.
  - The `paths` matcher has no prefix/suffix-overlap length guard (`ab*b` matches `ab`; TypeScript does not).
  - An `export *` whose source contributes no names gets no file edge and no count.
- The remaining TypeScript analyzer findings (lowercase `export const` has no graph symbol and stays partial; legacy
  mode has no counter; per-member namespace imports) and F2 stay open.
- The Context Pack still drops `kind === "module"` items, so anchors never become Pack symbols (N1-18).
