import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEffectiveTaskScopeRequest,
  resolveChangeSemantics,
  EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
  EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  CHANGE_SEMANTICS_CATEGORIES
} from "../src/lib/effective-task-scope-policy.js";

const BASE_REQUEST = {
  task: {
    id: "t_308d1d32",
    title: "STEP4-SLICE1 — implement effective-task-scope-v2 foundation",
    paths: ["src/lib/effective-task-scope-policy.js", "src/lib/effective-task-scope.js"],
    symbols: []
  },
  projectId: "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  worktree: { rootId: "local", relativePath: "hermes-nexus-step4-slice1-write" },
  expectedRevision: {
    status: "available",
    commitSha: "c8d27eeb304ebf56dbe535c215b70093922fa953",
    branch: "feat/step4-slice1-ets-v2",
    dirty: false,
    isLinkedWorktree: true,
    repositoryId: "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529",
    worktreeId: "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d"
  },
  includeTests: true
};

test("policy: normalize accepts minimal valid request", () => {
  const n = normalizeEffectiveTaskScopeRequest(BASE_REQUEST);
  assert.equal(n.projectId, BASE_REQUEST.projectId);
  assert.deepEqual(n.task.paths, ["src/lib/effective-task-scope-policy.js", "src/lib/effective-task-scope.js"]);
  assert.equal(n.includeTests, true);
  assert.equal(n.expectedRevision.dirty, false);
});

test("policy: paths must be 1-32 literal, deduped sorted, no repair", () => {
  const bad = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, paths: [] } };
  let err;
  try { normalizeEffectiveTaskScopeRequest(bad); assert.fail("should throw"); } catch (e) { err = e; }
  assert.ok(err && (err.code || "").includes("invalid") || (err.message || "").includes("Invalid") || (err.message || "").includes("bounded"));
  const dups = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, paths: ["a.js", "a.js", "b.js"] } };
  const n = normalizeEffectiveTaskScopeRequest(dups);
  assert.deepEqual(n.task.paths, ["a.js", "b.js"]);
});

test("policy: nonempty symbols accepted at normalize (not_evaluated later per contract)", () => {
  const s = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, symbols: ["foo"] } };
  const n = normalizeEffectiveTaskScopeRequest(s);
  assert.deepEqual(n.task.symbols, ["foo"]);
});

test("policy: includeTests must be explicit boolean", () => {
  const bad = { ...BASE_REQUEST };
  delete bad.includeTests;
  let err;
  try { normalizeEffectiveTaskScopeRequest(bad); assert.fail("should throw"); } catch (e) { err = e; }
  assert.ok(err && ((err.code || "").includes("invalid") || (err.message || "").includes("Invalid") || (err.message || "").includes("bounded")));
});

test("policy: changeSemantics category must be valid or omitted", () => {
  const ok = { ...BASE_REQUEST, changeSemantics: { category: "documentation" } };
  const n = normalizeEffectiveTaskScopeRequest(ok);
  assert.equal(n.changeSemantics.category, "documentation");
  const badCat = { ...BASE_REQUEST, changeSemantics: { category: "foo" } };
  let err;
  try { normalizeEffectiveTaskScopeRequest(badCat); assert.fail("should throw"); } catch (e) { err = e; }
  assert.ok(err && ((err.code || "").includes("invalid") || (err.message || "").includes("Invalid") || (err.message || "").includes("bounded")));
});

test("policy: resolveChangeSemantics - no decl uses path inference", () => {
  const r = resolveChangeSemantics(null, ["README.md"]);
  assert.equal(r.effective, "documentation");
  assert.equal(r.inferred, "documentation");
  const r2 = resolveChangeSemantics(null, ["src/foo.js"]);
  assert.equal(r2.effective, "unknown");
});

test("policy: resolveChangeSemantics - test_only heuristic", () => {
  const r = resolveChangeSemantics(null, ["tests/foo.test.js"]);
  assert.equal(r.effective, "test_only");
});

test("policy: resolveChangeSemantics - decl wins or disagreement -> unknown", () => {
  const r = resolveChangeSemantics({ category: "local_implementation" }, ["src/a.js"]);
  assert.equal(r.effective, "local_implementation");
  const rDoc = resolveChangeSemantics({ category: "documentation" }, ["src/a.js"]);
  assert.equal(rDoc.effective, "unknown");
  assert.deepEqual(rDoc.reasons, ["declaration_path_disagreement"]);
});

test("policy: versions exported", () => {
  assert.equal(EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION, 2);
  assert.equal(EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION, "effective-task-scope-v2");
  assert.equal(EFFECTIVE_TASK_SCOPE_POLICY_VERSION, "step4-foundation-1");
});
