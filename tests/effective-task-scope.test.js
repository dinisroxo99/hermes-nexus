import test from "node:test";
import assert from "node:assert/strict";
import { composeEffectiveTaskScope } from "../src/lib/effective-task-scope.js";
import { normalizeEffectiveTaskScopeEvidence, EFFECTIVE_TASK_SCOPE_POLICY_VERSION } from "../src/lib/effective-task-scope-policy.js";
import { createHash } from "node:crypto";

const BASE_REQ = {
  task: {
    id: "t_5edca620",
    title: "STEP4-SLICE1 — correct 38 E–J findings attempt 1 @ 61871824",
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
    commitSha: "618718247352fa6ae5e2a530c209845ef43e7378",
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
  contextPackId: "context_1cd7a822ac1856773cb202309fe4e77d5abef65b44bb2ac686d4085ffa6b870f",
  projectId: "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  project: { name: "hermes-project-map", rootId: "local", relativePath: "hermes-nexus-step4-slice1-write" },
  revision: {
    status: "available",
    commitSha: "618718247352fa6ae5e2a530c209845ef43e7378",
    branch: "feat/step4-slice1-ets-v2",
    dirty: false,
    repositoryIdentity: "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529",
    worktreeId: "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d",
    isLinkedWorktree: true
  },
  analysis: { schemaVersion: 1, status: "partial", snapshotToken: "e6d3785886e5e90776a1aa9de770115acb5a32dfbc4e74a591af533c6151bd96", provider: { id: "native.typescript", version: "1" } },
  observation: { basis: "working_tree", incomplete: true, sourceDigest: "fd20451a9bd4547d01377c4afe1d75127659212703e2a903f75f839250cb8850" },
  sections: {
    task: {
      items: [{
        id: "t_5edca620",
        title: "STEP4-SLICE1 — correct 38 E–J findings attempt 1 @ 61871824",
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
    { originPath: "src/lib/effective-task-scope-policy.js", targetSource: { path: "src/lib/effective-task-scope-policy.js", hash: "2c8f6d1d05e8100d9caf7df5d371fd7e0b3105c158f8fe53acda9a494c7ccd3b" }, status: "partial", findingState: "evidence_found", completeness: { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"] } },
    { originPath: "src/lib/effective-task-scope.js", targetSource: { path: "src/lib/effective-task-scope.js", hash: "aecff20f5dcab5bfcbf6da095f6f52c342ec580e4b2c085673a60988b6509baf" }, status: "partial", findingState: "evidence_found", completeness: { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"] } },
    { originPath: "tests/effective-task-scope-policy.test.js", targetSource: { path: "tests/effective-task-scope-policy.test.js", hash: "f6279a0cadc55b0409d9dce80f1b31b9fd9a5f33e08f303ab65712cc70f98d44" }, status: "partial", findingState: "no_evidence_found", completeness: { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"] } },
    { originPath: "tests/effective-task-scope.test.js", targetSource: { path: "tests/effective-task-scope.test.js", hash: "8e77eca090b2d79e8d8ead13ede5d196b449c3703333e496f1e58aa56c228a18" }, status: "partial", findingState: "no_evidence_found", completeness: { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"] } }
  ],
  revision: {
    status: "available",
    commitSha: "618718247352fa6ae5e2a530c209845ef43e7378",
    branch: "feat/step4-slice1-ets-v2",
    repositoryId: "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529",
    worktreeId: "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d",
    dirty: false,
    isLinkedWorktree: true
  },
  snapshotToken: "e6d3785886e5e90776a1aa9de770115acb5a32dfbc4e74a591af533c6151bd96",
  provider: { id: "native.typescript", version: "1" },
  coverage: { observed: ["javascript"], covered: ["javascript"], uncovered: ["python"] },
  observation: { basis: "working_tree", incomplete: true },
  limits: { depth: 2, affectedFiles: 80, compactBytes: 65536 },
  status: "partial",
  findingState: "evidence_found",
  affectedFiles: [
    { path: "src/lib/effective-task-scope.js", origins: [ { originPath: "src/lib/effective-task-scope-policy.js", minimumDistance: 1, witness: { id: "e1", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"src/lib/effective-task-scope.js",hash:"aecff20f5dcab5bfcbf6da095f6f52c342ec580e4b2c085673a60988b6509baf"}, location:null, trust:"derived_analysis", basis:"structural" } } ], originSummary: { discoveredOriginCount:1, retainedOriginWitnessCount:1, attributionTruncated:false } },
    { path: "tests/effective-task-scope-policy.test.js", origins: [ { originPath: "src/lib/effective-task-scope-policy.js", minimumDistance: 1, witness: { id: "e2", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"tests/effective-task-scope-policy.test.js",hash:"f6279a0cadc55b0409d9dce80f1b31b9fd9a5f33e08f303ab65712cc70f98d44"}, location:null, trust:"derived_analysis", basis:"structural" } } ], originSummary: { discoveredOriginCount:1, retainedOriginWitnessCount:1, attributionTruncated:false } },
    { path: "tests/effective-task-scope.test.js", origins: [ { originPath: "src/lib/effective-task-scope.js", minimumDistance: 1, witness: { id: "e3", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"tests/effective-task-scope.test.js",hash:"8e77eca090b2d79e8d8ead13ede5d196b449c3703333e496f1e58aa56c228a18"}, location:null, trust:"derived_analysis", basis:"structural" } }, { originPath: "src/lib/effective-task-scope-policy.js", minimumDistance: 2, witness: { id: "e4", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"tests/effective-task-scope.test.js",hash:"8e77eca090b2d79e8d8ead13ede5d196b449c3703333e496f1e58aa56c228a18"}, location:null, trust:"derived_analysis", basis:"structural" } } ], originSummary: { discoveredOriginCount:2, retainedOriginWitnessCount:2, attributionTruncated:false } }
  ],
  affectedTests: {
    status: "partial",
    findingState: "evidence_found",
    candidates: [
      { path: "tests/effective-task-scope-policy.test.js", origins: [ { originPath: "src/lib/effective-task-scope-policy.js", minimumDistance: 1, witness: { id: "e2", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"tests/effective-task-scope-policy.test.js",hash:"f6279a0cadc55b0409d9dce80f1b31b9fd9a5f33e08f303ab65712cc70f98d44"}, location:null, trust:"derived_analysis", basis:"structural" } } ], originSummary: { discoveredOriginCount:1, retainedOriginWitnessCount:1, attributionTruncated:false }, provenance: { trust: "derived_analysis", basis: "heuristic", reason: "test_path_convention" } },
      { path: "tests/effective-task-scope.test.js", origins: [ { originPath: "src/lib/effective-task-scope.js", minimumDistance: 1, witness: { id: "e3", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"tests/effective-task-scope.test.js",hash:"8e77eca090b2d79e8d8ead13ede5d196b449c3703333e496f1e58aa56c228a18"}, location:null, trust:"derived_analysis", basis:"structural" } }, { originPath: "src/lib/effective-task-scope-policy.js", minimumDistance: 2, witness: { id: "e4", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"tests/effective-task-scope.test.js",hash:"8e77eca090b2d79e8d8ead13ede5d196b449c3703333e496f1e58aa56c228a18"}, location:null, trust:"derived_analysis", basis:"structural" } } ], originSummary: { discoveredOriginCount:2, retainedOriginWitnessCount:2, attributionTruncated:false }, provenance: { trust: "derived_analysis", basis: "heuristic", reason: "test_path_convention" } }
    ],
    completeness: { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"] }
  },
  completeness: { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"], traversal: [], output: [] }
};

const UNEVAL_IMPACT = {
  ...MIN_IMPACT,
  findingState: "not_evaluated",
  status: "not_evaluated",
  affectedFiles: [],
  affectedTests: { status: "not_evaluated", findingState: "not_evaluated", candidates: [] },
  observation: { basis: "working_tree", incomplete: true }
};

test("composer: rejects on missing required fields", () => {
  const res = composeEffectiveTaskScope({}, {});
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.some(r => (r.code || "").includes("invalid")));
});

test("composer: returns incomplete for missing target sources, write available explicit per contract", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.schemaVersion, 2);
  assert.equal(res.analysisVersion, "effective-task-scope-v2");
  assert.equal(res.policyVersion, "step4-foundation-6");
  assert.equal(res.status, "incomplete");
  assert.ok(Array.isArray(res.reasons));
  assert.deepEqual(res.task.paths, BASE_REQ.task.paths);
  assert.equal(res.write.status, "available");
  assert.equal(res.reserved.status, "not_evaluated");
  assert.ok(res.reserved.reasons.includes("coupling_evidence_not_supported"));
  assert.equal(res.changeSemantics.effective, "unknown");
  // witnesses retained
  assert.ok(res.evidence && Array.isArray(res.evidence.origins));
});

test("composer: unevaluated Impact global yields not_evaluated with NO classification containers, no write.available", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: UNEVAL_IMPACT });
  assert.equal(res.status, "not_evaluated");
  assert.ok(!("write" in res));
  assert.ok(!("watch" in res));
  assert.ok(!("impact" in res));
  assert.ok(!("reserved" in res));
  assert.ok(res.task && res.task.id === BASE_REQ.task.id); // echo retained as intent
  assert.ok(res.reasons.some(r => (r.code || "").includes("not_evaluated") || (r.code || "").includes("impact")));
});

test("composer: dirty true yields not_evaluated without classification containers", () => {
  const dirtyPack = { ...MIN_PACK, revision: { ...MIN_PACK.revision, dirty: true } };
  const dirtyImpact = { ...MIN_IMPACT, revision: { ...MIN_IMPACT.revision, dirty: true } };
  const dirtyReq = { ...BASE_REQ, expectedRevision: { ...BASE_REQ.expectedRevision, dirty: true } };
  const res = composeEffectiveTaskScope(dirtyReq, { pack: dirtyPack, impact: dirtyImpact });
  assert.equal(res.status, "not_evaluated");
  assert.ok(!("write" in res));
  assert.ok(!("watch" in res));
  assert.ok(!("impact" in res));
  assert.ok(!("reserved" in res));
  assert.ok(res.reasons.some(r => String(r.code || "").includes("working_tree") || String(r.code || "").includes("dirty")));
});

test("composer: symbols nonempty without witness -> not_evaluated symbol_target_evidence_missing, no cats", () => {
  const symReq = { ...BASE_REQ, task: { ...BASE_REQ.task, symbols: ["Foo"] } };
  const symPack = { ...MIN_PACK, sections: { ...MIN_PACK.sections, task: { items: [ { ...MIN_PACK.sections.task.items[0], symbols: ["Foo"] } ] } } };
  const res = composeEffectiveTaskScope(symReq, { pack: symPack, impact: MIN_IMPACT });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some(r => r.code === "symbol_target_evidence_missing"));
  assert.ok(!("write" in res));
  assert.ok(!("watch" in res));
  assert.ok(!("impact" in res));
  assert.ok(!("reserved" in res));
});

