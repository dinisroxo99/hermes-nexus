# Read Hermes session usage offline

The reader reports persisted Hermes counters for one or two exact session IDs from a standalone SQLite snapshot.
Run it from the Nexus checkout on Linux/WSL with Python 3.11+ and SQLite deserialization support.

```sh
python3 -B -m scripts.nexus_session_usage --input /exports/hermes-state.db --session session-A
python3 -B -m scripts.nexus_session_usage --input /exports/hermes-state.db --session session-A --compare-session session-B
```

## Prepare an input

Supply a consistent SQLite backup/export, or a database closed cleanly by Hermes in a quiescent directory.
When acquiring a snapshot through the owning process, flush queued token accounting before exporting if you need
those writes included. An export can represent only updates committed at its capture time.

A live WAL may contain committed pages that the main file lacks. The importer refuses any accompanying
`-wal`, `-shm` or `-journal`, even if empty. Copying just a live main file away from its WAL can discard
committed rows. A reader of that copy cannot recover or establish its acquisition history.

Input is limited to one regular file of at most 64 MiB. The reader opens directory components and the file without
following symlinks and checks its identity, size, timestamps, parent directory and sidecars across the read.
It deserializes the bounded bytes into a private in-memory SQLite connection. For a checkpointed WAL-mode
main file it adjusts the two SQLite format-version bytes in that RAM copy so SQLite can read it without a WAL.
The original file and directory receive no database writes or SQLite sidecars. Queries have a work budget.

## Interpret the counters

The source is the `sessions` row for each requested ID. The six fields are `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens` and `api_call_count`. The importer reads those
columns only, using the ID to select rows. It never retrieves prompts, messages, raw events, titles, endpoint
URLs or filesystem paths from the database.

- `status: "present"` preserves integer counters and nullable values. A zero is the stored value, which can
  also be a schema default. `positiveTokenCountObserved` distinguishes a positive recorded token count
  from an existing row with no positive token counter.
- `status: "missing"` returns null counters. It differs from a present zero-valued row.
- `comparison.secondMinusFirst` gives arithmetic differences only when both sessions contain a positive
  token observation. A counter missing from either side yields a null difference.
- `projectRevisionBinding: "not_established"` applies to both samples. The supported sessions schema contains
  working-directory, repository-root and branch metadata but carries no authoritative Nexus project ID,
  task identity or commit SHA for these counters. The numbers cannot establish treatment comparability,
  performance impact or token savings.
- These are counters for the selected session itself. Auxiliary work can have separate per-model rows and
  compression can create child sessions. Per-model and per-session accounting can overlap. The importer
  preserves the six dimensions separately and performs no roll-up across models, child sessions or counters.

Each success prints one JSON object to standard output and exits zero, including for missing session IDs.
An input, schema or counter error exits nonzero and returns a short error code to standard error.

## Upstream proof

The schema and accounting behavior were checked against Hermes Agent revision
`903a57c540917cedd30c7d971938f1af7bdf60e2` (schema version 30). A temporary database constructed by its own
`SessionDB` recorded these fixture values:

| Selected session | API calls | Input | Output | Cache read | Cache write | Reasoning |
|---|---:|---:|---:|---:|---:|---:|
| Incremental update | 1 | 120 | 30 | 60 | 15 | 5 |
| Absolute update | 1 | 45 | 25 | 0 | 0 | 4 |

After `SessionDB.close()`, the CLI reproduced both rows from the WAL-mode main file. The upstream auxiliary
accounting call also stored 500 input tokens in the per-model table. Those separate tokens did not enter the
first session row. This was an integration fixture using the real producer, with intentionally supplied
values. It measures no user session or project outcome.

Upstream sources: [schema](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/hermes_state_common.py)
and [usage writer](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/hermes_state_usage.py).
