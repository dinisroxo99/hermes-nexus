# Polyglot Analyzer Provider Layer — Step 2.5

Status: Step 2.5 abstraction complete; **optional sandboxed Serena/Python integration implemented and exercised with real Docker/Pyright**. Disabled unless a trusted immutable local image is configured. The later Impact v2 live service now consumes this same trusted provider path without changing it.

## Historical Step 2.5 verification checkpoint

Implementation checkpoint: `cf5fd59 refactor: consume analyzer providers in task context`.
The complete suite passes 306 tests, with zero failures/skips; npm run check and
git diff --check pass. Explicit syntax checks pass for 14 changed JavaScript
files. Final targeted independent review found no remaining security or logic
errors. External tests use labelled protocol fixtures, not an installed LSP or
proof of Python/Go/Rust/Java/Bash/PowerShell semantic analysis.

## Ownership and compatibility

```text
Project Intelligence / Task Context Pack / Impact v2
                         |
                AnalyzerProvider contract
                         |
           +-------------+------------------+
           |             |                  |
     native .NET    native TS/JS    optional external evidence
                                         |
                              optional sandboxed Serena/Python
```

Project Map owns project identity, authorized source collection, revision association, ICM, Context Packs and cache policy. Git remains revision/content truth. External analysis is derived, untrusted evidence, not a second canonical project index. No provider owns Hermes tasks, agents, model routing or execution.

The existing .NET and TypeScript implementations are retained and wrapped, not replaced. Their snapshot-only extension filters now recognize accepted uppercase suffixes without renaming paths. Legacy filesystem detection, UI/graph operations, existing impact behavior and caches retain their APIs. Higher-level bounded consumers use `analyzeContextSources` / `analyzeProviderSnapshot`, not concrete analyzers. `getAnalyzerCapabilities` remains the legacy API; `getAnalyzerProviderCapabilities` provides normalized capability discovery.

Node.js is a project classification, not a separate analyzer identity. Projects
detected as `nodejs` remain reported as `projectType: "nodejs"`, including in
overview responses, but graph/search/context/expand route through the existing
native TypeScript/JavaScript analyzer. Node.js overview reports `supported: true`
because that analyzer is available; no `native.nodejs` provider was added.

## AnalyzerProvider contract

Descriptors contain only:

- `id`, `version`, `kind` (`native` or `external`), integer `priority`;
- sorted, unique `languages`;
- explicit capability levels: `unsupported`, `structural`, or `semantic`.

Operations are `boundedSourceAnalysis`, `detection`, `symbols`, `definitions`, `references`, `dependencies`, `implementations`, and `diagnostics`. Missing entries normalize to unsupported. No function, module, command, URL or arbitrary executable callback is accepted as an external descriptor. Unknown fields and duplicate provider IDs fail validation. Descriptors and capability maps are frozen.

`createProviderSnapshot(project, sourceFiles, revision)` receives an **already authorized** Project Map project and bounded source observation. It is not a registry resolver or authorization substitute. The snapshot contains safe revision fields, detected languages, immutable relative-path source records and a deterministic token binding projectId, revision/worktree evidence and file digests. Native-only legacy internal callers may omit projectId; external requests require it. This does not create another project identity or whole-worktree dirty fingerprint.

`analyzeProviderSnapshot(project, sourceFiles, options)` returns schema version 1 with:

- `success`, `status`: available, partial, unsupported or unavailable;
- selected `provider` descriptor, or null;
- `snapshotToken`, detected/covered/uncovered languages, bounded attempt statuses;
- normalized `nodes`, `edges`, `definitions`, `implementations`, `diagnostics`;
- `limited` and a compatibility `projectType` hint.

Use coverage/languages and capabilities—not the compatibility projectType hint—to drive new consumers. Nodes have provider/project-scoped opaque IDs, label, kind, relative file and nullable source line. Edges use those IDs and imports/uses/references relationships. Definition/implementation records pair a symbol ID with a validated target location. Locations use **1-based lines and UTF-16 columns**. Compiler diagnostics are distinct from provider attempt/failure status; native providers do not claim compiler diagnostics.

## Selection and fallback

Default order:

1. Native .NET, priority 200.
2. Native TypeScript/JavaScript, priority 190.
3. Configured external providers, priorities 0–100, then ordinal ID tie-break.

Eligibility uses observed languages, optional `requiredLanguages`, `requiredCapabilities` (default symbols), and `minimumLevel` (default structural; semantic can be required). Bounded-source support is mandatory. Discovery and selection are deterministic regardless of descriptor insertion order.

Select the first usable result. An available **partial** result remains selected with explicit uncovered languages; there is no automatic graph union. Unsupported, unavailable, malformed or failed candidates permit fallback. A caller needing Python in a mixed project can request `requiredLanguages: ["python"]` rather than implicitly accepting a native C# graph. No provider names need to be hard-coded in the consumer.