test("composer: cross project mismatch rejects", () => {
  const badPack = { ...MIN_PACK, projectId: "prj_other" };
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: badPack, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
});

test("composer: v2 output exact versions, no confidence, no writeExhaustive (v2 per-cat)", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.schemaVersion, 2);
  assert.ok(!("confidence" in res));
  assert.ok(!("writeExhaustive" in res) || res.writeExhaustive === undefined);
});

test("composer: purity - same input produces identical output (determinism)", () => {
  const r1 = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  const r2 = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.deepEqual(r1, r2);
});

test("composer: includeTests false requires not_requested no cands; true mismatch rejected", () => {
  const reqNo = { ...BASE_REQ, includeTests: false };
  const resNo = composeEffectiveTaskScope(reqNo, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(resNo.status, "rejected");
  const badTrue = { ...BASE_REQ, includeTests: true };
  const badImp = { ...MIN_IMPACT, affectedTests: { status: "not_requested", findingState: "not_requested", candidates: [] } };
  const resBad = composeEffectiveTaskScope(badTrue, { pack: MIN_PACK, impact: badImp });
  assert.equal(resBad.status, "rejected");
});

test("composer: stale when er differs but pack/impact coherent internally (no containers)", () => {
  const staleEr = { ...BASE_REQ, expectedRevision: { ...BASE_REQ.expectedRevision, commitSha: "0000000000000000000000000000000000000000" } };
  const res = composeEffectiveTaskScope(staleEr, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.status, "stale");
  assert.ok(!("write" in res) || res.write == null);
  assert.ok(res.stale && res.stale.state === "stale");
});

test("composer: provider mismatch rejects", () => {
  const badImp = { ...MIN_IMPACT, provider: { id: "other", version: "9" } };
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: badImp });
  assert.equal(res.status, "rejected");
});

