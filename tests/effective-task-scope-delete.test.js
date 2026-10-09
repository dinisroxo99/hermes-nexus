import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { composeEffectiveTaskScope as compose } from "../src/lib/effective-task-scope.js";
import { composeEffectiveTaskScopeFromEnvelopes } from "../src/lib/effective-task-scope-adapter.js";
import { createHash } from "node:crypto";
import { EFFECTIVE_TASK_SCOPE_POLICY_VERSION } from "../src/lib/effective-task-scope-policy.js";

// Synthetic consistency fixtures only; not authenticated/live observations.
function fixture(paths = ["src/a.js", "src/z.js"]) {
  const revision = { status: "available", commitSha: "a".repeat(40), branch: "fixture",
    dirty: false, isLinkedWorktree: true, repositoryId: "b".repeat(64), worktreeId: "c".repeat(64) };
  const provider = { id: "native.typescript", version: "1" };
  const coverage = { observed: ["javascript", "python"], covered: ["javascript"], uncovered: ["python"] };
  const completeness = { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"], traversal: ["depth_limit"], output: ["origin_limit"] };
  const task = { id: "delete-fixture", title: "Delete fixture", paths, symbols: [] };
  const project = { rootId: "fixture", relativePath: "fixture" };
  const provenance = { projectId: "prj_fixture", revisionRef: "revision", trust: "untrusted_repository_text", producer: "context-source-observation" };
  const section = (items, limit, status = "available") => ({ items, limit, status, truncated: false, provenance });
  const request = { task, projectId: "prj_fixture", worktree: project, expectedRevision: revision,
    includeTests: true, changeSemantics: { category: "local_implementation" },
    operationIntent: { kind: "delete", targets: paths.map(oldPath => ({ oldPath, newPath: null })) } };
  const pack = { schemaVersion: 1, analysisVersion: "task-context-v1", contextPackId: "fixture", projectId: "prj_fixture", project,
    revision: { ...revision, repositoryIdentity: revision.repositoryId },
    analysis: { status: "partial", snapshotToken: "snapshot", provider, coverage },
    observation: { incomplete: true, digestCoverage: "bounded_collected_sources", sourceDigest: "d".repeat(64) },
    sections: { task: section([task], 1), files: section(paths.map(path => ({ path,
      provenance: { trust: "canonical_fact", reason: "task_path", source: { path, sha256: "e".repeat(64) } } })), 32),
      symbols: section([], 0, "not_analyzed") } };
  const witness = { id: "edge", provider, capability: "dependencies", relationshipKind: "imports",
    source: { path: "src/far.js", hash: "f".repeat(64) }, location: null, trust: "derived_analysis", basis: "structural" };
  const affected = { path: "src/far.js", origins: [{ originPath: paths[0], minimumDistance: 5, witness }],
    originSummary: { discoveredOriginCount: 1, retainedOriginWitnessCount: 1, attributionTruncated: false, reasons: [] } };
  const impact = { schemaVersion: 1, analysisVersion: "impact-v2", projectId: "prj_fixture", project, revision,
    snapshotToken: "snapshot", provider, coverage, observation: { incomplete: true, digestCoverage: "bounded_collected_sources" },
    targets: paths.map(originPath => ({ originPath, targetSource: { path: originPath, hash: "e".repeat(64) },
      status: "partial", findingState: "no_evidence_found", completeness })),
    status: "partial", findingState: "evidence_found", affectedFiles: [affected],
    affectedTests: { status: "partial", findingState: "no_evidence_found", candidates: [], completeness }, completeness };
  // Separate producer/request identities so a mutation tests disagreement, not aliases.
  return JSON.parse(JSON.stringify({ request, evidence: { pack, impact } }));
}
const run = f => compose(f.request, f.evidence);
function terminal(f, status, code) {
  const r = run(f);
  assert.equal(r.status, status);
  assert.ok(r.reasons.some(reason => reason.code === code), JSON.stringify(r));
  for (const key of ["write", "reserved", "watch", "impact", "operationIntent"]) assert.equal(Object.hasOwn(r, key), false);
  return r;
}

test("delete: source-bound explicit WRITE; every retained effect WATCH, no safety or expansion", () => {
  const f = fixture(); const before = JSON.stringify(f); const r = run(f);
  assert.equal(r.status, "incomplete"); assert.equal(r.policyVersion, "step4-foundation-6");
  assert.deepEqual(r.write.items.map(i => i.target.path), f.request.task.paths);
  assert.ok(r.write.items.every(i => i.ruleIds.includes("explicit_delete_intent")));
  assert.deepEqual(r.watch.items.map(i => i.target.path), ["src/far.js"]);
  assert.ok(r.watch.items[0].ruleIds.includes("delete_intent_awareness"));
  assert.equal(JSON.stringify(r.watch.items[0].evidenceRefs[0].witness), JSON.stringify(f.evidence.impact.affectedFiles[0].origins[0].witness));
  assert.deepEqual(r.impact.items, []); assert.deepEqual(r.reserved.items, []);
  assert.equal(r.reserved.status, "not_evaluated");
  assert.deepEqual(r.reserved.reasons, ["coupling_evidence_not_supported"]);
  assert.equal(r.changeSemantics.effective, "local_implementation");
  assert.equal(r.stale.requiresReobservation, true);
  const op = r.operationIntent;
  assert.deepEqual(Object.keys(op), ["kind", "provenance", "targets", "evidence"]);
  assert.deepEqual(op.targets, f.request.operationIntent.targets);
  assert.equal(op.provenance, "task_declaration");
  assert.deepEqual(op.evidence.sources[0], { oldPath: "src/a.js", context: {
    source: { path: "src/a.js", sha256: "e".repeat(64) }, trust: "canonical_fact", reason: "task_path" },
    impact: { path: "src/a.js", hash: "e".repeat(64) } });
  assert.deepEqual(op.evidence.impact.completeness, f.evidence.impact.completeness);
  assert.deepEqual(op.evidence.providers, { context: f.evidence.pack.analysis.provider, impact: f.evidence.impact.provider });
  assert.deepEqual(op.evidence.coverage, { context: f.evidence.pack.analysis.coverage, impact: f.evidence.impact.coverage });
  assert.deepEqual(op.evidence.context.sections.symbols, { status: "not_analyzed", limit: 0, truncated: false });
  assert.deepEqual(op.evidence.impact.targets[0].completeness, f.evidence.impact.targets[0].completeness);
  assert.ok(r.completeness.resolver.some(reason => reason.startsWith("delete_context_section_")));
  assert.equal(JSON.stringify(f), before);
});

for (const intent of [null, {}, { kind: "rename", targets: [] },
  { kind: "delete", targets: [] }, { kind: "delete", targets: [{ newPath: null }] },
  { kind: "delete", targets: [{ oldPath: null, newPath: null }] },
  { kind: "delete", targets: [{ oldPath: "src/a.js" }] },
  { kind: "delete", targets: [{ oldPath: "src/a.js", newPath: "dst.js" }] },
  { kind: "delete", targets: [{ oldPath: "src/a.js", newPath: null, exists: true }] },
  { kind: "delete", targets: [{ oldPath: "src/a.js", newPath: null, kind: "rename" }] },
  { kind: "delete", targets: [{ oldPath: "src/a.js", newPath: null }], source: true }]) {
  test(`delete: malformed declaration ${JSON.stringify(intent)} rejected`, () => {
    const f = fixture(); f.request.operationIntent = intent;
    terminal(f, "rejected", "invalid_delete_intent");
  });
}
test("delete: empty create intent now routes to invalid_create_intent", () => {
  const f = fixture(); f.request.operationIntent = { kind: "create", targets: [] };
  terminal(f, "rejected", "invalid_create_intent");
});
for (const path of ["../a", "/a", " src/a.js", "src//a.js", "src/./a.js", "src/a.js/", "src/*.js", "C:/a", "src\\a.js", "src/a.js\n"]) {
  test(`delete: literal spelling rejected ${JSON.stringify(path)}`, () => {
    const f = fixture(); f.request.operationIntent.targets[0].oldPath = path;
    terminal(f, "rejected", "invalid_delete_intent");
  });
}
test("delete: declaration set equality and singleton Impact remains rejected", () => {
  for (const paths of [["src/a.js"], ["src/a.js", "src/unlisted.js"]]) {
    const f = fixture(); f.request.operationIntent.targets = paths.map(oldPath => ({ oldPath, newPath: null }));
    terminal(f, "rejected", "delete_intent_target_mismatch");
  }
  const f = fixture(["src/a.js"]); f.evidence.impact.originPath = "src/a.js"; delete f.evidence.impact.targets;
  terminal(f, "rejected", "origin_form_mismatch");
});
for (const [name, mutate, status, code] of [
  ["missing file", f => f.evidence.pack.sections.files.items.pop(), "not_evaluated", "delete_source_not_evaluated"],
  ["absent files section", f => delete f.evidence.pack.sections.files, "not_evaluated", "delete_source_not_evaluated"],
  ["omitted files", f => { f.evidence.pack.sections.files.status = "omitted"; f.evidence.pack.sections.files.items = []; }, "not_evaluated", "delete_source_not_evaluated"],
  ["not analyzed files", f => { f.evidence.pack.sections.files.status = "not_analyzed"; f.evidence.pack.sections.files.items = []; }, "not_evaluated", "delete_source_not_evaluated"],
  ["null target source", f => f.evidence.impact.targets[1].targetSource = null, "not_evaluated", "delete_source_not_evaluated"],
  ["omitted target source", f => delete f.evidence.impact.targets[1].targetSource, "not_evaluated", "delete_source_not_evaluated"],
  ["unevaluated target", f => f.evidence.impact.targets[1].findingState = "not_evaluated", "not_evaluated", "delete_target_not_evaluated"],
  ["duplicate file", f => f.evidence.pack.sections.files.items.push(structuredClone(f.evidence.pack.sections.files.items[0])), "rejected", "delete_source_binding_mismatch"],
  ["duplicate target", f => f.evidence.impact.targets.push(structuredClone(f.evidence.impact.targets[0])), "rejected", "delete_source_binding_mismatch"],
  ["wrong hash", f => f.evidence.impact.targets[0].targetSource.hash = "f".repeat(64), "rejected", "delete_source_binding_mismatch"],
  ["uppercase hash", f => f.evidence.pack.sections.files.items[0].provenance.source.sha256 = "E".repeat(64), "rejected", "delete_source_binding_mismatch"],
  ["wrong source path", f => f.evidence.pack.sections.files.items[0].provenance.source.path = "other.js", "rejected", "delete_source_binding_mismatch"],
  ["wrong source reason", f => f.evidence.pack.sections.files.items[0].provenance.reason = "related_symbol_or_name", "rejected", "delete_source_binding_mismatch"],
  ["elevated trust", f => f.evidence.pack.sections.files.items[0].provenance.trust = "trusted_policy", "rejected", "delete_source_binding_mismatch"],
  ["section identity", f => f.evidence.pack.sections.files.provenance.projectId = "prj_other", "rejected", "delete_source_binding_mismatch"],
  ["section revision", f => f.evidence.pack.sections.files.provenance.revisionRef = "other", "rejected", "delete_source_binding_mismatch"],
  ["malformed metadata", f => delete f.evidence.pack.sections.files.truncated, "rejected", "delete_source_binding_mismatch"],
  ["malformed evaluation", f => f.evidence.impact.targets[0].status = "made_up", "rejected", "delete_source_binding_mismatch"],
  ["malformed completeness", f => f.evidence.impact.targets[0].completeness.source = ["made_up"], "rejected", "delete_source_binding_mismatch"],
  ["snapshot", f => f.evidence.impact.snapshotToken = "other", "rejected", "snapshot_token_mismatch"],
  ["provider", f => f.evidence.impact.provider.version = "other", "rejected", "provider_mismatch"],
  ["identity", f => f.evidence.impact.revision.worktreeId = "f".repeat(64), "rejected", "worktree_identity_mismatch"],
  ["stale", f => f.request.expectedRevision.commitSha = "f".repeat(40), "stale", "revision_observation_differs"],
  ["dirty", f => { f.request.expectedRevision.dirty = f.evidence.pack.revision.dirty = f.evidence.impact.revision.dirty = true; }, "not_evaluated", "working_tree_observation_only"]
]) test(`delete: ${name} fails closed`, () => { const f = fixture(); mutate(f); terminal(f, status, code); });

test("delete: retained truncated sources and untrusted labels remain incomplete, not upgraded", () => {
  const f = fixture(); f.evidence.pack.sections.files.truncated = true;
  f.evidence.pack.sections.files.items[0].provenance.trust = "untrusted_repository_text";
  const r = run(f); assert.equal(r.status, "incomplete");
  assert.equal(r.operationIntent.evidence.sources[0].context.trust, "untrusted_repository_text");
  assert.equal(r.operationIntent.evidence.context.sections.files.truncated, true);
  assert.equal(r.operationIntent.evidence.context.observation.incomplete, true);
  assert.equal(r.operationIntent.evidence.impact.affectedTests.findingState, "no_evidence_found");
  f.evidence.pack.sections.files.items.pop(); terminal(f, "not_evaluated", "delete_source_not_evaluated");
});

test("delete: ordinal permutations and exact duplicate declarations are byte deterministic", () => {
  const f = fixture(["src/é.js", "src/Z.js", "src/😀.js", "src/a.js"]);
  const expected = JSON.stringify(run(f));
  const g = structuredClone(f);
  g.request.task.paths.reverse(); g.request.operationIntent.targets.reverse();
  g.request.operationIntent.targets.push(structuredClone(g.request.operationIntent.targets[0]));
  g.evidence.pack.sections.files.items.reverse(); g.evidence.impact.targets.reverse();
  g.evidence.pack.sections = Object.fromEntries(Object.entries(g.evidence.pack.sections).reverse());
  assert.equal(JSON.stringify(run(g)), expected);
});

test("delete: pre-dedup and source counts refuse rather than trim", () => {
  const f = fixture(); f.request.operationIntent.targets = Array.from({ length: 32 }, () => ({ oldPath: "src/a.js", newPath: null }));
  f.request.operationIntent.targets[31].oldPath = "src/z.js";
  assert.equal(run(f).status, "incomplete");
  f.request.operationIntent.targets.push({ oldPath: "src/a.js", newPath: null });
  terminal(f, "rejected", "scope_budget_exceeded");
  const g = fixture(); g.evidence.pack.sections.files.items = Array.from({ length: 33 }, () => structuredClone(g.evidence.pack.sections.files.items[0]));
  terminal(g, "rejected", "scope_budget_exceeded");
});

test("delete: exact UTF-8 output budget, no trimmed proof", () => {
  const f = fixture(["src/😀.js"]); const r = run(f);
  const initial = Buffer.byteLength(JSON.stringify(r), "utf8");
  f.request.limits = { compactBytes: initial };
  let size = Buffer.byteLength(JSON.stringify(run(f)), "utf8");
  f.request.limits.compactBytes = size;
  assert.equal(Buffer.byteLength(JSON.stringify(run(f)), "utf8"), size);
  f.request.limits.compactBytes = size - 1; terminal(f, "rejected", "scope_budget_exceeded");
});

test("delete: descriptor ingress invokes zero getters, proxies or toJSON", () => {
  let calls = 0;
  const f = fixture(); Object.defineProperty(f.request.operationIntent.targets[0], "oldPath", { enumerable: true, get() { calls++; return "src/a.js"; } });
  terminal(f, "rejected", "invalid_record");
  const g = fixture(); g.request.operationIntent = new Proxy({}, { ownKeys() { calls++; return []; }, getPrototypeOf() { calls++; return null; }, get() { calls++; } });
  terminal(g, "rejected", "invalid_record");
  const h = fixture(); h.evidence.pack.sections.files.items[0].toJSON = () => { calls++; return {}; };
  terminal(h, "rejected", "invalid_record"); assert.equal(calls, 0);
});

test("delete: immutable and pure, adapter byte parity; omission keeps Slice 1", () => {
  const f = fixture(); const expected = JSON.stringify(run(f));
  const freeze = v => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } };
  freeze(f);
  const saved = [fs.readFileSync, fs.writeFileSync, fs.unlinkSync, childProcess.execSync, globalThis.fetch, Date.now];
  const noIO = () => { throw new Error("unexpected IO"); };
  try {
    fs.readFileSync = fs.writeFileSync = fs.unlinkSync = childProcess.execSync = globalThis.fetch = Date.now = noIO;
    assert.equal(JSON.stringify(run(f)), expected);
    assert.equal(JSON.stringify(composeEffectiveTaskScopeFromEnvelopes(f.request, {
      pack: { ok: true, data: f.evidence.pack }, impact: { ok: true, data: f.evidence.impact } })), expected);
  } finally {
    [fs.readFileSync, fs.writeFileSync, fs.unlinkSync, childProcess.execSync, globalThis.fetch, Date.now] = saved;
  }
  const g = fixture(); delete g.request.operationIntent; const r = run(g);
  assert.equal(Object.hasOwn(r, "operationIntent"), false);
  assert.deepEqual(r.impact.items.map(i => i.target.path), ["src/far.js"]);
  assert.deepEqual(r.write.items[0].ruleIds, ["explicit_task_path"]);
});

