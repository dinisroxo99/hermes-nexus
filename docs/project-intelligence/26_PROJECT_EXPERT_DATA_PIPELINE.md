# Project Expert Data Pipeline

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/26_PROJECT_EXPERT_DATA_PIPELINE_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

Build a project-specific knowledge specialist that becomes more useful over time without storing volatile code knowledge only in model weights.

## Two knowledge planes

### Current truth plane

Always rebuilt/retrieved from:

```text
Git revision
Project Intelligence
ICM
ADRs
current task state
```

### Historical experience plane

Derived from:

```text
past runs
test failures
review findings
human feedback
accepted decisions
validated observations
```

The Project Expert combines both at query time.

## Ingestion flow

```text
Hermes run
  │
  ├─ task/run metadata
  ├─ model/token metrics
  ├─ tool activity
  └─ result
  │
Project Map
  ├─ Context Pack
  ├─ impact/scope
  └─ project revision
  │
Validation
  ├─ tests
  ├─ review
  └─ human feedback
  │
  ▼
Project History Store
```

## Observation promotion

Do not automatically turn every model statement into project knowledge.

Candidate observation lifecycle:

```text
CANDIDATE
  ↓ validation
ACTIVE
  ↓ replaced
SUPERSEDED

or

REJECTED
```

Example:

```json
{
  "projectId": "...",
  "observation": "Changing IRecipeService usually requires RecipeController updates.",
  "sourceRuns": ["..."],
  "status": "ACTIVE",
  "confidence": 0.91,
  "validFromRevision": "...",
  "supersededBy": null
}
```

## Retrieval

Question:

```text
"What should I know before changing IRecipeService?"
```

Retriever combines:

```text
current symbol graph
current impact
current tests
active ADRs
validated historical observations
similar successful/failed tasks
```

## Answer generation

Use a small/shared model initially.

The model should:

```text
synthesize
compare current vs historical evidence
state uncertainty
cite evidence identifiers
```

It should not invent project facts when evidence is missing.

## Training dataset

Future Project Expert training examples can be generated from:

```text
question
current revision
retrieved evidence
accepted answer
validation outcome
```

Prefer examples where:

```text
evidence was valid
answer was accepted
project revision is known
```

## Training objective

Train:

```text
evidence ranking
project QA style
architecture reasoning
historical pattern interpretation
uncertainty behavior
```

Do not rely on fine-tuning to memorize the latest source tree.

## Multi-project model

A single base Project Expert can serve many projects:

```text
shared model
     │
project router
 ┌───┼───┐
 A   B   C
```

Isolation occurs in retrieval and data namespaces.

Optional per-project adapters are a later optimization, not an MVP requirement.

## Success metrics

```text
answer correctness
evidence precision
cross-project contamination = 0
stale-answer rate
tokens per answer
latency
agent tool calls avoided after using ask_project
```

## Poisoning and validation

Historical runs are not automatically trustworthy training evidence.

Exclude or downgrade:

```text
failed/reverted patches
review-rejected answers
stale Context Packs
cross-project contamination
unverified model conclusions
runs with missing revision linkage
```

A Project Expert answer used as a future training target should ideally have independent validation or human acceptance.
