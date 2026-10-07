import test from "node:test";
import assert from "node:assert/strict";
import { composeEffectiveTaskScope as compose } from "../src/lib/effective-task-scope.js";

// Synthetic consistency fixtures only; not authenticated/live observations.
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
function terminal(f, status, code) {
  const r = run(f);
  assert.equal(r.status, status);
  assert.ok(r.reasons.some(reason => reason.code === code), JSON.stringify(r));
  for (const key of ["write", "reserved", "watch", "impact", "operationIntent"]) assert.equal(Object.hasOwn(r, key), false);
  return r;
}

test("create: source-bound explicit WRITE; every retained effect WATCH, no FS create or expansion", () => {
  const f = fixture(); const before = JSON.stringify(f); const r = run(f);
  assert.equal(r.status, "incomplete"); assert.equal(r.policyVersion, "step4-foundation-3");
  assert.deepEqual(r.write.items.map(i => i.target.path), f.request.task.paths);
  assert.ok(r.write.items.every(i => i.ruleIds.includes("explicit_create_intent")));
  assert.ok(r.write.items.every(i => i.target.kind === "file"));
  assert.deepEqual(r.watch.items.map(i => i.target.path), ["src/far.js"]);
  assert.ok(r.watch.items[0].ruleIds.includes("create_intent_awareness"));
  assert.deepEqual(r.impact.items, []); assert.deepEqual(r.reserved.items, []);
  assert.equal(r.reserved.status, "not_evaluated");
  const op = r.operationIntent;
  assert.equal(op.kind, "create");
  assert.equal(op.provenance, "task_declaration");
  assert.deepEqual(op.targets, f.request.operationIntent.targets);
  assert.deepEqual(op.evidence.sources[0], { newPath: "src/a.js", context: {
    source: { path: "src/a.js", sha256: "e".repeat(64) }, trust: "canonical_fact", reason: "task_path" },
    impact: { path: "src/a.js", hash: "e".repeat(64) } });
  assert.ok(r.completeness.resolver.some(reason => reason.startsWith("create_context_section_")));
  assert.equal(JSON.stringify(f), before);
});

for (const intent of [
  { kind: "create", targets: [] },
  { kind: "create", targets: [{ oldPath: null }] },
  { kind: "create", targets: [{ newPath: "src/a.js" }] },
  { kind: "create", targets: [{ oldPath: "src/a.js", newPath: "src/a.js" }] },
  { kind: "create", targets: [{ oldPath: null, newPath: null }] },
  { kind: "create", targets: [{ oldPath: null, newPath: "src/a.js", exists: true }] },
  { kind: "create", targets: [{ oldPath: null, newPath: "src/a.js" }], source: true }
]) {
  test(`create: malformed declaration ${JSON.stringify(intent)} rejected`, () => {
    const f = fixture(); f.request.operationIntent = intent;
    terminal(f, "rejected", "invalid_create_intent");
  });
}

test("create: rename kind remains out of scope (delete-path refuse)", () => {
  const f = fixture();
  f.request.operationIntent = { kind: "rename", targets: [{ oldPath: "src/a.js", newPath: "src/b.js" }] };
  terminal(f, "rejected", "invalid_delete_intent");
});

for (const path of ["../a", "/a", " src/a.js", "src//a.js", "src/./a.js", "src/a.js/", "src/*.js", "C:/a", "src\\a.js", "src/a.js\n"]) {
  test(`create: literal spelling rejected ${JSON.stringify(path)}`, () => {
    const f = fixture(); f.request.operationIntent.targets[0].newPath = path;
    terminal(f, "rejected", "invalid_create_intent");
  });
}

test("create: declaration set equality mismatch rejected", () => {
  for (const paths of [["src/a.js"], ["src/a.js", "src/unlisted.js"]]) {
    const f = fixture();
    f.request.operationIntent.targets = paths.map(newPath => ({ oldPath: null, newPath }));
    terminal(f, "rejected", "create_intent_target_mismatch");
  }
});

for (const [name, mutate, status, code] of [
  ["missing file", f => f.evidence.pack.sections.files.items.pop(), "not_evaluated", "create_source_not_evaluated"],
  ["null target source", f => f.evidence.impact.targets[1].targetSource = null, "not_evaluated", "create_source_not_evaluated"],
  ["unevaluated target", f => f.evidence.impact.targets[1].findingState = "not_evaluated", "not_evaluated", "create_target_not_evaluated"],
  ["wrong hash", f => f.evidence.impact.targets[0].targetSource.hash = "f".repeat(64), "rejected", "create_source_binding_mismatch"],
  ["stale", f => f.request.expectedRevision.commitSha = "f".repeat(40), "stale", "revision_observation_differs"]
]) test(`create: ${name} fails closed`, () => { const f = fixture(); mutate(f); terminal(f, status, code); });

test("create: no filesystem side effects from classification", () => {
  const f = fixture();
  const before = JSON.stringify(f);
  const r = run(f);
  assert.ok(r.write);
  assert.equal(JSON.stringify(f), before);
});
