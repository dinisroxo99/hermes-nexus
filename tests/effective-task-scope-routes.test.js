import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";

import { composeEffectiveTaskScopeFromEnvelopes } from "../src/lib/effective-task-scope-adapter.js";
import { normalizeEffectiveTaskScopeRequest } from "../src/lib/effective-task-scope-policy.js";
import { createEffectiveTaskScopeHandler } from "../src/routes/effective-task-scope.routes.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { createProjectImpactHandler } from "../src/routes/project-impact.routes.js";
import { createTaskContextHandler } from "../src/routes/task-context.routes.js";
import { createRouter } from "../src/utils/router.js";

const SUCCESS_MESSAGE = "Effective task scope constructed.";
const ERROR_MESSAGE = "Effective task scope could not be constructed safely.";
const PROJECT_ID = "prj_fixture";

function evidence() {
  const revision = {
    status: "available", commitSha: "a".repeat(40), branch: "fixture",
    dirty: false, isLinkedWorktree: true,
    repositoryId: "b".repeat(64), worktreeId: "c".repeat(64)
  };
  const task = { id: "fixture", title: "Adapter fixture", paths: ["src/a.js"], symbols: [] };
  const project = { rootId: "fixture", relativePath: "fixture" };
  const provider = { id: "native.typescript", version: "1" };
  const pack = {
    schemaVersion: 1, analysisVersion: "task-context-v1", contextPackId: "fixture",
    projectId: PROJECT_ID, project,
    revision: { ...revision, repositoryIdentity: revision.repositoryId },
    analysis: { snapshotToken: "fixture", provider },
    observation: { incomplete: false, sourceDigest: "fixture", digestCoverage: "bounded_collected_sources" },
    sections: { task: { items: [task] } }
  };
  const witness = {
    id: "fixture-edge", provider, capability: "dependencies", relationshipKind: "imports",
    source: { path: "src/b.js", hash: "d".repeat(64) },
    location: null, trust: "derived_analysis", basis: "structural"
  };
  const impact = {
    schemaVersion: 1, analysisVersion: "impact-v2", projectId: PROJECT_ID,
    project, revision: { ...revision }, snapshotToken: "fixture", provider,
    targets: [{ originPath: "src/a.js", targetSource: { path: "src/a.js", hash: "e".repeat(64) } }],
    status: "available", findingState: "evidence_found", observation: { incomplete: false },
    affectedFiles: [{ path: "src/b.js", origins: [{ originPath: "src/a.js", minimumDistance: 1, witness }] }],
    affectedTests: { status: "available", findingState: "no_evidence_found", candidates: [] },
    completeness: { source: [], provider: [], traversal: [], output: [] }
  };
  return { revision, task, project, pack, impact };
}

function validBody() {
  const { revision, task, project } = evidence();
  return {
    task,
    worktree: project,
    expectedRevision: { ...revision },
    includeTests: true,
    changeSemantics: { category: "local_implementation" }
  };
}

function responseRecorder() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

function requestFrom(body, url) {
  const raw = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const req = Readable.from([raw]);
  req.method = "POST";
  req.url = url;
  req.headers = { host: "localhost", "content-type": "application/json" };
  return req;
}

function dependencies(extra = {}) {
  const { pack, impact } = evidence();
  return {
    getProjectConfig: () => ({ dataDir: "/registry" }),
    getConfiguredProjectRoots: () => [{ id: "fixture", path: "/projects" }],
    buildProjectTaskContext: () => pack,
    buildProjectImpact: () => impact,
    ...extra
  };
}

async function invoke(body, extra = {}, id = PROJECT_ID) {
  const req = requestFrom(body, `/api/intelligence/projects/${id}/effective-task-scope`);
  const res = responseRecorder();
  await createEffectiveTaskScopeHandler(dependencies(extra))(req, res, { projectId: id });
  return { res, payload: JSON.parse(Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.body) };
}