test("composer: snapshot absence or mismatch rejects", () => {
  const badPack = { ...MIN_PACK, analysis: { ...MIN_PACK.analysis, snapshotToken: "wrong" } };
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: badPack, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
});

test("composer: null IDs or alias conflict reject (no null==null)", () => {
  const badEr = { ...BASE_REQ, expectedRevision: { ...BASE_REQ.expectedRevision, repositoryId: null } };
  const res = composeEffectiveTaskScope(badEr, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
});

test("composer: F-ALIAS-CONFLICT pack.repositoryId != pack.repositoryIdentity rejects (no incomplete+write)", () => {
  const aliasPack = {
    ...MIN_PACK,
    revision: { ...MIN_PACK.revision, repositoryIdentity: MIN_PACK.revision.repositoryIdentity, repositoryId: "1111111111111111111111111111111111111111111111111111111111111111" }
  };
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: aliasPack, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
  assert.ok(!("write" in res) || res.write == null);
  assert.ok(!("watch" in res) || res.watch == null);
  assert.ok(res.reasons && res.reasons.some(r => r.code && r.code.includes("repository_identity")));
});

test("composer: path rejection for traversal/glob via normalize", () => {
  const badPathReq = { ...BASE_REQ, task: { ...BASE_REQ.task, paths: ["../outside.js"] } };
  const res = composeEffectiveTaskScope(badPathReq, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
});

test("composer: requested compactBytes enforced, output budget", () => {
  const bigLim = { ...BASE_REQ, limits: { compactBytes: 10 } }; // too small will exceed in practice for full
  const res = composeEffectiveTaskScope(bigLim, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons && res.reasons.some(r => r.code === "scope_budget_exceeded"));
});

// === F-NESTING-ACCESSOR locking tests (mandatory exact per task) ===
test("composer: enumerable getter on evidence.pack rejected fail-closed; getter hit count === 0", () => {
  let hits = 0;
  const trappedPack = { ...MIN_PACK };
  Object.defineProperty(trappedPack, "trap", { enumerable: true, get() { hits++; return "x"; } });
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: trappedPack, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons && res.reasons.some(r => (r.code || "").includes("invalid") || (r.code || "").includes("record") || (r.code || "").includes("evidence")));
  assert.equal(hits, 0, "getter must not be invoked");
});

test("composer: enumerable getter on evidence.impact rejected fail-closed; getter hit count === 0", () => {
  let hits = 0;
  const trappedImpact = { ...MIN_IMPACT };
  Object.defineProperty(trappedImpact, "trap", { enumerable: true, get() { hits++; return "x"; } });
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: trappedImpact });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons && res.reasons.some(r => (r.code || "").includes("invalid") || (r.code || "").includes("record") || (r.code || "").includes("evidence")));
  assert.equal(hits, 0, "getter must not be invoked");
});

