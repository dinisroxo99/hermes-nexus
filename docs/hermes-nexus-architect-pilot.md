# Architect-only Hermes Nexus pilot gates

Status: implementation and verification runbook. This document does not claim that
the plugin is installed, enabled, exposed in a worker, connected to a running Nexus
service, or proven by a live pilot.

## Boundary

The tracked plugin in `integrations/hermes-nexus/` is a small HTTP client for exactly
two read-only operations:

- `project_task_context` maps to
  `POST /api/intelligence/projects/:projectId/task-context`.
- `project_impact` maps to
  `POST /api/intelligence/projects/:projectId/impact`.

Nexus remains the sole owner of project discovery and persisted identity,
Git/worktree/revision observation, ICM, analyzer and Serena policy, Context Pack
selection, Impact computation, reobservation, and domain/transport byte budgets.
The plugin validates its strict tool inputs, sends one bounded request, sanitizes
transport failures, and verifies the returned identity and provenance before it
exposes data. It does not discover projects, inspect Git, retry, cache, trim domain
results, or infer safety. Existing `project_map_*` tools are unchanged.

This pilot is restricted to a clean, available linked worktree with an explicit
persisted project ID, locator, full commit, branch (or explicit detached `null`),
and clean/linked assertions. `expectedRevision` is a client acceptance condition.
It is never sent to Nexus. A stale request can cause read-only server computation,
but mismatching response data is withheld. This is not server-side compare-and-swap
or an atomic snapshot.

## Gate order

Run the gates in this order and stop at the first failure:

1. G1: independent implementation tests and review.
2. G2: separately authorized architect-only installation and configuration.
3. G3: fresh architect Kanban worker runtime-exposure proof.
4. O1: approved local Nexus operational-readiness proof.
5. G4/G4V: live Task Context pilot and independent validation.
6. G5/G5V: fresh Context-first Impact pilot and independent validation.

Passing one gate does not imply that a later gate passed. Unit tests and
`httpx.MockTransport` are not live Nexus proof. No gate in this runbook authorizes
Step 4, Effective Scope, Conflict Engine, Guard, push, merge, release, deployment,
global rollout, service start/restart, registry mutation, or cleanup.

## G1 — immutable implementation verification

Provision an independent review workspace at the implementation SHA. Confirm the
root, attached branch/SHA, clean index/worktree, and applicable `AGENTS.md` before
running anything. Do not use a globally installed test dependency. Verify the
existing Hermes interpreter rather than assuming a venv spelling; in the current
installation it resolves from:

```text
/home/dinis/.hermes/hermes-agent/venv/bin/python
```

Run:

```text
/home/dinis/.hermes/hermes-agent/venv/bin/python -B -m unittest discover -s tests/hermes_nexus_plugin -p 'test_*.py'
node --test tests/task-context-routes.test.js tests/task-context.test.js tests/task-context-providers.test.js tests/project-impact-routes.test.js tests/project-impact-service.test.js tests/project-impact.test.js tests/impact-policy.test.js tests/projects.test.js tests/project-revision.test.js
npm test
npm run check
git diff --check
```

If `node_modules` is absent, first verify `package.json` and `package-lock.json`
against the accepted baseline. Only a deterministic `npm ci` is permitted, and the
manifests and cleanliness must be checked again afterward. Record exact pass/fail/
skip counts. Opt-in real Docker/Serena cases may remain skipped, but the skip count
must be reported and mocks must not be called live Serena proof.

Independent review must verify:

- only the approved plugin, test, and runbook files changed;
- the four required commits pair behavior with tests and retain their order;
- no package manifest, Nexus server, Hermes core, profile, registry, or service was
  changed;
- both schemas reject unknown fields at every object level and handlers validate
  again before HTTP;
- both operations issue exactly one POST, with `projectId` only in the route and
  no `expectedRevision` on the wire;
- transport is loopback-only, bounded, no-proxy, no-redirect, no-retry, and closes
  resources on success, failure, timeout, and cancellation;
- server error text and unexpected exceptions cannot escape static errors;
- missing response metadata fails as invalid, incompatible versions fail closed,
  and identity mismatch returns no domain data;
- Context `revision.repositoryIdentity` maps to the expected/Impact
  `revision.repositoryId`, while `worktreeId` remains identical;
- additive Nexus data, partial/incomplete/truncated flags, provenance, witnesses,
  completeness, and source hashes survive unchanged.

## G2 — architect-only installation (separate authorization required)

