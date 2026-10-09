import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { composeEffectiveTaskScopeFromEnvelopes } from "../src/lib/effective-task-scope-adapter.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";
import { gitFixture } from "./helpers/git-fixture.js";

// Single-path ETS over the route with the REAL Context Pack and Impact builders (no builder mocks; S4/S5 wrap
// buildProjectImpact only to observe or tamper its real output). Design: Architect note
// hermes-nexus-arch-single-path-origin-canonicalization.md (sha256 f2d253ba…1c10), sections 5 and 7.
const KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
const codes = (d) => (d?.reasons || []).map((r) => r.code);
function body(projectId, options, task, extra = {}) {
  const o = buildProjectTaskContext({ projectId, task: { title: task.title } }, options).revision;
  const s = { ...o, repositoryId: o.repositoryIdentity };
  const expectedRevision = Object.fromEntries(KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  return { task, worktree: { rootId: "test", relativePath: "main" }, expectedRevision, includeTests: true, changeSemantics: { category: "local_implementation" }, ...extra };
}
async function dispatch(f, b, deps = {}) {
  const router = createRouter();
  registerIntelligenceRoutes(router, { getProjectConfig: () => ({ dataDir: f.root }), getConfiguredProjectRoots: () => f.options.registry.roots, ...deps });
  const req = Readable.from([JSON.stringify(b)]); req.method = "POST";
  req.url = `/api/intelligence/projects/${f.projectId}/effective-task-scope`; req.headers = { host: "localhost" };
  const res = { writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  assert.equal(await router.dispatch(req, res), true);
  return { status: res.status, payload: JSON.parse(res.body) };
}
function mainFixture(t) { const f = taskContextFixture(t); return { ...f, projectId: f.request.projectId }; }
function linkedFixture(t) {
  const g = gitFixture(t, { committed: true });
  g.write("src/other.ts", "import { original } from './source'; export const o = original;\n"); g.commit();
  g.worktree("linked");
  const manual = path.join(g.root, "projects.json");
  fs.writeFileSync(manual, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "linked", projectId: "PrJ_Linked" }]));
  const roots = [{ id: "test", path: g.root }];
  return { root: g.root, projectId: "PrJ_Linked", options: { registry: { roots, manualProjectsFile: manual, discoveredProjectsFile: path.join(g.root, "d.json") } } };
}
const NOT_EVALUATED_WTO = { status: "not_evaluated", codes: ["working_tree_observation_only"] };

test("S1 (RED at bc11227) one path, main checkout: passes binding -> not_evaluated working_tree_observation_only", async (t) => {
  const f = mainFixture(t);
  const r = await dispatch(f, body(f.projectId, f.options, { id: "s1", title: "One path", paths: ["src/one.ts"] }));
  assert.equal(r.status, 200);
  assert.deepEqual({ status: r.payload.data.status, codes: codes(r.payload.data) }, NOT_EVALUATED_WTO);
  assert.deepEqual(r.payload.data.completeness.resolver, ["working_tree_observation_only"]);
  assert.equal(r.payload.data.policyVersion, "step4-foundation-6");
  for (const k of ["write", "watch", "impact", "reserved", "operationIntent"]) assert.equal(Object.hasOwn(r.payload.data, k), false, k);
});

test("S2 (GREEN guard) two paths, main checkout: unchanged not_evaluated working_tree_observation_only", async (t) => {
  const f = mainFixture(t);
  const r = await dispatch(f, body(f.projectId, f.options, { id: "s2", title: "Two paths", paths: ["src/one.ts", "src/unrelated.ts"] }));
  assert.deepEqual({ status: r.payload.data.status, codes: codes(r.payload.data) }, NOT_EVALUATED_WTO);
});