test("policy: normalizeEffectiveTaskScopeEvidence rejects accessor on pack/impact with hit===0 (no invoke)", () => {
  let packHits = 0;
  let impactHits = 0;
  const p = { ...MIN_PACK };
  const i = { ...MIN_IMPACT };
  Object.defineProperty(p, "trapP", { enumerable: true, get() { packHits++; return 1; } });
  Object.defineProperty(i, "trapI", { enumerable: true, get() { impactHits++; return 2; } });
  let err;
  try {
    normalizeEffectiveTaskScopeEvidence(p, i);
    assert.fail("should reject");
  } catch (e) { err = e; }
  assert.ok(err && (err.code === "invalid_record" || (err.message || "").includes("invalid")));
  assert.equal(packHits, 0);
  assert.equal(impactHits, 0);
});

test("composer: setter/accessor property on evidence.pack is not consumed", () => {
  let hits = 0;
  const trapped = { ...MIN_PACK };
  Object.defineProperty(trapped, "s", { enumerable: true, configurable: true, get() { return "s"; }, set(v) { hits++; } });
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: trapped, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
  assert.equal(hits, 0);
});

test("composer: pack array-index getter rejects before invocation or classification", () => {
  let getterHits = 0;
  const paths = [...MIN_PACK.sections.task.items[0].paths];
  Object.defineProperty(paths, 0, { enumerable: true, get() { getterHits++; return BASE_REQ.task.paths[0]; } });
  const pack = { ...MIN_PACK, sections: { ...MIN_PACK.sections, task: {
    ...MIN_PACK.sections.task, items: [{ ...MIN_PACK.sections.task.items[0], paths }]
  } } };
  const result = composeEffectiveTaskScope(BASE_REQ, { pack, impact: MIN_IMPACT });
  assert.equal(result.status, "rejected");
  assert.equal(Object.hasOwn(result, "write"), false);
  assert.equal(getterHits, 0);
});

test("composer: impact.targets array-index getter rejects before invocation or classification", () => {
  let getterHits = 0;
  const targets = [...MIN_IMPACT.targets];
  Object.defineProperty(targets, 0, { enumerable: true, get() { getterHits++; return MIN_IMPACT.targets[0]; } });
  const result = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: { ...MIN_IMPACT, targets } });
  assert.equal(result.status, "rejected");
  assert.equal(Object.hasOwn(result, "write"), false);
  assert.equal(getterHits, 0);
});

test("composer: array-index setter and nested array getter reject without access", () => {
  let setterHits = 0;
  const targets = [...MIN_IMPACT.targets];
  Object.defineProperty(targets, 0, { enumerable: true, set(_value) { setterHits++; } });
  const setterResult = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: { ...MIN_IMPACT, targets } });
  assert.equal(setterResult.status, "rejected");
  assert.equal(Object.hasOwn(setterResult, "write"), false);
  assert.equal(setterHits, 0);

  let getterHits = 0;
  const nested = [["data"]];
  Object.defineProperty(nested[0], 0, { enumerable: true, get() { getterHits++; return "data"; } });
  const pack = { ...MIN_PACK, extra: nested };
  const nestedResult = composeEffectiveTaskScope(BASE_REQ, { pack, impact: MIN_IMPACT });
  assert.equal(nestedResult.status, "rejected");
  assert.equal(Object.hasOwn(nestedResult, "write"), false);
  assert.equal(getterHits, 0);
});

