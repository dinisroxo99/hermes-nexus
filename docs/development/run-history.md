# Validated run history

Nexus synchronizes a selected project from a trusted, standalone Hermes Kanban SQLite snapshot. Its separate local
store keeps minimized observations of the project’s attempts. An operator can also import a single task explicitly. An active observation establishes that Hermes recorded
a terminal completion and a successful PR acceptance at one exact GitHub commit. Code review, human approval,
current branch status, and the token usage of that attempt require their own evidence.

## Synchronize a project on publication

```sh
python3 -B -m scripts.nexus_run_history sync --kanban /data/published/board.sqlite \
  --store /data/nexus/history.sqlite --project-id p_12345678
```

`sync` selects the named native project's tasks, runs and events. It opens one stable image,
uses the single-task receipt validator and publishes the local store at most once per command.
The source database is never opened for writing. The selected project's latest completely
validated native event ID is the durable checkpoint. Each task also retains its own validated
watermark and history prefix.

- Completed identical publications return `unchanged_publication`. The importer fingerprints the
  admitted standalone file and skips querying its rows on this path. A different image revalidates
  the named project, including previously accepted prefixes, so an edit at an existing event ID
  cannot silently substitute different evidence. It never selects another project's payloads.
- Earlier event history returns `older_snapshot` without reactivating prior outcomes. New tasks,
  subsequent attempts, and reopened or superseded completions are reflected after the next publication.
- A malformed selected task returns a `partial` report and exit 2. Valid tasks from the same
  publication commit together. The failed task is marked pending, its prior active evidence is
  withheld from queries/export, and the complete project checkpoint stays put. Publish a corrected
  snapshot and rerun. `inspect` preserves prior attempts and shows `syncPending`. The command
  reports up to 32 task errors; the full failure count is in `failed`.
- A source read, schema, capacity or transaction failure exits 1. Retry after addressing the
  reported error. Abrupt interruption before publication leaves the previous store readable.
  Successful synchronization exits 0.

Project-wide limits are 2,000 tasks, 10,000 runs and 65,536 events per published image, in addition
to the existing per-task limits. Capacity or SQL read-budget exhaustion refuses the batch.
The store accepts exact schema versions 1 and 2. Reading or restoring version 1 preserves it.
The next successful write migrates it transactionally to version 2, which adds the project
checkpoint and pending-task records. Recovery validates the complete schema before accepting either version.

### Drive the command from Hermes

Hermes owns the events. Its ordinary task claim and PR completion paths must first commit the
native `created`, `claimed`, `pr_acceptance` and `completed` evidence. Configure the native
completion contract for the task's real PR. Publishing or synchronizing an image cannot generate
an acceptance receipt, approve a PR, or validate a GitHub check.

After the relevant native transaction commits, an operator-controlled publisher can use an
already-open source SQLite connection to publish an immutable image and invoke the command. Run
the following from the Nexus checkout with `conn` supplied by the publisher, a trusted private
publication directory, and absolute paths. This example does not require a persistent watcher.

```python
import os
from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile

def publish(conn, publication, store, project_id):
    publication = Path(publication)
    fd, filename = tempfile.mkstemp(dir=publication.parent, prefix=".board-")
    os.close(fd)
    try:
        with closing(sqlite3.connect(filename)) as output:
            conn.backup(output)
            output.execute("PRAGMA journal_mode=DELETE")
        with open(filename, "rb") as stable:
            os.fsync(stable.fileno())
        os.replace(filename, publication)
        parent = os.open(publication.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        Path(filename).unlink(missing_ok=True)
    subprocess.run([sys.executable, "-B", "-m", "scripts.nexus_run_history", "sync",
                    "--kanban", str(publication), "--store", str(store),
                    "--project-id", project_id], check=True)
```

Use one invocation per selected project after publication. The publisher can also trigger a
one-shot service when it atomically replaces the image. No scan, timer or loop runs while idle.
Never copy only the main file of a live WAL database. An image with a journal or sidecar is refused.

## Import and retrieve

Supply an absolute path to a standalone backup produced with the SQLite backup API, a local store in a trusted
directory, and the native Hermes project and task IDs.

```sh
python3 -B -m scripts.nexus_run_history ingest --kanban /data/board-backup.sqlite \
  --store /data/nexus-history.sqlite --project-id p_12345678 --task-id t_abc12345
python3 -B -m scripts.nexus_run_history inspect --store /data/nexus-history.sqlite \
  --project-id p_12345678 --task-id t_abc12345
python3 -B -m scripts.nexus_run_history query --store /data/nexus-history.sqlite \
  --project-id p_12345678 --revision "$COMMIT_SHA" --limit 20
python3 -B -m scripts.nexus_run_history correlate-session --store /data/nexus-history.sqlite \
  --project-id p_12345678 --revision "$COMMIT_SHA" --task-id t_abc12345 --sessions /data/session-backup.sqlite
python3 -B -m scripts.nexus_run_history export --store /data/nexus-history.sqlite \
  --project-id p_12345678 --revision "$COMMIT_SHA" > outcomes.jsonl
```

