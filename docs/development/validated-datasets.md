# Validated dataset exports

Two offline commands print versioned JSONL to stdout and selection counts to stderr. Neither command creates labels,
runs a model, or starts training. Rows are emitted only after the export finishes validation. A valid input can
yield an empty dataset.

## Project QA

Use a manifest prepared independently of the retrieval run, together with its SHA-256 supplied through a trusted
channel. The digest identifies the exact reviewed bytes. It cannot authenticate a reviewer or establish that a human
approved the examples. Acceptance below requires agreement between that manifest, a separate Git-based check,
and the public Project Expert answer.

```sh
python3 -B -m scripts.nexus_dataset qa --project-id "$PROJECT_ID" --revision "$COMMIT_SHA" \
  --labels /absolute/path/reviewed-labels.json --labels-sha256 "$TRUSTED_LABEL_SHA" > project-qa.jsonl
```

Use the same `PROJECTS_ROOTS` and `DATA_DIR` configuration as `ask-project`. The project must resolve to an exact Git
root with a clean working tree at the selected revision. The manifest has `schemaVersion: 1`, `purpose:
"project_qa_labels"`, `projectId`, `revision` and a `labels` array. Each label has `question` (`symbol` or `history`),
`subject` and `decision` (`accepted`, `rejected` or `ambiguous`). An accepted label also includes:

- `answerSha256`, the SHA-256 of the exact UTF-8 deterministic answer, without an appended newline.
- `citations`, the independently expected ordered evidence. A symbol citation consists of `path` and `blobSha256`
  (SHA-256 of committed file bytes). A history citation also includes `commitSha` and `change` (`added`, `modified`
  or `deleted`). For deletions the hash covers the first parent's pre-deletion blob.

For symbols, a separate syntax-tree walk inventories eligible JS/TS files from commit objects. It accepts one exact
top-level class, function, interface, or type alias. Duplicate declarations, competing variable bindings, parse failures,
and unobservable answers are excluded. For history, the independent check compares first-parent trees using Git
diffs and verifies regular blobs. Completeness, exact answer hash and citations must agree with the public retriever.
The checked-in evaluation projects, their pinned heads, the frozen question/subject combinations and benchmark
fixture paths are held out. Unknown provenance or renamed external copies cannot be identified automatically.
Supply genuinely independent labels and keep evaluation inputs out of the manifest.

Each `validated_project_qa` row contains the structured question, deterministic answer, project/HEAD, citations,
validation method and manifest digest. Explicitly curate the paths and symbols suitable for the intended recipient.
The manifest limit is 256 KiB and 32 labels. Oracle budgets bound the Git file inventory, blob sizes, history depth
and query time. Ambiguous, rejected, stale, incomplete, held-out, and mismatched examples contribute to coverage
counts only. Duplicate labels and invalid input digests fail the export.

## Measured routing observations

```sh
python3 -B -m scripts.nexus_dataset routing \
  --report /absolute/path/paired-report.json --report-sha256 "$TRUSTED_REPORT_SHA" \
  --session-manifest /absolute/path/retained/manifest.json --session-manifest-sha256 "$TRUSTED_SESSION_MANIFEST_SHA" \
  > routing-observations.jsonl
```

The initial adapter supports the [pinned Coder benchmark protocol](paired-hermes-coder-protocol.md) and its exact
fixture, Hermes, engine and model revisions. Retain standalone databases from the runner's `--session-dir` option.
The session manifest maps each exact trial ID to `{"file":"<id>.sqlite","sha256":"..."}` in the manifest directory.
Supply independently trusted artifact digests, including for the manifest.

For each completed trial the exporter matches the task, repeat, arm, fixture revision and prompt digest to the
protocol. It verifies the native DB bytes, reads the named session's model and counters, checks the exact user
message and final assistant response against the workload and recorded answer, reruns the independent benchmark
oracle, and requires its outcome to match the report. Both successes and failures are meaningful routing observations.
The assigned arm and runtime artifact provenance come from the pinned runner report. The native session proves the
recorded prompt, answer and counters. Session counters do not establish that a specific system-prompt projection
was delivered or that an arm is generally preferable.

A `benchmark_routing_observation` row contains the model/engine/protocol hashes, project revision, workload, arm,
session ID, actual integer counters and checked outcome. It contains no prompt, completion, source code or API
credentials. These fixture observations are held-out benchmark measurements, not Project Expert QA examples.
Missing native snapshots, missing counters, unscored executions and inconsistent records yield no row. A report
whose protocol is unsupported cannot be exported. Bounds are 96 rows, 2 MiB per report, 64 KiB per manifest,
64 MiB per DB and 256 MiB of attempted session inputs. Use a private destination for any explicit export.