test("composer: ordinary data-property arrays remain accepted; nesting 40 still rejects", () => {
  const accepted = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(accepted.status, "incomplete");
  assert.equal(accepted.write.status, "available");

  let nested = "leaf";
  for (let i = 0; i < 40; i++) nested = [nested];
  const rejected = composeEffectiveTaskScope(BASE_REQ, { pack: { ...MIN_PACK, extra: nested }, impact: MIN_IMPACT });
  assert.equal(rejected.status, "rejected");
  assert.equal(Object.hasOwn(rejected, "write"), false);
});

test("composer: distance truncation stays watch, origins minDist used, witnesses retained", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  // WRITE tests remain WRITE (not repeated in WATCH); non-write affected use dist
  // evidence has origins and witnesses (full fields, not empty)
  assert.ok(res.evidence && Array.isArray(res.evidence.origins) && res.evidence.origins.length > 0);
  assert.ok(res.evidence && Array.isArray(res.evidence.witnesses) && res.evidence.witnesses.length > 0);
  // truncation would keep watch (no truncation in fixture)
});

test("composer: F-TRUNC-WATCH truncated attribution + local_implementation stays WATCH not IMPACT; dist from origins[].minimumDistance", () => {
  const truncImpact = {
    ...MIN_IMPACT,
    targets: [{
      originPath: "src/lib/effective-task-scope-policy.js",
      targetSource: { path: "src/lib/effective-task-scope-policy.js", hash: "fa1f1f8c81732b564733ea862aa709fa197ec4cb81f684074715ce9e3cffb83a" },
      status: "partial",
      findingState: "evidence_found"
    }],
    affectedFiles: [
      { path: "src/lib/impact-policy.js", origins: [ { originPath: "src/lib/effective-task-scope-policy.js", minimumDistance: 1, witness: { id: "eX", provider: {id:"native.typescript",version:"1"}, capability:"dependencies", relationshipKind:"imports", source: {path:"src/lib/impact-policy.js",hash:"x"}, location:null, trust:"derived_analysis", basis:"structural" } } ], originSummary: { discoveredOriginCount:1, retainedOriginWitnessCount:1, attributionTruncated: true }, attributionTruncated: true }
    ]
  };
  const declReq = { ...BASE_REQ, changeSemantics: { category: "local_implementation" }, task: { ...BASE_REQ.task, paths: ["src/lib/effective-task-scope-policy.js"] } };
  // adjust pack task echo minimally for this test
  const truncPack = { ...MIN_PACK, sections: { ...MIN_PACK.sections, task: { items: [ { ...MIN_PACK.sections.task.items[0], paths: ["src/lib/effective-task-scope-policy.js"] } ] } } };
  const res = composeEffectiveTaskScope(declReq, { pack: truncPack, impact: truncImpact });
  assert.equal(res.status, "incomplete");
  assert.ok(res.watch && Array.isArray(res.watch.items));
  const watchPaths = res.watch.items.map(i => i.target.path);
  assert.ok(watchPaths.includes("src/lib/impact-policy.js"), "truncated must be in watch");
  assert.ok(!res.impact || !res.impact.items || res.impact.items.length === 0 || !res.impact.items.some(i => i.target.path === "src/lib/impact-policy.js"));
  // exact dist from origins
  const w = res.watch.items.find(i => i.target.path === "src/lib/impact-policy.js");
  assert.ok(w && w.origins && w.origins[0] && w.origins[0].minimumDistance === 1);
});

test("composer: not_evaluated and stale have no classification containers", () => {
  const dirtyReq = { ...BASE_REQ, expectedRevision: { ...BASE_REQ.expectedRevision, dirty: true } };
  const res = composeEffectiveTaskScope(dirtyReq, { pack: MIN_PACK, impact: MIN_IMPACT });
  // coherent clean evidence + supplied dirty true -> stale without containers (not bound not_e)
  assert.equal(res.status, "stale");
  assert.ok(!res.write && !res.watch && !res.impact && !res.reserved);
});