test("delete: bounded projection excludes text, excerpts, candidates and extra identities", () => {
  const f = fixture();
  f.evidence.pack.sections.files.items[0].excerpt = { text: "PRIVATE_TEXT", startLine: 1, endLine: 1 };
  f.evidence.pack.sections.files.items[0].extraId = "PRIVATE_ID";
  const op = run(f).operationIntent;
  assert.doesNotMatch(JSON.stringify(op), /PRIVATE_|contextPackId|snapshotToken|candidates|excerpt|byteSize/);
  assert.deepEqual(Object.keys(op.evidence), ["sources", "context", "impact", "providers", "coverage"]);
});

test("delete: affected tests union, distance and truncation do not weaken deletion awareness", () => {
  const f = fixture(); const impact = f.evidence.impact;
  const candidate = structuredClone(impact.affectedFiles[0]); candidate.path = "tests/far.test.js";
  candidate.origins[0].witness.id = "test-edge"; candidate.origins[0].witness.source.path = candidate.path;
  candidate.provenance = { trust: "derived_analysis", basis: "heuristic", reason: "test_path_convention" };
  impact.affectedTests.candidates = [candidate];
  impact.affectedFiles[0].originSummary.attributionTruncated = true;
  impact.affectedFiles[0].originSummary.reasons = ["origin_limit"];
  const r = run(f);
  assert.equal(r.status, "incomplete");
  assert.deepEqual(r.watch.items.map(i => i.target.path), ["src/far.js", "tests/far.test.js"]);
  assert.ok(r.watch.items.every(i => i.ruleIds.includes("delete_intent_awareness")));
  assert.ok(r.watch.items[1].roles.includes("affected_test_candidate"));
  assert.deepEqual(r.impact.items, []);
  assert.deepEqual(r.operationIntent.evidence.impact.affectedTests.completeness, impact.affectedTests.completeness);
  assert.equal(r.evidence.witnesses.length, 2);
  const g = structuredClone(f); g.evidence.impact.affectedFiles.reverse(); g.evidence.impact.affectedTests.candidates.reverse();
  assert.equal(JSON.stringify(run(g)), JSON.stringify(r));
  f.request.includeTests = false; impact.affectedTests = { status: "not_requested", candidates: [] };
  const omitted = run(f);
  assert.equal(omitted.status, "incomplete");
  assert.deepEqual(omitted.operationIntent.evidence.impact.affectedTests, { status: "not_requested" });
});

