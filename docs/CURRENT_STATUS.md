# Current status

[Home](../README.md) · [Vision](VISION.md) · [Concepts](CONCEPTS.md) · [Architecture](ARCHITECTURE.md)

## Verification boundary

This is a **repository snapshot**, not a release announcement or a live view of
another checkout.

- Repository: `dinisroxo99/hermes-project-map`.
- Base branch inspected: `feat/project-intelligence-service`.
- Pinned base commit: `6b9c53cb3ed30090b5a5958ae7ce61f9f6815085`
  (`6b9c53c`, `feat: adapt native analyzers to normalized providers`).
- Documentation prepared on `docs/project-intelligence-public-overview`, in an
  isolated worktree derived from that commit.
- Evidence: committed source, route registration, tests and recent Git history
  at that base. Uncommitted work and later commits in other sessions are excluded.

**Phase 2.5 is IN PROGRESS. Refresh CURRENT_STATUS after Phase 2.5 is merged.**
The base includes partial analyzer-provider work, not a verified completion of
that phase. This document deliberately does not predict its final interface,
coverage or test outcome.

Status labels used in the public docs:

- **Implemented:** present in the pinned source; limitations still apply.
- **In progress:** partial work, not a completed end-to-end capability.
- **Planned:** target design, not a current service feature.
- **Deferred:** not part of the near-term implementation.

## Implemented foundation

Paths below link to source/tests for inspection, not claims that every test or
runtime dependency works on every platform.

| Capability | Present at the base | Evidence |
|---|---|---|
| Local HTTP service and graph UI | Project listing/structure, search, graph expansion, indexing/cache operations and static UI. | [Server routes](../src/server.js), [exploration handlers](../src/routes/explore.routes.js) |
| Code analysis and graph intelligence | .NET and initial TypeScript analysis; existing bounded node-based impact, symbol context and insights. Not Impact v2. | [Analyzer service](../src/lib/analyzer-service.js), [graph intelligence](../src/lib/graph-intelligence.js), [tests](../tests/analyzer-service.test.js) |
| Configuration and discovery | Trusted roots, manual/discovered registry separation, bounded discovery, guarded explicit registration and compact overview. | [Intelligence routes](../src/routes/intelligence.routes.js), [discovery tests](../tests/project-discovery.test.js), [registry tests](../tests/project-registry.test.js) |
| Stable identity and Git/worktree evidence | Persisted project IDs, ambiguity rejection, verified parent-worktree resolution and revision/worktree-aware caches. Legacy ID-less records remain supported outside ID-required workflows. | [Project resolution](../src/lib/projects.js), [revision reader](../src/lib/project-revision.js), [revision tests](../tests/project-revision.test.js), [cache tests](../tests/analysis-cache.test.js) |
| Canonical ICM foundation | `AGENT.md` front-matter parsing, Workspace Index, contextual document index and combined Project ICM Index. No persistent ICM store. | [ICM composer](../src/lib/icm-index.js), [ICM tests](../tests/icm-index.test.js) |
| Workspace declarations and path matching | Deterministic matching of task paths to declared workspace include/exclude scope. Not authorization or reservation. | [Scope matcher](../src/lib/workspace-scope.js), [matching tests](../tests/workspace-scope.test.js) |
| Task Context Pack | Read-only projectId-based POST; bounded source observations, selected ICM/code/test evidence, provenance, revision/change checks and omission indicators. No LLM, runtime dispatch or persistent pack cache. | [Builder](../src/lib/task-context.js), [route](../src/routes/task-context.routes.js), [pack tests](../tests/task-context.test.js), [HTTP tests](../tests/task-context-routes.test.js) |

### Current intelligence endpoints

Verified from [route registration](../src/routes/intelligence.routes.js):

```text
GET  /api/intelligence/discover
POST /api/intelligence/discover/register
GET  /api/intelligence/projects/:name/overview
POST /api/intelligence/projects/:projectId/task-context
```

Registration is a guarded state-changing operation, disabled by default. The
other operations above do not enroll projects. The task-context POST is
read-only despite using POST; it requires an existing persisted projectId.

Existing graph routes under `/api/explore/:project/` are separate from the
newer intelligence contracts. There is no dedicated ICM HTTP endpoint or
implemented task-scope/conflict API at this base. An HTTP endpoint does not imply
an installed Hermes tool or automatic context injection.

### Important limitations

- **Context coverage:** selection is bounded, not exhaustive. Test candidates
  are heuristic, not a coverage guarantee. Direct references are not the planned
  Impact v2 result.
- **Platform:** Task Context Pack source retrieval requires Linux/WSL
  `/proc/self/fd` descriptor verification. Unavailable verification fails closed
  to partial metadata-only evidence rather than using weaker path checks.
