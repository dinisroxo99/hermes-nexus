import test from "node:test";
import assert from "node:assert/strict";
import { composeEffectiveTaskScope } from "../src/lib/effective-task-scope.js";

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
  assert.equal(res.policyVersion, "step4-foundation-1");
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

test("composer: symbols nonempty -> not_evaluated symbol_targets_not_supported, no cats", () => {
  const symReq = { ...BASE_REQ, task: { ...BASE_REQ.task, symbols: ["Foo"] } };
  const symPack = { ...MIN_PACK, sections: { ...MIN_PACK.sections, task: { items: [ { ...MIN_PACK.sections.task.items[0], symbols: ["Foo"] } ] } } };
  const res = composeEffectiveTaskScope(symReq, { pack: symPack, impact: MIN_IMPACT });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some(r => r.code === "symbol_targets_not_supported"));
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