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

## Ask about validated runs

Set `NEXUS_RUN_HISTORY_STORE` to the absolute path of an operator-managed, populated Nexus run-history store.
The reader selects active Hermes PR-acceptance receipts for the registered project and exact commit. It obtains
the selected checkout's single GitHub `origin` from local Git configuration and compares the owner/repository
to the store's project binding and each receipt. The lookup uses no remote Git operations. HTTPS, standard SSH
and SCP-style GitHub origins are supported. A missing, ambiguous, unsupported or mismatched origin produces an
unavailable result. The local origin is configuration evidence and should be managed by the operator.

```sh
export NEXUS_RUN_HISTORY_STORE=/absolute/path/to/history.sqlite
node scripts/ask-project.mjs --project-id PrJ_Example --validated-history
node scripts/ask-project.mjs --project-id PrJ_Example --symbol OrderService --include-validated-history
```

Use `--task-id` to filter history and `--history-revision FULL_SHA` to inspect a specific acceptance revision.
History-only lookups use Git metadata without running worktree status filters. A `head_commit` match identifies
the checked-out commit and leaves worktree cleanliness unknown. A current source producer that separately
observes local modifications yields `base_of_dirty_working_tree` when combined with that commit's history.
An explicit different revision is labelled `other_revision`. The current query's evidence and
`validatedHistory.historicalEvidence` remain independently inspectable. Run records contain their PR identity,
acceptance and completion event IDs, exact SHA and number of required checks. Empty, unavailable and truncated
results are reported separately. [Offline history ingestion](run-history.md)

## Synthesize with a local model

The optional `--synthesize` switch adds a `synthesis` object while preserving the deterministic answer.
Configure a trusted, operator-run OpenAI-compatible chat service bound to numeric loopback. Nexus accepts a local
port and model alias. The client has a fixed destination, path and deadline and refuses redirects. No API key is
needed. It sends at most twelve short, typed evidence statements and the question class. It never sends raw files,
Git messages, run payloads, prompts from the repository or unrelated Context Pack sections.

The model composes an extractive summary by selecting and ordering up to four evidence IDs. Nexus renders their
verified statements into an answer with citations such as `[C1]` for a project observation and `[H1]` for a
historical receipt. Each citation points to its evidence-array index. Receipts also carry the stable history
evidence ID. Current evidence has priority. A historical success cannot answer a current symbol query that
found no symbol. Arbitrary model prose, unknown IDs, repeats and incomplete generations are rejected.
`synthesis.status` and `warnings` report missing evidence, partial coverage, unavailable inference or invalid
citations. No confidence score is inferred.

### Reproduce the CPU smoke

The tested Linux x86-64 configuration used llama.cpp release `b12230`, Qwen2.5-0.5B-Instruct Q4_K_M and an
8,192-token context. Download the model and runtime into a separate directory. The following commands verify the
tested bytes, start a loopback server, and run a query from the Nexus checkout.

```sh
mkdir -p /tmp/nexus-expert-model
modeldir=/tmp/nexus-expert-model
curl -fL https://github.com/ggml-org/llama.cpp/releases/download/b12230/llama-b12230-bin-ubuntu-x64.tar.gz -o "$modeldir/runtime.tar.gz"
curl -fL https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/9217f5db79a29953eb74d5343926648285ec7e67/qwen2.5-0.5b-instruct-q4_k_m.gguf -o "$modeldir/qwen.gguf"
(cd "$modeldir" && echo 'a57aa1817e135237b3b087a012ccfe17140e440dbe42f51dab1b9dc68499e7c4  runtime.tar.gz' | sha256sum -c -)
(cd "$modeldir" && echo '74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db  qwen.gguf' | sha256sum -c -)
tar -xf "$modeldir/runtime.tar.gz" -C "$modeldir"
engine="$modeldir/llama-b12230"
LD_LIBRARY_PATH="$engine" "$engine/llama-server" -m "$modeldir/qwen.gguf" --alias qwen2.5-0.5b --host 127.0.0.1 --port 18779 -c 8192 -np 1 -t 3 -ngl 0
```

From another terminal in the same network namespace, run:

```sh
export NEXUS_LOCAL_MODEL_PORT=18779 NEXUS_LOCAL_MODEL_ID=qwen2.5-0.5b
node scripts/ask-project.mjs --project-id PrJ_Example --tests-for src/orders.ts --synthesize
```

A CPU smoke on a registered Git fixture at commit `8c172499f3844e843e7d14b1da6f867671e22a6f` selected
`tests/one.test.ts` as a candidate for `src/one.ts` with citation `[C1]`. A separate native Hermes Kanban
fixture used simulated GitHub checks and a real acceptance/completion chain. These are fixture observations.

## HTTP entry point

`POST /api/intelligence/projects/:projectId/ask-project` accepts the same evidence questions. For example:

```json
{"question":"tests","subject":"src/orders.ts","synthesize":true}
```

Allowed question names are `symbol`, `tests`, `impact`, `history` and `validated-history`.
For historical queries, `taskId` and `historyRevision` can narrow the result. Set `includeHistory` to combine
a current-source question with a validated historical lookup. The registry, SQLite store and local model
configuration belong to the server. The HTTP handler admits one model synthesis at a time and returns
429 for another concurrent request. Deterministic questions continue to work while that slot is occupied.
