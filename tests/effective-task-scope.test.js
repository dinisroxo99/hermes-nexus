import test from "node:test";
import assert from "node:assert/strict";
import { composeEffectiveTaskScope } from "../src/lib/effective-task-scope.js";

const BASE_REQ = {
  task: {
    id: "t_308d1d32",
    title: "STEP4-SLICE1 — implement effective-task-scope-v2 foundation",
    paths: [
      "src/lib/effective-task-scope-policy.js",
      "src/lib/effective-task-scope.js",
      "tests/effective-task-scope-policy.test.js",
      "tests/effective-task-scope.test.js"
    ],
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

const MIN_PACK = {
  schemaVersion: 1,
  analysisVersion: "task-context-v1",
  contextPackId: "context_7081701b2824d4f123e6139a6ca46682c949164c5207112328ad8f2ef0b6a937",
  projectId: "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  project: { name: "hermes-project-map", rootId: "local", relativePath: "hermes-nexus-step4-slice1-write" },
  revision: {
    status: "available",
    commitSha: "c8d27eeb304ebf56dbe535c215b70093922fa953",
    branch: "feat/step4-slice1-ets-v2",
    dirty: false,
    repositoryIdentity: "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529",
    worktreeId: "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d",
    isLinkedWorktree: true
  },
  analysis: { schemaVersion: 1, status: "partial", snapshotToken: "78d17ab081e32e07d74a120912b953736cbde851e6e0ae60fd950066f0f87c0f", provenance: {} },
  observation: { basis: "working_tree", incomplete: true, sourceDigest: "49db7585957b9d3df85d1c66e5397a3bf73a0489b4ac159bff82bb027e6f8253" },
  sections: {
    task: {
      items: [{
        id: "t_308d1d32",
        title: "STEP4-SLICE1 — implement effective-task-scope-v2 foundation",
        paths: [
          "src/lib/effective-task-scope-policy.js",
          "src/lib/effective-task-scope.js",
          "tests/effective-task-scope-policy.test.js",
          "tests/effective-task-scope.test.js"
        ],
        symbols: []
      }],
      status: "available"
    },
    workspaces: { items: [], status: "empty" },
    documents: { items: [], status: "empty" },
    constraints: { items: [], status: "empty" },
    files: { items: [], status: "empty" },
    symbols: { items: [], status: "partial" },
    references: { items: [], status: "partial" },
    tests: { items: [], status: "empty" },
    diagnostics: { items: [], status: "available" },
    policy: { items: [], status: "available" }
  },
  limits: { maxBytes: 65536 }
};

const MIN_IMPACT = {
  schemaVersion: 1,
  analysisVersion: "impact-v2",
  projectId: "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  project: { rootId: "local", relativePath: "hermes-nexus-step4-slice1-write" },
  targets: [
    { originPath: "src/lib/effective-task-scope-policy.js", targetSource: null, status: "partial", findingState: "not_evaluated", completeness: { source: ["source_unavailable"], provider: ["uncovered_language"] } },
    { originPath: "src/lib/effective-task-scope.js", targetSource: null, status: "partial", findingState: "not_evaluated", completeness: { source: ["source_unavailable"], provider: ["uncovered_language"] } },
    { originPath: "tests/effective-task-scope-policy.test.js", targetSource: null, status: "partial", findingState: "not_evaluated", completeness: { source: ["source_unavailable"], provider: ["uncovered_language"] } },
    { originPath: "tests/effective-task-scope.test.js", targetSource: null, status: "partial", findingState: "not_evaluated", completeness: { source: ["source_unavailable"], provider: ["uncovered_language"] } }
  ],
  revision: {
    status: "available",
    commitSha: "c8d27eeb304ebf56dbe535c215b70093922fa953",
    branch: "feat/step4-slice1-ets-v2",
    repositoryId: "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529",
    worktreeId: "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d",
    dirty: false,
    isLinkedWorktree: true
  },
  snapshotToken: "78d17ab081e32e07d74a120912b953736cbde851e6e0ae60fd950066f0f87c0f",
  provider: { id: "native.typescript", version: "1" },
  coverage: { observed: ["javascript"], covered: ["javascript"], uncovered: ["python"] },
  observation: { basis: "working_tree", incomplete: true },
  limits: { depth: 2, affectedFiles: 80, compactBytes: 65536 },
  status: "partial",
  findingState: "not_evaluated",
  affectedFiles: [],
  affectedTests: { status: "partial", findingState: "not_evaluated", candidates: [], completeness: {} },
  completeness: { source: ["source_limit", "source_unavailable"], provider: ["provider_partial", "uncovered_language"], traversal: [], output: [] }
};

test("composer: rejects on missing required fields", () => {
  const res = composeEffectiveTaskScope({}, {});
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.some(r => r.code.includes("invalid")));
});

test("composer: returns incomplete for missing target sources (new files) with not_evaluated items per contract", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.schemaVersion, 2);
  assert.equal(res.analysisVersion, "effective-task-scope-v2");
  assert.equal(res.policyVersion, "step4-foundation-1");
  assert.equal(res.status, "incomplete");
  assert.ok(res.reasons.length === 0 || res.reasons.some(r => String(r.code || r).includes("target") || String(r.code || r).includes("incomplete")));
  assert.deepEqual(res.task.paths, BASE_REQ.task.paths);
  assert.equal(res.write.status, "available"); // explicit even if target missing
  assert.equal(res.reserved.status, "not_evaluated");
  assert.ok(res.reserved.reasons.includes("coupling_evidence_not_supported"));
  assert.equal(res.changeSemantics.effective, "unknown");
});

