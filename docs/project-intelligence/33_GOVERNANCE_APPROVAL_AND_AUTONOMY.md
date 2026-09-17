# Governance, Approval and Agent Autonomy

> **Roundtable review v4:** NEW — approved after roundtable — 2026-09-17  
> Companion review: `reviews/33_GOVERNANCE_APPROVAL_AND_AUTONOMY_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

Define what agents may decide autonomously and what requires stronger review or a human.

Without this policy, adding more capable agents can silently increase risk.

## Autonomy levels

### A0 — Observe

Can:

```text
read
search
ask_project
analyze
```

Cannot mutate project/task state.

### A1 — Propose

Can additionally:

```text
create proposed task/issue
create design idea
suggest scope
suggest architecture
```

No production-code mutation.

### A2 — Bounded execute

Can:

```text
edit within WRITE scope
run approved tools/tests
commit to task worktree
```

Cannot merge protected branches or perform high-risk operations.

### A3 — Review/approve technical gate

Can:

```text
review diffs
approve/reject agent result
request rework
```

Still cannot substitute for explicit human approval where policy requires it.

### A4 — Human/operator authority

Reserved for:

```text
protected merges where configured
destructive migrations
production deploy
credential/security policy
cross-project data release
governance changes
```

## Default profile mapping

Initial suggestion:

```text
Project Expert   A0
Architect        A1
Documenter       A1/A2 depending on scope
Tester           A2 within tests
Implementer      A2
Reviewer         A3 for technical review
Human            A4
```

This is policy, not a model capability claim.

## Task risk classes

```text
LOW
NORMAL
HIGH
CRITICAL
```

Examples:

### LOW

```text
comments
docs
localized tests
```

### NORMAL

```text
normal feature work
```

### HIGH

```text
public API
cross-module refactor
schema changes
authentication
```

### CRITICAL

```text
production credentials
security controls
destructive data operations
release/deployment authority
```

## Approval matrix

Policy combines:

```text
autonomy level
task risk
impact severity
operation type
```

Example:

```text
A2 implementer + HIGH public API change
→ allowed in worktree
→ reviewer required
→ protected merge may require human
```

## Agent-created tasks

Agents may create:

```text
proposed tasks
issues
subtasks
review requests
```

according to profile policy.

Large epics or architecture rewrites should default to `PROPOSED`, not immediately dispatch themselves.

## Design idea promotion

An agent can propose an idea.

Promotion to `ACCEPTED` follows project governance.

Promotion to `IMPLEMENTED` requires evidence that code/canonical docs actually changed.

## Audit

Approval events must capture:

```text
who/what approved
policy version
task/run
operation
timestamp
evidence
```

## Acceptance criteria

- every mutating profile has an explicit autonomy level;
- high-risk operations cannot be self-authorized by a low-level profile;
- agent-created large work defaults to proposed;
- technical review and human authority are distinct concepts;
- governance changes are auditable/versioned.