async function invokeSibling(kind, body, code, id) {
  const res = responseRecorder();
  const thrown = () => { throw Object.assign(new Error("/private/provider/details"), { code }); };
  if (kind === "impact") {
    const req = requestFrom(body, `/api/intelligence/projects/${id}/impact`);
    await createProjectImpactHandler({
      getProjectConfig: () => ({ dataDir: "/registry" }),
      getConfiguredProjectRoots: () => [{ id: "fixture", path: "/projects" }],
      buildProjectImpact: thrown
    })(req, res, { projectId: id });
  } else {
    const req = requestFrom(body, `/api/intelligence/projects/${id}/task-context`);
    await createTaskContextHandler({
      getProjectConfig: () => ({ dataDir: "/registry" }),
      getConfiguredProjectRoots: () => [{ id: "fixture", path: "/projects" }],
      buildProjectTaskContext: thrown
    })(req, res, { projectId: id });
  }
  return { res, payload: JSON.parse(Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.body) };
}

test("effective task scope route returns the composer object for a bound request", async () => {
  const { pack, impact } = evidence();
  const body = validBody();
  let taskCall;
  let impactCall;
  const result = await invoke(body, {
    buildProjectTaskContext(input, options) {
      taskCall = { input, options };
      return pack;
    },
    buildProjectImpact(projectId, input, options) {
      impactCall = { projectId, input, options };
      return impact;
    }
  });
  const request = normalizeEffectiveTaskScopeRequest({ ...body, projectId: PROJECT_ID });
  const expected = composeEffectiveTaskScopeFromEnvelopes(request, {
    pack: { ok: true, data: pack, message: "Task context constructed." },
    impact: { ok: true, data: impact, message: "Project impact constructed." }
  });

  assert.equal(result.res.status, 200);
  assert.equal(result.res.headers["cache-control"], "no-store");
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.message, SUCCESS_MESSAGE);
  assert.deepEqual(result.payload.data, JSON.parse(JSON.stringify(expected)));
  assert.equal(result.payload.data.schemaVersion, 2);
  assert.equal(result.payload.data.analysisVersion, "effective-task-scope-v2");
  assert.equal(result.payload.data.policyVersion, "step4-foundation-6");
  assert.equal(result.payload.data.reserved.status, "not_evaluated");
  assert.deepEqual(result.payload.data.reserved.items, []);
  assert.deepEqual(result.payload.data.reserved.reasons, ["coupling_evidence_not_supported"]);
  assert.deepEqual(taskCall.input, { projectId: PROJECT_ID, task: { id: "fixture", title: "Adapter fixture", paths: ["src/a.js"], symbols: [] } });
  assert.equal(Object.hasOwn(taskCall.input, "worktree"), false);
  assert.equal(Object.hasOwn(taskCall.input, "expectedRevision"), false);
  assert.deepEqual(impactCall, {
    projectId: PROJECT_ID,
    input: {
      paths: ["src/a.js"],
      repositoryId: "b".repeat(64),
      worktreeId: "c".repeat(64)
    },
    options: taskCall.options
  });
  assert.equal(Object.hasOwn(impactCall.input, "worktree"), false);
  assert.equal(Object.hasOwn(impactCall.input, "expectedRevision"), false);
  assert.equal(Object.hasOwn(impactCall.options, "analyzer"), false);
  assert.deepEqual(impactCall.options.registry, {
    roots: [{ id: "fixture", path: "/projects" }],
    manualProjectsFile: "/registry/projects.json",
    discoveredProjectsFile: "/registry/discovered-projects.json"
  });
});

test("effective task scope route omits repository ids unless the pack returned both", async () => {
  const { pack, impact } = evidence();
  const withoutIds = structuredClone(pack);
  delete withoutIds.revision.repositoryId;
  delete withoutIds.revision.worktreeId;
  let impactInput;
  await invoke(validBody(), {
    buildProjectTaskContext: () => withoutIds,
    buildProjectImpact(_projectId, input) {
      impactInput = input;
      return impact;
    }
  });
  assert.deepEqual(impactInput, { paths: ["src/a.js"] });
});

test("effective task scope route keeps RESERVED not_evaluated and omits containers when unevaluated", async () => {
  const { pack, impact } = evidence();
  impact.status = "unsupported";
  const result = await invoke(validBody(), {
    buildProjectTaskContext: () => pack,
    buildProjectImpact: () => impact
  });
  assert.equal(result.res.status, 200);
  assert.equal(result.payload.data.status, "not_evaluated");
  for (const key of ["write", "reserved", "watch", "impact"]) {
    assert.equal(Object.hasOwn(result.payload.data, key), false, key);
  }
  const evaluated = evidence();
  const pinned = await invoke(validBody(), {
    buildProjectTaskContext: () => evaluated.pack,
    buildProjectImpact: () => evaluated.impact
  });
  assert.equal(pinned.payload.data.reserved.status, "not_evaluated");
  assert.deepEqual(pinned.payload.data.reserved.items, []);
  assert.deepEqual(pinned.payload.data.reserved.reasons, ["coupling_evidence_not_supported"]);
});

