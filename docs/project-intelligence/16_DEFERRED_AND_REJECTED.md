# Deferred and Rejected Ideas

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/16_DEFERRED_AND_REJECTED_ROUNDTABLE.md`


This file exists to stop old ideas from silently returning to the implementation.

## REJECTED — Build a complete new agent framework now

Do not recreate Hermes runtime.

Avoid implementing from scratch:

```text
SOUL engine
profile runtime
provider runtime
session runtime
general agent dispatcher
```

## REJECTED — Put model/provider routing inside Project Map

Project Map should expose required context/capability/risk.

Hermes/runtime chooses the execution model.

## REJECTED — Create N agent profiles per project

Use reusable profiles:

```text
architect
implementer
tester
reviewer
...
```

Bind project/task context per run.

## REJECTED — Treat ICM folders as agents

Folders/stages represent workflow/context.

Profiles represent role/capability.

## REJECTED — Build a new Kanban/Taiga clone first

Reuse Hermes Kanban unless a concrete missing requirement is demonstrated.

## REJECTED — Hard-lock every impacted/reference file

Use:

```text
WRITE
RESERVED
WATCH
IMPACT
```

to preserve parallelism.

## REJECTED — Trust agent prompts as the only lock

Enforce mutation scope using runtime/plugin checks.

## REJECTED — Use Honcho as current code truth

Honcho is experiential memory.

Current code truth comes from the repository and Project Intelligence.

## REJECTED — Fine-tune project source as the first Project Expert

Start with retrieval over the current project.

Training/adapters come after clean validated data exists.

## DEFERRED — Plane / Taiga / OpenProject

These may be useful later for external organization/work management.

For the current technical agent workflow, Hermes Kanban should be evaluated first.

## DEFERRED — Agent Mail / external reservation service

Potentially useful if Hermes claims + Project Map guard are insufficient.

Do not add another coordination service before proving the gap.

## DEFERRED — Serena/other analyzer providers

Can be integrated as evidence providers, especially for language-specific semantic intelligence.

Do not replace the canonical Project Intelligence API with a provider-specific API.

## DEFERRED — Per-project LoRA/adapters

Potential future optimization for Project Expert behavior.

Requires enough validated project-specific QA/interaction data first.

## External-component policy

See `24_EXTERNAL_COMPONENT_REUSE_MATRIX.md` before integrating another coordination/context product.

The default is to add a provider/adapter only when it has a clear non-overlapping responsibility.

## Revisit triggers

Deferred items should have a reason to reopen.

Examples:

```text
Plane/Taiga/OpenProject
→ reopen only if Hermes Kanban cannot satisfy a concrete human PM requirement

Agent Mail
→ reopen if Project Map scope + Hermes guard cannot provide required reservation semantics

Per-project adapters
→ reopen after a minimum validated Project Expert dataset and baseline evaluation exist
```

Avoid revisiting components merely because they are interesting.
