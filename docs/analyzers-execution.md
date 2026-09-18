# Execution — Project analyzers

[← README](../README.md) · [Adding projects](./adding-projects.md) · [Implementation](./analyzers-implementation.md) · [Hermes integration](./hermes-tool-integration.md) · [Project ICM](./project-icm.md)

## Purpose

This operational guide explains how to run, validate, and diagnose `hermes-nexus` after the introduction of `analyzer-service` and the initial TypeScript analyzer.

## Prerequisites

- A Node.js version compatible with the project.
- Dependencies installed with `npm install`.
- Projects configured through the effective runtime registry. Today that means human-managed `data/projects.json` plus optional machine-managed `data/discovered-projects.json` when present.
- When running with Docker, the container must include the new dependencies (`ts-morph` and `typescript`).

## Local installation

```bash
npm install
```

The relevant dependencies for the TypeScript analyzer are:

```txt
ts-morph
typescript
```

The canonical `AGENT.md` parser also uses the `yaml` package. Rebuild containers after dependency changes.

## Quick validation

### Syntax check

```bash
npm run check
```

Expected output:

```txt
node --check src/server.js && node --check src/public/app.js && node --check src/public/api-client.js
```

### Tests

```bash
npm test
```

Required result:

```txt
fail 0
```

Use the revision-pinned [current status](CURRENT_STATUS.md), not an older test
count, as the capability baseline. The `be0cb2c` implementation checkpoint reports
306 passed, zero failed and zero skipped. Run the suite in the checkout being
validated and report skips explicitly; `fail 0` alone does not prove full coverage.

### Validate the `analyzer-service` import

Useful for catching ESM path errors before starting the server:

```bash
node -e "import('./src/lib/analyzer-service.js').then(()=>console.log('import ok')).catch(e=>{console.error(e); process.exit(1)})"
```

Expected output:

```txt
import ok
```

## Local startup

```bash
npm start
```

By default, the server uses:

```txt
PORT=8770
```

Health check:

```bash
curl http://localhost:8770/api/health
```

## Running with Docker

Because new dependencies were added, the safest path is to rebuild:

```bash
docker compose up --build
```

If the project uses a bind mount and the dependencies have already been installed inside the container, a restart may be enough. A rebuild is safer because it prevents missing-module errors.

## Main endpoints

### Project Intelligence

```bash
curl "http://localhost:8770/api/intelligence/discover?maxDepth=3&limit=100"
curl -X POST http://localhost:8770/api/intelligence/discover/register \
  -H "content-type: application/json" \
  -d '{"projects":[{"rootId":"default","relativePath":"sample-service"}]}'
curl http://localhost:8770/api/intelligence/projects/<projectName>/overview
```

Discovery is dry-run and non-mutating. Explicit registration writes only `data/discovered-projects.json`, is disabled unless `INTELLIGENCE_REGISTRY_WRITES_ENABLED` is `true`, `1`, or `yes`, validates requested identities against current discovery results, and never writes manual `data/projects.json`.

Overview is cheap and bounded. It reports project identity, stack, architecture, statistics, compact ICM availability/health/count metadata, analysis/cache state, analyzer capabilities, and warnings without returning absolute paths by default or triggering a full analyzer/index run.

The overview `icm` summary is health/count metadata only. It does not return
`AGENT.md` Markdown instructions, contextual document content, executor IDs,
owner/reviewer identities, routing maps, permission contracts or scope patterns.
There is no dedicated ICM or route-task endpoint.

Read-only task context is implemented at
`POST /api/intelligence/projects/:projectId/task-context`, requiring an existing
persisted ID. Step 2.5 adds normalized analyzer-provider evidence and explicit
coverage, not an external tool launcher or runtime guard. Native analysis remains
structural; source retrieval requires Linux/WSL descriptor verification.
See the [Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md)
and [Analyzer Provider Layer](project-intelligence/19_ANALYZER_PROVIDER_LAYER.md)
for exact limits and the implemented opt-in Serena/Python integration.
Its [build/runtime guide](../docker/serena-python/README.md) includes pinned
versions, immutable-image configuration and real Docker test commands. Default
native behavior and legacy graph endpoints remain unchanged.

### List projects

```bash
curl http://localhost:8770/api/projects
```

### Project structure

```bash
curl http://localhost:8770/api/projects/<projectName>/structure
```

### Search symbols

```bash
curl "http://localhost:8770/api/explore/<projectName>/search?q=InvoiceCreationService"
```

For TypeScript:

```bash
curl "http://localhost:8770/api/explore/<projectName>/search?q=Provider"
```

### Expand a node

```bash
curl "http://localhost:8770/api/explore/<projectName>/expand?nodeId=<nodeId>&direction=both"
```

Accepted values for `direction`:

- `both`
- `in`
- `out`

### Full graph

```bash
curl "http://localhost:8770/api/explore/<projectName>/full?nodeLimit=500&edgeLimit=1200"
```

Optional filters:

```bash
curl "http://localhost:8770/api/explore/<projectName>/full?layers=presentation,logic&features=auth,billing"
```

## Diagnosing common errors

### `ERR_MODULE_NOT_FOUND` in `analyzer-service.js`

Typical symptom:

```txt
Cannot find module '/app/src/lib/common/analyzer-detection.js'
```

Likely cause:

- Incorrect relative import from `src/lib/analyzer-service.js`.

Correct paths:

```js
../analyzers/common/analyzer-detection.js
../analyzers/dotnet/dotnet-analyzer.js
../analyzers/typescript/typescript-analyzer.js
```

Validation:

```bash
node -e "import('./src/lib/analyzer-service.js').then(()=>console.log('import ok')).catch(e=>{console.error(e); process.exit(1)})"
```

### Missing dependency in Docker

Symptom:

```txt
Cannot find package 'ts-morph'
```

Fix:

```bash
docker compose up --build
```

Or, inside the correct environment:

```bash
npm install
```

### TypeScript project detected as `nodejs` or `unknown`

Check whether the project root contains at least one of these signals:

- `tsconfig.json`;
- a `.ts` file at the root;
- `package.json` with a recognized JS/TS structure.

Note: the initial detection logic is still simple and may need improvement for monorepos or projects with `tsconfig` files in subfolders.

### Empty TypeScript graph

Possible causes:

- there are no `.ts`, `.tsx`, `.js`, or `.jsx` files outside ignored directories;
- the project only uses default exports or reexports that are not covered yet;
- files are located in ignored paths (`dist`, `.next`, `build`, etc.);
- `nodeLimit` is too low.

## Checklist before confirming that everything is working

1. `npm install` was run in the correct environment.
2. `npm run check` passes.
3. `npm test` passes.
4. `node -e import('./src/lib/analyzer-service.js')` passes.
5. The server starts without `ERR_MODULE_NOT_FOUND`.
6. The existing `.NET` endpoint still responds.
7. The TypeScript endpoint returns nodes when pointed at a real TypeScript project.

## Operational next steps

- Create a small test TypeScript project in `data/projects.json`.
- Validate `search`, `expand`, and `full` against that project.
- Add automated tests to ensure ESM imports and type detection do not regress.
