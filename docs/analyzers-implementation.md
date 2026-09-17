# Implementation — Multi-project analyzers

[← README](../README.md) · [Adding projects](./adding-projects.md) · [Execution](./analyzers-execution.md) · [Hermes integration](./hermes-tool-integration.md)

## Purpose

Create a minimal foundation that allows `hermes-nexus` to support multiple project types without breaking the existing .NET support.

The current implementation keeps the public endpoints unchanged and introduces a dispatcher (`analyzer-service`) that selects the appropriate analyzer based on the project type.

## Implemented scope

- Existing support for `.NET` projects is preserved.
- Initial support for `TypeScript` / `React` / `Next.js` projects is included.
- The UI is unchanged.
- The existing .NET analyzer has not been rewritten.
- The contracts of the current endpoints are unchanged.

## Main files

### `src/lib/analyzer-service.js`

Central dispatcher used by the routes.

Responsibilities:

- detect the project type through `detectProjectType(project.absolutePath)`;
- delegate `.NET` projects to `analyzeDotNetProject(...)`;
- delegate `TypeScript` projects to `analyzeTypeScriptProject(...)`;
- expose functions compatible with the existing routes:
  - `analyzeProject(project, options)`;
  - `searchSymbols(project, query)`;
  - `expandNode(project, nodeId, direction)`.

### `src/analyzers/common/analyzer-detection.js`

Simple detection based on files in the project root.

Recognized types:

- `dotnet`: `.csproj`, `.sln`, or `Directory.Build.props`;
- `typescript`: `package.json` with `tsconfig.json` or `.ts` files;
- `nodejs`: `package.json` with `.js`/`node_modules`, but without TypeScript signals;
- `python`: `pyproject.toml`, `setup.py`, or `requirements.txt` with `.py` files;
- `unknown`: fallback.

Project types currently supported by an analyzer:

- `dotnet`;
- `typescript`.

### `src/analyzers/dotnet/dotnet-analyzer.js`

A thin wrapper around the previous code in `src/lib/symbol-index.js`.

It preserves compatibility with:

- `searchSymbolExplorer(...)`;
- `expandSymbolExplorer(...)`;
- `getFullGraphExplorer(...)`.

This file allows the new dispatcher to treat `.NET` as another analyzer without changing the legacy implementation.

### `src/analyzers/typescript/typescript-analyzer.js`

Initial analyzer for TypeScript/JavaScript projects using `ts-morph`.

Current responsibilities:

- locate `.ts`, `.tsx`, `.js`, and `.jsx` files;
- ignore heavy or generated directories:
  - `node_modules`;
  - `.next`;
  - `dist`;
  - `build`;
  - `coverage`;
  - `.git`;
  - `.vscode`;
  - `public`;
- extract symbols:
  - classes;
  - exported functions;
  - interfaces;
  - type aliases;
  - React components named in `CapitalCase`;
  - exported hooks named `use*`;
  - providers with the `Provider` suffix;
- create `nodes` in the format used by the current graph;
- create `edges` from relative internal imports (`./...` or `/...`);
- implement basic search and expansion for TypeScript.

## Node format

The TypeScript analyzer returns nodes compatible with the current graph:

```js
{
  id,
  label,
  kind,
  category,
  namespace,
  projectName,
  layer,
  feature,
  file,
  subtitle
}
```

Main mapping:

- `label`: symbol name;
- `kind`: technical type (`class`, `function`, `interface`, `type`, `component`, `hook`);
- `category`: visual/logical category (`component`, `hook`, `provider`, `service`, `context`, etc.);
- `file`: relative file path;
- `layer`: inferred from the path (`components`, `hooks`, `lib`, `services`, `types`);
- `feature`: first meaningful folder outside common directories.

## Edge format

TypeScript edges follow the shape used by the graph:

```js
{
  id,
  from,
  to,
  relation,
  label
}
```

They currently represent internal imports with:

- `relation: "imports"`;
- `label: "importa"` or `"importa *"`.

## Adapted routes

### `src/routes/explore.routes.js`

The routes remain the same:

- `GET /api/explore/:project/search?q=...`
- `GET /api/explore/:project/expand?nodeId=...&direction=both|in|out`
- `GET /api/explore/:project/full?nodeLimit=500&edgeLimit=1200`

Internal change:

- `search` uses `searchSymbols(...)`;
- `expand` uses `expandNode(...)`;
- `full` tries `analyzeProject(...)` and keeps the direct fallback to `getFullGraphExplorer(...)` for `.NET`.

## Current guarantees

- The UI has not been changed.
- Existing endpoints keep the same paths.
- `.NET` remains supported through the wrapper and fallback to `symbol-index.js`.
- `faturas-backend` still uses the `.NET` path.
- `TypeScript` support is still initial; it is not yet a complete analyzer.

## Known limitations

- The TypeScript analyzer does not yet resolve every import to the true source and destination symbols; the current linking is basic.
- TypeScript detection mainly checks files at the root (`tsconfig.json`, `.ts` files at the root), so it may need improvement for monorepos.
- The TypeScript graph does not yet include function calls, references without a direct import, default exports, or complex reexports.
- The UI does not yet visually distinguish frontend-specific categories.

## Technical next steps

1. Improve internal import resolution to map source file → target symbol.
2. Support `export default`, `export * from`, barrel files, and `tsconfig.paths` aliases.
3. Add dedicated tests for `analyzer-service` and `typescript-analyzer`.
4. Test against a real React/Next.js project.
5. Expose the analysis as a Hermes tool or as a separate MCP/plugin.