Each result belongs to exactly one provider/version/snapshot. IDs from different providers cannot collide through raw-ID reuse. No cross-provider graph stitching, capability inflation, cache reuse, analysis retries or LLM-based analysis is performed. The separately enabled Serena transport launches only the fixed semantic sandbox described below.

## Language/capability matrix

Native abilities are always available; the Python row requires the separately built and enabled optional image. Other language rows are not promises of server support.

| Observed language | Default provider | Symbols | References/import dependencies | Precise definitions | Implementations | Compiler diagnostics |
|---|---|---|---|---|---|---|
| C# / .NET | native.dotnet | structural | structural | unsupported | unsupported | unsupported |
| TypeScript | native.typescript | structural | structural | unsupported | unsupported | unsupported |
| JavaScript / JSX / Node.js | native.typescript | structural | structural | unsupported | unsupported | unsupported |
| Python | optional external.serena-python | semantic | semantic references; dependencies unsupported | semantic | unsupported | unsupported |
| Go | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| Rust | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| Java | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| Bash | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| PowerShell | none | unsupported | unsupported | unsupported | unsupported | unsupported |

Native AST/regex extraction remains useful but is not full compiler/LSP semantic accuracy. JavaScript/Node.js evidence does not fully model CommonJS `require()` relationships, and `.mjs`/`.cjs` coverage remains limited or unsupported where the native analyzer cannot observe it. Source suffix recognition is case-insensitive, while paths retain their exact spelling; detection/observation does not imply semantic support. Bash/PowerShell `.sh`, `.bash`, `.ps1`, `.psm1`, `.psd1` text is now admitted by the existing bounded collector without execution. Other languages require explicit source-policy/detection additions and a capable provider. Legacy filesystem project classification is unchanged. Symbol labels are bounded printable display names, not JavaScript identifiers: names such as `Get-Thing` and qualified names are allowed; control characters and obvious path/URI forms are rejected.

## External boundary: data, not execution

`createExternalSnapshotRequest(snapshot, descriptor)` produces a request with safe project/revision metadata, snapshot token, a request token additionally binding the normalized descriptor, advertised operations, fixed bounds and **only supported-language source files**. It neither sends the request nor materializes files. There is no live filesystem root, Git metadata directory, memory store or transport handle in this DTO.

`readExternalSnapshotResponse(snapshot, descriptor, json, limits)` accepts only a bounded JSON string. The envelope must match schema, projectId, snapshot token, request token, provider ID and version. All evidence is validated before selection:

- relative paths must be exact members of the exported snapshot file set;
- absolute/URI/drive/traversal/absent-file and undeclared-language references fail;
- duplicate symbol IDs, dangling edges and invalid line/column positions fail;
- nonempty operation evidence must match declared capabilities;
- unknown envelope/evidence fields are rejected;
- raw tool messages, commands and filesystem paths are not propagated;
- output ordering is deterministic and public IDs are scoped hashes.

Provider descriptors and response maps are trusted **server-side options**, never accepted from the Task Context Pack HTTP body. JSON evidence itself remains untrusted. This data-only codec does not sandbox arbitrary in-process JavaScript or execute code. The optional Serena transport separately enforces the Docker boundary before invoking its fixed worker.

Bounds: at most eight providers (two native plus six external), 32 languages per descriptor, 128-character IDs, 64-character versions, 2000 graph nodes, 4000 edges, 256 definitions and 256 implementations, 40 compiler diagnostics and a 256 KiB external response. Existing source limits remain 500 files, 128 KiB/file, 4 MiB read budget and descriptor-verified local collection. Lower node/edge limits are applied deterministically. Source observations, responses and normalized results are disposable in-memory data; no external index/database or cache is persisted.

## Task Context Pack integration

Schema 1, existing sections, request shape, identity/revision security and `task-context-v1` selection policy are retained. Additive `analysis` metadata reports provider descriptor/version, capability levels, coverage, snapshot token, attempts and provenance. Provider versioning is separate from the Context Pack selection-policy version.

Symbols/references include provider provenance. Validated external source lines are retained; unknown native positions remain null. Missing analysis is `not_analyzed`, not a proven empty semantic graph. Dependency-only evidence yields partial references, not a claim of reference support. Partial language coverage or missing section operations mark the pack incomplete. External evidence is labelled `untrusted_external_analysis` in the analysis summary, sections and individual symbol/reference items; it cannot override ICM or fixed policy. Definitions/implementations/compiler-diagnostic arrays are available through the provider facade, not new Context Pack sections.

