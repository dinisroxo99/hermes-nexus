# Concurrency

[Overview](00_OVERVIEW.md)

## Capacity versus independence

Supplied policy: maximum **three Kanban workers globally**, maximum **one per profile
on this board** (`kanban.max_in_progress = 3`, `kanban.max_in_progress_per_profile = 1`).
The per-profile cap is not globally cross-board. Orchestrator reconciles other work
and shared resources before admission.

Different profiles alone do not establish independence. Parallel work needs disjoint
writes, compatible interfaces/workspaces and safe shared-resource use. Worktrees do
not isolate shared profile homes or common Git metadata. Do not share a writer with
concurrent provisioning/publication; provisioning affects shared Git administration.

Current docs DAG is intentionally serial **W → DOC → V → R → P**: each stage consumes
preceding evidence/artifacts and/or shares writer/Git resources. Three is a ceiling,
not a mandate to parallelize.

## Completed smoke evidence

Provenance: supplied operator outcome plus native historical records reread by planner
in `t_1994a059`. Planner smoke card: `t_7744bbca`, run `768`. These are exact native
epoch-second values, not new measurements:

| Stage | Task ID | Native profile | Run | started_at | ended_at |
|---|---|---|---|---|---|
| A | `t_f861a158` | architect | 769 | 1790818054 | 1790818075 |
| B | `t_dfb9834c` | tester | 770 | 1790818054 | 1790818110 |
| C | `t_2c3d54fb` | reviewer | 771 | 1790818054 | 1790818103 |
| D | `t_2ccc1bea` | documenter | 772 | 1790818175 | 1790818221 |

A/B/C start together and have overlapping intervals. D starts after all three ends;
native edges A → D, B → D, C → D corroborate fan-in. Logical agreement alone is not
empirical proof; start/end records provide bounded runtime parallelism/fan-in evidence.

B and D confused A/C IDs in prose: use native identities above, preserve historical
cards and treat this as content/handoff-quality limitation, not control-plane failure.
Smoke does not prove global cross-board enforcement, runtime model or absence of
unexpected writes. A runtime-assigned scratch `workspace_path` is not proof the creator
explicitly set a path. Exact supplied outcomes are in [Operations](07_OPERATIONS.md).
