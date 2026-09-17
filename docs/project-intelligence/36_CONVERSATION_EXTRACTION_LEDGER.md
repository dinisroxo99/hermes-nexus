# Conversation Extraction Ledger

> **Roundtable review v4:** NEW — approved after roundtable — 2026-09-17  
> Companion review: `reviews/36_CONVERSATION_EXTRACTION_LEDGER_ROUNDTABLE.md`


Status: **TRACEABILITY**

## Purpose

Record which architectural themes were extracted from the project conversations so future edits can distinguish:

```text
confirmed past decision
later refinement
new proposal
```

This is not a transcript.

It is a traceability ledger.

## Project conversations used

### 2026-09-11 — Creating Hermes multipart system

Extracted themes:

```text
project registry/discovery
safe project boundaries
Project Intelligence foundation
profiles/agents by responsibility
multiple model providers/fallback concept
```

Confirmed checkpoint later referenced:

```text
61 tests after early foundation work
```

The repository evolved significantly after this stage.

### 2026-09-12 — Qwen / Project Intelligence branches

Extracted themes:

```text
project-intelligence-service branch
analyzer service
impact/context/insights
ICM / Jake Van Clief methodology as a base rather than the whole design
profiles such as architect/tester/reviewer/documenter/UI
model fallback per profile
```

### 2026-09-16 — Applying ICM to the system

Extracted themes:

```text
ICM as workflow/context layer
not replacing multi-agent execution
task/issue UI requirement
reuse existing tools rather than build everything
impact-aware locks/scopes
project sections/worktree isolation
global agents reused across projects
Honcho for memory
project-specific read-only expert
structured execution logs for future learning
```

### 2026-09-17 — Documentation/architecture consolidation

Extracted themes:

```text
separate current truth from design ideas
reuse Hermes Kanban/task telemetry
thin Hermes guard integration
WRITE/RESERVED/WATCH/IMPACT
Project Expert retrieval-first strategy
observability/training pipeline
24/7 runtime
token-efficiency benchmarks
```

## Key supersessions

### Old idea

```text
build custom task manager/UI
```

Superseded by:

```text
evaluate/reuse Hermes Kanban first
```

### Old idea

```text
externalize all SOUL/profile/memory/runtime state
```

Superseded by:

```text
keep Hermes as runtime;
externalize only Project Map intelligence and portable project truth
```

### Old idea

```text
hard lock every impacted file
```

Superseded by:

```text
WRITE / RESERVED / WATCH / IMPACT
```

### Old idea

```text
train one coding model per project
```

Superseded by:

```text
read-only Project Expert
shared small model + project retrieval first
optional adapters later
```

## Current canonical decision sources

Use in this order:

```text
02_DECISIONS_FROM_CHATS.md
03_TARGET_ARCHITECTURE.md
09_IMPLEMENTATION_ROADMAP.md
17_REVIEW_FINDINGS.md
roundtable reviews in reviews/
```

If a historical chat conflicts with a later accepted architecture decision, the later accepted decision wins unless explicitly reopened.

## Limitation

This ledger is based on the conversation/project context available during this documentation pass.

Before claiming a repository implementation detail, verify the live Git repository.
