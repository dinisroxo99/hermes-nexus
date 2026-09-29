import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEffectiveTaskScopeRequest,
  resolveChangeSemantics,
  EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
  EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  CHANGE_SEMANTICS_CATEGORIES,
  DOCUMENTATION_EXTENSIONS
} from "../src/lib/effective-task-scope-policy.js";

const BASE_REQUEST = {
  task: {
    id: "t_5edca620",
    title: "STEP4-SLICE1 — correct 38 E–J findings attempt 1 @ 61871824",
    paths: ["src/lib/effective-task-scope-policy.js", "src/lib/effective-task-scope.js"],
    symbols: []
  },
  projectId: "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  worktree: { rootId: "local", relativePath: "hermes-nexus-step4-slice1-write" },
  expectedRevision: {
    status: "available",
    commitSha: "618718247352fa6ae5e2a530c209845ef43e7378",
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
  assert.equal(n.expectedRevision.status, "available");
});

test("policy: paths must be 1-32 literal, deduped sorted, spelling must match normalized exactly (no repair), reject leading space/glob", () => {
  const bad = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, paths: [] } };
  let err; try { normalizeEffectiveTaskScopeRequest(bad); assert.fail("should throw"); } catch(e){err=e;}
  assert.ok(err && ((err.code||"").includes("invalid") || (err.message||"").includes("Invalid") || (err.message||"").includes("bounded")));
  const dups = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, paths: ["a.js", "a.js", "b.js"] } };
  const n = normalizeEffectiveTaskScopeRequest(dups);
  assert.deepEqual(n.task.paths, ["a.js", "b.js"]);
  const leadingSpace = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, paths: [" src/a.js"] } };
  let err2; try { normalizeEffectiveTaskScopeRequest(leadingSpace); assert.fail("should throw"); } catch(e){err2=e;}
  assert.ok(err2 && ((err2.code||"").includes("invalid") || (err2.message||"").includes("Invalid") || (err2.message||"").includes("bounded")));
});

test("policy: empty task id rejected", () => {
  const bad = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, id: "" } };
  let err; try { normalizeEffectiveTaskScopeRequest(bad); assert.fail("should throw"); } catch(e){err=e;}
  assert.ok(err && ((err.code||"").includes("invalid") || (err.message||"").includes("Invalid") || (err.message||"").includes("bounded")));
  const badNull = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, id: null } };
  let err2; try { normalizeEffectiveTaskScopeRequest(badNull); assert.fail("should throw"); } catch(e){err2=e;}
  assert.ok(err2 && ((err2.code||"").includes("invalid") || (err2.message||"").includes("Invalid") || (err2.message||"").includes("bounded")));
});

test("policy: terminal revision status accepted at normalize (not_evaluated decided later)", () => {
  const term = { ...BASE_REQUEST, expectedRevision: { ...BASE_REQUEST.expectedRevision, status: "unavailable" } };
  const n = normalizeEffectiveTaskScopeRequest(term);
  assert.equal(n.expectedRevision.status, "unavailable");
});

test("policy: nonempty symbols accepted at normalize (not_evaluated later per contract)", () => {
  const s = { ...BASE_REQUEST, task: { ...BASE_REQUEST.task, symbols: ["foo"] } };
  const n = normalizeEffectiveTaskScopeRequest(s);
  assert.deepEqual(n.task.symbols, ["foo"]);
});

test("policy: includeTests must be explicit boolean", () => {
  const bad = { ...BASE_REQUEST };
  delete bad.includeTests;
  let err; try { normalizeEffectiveTaskScopeRequest(bad); assert.fail("should throw"); } catch(e){err=e;}
  assert.ok(err && ((err.code||"").includes("invalid") || (err.message||"").includes("Invalid") || (err.message||"").includes("bounded")));
});

test("policy: changeSemantics category must be valid or omitted", () => {
  const ok = { ...BASE_REQUEST, changeSemantics: { category: "documentation" } };
  const n = normalizeEffectiveTaskScopeRequest(ok);
  assert.equal(n.changeSemantics.category, "documentation");
  const badCat = { ...BASE_REQUEST, changeSemantics: { category: "foo" } };
  let err; try { normalizeEffectiveTaskScopeRequest(badCat); assert.fail("should throw"); } catch(e){err=e;}
  assert.ok(err && ((err.code||"").includes("invalid") || (err.message||"").includes("Invalid") || (err.message||"").includes("bounded")));
});

test("policy: resolveChangeSemantics - no decl uses path inference, case-sensitive docs", () => {
  const r = resolveChangeSemantics(null, ["README.md"]);
  assert.equal(r.effective, "documentation");
  const rMd = resolveChangeSemantics(null, ["README.MD"]);
  assert.equal(rMd.effective, "unknown"); // case sensitive per 38
  const r2 = resolveChangeSemantics(null, ["src/foo.js"]);
  assert.equal(r2.effective, "unknown");
});

test("policy: resolveChangeSemantics - test_only heuristic uses existing predicate (src/foo.test.js)", () => {
  const r = resolveChangeSemantics(null, ["src/foo.test.js"]);
  assert.equal(r.effective, "test_only");
  const r2 = resolveChangeSemantics(null, ["tests/bar.spec.ts"]);
  assert.equal(r2.effective, "test_only");
});

test("policy: resolveChangeSemantics - decl wins or disagreement -> unknown + reason", () => {
  const r = resolveChangeSemantics({ category: "local_implementation" }, ["src/a.js"]);
  assert.equal(r.effective, "local_implementation");
  const rDoc = resolveChangeSemantics({ category: "documentation" }, ["src/a.js"]);
  assert.equal(rDoc.effective, "unknown");
  assert.deepEqual(rDoc.reasons, ["declaration_path_disagreement"]);
});

test("policy: versions exported and contract tokens", () => {
  assert.equal(EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION, 2);
  assert.equal(EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION, "effective-task-scope-v2");
  assert.equal(EFFECTIVE_TASK_SCOPE_POLICY_VERSION, "step4-foundation-1");
  assert.ok(CHANGE_SEMANTICS_CATEGORIES.includes("unknown"));
  assert.deepEqual(DOCUMENTATION_EXTENSIONS, [".md", ".rst", ".txt"]);
});

test("policy: compactBytes must be finite safe 1..131072", () => {
  const okL = { ...BASE_REQUEST, limits: { compactBytes: 65536 } };
  const n = normalizeEffectiveTaskScopeRequest(okL);
  assert.equal(n.limits.compactBytes, 65536);
  const badL = { ...BASE_REQUEST, limits: { compactBytes: 0 } };
  let err; try { normalizeEffectiveTaskScopeRequest(badL); assert.fail("should throw"); } catch(e){err=e;}
  assert.ok(err && ((err.code||"").includes("invalid") || (err.message||"").includes("Invalid") || (err.message||"").includes("bounded")));
  const badInf = { ...BASE_REQUEST, limits: { compactBytes: Infinity } };
  let err2; try { normalizeEffectiveTaskScopeRequest(badInf); assert.fail("should throw"); } catch(e){err2=e;}
  assert.ok(err2 && ((err2.code||"").includes("invalid") || (err2.message||"").includes("Invalid") || (err2.message||"").includes("bounded")));
});