test("composer: dirty true yields not_evaluated, preserves truthful state", () => {
  const dirtyPack = { ...MIN_PACK, revision: { ...MIN_PACK.revision, dirty: true } };
  const dirtyImpact = { ...MIN_IMPACT, revision: { ...MIN_IMPACT.revision, dirty: true } };
  const dirtyReq = { ...BASE_REQ, expectedRevision: { ...BASE_REQ.expectedRevision, dirty: true } };
  const res = composeEffectiveTaskScope(dirtyReq, { pack: dirtyPack, impact: dirtyImpact });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some(r => String(r.code || "").includes("working_tree") || String(r.code || "").includes("dirty") || String(r).includes("dirty")));
});

test("composer: symbols nonempty -> not_evaluated symbol_targets_not_supported", () => {
  const symReq = { ...BASE_REQ, task: { ...BASE_REQ.task, symbols: ["Foo"] } };
  const symPack = { ...MIN_PACK, sections: { ...MIN_PACK.sections, task: { items: [ { ...MIN_PACK.sections.task.items[0], symbols: ["Foo"] } ] } } };
  const res = composeEffectiveTaskScope(symReq, { pack: symPack, impact: MIN_IMPACT });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some(r => r.code === "symbol_targets_not_supported"));
});

test("composer: cross project mismatch rejects", () => {
  const badPack = { ...MIN_PACK, projectId: "prj_other" };
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: badPack, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
});

test("composer: v2 output never disguised as v1, has exact versions, no confidence", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.schemaVersion, 2);
  assert.ok(!("confidence" in res));
  assert.ok(!("writeExhaustive" in res) || res.writeExhaustive === undefined); // v2 uses per-cat status
});

test("composer: purity - same input produces identical output (determinism)", () => {
  const r1 = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  const r2 = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.deepEqual(r1, r2);
});

test("composer: includeTests false labels tests_not_requested in reasons when incomplete", () => {
  const reqNo = { ...BASE_REQ, includeTests: false };
  const res = composeEffectiveTaskScope(reqNo, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.ok(res.reasons.some(r => r.code && String(r.code).includes("tests_not_requested")) || (res.completeness && res.completeness.resolver));
});
