import assert from "node:assert/strict";
import test from "node:test";
import { compareTaskScopes } from "../src/lib/task-conflict-comparison.js";
import {
  EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION, EFFECTIVE_TASK_SCOPE_POLICY_VERSION, EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION
} from "../src/lib/effective-task-scope-policy.js";

const file = (path) => ({ target: { kind: "file", path } });
const complete = (paths) => ({ status: "available", truncated: false, items: paths.map(file), reasons: [] });
function scope(id, assignments = {}) {
  return {
    schemaVersion: EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
    analysisVersion: EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION, policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
    status: "available", task: { id, paths: assignments.write ?? [] }, projectId: "PrJ_Test",
    project: { rootId: "test", relativePath: "linked" },
    revisionBinding: {
      status: "available", commitSha: "a".repeat(40), repositoryId: "1".repeat(64), worktreeId: "2".repeat(64),
      branch: "dev", dirty: false, isLinkedWorktree: true
    },
    sourceBinding: { contextPackId: `context_${id}`, contextSourceDigest: "3".repeat(64),
      contextSnapshotToken: "4".repeat(64), impactSnapshotToken: "4".repeat(64) },
    stale: { state: "bound" },
    write: complete(assignments.write ?? []), watch: complete(assignments.watch ?? []),
    reserved: complete(assignments.reserved ?? []), impact: complete(assignments.impact ?? []),
    completeness: { source: [], provider: [], traversal: [], output: [], resolver: [] }
  };
}
const compare = (a, b) => {
  const first = compareTaskScopes(a, b);
  assert.deepEqual(first, compareTaskScopes(b, a), "comparison must be byte-for-byte symmetric");
  return first;
};

test("file overlap rules are symmetric, deterministic and distinguish shared interest from writes", () => {
  const classes = ["write", "reserved", "watch", "impact"];
  const matrix = [
    ["high", "high", "warning", "info"], ["high", "info", "info", "info"],
    ["warning", "info", "info", "info"], ["info", "info", "info", "info"]
  ];
  for (const [i, first] of classes.entries()) {
    for (const [j, second] of classes.entries()) {
      const a = scope("A", { write: ["a.js"], [first]: ["src/shared.js"] });
      const b = scope("B", { write: ["b.js"], [second]: ["src/shared.js"] });
      const result = compare(a, b);
      assert.deepEqual(result.taskIds, ["A", "B"]);
      assert.equal(result.status, "available");
      assert.equal(result.severity, matrix[i][j]);
      assert.deepEqual(result.overlaps, [{ path: "src/shared.js", categories: [first, second], severity: matrix[i][j] }]);
    }
  }
});

test("confirmed conflict survives incomplete ETS and wins over any weaker category for that path", () => {
  const a = scope("a", { write: ["shared.ts"], reserved: ["shared.ts"] });
  a.status = "incomplete";
  a.reserved.status = "incomplete";
  const b = scope("b", { write: ["shared.ts"] });
  b.reserved.status = "not_evaluated";
  const before = structuredClone(a);
  const result = compare(a, b);
  assert.equal(result.status, "incomplete");
  assert.equal(result.findingState, "overlap_observed");
  assert.equal(result.recommendedAction, "serialize");
  assert.deepEqual(result.overlaps, [{ path: "shared.ts", categories: ["write", "write"], severity: "high" }]);
  assert.deepEqual(result.reasons, ["reserved_incomplete", "scope_incomplete"]);
  assert.equal(result.binding.snapshotToken, a.sourceBinding.contextSnapshotToken);
  assert.deepEqual(a, before);
});

test("empty complete and empty partial comparisons have distinct results", () => {
  const a = scope("A", { write: ["a.js"] });
  const b = scope("B", { write: ["b.js"] });
  const completeResult = compare(a, b);
  assert.equal(completeResult.findingState, "no_overlap_observed");
  assert.equal(completeResult.severity, "none");
  assert.equal(completeResult.recommendedAction, "none");
  a.reserved.status = "not_evaluated";
  const partial = compare(a, b);
  assert.equal(partial.status, "incomplete");
  assert.equal(partial.severity, null);
  assert.equal(partial.recommendedAction, "reobserve");
  a.reserved.status = "available";
  b.completeness.provider.push("provider_partial");
  assert.equal(compare(a, b).status, "incomplete");
});