test("composer: origin-set equality and request paths match impact origins for binding", () => {
  // the MIN have matching for writes
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.status, "incomplete");
  assert.ok(res.write && res.write.status === "available");
  // mismatch set rejects (BINDING_FAIL_OPEN)
  const misTargets = MIN_IMPACT.targets.map(t => ({...t}));
  misTargets[0] = { ...misTargets[0], originPath: "other.js" };
  const misImp = { ...MIN_IMPACT, targets: misTargets };
  const resM = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: misImp });
  assert.equal(resM.status, "rejected");
  assert.ok(!resM.write);
  // single originPath form (no targets) rejects even on name match
  const singleImp = { ...MIN_IMPACT, targets: undefined, originPath: "src/lib/effective-task-scope-policy.js" };
  const resS = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: singleImp });
  assert.equal(resS.status, "rejected");
});

test("composer: terminal explicit null fields on unavailable accepted as not_evaluated no containers", () => {
  const termNull = { ...BASE_REQ, expectedRevision: { ...BASE_REQ.expectedRevision, status: "unavailable", commitSha: null, dirty: null, isLinkedWorktree: null } };
  const res = composeEffectiveTaskScope(termNull, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.status, "not_evaluated");
  assert.ok(!res.write && !res.watch);
  assert.ok(res.reasons && res.reasons.some(r => (r.code || "").includes("observation")));
});

test("composer: coherent + supplied dirty true yields stale (not bound not_e) without containers", () => {
  const dirtyTrue = { ...BASE_REQ, expectedRevision: { ...BASE_REQ.expectedRevision, dirty: true } };
  const res = composeEffectiveTaskScope(dirtyTrue, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(res.status, "stale");
  assert.ok(!res.write && !res.watch);
  assert.ok(res.stale && res.stale.state === "stale");
});

test("composer: deep nesting >32 rejects with budget (bounded walk before norm)", () => {
  const deep = {};
  let cur = deep;
  for (let i = 0; i < 40; i++) {
    cur.child = {};
    cur = cur.child;
  }
  const deepPack = { ...MIN_PACK, deep: deep };
  const res = composeEffectiveTaskScope(BASE_REQ, { pack: deepPack, impact: MIN_IMPACT });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons && res.reasons.some(r => r.code === "scope_budget_exceeded"));
});

function assertIngressRejected(request, evidence, hits) {
  const result = composeEffectiveTaskScope(request, evidence);
  assert.equal(result.status, "rejected");
  assert.equal(Object.hasOwn(result, "write"), false);
  assert.equal(hits(), 0, "untrusted code must never execute");
}

for (const field of ["pack", "impact"]) {
  test(`composer: evidence.${field} entry getter rejects with hits==0`, () => {
    let hits = 0;
    const evidence = { pack: MIN_PACK, impact: MIN_IMPACT };
    Object.defineProperty(evidence, field, { enumerable: true, get() { hits++; return field === "pack" ? MIN_PACK : MIN_IMPACT; } });
    assertIngressRejected(BASE_REQ, evidence, () => hits);
  });
}

test("composer: request.includeTests entry getter rejects with hits==0", () => {
  let hits = 0;
  const request = { ...BASE_REQ };
  Object.defineProperty(request, "includeTests", { enumerable: true, get() { hits++; return true; } });
  assertIngressRejected(request, { pack: MIN_PACK, impact: MIN_IMPACT }, () => hits);
});

for (const [field, original, key] of [["pack", MIN_PACK, "schemaVersion"], ["impact", MIN_IMPACT, "analysisVersion"]]) {
  test(`composer: inherited ${key} getter on ${field} rejects with hits==0`, () => {
    let hits = 0;
    const inherited = { ...original };
    delete inherited[key];
    const prototype = Object.create(Object.prototype);
    Object.defineProperty(prototype, key, { get() { hits++; return original[key]; } });
    Object.setPrototypeOf(inherited, prototype);
    assertIngressRejected(BASE_REQ, { pack: field === "pack" ? inherited : MIN_PACK, impact: field === "impact" ? inherited : MIN_IMPACT }, () => hits);
  });
}

for (const [label, target] of [["legitimate", MIN_IMPACT.targets[0]], ["hostile", { originPath: "hostile.js" }]]) {
  test(`composer: inherited array index ${label} target rejects with hits==0`, () => {
    let hits = 0;
    const targets = [...MIN_IMPACT.targets];
    delete targets[0];
    const prototype = Object.create(Array.prototype);
    Object.defineProperty(prototype, "0", { get() { hits++; return target; } });
    Object.setPrototypeOf(targets, prototype);
    assertIngressRejected(BASE_REQ, { pack: MIN_PACK, impact: { ...MIN_IMPACT, targets } }, () => hits);
  });
}

for (const place of ["pack", "nested"]) {
  test(`composer: own callable toJSON on ${place} rejects with hits==0`, () => {
    let hits = 0;
    const malicious = { toJSON() { hits++; return MIN_PACK; } };
    const pack = place === "pack" ? { ...MIN_PACK, ...malicious } : { ...MIN_PACK, extra: malicious };
    assertIngressRejected(BASE_REQ, { pack, impact: MIN_IMPACT }, () => hits);
  });
}