Before changing external state, record the accepted implementation SHA and hashes
of all five runtime files:

```text
plugin.yaml
__init__.py
schemas.py
client.py
tools.py
```

Verify the effective profile home is exactly
`/home/dinis/.hermes/profiles/architect`. Copy those files into the flat directory
`/home/dinis/.hermes/profiles/architect/plugins/hermes-nexus/`; do not symlink to a
moving worktree. Verify copied hashes against the accepted commit.

Use supported profile-pinned commands rather than editing YAML by hand:

```text
hermes -p architect config set plugins.entries.hermes-nexus.settings.base_url http://127.0.0.1:8770
hermes -p architect plugins enable hermes-nexus
hermes -p architect config set platform_toolsets.cli '[clarify, delegation, file, skills, terminal, todo, web, project_intelligence]'
```

The last list is the architect profile list observed when this contract was
written. Re-read it at installation time. Preserve every then-existing entry and
append `project_intelligence` exactly once instead of overwriting unrelated
choices.

Read back and prove the profile home, source SHA/hashes, plugin key/version,
`provides_tools` list, enabled entry, base URL, selected CLI toolsets, and absence
of a disabled veto. Record the precise non-secret config-key diff and normal Hermes
CLI artifacts. Do not read `.env`, `auth.json`, tokens, passwords, or credentials.
Do not enable the plugin or toolset for default, workspace-manager, orchestrator,
implementer, tester, reviewer, or documenter. Do not use a global toggle.

Rollback, if separately authorized, is architect-only: disable `hermes-nexus` and
remove only `project_intelligence` from the architect profile's saved CLI list,
preserving unrelated entries. Installation does not prove runtime exposure.

## G3 — fresh architect worker exposure

Dispatch a new real Kanban worker assigned to the `architect` profile after G2.
The worker must not call Nexus or browse the target repository in this gate. Record
its task/run/session identifiers, profile, effective profile home, selected
toolsets, and installed artifact version/hashes.

Inspect both its native tool surface and deferred catalog, then describe the exact
schemas for:

- `project_task_context`
- `project_impact`

Acceptance requires both strict schemas to be callable async tools in
`project_intelligence`. The worker must show the required persisted ID, explicit
linked locator, expected revision shapes, unknown-field rejection, and the
Context-versus-Impact opaque-ID difference. Existing `project_map_*` tools, if
independently present, must remain unchanged; their absence in architect is not a
reason to install them.

A plugin-load report, registration unit test, curl command, old worker, or stale
session is not exposure proof. If dispatch pinned stale toolsets or plugin loading
failed, stop and diagnose Hermes configuration under separate authority. Do not
patch Nexus or Hermes core during this gate.

## O1 — operational readiness (before any live pilot)

The pilot needs an already authorized and reachable local Nexus. This runbook does
not authorize starting, restarting, deploying, or reconfiguring it. Prove:

- the configured URL is the literal approved loopback URL;
- the service runs accepted server source
  `4d8d23e564e355d84916b93d890762ac0c7498ee`, not an older main build;
- the existing persisted project ID is
  `prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd` with canonical record locator
  `{rootId:"local",relativePath:"hermes-project-map"}`;
- the active service's local root maps to `/home/dinis/projects` in its own
  namespace, and it can access canonical Git metadata plus the selected checkout;
- the analysis target is the preserved
  `/home/dinis/projects/hermes-impact-v2-correct-mc7`, locator
  `{rootId:"local",relativePath:"hermes-impact-v2-correct-mc7"}`, attached
  `feat/impact-v2`, clean at the accepted SHA.

Do not recreate the project, register the worktree as another project, compute
opaque IDs locally, omit the linked locator, or substitute the advancing plugin
writer/main checkout. The locator is conditional until the live root mapping is
proven. Health alone does not prove the served SHA. If any prerequisite is absent,
block with the exact service/registry/root/mount need.

## G4 — live Task Context pilot

Use a fresh actual architect Kanban worker whose workspace is the approved analysis
target. Identify runtime-injected task and `AGENTS.md` material as bootstrap context.
After coordination/schema inspection, the first domain action must be the injected
`project_task_context` tool—not terminal HTTP, a local library call, Git, search,
or repository browsing.

Request (replace `<pilot-card-id>` with the actual card ID):