test("delete: supplied producer counts cannot bypass raw bounds or reported limits", () => {
  for (const mutate of [
    f => { f.evidence.impact.affectedFiles = Array.from({ length: 251 }, () => structuredClone(f.evidence.impact.affectedFiles[0])); },
    f => { f.evidence.impact.limits = { affectedFiles: 1 }; f.evidence.impact.affectedFiles.push(structuredClone(f.evidence.impact.affectedFiles[0])); },
    f => { f.evidence.pack.limits = { files: 1 }; },
    f => { f.evidence.impact.targets = Array.from({ length: 33 }, (_, n) => structuredClone(f.evidence.impact.targets[n % 2])); }
  ]) { const f = fixture(); mutate(f); terminal(f, "rejected", "scope_budget_exceeded"); }
});

test("delete: exact UTF-8 inner and aggregate input budgets include pre-dedup declarations", () => {
  const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
  for (const key of ["pack", "impact"]) {
    const f = fixture(); f.evidence[key].padding = "";
    f.evidence[key].padding = "🔒".repeat(Math.floor((131072 - bytes(f.evidence[key])) / 4));
    f.evidence[key].padding += "x".repeat(131072 - bytes(f.evidence[key]));
    assert.equal(bytes(f.evidence[key]), 131072);
    assert.equal(run(f).status, "incomplete");
    f.evidence[key].padding += "x"; terminal(f, "rejected", "scope_budget_exceeded");
  }
  const path = "src/" + "a".repeat(1017) + ".js";
  const f = fixture([path]);
  f.request.task.paths = Array(32).fill(path);
  f.evidence.pack.sections.task.items[0].paths = [path];
  f.request.operationIntent.targets = Array.from({ length: 32 }, () => ({ oldPath: path, newPath: null }));
  for (const key of ["pack", "impact"]) {
    f.evidence[key].padding = "";
    f.evidence[key].padding = "x".repeat(131072 - bytes(f.evidence[key]));
  }
  const raw = { request: f.request, pack: f.evidence.pack, impact: f.evidence.impact };
  assert.ok(bytes(raw) > 327680);
  f.evidence.impact.padding = f.evidence.impact.padding.slice(0, -(bytes(raw) - 327680));
  assert.equal(bytes(raw), 327680); assert.equal(run(f).status, "incomplete");
  f.evidence.impact.padding += "x"; terminal(f, "rejected", "scope_budget_exceeded");
});

