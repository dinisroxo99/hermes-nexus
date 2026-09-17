# Hermes Profile Catalog and Capability Model

> **Roundtable review v4:** REVISED — approved with refinements — 2026-09-17  
> Companion review: `reviews/29_PROFILE_CATALOG_AND_CAPABILITIES_ROUNDTABLE.md`


Status: **PLANNED RUNTIME CONFIGURATION**

## Boundary

Profiles belong to Hermes.

This document defines the intended roles so Project Map can return useful capability/risk hints without owning profile execution.

## Core reusable profiles

### Architect

Responsibilities:

```text
architecture analysis
task decomposition
boundary decisions
high-impact planning
review of cross-module consequences
```

Typical Project Map needs:

```text
deep Context Pack
ICM
impact graph
design memory
historical decisions
```

### Implementer

Responsibilities:

```text
production code changes
localized refactors
feature implementation
```

Needs:

```text
bounded implementation context
WRITE scope
RESERVED/WATCH summary
relevant tests
```

### Tester

Responsibilities:

```text
test planning
test implementation
failure reproduction
verification
```

Needs:

```text
affected tests
changed symbols
behavior/acceptance criteria
historical failures
```

### Reviewer

Responsibilities:

```text
diff review
architecture conformance
scope validation
regression/risk analysis
```

Needs:

```text
before/after revision
diff
ICM acceptance criteria
impact
scope
tests
decisions
```

### Documenter

Responsibilities:

```text
project docs
ADRs
technical documentation
release notes
```

### XML Commenter / Commenter

Responsibilities:

```text
small bounded documentation/comment tasks
```

These are good candidates for cheaper/local models and FAST mode.

### UI Designer

Responsibilities:

```text
UI structure
interaction design
component guidance
visual consistency
```

### UI Template Specialist

Responsibilities:

```text
reusable UI patterns/templates
design-system alignment
```

## Profile is not a model

Do not encode:

```text
architect = Codex
tester = Qwen
```

Instead:

```text
profile
→ capabilities/risk
→ runtime model policy
```

## Capability vocabulary

Candidate capabilities:

```text
architecture
code-analysis
dotnet
typescript
implementation
testing
review
security-awareness
documentation
ui-design
template-generation
repository-navigation
```

## Task routing hints

Project Map may return:

```json
{
  "requiredCapabilities": ["dotnet", "implementation"],
  "impactSeverity": "medium",
  "reviewRecommended": true,
  "executionMode": "STANDARD"
}
```

Hermes maps that to an installed profile/model policy.

## Fallback principle

Profiles can have model/provider fallback chains in Hermes.

Project Map remains unaware of provider credentials.

## Small-task policy

Avoid multi-agent fan-out when unnecessary.

Examples:

```text
XML comments
formatting
localized test update
small docs
```

should normally use:

```text
one profile
FAST mode
cheap/local model
```

## High-impact policy

Examples:

```text
public contract change
architecture refactor
cross-module feature
security-sensitive change
```

may require:

```text
architect
implementer
tester
reviewer
```

according to runtime policy.

## Acceptance criteria

- same profile works across projects;
- profile definitions contain no project-specific clone state;
- Project Map exposes capabilities/risk, not provider selection;
- simple tasks avoid unnecessary agent fan-out;
- profile/model fallback remains configurable in Hermes.

## Permission policy

Profile capability and profile permission are different.

Example:

```text
reviewer can understand production code
≠ reviewer may mutate production code
```

Autonomy/approval levels are defined in `33_GOVERNANCE_APPROVAL_AND_AUTONOMY.md`.

The runtime should expose the minimum tool set needed by each profile.