The composer supplies its own current revision after spreading trusted analyzer options, so options cannot replace revision binding. Stale external responses fail token validation after a source/worktree/revision change. Existing source reobservation, project boundary verification, no-store behavior and byte trimming remain active. External transport timing never enters deterministic pack content.

## Implemented optional Serena/Python checkpoint

The branch adds a real Python integration after separate user authorization.
The complete opt-in build/runtime contract and exact dependency/image inventory
are in [`docker/serena-python/README.md`](../../docker/serena-python/README.md)
and [`versions.json`](../../docker/serena-python/versions.json).

Verified suite: **338 passed, 0 failed, 0 skipped** with
`SERENA_DOCKER_TESTS=1 npm test`; npm run check and git diff --check pass.
Real tests cover symbols, cross-file definitions/references, UTF-16 locations,
case-insensitive Python suffixes without renaming, budgets, snapshot/revision/
worktree replay rejection, Context Pack consumption, offline missing Pyright,
timeout/crash/oversize cleanup, PID-1 deadline handling and actual sandbox probes.
Protocol-invalid evidence and missing Docker are also tested without installation.
The active plan records the final implementation checkpoint.

### Exact interface and allowed capabilities

`runSerenaSnapshot(snapshot, { image })` accepts the existing authorized normalized
snapshot, revalidates it and constructs `createExternalSnapshotRequest` internally.
Only the built-in `external.serena-python` descriptor is used (version
`1-f8f53b77-pyright-1.1.403`, priority 50, Python only). Serena source is pinned to
`f8f53b77f04e50aadf9e5789841ec6a95c874514` / `1.7.1.dev0`; Pyright is `1.1.403`,
Python `3.11.13`, Node `22.18.0`. Base images are digest-pinned and wheels/archive
hashes verified at build time. The official broad Serena image is not used.

The bridge calls **Serena SolidLSP directly**, not the SerenaAgent/MCP server.
Fixed semantic operations are document symbols, definitions and references;
server initialization must advertise all three. No edit, shell, memory,
onboarding, project-switching or agent dispatcher is instantiated. Dependencies,
implementations and compiler diagnostics remain **unsupported**, not empty proof.

Request fields retain `schemaVersion`, `projectId`, `snapshotToken`, `requestToken`,
`providerId`, `providerVersion`, `revision`, `operations`, `limits`, `files`.
The additive `observedSourceToken` is SHA-256 of compact JSON sorted
`[relativePath, sha256]` pairs for the exported files. The worker computes it from
mounted bytes before and after analysis, checking each against request text/hash.
Only Python source text enters the container; project configs and dependencies
are not copied. Output is the existing bounded evidence envelope plus this token.
The real transport requires the observation token; legacy data-only fixture
responses can omit it, but any supplied observation token must match.

The response binds project/revision/worktree snapshot, provider ID/version,
descriptor request token and observed source identity. Exact known sandbox URIs
map to paths, then host validation checks membership, UTF-16 source positions,
symbols/IDs, edges and capability claims. Out-of-snapshot targets fail closed.
References originate at the containing symbol or a `<module>` file symbol;
they are references, not an inferred call graph. No provider evidence is merged.

### Image/runtime isolation

- Fixed local `/usr/bin/docker` CLI and daemon socket endpoint; no inherited
  Docker credentials/config or user-selected executable/URL. The socket is used
  by the host CLI only, **never mounted inside the worker**.
- Only a fresh private snapshot directory is bound read-only at `/snapshot`.
  No live repository, `.git`, host HOME, credentials, registry or other projects.
- Network disabled, UID/GID 65532, read-only root, all capabilities dropped,
  no-new-privileges; `/tmp` 64 MiB noexec/nosuid/nodev tmpfs, shared memory 1 MiB.
- 2 CPUs, 1 GiB memory, no extra swap, 64 PIDs, no persistent Docker log.
- Runtime accepts only immutable local `sha256:<64 hex>` image IDs with
  `--pull=never`. No runtime downloads. Fixed Pyright executable override bypasses
  upstream uvx installation; missing assets fail rather than install replacements.
- 30-second host deadline budget, 29-second explicit worker alarm, 256 KiB
  response limit. Named-container force-removal has a separate 2-second budget;
  bounded cleanup retries handle Docker auto-removal races. Failure to clean up
  suppresses evidence. Host filesystem stalls are not a hard-real-time guarantee.

Observed ordinary fixtures finish around two seconds; a 300-symbol fixture is
bounded/partial, and uppercase-only files may wait for a 5-second scan-readiness
hint cap before explicit Python document queries. These measurements verify the
defaults on fixtures, not a promise of complete analysis for every 4 MiB snapshot.

### Enablement, fallback and Context Pack

