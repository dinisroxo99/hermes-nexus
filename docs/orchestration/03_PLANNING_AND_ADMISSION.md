# Planning and admission

[Overview](00_OVERVIEW.md)

## Bounded Planning Context V1

All fields below are required. **Explicit empty differs from omitted:** an empty
list declares no supplied entries; omission leaves context unresolved. Do not fill
gaps with global discovery or invented values.

| Field | Required meaning |
|---|---|
| `planning_version` | Contract version (`1` here) |
| `board` | Explicit project board |
| `tenant` | Authorized package/phase namespace |
| `goal` | Bounded requested outcome |
| `current_revision` | Supplied/observed full baseline with provenance |
| `canonical_checkout` | Canonical read/plan/audit checkout |
| `authorized_scope` | Permitted work and paths/effects |
| `excluded_scope` | Forbidden work and boundaries |
| `existing_relevant_task_ids` | Bounded supplied card set, not global inventory |
| `reusable_task_ids` | Approved reuse candidates, possibly empty |
| `known_dependencies` | Supplied prerequisites, possibly empty before new DAG construction |
| `allowed_assignees` | Roles approved for this DAG |
| `workspace_policy` | Scratch/writer/verifier identities, ownership and no-repair rules |
| `model_tier_policy` | Scores, tiers, pinned routes and substitution restrictions |
| `idempotency_namespace` | Stable retry-safe namespace |
| `operator_constraints` | Admission, concurrency, lifecycle and other constraints |
| `stop_conditions` | Gaps/mismatches ending planning without execution |

Here the supplied baseline is `561482f53f1702c67a1e3886df14f8d9930ec569`.
Planner did not independently run Git to verify it. Provisioning and authoring
verify actual identity. **Future candidate SHA/tree are unresolved producer outputs**;
a baseline, floating branch or invented SHA cannot replace them.

## Publish complete DAG before execution

1. Read bounded context; stop on missing authority or conflicting contracts.
2. Define the complete DAG, per-card scopes, assignees, workspace interfaces,
   scores/routes and shared decisions before execution.
3. Create all execution cards with `initial_status: blocked`, explicit assignee/tenant
   and stable keys. Reread an existing key; stop on duplicate divergence.
4. Capture real IDs and publish real prerequisite edges with `kanban_link`.
5. Reread each card with `kanban_show`: verify body, edges, statuses, tenant,
   assignee, workspace and stored model/provider. Confirm all remain blocked.
6. Complete **only planning**, carrying actual created IDs and full manifest,
   explicit empty/reuse decisions, unresolved outputs and limitations.
7. Hand off to orchestrator and stop. Do not wait for execution, implement, unblock,
   merge, test, perform specialist review or complete execution cards.

Manifest records IDs, parents/children, priorities, assignees, tenant, keys, workspace
kind/path, scopes, acceptance/stop conditions, model/provider, tier, four scores and
rationale. No extra architect/tester/correction card is approved in the initial docs
DAG. Static writer/reviewer observations do not claim an existing automated checker
or product test result. No native decompose or `delegate_task` second scheduler.

## Orchestrator admission

Orchestrator validates the DAG/contracts, reconciles capacity/shared resources,
checks actual workspace identity/exclusivity and explicitly admits each stage after
accepting upstream evidence. Parent completion alone does not remove sticky blocking.
Dispatcher only schedules admitted dependency-ready work; it does not authorize
scope, accept review or turn FINDINGS into publication permission.
See [Task lifecycle](04_TASK_LIFECYCLE.md).