test("S3 (RED at bc11227) one path, clean linked worktree, includeTests false: same shape as the two-path result", async (t) => {
  const f = linkedFixture(t);
  const b = (paths) => ({ ...body(f.projectId, f.options, { id: "s3", title: "Linked", paths }, { includeTests: false }), worktree: { rootId: "test", relativePath: "linked" } });
  const one = (await dispatch(f, b(["src/source.ts"]))).payload.data;
  const two = (await dispatch(f, b(["src/other.ts", "src/source.ts"]))).payload.data;
  assert.equal(one.status, "incomplete", JSON.stringify(one.reasons));
  assert.equal(two.status, "incomplete");
  assert.deepEqual(one.write.items.map((i) => [i.target.path, i.ruleIds]), [["src/source.ts", ["explicit_task_path"]]]);
  assert.deepEqual(one.evidence.origins, [{ originPath: "src/source.ts", minimumDistance: 0, witness: null }]);
  assert.equal(one.reserved.status, "not_evaluated");
  assert.equal(Object.hasOwn(one, "operationIntent"), false);
  assert.deepEqual(one.stale.state, "bound");
});

test("S4 canonical view: compose receives Impact's own multi-form target bytes; bound values copied, builder output not mutated", async (t) => {
  const f = mainFixture(t);
  let built; let composed;
  const deps = {
    buildProjectImpact(id, req, o) { built = buildProjectImpact(id, req, o); return built; },
    composeEffectiveTaskScopeFromEnvelopes(request, env) { composed = env.impact.data; return composeEffectiveTaskScopeFromEnvelopes(request, env); }
  };
  await dispatch(f, body(f.projectId, f.options, { id: "s4", title: "View", paths: ["src/one.ts"] }), deps);
  const builtCopy = JSON.parse(JSON.stringify(built));
  assert.equal(built.originPath, "src/one.ts");                       // Impact public contract unchanged
  assert.equal(Object.hasOwn(composed, "originPath"), false);
  assert.equal(Object.hasOwn(composed.observation, "targetSource"), false);
  const multi = buildProjectImpact(f.projectId, { paths: ["src/one.ts", "src/unrelated.ts"] }, f.options);
  assert.deepEqual(composed.targets, [multi.targets.find((x) => x.originPath === "src/one.ts")]);
  assert.equal(composed.targets[0].targetSource.hash, built.observation.targetSource.hash);
  assert.equal(composed.snapshotToken, built.snapshotToken);
  assert.deepEqual(composed.affectedFiles, built.affectedFiles);
  assert.deepEqual(composed.affectedTests, built.affectedTests);
  assert.deepEqual(built, builtCopy);
});

const MUTANTS = {
  bothForms: (i) => ({ ...i, targets: [{ originPath: i.originPath, targetSource: i.observation.targetSource, status: i.status, findingState: i.findingState, completeness: i.completeness }] }),
  originDisagreesWithTask: (i) => ({ ...i, originPath: "src/unrelated.ts" }),
  multipleOrigins: (i) => ({ ...i, originPath: [i.originPath, "src/unrelated.ts"] }),
  originNull: (i) => ({ ...i, originPath: null }),
  targetSourcePathTampered: (i) => ({ ...i, observation: { ...i.observation, targetSource: { ...i.observation.targetSource, path: "src/unrelated.ts" } } }),
  targetSourceExtraField: (i) => ({ ...i, observation: { ...i.observation, targetSource: { ...i.observation.targetSource, extra: 1 } } }),
  targetSourceHashMissing: (i) => { const { hash, ...ts } = i.observation.targetSource; return { ...i, observation: { ...i.observation, targetSource: ts } }; },
  targetSourceHashNotString: (i) => ({ ...i, observation: { ...i.observation, targetSource: { ...i.observation.targetSource, hash: 1 } } }),
  observationTargetSourceMissing: (i) => { const { targetSource, ...o } = i.observation; return { ...i, observation: o }; },
  observationExtraField: (i) => ({ ...i, observation: { ...i.observation, extra: 1 } }),
  topLevelExtraField: (i) => ({ ...i, extra: true }),
  statusMissing: (i) => { const { status, ...r } = i; return r; },
  findingStateMissing: (i) => { const { findingState, ...r } = i; return r; },
  completenessArray: (i) => ({ ...i, completeness: [] })
};
for (const [name, mutate] of Object.entries(MUTANTS)) {
  test(`S5 fail-closed mutant ${name}: still rejected origin_form_mismatch`, async (t) => {
    const f = mainFixture(t);
    const r = await dispatch(f, body(f.projectId, f.options, { id: "s5", title: "Mutant", paths: ["src/one.ts"] }),
      { buildProjectImpact: (id, req, o) => mutate(buildProjectImpact(id, req, o)) });
    assert.deepEqual({ status: r.payload.data.status, codes: codes(r.payload.data) }, { status: "rejected", codes: ["origin_form_mismatch"] });
  });
}
test("S5 fail-closed: two-path task with a legacy single-origin Impact stays rejected origin_form_mismatch", async (t) => {
  const f = mainFixture(t);
  const r = await dispatch(f, body(f.projectId, f.options, { id: "s5b", title: "Two", paths: ["src/one.ts", "src/unrelated.ts"] }),
    { buildProjectImpact: (id, req, o) => buildProjectImpact(id, { ...req, paths: ["src/one.ts"] }, o) });
  assert.deepEqual(codes(r.payload.data), ["origin_form_mismatch"]);
});