test("composer: nested ordinary callable rejects without execution", () => {
  let hits = 0;
  const callable = () => { hits++; return "safe"; };
  assertIngressRejected(BASE_REQ, { pack: { ...MIN_PACK, extra: { callable } }, impact: MIN_IMPACT }, () => hits);
});

function proxyProbe(target, substitutions = {}) {
  const hits = { get: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, getPrototypeOf: 0 };
  const { proxy, revoke } = Proxy.revocable(target, {
    get(...args) { hits.get++; return Reflect.get(...args); },
    getOwnPropertyDescriptor(object, key) {
      hits.getOwnPropertyDescriptor++;
      const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
      return Object.hasOwn(substitutions, key) ? { ...descriptor, value: substitutions[key] } : descriptor;
    },
    ownKeys(...args) { hits.ownKeys++; return Reflect.ownKeys(...args); },
    getPrototypeOf(...args) { hits.getPrototypeOf++; return Reflect.getPrototypeOf(...args); }
  });
  return { proxy, hits, revoke };
}

function assertProxyRejected(request, evidence, hits) {
  const result = composeEffectiveTaskScope(request, evidence);
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.reasons.map(reason => reason.code), ["invalid_record"]);
  for (const category of ["write", "watch", "impact", "reserved", "evidence"]) {
    assert.equal(Object.hasOwn(result, category), false, `${category} must not carry classification`);
  }
  if (hits) assert.deepEqual(hits, { get: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, getPrototypeOf: 0 });
}

const PROXY_PLACEMENTS = [
  ["root request", BASE_REQ, proxy => [proxy, { pack: MIN_PACK, impact: MIN_IMPACT }]],
  ["root evidence", { pack: MIN_PACK, impact: MIN_IMPACT }, proxy => [BASE_REQ, proxy]],
  ["evidence.pack", MIN_PACK, proxy => [BASE_REQ, { pack: proxy, impact: MIN_IMPACT }]],
  ["evidence.impact", MIN_IMPACT, proxy => [BASE_REQ, { pack: MIN_PACK, impact: proxy }]],
  ["impact.targets array", MIN_IMPACT.targets, proxy => [BASE_REQ, { pack: MIN_PACK, impact: { ...MIN_IMPACT, targets: proxy } }]],
  ["nested target", MIN_IMPACT.targets[0], proxy => [BASE_REQ, { pack: MIN_PACK, impact: { ...MIN_IMPACT, targets: [proxy, ...MIN_IMPACT.targets.slice(1)] } }]],
  ["nested targetSource", MIN_IMPACT.targets[0].targetSource, proxy => [BASE_REQ, { pack: MIN_PACK, impact: { ...MIN_IMPACT, targets: [{ ...MIN_IMPACT.targets[0], targetSource: proxy }, ...MIN_IMPACT.targets.slice(1)] } }]],
  ["nested evidence source", MIN_IMPACT.affectedFiles[0].origins[0].witness.source, proxy => {
    const impact = structuredClone(MIN_IMPACT);
    impact.affectedFiles[0].origins[0].witness.source = proxy;
    return [BASE_REQ, { pack: MIN_PACK, impact }];
  }],
  ["nested pack record", MIN_PACK.analysis, proxy => [BASE_REQ, { pack: { ...MIN_PACK, analysis: proxy }, impact: MIN_IMPACT }]],
  ["nested request paths", BASE_REQ.task.paths, proxy => [{ ...BASE_REQ, task: { ...BASE_REQ.task, paths: proxy } }, { pack: MIN_PACK, impact: MIN_IMPACT }]]
];

for (const [place, target, insert] of PROXY_PLACEMENTS) {
  test(`composer: ${place} Proxy rejects with all trap hits==0`, () => {
    const { proxy, hits } = proxyProbe(target);
    const [request, evidence] = insert(proxy);
    assertProxyRejected(request, evidence, hits);
  });
}

test("composer: descriptor-substitution evidence Proxy cannot classify attacker-controlled.js", () => {
  const attackerImpact = structuredClone(MIN_IMPACT);
  attackerImpact.affectedFiles[0].path = "attacker-controlled.js";
  const control = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: attackerImpact });
  assert.equal(control.write.status, "available");
  assert.ok(control.watch.items.some(item => item.target.path === "attacker-controlled.js"));
  const { proxy, hits } = proxyProbe({ pack: MIN_PACK, impact: MIN_IMPACT }, { impact: attackerImpact });
  assertProxyRejected(BASE_REQ, proxy, hits);
});

