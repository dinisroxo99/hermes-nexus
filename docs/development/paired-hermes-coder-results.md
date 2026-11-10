# Qwen2.5-Coder evidence rendering benchmark

The Coder follow-up completed **18 real Hermes sessions**. Baseline passed **2/6** tasks,
the pilot's full Nexus rendering passed **2/6**, and the compact rendering passed **2/6**.
The compact rendering saved 142
canonical prompt tokens per pair at the median relative to full. Against baseline it added
73 at the median.
These are six matched comparisons over three controlled tasks.

The arm-independent programmatic oracles, prompt hashes, fixed fixture, exact model and counterbalanced order are described in
[the preregistered protocol](paired-hermes-coder-protocol.md). Each arm ran in a new Hermes home against a fresh
llama.cpp process. All 18 retained native SQLite snapshots were hashed and reopened with the independent
session reader. Every selected counter agreed with its result row. Each answer was scored again outside Hermes.
The model file and engine binary also matched their pinned SHA-256 on completion.
[Individual answers, native stop reasons, counters and snapshot fingerprints](paired-hermes-coder-results.json).

## Per-run results

Each cell lists **baseline / full / compact**, regardless of actual execution order.

| Repeat | Task | Independent score | Canonical prompt tokens | Output tokens | API calls | Agent seconds |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | local-fix | invalid_answer / wrong_answer / invalid_answer | 2895 / 3110 / 2968 | 6 / 6 / 6 | 1 / 1 / 1 | 46.334 / 36.881 / 37.671 |
| 1 | impact | wrong_answer / wrong_answer / wrong_answer | 2888 / 3103 / 2961 | 42 / 35 / 35 | 1 / 1 / 1 | 46.166 / 53.138 / 48.017 |
| 1 | tests | pass / pass / pass | 2877 / 3084 / 2938 | 22 / 18 / 22 | 1 / 1 / 1 | 50.47 / 55.889 / 50.118 |
| 2 | local-fix | invalid_answer / wrong_answer / invalid_answer | 2895 / 3110 / 2968 | 6 / 6 / 6 | 1 / 1 / 1 | 54.735 / 51.986 / 42.091 |
| 2 | impact | wrong_answer / wrong_answer / wrong_answer | 2888 / 3103 / 2961 | 35 / 35 / 42 | 1 / 1 / 1 | 46.121 / 46.088 / 55.815 |
| 2 | tests | pass / pass / pass | 2877 / 3084 / 2938 | 22 / 18 / 22 | 1 / 1 / 1 | 53.717 / 36.446 / 42.688 |


## Paired differences

Values are medians with the observed minimum and maximum in parentheses. The units are tokens, calls or seconds
according to the column. These are matched differences, so they need not equal the difference of arm medians.

| Contrast | Canonical prompt tokens | Output tokens | API calls | Fixture reads | Agent seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| Full − baseline | 215 (207 to 215) | -2 (-7 to 0) | 0 (0 to 0) | 0 (0 to 0) | -1.391 (-17.271 to 6.972) |
| Compact − baseline | 73 (61 to 73) | 0 (-7 to 7) | 0 (0 to 0) | 0 (0 to 0) | -4.508 (-12.644 to 9.694) |
| Compact − full | -142 (-146 to -142) | 2 (0 to 7) | 0 (0 to 0) | 0 (0 to 0) | -2.166 (-9.895 to 9.727) |


## What the answers show

- **Local defect.** The task requires ceiling division. The anchor examples are one unit and five units, which
  must return one pack and two packs. Across the two repeats the full arm selected `round`, which fails both
  boundaries. The baseline and compact arms returned uppercase `ROUND`, outside the allowed JavaScript methods.
- **Production impact.** All arms named both production importers. Every arm also included at least one test in
  its answer to a production-only question. The baseline invented `tests/print.test.js` in repeat one and compact invented the same path in repeat two.
  The Nexus projection exposes test files in the general affected-path list and in the test-candidate list.
  The compact text removes provider metadata while preserving those roles and memberships.
- **Test selection.** All arms returned the exact dependent test path in both repeats. Across all 18 sessions the
  stronger model made one API call per session and never invoked the fixture-reading tool. This exercise measures
  the evidence rendering on these prompts; it cannot establish effects on tool-heavy autonomous coding or review.

The [earlier 0.5B pilot](paired-hermes-benchmark.md) scored zero of six in both arms and often returned prose or
exhausted its iteration budget. That run used a shared model server. The Coder run used a different model and fresh
servers for every session, so the rendering contrasts within the Coder cohort are the controlled comparisons here.
Both studies used the same three tasks. CPU elapsed time on the shared host is descriptive. Reproduction with
`--session-dir` produces additional private synthetic snapshots for counter verification.

[Exact public model artifact](https://huggingface.co/bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF/blob/1af47f78b1f9b0c242fabe43f7a365d5a67f3207/Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf)
