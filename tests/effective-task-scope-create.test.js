import test from "node:test";
import assert from "node:assert/strict";
import { composeEffectiveTaskScope as compose } from "../src/lib/effective-task-scope.js";
import {
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  bindCreateIntent,
  normalizeEffectiveTaskScopeRequest
} from "../src/lib/effective-task-scope-policy.js";

// Synthetic consistency fixtures only; not authenticated/live observations.
// step4-foundation-4: create is recognized and refused fail-closed. A positively
// observed destination is EXISTS (create_destination_exists); anything else is
// UNKNOWN (create_destination_absence_not_proven). PROVEN-ABSENT needs a positive
// absence witness that no current pure input supplies, so create never emits
// WRITE, WATCH or operationIntent.
function fixture(paths = ["src/a.js", "src/z.js"]) {
  const revision = { status: "available", commitSha: "a".repeat(40), branch: "fixture",
    dirty: false, isLinkedWorktree: true, repositoryId: "b".repeat(64), worktreeId: "c".repeat(64) };
  const provider = { id: "native.typescript", version: "1" };
  const coverage = { observed: ["javascript", "python"], covered: ["javascript"], uncovered: ["python"] };
  const completeness = { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"], traversal: ["depth_limit"], output: ["origin_limit"] };
  const task = { id: "create-fixture", title: "Create fixture", paths, symbols: [] };
  const project = { rootId: "fixture", relativePath: "fixture" };
  const provenance = { projectId: "prj_fixture", revisionRef: "revision", trust: "untrusted_repository_text", producer: "context-source-observation" };
  const section = (items, limit, status = "available") => ({ items, limit, status, truncated: false, provenance });
  const request = { task, projectId: "prj_fixture", worktree: project, expectedRevision: revision,
    includeTests: true, changeSemantics: { category: "local_implementation" },
    operationIntent: { kind: "create", targets: paths.map(newPath => ({ oldPath: null, newPath })) } };
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
  return JSON.parse(JSON.stringify({ request, evidence: { pack, impact } }));
}
const run = f => compose(f.request, f.evidence);
const CONTAINERS = ["write", "reserved", "watch", "impact", "operationIntent"];
function terminal(f, status, code) {
  const r = run(f);
  assert.equal(r.status, status, JSON.stringify(r));
  assert.ok(r.reasons.some(reason => reason.code === code), JSON.stringify(r));
  for (const key of CONTAINERS) assert.equal(Object.hasOwn(r, key), false, key);
  return r;
}

/** Remove every positive observation (Context item and Impact targetSource) of `path`. */
function unobserve(f, path) {
  f.evidence.pack.sections.files.items = f.evidence.pack.sections.files.items.filter(item => item.path !== path);
  for (const target of f.evidence.impact.targets) if (target.originPath === path) target.targetSource = null;
}

/** Clean-flags variant: nothing in Pack/Impact signals incompleteness. */
function cleanFlags(f) {
  const clean = { source: [], provider: [], traversal: [], output: [] };
  const { pack, impact } = f.evidence;
  pack.observation.incomplete = false;
  pack.analysis.status = "available";
  pack.analysis.coverage = { observed: ["javascript"], covered: ["javascript"], uncovered: [] };
  impact.observation.incomplete = false;
  impact.coverage = { observed: ["javascript"], covered: ["javascript"], uncovered: [] };
  impact.status = "available";
  impact.completeness = clean;
  impact.affectedTests = { status: "available", findingState: "no_evidence_found", candidates: [], completeness: clean };
  for (const target of impact.targets) { target.status = "available"; target.completeness = clean; }
  return f;
}

// Every reachable create fixture below; A2 sweeps them for WRITE / operationIntent.
const REACHABLE = [];
function pin(name, build, status, code) {
  REACHABLE.push([name, build]);
  test(`create: ${name} -> ${status} / ${code}`, () => terminal(build(), status, code));
}

// EXISTS: any positive byte observation of the destination refuses the create.
pin("E1 both paths observed with equal hashes (former happy path)", () => fixture(),
  "not_evaluated", "create_destination_exists");
pin("E2 Context-only observation", () => {
  const f = fixture(); for (const t of f.evidence.impact.targets) t.targetSource = null; return f;
}, "not_evaluated", "create_destination_exists");
pin("E3 Impact-only observation", () => {
  const f = fixture(); f.evidence.pack.sections.files.items = []; return f;
}, "not_evaluated", "create_destination_exists");
pin("E4 observed path whose Impact target is not_evaluated", () => {
  const f = fixture(); f.evidence.impact.targets[1].findingState = "not_evaluated"; return f;
}, "not_evaluated", "create_destination_exists");
pin("E5 Context/Impact hash conflict", () => {
  const f = fixture(); f.evidence.impact.targets[0].targetSource.hash = "f".repeat(64); return f;
}, "rejected", "create_source_binding_mismatch");
pin("E6a Context item with wrong trust", () => {
  const f = fixture(); f.evidence.pack.sections.files.items[0].provenance.trust = "derived_analysis"; return f;
}, "rejected", "create_source_binding_mismatch");
pin("E6b Context item with reason other than task_path", () => {
  const f = fixture(); f.evidence.pack.sections.files.items[0].provenance.reason = "symbol_match"; return f;
}, "rejected", "create_source_binding_mismatch");

// UNKNOWN (default): no positive observation never launders into absence proof.
pin("A1 no-laundering: single new path, clean flags", () => {
  const f = cleanFlags(fixture(["src/new.js"])); unobserve(f, "src/new.js"); return f;
}, "not_evaluated", "create_destination_absence_not_proven");
pin("U1 single new path, default incomplete flags", () => {
  const f = fixture(["src/new.js"]); unobserve(f, "src/new.js"); return f;
}, "not_evaluated", "create_destination_absence_not_proven");
for (const status of ["not_analyzed", "omitted", "empty"]) {
  pin(`U2 files section ${status}, no Impact source`, () => {
    const f = fixture(); f.evidence.pack.sections.files.status = status;
    unobserve(f, "src/a.js"); unobserve(f, "src/z.js"); return f;
  }, "not_evaluated", "create_destination_absence_not_proven");
}
pin("U3 mixed [existing, new] -> EXISTS precedence", () => {
  const f = fixture(["src/a.js", "src/new.js"]); unobserve(f, "src/new.js"); return f;
}, "not_evaluated", "create_destination_exists");
pin("U4 [new, new]", () => {
  const f = fixture(["src/new.js", "src/other.js"]); unobserve(f, "src/new.js"); unobserve(f, "src/other.js"); return f;
}, "not_evaluated", "create_destination_absence_not_proven");
pin("U4b [new, new] with clean flags", () => {
  const f = cleanFlags(fixture(["src/new.js", "src/other.js"])); unobserve(f, "src/new.js"); unobserve(f, "src/other.js"); return f;
}, "not_evaluated", "create_destination_absence_not_proven");

// Structural / request / binding refusals are unchanged.
for (const intent of [
  { kind: "create", targets: [] },
  { kind: "create", targets: [{ oldPath: null }] },
  { kind: "create", targets: [{ newPath: "src/a.js" }] },
  { kind: "create", targets: [{ oldPath: "src/a.js", newPath: "src/a.js" }] },
  { kind: "create", targets: [{ oldPath: null, newPath: null }] },
  { kind: "create", targets: [{ oldPath: null, newPath: "src/a.js", exists: true }] },
  { kind: "create", targets: [{ oldPath: null, newPath: "src/a.js" }], source: true }
]) {
  pin(`M1 malformed declaration ${JSON.stringify(intent)}`, () => {
    const f = fixture(); f.request.operationIntent = intent; return f;
  }, "rejected", "invalid_create_intent");
}
for (const path of ["../a", "/a", " src/a.js", "src//a.js", "src/./a.js", "src/a.js/", "src/*.js", "C:/a", "src\\a.js", "src/a.js\n"]) {
  pin(`M1 literal spelling ${JSON.stringify(path)}`, () => {
    const f = fixture(); f.request.operationIntent.targets[0].newPath = path; return f;
  }, "rejected", "invalid_create_intent");
}
for (const paths of [["src/a.js"], ["src/a.js", "src/unlisted.js"]]) {
  pin(`M2 declaration set ${JSON.stringify(paths)} differs from task.paths`, () => {
    const f = fixture(); f.request.operationIntent.targets = paths.map(newPath => ({ oldPath: null, newPath })); return f;
  }, "rejected", "create_intent_target_mismatch");
}
// A missing Impact target is caught first by the existing composer origin gate (precedence:
// existing composer gates before bind); the bind itself still refuses it as a target mismatch.
pin("M2 Impact target missing for a declared newPath (composer origin gate)", () => {
  const f = fixture(); f.evidence.impact.targets.pop(); return f;
}, "rejected", "origin_set_mismatch");
test("create: M2 bindCreateIntent refuses a missing Impact target as create_intent_target_mismatch", () => {
  const f = fixture(); f.evidence.impact.targets.pop();
  const intent = normalizeEffectiveTaskScopeRequest(f.request, { allowCreateIntent: true }).operationIntent;
  assert.throws(() => bindCreateIntent(intent, ["src/a.js", "src/z.js"], f.evidence.pack, f.evidence.impact),
    { code: "create_intent_target_mismatch" });
});
pin("M3 33 create targets", () => {
  const f = fixture(); f.request.operationIntent.targets = Array.from({ length: 33 }, () => ({ oldPath: null, newPath: "src/a.js" })); return f;
}, "rejected", "scope_budget_exceeded");
pin("M4 rename kind remains out of scope (delete-path refuse)", () => {
  const f = fixture(); f.request.operationIntent = { kind: "rename", targets: [{ oldPath: "src/a.js", newPath: "src/b.js" }] }; return f;
}, "rejected", "invalid_delete_intent");
pin("S1 stale expectedRevision", () => {
  const f = fixture(); f.request.expectedRevision.commitSha = "f".repeat(40); return f;
}, "stale", "revision_observation_differs");

test("create: A2 no reachable create fixture emits WRITE, WATCH or operationIntent", () => {
  assert.ok(REACHABLE.length >= 30);
  for (const [name, build] of REACHABLE) {
    const r = run(build());
    assert.notEqual(r.status, "incomplete", name);
    assert.notEqual(r.status, "available", name);
    for (const key of CONTAINERS) assert.equal(Object.hasOwn(r, key), false, `${name}: ${key}`);
    const text = JSON.stringify(r);
    for (const removed of ["explicit_create_intent", "create_intent_awareness", "create_source_not_evaluated", "create_target_not_evaluated"]) {
      assert.equal(text.includes(removed), false, `${name}: ${removed}`);
    }
  }
});

test("create: V1 policyVersion step4-foundation-4 on create outcomes", () => {
  assert.equal(EFFECTIVE_TASK_SCOPE_POLICY_VERSION, "step4-foundation-4");
  assert.equal(run(fixture()).policyVersion, "step4-foundation-4");
  const f = fixture(["src/new.js"]); unobserve(f, "src/new.js");
  assert.equal(run(f).policyVersion, "step4-foundation-4");
});

test("create: P1 purity, no fixture mutation and no filesystem side effects", () => {
  for (const [, build] of REACHABLE) {
    const f = build(); const before = JSON.stringify(f);
    run(f);
    assert.equal(JSON.stringify(f), before);
  }
});

test("create: R4 shared normalizer denies create unless allowCreateIntent === true", () => {
  const f = fixture();
  const createReq = f.request;
  for (const options of [undefined, {}, { allowCreateIntent: "true" }, { allowCreateIntent: 1 }, { allowCreateIntent: false }, null]) {
    assert.throws(() => normalizeEffectiveTaskScopeRequest(createReq, options), { code: "invalid_delete_intent" }, JSON.stringify(options));
  }
  assert.throws(() => normalizeEffectiveTaskScopeRequest(createReq), { code: "invalid_delete_intent" });
  const normalized = normalizeEffectiveTaskScopeRequest(createReq, { allowCreateIntent: true });
  assert.deepEqual(normalized.operationIntent, {
    kind: "create",
    targets: [{ oldPath: null, newPath: "src/a.js" }, { oldPath: null, newPath: "src/z.js" }]
  });
  // Opt-in still validates create strictly; malformed create under opt-in stays invalid_create_intent.
  assert.throws(() => normalizeEffectiveTaskScopeRequest({ ...createReq, operationIntent: { kind: "create", targets: [] } },
    { allowCreateIntent: true }), { code: "invalid_create_intent" });
  // Delete is unaffected by the option.
  const del = { ...createReq, operationIntent: { kind: "delete", targets: [{ oldPath: "src/a.js", newPath: null }] } };
  assert.equal(normalizeEffectiveTaskScopeRequest(del).operationIntent.kind, "delete");
  assert.equal(normalizeEffectiveTaskScopeRequest(del, { allowCreateIntent: true }).operationIntent.kind, "delete");
});