`inspect` shows the observed attempts including candidate, rejected and superseded evidence. `query` returns active
outcomes for exactly the supplied project and revision. An optional `--task-id` narrows it further. The response
includes the GitHub repository bound to the project, including when a specific revision has no matching rows.
`export` writes one version-1 `verified_pr_check_outcome` JSON record per active outcome in deterministic task/run order.
`correlate-session` derives the origin session ID from the active outcome and checks for that exact row in the supplied
standalone session snapshot. It reports its role and presence without attributing session-wide tokens to the run.
An empty export writes zero lines. Failures exit 1 with a bounded diagnostic code on stderr.

## Source and quality rules

The compatible upstream schema and producer are pinned at
[Hermes 903a57c](https://github.com/NousResearch/hermes-agent/tree/903a57c540917cedd30c7d971938f1af7bdf60e2).

- The native task row and its single creation event must both name the requested project. The first verified PR
  binds that project ID to a GitHub repository. Later verified receipts for another repository are refused.
  Distinct projects can have the same local run number or task ID.
- Each receipt identifies the selected task and native attempt. The event sequence must contain a claim, then a
  successful `pr_acceptance`, then a terminal `completed` event. The run must have ended with `done/completed`.
  The receipt must match the task’s exact PR contract. Its required contexts and successful check entries must
  cover the same names, all selected checks must report success at the receipt head, and at least one check must
  be required. Hermes performs the source GitHub lookup and pins check publishers when its contract requires them.
  [Receipt producer](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/hermes_cli/kanban_pr_acceptance.py)
- `originSessionId` comes from `tasks.session_id`, which identifies the originating session and may be absent.
  This relationship does not establish which worker produced later tokens. Read measured session counters separately
  using [session usage](session-usage.md). Free-text summaries and run metadata cannot promote an observation.
- Among validated completions only the latest native attempt of a currently done task is active as of the imported
  snapshot. A reopened task or later attempt supersedes its old success. No current-state guarantee is implied by
  an offline copy. Ingest subsequent snapshots after native lifecycle changes.
- The store relies on the authenticity of the supplied Hermes snapshot and the local store. It records native
  machine-produced acceptance evidence without contacting GitHub. It does not authenticate a database supplied
  by an untrusted party. Exported items describe accepted run outcomes, not training labels for unrelated answers.

## Bounds, retries and storage

An import uses one in-memory SQLite transaction. On Linux/WSL, the reader opens directory components and the source
by descriptor without following symlinks. Writers serialize with a directory lock, then fsync and atomically replace
the standalone store entry. The SQLite engine never opens the supplied store pathname or creates a journal beside it.
Readers see one bounded committed image. Keep the store in a trusted directory and use the importer as its sole writer. The task’s latest native event ID is its watermark. A matching retry
writes no logical change. An older snapshot cannot reactivate old outcomes. Newer snapshots must retain the
previously observed prefix of minimized native events and all prior run IDs. Divergent history is refused.
Stored fields include stable evidence ID, project/task/run IDs, origin session ID, revision, repository/PR,
terminal state, event IDs and required-check count. The prefix fingerprint omits comments, prompts, tool payloads,
file paths, check names and free-text results.

The source reader admits regular standalone snapshots up to 64 MiB with no SQLite sidecars. Each task is bounded
to 64 runs and 512 events, and selected JSON payloads to 65,536 characters. The store is capped at 32 MiB, 2,000 tasks
and 10,000 attempts. Bounds refuse an incomplete import and preserve earlier transactions. Queries return up to
50 active observations, report truncation and default to 20. The export has the store-wide attempt cap.
Create a consistent backup via SQLite’s backup API before rotating a store. Restore the backup into a trusted
directory and use `query` or `inspect` to verify its contents.

## Native integration proof

The normal tests use small SQLite fixtures for isolation, retries, ordering, independent validation, tampering and
bounded storage. A second fixture runs the upstream code itself. In an environment with the pinned checkout’s
dependencies, supply a fresh output directory and optionally a known fixture commit.

```sh
python3 -B tests/fixtures/make_hermes_run_history.py --hermes /checkout/hermes-agent \
  --output /tmp/new-hermes-history-proof
```

Pass `--tasks 3 --other-project` to generate three selected tasks plus an unrelated task in a second
project. Use the emitted `projectId` with `sync`; only the three selected outcomes should be available.

The fixture creates an upstream session and project and calls Hermes create, claim and complete operations. It
substitutes deterministic responses only for GitHub network transport and uses Hermes’s real acceptance
classifier and transactional event writer. It emits `board.db` (the standalone snapshot) and `fixture.json`
(native IDs and expected head). The upstream proof demonstrates schema compatibility and producer behaviour with
simulated GitHub responses. It supplies no evidence about a production project or live PR.
