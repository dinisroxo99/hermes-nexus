# Operations and evidence handoffs

[Overview](00_OVERVIEW.md)

## Bounded workspace sequence

Canonical `/home/dinis/projects/hermes-nexus-main` is **READ / PLAN / AUDIT only**,
never a writer/default/execution workspace or execution command working directory.
No direct writes, packages, tests or builds there. Planner uses assigned scratch.

1. **Plan:** publish complete blocked DAG and actual-ID manifest; orchestrator
   validates and admits W after workspace/resource checks.
2. **W:** provision/verify exclusive attached writer
   `/home/dinis/projects/hermes-nexus-orchestration-docs-write`, branch
   `docs/orchestration-v1`, supplied baseline
   `561482f53f1702c67a1e3886df14f8d9930ec569`. Report actual HEAD, attachment,
   cleanliness, untracked state and ownership. Reuse only matching clean target;
   stop on divergence, do not repair.
3. **DOC:** after accepted W evidence and separate admission, verify identity,
   write nine docs plus minimal `docs/README.md` link, check scope/Markdown links
   statically, commit locally. Hand off actual full candidate SHA/tree, commits,
   paths and cleanliness. No push/merge/self-routing review.
4. **V:** after accepted DOC evidence and separate admission, provision/verify
   `/home/dinis/projects/hermes-nexus-orchestration-docs-verify` detached at exactly
   actual candidate SHA/tree. Report writer unchanged before/after. No floating ref
   or retargeting divergent existing verifier.
5. **R:** after accepted V evidence and separate admission, independently review
   exact frozen SHA/tree without writes. Complete own card with PASS or actionable
   FINDINGS and start/end identity/status evidence.
6. **P:** only after accepted exact-SHA independent PASS and explicit orchestrator
   admission, verify attached clean writer equals reviewed candidate and diff is
   allowlisted. Observe remote/PR identity; push reviewed branch, open or reuse one
   matching PR; await repository-required checks at that exact head; normally merge.
   Verify server-side merge, merge SHA and actual `origin/main` afterward. No force
   push, history rewrite, bypass or content edits. A native `local-only` completion
   contract does not waive publication gates.

[Board model](02_BOARD_MODEL.md) records stage IDs/keys. Candidate/merge SHAs are
outputs, not invented planning values. A later correction requires an explicit
orchestrator contract and continuation SHA; initial workers create no extra cards.

## Stop rather than recover destructively

Stop on stale/mismatched revision/tree, non-allowlisted scope, dirty/divergent
workspace, conflicting ownership, capability/provider gaps, remote/PR conflict or
unmet CI/protection gates. Preserve unrelated/untracked files; no reset/clean/force,
dependency install, Nexus startup, scope expansion, board default/project-link
mutation or unrelated/historical card changes.

Writer checks are static observations, not invented test passes. No tester task,
product tests/builds or smoke rerun is approved. Detached HEAD is not technical
read-only enforcement. For commands/runtime capabilities use the authoritative
[Hermes docs](https://hermes-agent.nousresearch.com/docs/), including
[Kanban](https://hermes-agent.nousresearch.com/docs/user-guide/features/kanban) and
[worktrees](https://hermes-agent.nousresearch.com/docs/user-guide/git-worktrees).
This runbook describes the contract, not unsupported CLI commands or config changes.

## Historical smoke: supplied outcomes, not new results

Provenance: operator declarations in `t_1994a059` and DOC contract `t_007865ce`;
planner reread historical `t_7744bbca`, `t_f861a158`, `t_dfb9834c`, `t_2c3d54fb`,
`t_2ccc1bea`. Its completion metadata records corroborating native identities,
run/start/end values, initial blocked events, dependency links and stored overrides.
Exact identities/timestamps are preserved in [Concurrency](05_CONCURRENCY.md).

```text
PLANNER_CREATED_ALL_BLOCKED = YES
ORCHESTRATOR_VALIDATED_DAG = YES
A_B_C_ADMITTED_TOGETHER = YES
PARALLELISM_RUNTIME_PROOF = YES (A/B/C started_at 1790818054)
FANIN_D_RAN_ONLY_AFTER_ABC = YES
MODEL_OVERRIDE_PERSISTED = YES
MODEL_RUNTIME_PROOF = UNKNOWN
UNEXPECTED_WRITES = UNKNOWN
UNEXPECTED_CARDS_CREATED = NO
SMOKE_TEST_RESULT = PASS
```

This is supplied historical outcome plus bounded card evidence, not new execution,
filesystem audit or runtime-model audit. Logical agreement alone is not empirical
proof. B/D's A/C confusion is handoff-content limitation: preserve history and use
native identities. Runtime-assigned scratch paths do not prove creator-explicit path
selection. PASS resolves neither UNKNOWN nor product authorization.