```json
{
  "projectId": "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  "worktree": {
    "rootId": "local",
    "relativePath": "hermes-impact-v2-correct-mc7"
  },
  "expectedRevision": {
    "status": "available",
    "commitSha": "4d8d23e564e355d84916b93d890762ac0c7498ee",
    "branch": "feat/impact-v2",
    "dirty": false,
    "isLinkedWorktree": true
  },
  "task": {
    "id": "<pilot-card-id>",
    "title": "Assess the existing Nexus Task Context and Impact HTTP boundaries",
    "description": "Explain route-to-service ownership and identify focused verification for the read-only architect thin client; do not implement or start Step 4.",
    "paths": [
      "src/routes/task-context.routes.js",
      "src/routes/project-impact.routes.js"
    ]
  },
  "includeExcerpts": false
}
```

Do not guess opaque IDs on this first call. Record the invocation ID/time, worker
identity, safe request, tool/HTTP outcome, exact project/locator, complete revision
including `repositoryIdentity` and `worktreeId`, `contextPackId`, analysis
provider/id/version/kind/status/coverage/attempts/provenance/snapshot token,
observation/source digest/incomplete, every section status/truncated/provenance,
limits, and `generatedAt`. Preserve a bounded real result artifact/transcript
reference. When Hermes returns only a preview, retrieve and log the complete stored
tool result; an unread spill path is not consumption proof.

First assess whether Nexus output is sufficient. A narrower resubmission or
`includeExcerpts:true` is allowed only after recording the insufficiency, and must
use the same identity plus both accepted opaque IDs. Record every resulting pack.
Only after Nexus remains insufficient may the worker read the repository. For each
read, record the tool invocation, exact relative path and line interval (or search
path/glob/query/results), missing evidence, and why the pack could not answer it.
Never read secrets or broadly dump the repository. Explicitly report zero fallback
reads when none are needed.

G4 passes only if the actual tool succeeds, every identity check matches, complete
provenance is retrievable, the assessment cites pack evidence, partial/truncated
states remain honest, and every fallback read is accounted for. Independent
G4V tester/reviewer checks the transcript and artifacts without enabling the
plugin in their own profiles. A mismatch or server 409 blocks immediately and
forbids the Impact call.

## G5 — fresh Context-first Impact pilot

Only after G4V, dispatch another fresh architect worker with the accepted Context
handoff. In the new session, first call `project_task_context` again with the same
semantic request and both opaque IDs from G4 in `expectedRevision`. Compare the
project, locator, full commit, branch, clean/linked state, repository identity, and
worktree identity. Record the new `contextPackId`. If this call fails, do not call
Impact.

Then call `project_impact`:

```json
{
  "projectId": "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  "worktree": {
    "rootId": "local",
    "relativePath": "hermes-impact-v2-correct-mc7"
  },
  "expectedRevision": {
    "status": "available",
    "commitSha": "4d8d23e564e355d84916b93d890762ac0c7498ee",
    "branch": "feat/impact-v2",
    "dirty": false,
    "isLinkedWorktree": true,
    "repositoryId": "<fresh-context-revision.repositoryIdentity>",
    "worktreeId": "<fresh-context-revision.worktreeId>"
  },
  "paths": [
    "src/routes/task-context.routes.js",
    "src/routes/project-impact.routes.js"
  ],
  "includeTests": true
}
```

Do not send `contextPackId` or `expectedRevision` to Nexus HTTP; the plugin removes
the acceptance object from the server body. Cross-tool correlation belongs in the
evidence log.

Record the real invocation and complete unchanged Impact data: project/locator,
revision IDs and safe fields, `worktree.worktreeId`, snapshot token,
provider/coverage, observation, status/finding state, targets or `originPath`, all
completeness dimensions and target-specific completeness, limits, affected files,
origins/witnesses/trust/basis/hashes/origin summaries, and affected-test candidate
provenance. `no_evidence_found` means lack of evidence, never no impact or safe to
edit. Affected tests are candidates, not executed coverage.

G5V independently verifies the worker transcript, Context-before-Impact order,
identity continuity, truthful partial/completeness/witness reporting, absence of
hidden writes/provider controls, result artifact, and fallback-read ledger. A
mismatch withholds domain data and requires operator reconciliation; never change
the expected SHA to an unexpected observed value merely to pass.

## Stop boundary

After G5V, stop. A later proposal may cover separate per-profile installation and
gates for implementer, tester, reviewer, and documenter. Do not perform that
rollout here. Default, workspace-manager, and orchestrator remain excluded, and no
global enablement is allowed.