`SERENA_PYTHON_IMAGE` is trusted project-service configuration, off by default.
The HTTP body cannot supply it or override descriptors, commands, capabilities
or language requirements. Internal callers can pass `serena: { image }` and
`requiredLanguages: ["python"]`; capability discovery accepts the same trusted
opt-in through `getAnalyzerProviderCapabilities([], { serena })`.

Selection stays native .NET, native TS/JS, then eligible externals. A usable
native result never starts Docker; mixed coverage remains partial. Failed Serena
attempts carry sanitized reasons (`unavailable`, `timeout`, `crashed`, `invalid`,
`oversized`, `cleanup_failed`) and permit the next deterministic eligible provider.
Without a usable Python provider, files/documents still work, symbols/references
are `not_analyzed`, and the pack is incomplete. No Python structural fallback is
invented. No service must be running beforehand.

Context Pack schema, sections, identity/revision semantics, reobservation,
no-store/cache policy and external trust labels are unchanged. Definitions remain
provider-facade evidence, not a new pack section. The synchronous transport
preserves existing APIs but can block Node during the bounded request. It is a
local semantic subprocess boundary, not Hermes task/runtime orchestration.

Remaining limitations: no third-party project dependency installation, no `.pyi`
collection expansion, no dynamic-runtime Python accuracy guarantee, no persistent
index/database/cache, no complete DLP or atomic worktree snapshot, and no cleanup
guarantee during daemon outage/host termination. Additional languages require
separate work. Impact v2 now consumes the same native-first, single-provider,
snapshot-bound facade; it does not add provider federation or request-controlled
execution.

## Historical Serena/LSP proposal — superseded by the checkpoint above

The following records the pre-integration Step 2.5 proposal. It is not the current
installation/capability status; diagnostics and implementations were deliberately
excluded from the first real integration.

No Serena executable was found on PATH during this step. Upstream documentation states language-server dependencies may be downloaded automatically; starting the default setup is therefore not a safe, dependency-free addition.

Proposed first integration is **optional local Python only**, with the current native providers unchanged:

1. Approve a separate, non-default sandbox image/service and dependency build. Candidate Serena source pin, retrieved from upstream: `f8f53b77f04e50aadf9e5789841ec6a95c874514`. Its Python adapter pins **Pyright 1.1.403**. Record the resulting immutable image digest and dependency/SBOM lock before enabling it. No floating `main`, unpinned installs or runtime downloads.
2. Add a new `src/analyzers/external/serena-transport.js` and a separate optional deployment recipe. It accepts only `createExternalSnapshotRequest` DTOs from already-authorized Project Map code. It does not accept arbitrary commands, server URLs, project roots or raw MCP requests from HTTP clients.
3. Materialize only exported snapshot files into a fresh private sandbox, never mount the live repository, `.git`, registry, HOME, credentials, other projects or a container socket. Use read-only root/source mounts, bounded private writable temp/cache storage, non-root execution, dropped capabilities and no network egress. Pre-provision approved dependencies in the image; missing packages cause unavailable status rather than installation.
4. Use a fixed read-only semantic tool allowlist. Disable Serena shell execution, editing, project switching, memory read/write and onboarding actions. Permit only negotiated symbol/definition/reference/implementation/diagnostic operations that pass per-language conformance tests. Tool configuration is not the sandbox; the OS/container boundary is mandatory.
5. Map only exact emitted sandbox document URIs back to known snapshot paths. Reject arbitrary returned file URIs, workspace changes, out-of-snapshot targets and references into other projects/host locations. Keep raw server output out of Context Packs. Normalize into this step's JSON envelope and validate again in Project Map.
6. Proposed operational caps: one request-scoped process group, two CPUs, 1 GiB memory, 30-second total deadline and 256 KiB response; terminate and dispose of all per-project state after the request. Measure these caps before enabling more languages. Dependency caches may be image assets; external project indexes/memories must not become persistent truth.
7. Add real-server fixture tests for Python symbols, cross-file definitions/references, diagnostics, capability negotiation, malformed/outside URIs, worktree/revision replay, timeout/crash/oversize responses, disabled network/command/edit/memory tools and native fallback. Test unavailable-server behavior with no installation too. Do not advertise semantic operations until these pass.
8. After separate approval/conformance, add Go/Rust/Java/Bash/PowerShell individually with pinned server/runtime dependencies and explicit capability matrices. Do not infer uniform capabilities from Serena's language list.

Reference sources checked during planning:

- https://oraios.github.io/serena/02-usage/010_installation.html
- https://oraios.github.io/serena/01-about/020_programming-languages.html
- https://github.com/oraios/serena/blob/f8f53b77f04e50aadf9e5789841ec6a95c874514/src/solidlsp/language_servers/pyright_server.py

This proposal is not an installed adapter, an instruction to auto-install dependencies, or authorization to start Impact v2.
