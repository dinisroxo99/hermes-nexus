# Ask about the current project

From the service checkout, look up an exact symbol name in a registered project:

```sh
node scripts/ask-project.mjs --project-id PrJ_Example --symbol OrderService
```

Use the persisted project ID from the manual or discovered registry. The command reads the service's existing
`DATA_DIR` and `PROJECTS_ROOTS` configuration. It works without a running HTTP server. Provider selection follows
the Context Pack configuration, including an optional configured local Serena image.

For a linked Git worktree, supply its directory relative to its configured root. `--root-id` defaults to `default`.

```sh
node scripts/ask-project.mjs --project-id PrJ_Example --symbol OrderService --worktree feature-checkout --root-id dev
```

## Impact and candidate tests

Ask about a file using its exact repository-relative path. Each answer is built from one fresh Impact response.

```sh
node scripts/ask-project.mjs --project-id PrJ_Example --tests-for src/orders.ts
node scripts/ask-project.mjs --project-id PrJ_Example --impact-of src/orders.ts
```

The JSON contains the question, a short answer, the observed source, revision and snapshot token, the
producer status and completeness reasons, and the retained evidence for each path. Test matches are
candidates. An empty result describes only the observed graph within the reported budgets.
The CLI uses deterministic templates and executes locally without model credentials.

## Committed file history

```sh
node scripts/ask-project.mjs --project-id PrJ_Example --history-of src/orders.ts
```

The history question examines the selected checkout's first-parent Git history and returns commit IDs for
changes at the exact project-relative pathname. It reports the revision, evidence and scan limits. Follow
the returned commit IDs to inspect a change. Working-tree modifications, history under a previous name
and the outcomes of prior agent runs are outside that observation.

## Read a symbol result

Standard output contains one JSON object. A successful lookup exits with status zero, including an unknown result.
Invalid arguments, missing projects and worktree validation errors exit with status one and write a JSON error to
standard error.

- `outcome: "located"` means at least one retained, case-sensitive provider symbol matched. Each evidence item
  carries its project-local path, symbol ID, kind and source SHA-256. Per-item provenance identifies the provider
  and its trust classification. `line: null` means the provider supplied no verified line.
- `outcome: "unknown"` means this Context Pack returned no exact-name match. Source collection, provider language
  coverage, symbol extraction and response limits all affect what can be observed.
- `observation.incomplete`, `coverage.symbolsTruncated`, `coverage.languages`, and `coverage.diagnosticCodes`
  describe limits on retrieval. A result can contain matches while still having partial coverage. The current
  Context Pack permits at most 64 symbol items and 128 KiB across its sections.
- `revision`, `snapshotToken`, `contextPackId` and `observation.sourceDigest` identify the evidence. Sources come
  from the working tree. When `revision.dirty` is true, its commit SHA identifies the base commit and the source
  hashes identify the observed content. Query again after a change for a fresh observation.

This operation covers the current-code location question in the Project Expert roadmap. The returned evidence
comes exclusively from the selected project's Context Pack.