test("effective task scope route rejects a body projectId before evidence calls", async () => {
  let calls = 0;
  const result = await invoke({ ...validBody(), projectId: "prj_other" }, {
    buildProjectTaskContext: () => { calls += 1; return evidence().pack; },
    buildProjectImpact: () => { calls += 1; return evidence().impact; }
  });
  assert.equal(result.res.status, 400);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "invalid_effective_task_scope_request");
  assert.equal(result.payload.message, ERROR_MESSAGE);
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(result.payload).includes("prj_other"), false);
});

test("effective task scope route matches sibling error codes", async () => {
  const impactCodes = [
    "invalid_project_identity",
    "project_identity_required",
    "invalid_impact_request",
    "impact_budget_exceeded",
    "project_not_found",
    "project_unavailable",
    "ambiguous_project",
    "project_identity_conflict",
    "worktree_parent_mismatch",
    "impact_sources_changed",
    "impact_revision_changed",
    "impact_project_changed",
    "invalid_impact_observation",
    "invalid_context_sources",
    "invalid_analyzer_snapshot",
    "impact_response_too_large",
    undefined
  ];
  for (const code of impactCodes) {
    const sibling = await invokeSibling("impact", { paths: ["src/a.js"] }, code, PROJECT_ID);
    const ours = await invoke(validBody(), {
      buildProjectTaskContext: () => ({ revision: {} }),
      buildProjectImpact: () => { throw Object.assign(new Error("/private/provider/details"), { code }); }
    });
    assert.equal(ours.res.status, sibling.res.status, `impact ${code}`);
    assert.equal(ours.payload.error, sibling.payload.error, `impact ${code}`);
    assert.equal(ours.payload.message, ERROR_MESSAGE);
    assert.equal(JSON.stringify(ours.payload).includes("/private"), false);
  }

  const taskCodes = [
    "invalid_json",
    "invalid_project_identity",
    "invalid_task_context_request",
    "invalid_context_sources",
    "invalid_context_analysis",
    "project_identity_required",
    "context_budget_exceeded",
    "project_not_found",
    "project_unavailable",
    "ambiguous_project",
    "project_identity_conflict",
    "worktree_parent_mismatch",
    "context_sources_changed",
    "context_revision_changed",
    "context_project_changed",
    undefined
  ];
  for (const code of taskCodes) {
    const sibling = await invokeSibling("task-context", { task: { title: "Adapter fixture" } }, code, PROJECT_ID);
    const ours = await invoke(validBody(), {
      buildProjectTaskContext: () => { throw Object.assign(new Error("/private/provider/details"), { code }); }
    });
    assert.equal(ours.res.status, sibling.res.status, `task-context ${code}`);
    assert.equal(ours.payload.error, sibling.payload.error, `task-context ${code}`);
    assert.equal(JSON.stringify(ours.payload).includes("/private"), false);
  }

  const malformed = await invoke("{bad");
  const siblingMalformed = await invokeSibling("impact", "{bad", "unused", PROJECT_ID);
  assert.equal(malformed.res.status, siblingMalformed.res.status);
  assert.equal(malformed.payload.error, siblingMalformed.payload.error);

  const oversized = await invoke(" ".repeat(65537));
  const siblingOversized = await invokeSibling("task-context", " ".repeat(65537), "unused", PROJECT_ID);
  assert.equal(oversized.res.status, 413);
  assert.equal(oversized.res.status, siblingOversized.res.status);
  assert.equal(oversized.payload.error, "request_body_too_large");
  assert.equal(oversized.payload.error, siblingOversized.payload.error);

  const identity = await invoke(validBody(), {}, "../bad");
  const siblingIdentity = await invokeSibling("impact", { paths: ["src/a.js"] }, "unused", "../bad");
  assert.equal(identity.res.status, 400);
  assert.equal(identity.payload.error, "invalid_project_identity");
  assert.equal(identity.payload.error, siblingIdentity.payload.error);
});

