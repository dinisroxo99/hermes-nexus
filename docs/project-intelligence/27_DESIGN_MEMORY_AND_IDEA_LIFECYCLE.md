# Design Memory and Idea Lifecycle

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/27_DESIGN_MEMORY_AND_IDEA_LIFECYCLE_ROUNDTABLE.md`


Status: **PLANNED / SEPARATE KNOWLEDGE PLANE**

## Purpose

Keep a strict distinction between:

```text
what the project currently is
```

and:

```text
what humans/agents are considering changing it into
```

Without this separation, Project Expert retrieval can accidentally present a proposal as current architecture.

## Boundary

### `hermes-project-map`

Represents:

```text
current repository structure
current symbols/relationships
current ICM
current ADRs
current impact
current project state
```

### Design Memory / Ideas

Represents:

```text
ideas
proposals
alternatives
open questions
future architecture
rejected options
experiments
```

This may eventually live in a separate module/service such as:

```text
hermes-project-ideas
design-memory
```

It does not need to be split into a separate repository during the first implementation, but the data model must preserve the distinction.

## Idea states

Suggested lifecycle:

```text
DRAFT
PROPOSED
UNDER_REVIEW
ACCEPTED
REJECTED
SUPERSEDED
IMPLEMENTED
ABANDONED
```

## Idea record

Example:

```json
{
  "ideaId": "idea_82",
  "projectId": "prj_92af0d",
  "title": "Move recipe recommendation scoring into a dedicated domain service",
  "status": "PROPOSED",
  "createdBy": "architect",
  "createdAtRevision": "abc123",
  "relatedSymbols": ["Recipe", "RecommendationService"],
  "rationale": "...",
  "alternatives": [],
  "evidence": [],
  "linkedTasks": [],
  "acceptedDecisionId": null
}
```

## Link ideas to project snapshots

Every meaningful proposal should reference the project state that existed when it was created:

```text
Git revision
Context Pack id
Project Map snapshot/version
```

This allows later drift detection.

Example:

```text
Idea created against revision A
repository now revision F
affected architecture changed
→ mark idea context as STALE / NEEDS_REVIEW
```

## Promotion to canonical truth

An accepted design does not automatically become current project truth.

Recommended flow:

```text
idea ACCEPTED
    ↓
implementation task(s)
    ↓
code merged
    ↓
canonical ADR / ICM / project docs updated
    ↓
Project Map re-analysis
    ↓
idea status IMPLEMENTED
```

The canonical sources become authoritative only after the project actually changes.

## Rejected ideas

Keep rejected alternatives.

They are useful for answering:

```text
"Did we consider X before?"
"Why did we reject Y?"
```

But Project Expert must label them explicitly as rejected/historical.

## Project Expert retrieval rules

Default query:

```text
current project truth
+ accepted/implemented historical decisions
```

Proposed/draft ideas are included only when:

```text
the user asks about future plans
the agent is performing architecture/design work
the task explicitly references the idea
```

Never silently mix DRAFT/PROPOSED content into an answer about the current system.

## Event log

Idea lifecycle changes should be append-only events:

```text
IDEA_CREATED
IDEA_UPDATED
IDEA_REVIEWED
IDEA_ACCEPTED
IDEA_REJECTED
IDEA_SUPERSEDED
IDEA_LINKED_TO_TASK
IDEA_IMPLEMENTED
```

## Acceptance criteria

- Project Expert can distinguish current architecture from proposals.
- Ideas are linked to the revision/context they were based on.
- Rejected ideas remain searchable without becoming active guidance.
- Accepted ideas are not treated as implemented until canonical project state confirms them.
- Drift can be detected when project structure changes after an idea is created.

## Decision authority

Agent proposals may transition:

```text
DRAFT → PROPOSED
```

according to profile policy.

Transitions into:

```text
ACCEPTED
```

must follow `33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md`.

An agent cannot make its own architectural proposal authoritative merely by repeatedly citing it.