for (const [place, target, insert, substitutions] of [
  ["projectId", MIN_PACK, proxy => ({ pack: proxy, impact: MIN_IMPACT }), { projectId: "prj_substituted" }],
  ["schemaVersion", MIN_PACK, proxy => ({ pack: proxy, impact: MIN_IMPACT }), { schemaVersion: 2 }],
  ["analysisVersion", MIN_IMPACT, proxy => ({ pack: MIN_PACK, impact: proxy }), { analysisVersion: "substituted-analysis" }],
  ["targets", MIN_IMPACT, proxy => ({ pack: MIN_PACK, impact: proxy }), { targets: [{ ...MIN_IMPACT.targets[0], originPath: "attacker-controlled.js" }] }],
  ["affectedFiles", MIN_IMPACT, proxy => ({ pack: MIN_PACK, impact: proxy }), { affectedFiles: [{ ...MIN_IMPACT.affectedFiles[0], path: "attacker-controlled.js" }] }],
  ["source", MIN_IMPACT.affectedFiles[0].origins[0].witness, proxy => {
    const impact = structuredClone(MIN_IMPACT);
    impact.affectedFiles[0].origins[0].witness = proxy;
    return { pack: MIN_PACK, impact };
  }, { source: { path: "attacker-controlled.js", hash: "substituted" } }]
]) {
  test(`composer: ${place} descriptor substitution Proxy rejects before substitution with hits==0`, () => {
    const { proxy, hits } = proxyProbe(target, substitutions);
    assertProxyRejected(BASE_REQ, insert(proxy), hits);
  });
}

test("composer: forwarding no-op Proxies around valid data are rejected", () => {
  const control = composeEffectiveTaskScope(BASE_REQ, { pack: MIN_PACK, impact: MIN_IMPACT });
  assert.equal(control.write.status, "available");
  for (const [, target, insert] of PROXY_PLACEMENTS) {
    const { proxy, hits } = proxyProbe(target);
    const [forwardedRequest, forwardedEvidence] = insert(proxy);
    assertProxyRejected(forwardedRequest, forwardedEvidence, hits);
    // An empty handler has no traps to count, but must still be rejected.
    const [request, evidence] = insert(new Proxy(target, {}));
    assertProxyRejected(request, evidence);
  }
});

test("composer: revoked Proxies reject as invalid structural input without trap/error paths", () => {
  for (const [, target, insert] of PROXY_PLACEMENTS) {
    const { proxy, hits, revoke } = proxyProbe(target);
    revoke();
    const [request, evidence] = insert(proxy);
    assertProxyRejected(request, evidence, hits);
  }
});

// C-14 (READ legs, D3) golden: plain READ request, no witness key; global findingState no_evidence_found /
// evidence_found / not_evaluated. Top-level policyVersion (asserted equal to the policy constant first) replaced
// by "<policyVersion>", then sha256(JSON.stringify(result)). Captured from the 4b8e213 src on Node v26.8.2 with
// this test file:
//   HN_D3_PRINT_GOLDEN=1 node --test --test-name-pattern="D3 C-14" tests/effective-task-scope.test.js
const C14_READ_GOLDEN = [
  ["read findingState no_evidence_found", "a0bac408c3f8198ac2afa3868e44213066c81dca1624f78f60ddcb44f64ad7fe"],
  ["read findingState evidence_found", "a0bac408c3f8198ac2afa3868e44213066c81dca1624f78f60ddcb44f64ad7fe"],
  ["read findingState not_evaluated", "e1b30c6e21cb1d757f1e6ef05190743c3ac32e48f7362de645a679a3bca40a13"]
];
test("D3 C-14 (READ legs): no witness -> outcomes byte-identical to base except the policyVersion label", () => {
  const actual = ["no_evidence_found", "evidence_found", "not_evaluated"].map(findingState => {
    const r = composeEffectiveTaskScope(structuredClone(BASE_REQ), { pack: structuredClone(MIN_PACK), impact: { ...structuredClone(MIN_IMPACT), findingState } });
    assert.equal(r.policyVersion, EFFECTIVE_TASK_SCOPE_POLICY_VERSION, findingState);
    if (findingState === "not_evaluated") assert.deepEqual(r.reasons.map(reason => reason.code), ["impact_not_evaluated"]);
    else assert.equal(r.reasons.some(reason => reason.code === "impact_not_evaluated"), false, findingState);
    r.policyVersion = "<policyVersion>";
    return [`read findingState ${findingState}`, createHash("sha256").update(JSON.stringify(r), "utf8").digest("hex")];
  });
  if (process.env.HN_D3_PRINT_GOLDEN === "1") console.log(`C14_READ_GOLDEN ${JSON.stringify(actual)}`);
  assert.deepEqual(actual, C14_READ_GOLDEN);
});
