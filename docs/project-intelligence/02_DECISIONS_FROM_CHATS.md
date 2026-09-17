# Consolidated Decisions From Project Conversations

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/02_DECISIONS_FROM_CHATS_ROUNDTABLE.md`


This document extracts the final decisions that survived the architecture discussions.

## 1. `hermes-project-map` remains an external/shared tool

**DECISION**

The project must not become a replacement for Hermes.

It remains independently usable as a service/tool and Hermes integrates through a thin adapter/plugin/MCP surface.

```text
Hermes ──► Project Map
```

not:

```text
Project Map contains Hermes runtime
```

## 2. Project Intelligence and Agent OS remain separate

**DECISION**

`hermes-project-map` owns:

- discovery;
- registry;
- project structure;
- symbols/relationships;
- context;
- impact;
- ICM;
- Context Packs;
- scope/conflict intelligence.

Hermes owns:

- profiles;
- SOULs;
- agents;
- provider/model execution;
- sessions;
- Kanban/task lifecycle;
- worker dispatch;
- worktrees;
- runtime retries/worker state.

## 3. PROFILE != MODEL

**DECISION**

A profile expresses role/capability.

Examples:

```text
architect
implementer
tester
reviewer
documenter
ui-designer
```

Models/providers are runtime choices.

Conceptually:

```text
Task
 → Workflow / ICM stage
 → Required capabilities
 → Profile
 → Candidate model
 → Provider
```

A stage must not hard-code a provider such as OpenAI/Anthropic.

## 4. Agents are global by function, not duplicated per project

**DECISION**

Do not create:

```text
cookation-architect
gw2-architect
hermes-map-architect
```

Prefer:

```text
architect
implementer
tester
reviewer
```

Each execution receives a project-scoped context:

```text
agent profile
+ projectId
+ taskId
+ ICM
+ Project Intelligence
+ memory namespace
+ allowed scope
```

## 5. Git is the project boundary anchor

**DECISION**

Use the Git root to establish the active project boundary.

Project-specific state should be associated with a stable `projectId`, not only a folder name.

A task run should be bound to:

```text
projectId
taskId
git root
git revision
worktree
scope
```

## 6. ICM is workflow/context, not the agent runtime

**DECISION**

ICM answers:

```text
WHAT
WHEN
INPUTS
PROCESS
OUTPUTS
CONSTRAINTS
SUCCESS CRITERIA
```

Hermes/orchestration answers:

```text
WHO
WHICH MODEL
TOOLS
PARALLELISM
FALLBACK
EXECUTION
```

Do not model folders as agents.

## 7. `AGENTS.md` is bootstrap; ICM `CONTEXT.md` is explicit

**DECISION**

Do not depend on arbitrary `CONTEXT.md` files being automatically loaded by the runtime.

The Project Map must explicitly discover/parse/resolve ICM context.

## 8. Context must be selective and bounded

**DECISION**

The system should not dump the full repository graph into the prompt.

Build a selective Context Pack using:

```text
task
+ ICM
+ symbols
+ graph
+ impact
+ relevant decisions
+ limited history
```

Target size should be policy-driven rather than unlimited.

## 9. Impact must drive coordination

**DECISION**

Do not simply lock all referenced files.

The scope resolver produces:

```text
WRITE
RESERVED
WATCH
IMPACT
```

using evidence such as:

- requested scope;
- symbol relationships;
- dependency distance;
- change type;
- transitive impact;
- affected tests;
- current tasks.

## 10. Hermes Kanban should be reused

**DECISION**

Do not build a new Taiga/Jira-like task system unless Hermes proves insufficient.

Reuse Hermes for:

- board/UI;
- tasks;
- dependencies;
- claims;
- dispatcher;
- workers;
- worktrees;
- task lifecycle.

Project Map enriches those tasks with code-aware intelligence.

## 11. Enforcement happens through a thin Hermes guard

**DECISION**

Project Map calculates the policy.

A Hermes integration/plugin enforces it.

Expected hook responsibilities:

```text
task claimed
  → resolve task/project context

pre LLM
  → inject bounded project context

pre tool
  → reject out-of-scope mutations

task completed
  → validate / record outcome
```

## 12. Honcho is memory, not project truth

**DECISION**

Honcho can store:

- agent/user preferences;
- long-term experiential memory;
- useful cross-session observations.

It must not be treated as the authoritative source of current code facts.

Current facts come from:

```text
Git revision
Project Intelligence
ICM / canonical project docs
```

## 13. Project Expert is read-only

**DECISION**

Introduce a project-specific expert/oracle that other agents can query.

It can use:

```text
Project Intelligence
ICM
ADRs
task/history data
execution logs
RAG
small local model
```

It cannot:

```text
write code
commit
merge
mutate project truth
```

Primary tool concept:

```text
ask_project(...)
```

## 14. Capture execution data from the beginning

**DECISION**

Store structured events, not only text logs.

The data should later support:

- analytics;
- token-efficiency measurement;
- routing improvement;
- context ranking;
- project historical QA;
- future fine-tuning/distillation.

## 15. Do not train project source directly as the first approach

**DECISION**

Current/volatile project truth should stay retrieval-based.

Use:

```text
small/general model
+ project retrieval
+ graph
+ historical data
```

Later, optionally train/adapt the model on validated project QA/behavior data.

## Decision identifiers

Future changes should refer to stable decision IDs.

Suggested mapping:

```text
D-001 external/shared Project Map
D-002 Hermes owns runtime
D-003 profile != model
D-004 global reusable profiles
D-005 Git/project identity boundary
D-006 ICM = workflow/context
D-007 explicit ICM resolution
D-008 bounded Context Packs
D-009 impact-aware coordination
D-010 reuse Hermes Kanban
D-011 thin guard enforcement
D-012 Honcho != project truth
D-013 Project Expert read-only
D-014 structured execution data
D-015 retrieval-first Project Expert
```

If a decision changes, mark it `SUPERSEDED` rather than rewriting history silently.
