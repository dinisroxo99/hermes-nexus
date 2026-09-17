# Knowledge Precedence and Drift Rules

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/28_KNOWLEDGE_PRECEDENCE_AND_DRIFT_ROUNDTABLE.md`


Status: **PLANNED**

## Goal

Define which source wins when multiple agents, memories, documents or historical records disagree.

This is essential for reliable Project Expert answers.

## Source hierarchy

For claims about **current code/runtime structure**, use:

```text
1. Current Git revision + analyzer evidence
2. Canonical machine-readable project contract
3. Canonical project documents / ADRs / ICM
4. Current Hermes task state
5. Validated project observations
6. Honcho / experiential memory
7. Historical run text
8. Draft/proposed design memory
```

Lower-priority sources must not override higher-priority current evidence.

## Examples

### Example A

Honcho says:

```text
"RecipeService implements IRecipeService"
```

but current code does not.

Result:

```text
current code wins
memory is stale
```

### Example B

An old ADR says:

```text
"Use SQL Server"
```

but a newer superseding ADR and current configuration use PostgreSQL.

Result:

```text
new canonical evidence wins
old ADR is historical
```

### Example C

A proposed design says:

```text
"Move Auth into a separate service"
```

but it is not implemented.

Result:

```text
label as proposal
do not answer as current architecture
```

## Claim metadata

Project Expert evidence should carry:

```text
source type
source id
projectId
revision or revision range
timestamp
status
confidence
```

## Drift categories

### Code drift

The source/code has changed since the claim was generated.

### Architecture drift

A decision/document no longer matches current implementation.

### Task drift

A Context Pack/scope was built against an earlier revision/worktree state.

### Idea drift

A proposal was based on a project snapshot that has materially changed.

### Historical drift

A learned observation is no longer predictive/useful.

## Drift handling

Possible statuses:

```text
CURRENT
STALE
SUPERSEDED
CONFLICTING
NEEDS_REVALIDATION
HISTORICAL
```

## Revision-aware cache rule

Derived artifacts such as:

```text
Context Pack
impact
scope
Project Expert retrieval cache
```

must be keyed by or validated against the repository revision.

## Confidence

Confidence is not a substitute for evidence.

A high-confidence LLM statement with no current evidence remains weaker than direct analyzer evidence.

## Project Expert answer policy

When evidence conflicts:

1. State the current verified result.
2. Mention the historical/proposed conflicting record only if relevant.
3. Label its status.
4. Do not average conflicting facts into an ambiguous answer.

## Acceptance criteria

- stale memory cannot override current code;
- proposed architecture cannot appear as implemented;
- superseded ADRs are traceable;
- stale Context Packs/scopes are detected;
- every durable Project Expert claim can be traced to evidence.

## Expiry and revalidation

Some evidence requires explicit freshness policy even if no Git revision changed, for example:

```text
external API behavior
provider limits
dependency documentation
operational environment facts
```

Claims should support:

```text
expiresAt
revalidateAfter
```

where appropriate.

## Conflict registry

Persistent unresolved evidence conflicts should be queryable rather than repeatedly rediscovered.
