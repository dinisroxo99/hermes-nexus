import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

// ETS route forwards request.includeTests to the REAL Impact builder (real Context Pack and Impact builders; the M
// cases wrap buildProjectImpact only to force includeTests and tamper its real output). Design: Architect note
// hermes-nexus-arch-include-tests-forwarding.md (sha256 c813e344…f4cc), section 6. The linked fixture name must stay
// "fixture" to match the fixture AGENT.md (S-2); mutants deep-clone with JSON because Impact aliases origins (S-3).
const KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
const codes = (d) => (d?.reasons || []).map((r) => r.code);
const CONTAINERS = ["write", "watch", "impact", "reserved", "operationIntent"];
function mainFx(t) { const f = taskContextFixture(t); return { ...f, projectId: f.request.projectId, rel: "main" }; }
function linkedFx(t) {
  const f = taskContextFixture(t);
  f.worktree("linked");
  const manual = path.join(f.root, "projects.json");
  fs.writeFileSync(manual, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "linked", projectId: "PrJ_Linked" }]));
  const roots = [{ id: "test", path: f.root }];
  return { root: f.root, projectId: "PrJ_Linked", rel: "linked", options: { registry: { roots, manualProjectsFile: manual, discoveredProjectsFile: path.join(f.root, "d.json") } } };
}
function body(f, paths, extra = {}) {
  const o = buildProjectTaskContext({ projectId: f.projectId, task: { title: "T" } }, f.options).revision;
  const s = { ...o, repositoryId: o.repositoryIdentity };
  const expectedRevision = Object.fromEntries(KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  return { task: { id: "it", title: "T", paths }, worktree: { rootId: "test", relativePath: f.rel }, expectedRevision, includeTests: true, changeSemantics: { category: "local_implementation" }, ...extra };
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
const ONE = ["src/one.ts"]; const TWO = ["src/one.ts", "src/unrelated.ts"];

// I1–I4: main checkout -> working_tree_observation_only regardless of includeTests (GREEN at e0976fd)
for (const [n, paths] of [["1p", ONE], ["2p", TWO]]) for (const it of [true, false]) {
  test(`I main ${n} includeTests=${it}: not_evaluated working_tree_observation_only, no containers (GREEN at e0976fd)`, async (t) => {
    const f = mainFx(t);
    const r = await dispatch(f, body(f, paths, { includeTests: it }));
    const d = r.payload.data;
    assert.equal(r.status, 200);
    assert.deepEqual({ status: d.status, codes: codes(d), resolver: d.completeness.resolver, stale: d.stale.state, policyVersion: d.policyVersion },
      { status: "not_evaluated", codes: ["working_tree_observation_only"], resolver: ["working_tree_observation_only"], stale: "bound", policyVersion: "step4-foundation-6" });
    assert.deepEqual(d.limits, { compactBytes: 65536, classifiedTargets: 0, originWitnessRefs: 0, resolverReasons: 1 });
    for (const k of CONTAINERS) assert.equal(Object.hasOwn(d, k), false, k);
  });
}

// I5–I8: clean linked worktree. true is RED at e0976fd (includeTests_true_not_requested_mismatch); false is the GREEN guard.
for (const [n, paths, writes] of [["1p", ONE, ["src/one.ts"]], ["2p", TWO, ["src/one.ts", "src/unrelated.ts"]]]) for (const it of [true, false]) {
  test(`I linked ${n} includeTests=${it}: incomplete, explicit WRITE, test file WATCH${it ? " + affected_test_candidate (RED at e0976fd)" : " (GREEN guard)"}`, async (t) => {
    const f = linkedFx(t);
    const r = await dispatch(f, body(f, paths, { includeTests: it }));
    const d = r.payload.data;
    assert.equal(r.status, 200);
    assert.equal(d.status, "incomplete", JSON.stringify(d.reasons));
    assert.deepEqual(codes(d), []);
    assert.deepEqual(d.completeness.resolver, []);
    assert.equal(d.stale.state, "bound");
    assert.equal(d.policyVersion, "step4-foundation-6");
    assert.deepEqual(d.write.items.map((i) => [i.target.path, i.ruleIds]), writes.map((p) => [p, ["explicit_task_path"]]));
    assert.deepEqual(d.watch.items.map((i) => [i.target.path, i.roles, i.ruleIds]),
      [["tests/one.test.ts", it ? ["affected_file", "affected_test_candidate"] : ["affected_file"], ["distance_1_2_awareness"]]]);
    assert.deepEqual(d.impact.items, []);
    assert.equal(d.reserved.status, "not_evaluated");
    assert.equal(Object.hasOwn(d, "operationIntent"), false);
    assert.deepEqual(d.limits, { compactBytes: 65536, classifiedTargets: writes.length + 1, originWitnessRefs: 1, resolverReasons: 0 });
  });
}

test("I9 route forwards exactly the normalized boolean to Impact (RED at e0976fd)", async (t) => {
  const f = linkedFx(t);
  for (const it of [true, false]) {
    let input;
    await dispatch(f, body(f, ONE, { includeTests: it }), { buildProjectImpact: (id, req, o) => { input = req; return buildProjectImpact(id, req, o); } });
    assert.equal(input.includeTests, it);
    // Real packs carry repositoryIdentity, so impactEvidenceRequest never adds repositoryId/worktreeId (side finding S-1).
    assert.deepEqual(Object.keys(input).sort(), ["includeTests", "paths"]);
  }
});

// Fail-closed mutants: Impact is built by the REAL builder with an explicit includeTests and then tampered.
// Each forces its own includeTests, so all are GREEN at e0976fd and after the fix (composer checks unchanged).
const real = (it, mutate = (x) => x) => (id, req, o) => mutate(buildProjectImpact(id, { ...req, includeTests: it }, o));
// JSON clone: Impact shares the origins array between affectedFiles and candidates; structuredClone would keep the alias.
const firstCandidate = (fn) => (i) => { const c = JSON.parse(JSON.stringify(i)); fn(c.affectedTests.candidates[0], c); return c; };
for (const [name, it, impactIt, mutate, code] of [
  ["true request + not_requested Impact (pre-fix route)", true, false, undefined, "includeTests_true_not_requested_mismatch"],
  ["false request + requested Impact with candidates", false, true, undefined, "includeTests_false_has_candidates_mismatch"],
  ["false request + requested Impact, candidates emptied", false, true, (i) => ({ ...i, affectedTests: { ...i.affectedTests, candidates: [] } }), "includeTests_false_not_not_requested_mismatch"],
  ["true request + affectedTests.status forged to not_requested", true, true, (i) => ({ ...i, affectedTests: { ...i.affectedTests, status: "not_requested" } }), "includeTests_true_not_requested_mismatch"],
  ["true request + candidate origin tampered", true, true, firstCandidate((c) => { c.origins[0].originPath = "src/unrelated.ts"; }), "candidate_projection_mismatch"],
  ["true request + candidate path removed", true, true, firstCandidate((c) => { delete c.path; }), "malformed_affected_record"]
]) {
  test(`M fail-closed: ${name} -> rejected ${code}`, async (t) => {
    const f = linkedFx(t);
    const r = await dispatch(f, body(f, ONE, { includeTests: it }), { buildProjectImpact: real(impactIt, mutate) });
    assert.deepEqual({ status: r.payload.data.status, codes: codes(r.payload.data) }, { status: "rejected", codes: [code] });
  });
}

test("N includeTests absent / non-boolean -> 400 invalid_effective_task_scope_request, zero producer calls", async (t) => {
  const f = linkedFx(t);
  const valid = body(f, ONE);
  for (const value of [undefined, "true", 1, 0, null, {}, []]) {
    const calls = { taskContext: 0, impact: 0, compose: 0 };
    const b = { ...valid }; if (value === undefined) delete b.includeTests; else b.includeTests = value;
    const r = await dispatch(f, b, {
      buildProjectTaskContext() { calls.taskContext += 1; throw new Error("no"); },
      buildProjectImpact() { calls.impact += 1; throw new Error("no"); },
      composeEffectiveTaskScopeFromEnvelopes() { calls.compose += 1; throw new Error("no"); }
    });
    assert.equal(r.status, 400, String(value)); assert.equal(r.payload.error, "invalid_effective_task_scope_request");
    assert.deepEqual(calls, { taskContext: 0, impact: 0, compose: 0 });
  }
});

test("H HTTP gates unchanged with includeTests true: create -> 400 invalid_delete_intent, absence witness -> 400 unexpected_field", async (t) => {
  const f = linkedFx(t);
  const b = body(f, ["src/new.ts"]);
  const create = await dispatch(f, { ...b, operationIntent: { kind: "create", targets: [{ oldPath: null, newPath: "src/new.ts" }] } });
  assert.equal(create.status, 400); assert.equal(create.payload.error, "invalid_delete_intent");
  const witness = await dispatch(f, { ...b, createDestinationAbsenceWitness: {} });
  assert.equal(witness.status, 400); assert.equal(witness.payload.error, "unexpected_field");
});