test("delete: existing terminal gates precede stricter source checks", () => {
  for (const [mutate, status, code] of [
    [f => { f.request.expectedRevision.commitSha = "f".repeat(40); }, "stale", "revision_observation_differs"],
    [f => { f.evidence.impact.provider.id = "other"; }, "rejected", "provider_mismatch"],
    [f => { f.evidence.impact.findingState = "not_evaluated"; }, "not_evaluated", "impact_not_evaluated"],
    [f => { f.request.task.symbols = ["symbol"]; f.evidence.pack.sections.task.items[0].symbols = ["symbol"]; }, "not_evaluated", "symbol_target_evidence_missing"]
  ]) {
    const f = fixture(); delete f.evidence.pack.sections.files; mutate(f); terminal(f, status, code);
  }
});

test("delete: ambiguous sources reject even when another source is missing; all dimensions retained", () => {
  const f = fixture(); f.evidence.pack.sections.files.items.pop();
  f.evidence.pack.sections.files.items[0].provenance.source.sha256 = "wrong";
  terminal(f, "rejected", "delete_source_binding_mismatch");
  const g = fixture(); const extra = structuredClone(g.evidence.pack.sections.files.items[0]);
  extra.provenance.source.sha256 = "f".repeat(64); g.evidence.pack.sections.files.items.push(extra);
  terminal(g, "rejected", "delete_source_binding_mismatch");
  const h = fixture(); delete h.evidence.impact.targets[0].completeness;
  terminal(h, "rejected", "delete_source_binding_mismatch");
});