test("terminal and incompatible bindings withhold overlap evidence", () => {
  for (const [reason, change] of [
    ["scope_rejected", s => { s.status = "rejected"; }], ["scope_not_evaluated", s => { s.status = "not_evaluated"; }],
    ["scope_stale", s => { s.stale.state = "stale"; }], ["same_task", s => { s.task.id = "A"; }],
    ["unsupported_scope", s => { s.policyVersion = "other"; }], ["different_projects", s => { s.projectId = "other"; }],
    ["different_repositories", s => { s.revisionBinding.repositoryId = "c".repeat(64); }],
    ["different_revisions", s => { s.revisionBinding.commitSha = "b".repeat(40); }],
    ["invalid_revision_binding", s => { s.revisionBinding.dirty = true; }],
    ["invalid_revision_binding", s => { delete s.revisionBinding.worktreeId; }],
    ["worktree_locator_mismatch", s => { s.project.relativePath = "elsewhere"; }],
    ["different_snapshots", s => { s.sourceBinding.contextSnapshotToken = s.sourceBinding.impactSnapshotToken = "e".repeat(64); }],
    ["invalid_source_binding", s => { s.sourceBinding.contextSnapshotToken = null; }],
    ["different_snapshots", s => { s.sourceBinding.contextSourceDigest = "e".repeat(64); }]
  ]) {
    const a = scope("A", { write: ["x.ts"] }), b = scope("B", { write: ["x.ts"] });
    change(b);
    const result = compare(a, b);
    assert.equal(result.status, "not_evaluated", reason);
    assert.deepEqual(result.reasons, [reason]);
    assert.equal(result.binding, null);
    assert.deepEqual(result.overlaps, []);
  }
});

test("bounded evidence retains strongest findings before informational paths", () => {
  const paths = Array.from({ length: 24 }, (_, i) => `src/file${i}.ts`);
  const a = scope("A", { watch: paths.toReversed(), write: ["zzz.ts"] });
  const b = scope("B", { watch: paths, write: ["zzz.ts"] });
  const result = compare(a, b);
  assert.equal(result.truncated, true);
  assert.equal(result.totalOverlaps, 25);
  assert.equal(result.overlaps.length, 16);
  assert.equal(result.overlaps[0].path, "zzz.ts");
  assert.equal(result.status, "incomplete");
  assert.equal(result.recommendedAction, "serialize");
  assert.ok(result.reasons.includes("overlap_limit"));
});

test("malformed inputs cannot discard a bad entry and report a legitimate-looking overlap", () => {
  const b = scope("b", { write: ["x"] });
  for (const invalid of ["/etc/passwd", "../secret", "x/../x", ""]) {
    const a = scope("a", { write: ["x", invalid] });
    assert.deepEqual(compare(a, b).reasons, ["invalid_scope"]);
  }
  const undeclared = scope("a", { write: ["other"] });
  undeclared.write.items = [file("x")];
  assert.deepEqual(compare(undeclared, b).reasons, ["invalid_classification"]);
  const a = scope("a", { write: ["x"] });
  Object.defineProperty(a, "task", { get() { assert.fail("getter executed"); } });
  assert.deepEqual(compare(a, b).reasons, ["invalid_scope"]);
});

function impact(scope, hash) {
  return {
    schemaVersion: 1, analysisVersion: "impact-v2", status: "available", findingState: "evidence_found", projectId: scope.projectId,
    project: { ...scope.project }, revision: { ...scope.revisionBinding },
    snapshotToken: scope.sourceBinding.impactSnapshotToken,
    targets: scope.task.paths.map((path) => ({
      originPath: path, targetSource: { path, hash }, status: "available", findingState: "no_evidence_found"
    }))
  };
}

function siblings() {
  const a = scope("B", { write: ["shared.ts", "own.ts"], watch: ["b.ts"] });
  const b = scope("A", { write: ["shared.ts", "b.ts"], watch: ["own.ts"] });
  b.project.relativePath = "sibling";
  b.revisionBinding.worktreeId = "9".repeat(64);
  b.revisionBinding.branch = null;
  b.sourceBinding.contextSnapshotToken = b.sourceBinding.impactSnapshotToken = "8".repeat(64);
  return { a, b, leftImpact: impact(a, "c".repeat(64)), rightImpact: impact(b, "c".repeat(64)) };
}

