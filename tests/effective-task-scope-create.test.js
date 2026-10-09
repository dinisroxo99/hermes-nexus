import test from "node:test";
import assert from "node:assert/strict";
import { composeEffectiveTaskScope as compose } from "../src/lib/effective-task-scope.js";
import {
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  bindCreateIntent,
  normalizeEffectiveTaskScopeRequest
} from "../src/lib/effective-task-scope-policy.js";
import * as policy from "../src/lib/effective-task-scope-policy.js";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CREATE_ABSENCE_WITNESS_KIND, CREATE_ABSENCE_WITNESS_PRODUCER_IDENTITY, CREATE_ABSENCE_WITNESS_VERSION, CREATE_ABSENCE_WITNESS_METHOD,
  CREATE_ABSENCE_WITNESS_SECRET_NAME_POLICY, CREATE_ABSENCE_WITNESS_SYMLINK_POLICY, CREATE_ABSENCE_WITNESS_FS_POLICY_ID,
  CREATE_ABSENCE_WITNESS_LIMITS, CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX, CREATE_ABSENCE_WITNESS_HARD_FLAGS,
  CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION, canonicalJson, canonicalByteLength
} from "../src/lib/create-destination-absence-witness-constants.js";
import { KERNEL_MODEL_KEY_DESCRIPTOR } from "../src/lib/create-name-key.js";
// D3-S2a only: the producer is imported by this test, never by the composer or policy.
import { s2aSecretRuleRequiresUnknown } from "../src/lib/create-destination-absence-witness.js";

// Synthetic consistency fixtures only; not authenticated/live observations.
// step4-foundation-6: without a createDestinationAbsenceWitness, create is refused fail-closed exactly
// as under the previous policy version: a positively observed destination is EXISTS
// (create_destination_exists); anything else is UNKNOWN (create_destination_absence_not_proven), so
// none of the REACHABLE fixtures below emits WRITE, WATCH or operationIntent. The witness-carrying
// D3 tests (B-*, C-*) are appended after the existing tests and never registered in REACHABLE.
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