test("S6 composer and adapter unchanged: legacy single-origin Impact through the adapter is still origin_form_mismatch", async (t) => {
  const f = mainFixture(t);
  const b = { ...body(f.projectId, f.options, { id: "s6", title: "Adapter", paths: ["src/one.ts"] }), projectId: f.projectId };
  const pack = buildProjectTaskContext({ projectId: f.projectId, task: b.task }, f.options);
  const impact = buildProjectImpact(f.projectId, { paths: ["src/one.ts"] }, f.options);
  const d = composeEffectiveTaskScopeFromEnvelopes(b, { pack: { ok: true, data: pack }, impact: { ok: true, data: impact } });
  assert.deepEqual({ status: d.status, codes: codes(d) }, { status: "rejected", codes: ["origin_form_mismatch"] });
});

test("S7 HTTP gates unchanged for one path: create -> 400 invalid_delete_intent, absence witness -> 400 unexpected_field", async (t) => {
  const f = mainFixture(t);
  const b = body(f.projectId, f.options, { id: "s7", title: "Create", paths: ["src/new.ts"] });
  const create = await dispatch(f, { ...b, operationIntent: { kind: "create", targets: [{ oldPath: null, newPath: "src/new.ts" }] } });
  assert.equal(create.status, 400); assert.equal(create.payload.error, "invalid_delete_intent");
  const witness = await dispatch(f, { ...b, createDestinationAbsenceWitness: {} });
  assert.equal(witness.status, 400); assert.equal(witness.payload.error, "unexpected_field");
});

test("S8 (D2; RED at bc11227) one-path delete intent, clean linked worktree, includeTests false: canonical view also applies to delete", async (t) => {
  const f = linkedFixture(t);
  const b = (paths) => ({ ...body(f.projectId, f.options, { id: "s8", title: "Delete", paths }, { includeTests: false,
    operationIntent: { kind: "delete", targets: paths.map((oldPath) => ({ oldPath, newPath: null })) } }), worktree: { rootId: "test", relativePath: "linked" } });
  const one = (await dispatch(f, b(["src/source.ts"]))).payload.data;
  const two = (await dispatch(f, b(["src/other.ts", "src/source.ts"]))).payload.data;
  assert.equal(one.status, "incomplete", JSON.stringify(one.reasons));
  assert.equal(two.status, "incomplete", JSON.stringify(two.reasons));
  assert.deepEqual(one.write.items.map((i) => i.target.path), ["src/source.ts"]);
  assert.ok(one.write.items[0].ruleIds.includes("explicit_delete_intent"), JSON.stringify(one.write.items));
  assert.equal(one.operationIntent?.kind, "delete");
  assert.deepEqual(one.operationIntent.targets.map((target) => [target.oldPath, target.newPath]), [["src/source.ts", null]]);
});
