# Profiles and ownership

[Overview](00_OVERVIEW.md)

## Supplied deployed configuration

These are operator-supplied facts, not a fresh profile/configuration audit. Do not
inspect or edit profile files to document this contract.

```text
planner profile exists
kanban.orchestrator_profile = orchestrator
kanban.default_assignee = orchestrator
kanban.max_in_progress = 3
kanban.max_in_progress_per_profile = 1
kanban.auto_decompose = false
kanban.dispatch_in_gateway = true
dispatch_profiles: planner, workspace-manager, architect, implementer, tester, reviewer, documenter
```

`default` and `orchestrator` are not dispatchable. Naming `orchestrator` as default
assignee does not make it an execution worker. Cards need explicit approved specialist
assignees; profile existence and historical aliases do not establish eligibility.

| Role | Responsibility and boundary |
|---|---|
| planner | Plans complete bounded blocked DAG and manifest; does not admit or execute |
| orchestrator | Validates contracts, dependencies, workspaces/resources and evidence; explicitly admits and accepts outcomes |
| dispatcher | Schedules admitted dependency-ready work; does not decide authorization |
| workspace-manager | Provisions/verifies authorized writer/verifier worktrees, not content |
| architect | Performs authorized architecture analysis; omitted from this operator-fixed docs DAG |
| implementer | Implements only when explicitly authorized; here publishes accepted docs after separate admission |
| tester | Performs authorized verification; no tester task or product tests/builds approved here |
| reviewer | Independently judges exact frozen candidate, read-only by contract; returns PASS or actionable FINDINGS |
| documenter | Authors allowlisted docs, checks statically, commits locally and hands off candidate |

Fleet membership is not task authorization. Repository rules and admitted scope
still apply. See [Planning and admission](03_PLANNING_AND_ADMISSION.md).

## Planner V1 authority

The supplied file-tool bundle exposes `read_file`, `search_files`, `write_file` and
`patch`; no terminal/arbitrary code execution/delegation/cron/memory/skill/plugin
management, and MCP is excluded. Task-scoped Kanban tools do not grant global listing
or unblocking authority.

The planner's no-write rule is **behavioral**, not technical read-only access or
filesystem confinement: its bundle includes write-capable tools. Scratch is not a
sandbox guarantee. `--no-skills` still seeds the runtime-required `hermes-agent`
reference; no optional skills or tool expansion is authorized.

Planner neither implements nor unblocks, merges, tests or performs specialist review.
It completes only planning after publishing/rereading the complete DAG. Do not use
native decompose or `delegate_task` as a second scheduler. Do not create duplicate
tier profiles. Orchestrator owns admission; specialists execute admitted contracts.
