# Memory, Honcho and Project Expert

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/07_MEMORY_HONCHO_AND_PROJECT_EXPERT_ROUNDTABLE.md`


## Separate three concepts

### Agent identity

Provided by Hermes profile/SOUL.

### Agent/user experiential memory

Provided primarily by Honcho.

### Project truth

Provided by Git + Project Intelligence + canonical project documents.

Do not merge these concepts.

## Memory scoping

A reusable global profile can work across projects.

Memory retrieval should conceptually be scoped to:

```text
current task
current project
global agent/user experience
```

Cross-project retrieval should be explicit, not automatic.

## Project Expert

**PLANNED**

The Project Expert is a read-only project oracle used by other agents.

It is not a coder.

### Responsibilities

Answer questions such as:

```text
Where should this feature be implemented?
What depends on this symbol?
Why was this architecture decision made?
Which tests are relevant?
Did a similar change fail before?
Can these tasks safely run in parallel?
```

### Inputs

```text
current Git revision
Project Intelligence
ICM
ADRs
task metadata
historical execution events
validated project observations
```

### Restrictions

```text
read code            yes
search code          yes
query impact         yes
query history        yes
write code           no
commit               no
merge                no
change canonical docs no by default
```

## `ask_project` tool

Candidate interface:

```json
{
  "projectId": "cookation",
  "taskId": "TASK-142",
  "question": "What should I know before changing IngredientSubstitution?"
}
```

Response should include evidence:

```json
{
  "revision": "...",
  "answer": "...",
  "relevantSymbols": [],
  "affectedTests": [],
  "decisions": [],
  "historicalNotes": [],
  "currentConflicts": [],
  "confidence": 0.0
}
```

## Model strategy

Initial implementation should **not** require training a model per project.

Prefer:

```text
shared small local model
+
project-scoped retrieval
+
graph
+
history
```

A single model can answer for many projects by switching project retrieval namespace.

## Why not encode current code in model weights?

Project code changes frequently.

Fine-tuned parametric knowledge becomes stale and is difficult to remove.

Use retrieval for:

```text
current code
current graph
current task state
current decisions
```

Future adaptation can teach the model:

```text
how to answer
how to rank evidence
how to interpret project-specific patterns
```

rather than serving as the only storage of project facts.

## Future adapters

Optional future architecture:

```text
shared base SLM
  ├─ project adapter A
  ├─ project adapter B
  └─ project adapter C

each adapter
  + current project retrieval
```

This is deferred until enough validated training data exists.


## Knowledge precedence

Project Expert must follow the precedence and drift rules in `28_KNOWLEDGE_PRECEDENCE_AND_DRIFT.md`.

Draft/proposed design memory is never equivalent to current project truth.

## Memory admission policy

Do not automatically promote model text into durable project knowledge.

Durable project observations require:

```text
source evidence
projectId
revision/range
validation status
confidence
lifecycle status
```

Use `CANDIDATE → ACTIVE → SUPERSEDED/REJECTED` from `26_PROJECT_EXPERT_DATA_PIPELINE.md`.

Honcho conclusions remain experiential memory and do not bypass this admission policy.
