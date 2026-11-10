# Observe Hermes Kanban worker API usage

The optional `nexus-usage-observer` plugin records one minimized event per observed
`post_api_request` in a dispatcher worker. It requires an explicitly configured capture directory.
The default Nexus integration and the default Hermes profile need no changes.

## Install in a selected worker profile

Use a dedicated Linux/WSL directory owned by the account running the worker. From the Nexus checkout,
with `profile_home` and `capture_dir` set to the intended profile and a new absolute directory:

```sh
install -d -m 700 "$capture_dir"
install -d "$profile_home/plugins/nexus-usage-observer"
cp integrations/hermes_usage_observer/{plugin.yaml,__init__.py,events.py,ledger.py} "$profile_home/plugins/nexus-usage-observer/"
```

Add `nexus-usage-observer` to that profile's `plugins.enabled` list. Make
`NEXUS_USAGE_OBSERVER_DIR` available in the selected worker environment with its absolute directory path
before the next plugin discovery. The plugin registers exactly one observation hook and provides no tools.
Choose a new directory when starting a new capture. The profile's operating-system user is the trust boundary.

The hook reads only four native identities (task, session, turn and API request), the caller's canonical
usage buckets and the dispatcher environment's board, task and run ID. These sources remain separate.
Other hook arguments, including the request/response messages, credentials, endpoint URL and model payload,
are excluded. Unavailable usage remains null. Missing individual counters also remain null.
`prompt_tokens` can include cache buckets already counted elsewhere. Preserve the separate dimensions.

## Inspect a selected run

First export a consistent standalone backup of the relevant Hermes board. Run the query from the Nexus checkout:

```sh
python3 -B -m integrations.hermes_usage_observer --directory /private/capture --kanban /exports/board.db \
  --project-id p_example --board default --task-id t_example --run-id 1
```

The query verifies the selected project's native task and run. It checks each selected event's hook session
against the native run's `metadata.worker_session_id`, when present. Hermes writes this field from the
worker session during a terminal tool call. The originating `tasks.session_id` is excluded from that comparison.
The board label is supplied by the worker environment and selected by the operator. The database comparison
does not independently validate a board slug.

Inspect `hookTaskMatchesDispatch` separately from `nativeWorkerSession`. Hermes can generate an effective
task UUID per turn while the dispatcher supplies a Kanban task ID. Matching worker sessions corroborate the
association even though the hook retains its own task namespace. A missing native worker stamp is
`unobserved`, and a different worker session is `differs`. No totals are automatically merged with the
session counters or with accepted project observations.

The spool allows 1,024 request keys, each at most 4 KiB. The query returns up to 128 selected events.
Atomic publication, a private directory lock and fsync preserve whole records across interruption.
A replay of the same session/turn/request and identical fields counts once. Divergent payloads for
that key permanently mark it conflicted and exclude it from query results. Only conflicts whose original
record names the selected board, task and run enter `conflictingKeysForRecordedDispatch`. Capture limits, errors,
disabled hooks and crashes can miss calls. `captureCompleteness` remains `unknown`. File permissions
and matching native metadata do not authenticate a hostile worker that can modify its environment or spool.

## Pinned worker proof

With the pinned Hermes checkout and its Python dependencies available, run:

```sh
python3 -B tests/fixtures/run_usage_observer.py --hermes /path/to/hermes-agent --output /tmp/new-observer-proof
```

The output directory must be new. The fixture uses Hermes revision
`903a57c540917cedd30c7d971938f1af7bdf60e2`, creates a disposable Git project, profile, capture and board,
and calls upstream `dispatch_once` with its default spawner. The fixture selects a controlled child
executable via the native `HERMES_BIN` setting. That child runs the actual upstream `AIAgent` and the
actual plugin discovery, API request hook, and `kanban_complete` tool. Its loopback provider supplies
deterministic tool calls and usage values; no paid model or real user's session is involved.

In the exercised run, two distinct native API request IDs shared one worker session and one effective hook task UUID.
That UUID differed from the dispatcher task ID in both events. Both events matched the run's native worker session stamp.
Each call reported 17 prompt and 3 output tokens. The separately persisted Hermes SessionDB row reported 34 input
tokens, 6 output tokens and 2 API calls. The proof is limited to this fixture and its observed provider calls.

Upstream sources: [dispatcher](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/hermes_cli/kanban_db_dispatch.py),
[response hook](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/agent/turn_response_intake.py),
[canonical counters](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/agent/usage_pricing.py)
and [worker session stamp](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/tools/kanban_tools.py).
