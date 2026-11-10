# Nexus operational verification

`GET /api/health` reports process liveness. `GET /api/ready` returns 200 when all configured roots and
the data directory are accessible, the registries are usable together and both native analyzer providers
are registered. A missing registry is an empty registry. A corrupt, oversized or inconsistent registry
returns 503. Readiness reports fixed labels without filesystem paths, and does not run a model or analyze a
project. Use a project probe to also exercise normal source resolution.

## Observe a running service

From the Nexus checkout:

```bash
python3 -B -m scripts.nexus_operations --url http://127.0.0.1:8770 \
  --duration-seconds 86400 --interval-seconds 300 --project-id PrJ_Example \
  --checkpoint /path/to/operator-dir/nexus-soak.json
```

With no duration the command takes one sample. A project ID adds one bounded Context Pack lookup per sample.
Pass `--pid PID` on Linux to sample RSS and CPU time from an explicitly selected local process. Sampling
detects health/readiness failures, uptime resets, context lookup failures and excessive observation gaps.
Partial Context Packs have their own count. The checkpoint shows `in_progress` until the window actually
elapses; `healthy` or `degraded` describes only the probed Nexus service and interval. The result does not
measure Hermes gateway, Kanban workers, GPU queues or Honcho uptime unless a separate service observation is configured.

On Linux with `CLOCK_BOOTTIME`, the collector includes time spent suspended in the observation
window, the maximum gap between sample starts and the longest individual sample. During a timed
run, either measurement exceeding the interval by more than five seconds degrades the report. Process uptime comparisons use a separate clock so a suspension alone does
not count as a service restart. On systems without this clock, suspend coverage is unverified.

### Collect a full window on a persistent Linux host

Use an already-running isolated Nexus service on the same persistent host, with its registered
test project. Set `NEXUS_URL`, `NEXUS_PID` and `NEXUS_PROJECT_ID` to that instance's numeric
loopback origin, Node process ID and project ID. Run from the checkout containing this collector.
The user systemd manager and the service must remain available after the shell disconnects.

```bash
(
  set -eu
  : "${NEXUS_URL:?}" "${NEXUS_PID:?}" "${NEXUS_PROJECT_ID:?}"
  attempt=$(mktemp -d -- "${PWD}/../nexus-soak.XXXXXXXX")
  systemd-run --user --collect --unit=nexus-isolated-soak --property=Type=exec \
    --working-directory="$PWD" "$(command -v python3)" -B -m scripts.nexus_operations \
    --url "$NEXUS_URL" --pid "$NEXUS_PID" --project-id "$NEXUS_PROJECT_ID" \
    --duration-seconds 86400 --interval-seconds 300 --checkpoint "$attempt/checkpoint.json"
  echo "$attempt/checkpoint.json"
)
```

The fixed unit name rejects a second launch while the collector is running. Each new attempt
gets its own directory. Retain the service revision and project ID with that attempt. Inspect
the terminal checkpoint for `status`, `startedAt`, `endedAt`, `elapsedSeconds`, sample count,
maximum gap, longest sample and failure counters. For the command above, a healthy full window needs at least
86,400 elapsed seconds, at most 305 seconds for each gap and sample, complete PID coverage and successful
probes. An `in_progress` checkpoint after the unit stops is an interrupted observation. Start
a fresh window on an available host.

A 180-second rehearsal on a disposable registered clone of Nexus issued seven project probes. All seven
resolved the project and returned partial packs, with zero liveness/readiness failures or uptime resets.
The observed peak RSS was 603,815,936 bytes and the selected process used 13.88 CPU-seconds between samples.
These figures include the project probes. The test suite also kills the isolated service, restores its
registry and checks that a fresh service resolves the same project.

## Back up and restore

Close writers or prepare a standalone database snapshot first. These commands require Linux/WSL, Node,
Python 3.12 and a filesystem supporting atomic no-replace rename. The destination and archive paths
are operator-selected. Keep the resulting digest independently of the archive.

```bash
python3 -B -m scripts.nexus_recovery backup --data-dir /operator/nexus-data \
  --history-store /operator/history.sqlite --output /operator/backups/nexus.zip
python3 -B -m scripts.nexus_recovery restore --archive /operator/backups/nexus.zip \
  --sha256 SAVED_SHA256 --destination /operator/restored-nexus
```

The allowlist comprises `projects.json`, `discovered-projects.json` when present and the optional validated
history database. Backup samples its inputs twice. Native Hermes databases, secrets, model weights, Git
repositories and uncommitted worktrees have their own backup procedures. Registry validation uses the same
project normalization and identity rules as readiness. The history database must match the store version
and schema and pass an in-memory SQLite integrity check. A standalone WAL-mode database can be normalized
in the private copy for recovery. The inputs remain untouched.

Restore verifies the independent digest, exact member names, size limits, per-member hashes and semantics
before atomically publishing a new directory. An abandoned private staging directory can remain after a
crash; the final destination stays absent until publication. A retry can use the same final name. A pre-existing
destination is never overwritten.

In the native-history rehearsal, restoring `projects.json` and `history.sqlite` recovered the same project
and active receipt. Task `t_257a0147`, run 1, acceptance event 3 and completion event 4 survived the round trip.
That fixture used the pinned Hermes lifecycle with simulated GitHub responses. A separate real-repository
validation is required before promoting any production deployment.

### Additional fleet observations

Use `--components /operator/health-rules.json` to sample existing, read-only JSON readiness endpoints
on the same host during the same window. For a llama.cpp server configured at port 8080, for example:

```json
{"inference":{"url":"http://127.0.0.1:8080/v1/models","field":["data",0,"id"],"equals":"local-qwen"}}
```

Configure each installed endpoint's actual port, field and expected value. Accepted component labels are
`gateway`, `dispatcher`, `inference`, `memory` and `history`. Requests require a numeric loopback address
and have a wall deadline. Redirects, credentials and query strings are excluded. Only failure counts are
stored. A model listing checks availability without generating a completion. A successful component
assertion is evidence for that endpoint. A standalone probe observed the expected model ID from a real local llama.cpp server serving Qwen2.5-0.5B. Task recovery and model correctness have their own tests.
