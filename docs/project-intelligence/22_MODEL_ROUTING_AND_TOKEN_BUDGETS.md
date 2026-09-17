# Model Routing and Token Budgets

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/22_MODEL_ROUTING_AND_TOKEN_BUDGETS_ROUNDTABLE.md`


Status: **PLANNED RUNTIME POLICY**

## Boundary

Model/provider routing belongs to Hermes/runtime.

Project Map only supplies decision features.

## Project Map routing hints

Candidate output:

```json
{
  "taskId": "...",
  "complexity": "low|medium|high",
  "impactSeverity": "low|medium|high|critical",
  "risk": "low|normal|high",
  "estimatedContextTokens": 6200,
  "requiredCapabilities": ["dotnet", "code-edit"],
  "reviewRecommended": true,
  "executionMode": "STANDARD"
}
```

## Execution modes

### FAST

Use for bounded low-risk work.

```text
one worker
small Context Pack
local/cheap model preferred
minimal review
```

Examples:

```text
comments
small tests
localized bug
simple rename when impact is low
```

### STANDARD

Default feature flow.

```text
Context Pack
impact/scope
implementer
tests
review if policy requires
```

### DEEP

High-impact work.

```text
architect
richer Context Pack
multiple stages/profiles
stronger review
possible stronger model escalation
```

Examples:

```text
public API changes
architecture
cross-module refactors
security-sensitive work
schema/migration changes
```

## Token budget policy

Budget the context sections separately.

Example policy shape:

```text
SOUL/profile
task/ICM
Honcho memory
Project Context Pack
recent conversation
```

Do not allow one source to consume the whole context window.

## Context Pack cache

Cache/reuse task analysis by:

```text
projectId
git revision
task semantic key
analysis version
```

Architect, implementer, tester and reviewer should reuse the same validated task capsule where possible.

## Escalation policy

Do not use fallback only for provider outages.

Escalation reasons may include:

```text
rate limit
timeout
context overflow
repeated test failure
review rejection
high impact/risk
```

Project Map can report the condition; Hermes chooses the provider/model action.

## Local inference

For the current local workstation, treat heavy local inference as a queueable resource.

Initial policy:

```text
heavy local model concurrency ≈ 1
```

while cloud/NIM workers may execute in parallel according to quotas.

This is a runtime policy, not a Project Map responsibility.

## Measurement

Track by profile/task class:

```text
actual prompt tokens
actual completion tokens
tool calls
latency
first-pass success
retries
human corrections
```

Do not claim token savings until benchmarked.

## Learning later

The accumulated execution dataset can train a lightweight router/classifier that predicts:

```text
execution mode
model tier
review requirement
expected context size
```

without training a coding model.

## Routing decision record

For every non-trivial model selection, capture:

```text
requested profile
execution mode
risk/impact
estimated context
candidate tier
selected provider/model
fallback reason if changed
```

This record is training data for a future router.

## Runtime SLOs

Routing policy may optimize multiple objectives:

```text
quality floor
cost ceiling
latency target
local GPU queue pressure
provider availability
```

Project Map supplies features; Hermes/runtime owns the final trade-off.