test("sibling worktrees admit only independently hash-bound WRITE/WRITE and preserve distinct observations", () => {
  const { a, b, leftImpact, rightImpact } = siblings();
  const result = compareTaskScopes(a, b, { leftImpact, rightImpact });
  assert.deepEqual(result, compareTaskScopes(b, a, { leftImpact: rightImpact, rightImpact: leftImpact }));
  assert.equal(result.status, "incomplete");
  assert.equal(result.binding, null);
  assert.equal(result.severity, "high");
  assert.deepEqual(result.taskIds, ["A", "B"]);
  assert.deepEqual(result.scopeBindings.map(item => item.snapshotToken), [b.sourceBinding.impactSnapshotToken, a.sourceBinding.impactSnapshotToken]);
  assert.deepEqual(result.overlaps, [{ path: "shared.ts", categories: ["write", "write"], severity: "high", sourceHash: "c".repeat(64) }]);
  assert.ok(result.reasons.includes("sibling_write_evidence_only"));
});

test("sibling comparisons never infer a negative from missing, stale, mismatched or unread target evidence", () => {
  for (const change of [
    f => { f.rightImpact.targets[0].targetSource.hash = "a".repeat(64); },
    f => { f.rightImpact.targets[0].targetSource = null; },
    f => { f.rightImpact.targets[0].findingState = "not_evaluated"; },
    f => { f.leftImpact.snapshotToken = f.rightImpact.snapshotToken; },
    f => { f.rightImpact.findingState = "not_evaluated"; },
    f => { f.rightImpact.originPath = "shared.ts"; },
    f => { f.leftImpact.revision = { ...f.rightImpact.revision }; },
    f => { f.leftImpact.projectId = "different"; }, f => { delete f.leftImpact; },
    f => { f.rightImpact.targets[0].originPath = "b.ts"; },
    f => { f.rightImpact.targets[0].targetSource.path = "b.ts"; },
    f => { f.a.revisionBinding.commitSha = "c".repeat(40); }
  ]) {
    const fx = siblings();
    change(fx);
    const result = compareTaskScopes(fx.a, fx.b, fx);
    assert.equal(result.status, "not_evaluated");
    assert.equal(result.severity, null);
    assert.equal(result.binding, null);
    assert.deepEqual(result.overlaps, []);
  }
});

test("sibling results distinguish verified overlaps from missing hashes and disjoint tasks", () => {
  const fx = siblings();
  for (const scope of [fx.a, fx.b]) {
    scope.task.paths.push("also.ts");
    scope.write.items.push(file("also.ts"));
  }
  fx.leftImpact.targets.push({ ...fx.leftImpact.targets[0], originPath: "also.ts", targetSource: null });
  fx.rightImpact.targets.push({ ...fx.rightImpact.targets[0], originPath: "also.ts", targetSource: null });
  const mixed = compareTaskScopes(fx.a, fx.b, fx);
  assert.equal(mixed.totalOverlaps, 1);
  assert.equal(mixed.status, "incomplete");
  assert.ok(mixed.reasons.includes("unverified_shared_write"));

  const { a, b } = siblings();
  a.task.paths = ["own.ts"];
  a.write.items = [file("own.ts")];
  const disjoint = compareTaskScopes(a, b, { leftImpact: impact(a, "c".repeat(64)), rightImpact: impact(b, "c".repeat(64)) });
  assert.equal(disjoint.findingState, "not_evaluated");
  assert.deepEqual(disjoint.overlaps, []);
  assert.ok(disjoint.reasons.includes("no_verified_shared_write"));
});

test("sibling evidence accessors and proxies are refused without invoking their code", () => {
  const { a, b, leftImpact, rightImpact } = siblings();
  let trapCalls = 0;
  function trap() {
    trapCalls++;
    throw new Error("input trap executed");
  }
  const handlers = { get: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap };
  const inherited = Object.create({ get leftImpact() { return trap(); } });
  inherited.rightImpact = rightImpact;
  const revoked = Proxy.revocable({ leftImpact, rightImpact }, handlers);
  revoked.revoke();
  for (const evidence of [
    { get leftImpact() { return trap(); }, rightImpact }, { leftImpact, get rightImpact() { return trap(); } },
    inherited, new Proxy({ leftImpact, rightImpact }, handlers), revoked.proxy,
    { leftImpact: new Proxy(leftImpact, handlers), rightImpact }
  ]) {
    const result = compareTaskScopes(a, b, evidence);
    assert.equal(result.status, "not_evaluated");
    assert.deepEqual(result.reasons, ["unbound_sibling_impact"]);
    assert.equal(trapCalls, 0);
  }
});