test("create: V1 policyVersion step4-foundation-6 on create outcomes", () => {
  assert.equal(EFFECTIVE_TASK_SCOPE_POLICY_VERSION, "step4-foundation-6");
  assert.equal(run(fixture()).policyVersion, "step4-foundation-6");
  const f = fixture(["src/new.js"]); unobserve(f, "src/new.js");
  assert.equal(run(f).policyVersion, "step4-foundation-6");
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

// =============================================================================================
// D3: create-destination absence witness consume (absence-witness evidence contract r3.4 §1.4,
// §2.5 R1–R9, §5.2 B-*, §5.3 C-*; Architect D3 pins). Labelled synthetic witnesses only: built
// here, never produced from a filesystem, not authenticated. Binder/evaluator calls go through the
// policy namespace import so a missing export fails only the test that needs it. Lift fixtures
// are never registered through pin()/REACHABLE (RN-8). Version checks use the imported constant.
// =============================================================================================
const UNICODE_17 = process.versions.unicode === "17.0";
const U17 = UNICODE_17 ? {} : { skip: 'requires a runtime reporting Unicode 17.0 (process.versions.unicode === "17.0")' };
const sha256 = text => createHash("sha256").update(text, "utf8").digest("hex");
const FS_TYPE = "0x1021994";
const LIFT = "create_destination_proven_absent";
const NOT_PROVEN = "create_destination_absence_not_proven";
const INVALID = "create_absence_evidence_invalid";
const BINDING = "create_absence_binding_mismatch";
const INCONSISTENT = "create_absence_evidence_inconsistent";
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function listing(entries, redacted = 0) {
  const body = { entryCount: entries.length + redacted, entries: [...entries], redactedSecretEntryCount: redacted };
  return { ...body, listingDigest: sha256(canonicalJson(body)) };
}
function chainFor(newPath) {
  const segments = newPath.split("/");
  const paths = [""];
  for (let i = 1; i < segments.length; i++) paths.push(segments.slice(0, i).join("/"));
  return paths.map((path, i) => ({ path, state: "directory", fsType: FS_TYPE, devIno: `2049:${1000 + i}` }));
}
function describe(newPath) {
  const segments = newPath.split("/");
  return { newPath, parentPath: segments.slice(0, -1).join("/"), basename: segments[segments.length - 1] };
}
function absentRecord(newPath, { entries = ["README.md"], redacted = 0, ...overrides } = {}) {
  return { ...describe(newPath), ancestors: chainFor(newPath), nativeLookup: "ENOENT", enumeration: listing(entries, redacted),
    complete: true, incompleteReason: null, verdict: "absent", ...overrides };
}
function emptyChainRecord(newPath, incompleteReason) {
  return { ...describe(newPath), ancestors: [], nativeLookup: null, enumeration: null, complete: false, incompleteReason, verdict: "unknown" };
}
function scopeOutRecord(newPath, state) {
  const ancestors = chainFor(newPath);
  ancestors[ancestors.length - 1] = { path: ancestors[ancestors.length - 1].path, state, fsType: null, devIno: null };
  return { ...describe(newPath), ancestors, nativeLookup: null, enumeration: null, complete: false,
    incompleteReason: state === "unreadable" ? "unreadable" : "ancestor_scope_out",
    verdict: state === "absent" ? "parent_absent" : state === "unreadable" ? "unknown" : "ancestor_boundary" };
}
function absenceWitness(f, records, overrides = {}) {
  const er = f.request.expectedRevision;
  return {
    kind: CREATE_ABSENCE_WITNESS_KIND, producerIdentity: CREATE_ABSENCE_WITNESS_PRODUCER_IDENTITY, version: CREATE_ABSENCE_WITNESS_VERSION,
    method: CREATE_ABSENCE_WITNESS_METHOD, secretNamePolicy: CREATE_ABSENCE_WITNESS_SECRET_NAME_POLICY,
    projectId: f.request.projectId, repositoryId: er.repositoryId, worktreeId: er.worktreeId,
    project: { rootId: f.request.worktree.rootId, relativePath: f.request.worktree.relativePath },
    revision: { status: er.status, commitSha: er.commitSha, branch: er.branch, dirty: er.dirty, isLinkedWorktree: er.isLinkedWorktree },
    snapshotToken: f.evidence.pack.analysis.snapshotToken, generatedAt: null, requiresReobservation: true,
    observation: { basis: "working_tree", bracket: "before_after_rewalk", revisionStable: true, tokenStable: true },
    nameComparison: { keyId: "hn-create-name-key-v3", unicodeVersion: "17.0", caseFolding: "full_CF", turkicPostFold: true,
      stripDefaultIgnorable: true, trimTrailingDotSpace: true, collisionRule: "K_or_Kk", kernelModelKey: { ...KERNEL_MODEL_KEY_DESCRIPTOR } },
    filesystem: { policyId: CREATE_ABSENCE_WITNESS_FS_POLICY_ID, rootFsType: FS_TYPE },
    symlinkPolicy: CREATE_ABSENCE_WITNESS_SYMLINK_POLICY, filtersApplied: [], limits: { ...CREATE_ABSENCE_WITNESS_LIMITS },
    targets: [...records].sort((a, b) => byCodeUnit(a.newPath, b.newPath)),
    failClosedMatrix: { ...CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX }, hardFlags: { ...CREATE_ABSENCE_WITNESS_HARD_FLAGS },
    nonAuthorization: [...CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION], provenance: null, ...overrides
  };
}
/** Create fixture whose declared paths have no positive observation (sorted by code unit). */
function newFixture(paths) {
  const sorted = [...paths].sort(byCodeUnit);
  const f = fixture(sorted);
  for (const path of sorted) unobserve(f, path);
  return f;
}
function withWitness(f, witness) { f.evidence.createDestinationAbsenceWitness = witness; return f; }
const allAbsent = (f, options) => absenceWitness(f, f.request.task.paths.map(path => absentRecord(path, options)));
function assertD3Exports() {
  for (const name of ["normalizeCreateDestinationAbsenceWitness", "evaluateCreateDestinationAbsenceWitness", "isCreateGateRelaxed"]) {
    assert.equal(typeof policy[name], "function", `${name} is exported by the policy module`);
  }
}
function exteriorOf(f) {
  const req = policy.normalizeEffectiveTaskScopeRequest(f.request, { allowCreateIntent: true });
  const er = req.expectedRevision;
  return { req, exterior: { taskPaths: req.task.paths, projectId: req.projectId, repositoryId: er.repositoryId, worktreeId: er.worktreeId,
    worktree: req.worktree, revision: er, snapshotToken: f.evidence.pack.analysis.snapshotToken } };
}
/** normalize → evaluate (optional seam) → bindCreateIntent, on materialized data (as the composer sees it). */
function pipeline(f, ...seam) {
  assertD3Exports();
  const { req, exterior } = exteriorOf(f);
  const data = policy.materializeBoundedJsonData(f.evidence);
  const normalized = policy.normalizeCreateDestinationAbsenceWitness(data.createDestinationAbsenceWitness);
  if (!normalized.ok) return { code: normalized.code, candidate: null };
  const candidate = policy.evaluateCreateDestinationAbsenceWitness(normalized.witness, exterior, ...seam);
  if (!candidate.ok) return { code: candidate.code, candidate: null };
  const bound = policy.bindCreateIntent(req.operationIntent, req.task.paths, data.pack, data.impact, candidate);
  return { code: bound.notEvaluated === null ? bound.lift?.reason : bound.notEvaluated, candidate, bound };
}
const verdictsOf = candidate => Object.fromEntries(candidate.targets.map(t => [t.newPath, t.verdict]));
/** Asserts the composer outcome and the binder/evaluator pipeline outcome; optionally the per-target candidate. */
function expectOutcome(f, code, candidates) {
  const viaPipeline = pipeline(f);
  assert.equal(viaPipeline.code, code, `pipeline: ${JSON.stringify(viaPipeline.code)}`);
  if (candidates) {
    assert.ok(viaPipeline.candidate, "evaluator candidate present");
    assert.deepEqual(verdictsOf(viaPipeline.candidate), candidates);
  }
  const r = run(f);
  if (code === LIFT) {
    assert.equal(r.status, "incomplete", JSON.stringify(r.reasons));
    assert.deepEqual(r.write.items.map(item => item.target.path), f.request.task.paths);
    for (const item of r.write.items) assert.deepEqual(item.ruleIds, ["explicit_create_intent", "explicit_task_path"]);
    assert.deepEqual(r.operationIntent, { kind: "create", targets: f.request.task.paths.map(newPath => ({ oldPath: null, newPath })) });
    assert.ok(r.completeness.resolver.includes(LIFT));
  } else {
    terminal(f, "not_evaluated", code);
  }
  return { r, viaPipeline };
}
function mutate(f, edit) { const w = f.evidence.createDestinationAbsenceWitness; edit(w); return f; }
function relist(record, entries, redacted = record.enumeration.redactedSecretEntryCount) { record.enumeration = listing(entries, redacted); }
const TWO = ["src/new.js", "src/other.js"];

// ---- B-*: binder / evaluator ----
test("D3 B-1: two absent targets, ¬C ∧ ¬I -> lift create_destination_proven_absent", U17, () => {
  const f = newFixture(TWO); withWitness(f, allAbsent(f));
  expectOutcome(f, LIFT, { "src/new.js": "absent", "src/other.js": "absent" });
});
test("D3 B-2: as B-1 but C(p) true for one (witness consistent) -> create_destination_exists", U17, () => {
  const f = fixture(["src/a.js", "src/new.js"]); unobserve(f, "src/new.js");
  withWitness(f, absenceWitness(f, [absentRecord("src/a.js", { entries: ["README.md", "a.js"], nativeLookup: "present", verdict: "exists" }),
    absentRecord("src/new.js", { entries: ["README.md", "a.js"] })]));
  expectOutcome(f, "create_destination_exists", { "src/a.js": "exists", "src/new.js": "absent" });
});
test("D3 B-3: byte-equal entry (native lookup present) -> create_destination_exists", U17, () => {
  const f = newFixture(TWO);
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js", { entries: ["README.md", "new.js"], nativeLookup: "present", verdict: "exists" }), absentRecord("src/other.js")]));
  expectOutcome(f, "create_destination_exists", { "src/new.js": "exists", "src/other.js": "absent" });
});
for (const [id, target, entry] of [
  ["B-4 case-only variant", "src/new.js", "New.js"],
  ["B-5 NFC target vs NFD entry", "src/caf\u00e9.js", "cafe\u0301.js"],
  ["B-5b NFC É vs NFD é", "src/\u00c9new.js", "e\u0301new.js"],
  ["B-5c dotless ı entry", "src/inew.js", "\u0131new.js"],
  ["B-5d ZWSP entry", "src/new.js", "new\u200b.js"],
  ["B-5e trailing dot", "src/new.js", "new.js."],
  ["B-5e trailing space", "src/new.js", "new.js "],
  ["B-5f İ vs i+U+0307", "src/\u0130new.js", "i\u0307new.js"],
  ["B-46a αί.txt vs ᾳ+U+0301 (Kk only)", "src/\u1fb3\u0301.txt", "\u03b1\u03af.txt"],
  ["B-47a αί vs α+U+0345+U+0301", "src/\u03b1\u0345\u0301", "\u03b1\u03af"],
  ["B-48a ϊ.md vs U+0345+U+0308", "src/\u0345\u0308.md", "\u03ca.md"],
  ["B-49a ᾴ.txt vs ᾳ+U+0301 (K only)", "src/\u1fb3\u0301.txt", "\u1fb4.txt"],
  ["B-52 (S2a analogue; literal B-52 is S2b, not admitted: A2 = S2a; the Kk disjunct is held by D3-S2a + D3-S2a-Kk) ſecrets.ᾳ+U+0301 with a redacted secrets.αί", "src/\u017fecrets.\u1fb3\u0301", null]
]) {
  test(`D3 ${id}: collision -> ${NOT_PROVEN}`, U17, () => {
    const f = newFixture([target, "src/zz.js"]);
    const entries = entry === null ? ["README.md"] : ["README.md", entry].sort(byCodeUnit);
    const redacted = entry === null ? 1 : 0;
    withWitness(f, absenceWitness(f, [absentRecord(target, { entries, redacted, verdict: "unknown" }), absentRecord("src/zz.js", { entries, redacted })]));
    expectOutcome(f, NOT_PROVEN, { [target]: "unknown", "src/zz.js": "absent" });
  });
}
for (const [id, paths] of [
  ["B-21 src/A.js + src/a.js", ["src/A.js", "src/a.js"]],
  ["B-21b src/İ.js + src/i+U+0307.js", ["src/\u0130.js", "src/i\u0307.js"]],
  ["B-46b src/ᾳ+U+0301.txt + src/αί.txt", ["src/\u1fb3\u0301.txt", "src/\u03b1\u03af.txt"]],
  ["B-47b src/α+U+0345+U+0301.js + src/αί.js", ["src/\u03b1\u0345\u0301.js", "src/\u03b1\u03af.js"]],
  ["B-48b src/U+0345+U+0308.md + src/ϊ.md", ["src/\u0345\u0308.md", "src/\u03ca.md"]]
]) {
  test(`D3 ${id}: declared-target dual-key collision -> ${NOT_PROVEN} (evaluator candidates absent)`, U17, () => {
    const f = newFixture(paths); withWitness(f, allAbsent(f));
    expectOutcome(f, NOT_PROVEN, Object.fromEntries(paths.map(path => [path, "absent"])));
  });
}
test("D3 B-49b: precomposed ᾴ vs αί is kernel-distinct; both absent -> lift", U17, () => {
  const f = newFixture(["src/\u1fb4.txt", "src/x.js"]); withWitness(f, allAbsent(f, { entries: ["\u03b1\u03af.txt"] }));
  expectOutcome(f, LIFT, { "src/\u1fb4.txt": "absent", "src/x.js": "absent" });
});
test("D3 B-6: complete:false (listing_changed) -> not proven", () => {
  const f = newFixture(TWO);
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js", { complete: false, incompleteReason: "listing_changed", verdict: "unknown" }), absentRecord("src/other.js")]));
  const { viaPipeline } = expectOutcome(f, NOT_PROVEN);
  assert.equal(verdictsOf(viaPipeline.candidate)["src/new.js"], "unknown");
});
const refuseRow = (id, code, edit, options = {}) => test(`D3 ${id} -> ${code}`, options, () => {
  const f = newFixture(TWO); withWitness(f, allAbsent(f)); edit(f.evidence.createDestinationAbsenceWitness, f);
  expectOutcome(f, code);
});
refuseRow("B-7 complete:true with incompleteReason", INCONSISTENT, w => { w.targets[0].incompleteReason = "entry_cap"; });
refuseRow("B-8 filtersApplied [secret]", INCONSISTENT, w => { w.filtersApplied = ["secret"]; });
refuseRow("B-9 snapshotToken ≠ exterior", BINDING, w => { w.snapshotToken = "other-snapshot"; });
refuseRow("B-10 revision.dirty ≠ er", BINDING, w => { w.revision.dirty = true; });
refuseRow("B-11 a declared target missing", BINDING, w => { w.targets.pop(); });
refuseRow("B-11 an undeclared extra target", BINDING, w => { w.targets.push(absentRecord("src/zzz.js")); });
refuseRow("B-11 targets out of code-unit order", BINDING, w => { w.targets.reverse(); });
// R3 identity binding (Tester h4): each identity field on its own.
refuseRow("R3 witness projectId ≠ request projectId", BINDING, w => { w.projectId = `${w.projectId}-other`; });
refuseRow("R3 witness repositoryId ≠ request expectedRevision.repositoryId", BINDING, w => { w.repositoryId = "9".repeat(64); });
refuseRow("R3 witness worktreeId ≠ request expectedRevision.worktreeId", BINDING, w => { w.worktreeId = "8".repeat(64); });
// R8 (Tester i5): native lookup present, basename not listed, producer verdict absent -> recomputed exists ≠ absent.
refuseRow("R8 nativeLookup present + basename not listed + verdict absent", INCONSISTENT, w => { w.targets[0].nativeLookup = "present"; }, U17);
// R5 (Tester g2): complete:true requires nativeLookup ∈ {ENOENT, present}.
refuseRow("R5 complete:true with nativeLookup error (verdict absent)", INCONSISTENT, w => { w.targets[0].nativeLookup = "error"; });
refuseRow("R5 complete:true with nativeLookup null (verdict absent)", INCONSISTENT, w => { w.targets[0].nativeLookup = null; });
for (const key of ["kind", "version", "producerIdentity"]) refuseRow(`B-12 wrong ${key}`, INVALID, w => { w[key] = `${w[key]}-other`; });
refuseRow("B-13 extra top-level key", INVALID, w => { w.extra = true; });
refuseRow("B-14 verdict absent with the name listed (ENOENT; R5)", INCONSISTENT, w => { relist(w.targets[0], ["README.md", "new.js"]); });
refuseRow("B-14 verdict absent with the name listed (present; R8)", INCONSISTENT, w => {
  relist(w.targets[0], ["README.md", "new.js"]); w.targets[0].nativeLookup = "present";
}, U17);
refuseRow("B-15 listingDigest mismatch", INCONSISTENT, w => { w.targets[0].enumeration.listingDigest = "0".repeat(64); });
test("D3 B-16: retained Context sibling missing from entries -> create_absence_binding_mismatch (R9 in the binder)", () => {
  const f = newFixture(["src/new.js"]);
  f.evidence.pack.sections.files.items.push({ path: "src/sibling.js",
    provenance: { trust: "canonical_fact", reason: "related_path", source: { path: "src/sibling.js", sha256: "e".repeat(64) } } });
  withWitness(f, allAbsent(f));
  expectOutcome(f, BINDING);
});
test("D3 B-16: Impact targetSource basename missing from entries -> create_absence_binding_mismatch (R9)", () => {
  const f = fixture(["src/a.js"]); f.evidence.pack.sections.files.items = [];
  withWitness(f, allAbsent(f));
  expectOutcome(f, BINDING);
});
test("D3 B-16: retained observation of p with witness verdict absent -> binding mismatch even when R8 is skipped (seam 16.0)", () => {
  const f = fixture(["src/a.js"]); f.evidence.pack.sections.files.items = [];
  withWitness(f, absenceWitness(f, [absentRecord("src/a.js", { enumeration: null, complete: false, incompleteReason: "entry_cap" })]));
  assert.equal(pipeline(f, { runtimeUnicodeVersion: "16.0" }).code, BINDING);
});
test("D3 B-17: last ancestor absent -> create_parent_directory_absent", U17, () => {
  const f = newFixture(["src/sub/new.js", "src/z.js"]);
  withWitness(f, absenceWitness(f, [scopeOutRecord("src/sub/new.js", "absent"), absentRecord("src/z.js")]));
  expectOutcome(f, "create_parent_directory_absent", { "src/sub/new.js": "parent_absent", "src/z.js": "absent" });
});
for (const state of ["symlink", "repository_boundary", "nested_project", "device_boundary", "not_directory"]) {
  test(`D3 B-18: ancestor ${state} -> create_ancestor_boundary`, U17, () => {
    const f = newFixture(["src/sub/new.js", "src/z.js"]);
    withWitness(f, absenceWitness(f, [scopeOutRecord("src/sub/new.js", state), absentRecord("src/z.js")]));
    expectOutcome(f, "create_ancestor_boundary", { "src/sub/new.js": "ancestor_boundary", "src/z.js": "absent" });
  });
}
test("D3 B-19: one absent, one UNKNOWN -> not proven (all-or-nothing)", U17, () => {
  const f = newFixture(TWO);
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js"), absentRecord("src/other.js", { complete: false, incompleteReason: "token_mismatch", verdict: "unknown" })]));
  expectOutcome(f, NOT_PROVEN, { "src/new.js": "absent", "src/other.js": "unknown" });
});
test("D3 B-20: one EXISTS, one scope-out -> create_destination_exists", U17, () => {
  const f = newFixture(["src/new.js", "src/sub/x.js"]);
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js", { entries: ["README.md", "new.js"], nativeLookup: "present", verdict: "exists" }), scopeOutRecord("src/sub/x.js", "absent")]));
  expectOutcome(f, "create_destination_exists", { "src/new.js": "exists", "src/sub/x.js": "parent_absent" });
});
refuseRow("B-22 generatedAt non-null", INCONSISTENT, w => { w.generatedAt = "2026-10-08T00:00:00Z"; });
refuseRow("B-23 requiresReobservation false", INCONSISTENT, w => { w.requiresReobservation = false; });
refuseRow("B-24 limits ≠ constants", INCONSISTENT, w => { w.limits.maxEntriesPerParent = 2048; });
refuseRow("B-25 observation.revisionStable false with a complete target", INCONSISTENT, w => { w.observation.revisionStable = false; });
refuseRow("B-25 observation.tokenStable false with a complete target", INCONSISTENT, w => { w.observation.tokenStable = false; });
refuseRow("B-26 non-null provenance with a complete target", INCONSISTENT, w => {
  w.provenance = { bindingMismatchReason: "snapshot_token_mismatch", liveSnapshotToken: "live", liveRevision: null };
});
refuseRow("B-27 unsorted entries", INCONSISTENT, w => { relist(w.targets[0], ["b.md", "a.md"]); });
refuseRow("B-27 duplicate entries", INCONSISTENT, w => { relist(w.targets[0], ["a.md", "a.md"]); });
refuseRow("B-28 entryCount 1025 with complete:true", INCONSISTENT, w => { relist(w.targets[0], ["README.md"], 1024); });
// B-29 (S2a): all three arithmetic directions; listingDigest recomputed so the arithmetic is the only defect.
for (const [direction, body] of [
  ["entryCount > entries.length + redacted", { entryCount: 5, entries: ["README.md"], redactedSecretEntryCount: 0 }],
  ["entryCount < entries.length + redacted", { entryCount: 0, entries: ["README.md"], redactedSecretEntryCount: 0 }],
  ["redactedSecretEntryCount wrong, entryCount === entries.length", { entryCount: 1, entries: ["README.md"], redactedSecretEntryCount: 1 }]
]) {
  refuseRow(`B-29 S2a arithmetic mismatch (${direction})`, INCONSISTENT, w => { w.targets[0].enumeration = { ...body, listingDigest: sha256(canonicalJson(body)) }; });
}
// B-29 S1 / S2b / S3 legs: not admitted (A2 = S2a): R1. The S3 record shape { entryCount, entries, listingDigest }
// equals S1's (contract §2.1), so the S1-shaped leg also covers S3; an explicit S3-labelled leg is kept for clarity.
const shaped = body => ({ ...body, listingDigest: sha256(canonicalJson(body)) });
refuseRow("B-29 S1-shaped enumeration with an arithmetic mismatch (not admitted (A2 = S2a): R1)", INVALID, w => {
  w.targets[0].enumeration = shaped({ entryCount: 2, entries: ["README.md"] });
});
refuseRow("B-29 S3-shaped enumeration with an arithmetic mismatch (not admitted (A2 = S2a): R1; S3 shape = S1 shape)", INVALID, w => {
  w.targets[0].enumeration = shaped({ entryCount: 3, entries: ["README.md"] });
});
refuseRow("B-29 S3-shaped enumeration under secretNamePolicy S3 (not admitted (A2 = S2a): R1/R2)", INVALID, w => {
  w.secretNamePolicy = "S3"; w.targets[0].enumeration = shaped({ entryCount: 1, entries: ["README.md"] });
});
refuseRow("B-29 S2b-shaped enumeration with an arithmetic mismatch (not admitted (A2 = S2a): R1)", INVALID, w => {
  w.targets[0].enumeration = shaped({ entryCount: 3, entries: ["README.md"], redactedSecretEntryKeyDigests: [sha256("k")], redactedSecretEntryKernelKeyDigests: [sha256("kk")] });
});
refuseRow("B-29 S2b-shaped enumeration with digest lists of different lengths (not admitted (A2 = S2a): R1)", INVALID, w => {
  w.targets[0].enumeration = shaped({ entryCount: 2, entries: ["README.md"], redactedSecretEntryKeyDigests: [sha256("k")], redactedSecretEntryKernelKeyDigests: [] });
});
test(`D3 B-39: literal S2b input (src/ſecrets.json, digest of K("secrets.json")) -> ${INVALID} (not admitted (A2 = S2a): R1); S2a analogue = B-37 (src/ſecrets.json, redactedSecretEntryCount ≥ 1 -> ${NOT_PROVEN})`, () => {
  const target = "src/\u017fecrets.json";
  const f = newFixture([target, "src/zz.js"]);
  const s2b = shaped({ entryCount: 2, entries: ["README.md"], redactedSecretEntryKeyDigests: [sha256("secrets.json")], redactedSecretEntryKernelKeyDigests: [sha256("secrets.json")] });
  withWitness(f, absenceWitness(f, [absentRecord(target, { enumeration: s2b, verdict: "unknown" }), absentRecord("src/zz.js", { enumeration: s2b })]));
  expectOutcome(f, INVALID);
});
test("D3 B-30: malformed chains -> inconsistent", () => {
  const cases = [
    ["element after absent", "src/a/new.js", ancestors => { ancestors[1] = { path: "src", state: "absent", fsType: null, devIno: null }; ancestors[2].state = "absent"; ancestors[2].fsType = ancestors[2].devIno = null; }],
    ["element after symlink", "src/a/new.js", ancestors => { ancestors[1] = { path: "src", state: "symlink", fsType: null, devIno: null }; }],
    ["fsType null on a directory", "src/a/new.js", ancestors => { ancestors[1].fsType = null; }]
  ];
  for (const [name, path, edit] of cases) {
    const f = newFixture([path]);
    const record = scopeOutRecord(path, "absent"); record.ancestors = chainFor(path); edit(record.ancestors);
    record.verdict = "unknown"; record.incompleteReason = "listing_changed";
    withWitness(f, absenceWitness(f, [record]));
    assert.equal(pipeline(f).code, INCONSISTENT, name);
    terminal(f, "not_evaluated", INCONSISTENT);
  }
});
refuseRow("B-31 verdict exists disagreeing with the data", INCONSISTENT, w => { w.targets[0].verdict = "exists"; }, U17);
refuseRow("B-31 verdict parent_absent disagreeing with the data", INCONSISTENT, w => { w.targets[0].verdict = "parent_absent"; }, U17);
test("D3 B-32: nameComparison constants and shapes -> invalid", () => {
  const edits = [
    nc => { nc.keyId = "hn-create-name-key-v2"; }, nc => { nc.keyId = "hn-create-name-key-v1"; }, nc => { nc.unicodeVersion = "16.0"; },
    nc => { nc.caseFolding = "simple"; }, nc => { nc.turkicPostFold = false; }, nc => { nc.collisionRule = "K"; },
    nc => { nc.kernelModelKey.kernelUcdVersion = "17.0.0"; }, nc => { nc.kernelModelKey.cccSource = "original_character"; },
    nc => { nc.kernelModelKey.modelId = "other"; }, nc => { nc.kernelModelKey.kernelRef = "v6.12"; },
    nc => { nc.kernelModelKey.defaultIgnorableAsEmptyStopper = false; }, nc => { nc.kernelModelKey.postSteps = "P4-P6"; },
    nc => { nc.stripDefaultIgnorable = false; }, nc => { nc.trimTrailingDotSpace = false; },
    nc => { nc.turkicPremap = true; },
    nc => { nc.keyId = "hn-create-name-key-v2"; delete nc.collisionRule; delete nc.kernelModelKey; }
  ];
  for (const edit of edits) {
    const f = newFixture(TWO); withWitness(f, allAbsent(f)); edit(f.evidence.createDestinationAbsenceWitness.nameComparison);
    assert.equal(pipeline(f).code, INVALID, edit.toString());
    terminal(f, "not_evaluated", INVALID);
  }
});
for (const key of Object.keys(CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX)) refuseRow(`B-33 failClosedMatrix.${key} false`, INCONSISTENT, w => { w.failClosedMatrix[key] = false; });
test("D3 B-34: ancestor unreadable -> not proven (not a scope-out)", () => {
  const f = newFixture(["src/sub/new.js", "src/z.js"]);
  withWitness(f, absenceWitness(f, [scopeOutRecord("src/sub/new.js", "unreadable"), absentRecord("src/z.js")]));
  const { viaPipeline } = expectOutcome(f, NOT_PROVEN);
  assert.equal(verdictsOf(viaPipeline.candidate)["src/sub/new.js"], "unknown");
});
test("D3 B-35: three targets in the same parent, all absent -> lift", U17, () => {
  const f = newFixture(["src/a.js", "src/b.js", "src/c.js"]); withWitness(f, allAbsent(f));
  expectOutcome(f, LIFT, { "src/a.js": "absent", "src/b.js": "absent", "src/c.js": "absent" });
});
test("D3 B-36: an extra key at each nested level, an S4-shaped enumeration and an own __proto__ key -> invalid", () => {
  const edits = [
    w => { w.observation.extra = 1; }, w => { w.nameComparison.extra = 1; }, w => { w.nameComparison.kernelModelKey.extra = 1; },
    w => { w.filesystem.extra = 1; }, w => { w.limits.extra = 1; }, w => { w.targets[0].enumeration.extra = 1; },
    w => { w.targets[0].ancestors[0].extra = 1; }, w => { w.hardFlags.extra = false; }, w => { w.project.extra = 1; },
    w => { w.revision.extra = 1; }, w => { w.failClosedMatrix.extra = true; }, w => { w.targets[0].extra = 1; },
    w => { w.provenance = { bindingMismatchReason: "snapshot_token_mismatch", liveSnapshotToken: null, liveRevision: null, extra: 1 }; },
    w => { w.targets[0].enumeration = { parentEmpty: false }; },
    w => { Object.defineProperty(w.targets[0].enumeration, "__proto__", { value: 1, enumerable: true, writable: true, configurable: true }); },
    w => { Object.defineProperty(w, "__proto__", { value: { x: 1 }, enumerable: true, writable: true, configurable: true }); }
  ];
  for (const edit of edits) {
    const f = newFixture(TWO); withWitness(f, allAbsent(f)); edit(f.evidence.createDestinationAbsenceWitness);
    assert.equal(pipeline(f).code, INVALID, edit.toString());
    terminal(f, "not_evaluated", INVALID);
  }
});
for (const [id, name] of [["B-37", "\u017fecrets.json"], ["B-38", "id_rsa."]]) {
  test(`D3 ${id}: S2a n=1, target src/${name} -> not proven (secret rule)`, U17, () => {
    const f = newFixture([`src/${name}`, "src/zz.js"]);
    withWitness(f, absenceWitness(f, [absentRecord(`src/${name}`, { redacted: 1, verdict: "unknown" }), absentRecord("src/zz.js", { redacted: 1 })]));
    expectOutcome(f, NOT_PROVEN, { [`src/${name}`]: "unknown", "src/zz.js": "absent" });
  });
}
refuseRow("B-40 an entries element satisfying SECRET (R5)", INCONSISTENT, w => { relist(w.targets[0], [".env", "README.md"]); });
refuseRow("B-41 complete:true with an ancestor fsType 0x1021997 (v9fs; R6)", INCONSISTENT, w => { w.targets[0].ancestors[0].fsType = "0x1021997"; });
refuseRow("B-41 complete:true with rootFsType 0x1021997 (R6)", INCONSISTENT, w => { w.filesystem.rootFsType = "0x1021997"; });
for (const [id, target] of [["B-42", "src/\u200b"], ["B-43", "src/LONGFI~1.JS"]]) {
  test(`D3 ${id}(a): producer verdict unknown -> not proven (shape rule)`, U17, () => {
    const f = newFixture([target, "src/zz.js"]);
    withWitness(f, absenceWitness(f, [absentRecord(target, { verdict: "unknown" }), absentRecord("src/zz.js")]));
    expectOutcome(f, NOT_PROVEN, { [target]: "unknown", "src/zz.js": "absent" });
  });
  test(`D3 ${id}(b): producer verdict absent -> inconsistent (R8 i)`, U17, () => {
    const f = newFixture([target, "src/zz.js"]); withWitness(f, allAbsent(f));
    expectOutcome(f, INCONSISTENT);
  });
}
test("D3 B-44(a): empty parent, producer verdict unknown -> not proven", U17, () => {
  const f = newFixture(TWO);
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js", { entries: [], verdict: "unknown" }), absentRecord("src/other.js")]));
  expectOutcome(f, NOT_PROVEN, { "src/new.js": "unknown", "src/other.js": "absent" });
});
refuseRow("B-44(b) empty parent, producer verdict absent (R8 d2)", INCONSISTENT, w => { relist(w.targets[0], []); }, U17);
refuseRow("B-45 nativeLookup present with entryCount 0 (R5)", INCONSISTENT, w => { relist(w.targets[0], []); w.targets[0].nativeLookup = "present"; w.targets[0].verdict = "unknown"; });
test("D3 B-53: one valid absent record + one witness_byte_cap minimal record -> not proven", () => {
  const f = newFixture(TWO);
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js"), emptyChainRecord("src/other.js", "witness_byte_cap")]));
  const { viaPipeline } = expectOutcome(f, NOT_PROVEN);
  assert.equal(verdictsOf(viaPipeline.candidate)["src/other.js"], "unknown");
});
test("D3 B-54: witness_byte_cap record not in the minimal form -> inconsistent (R5)", () => {
  const edits = [
    r => { r.enumeration = listing(["README.md"]); }, r => { r.ancestors = chainFor(r.newPath); },
    r => { r.nativeLookup = "ENOENT"; }, r => { r.verdict = "absent"; }
  ];
  for (const edit of edits) {
    const f = newFixture(TWO); const capped = emptyChainRecord("src/other.js", "witness_byte_cap"); edit(capped);
    withWitness(f, absenceWitness(f, [absentRecord("src/new.js"), capped]));
    assert.equal(pipeline(f).code, INCONSISTENT, edit.toString());
    terminal(f, "not_evaluated", INCONSISTENT);
  }
});
/** One-target witness padded with sorted entries to an exact canonical UTF-8 size. */
function sizedWitness(f, size) {
  const names = ["README.md"];
  const build = () => absenceWitness(f, [absentRecord(f.request.task.paths[0], { entries: names })]);
  while (size - canonicalByteLength(build()) > 150) names.push(`f${String(names.length).padStart(5, "0")}${"x".repeat(44)}`);
  names[names.length - 1] += "y".repeat(size - canonicalByteLength(build()));
  const w = build();
  assert.equal(canonicalByteLength(w), size);
  assert.ok(Buffer.byteLength(names[names.length - 1], "utf8") <= 255);
  return w;
}
test("D3 B-55: canonical size 49153 -> inconsistent (R4); exactly 49152 passes R4", () => {
  const over = newFixture(["src/new.js"]); withWitness(over, sizedWitness(over, 49153));
  expectOutcome(over, INCONSISTENT);
  const exact = newFixture(["src/new.js"]); withWitness(exact, sizedWitness(exact, 49152));
  const { candidate } = pipeline(exact);
  assert.ok(candidate && candidate.ok === true, "49152 passes R1–R6");
});
test("D3 B-56: one capped target, another with a byte-equal entry -> create_destination_exists", U17, () => {
  const f = newFixture(TWO);
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js", { entries: ["README.md", "new.js"], nativeLookup: "present", verdict: "exists" }), emptyChainRecord("src/other.js", "witness_byte_cap")]));
  expectOutcome(f, "create_destination_exists", { "src/new.js": "exists", "src/other.js": "unknown" });
});
test("D3 B-57: retained Context sibling with a null-enumeration record (entry_cap; witness_byte_cap) -> not proven, not binding", () => {
  for (const record of [absentRecord("src/new.js", { enumeration: null, complete: false, incompleteReason: "entry_cap", verdict: "unknown" }),
    emptyChainRecord("src/new.js", "witness_byte_cap")]) {
    const f = newFixture(["src/new.js"]);
    f.evidence.pack.sections.files.items.push({ path: "src/a.js",
      provenance: { trust: "canonical_fact", reason: "related_path", source: { path: "src/a.js", sha256: "e".repeat(64) } } });
    withWitness(f, absenceWitness(f, [record]));
    expectOutcome(f, NOT_PROVEN, { "src/new.js": "unknown" });
  }
});
refuseRow("B-58 ancestors without the root element (R3)", BINDING, w => { w.targets[0].ancestors.shift(); });
refuseRow("B-58 root element repository_boundary (R5)", INCONSISTENT, w => {
  w.targets[0].ancestors = [{ path: "", state: "repository_boundary", fsType: null, devIno: null }];
  Object.assign(w.targets[0], { nativeLookup: null, enumeration: null, complete: false, incompleteReason: "ancestor_scope_out", verdict: "ancestor_boundary" });
});
refuseRow("B-59 empty chain with a non-empty-chain reason", INCONSISTENT, w => {
  Object.assign(w.targets[0], emptyChainRecord(w.targets[0].newPath, "listing_changed"));
});
refuseRow("B-59 empty chain with complete:true", INCONSISTENT, w => { w.targets[0].ancestors = []; });
test("D3 B-60: PA-34-shaped witness (producer Unicode mismatch), no seam -> not proven, no refuse", () => {
  const f = newFixture(TWO);
  withWitness(f, absenceWitness(f, TWO.map(path => emptyChainRecord(path, "unicode_version_mismatch")), {
    observation: { basis: "working_tree", bracket: "before_after_rewalk", revisionStable: false, tokenStable: false },
    filesystem: { policyId: CREATE_ABSENCE_WITNESS_FS_POLICY_ID, rootFsType: null } }));
  expectOutcome(f, NOT_PROVEN, { "src/new.js": "unknown", "src/other.js": "unknown" });
});
test("D3 B-61: PA-10b witness (lone surrogate) -> not proven; neither evaluator nor binder throws", () => {
  const f = newFixture(["src/a\ud800.js", "src/b.js"]);
  withWitness(f, absenceWitness(f, [emptyChainRecord("src/a\ud800.js", "non_utf8_name"), absentRecord("src/b.js")]));
  const { viaPipeline } = expectOutcome(f, NOT_PROVEN);
  assert.equal(verdictsOf(viaPipeline.candidate)["src/a\ud800.js"], "unknown");
});

// ---- B-62…B-67: full chain for complete:true records (r3.4 + N-12 full-chain amendment, R5-FC) ----
// Otherwise valid all-absent S2a witnesses; only targets[i].ancestors is mutated and complete:true is kept.
// R5 precedes R7, so the refuse rows run on any runtime; never registered in REACHABLE (RN-8).
const FC_DEEP = ["a/b/c/new.js", "a/b/c/other.js"];
const keepAncestors = (record, indexes) => { const full = chainFor(record.newPath); record.ancestors = indexes.map(i => ({ ...full[i] })); };
const truncateAncestors = (record, length) => { record.ancestors = record.ancestors.slice(0, length); };
function fullChainRow(id, paths, code, edit, options = {}) {
  test(`D3 ${id} -> ${code}`, options, () => {
    const f = newFixture(paths); withWitness(f, allAbsent(f)); edit(f.evidence.createDestinationAbsenceWitness, f);
    expectOutcome(f, code);
  });
}
fullChainRow("B-62a complete:true chain without the parent element (a/b/c/new.js: ['', a, a/b]; R5-FC)", FC_DEEP, INCONSISTENT, w => truncateAncestors(w.targets[0], 3));
fullChainRow("B-62b complete:true root-only chain (a/b/c/new.js: ['']; R5-FC)", FC_DEEP, INCONSISTENT, w => truncateAncestors(w.targets[0], 1));
fullChainRow("B-62c complete:true src/new.js with root-only chain [''] (Reviewer R-1 shape; R5-FC)", TWO, INCONSISTENT, w => truncateAncestors(w.targets[0], 1));
fullChainRow("B-62d mixed depth a/b/new.js truncated to [''] + root-level z.js full ['']; R5-FC", ["a/b/new.js", "z.js"], INCONSISTENT, w => {
  assert.equal(w.targets[0].newPath, "a/b/new.js"); assert.deepEqual(w.targets[1].ancestors.map(a => a.path), [""]);
  truncateAncestors(w.targets[0], 1);
});
test("D3 B-62e: B-62c with evaluator seam runtimeUnicodeVersion 16.0 -> create_absence_evidence_inconsistent (R5 before R7)", () => {
  const f = newFixture(TWO); withWitness(f, allAbsent(f)); truncateAncestors(f.evidence.createDestinationAbsenceWitness.targets[0], 1);
  assert.equal(pipeline(f, { runtimeUnicodeVersion: "16.0" }).code, INCONSISTENT);
});
test("D3 B-62f: complete:true EXISTS record (present) truncated to ['', a] -> create_absence_evidence_inconsistent (R5-FC, any verdict)", () => {
  const f = newFixture(["a/b/new.js", "a/b/other.js"]);
  const entries = ["README.md", "other.js"];
  withWitness(f, absenceWitness(f, [absentRecord("a/b/new.js", { entries }),
    absentRecord("a/b/other.js", { entries, nativeLookup: "present", verdict: "exists" })]));
  const w = f.evidence.createDestinationAbsenceWitness;
  assert.equal(w.targets[1].newPath, "a/b/other.js");
  truncateAncestors(w.targets[1], 2);
  expectOutcome(f, INCONSISTENT);
});
test("D3 B-63: path defects in a complete:true chain -> create_absence_binding_mismatch (R3 runs before R5-FC)", () => {
  const cases = [
    ["drop middle", FC_DEEP, [0, 1, 3]], ["drop root", FC_DEEP, [1, 2, 3]], ["reorder", FC_DEEP, [0, 2, 1, 3]],
    ["duplicate middle", FC_DEEP, [0, 1, 1, 2, 3]], ["duplicate parent appended", FC_DEEP, [0, 1, 2, 3, 3]],
    ["duplicate inside a truncated prefix", FC_DEEP, [0, 1, 1]]
  ];
  for (const [name, paths, indexes] of cases) {
    const f = newFixture(paths); withWitness(f, allAbsent(f)); keepAncestors(f.evidence.createDestinationAbsenceWitness.targets[0], indexes);
    assert.equal(pipeline(f).code, BINDING, name);
    terminal(f, "not_evaluated", BINDING);
  }
  const f = newFixture(["new.js", "other.js"]); withWitness(f, allAbsent(f));
  const target = f.evidence.createDestinationAbsenceWitness.targets[0];
  target.ancestors = [...target.ancestors, { path: "x", state: "directory", fsType: FS_TYPE, devIno: "2049:1999" }];
  assert.equal(pipeline(f).code, BINDING, "root-level target with ['', x]");
  terminal(f, "not_evaluated", BINDING);
});
test("D3 B-64: non-directory states in a complete:true verdict-absent chain -> create_absence_evidence_inconsistent", () => {
  const off = (path, state) => ({ path, state, fsType: null, devIno: null });
  const cases = [
    ["parent unreadable", a => { a[3] = off("a/b/c", "unreadable"); }],
    ["middle unreadable", a => { a[1] = off("a", "unreadable"); }],
    ["parent symlink", a => { a[3] = off("a/b/c", "symlink"); }],
    ["parent not_directory keeping fsType/devIno", a => { a[3].state = "not_directory"; }],
    ["parent absent", a => { a[3] = off("a/b/c", "absent"); }],
    ["root unreadable", a => { a[0] = off("", "unreadable"); }],
    ["truncated root-unreadable only", a => { a.splice(0, a.length, off("", "unreadable")); }]
  ];
  for (const [name, edit] of cases) {
    const f = newFixture(FC_DEEP); withWitness(f, allAbsent(f)); edit(f.evidence.createDestinationAbsenceWitness.targets[0].ancestors);
    assert.equal(pipeline(f).code, INCONSISTENT, name);
    terminal(f, "not_evaluated", INCONSISTENT);
  }
});
for (const [id, paths] of [["B-65 full chain ['', a, a/b, a/b/c]", FC_DEEP], ["B-65 src/new.js full ['', src]", TWO], ["B-65 root-level new.js + other.js with [''] (parent = root)", ["new.js", "other.js"]]]) {
  test(`D3 ${id} -> lift ${LIFT}`, U17, () => {
    const f = newFixture(paths); withWitness(f, allAbsent(f));
    for (const t of f.evidence.createDestinationAbsenceWitness.targets) assert.equal(t.ancestors.length, t.newPath.split("/").length);
    expectOutcome(f, LIFT, Object.fromEntries(paths.map(path => [path, "absent"])));
  });
}
test("D3 B-66a: B-62c + co-target witness EXISTS (present) -> inconsistent (refuse beats EXISTS)", () => {
  const f = newFixture(TWO); const entries = ["README.md", "other.js"];
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js", { entries }), absentRecord("src/other.js", { entries, nativeLookup: "present", verdict: "exists" })]));
  truncateAncestors(f.evidence.createDestinationAbsenceWitness.targets[0], 1);
  expectOutcome(f, INCONSISTENT);
});
test("D3 B-66b: B-62c + co-target observed in Context (C(p)), entries consistent -> inconsistent (refuse beats EXISTS)", () => {
  const f = fixture(TWO); unobserve(f, "src/new.js"); const entries = ["README.md", "other.js"];
  assert.ok(f.evidence.pack.sections.files.items.some(item => item.path === "src/other.js"));
  withWitness(f, absenceWitness(f, [absentRecord("src/new.js", { entries }), absentRecord("src/other.js", { entries, nativeLookup: "present", verdict: "exists" })]));
  truncateAncestors(f.evidence.createDestinationAbsenceWitness.targets[0], 1);
  expectOutcome(f, INCONSISTENT);
});
test("D3 B-66c: truncated src/z.js + co-target src/a/new.js scope-out (parent_absent) -> inconsistent (refuse beats scope-out)", () => {
  const f = newFixture(["src/a/new.js", "src/z.js"]);
  withWitness(f, absenceWitness(f, [scopeOutRecord("src/a/new.js", "absent"), absentRecord("src/z.js")]));
  const w = f.evidence.createDestinationAbsenceWitness; assert.equal(w.targets[1].newPath, "src/z.js");
  truncateAncestors(w.targets[1], 1);
  expectOutcome(f, INCONSISTENT);
});
fullChainRow("B-66d B-62c + snapshotToken ≠ exterior (R3 first)", TWO, BINDING, w => { truncateAncestors(w.targets[0], 1); w.snapshotToken = "other-snapshot"; });
fullChainRow("B-66e B-62c + generatedAt non-null (R4)", TWO, INCONSISTENT, w => { truncateAncestors(w.targets[0], 1); w.generatedAt = "2026-10-09T00:00:00Z"; });
fullChainRow("B-66f B-62c + extra top-level key (R1)", TWO, INVALID, w => { truncateAncestors(w.targets[0], 1); w.extra = true; });
test("D3 B-67(i): complete:false honest scope-out (absent at src/a) + absent co-target -> create_parent_directory_absent (R5-FC not applied)", U17, () => {
  const f = newFixture(["src/a/new.js", "src/z.js"]);
  withWitness(f, absenceWitness(f, [scopeOutRecord("src/a/new.js", "absent"), absentRecord("src/z.js")]));
  expectOutcome(f, "create_parent_directory_absent", { "src/a/new.js": "parent_absent", "src/z.js": "absent" });
});
test("D3 B-67(ii–v): complete:false forms with short or empty chains -> not proven (R5-FC not applied)", () => {
  const cases = [
    ["truncated chain, listing_changed, verdict unknown", () => { const r = absentRecord("src/new.js", { complete: false, incompleteReason: "listing_changed", verdict: "unknown" }); r.ancestors = r.ancestors.slice(0, 1); return r; }],
    ["witness_byte_cap minimal", () => emptyChainRecord("src/new.js", "witness_byte_cap")],
    ["segment_cap empty chain", () => emptyChainRecord("src/new.js", "segment_cap")],
    ["case (d) reached chain, enumeration null, non_utf8_name", () => absentRecord("src/new.js", { enumeration: null, complete: false, incompleteReason: "non_utf8_name", verdict: "unknown" })]
  ];
  for (const [name, record] of cases) {
    const f = newFixture(TWO); withWitness(f, absenceWitness(f, [record(), absentRecord("src/other.js")]));
    const { viaPipeline } = expectOutcome(f, NOT_PROVEN);
    assert.equal(verdictsOf(viaPipeline.candidate)["src/new.js"], "unknown", name);
  }
});

// ---- C-*: composer ----
const RELAX_COMPLETENESS = () => ({ source: ["source_unavailable"], provider: [], traversal: [], output: [] });
/** Real-shaped multi-target new-path Impact (§0.3): global partial / not_evaluated, affectedFiles []. */
function realShapedCreate(paths = TWO) {
  const f = newFixture(paths); const impact = f.evidence.impact;
  Object.assign(impact, { status: "partial", findingState: "not_evaluated", affectedFiles: [], completeness: RELAX_COMPLETENESS() });
  for (const target of impact.targets) Object.assign(target, { targetSource: null, status: "partial", findingState: "not_evaluated", completeness: RELAX_COMPLETENESS() });
  impact.affectedTests = { status: "partial", findingState: "no_evidence_found", candidates: [], completeness: RELAX_COMPLETENESS() };
  return withWitness(f, allAbsent(f));
}
test("D3 C-1: proven-absent witness + real-shaped multi-target Impact -> D3-c relax, incomplete WRITE + operationIntent create", U17, () => {
  const f = realShapedCreate(); const r = run(f);
  assert.equal(r.status, "incomplete", JSON.stringify(r.reasons));
  assert.equal(r.policyVersion, policy.EFFECTIVE_TASK_SCOPE_POLICY_VERSION);
  assert.deepEqual(r.write.items.map(item => item.target.path), TWO);
  for (const item of r.write.items) assert.deepEqual(item.ruleIds, ["explicit_create_intent", "explicit_task_path"]);
  assert.deepEqual(Object.keys(r.operationIntent), ["kind", "targets"]);
  assert.deepEqual(r.operationIntent, { kind: "create", targets: TWO.map(newPath => ({ oldPath: null, newPath })) });
  assert.ok(r.completeness.resolver.includes(LIFT));
  assert.deepEqual(r.watch.items, []); assert.deepEqual(r.impact.items, []);
  assert.equal(JSON.stringify(r).includes("create_intent_awareness"), false);
});
test("D3 C-2: a co-target not_evaluated for a non-create reason, or any completeness deviation -> impact_not_evaluated", () => {
  const edits = [
    f => { f.evidence.impact.targets[1].completeness.provider = ["provider_partial"]; },
    f => { f.evidence.impact.targets[1].status = "unavailable"; },
    f => { f.evidence.impact.completeness.resolver = []; },
    f => { f.evidence.impact.completeness.source = ["source_unavailable", "source_limit"]; }
  ];
  for (const edit of edits) { const f = realShapedCreate(); edit(f); terminal(f, "not_evaluated", "impact_not_evaluated"); }
});
test("D3 C-3: global status unavailable / unsupported -> impact_not_evaluated", () => {
  for (const status of ["unavailable", "unsupported"]) { const f = realShapedCreate(); f.evidence.impact.status = status; terminal(f, "not_evaluated", "impact_not_evaluated"); }
});
// C-4 golden (amend1 §E(ii)): every REACHABLE no-witness fixture; the parsed result's top-level policyVersion
// (asserted equal to the policy constant first) is replaced by the neutral label "<policyVersion>", then
// sha256(JSON.stringify(result)). Captured from the 4b8e213 src (composer 00ff85f5…e2ab, policy 16a52835…5c9b)
// on Node v26.8.2 (Unicode 17.0) with this test file:
//   HN_D3_PRINT_GOLDEN=1 node --test --test-name-pattern="D3 C-4" tests/effective-task-scope-create.test.js
// Ordered [name, digest] pairs (RN-8); 38 entries, sha256(JSON.stringify(C4_GOLDEN)) = 505d3235…2956.
const C4_GOLDEN = [
  ["E1 both paths observed with equal hashes (former happy path)", "82b5dd4612b5dc84f741cccada8fd1f10ece8c5ae19fcf3349e612ddddc0879d"],
  ["E2 Context-only observation", "82b5dd4612b5dc84f741cccada8fd1f10ece8c5ae19fcf3349e612ddddc0879d"],
  ["E3 Impact-only observation", "82b5dd4612b5dc84f741cccada8fd1f10ece8c5ae19fcf3349e612ddddc0879d"],
  ["E4 observed path whose Impact target is not_evaluated", "82b5dd4612b5dc84f741cccada8fd1f10ece8c5ae19fcf3349e612ddddc0879d"],
  ["E5 Context/Impact hash conflict", "d9c6e4c72d1572afbb6449be1e10dfc29cbd9c440bf56efac9ad96818592223c"],
  ["E6a Context item with wrong trust", "d9c6e4c72d1572afbb6449be1e10dfc29cbd9c440bf56efac9ad96818592223c"],
  ["E6b Context item with reason other than task_path", "d9c6e4c72d1572afbb6449be1e10dfc29cbd9c440bf56efac9ad96818592223c"],
  ["A1 no-laundering: single new path, clean flags", "2fb2911bca49fd30e4152ca0685376b99af21ed12efa12390359a6c78a5013eb"],
  ["U1 single new path, default incomplete flags", "2fb2911bca49fd30e4152ca0685376b99af21ed12efa12390359a6c78a5013eb"],
  ["U2 files section not_analyzed, no Impact source", "a6705351bec8e593ad8983e0691395faef3c749f4243ff56202ccd0a10e229c5"],
  ["U2 files section omitted, no Impact source", "a6705351bec8e593ad8983e0691395faef3c749f4243ff56202ccd0a10e229c5"],
  ["U2 files section empty, no Impact source", "a6705351bec8e593ad8983e0691395faef3c749f4243ff56202ccd0a10e229c5"],
  ["U3 mixed [existing, new] -> EXISTS precedence", "9cbbc409aed843d57c25900e4d3017dbd37071d52f45acc6d5181b0aec8aefd6"],
  ["U4 [new, new]", "8e48031dd7f906e03b657da12835f2ba2c8b54bbcd9aaaf56fc73b98de35817d"],
  ["U4b [new, new] with clean flags", "8e48031dd7f906e03b657da12835f2ba2c8b54bbcd9aaaf56fc73b98de35817d"],
  ["M1 malformed declaration {\"kind\":\"create\",\"targets\":[]}", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 malformed declaration {\"kind\":\"create\",\"targets\":[{\"oldPath\":null}]}", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 malformed declaration {\"kind\":\"create\",\"targets\":[{\"newPath\":\"src/a.js\"}]}", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 malformed declaration {\"kind\":\"create\",\"targets\":[{\"oldPath\":\"src/a.js\",\"newPath\":\"src/a.js\"}]}", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 malformed declaration {\"kind\":\"create\",\"targets\":[{\"oldPath\":null,\"newPath\":null}]}", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 malformed declaration {\"kind\":\"create\",\"targets\":[{\"oldPath\":null,\"newPath\":\"src/a.js\",\"exists\":true}]}", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 malformed declaration {\"kind\":\"create\",\"targets\":[{\"oldPath\":null,\"newPath\":\"src/a.js\"}],\"source\":true}", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"../a\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"/a\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \" src/a.js\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"src//a.js\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"src/./a.js\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"src/a.js/\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"src/*.js\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"C:/a\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"src\\\\a.js\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M1 literal spelling \"src/a.js\\n\"", "ad53842b137ac81354643f50c21779641773a7e5a2fd951358cefcbd310b5369"],
  ["M2 declaration set [\"src/a.js\"] differs from task.paths", "b0f99b4cd27fb5d3dba4f1e8477a8d106d05fd84dacd86d922552f39bb75a36b"],
  ["M2 declaration set [\"src/a.js\",\"src/unlisted.js\"] differs from task.paths", "b0f99b4cd27fb5d3dba4f1e8477a8d106d05fd84dacd86d922552f39bb75a36b"],
  ["M2 Impact target missing for a declared newPath (composer origin gate)", "5309ba9958c9e8711c29aec44283d654e4d4e27b3d899c849ac6a7c6fadbd64d"],
  ["M3 33 create targets", "3ada7f86181b2cfa2bcc778140abb9d681776548ca7361b57c01fff52b10026a"],
  ["M4 rename kind remains out of scope (delete-path refuse)", "fe1f414796b6a4a10b2cbb0bc8f3ec0f5f78dd2b15f3cc5a96d4bfdf17f9c678"],
  ["S1 stale expectedRevision", "960812eab78cb8207ea569e230c7c73fcfe5ff12a010f023a88eab3d242382ed"]
];
test("D3 C-4: no witness -> every REACHABLE outcome byte-identical to base except the policyVersion label", () => {
  const actual = REACHABLE.map(([name, build]) => {
    const r = run(build());
    assert.equal(r.policyVersion, policy.EFFECTIVE_TASK_SCOPE_POLICY_VERSION, name);
    r.policyVersion = "<policyVersion>";
    return [name, sha256(JSON.stringify(r))];
  });
  if (process.env.HN_D3_PRINT_GOLDEN === "1") console.log(`C4_GOLDEN ${JSON.stringify(actual)}`);
  assert.deepEqual(actual, C4_GOLDEN);
});
test("D3 C-6: witness + symbols without a symbol witness -> the symbol gate result (step 4 before step 5)", () => {
  const build = () => {
    const f = newFixture(TWO); f.request.task.symbols = ["composeEffectiveTaskScope"];
    f.evidence.pack.sections.task.items[0].symbols = ["composeEffectiveTaskScope"]; return f;
  };
  const without = run(build());
  const f = build(); withWitness(f, absenceWitness(f, [])); // even a malformed witness is never reached
  assert.equal(without.status, "not_evaluated");
  assert.equal(JSON.stringify(run(f)), JSON.stringify(without));
});
test("D3 C-7: witness binding mismatch + Impact global not_evaluated -> create_absence_binding_mismatch (step 5 before 6)", () => {
  const f = realShapedCreate(); f.evidence.createDestinationAbsenceWitness.snapshotToken = "other";
  terminal(f, "not_evaluated", BINDING);
});
test("D3 C-8: the absence witness alone pushes the total over 327680 -> rejected scope_budget_exceeded (sibling)", () => {
  const dir = "d".repeat(200);
  const paths = Array.from({ length: 28 }, (_, i) => `${dir}/${String(i).padStart(2, "0")}${"n".repeat(245)}.js`);
  const f = newFixture(paths);
  const pad = (obj) => { obj.padding = ""; obj.padding = "p".repeat(131072 - Buffer.byteLength(JSON.stringify(obj), "utf8")); };
  pad(f.evidence.pack); pad(f.evidence.impact);
  assert.equal(Buffer.byteLength(JSON.stringify(f.evidence.pack), "utf8"), 131072);
  assert.equal(Buffer.byteLength(JSON.stringify(f.evidence.impact), "utf8"), 131072);
  const withoutWitness = run(f);
  assert.equal(withoutWitness.reasons[0].code, NOT_PROVEN);
  const w = allAbsent(f); withWitness(f, w);
  assert.ok(canonicalByteLength(w) <= 49152, String(canonicalByteLength(w)));
  const { candidate } = pipeline(f); assert.ok(candidate && candidate.ok === true, "the witness passes R1–R8");
  if (UNICODE_17) assert.ok(candidate.targets.every(t => t.verdict === "absent"));
  assert.ok(Buffer.byteLength(JSON.stringify({ request: f.request, ...f.evidence }), "utf8") > policy.MAX_COMPACT_INPUT);
  terminal(f, "rejected", "scope_budget_exceeded");
});
test("D3 C-9 / D3-H: checkInputBudget and the D2 sibling are byte-identical (toString sha256)", () => {
  assert.equal(sha256(policy.checkInputBudget.toString()), "420c4498425bd384bfec0aa3ee8cf0d1435865b455133e85918565f0b8165285");
  assert.equal(sha256(policy.checkCreateAbsenceInputBudget.toString()), "35f41411ea87e1bef5b74f87fe57bf89534130bd9795ee529818c4d309ae65ae");
});
test("D3 C-10: stale gate on a create with a witness -> stale", () => {
  const f = newFixture(TWO); withWitness(f, allAbsent(f)); f.request.expectedRevision.commitSha = "f".repeat(40);
  terminal(f, "stale", "revision_observation_differs");
});
test("D3 C-11: no witness content in lift, refuse or rejected output", () => {
  const SENTINELS = ["witness-sentinel-entry.md", "LIVE-SENTINEL-TOKEN", "2049:", FS_TYPE, "listingDigest", "liveSnapshotToken", "liveRevision", "ancestors", "devIno", "fsType"];
  const outputs = [];
  if (UNICODE_17) {
    const lift = realShapedCreate(); withWitness(lift, allAbsent(lift, { entries: ["witness-sentinel-entry.md"] }));
    const r = run(lift); assert.equal(r.status, "incomplete"); outputs.push(r);
  }
  const refuse = newFixture(TWO); withWitness(refuse, allAbsent(refuse, { entries: ["witness-sentinel-entry.md"] }));
  refuse.evidence.createDestinationAbsenceWitness.provenance = { bindingMismatchReason: "snapshot_token_mismatch", liveSnapshotToken: "LIVE-SENTINEL-TOKEN", liveRevision: null };
  outputs.push(terminal(refuse, "not_evaluated", INCONSISTENT));
  const read = newFixture(TWO); delete read.request.operationIntent; withWitness(read, allAbsent(read, { entries: ["witness-sentinel-entry.md"] }));
  outputs.push(terminal(read, "rejected", "create_absence_witness_unexpected"));
  for (const output of outputs) {
    const text = JSON.stringify(output);
    for (const sentinel of SENTINELS) assert.equal(text.includes(sentinel), false, `${output.status}: ${sentinel}`);
    assert.equal(text.includes(sha256(canonicalJson({ entryCount: 1, entries: ["witness-sentinel-entry.md"], redactedSecretEntryCount: 0 }))), false);
  }
});
test("D3 C-12: R1-malformed witness and C(p) true -> create_absence_evidence_invalid (refuse wins over EXISTS)", () => {
  const f = fixture(); withWitness(f, allAbsent(f)); f.evidence.createDestinationAbsenceWitness.extra = 1;
  terminal(f, "not_evaluated", INVALID);
});
test("D3 C-13: single-target create + legacy single-target Impact -> rejected origin_form_mismatch (NG-9)", () => {
  const f = newFixture(["src/new.js"]); withWitness(f, allAbsent(f));
  const target = f.evidence.impact.targets[0]; delete f.evidence.impact.targets;
  Object.assign(f.evidence.impact, { originPath: target.originPath, targetSource: null });
  terminal(f, "rejected", "origin_form_mismatch");
});
test("D3 C-15: as C-1 but global status not_evaluated -> impact_not_evaluated", () => {
  const f = realShapedCreate(); f.evidence.impact.status = "not_evaluated"; terminal(f, "not_evaluated", "impact_not_evaluated");
});
test("D3 C-16: as C-1 but affectedFiles absent -> impact_not_evaluated", () => {
  const f = realShapedCreate(); delete f.evidence.impact.affectedFiles; terminal(f, "not_evaluated", "impact_not_evaluated");
});
test("D3 C-18a: evaluator seam 16.0 / present-undefined / explicit undefined argument -> every target UNKNOWN, R8 skipped", () => {
  const before = process.versions.unicode;
  for (const seam of [[{ runtimeUnicodeVersion: "16.0" }], [{ runtimeUnicodeVersion: undefined }], [undefined]]) {
    const f = newFixture(TWO); withWitness(f, allAbsent(f));
    f.evidence.createDestinationAbsenceWitness.targets[0].verdict = "exists"; // R8 would refuse; skipped on a mismatch
    const out = pipeline(f, ...seam);
    assert.equal(out.code, NOT_PROVEN, JSON.stringify(seam));
    assert.equal(out.candidate.unicodeMismatch, true);
    assert.ok(out.candidate.targets.every(t => t.verdict === "unknown"));
  }
  assert.equal(process.versions.unicode, before);
});
test("D3 C-18b: the composer calls the evaluator once with two arguments; adapter/route forward no Unicode field", () => {
  const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const composer = read("src/lib/effective-task-scope.js");
  const calls = [...composer.matchAll(/evaluateCreateDestinationAbsenceWitness\(/g)];
  assert.equal(calls.length, 1);
  let depth = 0; let args = 1; let i = calls[0].index + "evaluateCreateDestinationAbsenceWitness(".length;
  for (; i < composer.length; i++) {
    const ch = composer[i];
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) { if (depth === 0) break; depth--; }
    else if (ch === "," && depth === 0) args++;
  }
  assert.equal(args, 2);
  assert.doesNotMatch(composer, /runtimeUnicodeVersion|process\.versions/);
  for (const file of ["src/lib/effective-task-scope-adapter.js", "src/routes/effective-task-scope.routes.js"]) assert.doesNotMatch(read(file), /runtimeUnicodeVersion|unicode/i, file);
});
test("D3 C-18c: non-object third argument (null, string, number, array) -> UNKNOWN, no throw, no fallback", () => {
  const before = process.versions.unicode;
  for (const seam of [null, "16.0", "17.0", 17, [], [{ runtimeUnicodeVersion: "17.0" }]]) {
    const f = newFixture(TWO); withWitness(f, allAbsent(f));
    const out = pipeline(f, seam);
    assert.equal(out.code, NOT_PROVEN, JSON.stringify(seam));
    assert.equal(out.candidate.unicodeMismatch, true);
  }
  assert.equal(process.versions.unicode, before);
});
test("D3 C-19a: real-shaped Impact (D3-c path), target 0 chain truncated as B-62a -> not_evaluated / inconsistent, no containers, no ancestor path", () => {
  const f = realShapedCreate(FC_DEEP); truncateAncestors(f.evidence.createDestinationAbsenceWitness.targets[0], 3);
  const r = terminal(f, "not_evaluated", INCONSISTENT);
  const text = JSON.stringify(r);
  for (const sentinel of ["\"a/b\"", "\"a/b/c\"", "\"a\"", "ancestors", "devIno", "fsType", FS_TYPE, "2049:", "listingDigest"]) assert.equal(text.includes(sentinel), false, sentinel);
});
test("D3 C-19b: real-shaped Impact (D3-c path), unmutated full chains -> lift incomplete, WRITE on task.paths", U17, () => {
  const f = realShapedCreate(FC_DEEP); const r = run(f);
  assert.equal(r.status, "incomplete", JSON.stringify(r.reasons));
  assert.deepEqual(r.write.items.map(item => item.target.path), FC_DEEP);
  assert.deepEqual(r.operationIntent, { kind: "create", targets: FC_DEEP.map(newPath => ({ oldPath: null, newPath })) });
  assert.ok(r.completeness.resolver.includes(LIFT));
});

// ---- D3-L1 / RN-4: instrumented composer instance (its policy import only) ----
const hookState = globalThis[Symbol.for("effective-task-scope-create.test.d3")] = { relax: [], bindStub: null, deleteBinds: [], intentKindOverride: null };
const canonicalPolicyUrl = new URL("../src/lib/effective-task-scope-policy.js", import.meta.url).href;
const d3Hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./effective-task-scope-policy.js" && context.parentURL?.endsWith("?d3hooks")) {
      const source = `import * as real from ${JSON.stringify(canonicalPolicyUrl)};
        export * from ${JSON.stringify(canonicalPolicyUrl)};
        const s = () => globalThis[Symbol.for("effective-task-scope-create.test.d3")];
        export function isCreateGateRelaxed(...args) {
          const result = typeof real.isCreateGateRelaxed === "function" ? real.isCreateGateRelaxed(...args) : false;
          s().relax.push(result); return result;
        }
        export function bindCreateIntent(...args) { const stub = s().bindStub; return stub ? stub(...args) : real.bindCreateIntent(...args); }
        export function bindDeleteIntent(...args) { s().deleteBinds.push(args[0]?.kind); return real.bindDeleteIntent(...args); }
        export function normalizeEffectiveTaskScopeRequest(...args) {
          const normalized = real.normalizeEffectiveTaskScopeRequest(...args); const kind = s().intentKindOverride;
          return kind && normalized.operationIntent ? { ...normalized, operationIntent: { ...normalized.operationIntent, kind } } : normalized;
        }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
let hookedCompose;
try {
  ({ composeEffectiveTaskScope: hookedCompose } = await import("../src/lib/effective-task-scope.js?d3hooks"));
} finally {
  d3Hook.deregister();
}
test("D3-L1: isCreateGateRelaxed is lazy: 0 calls unless findingState is not_evaluated; 1 false call for READ and delete", () => {
  const count = f => { hookState.relax = []; const r = hookedCompose(f.request, f.evidence); return { r, calls: [...hookState.relax] }; };
  assert.deepEqual(count(fixture()).calls, []);
  const read = fixture(); delete read.request.operationIntent; read.evidence.impact.findingState = "not_evaluated";
  const readOut = count(read);
  assert.deepEqual(readOut.calls, [false]); assert.equal(readOut.r.reasons[0].code, "impact_not_evaluated");
  const del = fixture(); del.request.operationIntent = { kind: "delete", targets: del.request.task.paths.map(oldPath => ({ oldPath, newPath: null })) };
  del.evidence.impact.findingState = "not_evaluated";
  const delOut = count(del);
  assert.deepEqual(delOut.calls, [false]); assert.equal(delOut.r.reasons[0].code, "impact_not_evaluated");
  if (UNICODE_17) assert.deepEqual(count(realShapedCreate()).calls, [true]);
});
test("D3 RN-4: the composer falls through only on a positive lift; stubbed binder results never WRITE", () => {
  try {
    for (const stub of [{ notEvaluated: null }, {}, { notEvaluated: null, lift: { reason: "other" } }, { lift: { reason: LIFT } }, null]) {
      hookState.bindStub = () => stub;
      const f = newFixture(TWO); const r = hookedCompose(f.request, f.evidence);
      assert.equal(r.status, "not_evaluated", JSON.stringify(stub));
      assert.equal(Object.hasOwn(r, "write"), false); assert.equal(Object.hasOwn(r, "operationIntent"), false);
      assert.equal(r.reasons[0].code, NOT_PROVEN);
    }
  } finally { hookState.bindStub = null; }
});
test("D3-T1: isCreateGateRelaxed is total: odd shapes (incl. null-prototype records) -> false, never throws", () => {
  assertD3Exports();
  const f = realShapedCreate();
  const req = policy.normalizeEffectiveTaskScopeRequest(f.request, { allowCreateIntent: true });
  const impact = policy.materializeBoundedJsonData(f.evidence.impact);
  const candidate = { ok: true, unicodeMismatch: false, targets: TWO.map(newPath => ({ newPath, verdict: "absent" })) };
  assert.equal(policy.isCreateGateRelaxed(req, impact, candidate), true);
  assert.equal(policy.isCreateGateRelaxed(policy.materializeBoundedJsonData(req), impact, policy.materializeBoundedJsonData(candidate)), true);
  const clone = value => structuredClone(value);
  const nullProto = value => policy.materializeBoundedJsonData(value);
  const variants = [
    [null, impact, candidate], [undefined, impact, candidate], [[], impact, candidate], [{}, impact, candidate],
    [{ ...req, operationIntent: { ...req.operationIntent, kind: "delete" } }, impact, candidate],
    [{ ...req, operationIntent: null }, impact, candidate], [{ ...req, operationIntent: { kind: "create", targets: "x" } }, impact, candidate],
    [{ ...req, operationIntent: { kind: "create", targets: [] } }, impact, candidate], [{ ...req, operationIntent: { kind: "create", targets: [null] } }, impact, candidate],
    [req, impact, undefined], [req, impact, null], [req, impact, []], [req, impact, { ...candidate, ok: false }], [req, impact, { ...candidate, unicodeMismatch: true }],
    [req, impact, { ...candidate, unicodeMismatch: undefined }], [req, impact, { ...candidate, targets: "x" }], [req, impact, { ...candidate, targets: [null, 1] }],
    [req, impact, { ...candidate, targets: candidate.targets.slice(1) }], [req, impact, { ...candidate, targets: [{ newPath: "src/new.js", verdict: "absent" }, { newPath: "src/other.js", verdict: "unknown" }] }],
    [req, null, candidate], [req, [], candidate], [req, { ...clone(impact), status: "available" }, candidate],
    [req, { ...clone(impact), affectedFiles: null }, candidate], [req, { ...clone(impact), completeness: null }, candidate],
    [req, { ...clone(impact), completeness: { ...RELAX_COMPLETENESS(), extra: [] } }, candidate],
    [req, { ...clone(impact), completeness: { source: ["source_unavailable"], provider: [], traversal: [] } }, candidate],
    [req, { ...clone(impact), completeness: { ...RELAX_COMPLETENESS(), output: "x" } }, candidate],
    [req, { ...clone(impact), targets: "x" }, candidate], [req, { ...clone(impact), targets: [null] }, candidate],
    [req, { ...clone(impact), targets: [{ ...clone(impact.targets[0]), originPath: "src/undeclared.js" }] }, candidate],
    [req, { ...clone(impact), targets: [{ ...clone(impact.targets[0]), targetSource: { path: "src/new.js", hash: "e".repeat(64) } }] }, candidate],
    [req, { ...clone(impact), targets: [(({ targetSource, ...rest }) => rest)(clone(impact.targets[0]))] }, candidate],
    [req, { ...clone(impact), targets: [{ ...clone(impact.targets[0]), findingState: "unknown_state" }] }, candidate],
    [req, { ...clone(impact), targets: [{ ...clone(impact.targets[0]), completeness: { ...RELAX_COMPLETENESS(), provider: ["x"] } }] }, candidate],
    [req, impact, nullProto({ ok: true, unicodeMismatch: false, targets: [] })]
  ];
  for (const [i, args] of variants.entries()) {
    let result;
    assert.doesNotThrow(() => { result = policy.isCreateGateRelaxed(...args); }, `variant ${i}`);
    assert.equal(result, false, `variant ${i}`);
  }
  const proxy = new Proxy({}, { get() { throw new Error("trap"); }, has() { throw new Error("trap"); }, ownKeys() { throw new Error("trap"); }, getOwnPropertyDescriptor() { throw new Error("trap"); } });
  assert.equal(policy.isCreateGateRelaxed(proxy, impact, candidate), false);
  assert.equal(policy.isCreateGateRelaxed(req, proxy, candidate), false);
  assert.equal(policy.isCreateGateRelaxed(req, impact, proxy), false);
});
test("D3-S2a: the policy's S2a rule equals the producer's s2aSecretRuleRequiresUnknown (test-only producer import)", U17, () => {
  const corpus = ["\u017fecrets.json", "id_rsa.", "\u017fecrets.\u1fb3\u0301", "secrets.json", "SECRETS", "Id_Rsa", "credentials\u200b", ".ENV.local",
    "new.js", "secretary.md", "\u1fb3\u0301.txt", "credentialsHelper.ts", "service_accounts.json", "ID_ED25519", "\u0130d_rsa"];
  for (const redacted of [0, 1, 3]) {
    for (const name of corpus) {
      const expected = s2aSecretRuleRequiresUnknown(redacted, name) ? "unknown" : "absent";
      const f = newFixture([`src/${name}`]);
      withWitness(f, absenceWitness(f, [absentRecord(`src/${name}`, { entries: ["README.md"], redacted, verdict: expected })]));
      const out = pipeline(f);
      assert.ok(out.candidate, `${redacted} ${JSON.stringify(name)}: ${out.code}`);
      assert.equal(verdictsOf(out.candidate)[`src/${name}`], expected, `${redacted} ${JSON.stringify(name)}`);
    }
  }
  // Both key branches are present in the policy copy (no natural K-only / Kk-only SECRET split exists in the corpus).
  const source = readFileSync(new URL("../src/lib/effective-task-scope-policy.js", import.meta.url), "utf8");
  assert.match(source, /isContextSecretSegment\(nameKey\(basename\)\) \|\| isContextSecretSegment\(kernelModelNameKey\(basename\)\)/);
});
test("D3-P26c: the policy imports the shared D0 secret predicate and holds no secret literal", () => {
  const source = readFileSync(new URL("../src/lib/effective-task-scope-policy.js", import.meta.url), "utf8");
  assert.match(source, /import \{ isContextSecretSegment \} from "\.\/context-path-secret-policy\.js";/);
  assert.equal(/credentials\?|id_ed25519/.test(source), false);
});
// ---- D3-S2a-Kk (amend1 §E(iii), recommended): a module hook on the policy's ./create-name-key.js import forces a K-miss
// for one basename, so the S2a rule can only fire through its Kk disjunct; dropping that disjunct turns this RED. ----
const kkState = globalThis[Symbol.for("effective-task-scope-create.test.d3kk")] = { mode: "k-miss", forced: 0 };
const canonicalNameKeyUrl = new URL("../src/lib/create-name-key.js", import.meta.url).href;
const kkHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./create-name-key.js" && context.parentURL?.endsWith("?d3kk")) {
      const source = `import * as real from ${JSON.stringify(canonicalNameKeyUrl)};
        export * from ${JSON.stringify(canonicalNameKeyUrl)};
        const s = () => globalThis[Symbol.for("effective-task-scope-create.test.d3kk")];
        export function nameKey(name) { if (name === "secrets.json") { s().forced++; return "plain-k"; } return real.nameKey(name); }
        export function kernelModelNameKey(name) { if (name === "secrets.json" && s().mode === "both-miss") return "plain-kk"; return real.kernelModelNameKey(name); }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
let kkPolicy;
try {
  kkPolicy = await import(`${canonicalPolicyUrl}?d3kk`);
} finally {
  kkHook.deregister();
}
test("D3-S2a-Kk: K forced to miss, Kk hits -> unknown (S2a Kk disjunct); both forced to miss -> absent (control)", U17, () => {
  for (const [mode, expected] of [["k-miss", "unknown"], ["both-miss", "absent"]]) {
    kkState.mode = mode; kkState.forced = 0;
    const f = newFixture(["src/secrets.json"]);
    withWitness(f, absenceWitness(f, [absentRecord("src/secrets.json", { redacted: 1, verdict: expected })]));
    const { req, exterior } = exteriorOf(f);
    const data = kkPolicy.materializeBoundedJsonData(f.evidence);
    const normalized = kkPolicy.normalizeCreateDestinationAbsenceWitness(data.createDestinationAbsenceWitness);
    assert.equal(normalized.ok, true, mode);
    const candidate = kkPolicy.evaluateCreateDestinationAbsenceWitness(normalized.witness, exterior);
    assert.equal(candidate.ok, true, `${mode}: ${candidate.code}`);
    assert.equal(verdictsOf(candidate)["src/secrets.json"], expected, mode);
    assert.ok(kkState.forced > 0, `${mode}: the K stub was exercised`);
    const bound = kkPolicy.bindCreateIntent(req.operationIntent, req.task.paths, data.pack, data.impact, candidate);
    assert.equal(bound.notEvaluated === null ? bound.lift?.reason : bound.notEvaluated, expected === "unknown" ? NOT_PROVEN : LIFT, mode);
  }
});

// ---- Fix round (Tester a5 / c1 / c2 / i2, Reviewer N-2): direct binder and delete-bind gate behaviour ----
/** bindCreateIntent on a no-observation fixture with a synthetic evaluated candidate. */
function bindWith(paths, targets, extra = {}) {
  const f = newFixture(paths);
  const req = policy.normalizeEffectiveTaskScopeRequest(f.request, { allowCreateIntent: true });
  const data = policy.materializeBoundedJsonData(f.evidence);
  const out = policy.bindCreateIntent(req.operationIntent, req.task.paths, data.pack, data.impact,
    { ok: true, unicodeMismatch: false, targets, ...extra });
  return out.notEvaluated === null ? out.lift?.reason : out.notEvaluated;
}
const candidateTarget = (newPath, verdict) => ({ ...describe(newPath), verdict, witnessVerdict: verdict, entries: ["README.md"] });
test("D3 binder N-2: unicodeMismatch true with every candidate absent -> not proven (binder check on its own)", () => {
  assert.equal(bindWith(TWO, TWO.map(path => candidateTarget(path, "absent"))), LIFT);
  assert.equal(bindWith(TWO, TWO.map(path => candidateTarget(path, "absent")), { unicodeMismatch: true }), NOT_PROVEN);
  assert.equal(bindWith(TWO, TWO.map(path => candidateTarget(path, "absent")), { unicodeMismatch: undefined }), NOT_PROVEN);
});
test("D3 binder c1/c2: a missing record or non-record candidate entries -> not proven, never thrown, never lift", () => {
  const [a, b] = TWO;
  for (const [name, run] of [
    ["one declared path has no record", () => bindWith(TWO, [candidateTarget(a, "absent")])],
    ["no records", () => bindWith(TWO, [])],
    ["non-record entries beside an absent record", () => bindWith(TWO, [null, 7, "x", [], candidateTarget(a, "absent")])],
    ["non-record entry in place of a record", () => bindWith(TWO, [candidateTarget(a, "absent"), null])],
    ["record for an undeclared path", () => bindWith(TWO, [candidateTarget(a, "absent"), candidateTarget("src/zzz.js", "absent")])],
    ["targets not an array", () => bindWith(TWO, { [a]: candidateTarget(a, "absent"), [b]: candidateTarget(b, "absent") })]
  ]) {
    let code;
    assert.doesNotThrow(() => { code = run(); }, name);
    assert.equal(code, NOT_PROVEN, name);
  }
  for (const candidate of [null, [], "x", { ok: false, unicodeMismatch: false, targets: TWO.map(path => candidateTarget(path, "absent")) }]) {
    const f = newFixture(TWO);
    const req = policy.normalizeEffectiveTaskScopeRequest(f.request, { allowCreateIntent: true });
    const data = policy.materializeBoundedJsonData(f.evidence);
    const out = policy.bindCreateIntent(req.operationIntent, req.task.paths, data.pack, data.impact, candidate);
    assert.equal(out.notEvaluated, NOT_PROVEN, JSON.stringify(candidate));
  }
});
test("D3 binder i2: aggregation precedence EXISTS › parent_absent › ancestor_boundary › UNKNOWN › lift", () => {
  const [a, b] = TWO;
  for (const [va, vb, expected] of [
    ["exists", "parent_absent", "create_destination_exists"], ["parent_absent", "exists", "create_destination_exists"],
    ["exists", "ancestor_boundary", "create_destination_exists"], ["exists", "unknown", "create_destination_exists"],
    ["parent_absent", "ancestor_boundary", "create_parent_directory_absent"], ["ancestor_boundary", "parent_absent", "create_parent_directory_absent"],
    ["parent_absent", "unknown", "create_parent_directory_absent"],
    ["ancestor_boundary", "unknown", "create_ancestor_boundary"], ["unknown", "ancestor_boundary", "create_ancestor_boundary"],
    ["unknown", "absent", NOT_PROVEN], ["absent", "absent", LIFT]
  ]) {
    assert.equal(bindWith(TWO, [candidateTarget(a, va), candidateTarget(b, vb)]), expected, `${va} + ${vb}`);
  }
});
test("D3 a5: the delete-bind gate runs bindDeleteIntent for every non-lift intent kind and skips it only on a create lift", { ...U17 }, () => {
  try {
    const del = fixture(); del.request.operationIntent = { kind: "delete", targets: del.request.task.paths.map(oldPath => ({ oldPath, newPath: null })) };
    hookState.deleteBinds = []; hookedCompose(del.request, del.evidence);
    assert.deepEqual(hookState.deleteBinds, ["delete"]);
    // A kind other than create/delete reaching the gate (normalizer output overridden in the instrumented instance
    // only) must still be delete-bound: the gate is not a recognised-kind allow-list (amend1 §B.3, P2 rejected).
    hookState.intentKindOverride = "future_kind"; hookState.deleteBinds = [];
    const r = hookedCompose(del.request, del.evidence);
    assert.deepEqual(hookState.deleteBinds, ["future_kind"]);
    assert.equal(JSON.stringify(r).includes("explicit_create_intent"), false);
    hookState.intentKindOverride = null;
    const lift = newFixture(TWO); withWitness(lift, allAbsent(lift));
    hookState.deleteBinds = []; const liftOut = hookedCompose(lift.request, lift.evidence);
    assert.equal(liftOut.status, "incomplete"); assert.deepEqual(hookState.deleteBinds, []);
    const notProven = newFixture(TWO);
    hookState.deleteBinds = []; const npOut = hookedCompose(notProven.request, notProven.evidence);
    assert.equal(npOut.status, "not_evaluated"); assert.deepEqual(hookState.deleteBinds, []);
  } finally { hookState.intentKindOverride = null; hookState.deleteBinds = []; }
});
