# Paired Hermes development benchmark

This local pilot compares a Hermes agent with one read-only fixture tool against the same agent with a revision-bound
Nexus evidence projection added to its system turn. The comparator uses the real Context Pack and Impact producers.
Both arms receive the same task prompt, model, tool schema, starting repository and generation settings. The agent
runs through the pinned Hermes conversation loop and persists a separate native SQLite session for every run.

## Observed run on 9 November 2026

The six pairs produced 12 real Hermes sessions on fixture commit `0894ac84d787d907bec32f1d76e0797fdd233b7a`.
Neither arm returned the required valid JSON in any of its six runs. The Nexus arm hit the four-call iteration
limit three times. In a secondary check added after observing the runs, both baseline test-selection answers
mentioned the exact expected test in prose. Neither Nexus test-selection answer did. This diagnostic checks file
mentions only and does not count as a passing task.

| Repeat | Task | Prompt tokens, baseline / Nexus | Output tokens, baseline / Nexus | API calls, baseline / Nexus | Seconds, baseline / Nexus |
| --- | --- | --- | --- | --- | --- |
| 1 | local-fix | 5853 / 6283 | 51 / 57 | 2 / 2 | 27.849 / 13.43 |
| 1 | impact | 5839 / 6269 | 54 / 47 | 2 / 2 | 12.609 / 19.649 |
| 1 | tests | 5826 / 12775 | 45 / 102 | 2 / 4 | 9.352 / 18.604 |
| 2 | local-fix | 5862 / 6283 | 80 / 57 | 2 / 2 | 13.568 / 14.234 |
| 2 | impact | 5839 / 12838 | 54 / 100 | 2 / 4 | 12.533 / 22.993 |
| 2 | tests | 5826 / 12775 | 45 / 102 | 2 / 4 | 10.309 / 28.842 |

Nexus increased canonical prompt usage in every pair. The median increase was **3,689.5 tokens**,
with a range of 421 to 6,999. Median paired wall time increased by
8.146 seconds. The three evidence projections took 1.273 seconds
to build together. These results provide no evidence of better task completion or token savings for this model,
fixture and integration.

Canonical prompt tokens are the sum of Hermes's native `input_tokens`, `cache_read_tokens` and `cache_write_tokens`.
The per-session counters, model answers, exit reasons, model/engine fingerprints and paired distributions are in
[the machine-readable result](paired-hermes-results.json).

## Reproduce

Use a clean Hermes source checkout at `903a57c540917cedd30c7d971938f1af7bdf60e2`, a Python environment with
its agent runtime and OpenAI Chat Completions dependencies, the installed Nexus Node dependencies, a local CPU
`llama-server` and the Qwen2.5-0.5B-Instruct GGUF used in the result. The benchmark starts its own loopback server.
It uses disposable Hermes homes and a synthetic local API key. The worker restricts Python sockets to that server.
Licensed model weights and the external Hermes checkout are supplied by the operator.

```bash
python scripts/benchmarks/paired_hermes.py \
  --hermes /path/to/pinned/hermes-agent --python /path/to/its/venv/bin/python \
  --llama-server /path/to/llama-server --gguf /path/to/model.gguf \
  --threads 3 --repeats 2 --output /tmp/paired-hermes.json
```

The Qwen weights have a 32,768-token training window. The pinned Hermes client requires at least 64,000 served
tokens. The runner starts llama.cpp with one real 65,536-token slot and YaRN scaling by two. A plain 16K server
and a 64K request without scaling both stopped at agent initialization in setup trials. The measured workload
uses short prompts. It does not validate long-context generation quality.

## Tasks and scoring

The fixture is an eight-file JavaScript repository. Its commit is deterministic. The only agent tool can read a
file from that fixture's explicit manifest. The driver checks HEAD and clean status before and after each run.
It alternates arm order by task and repeat. Each arm uses a fresh session, temperature zero, seed 42, up to four
tool iterations and a 160-token output limit per completion.

| Task | Independently validated result |
| --- | --- |
| Local defect | Read the pack-count function and propose a rounding operator. The validator substitutes an allowlisted method into the fixture function and executes five hidden boundary cases in Node. |
| Cross-module impact | Return all direct and transitive production importers of the changed module. A separate oracle traverses the fixture's static relative imports. |
| Test selection | Return the exact set of dependent test files. The validator intersects the independent importer set with the tests directory. |

Exact JSON or a single JSON code fence is accepted. Wrong answers and format failures count separately.
The model cannot execute shell commands or arbitrary patches. File edits, review, production task completion
and concurrent worker coordination require additional benchmarks.

## Measurements

Each result row records the fixture revision and task-prompt hash, actual model answer, independent score, tool
reads, agent elapsed time and the selected Hermes session counters. Token and API-call values come from the
native sessions table after the database closes. Missing counters remain unavailable. The evidence preparation
time covers one batch for all three tasks and is recorded separately from agent time.

The summary reports sample counts, minima, medians and maxima of paired Nexus-minus-baseline differences.
Only completed arms enter a matched delta. An empty session is insufficient evidence of zero usage. Use the
per-task score rows to interpret costs alongside correctness. Shared CPU and model-slot caching affect elapsed
time, including across arm boundaries. Two repeats on a small fixture cannot establish general savings.

## Stronger-model protocol

The [Coder results and per-run comparisons](paired-hermes-coder-results.md) cover all 18 sessions.
The [preregistered Coder follow-up](paired-hermes-coder-protocol.md) uses the same tasks and oracles. Its
`--compact-cohort` mode runs all six orders of the three arms and starts a fresh model server for each
session. The full evidence rendering is the original pilot rendering. Compact keeps the symbol names and
paths, affected paths, test paths and coverage state while omitting the large provider descriptor. The evidence
text sent to the model drops from 850 to 278 bytes for the local-fix and impact tasks, and from 832 to 244
bytes for test selection. The benchmark keeps revision and artifact bindings independently of that text.

To reproduce, use the pinned Coder GGUF in the protocol and add `--compact-cohort --model qwen2.5-coder-1.5b`
to the command above. Missing inputs produce an `unavailable` JSON report and exit code 2. An incompatible
Hermes checkout or mismatched preregistered model/settings produces `unsupported`. Individual worker, agent
or inference failures remain in the per-session rows. Gold correctness is independent of system availability.

Pass `--session-dir /path/to/new-private-directory` to retain synthetic Hermes SQLite snapshots for independent
counter verification. The runner creates the directory, records the file name and SHA-256 beside each matching
row, and copies the database after Hermes closes it. These files include generated fixture conversations. Without
that option, only the measured counters and result rows persist. The first 0.5B pilot retains counters and exit
reasons but no raw SQLite files.
