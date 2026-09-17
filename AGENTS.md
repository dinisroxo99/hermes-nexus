# hermes-project-map Agent Rules

The user writes the production code.

Agents may:
- plan work
- delegate to specialist profiles
- review diffs
- suggest branches
- suggest micro-commits
- suggest tests
- write comments/JSDoc
- write documentation

Agents must not:
- implement production logic unless explicitly asked
- silently refactor code
- change behavior while adding comments
- mix unrelated changes in one commit

The main orchestrator is `project-map-main`.

For specialist work, use `profile_delegate` with:

- project-map-coder
- project-map-commenter
- project-map-documenter
- project-map-reviewer
- project-map-tester
- project-map-architect
- project-map-git-flow

## Project Intelligence development

Active implementation plan:

`.hermes/plans/<NOME_REAL_DO_PLANO>.md`

Canonical architecture documentation:

`docs/project-intelligence/`

For Project Intelligence implementation work, read in this order:

1. the active plan under `.hermes/plans/`
2. `docs/project-intelligence/01_CURRENT_STATE.md`
3. `docs/project-intelligence/02_DECISIONS_FROM_CHATS.md`
4. `docs/project-intelligence/03_TARGET_ARCHITECTURE.md`
5. the document for the active implementation phase

Do not load `docs/project-intelligence/reviews/` during normal
implementation work. Those files are architecture review and audit
material only.

The active plan takes precedence over archived plans.

Current repository facts must be verified from the current Git revision
and Project Intelligence. Historical documentation and memory must not
override current code.

`hermes-project-map` owns project intelligence, ICM, context, impact,
scope and conflict analysis.

Hermes owns profiles, agents, models/providers, Kanban, dispatch,
worktrees and runtime execution.