test("delete: raw origin budget includes candidates before union/deduplication", () => {
  const f = fixture();
  f.evidence.impact.affectedTests.candidates = [structuredClone(f.evidence.impact.affectedFiles[0])];
  f.evidence.impact.limits = { originWitnessRecords: 2 };
  assert.equal(run(f).status, "incomplete");
  f.evidence.impact.limits.originWitnessRecords = 1;
  terminal(f, "rejected", "scope_budget_exceeded");
});

test("delete: all seven declarations leave retained non-WRITE effects at WATCH", () => {
  for (const category of ["documentation", "test_only", "local_implementation", "public_signature", "interface_contract", "schema_migration", "unknown"]) {
    const f = fixture(); f.request.changeSemantics.category = category;
    const r = run(f);
    assert.equal(r.status, "incomplete");
    assert.deepEqual(r.watch.items.map(item => item.target.path), ["src/far.js"]);
    assert.ok(r.watch.items[0].ruleIds.includes("delete_intent_awareness"));
    assert.deepEqual(r.impact.items, []);
  }
});

test("delete: 32 unique positive old sources join the entire WRITE set", () => {
  const f = fixture(Array.from({ length: 32 }, (_, n) => `src/file-${n}.js`));
  const r = run(f);
  assert.equal(r.status, "incomplete");
  assert.equal(r.operationIntent.evidence.sources.length, 32);
  assert.deepEqual(r.operationIntent.targets.map(target => target.oldPath), r.write.items.map(item => item.target.path));
  assert.deepEqual(r.operationIntent.evidence.sources.map(source => source.oldPath), r.write.items.map(item => item.target.path));
});