- **Freshness:** packs describe bounded working-tree observations, with explicit
  dirty/unborn/non-Git/unavailable states and observed-change rejection. They
  are not immutable, whole-repository snapshots. Their source digest does not
  cover every file in the checkout.
- **Trust:** contextual prose is untrusted text. Structured ICM constraints are
  declared-only; no effective WRITE authorization or runtime enforcement exists.
- **Identity:** reads do not migrate ID-less registry entries. Moves require
  explicit locator maintenance; local checkout hashes are not stable project IDs.
- **Language support:** legacy project-type dispatch supports .NET and initial
  TypeScript; Node.js/Python detection is not a dedicated analyzer. Bounded
  context extraction can use JavaScript through the TypeScript analyzer. Do not
  infer complete mixed-language or semantic coverage; provider behavior is part
  of the Phase 2.5 refresh.
- **Integration:** low-level `project_map_*` plugin setup is documented, not
  bundled proof of installation in a Hermes profile. High-level tools, an MCP
  adapter and the automatic task guard are not verified service deliverables.
- **Security:** the local server binds to all interfaces by default. Safe source
  retrieval is not an agent sandbox or a hardened public deployment guarantee.

For exact bounds and errors, use the
[Context Pack contract](project-intelligence/04_ICM_AND_CONTEXT_PACK.md),
[identity contract](project-intelligence/18_PROJECT_IDENTITY_AND_ISOLATION.md)
and [service reference](SERVICE_REFERENCE.md).

## In progress: Phase 2.5

The pinned history includes:

| Commit | Verified committed work |
|---|---|
| `c448910` | Analyzer-provider capability contract and snapshot-language detection, with tests. |
| `6b9c53c` | Native analyzers adapted to normalized provider evidence, with tests. |

These are partial milestones only. No claim is made here that the final
provider integration, external adapters or broader language coverage is complete.
Implementation-specific Phase 2.5 documents and active plans are not changed by
this public documentation work.

Earlier stable checkpoints explain why Task Context Packs are listed as present:

- `34b4e24`: read-only task-context API.
- `93e2dd3`: task-context isolation and bounded-output tests.
- `5faa91e`: bounded Task Context Pack contract documentation.
- `8b4fb08`: Task Context Pack checkpoint documentation.

These are Git evidence anchors, not substitutes for testing the revision a
reader actually checks out.

## Planned, not implemented here

| Capability | Intended addition / owner boundary |
|---|---|
| Impact v2 | Task/file-oriented impact and affected-test evidence for coordination. Existing graph impact is only the earlier foundation. |
| Effective Task Scope | Revision-bound WRITE / RESERVED / WATCH / IMPACT classifications beyond declared workspace matching. |
| Conflict Intelligence | Compare concurrent task scopes and explain semantic overlap; Hermes retains scheduling. |
| Hermes guard integration | Automatic context preparation, mutation checks and outcome handling on the Hermes side. |
| Broader identity integration | Board/task/run bindings and project-scoped historical namespaces, beyond basic project/worktree identity. |
| Project telemetry/history | Ingest Hermes-owned runtime records and attach project/revision/context/scope evidence. |
| Read-only Project Expert | Evidence-backed retrieval over current code, ICM, active ADRs and validated history. |
| Knowledge admission and drift | Validate observations, track supersession and keep proposals separate from implemented facts. |
| Learning and evaluation | Evaluate quality/context/coordination outcomes; export validated datasets only under suitable privacy controls. |

Model/provider execution, profiles, Kanban, workers, sessions, retries and
worktree lifecycle belong to Hermes. They are not a backlog for implementation
inside this service. Project-specific model training/adapters are deferred;
volatile code should remain retrieval-based.

## Refresh after Phase 2.5

After the phase is merged and verified on the intended base:

1. Record the new branch/commit and inspect its source, routes and tests.
2. Re-run `npm test`, `npm run check` and `git diff --check`; record actual results,
   including platform-dependent skips. Do not reuse a historical test count.
3. Refresh this snapshot and the short status in [README](../README.md).
4. Check provider/language/coverage statements in this document and
   [Service reference](SERVICE_REFERENCE.md) against the actual implementation.
5. Reconcile any affected Context Pack descriptions in the public concepts and
   architecture overview with the canonical technical contract. Have the phase
   owner update implementation-specific contracts and checkpoints as needed.

The active implementation plan remains the implementation authority. The
[technical roadmap](project-intelligence/09_IMPLEMENTATION_ROADMAP.md) expresses
broader sequencing; historical phase numbering is not a single release series.