test("sibling evidence has independent byte and value-count budgets for its two Impact envelopes", () => {
  const { a, b, leftImpact, rightImpact } = siblings();
  for (const impact of [leftImpact, rightImpact]) {
    impact.padding = "x".repeat(70000);
    impact.items = Array(10500).fill(0);
  }
  const result = compareTaskScopes(a, b, { leftImpact, rightImpact });
  assert.equal(result.severity, "high");
  leftImpact.padding = "x".repeat(131072);
  assert.deepEqual(compareTaskScopes(a, b, { leftImpact, rightImpact }).reasons, ["unbound_sibling_impact"]);
});

function crossDependencyFixture() {
  const { a, b } = siblings();
  a.task.paths = ["lib.ts"]; a.write = complete(a.task.paths); a.watch = complete(["consumer.ts"]);
  b.task.paths = ["consumer.ts"]; b.write = complete(b.task.paths); b.watch = complete([]);
  const libHash = "d".repeat(64), consumerHash = "c".repeat(64);
  const provider = { id: "native.typescript", version: "4" };
  const observerImpact = (snapshot, identifier) => {
    const result = impact({ ...snapshot, task: { paths: ["lib.ts"] } }, libHash);
    result.provider = provider;
    result.targets[0].findingState = "evidence_found";
    result.affectedFiles = [{ path: "consumer.ts", origins: [{
      originPath: "lib.ts", minimumDistance: 1,
      witness: { id: "impact_edge_" + identifier.repeat(64), provider, capability: "dependencies", relationshipKind: "imports",
        basis: "structural", trust: "derived_analysis", source: { path: "consumer.ts", hash: consumerHash } }
    }] }];
    return result;
  };
  return { a, b, evidence: { leftImpact: observerImpact(a, "1"), rightImpact: impact(b, consumerHash),
    rightPeerImpact: observerImpact(b, "2") } };
}

test("sibling WATCH evidence rejects stale, foreign, unbound and mismatched supplemental graph records", () => {
  const valid = crossDependencyFixture();
  assert.equal(compareTaskScopes(valid.a, valid.b, valid.evidence).severity, "warning");
  for (const change of [
    peer => { peer.snapshotToken = "e".repeat(64); },
    peer => { peer.revision.commitSha = "e".repeat(40); },
    peer => { peer.revision.repositoryId = "e".repeat(64); },
    peer => { peer.revision.worktreeId = "e".repeat(64); },
    peer => { peer.projectId = "PrJ_Foreign"; },
    peer => { peer.project.relativePath = "another"; },
    peer => { peer.targets[0].targetSource.hash = "f".repeat(64); },
    peer => { peer.findingState = "no_evidence_found"; },
    peer => { peer.targets[0].findingState = "no_evidence_found"; },
    peer => { peer.affectedFiles[0].origins[0].witness.source.hash = "a".repeat(64); },
    peer => { peer.affectedFiles[0].origins[0].witness.source.path = "another.ts"; },
    peer => { peer.affectedFiles[0].origins[0].witness.provider = { id: "other", version: "1" }; },
    peer => { peer.affectedFiles[0].origins[0].witness.id = "anonymous"; },
    peer => { peer.affectedFiles[0].origins[0].minimumDistance = 0; },
    peer => { peer.affectedFiles[0].origins[0].originPath = {}; },
    peer => { peer.affectedFiles[0].origins[0].minimumDistance = {}; },
    peer => { peer.affectedFiles[0].origins = []; }
  ]) {
    const { a, b, evidence } = crossDependencyFixture();
    change(evidence.rightPeerImpact);
    const result = compareTaskScopes(a, b, evidence);
    assert.equal(result.status, "not_evaluated");
    assert.equal(result.severity, null);
    assert.deepEqual(result.overlaps, []);
  }
});

test("new optional evidence fields cannot invoke accessors or proxy traps", () => {
  for (const key of ["rightPeerImpact", "leftSymbolWitness"]) {
    const { a, b, evidence } = crossDependencyFixture();
    let calls = 0;
    Object.defineProperty(evidence, key, { get() { calls++; throw new Error("trap invoked"); } });
    assert.deepEqual(compareTaskScopes(a, b, evidence).overlaps, []);
    assert.equal(calls, 0);
  }
});