// ---- D3 (absence witness lift) regression legs for delete ----
// Synthetic labelled object; never evaluated on a non-create request.
const syntheticAbsenceWitness = () => ({ kind: "labelled-synthetic-absence-witness", targets: [] });
test("D3 C-5 (delete leg; replaces D2 N1's delete leg): delete + absence-witness key -> rejected create_absence_witness_unexpected, no containers; adapter parity", () => {
  const f = fixture(); f.evidence.createDestinationAbsenceWitness = syntheticAbsenceWitness();
  const r = terminal(f, "rejected", "create_absence_witness_unexpected");
  assert.deepEqual(r.reasons.map(reason => reason.code), ["create_absence_witness_unexpected"]);
  assert.equal(r.policyVersion, EFFECTIVE_TASK_SCOPE_POLICY_VERSION);
  const viaAdapter = composeEffectiveTaskScopeFromEnvelopes(f.request, { pack: { ok: true, data: f.evidence.pack }, impact: { ok: true, data: f.evidence.impact },
    createDestinationAbsenceWitness: { ok: true, data: f.evidence.createDestinationAbsenceWitness } });
  assert.equal(JSON.stringify(viaAdapter), JSON.stringify(r));
  // An explicitly undefined key still counts as present (U-6(i) fail-closed).
  const g = fixture(); g.evidence.createDestinationAbsenceWitness = undefined;
  assert.equal(run(g).status, "rejected");
});
test("D3 C-17: delete + absence-witness key whose stale gate also fires -> stale (step 3 before step 5)", () => {
  const f = fixture(); f.evidence.createDestinationAbsenceWitness = syntheticAbsenceWitness();
  f.request.expectedRevision.commitSha = "f".repeat(40);
  terminal(f, "stale", "revision_observation_differs");
});
// C-14 (delete legs) golden: no witness key; global findingState no_evidence_found / evidence_found / not_evaluated.
// Top-level policyVersion (asserted equal to the policy constant first) replaced by "<policyVersion>", then
// sha256(JSON.stringify(result)). Captured from the 4b8e213 src on Node v26.8.2 with this test file:
//   HN_D3_PRINT_GOLDEN=1 node --test --test-name-pattern="D3 C-14" tests/effective-task-scope-delete.test.js
const C14_DELETE_GOLDEN = [
  ["delete findingState no_evidence_found", "64beda50b94d92534638ea8d7f0c63b64b77f6cf43e3f900fdcfa183ac75e5f2"],
  ["delete findingState evidence_found", "64beda50b94d92534638ea8d7f0c63b64b77f6cf43e3f900fdcfa183ac75e5f2"],
  ["delete findingState not_evaluated", "ee3f9fb0ac467fdd9ed874f4a9680ebada1e7eb399de9f1effaf7a5f176f7622"]
];
test("D3 C-14 (delete legs): no witness -> outcomes byte-identical to base except the policyVersion label", () => {
  const actual = ["no_evidence_found", "evidence_found", "not_evaluated"].map(findingState => {
    const f = fixture(); f.evidence.impact.findingState = findingState;
    const r = run(f);
    assert.equal(r.policyVersion, EFFECTIVE_TASK_SCOPE_POLICY_VERSION, findingState);
    if (findingState === "not_evaluated") assert.deepEqual(r.reasons.map(reason => reason.code), ["impact_not_evaluated"]);
    else assert.equal(r.reasons.some(reason => reason.code === "impact_not_evaluated"), false, findingState);
    r.policyVersion = "<policyVersion>";
    return [`delete findingState ${findingState}`, createHash("sha256").update(JSON.stringify(r), "utf8").digest("hex")];
  });
  if (process.env.HN_D3_PRINT_GOLDEN === "1") console.log(`C14_DELETE_GOLDEN ${JSON.stringify(actual)}`);
  assert.deepEqual(actual, C14_DELETE_GOLDEN);
});