test("intelligence router registers effective task scope beside task-context and impact", async () => {
  const { pack, impact } = evidence();
  const router = createRouter();
  registerIntelligenceRoutes(router, dependencies({
    buildProjectTaskContext: () => pack,
    buildProjectImpact: () => impact
  }));
  const req = requestFrom(validBody(), `/api/intelligence/projects/${PROJECT_ID}/effective-task-scope`);
  const res = responseRecorder();
  assert.equal(await router.dispatch(req, res), true);
  const payload = JSON.parse(res.body);
  assert.equal(res.status, 200);
  assert.equal(payload.message, SUCCESS_MESSAGE);
  assert.equal(payload.data.policyVersion, "step4-foundation-6");
  assert.equal(payload.data.reserved.reasons[0], "coupling_evidence_not_supported");
});

// PR #60 fix contract §4: the shared normalizer denies create by default, so the
// route (no allowCreateIntent opt-in) refuses every create body exactly like base
// 95ea609, before config, roots, producers or compose run.
function countingDependencies() {
  const calls = { config: 0, roots: 0, taskContext: 0, impact: 0, compose: 0 };
  const { pack, impact } = evidence();
  const extra = {
    getProjectConfig: () => { calls.config += 1; return { dataDir: "/registry" }; },
    getConfiguredProjectRoots: () => { calls.roots += 1; return [{ id: "fixture", path: "/projects" }]; },
    buildProjectTaskContext: () => { calls.taskContext += 1; return pack; },
    buildProjectImpact: () => { calls.impact += 1; return impact; },
    composeEffectiveTaskScopeFromEnvelopes: (request, envelopes) => {
      calls.compose += 1;
      return composeEffectiveTaskScopeFromEnvelopes(request, envelopes);
    }
  };
  return { calls, extra };
}

async function assertCreateRefused(operationIntent) {
  const { calls, extra } = countingDependencies();
  const result = await invoke({ ...validBody(), operationIntent }, extra);
  assert.equal(result.res.status, 400, JSON.stringify(operationIntent));
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error, "invalid_delete_intent");
  assert.equal(result.payload.message, ERROR_MESSAGE);
  assert.equal(JSON.stringify(result.payload).includes("invalid_create_intent"), false);
  assert.deepEqual(calls, { config: 0, roots: 0, taskContext: 0, impact: 0, compose: 0 });
}

test("R1 effective task scope route refuses a well-formed create intent with zero producer, config and compose calls", async () => {
  await assertCreateRefused({ kind: "create", targets: [{ oldPath: null, newPath: "src/a.js" }] });
});

test("R2 effective task scope route refuses malformed create intents as invalid_delete_intent, never invalid_create_intent", async () => {
  for (const operationIntent of [
    { kind: "create", targets: [] },
    { kind: "create", targets: [{ oldPath: null, newPath: "src/a.js", exists: true }] },
    { kind: "create", targets: [{ oldPath: "src/a.js", newPath: "src/a.js" }] },
    { kind: "create", targets: Array.from({ length: 33 }, () => ({ oldPath: null, newPath: "src/a.js" })) }
  ]) {
    await assertCreateRefused(operationIntent);
  }
});

test("R3 effective task scope route still lets a delete intent reach the producers", async () => {
  const { calls, extra } = countingDependencies();
  const result = await invoke({
    ...validBody(),
    operationIntent: { kind: "delete", targets: [{ oldPath: "src/a.js", newPath: null }] }
  }, extra);
  assert.equal(result.res.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(calls.taskContext + calls.impact, 2);
  assert.equal(calls.compose, 1);
  assert.equal(calls.config, 1);
  assert.equal(result.payload.data.policyVersion, "step4-foundation-6");
});

test("D3 RT-3 effective task scope route refuses a body carrying createDestinationAbsenceWitness with zero producer, config and compose calls", async () => {
  for (const operationIntent of [undefined, { kind: "create", targets: [{ oldPath: null, newPath: "src/a.js" }] }]) {
    const { calls, extra } = countingDependencies();
    const body = { ...validBody(), createDestinationAbsenceWitness: { kind: "labelled-synthetic-absence-witness" } };
    if (operationIntent) body.operationIntent = operationIntent;
    const result = await invoke(body, extra);
    assert.equal(result.res.status, 400);
    assert.equal(result.payload.ok, false);
    assert.equal(result.payload.error, "unexpected_field");
    assert.equal(result.payload.message, ERROR_MESSAGE);
    assert.deepEqual(calls, { config: 0, roots: 0, taskContext: 0, impact: 0, compose: 0 });
  }
});
