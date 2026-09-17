# Polyglot Analyzer Provider Layer — Step 2.5

Status: implemented abstraction and data-only external boundary. Serena/LSP execution is **not installed or integrated**. Impact v2 remains not started.

## Verification checkpoint

Implementation checkpoint: `cf5fd59 refactor: consume analyzer providers in task context`.
The complete suite passes 306 tests, with zero failures/skips; npm run check and
git diff --check pass. Explicit syntax checks pass for 14 changed JavaScript
files. Final targeted independent review found no remaining security or logic
errors. External tests use labelled protocol fixtures, not an installed LSP or
proof of Python/Go/Rust/Java/Bash/PowerShell semantic analysis.

## Ownership and compatibility

```text
Project Intelligence / Task Context Pack / future Impact v2
                         |
                AnalyzerProvider contract
                         |
           +-------------+------------------+
           |             |                  |
     native .NET    native TS/JS    optional external evidence
                                         |
                              future sandboxed Serena/LSP
```

Project Map owns project identity, authorized source collection, revision association, ICM, Context Packs and cache policy. Git remains revision/content truth. External analysis is derived, untrusted evidence, not a second canonical project index. No provider owns Hermes tasks, agents, model routing or execution.

The existing .NET and TypeScript implementations are retained and wrapped, not replaced. Their snapshot-only extension filters now recognize accepted uppercase suffixes without renaming paths. Legacy filesystem detection, UI/graph operations, existing impact behavior and caches retain their APIs. Higher-level bounded consumers use `analyzeContextSources` / `analyzeProviderSnapshot`, not concrete analyzers. `getAnalyzerCapabilities` remains the legacy API; `getAnalyzerProviderCapabilities` provides normalized capability discovery.

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

Each result belongs to exactly one provider/version/snapshot. IDs from different providers cannot collide through raw-ID reuse. No cross-provider graph stitching, capability inflation, cache reuse, retries, process launching or LLM-based analysis is performed.

## Language/capability matrix

These are **installed native abilities**, not promises about future server support.

| Observed language | Default provider | Symbols | References/import dependencies | Precise definitions | Implementations | Compiler diagnostics |
|---|---|---|---|---|---|---|
| C# / .NET | native.dotnet | structural | structural | unsupported | unsupported | unsupported |
| TypeScript | native.typescript | structural | structural | unsupported | unsupported | unsupported |
| JavaScript / JSX | native.typescript | structural | structural | unsupported | unsupported | unsupported |
| Python | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| Go | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| Rust | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| Java | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| Bash | none | unsupported | unsupported | unsupported | unsupported | unsupported |
| PowerShell | none | unsupported | unsupported | unsupported | unsupported | unsupported |

Native AST/regex extraction remains useful but is not full compiler/LSP semantic accuracy. Source suffix recognition is case-insensitive, while paths retain their exact spelling; detection/observation does not imply semantic support. Bash/PowerShell `.sh`, `.bash`, `.ps1`, `.psm1`, `.psd1` text is now admitted by the existing bounded collector without execution. Other languages require explicit source-policy/detection additions and a capable provider. Legacy filesystem project classification is unchanged. Symbol labels are bounded printable display names, not JavaScript identifiers: names such as `Get-Thing` and qualified names are allowed; control characters and obvious path/URI forms are rejected.

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

Provider descriptors and response maps are trusted **server-side options**, never accepted from the Task Context Pack HTTP body. JSON evidence itself remains untrusted. This interface does not claim to sandbox arbitrary in-process JavaScript; no external code runs here at all. A future transport must enforce a real process/filesystem/egress sandbox before invoking a server.

Bounds: at most eight providers (two native plus six external), 32 languages per descriptor, 128-character IDs, 64-character versions, 2000 graph nodes, 4000 edges, 256 definitions and 256 implementations, 40 compiler diagnostics and a 256 KiB external response. Existing source limits remain 500 files, 128 KiB/file, 4 MiB read budget and descriptor-verified local collection. Lower node/edge limits are applied deterministically. Source observations, responses and normalized results are disposable in-memory data; no external index/database or cache is persisted.

## Task Context Pack integration

Schema 1, existing sections, request shape, identity/revision security and `task-context-v1` selection policy are retained. Additive `analysis` metadata reports provider descriptor/version, capability levels, coverage, snapshot token, attempts and provenance. Provider versioning is separate from the Context Pack selection-policy version.

Symbols/references include provider provenance. Validated external source lines are retained; unknown native positions remain null. Missing analysis is `not_analyzed`, not a proven empty semantic graph. Dependency-only evidence yields partial references, not a claim of reference support. Partial language coverage or missing section operations mark the pack incomplete. External evidence is labelled `untrusted_external_analysis` in the analysis summary, sections and individual symbol/reference items; it cannot override ICM or fixed policy. Definitions/implementations/compiler-diagnostic arrays are available through the provider facade, not new Context Pack sections.

The composer supplies its own current revision after spreading trusted analyzer options, so options cannot replace revision binding. Stale external responses fail token validation after a source/worktree/revision change. Existing source reobservation, project boundary verification, no-store behavior and byte trimming remain active. External transport timing never enters deterministic pack content.

## Exact Serena/LSP integration proposal — approval required

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
