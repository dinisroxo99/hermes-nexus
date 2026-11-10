# Preregistered follow-up to the 0.5B paired benchmark

Protocol fixed on 9 November 2026 before running the stronger model. The original 12-session pilot remains
reported separately. Its invalid JSON answers, three Nexus iteration limits and large cached prompt totals
motivated testing a shorter evidence rendering on a stronger model.

## Frozen setup

- Use `bartowski/Qwen2.5-Coder-1.5B-Instruct-GGUF`, artifact `Qwen2.5-Coder-1.5B-Instruct-Q4_K_M.gguf`,
  model repository commit `1af47f78b1f9b0c242fabe43f7a365d5a67f3207`, SHA-256
  `f530705d447660a4336c329981af164b471b60b974b1d808d57e8ec9fe23b239`.
- Use llama.cpp b12230 CPU, three threads, one slot, 65,536 tokens served, YaRN scale two from 32,768.
  Start a new server before each session to clear model-side prompt caching between arms. OS filesystem caches
  may remain warm. Exclude server startup from agent wall time. Avoid concurrent scheduled model inference.
- Keep Hermes `903a57c540917cedd30c7d971938f1af7bdf60e2`, fixture `0894ac84d787d907bec32f1d76e0797fdd233b7a`,
  the same allowed file-reading tool, temperature zero, seed 42, a 160-token completion limit and four iterations.
- Repeat each of the three existing tasks twice. Run all 18 sessions. Across the six task/repeat groups, use all six
  permutations of baseline / full / compact so each arm occurs twice in each position. Do not discard weak answers.
  An unavailable model/runtime or worker timeout is reported separately from answer quality.

## Arms

Baseline receives the original user task and read-only fixture tool. Full adds exactly the pilot's Nexus
Context Pack/Impact projection. Compact represents the same revision-bound producer output as a short
outline of named symbols and their paths, affected paths, test candidate paths and coverage/finding state.
It omits repeated scope identity and the provider descriptor from the model turn. The driver still validates
the actual fixture revision. The compact renderer uses identical logic for every task and has no access to the answer key.

## Outcomes

Primary success requires the original exact JSON contract and the same independent executable/import oracle.
No score thresholds or task prompts change after inspecting the stronger model's answers. Report all three
six-pair contrasts (full minus baseline, compact minus baseline, compact minus full). Compute sample counts,
minimum, median and maximum for canonical prompt tokens, generated tokens, native API calls, observed fixture
tool calls and agent seconds. Retain the individual session counters, answers, scores and stop reasons.
Path mentions in prose are a secondary diagnostic for the two path tasks. They do not establish task completion.

No minimum expected benefit is assumed. A smaller projection can lower per-call prompt size while still
increasing total session tokens or reducing answer quality. Two repeats on this tiny repository remain descriptive.
