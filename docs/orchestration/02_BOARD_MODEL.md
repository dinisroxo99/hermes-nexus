# Board model

[Overview](00_OVERVIEW.md)

## Project board and tenants

Use one board per project: `hermes-nexus` here. Tenants group work packages/phases,
not independent schedulers or permission boundaries. Current tenant:
`orchestration-docs-v1`. `step4`, `step5`, `step6` are phase examples only when
separately authorized; naming them does not lift product holds.

The supplied relevant-ID list is bounded context, **not a global inventory**. Supplied
inspection included a default listing truncated at 50; global absence/deduplication
and current resource availability are not established. Do not expand into global
discovery. Board `default_workdir` remains unset; do not mutate it or board
`project_id`, and do not set task project links for this DAG.

## Identity and dependencies

Each execution card needs explicit approved assignee, tenant, priority, bounded
scope, workspace policy, model/provider route and stable idempotency key. Capture
actual creation IDs, never fabricated manifest IDs. Reread any existing key before
reuse; divergent state/body/tenant requires stopping, not duplication.

The planning manifest in `t_1994a059` records these identities, not completion of
all execution stages:

| Stage | Task ID | Assignee | Idempotency key | Parent |
|---|---|---|---|---|
| W | `t_2bb0a233` | workspace-manager | `orchestration-docs-v1/wm-writer` | none |
| DOC | `t_007865ce` | documenter | `orchestration-docs-v1/documenter` | W |
| V | `t_54600090` | workspace-manager | `orchestration-docs-v1/wm-verifier` | DOC |
| R | `t_7e662e66` | reviewer | `orchestration-docs-v1/reviewer` | V |
| P | `t_4bf6944b` | implementer | `orchestration-docs-v1/publish` | R |

All five execution cards were created blocked with priority `0`. Real native edges
are W → DOC → V → R → P. Equal priority is intentional: dependencies determine
sequence. Priority is a scheduling tiebreaker, not admission or prerequisite override.

Never use an open epic that waits for the children it blocks: that creates a cycle.
Planning completes after DAG publication, not after execution. Dependencies establish
readiness, not authorization. See [Planning and admission](03_PLANNING_AND_ADMISSION.md)
and [Task lifecycle](04_TASK_LIFECYCLE.md).
