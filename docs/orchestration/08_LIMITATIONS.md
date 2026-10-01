# Limitations and held statuses

[Overview](00_OVERVIEW.md)

## Evidence boundaries

Smoke supports bounded parallelism/fan-in through native start/end records, not every
operational/security property. Supplied outcomes remain `MODEL_RUNTIME_PROOF = UNKNOWN`
and `UNEXPECTED_WRITES = UNKNOWN`. Stored overrides are not runtime inference proof;
agent agreement or later clean checkout cannot establish no historical writes.

B and D confused A/C IDs in prose. A is `t_f861a158` (architect); C is `t_2c3d54fb`
(reviewer). This is content/handoff-quality limitation, not demonstrated control-plane
failure. Preserve historical cards and prefer native identity/run records. A
runtime-assigned scratch `workspace_path` is not creator-explicit path proof.

Supplied task/inspection coverage is not a global inventory; default listing was
truncated at 50. No global absence, deduplication or available capacity is established.
Orchestrator reconciles resources; workers do not expand into whole-board discovery.

## Behavioral restrictions are not confinement

Planner V1 includes `write_file` and `patch`: no-write rule is behavioral, not technical
read-only access or filesystem confinement. Excluding terminal/MCP/delegation is not
a complete effect boundary. `--no-skills` still seeds runtime-required `hermes-agent`;
no optional expansion is authorized. Task-scoped Kanban tools do not confer global
listing/unblocking authority.

Verifier is read-only **by contract**. Detached HEAD does not prevent edits, commits
or filesystem effects and is not a permissions sandbox. This documentation installs
no confinement. Worktrees do not isolate shared profile homes/common Git metadata.
One-worker-per-profile applies on this board, not globally cross-board; distinct
profiles/worktrees are insufficient evidence of safe parallel effects.

Configuration/routing are operator-supplied, not fresh profile/config audit; policy
routes do not guarantee model availability or benchmarks. Smoke PASS does not prove
product enforcement, Guard readiness or a closed guarded surface. After changes,
pre-edit repository/intelligence evidence is baseline-only; contextual Markdown
retrieval is not complete semantic analysis. Partial, unsupported, unavailable or
`not_evaluated` evidence never proves safety.

## Held product statuses: verbatim

Operator-required holds remain unchanged. This set does not resolve historical gates,
modify their source documents or authorize deferred work:

```text
START_CONFINEMENT_EPIC_NOW = NO
CONFINEMENT_EPIC_FEASIBLE = UNKNOWN
TRACK_A_STATUS = DEFERRED
SLICE4_STATUS = NOT_STARTED
STEP4 = INCOMPLETE
HERMES_PREEDIT_RUNTIME_READY_TO_IMPLEMENT = NO
EFFECT_BOUNDARY_DEFINED = NO
GUARDED_SURFACE_CLOSED = NO
```

No Step 4/5/6, Track A, Slice 4, Guard or confinement implementation is authorized.
No changes to `src/`, `integrations/`, config, `SOUL.md`, Hermes profiles/plugins/config,
`docs/CURRENT_STATUS.md`, `docs/ETS_PROFILE_EXPOSURE.md`, VISION/CONCEPTS/ARCHITECTURE
or project-intelligence documentation are part of this candidate. ETS WRITE is not
authorization. See [Overview](00_OVERVIEW.md) for ownership and
[Operations](07_OPERATIONS.md) for separately gated review/publication.
