import test from "node:test";
import assert from "node:assert/strict";

import { analyzeMultiFileReverseImpact, analyzeSingleFileReverseImpact } from "../src/lib/impact-traversal.js";
import { IMPACT_LIMITS, normalizeImpactRequest, validateCompletedAffectedItem } from "../src/lib/impact-policy.js";
import { createProviderSnapshot, normalizeProviderDescriptor } from "../src/analyzers/common/analyzer-provider-contract.js";
import { analyzeProviderSnapshot } from "../src/analyzers/common/analyzer-providers.js";

function capabilities(overrides = {}) {
  return {
    boundedSourceAnalysis: "structural",
    definitions: "structural",
    dependencies: "structural",
    detection: "structural",
    diagnostics: "structural",
    implementations: "structural",
    references: "structural",
    symbols: "structural",
    ...overrides
  };
}

const nativeProvider = normalizeProviderDescriptor({ id: "native.typescript", version: "1", kind: "native", priority: 190, languages: ["typescript", "javascript"], capabilities: capabilities() });
const dotnetProvider = normalizeProviderDescriptor({ id: "native.dotnet", version: "1", kind: "native", priority: 200, languages: ["csharp"], capabilities: capabilities() });
const pythonProvider = normalizeProviderDescriptor({ id: "external.serena-python", version: "1-f8f53b77-pyright-1.1.403", kind: "external", priority: 90, languages: ["python"], capabilities: capabilities({ dependencies: "unsupported", references: "semantic" }) });

function sources(paths) {
  return paths.map((path) => ({ path, text: `// ${path}\nexport const marker = 1;\n` }));
}

function node(id, file) {
  return { id, label: id, kind: "function", file, line: 1 };
}

function edge(from, to, relation = "imports", location) {
  return { from, to, relation, ...(location ? { location } : {}) };
}

function graph({ provider = nativeProvider, nodes = [], edges = [], status = "available", limited = false, uncovered = [], sourcePaths, sourceFiles } = {}) {
  const paths = sourcePaths ?? sourceFiles?.map((file) => file.path) ?? [...new Set(nodes.map((n) => n.file))].sort();
  const snapshot = createProviderSnapshot({ projectId: "Prj_Impact" }, sourceFiles ?? sources(paths), { status: "available", commitSha: "a".repeat(40), worktreeId: "wt_one" });
  const observed = snapshot.languages;
  const covered = observed.filter((language) => provider?.languages?.includes(language) && !uncovered.includes(language));
  return {
    schemaVersion: 1,
    success: !["unsupported", "unavailable"].includes(status),
    status,
    provider: ["unsupported", "unavailable"].includes(status) ? null : provider,
    snapshotToken: snapshot.token,
    snapshot,
    coverage: { observed, covered, uncovered },
    attempts: [],
    nodes,
    edges,
    definitions: [],
    implementations: [],
    diagnostics: [],
    limited
  };
}

function pathsOf(result) {
  return result.affectedFiles.map((item) => `${item.path}:${item.origins[0].minimumDistance}`);
}

test("traverses reverse dependencies from referenced dependency to consumers only", () => {
  const result = analyzeSingleFileReverseImpact({
    originPath: "src/service.js",
    sourceFiles: sources(["src/service.js", "src/app.js", "src/dep.js"]),
    graph: graph({
      nodes: [node("service", "src/service.js"), node("app", "src/app.js"), node("dep", "src/dep.js")],
      edges: [edge("app", "service", "imports", { path: "src/app.js", line: 1, column: 10 }), edge("service", "dep", "imports")]
    })
  });
  assert.equal(result.findingState, "evidence_found");
  assert.deepEqual(pathsOf(result), ["src/app.js:1"]);
  assert.equal(result.affectedFiles[0].origins[0].witness.capability, "dependencies");
  assert.equal(result.affectedFiles[0].origins[0].witness.source.path, "src/app.js");
  assert.deepEqual(result.completeness, { source: [], provider: [], traversal: [], output: [] });
  validateCompletedAffectedItem(result.affectedFiles[0]);
});

test("terminates cycles and keeps same-file relationships at zero file hops", () => {
  const result = analyzeSingleFileReverseImpact({
    originPath: "src/a.js",
    sourceFiles: sources(["src/a.js", "src/b.js"]),
    graph: graph({
      nodes: [node("a", "src/a.js"), node("local", "src/a.js"), node("b", "src/b.js")],
      edges: [edge("local", "a", "references"), edge("b", "local", "references"), edge("a", "b", "references")]
    })
  });
  assert.deepEqual(pathsOf(result), ["src/a.js:0", "src/b.js:1"]);
  assert.equal(result.affectedFiles[0].origins[0].witness.capability, "references");
});

test("retains minimum file-hop distance across alternate paths", () => {
  const result = analyzeSingleFileReverseImpact({
    originPath: "src/origin.js",
    sourceFiles: sources(["src/origin.js", "src/mid.js", "src/consumer.js"]),
    graph: graph({
      nodes: [node("origin", "src/origin.js"), node("mid", "src/mid.js"), node("consumer", "src/consumer.js")],
      edges: [edge("mid", "origin"), edge("consumer", "mid"), edge("consumer", "origin")]
    })
  });
  assert.deepEqual(pathsOf(result), ["src/consumer.js:1", "src/mid.js:1"]);
});

test("is deterministic under shuffled graph input and chooses stable witnesses", () => {
  const nodes = [node("origin", "src/origin.js"), node("a", "src/a.js"), node("z", "src/z.js")];
  const edges = [edge("z", "origin", "references"), edge("a", "origin", "imports")];
  const first = analyzeSingleFileReverseImpact({ originPath: "src/origin.js", sourceFiles: sources(["src/origin.js", "src/a.js", "src/z.js"]), graph: graph({ nodes, edges }) });
  const second = analyzeSingleFileReverseImpact({ originPath: "src/origin.js", sourceFiles: sources(["src/z.js", "src/a.js", "src/origin.js"]), graph: graph({ nodes: [...nodes].reverse(), edges: [...edges].reverse() }) });
  assert.deepEqual(first.affectedFiles, second.affectedFiles);
  assert.deepEqual(pathsOf(first), ["src/a.js:1", "src/z.js:1"]);
});

test("depth zero observes target without propagating and default/max depth obey policy", () => {
  const chainNodes = [node("n0", "f0.js"), node("n1", "f1.js"), node("n2", "f2.js"), node("n3", "f3.js"), node("n4", "f4.js"), node("n5", "f5.js")];
  const chainEdges = [edge("n1", "n0"), edge("n2", "n1"), edge("n3", "n2"), edge("n4", "n3"), edge("n5", "n4")];
  const base = { originPath: "f0.js", sourceFiles: sources(chainNodes.map((n) => n.file)), graph: graph({ nodes: chainNodes, edges: chainEdges }) };
  assert.deepEqual(analyzeSingleFileReverseImpact({ ...base, limits: { depth: 0 } }).affectedFiles, []);
  assert.deepEqual(pathsOf(analyzeSingleFileReverseImpact(base)), ["f1.js:1", "f2.js:2"]);
  assert.equal(IMPACT_LIMITS.depth.max, 5);
  assert.deepEqual(pathsOf(analyzeSingleFileReverseImpact({ ...base, limits: { depth: 5 } })), ["f1.js:1", "f2.js:2", "f3.js:3", "f4.js:4", "f5.js:5"]);
});

test("distinguishes exact depth boundary from known eligible evidence beyond it", () => {
  const exact = analyzeSingleFileReverseImpact({
    originPath: "a.js",
    sourceFiles: sources(["a.js", "b.js"]),
    graph: graph({ nodes: [node("a", "a.js"), node("b", "b.js")], edges: [edge("b", "a")] }),
    limits: { depth: 1 }
  });
  assert.deepEqual(exact.completeness.traversal, []);
  const beyond = analyzeSingleFileReverseImpact({
    originPath: "a.js",
    sourceFiles: sources(["a.js", "b.js", "c.js"]),
    graph: graph({ nodes: [node("a", "a.js"), node("b", "b.js"), node("c", "c.js")], edges: [edge("b", "a"), edge("c", "b")] }),
    limits: { depth: 1 }
  });
  assert.deepEqual(beyond.completeness.traversal, ["depth_limit"]);
  assert.deepEqual(pathsOf(beyond), ["b.js:1"]);
});

test("separately reports visited-state and edge-examination work exhaustion", () => {
  const stateLimited = analyzeSingleFileReverseImpact({
    originPath: "a.js",
    sourceFiles: sources(["a.js", "b.js"]),
    graph: graph({ nodes: [node("a", "a.js"), node("b", "b.js")], edges: [edge("b", "a")] }),
    limits: { traversalVisitedStates: 1 }
  });
  assert.deepEqual(stateLimited.completeness.traversal, ["traversal_work_limit"]);
  const edgeLimited = analyzeSingleFileReverseImpact({
    originPath: "a.js",
    sourceFiles: sources(["a.js", "b.js", "c.js"]),
    graph: graph({ nodes: [node("a", "a.js"), node("b", "b.js"), node("c", "c.js")], edges: [edge("b", "a"), edge("c", "a")] }),
    limits: { traversalEdgeExaminations: 1 }
  });
  assert.deepEqual(edgeLimited.completeness.traversal, ["traversal_work_limit"]);
  const zeroBudgetRejected = () => analyzeSingleFileReverseImpact({ originPath: "a.js", sourceFiles: sources(["a.js"]), graph: graph(), limits: { traversalEdgeExaminations: 0 } });
  assert.throws(zeroBudgetRejected, { code: "invalid_impact_request" });
});

test("preserves nullable locations without fabrication", () => {
  const result = analyzeSingleFileReverseImpact({
    originPath: "dep.js",
    sourceFiles: sources(["dep.js", "consumer.js"]),
    graph: graph({ nodes: [node("dep", "dep.js"), node("consumer", "consumer.js")], edges: [edge("consumer", "dep")] })
  });
  assert.equal(result.affectedFiles[0].origins[0].witness.location, null);
});

test("handles partial, unsupported, unavailable and empty partial provider results honestly", () => {
  const partialEmpty = analyzeSingleFileReverseImpact({ originPath: "one.py", sourceFiles: sources(["one.py"]), graph: graph({ status: "partial", limited: true, uncovered: ["python"], sourcePaths: ["one.py"] }) });
  assert.equal(partialEmpty.status, "partial");
  assert.equal(partialEmpty.findingState, "not_evaluated");
  assert.deepEqual(partialEmpty.affectedFiles, []);
  assert.deepEqual(partialEmpty.completeness.provider, ["provider_partial", "uncovered_language"]);

  for (const status of ["unsupported", "unavailable"]) {
    const result = analyzeSingleFileReverseImpact({ originPath: "one.py", sourceFiles: sources(["one.py"]), graph: graph({ status, sourcePaths: ["one.py"] }) });
    assert.equal(result.status, status);
    assert.equal(result.findingState, "not_evaluated");
    assert.deepEqual(result.affectedFiles, []);
  }
});

test("supports native JS/TS, native .NET and external Python reference fixtures with correct trust and basis labels", () => {
  const js = analyzeSingleFileReverseImpact({ originPath: "service.ts", sourceFiles: sources(["service.ts", "app.ts"]), graph: graph({ provider: nativeProvider, nodes: [node("service", "service.ts"), node("app", "app.ts")], edges: [edge("app", "service", "imports")] }) });
  assert.equal(js.affectedFiles[0].origins[0].witness.trust, "derived_analysis");
  assert.equal(js.affectedFiles[0].origins[0].witness.basis, "structural");

  const cs = analyzeSingleFileReverseImpact({ originPath: "IService.cs", sourceFiles: sources(["IService.cs", "Controller.cs"]), graph: graph({ provider: dotnetProvider, nodes: [node("service", "IService.cs"), node("controller", "Controller.cs")], edges: [edge("controller", "service", "references")] }) });
  assert.equal(cs.provider.id, "native.dotnet");
  assert.equal(cs.affectedFiles[0].origins[0].witness.capability, "references");

  const py = analyzeSingleFileReverseImpact({ originPath: "models.py", sourceFiles: sources(["models.py", "usage.py"]), graph: graph({ provider: pythonProvider, nodes: [node("greet", "models.py"), node("caller", "usage.py")], edges: [edge("caller", "greet", "references", { path: "usage.py", line: 2, column: 12 })] }) });
  const witness = py.affectedFiles[0].origins[0].witness;
  assert.equal(witness.trust, "untrusted_external_analysis");
  assert.equal(witness.basis, "semantic");
  assert.equal(witness.relationshipKind, "references");
  assert.notEqual(witness.relationshipKind, "calls");
});

test("distinguishes absent targets from observed symbol-free targets", () => {
  const absent = analyzeSingleFileReverseImpact({ originPath: "absent.js", sourceFiles: sources(["other.js"]), graph: graph({ nodes: [node("other", "other.js")], edges: [] }) });
  assert.equal(absent.findingState, "not_evaluated");
  assert.deepEqual(absent.completeness.source, ["source_unavailable"]);
  const symbolFree = analyzeSingleFileReverseImpact({ originPath: "empty.js", sourceFiles: sources(["empty.js"]), graph: graph({ nodes: [], edges: [], sourcePaths: ["empty.js"] }) });
  assert.equal(symbolFree.findingState, "no_evidence_found");
  assert.deepEqual(symbolFree.affectedFiles, []);
});

test("binds witness provenance to the supplied snapshot envelope", () => {
  const boundGraph = graph({ nodes: [node("origin", "origin.js"), node("consumer", "consumer.js")], edges: [edge("consumer", "origin", "references")] });
  const result = analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: boundGraph.snapshot.files, graph: boundGraph });
  assert.equal(result.snapshotToken, boundGraph.snapshot.token);
  assert.deepEqual(result.revision, boundGraph.snapshot.revision);
  assert.deepEqual(result.worktree, { worktreeId: "wt_one" });
  assert.equal(result.affectedFiles[0].origins[0].witness.source.path, "consumer.js");
  assert.notEqual(result.affectedFiles[0].origins[0].witness.source.hash, "unknown");

  const mutatedContent = { ...boundGraph.snapshot, files: boundGraph.snapshot.files.map((file) => file.path === "consumer.js" ? { ...file, text: "export const stale = 1;\n" } : file) };
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, snapshot: mutatedContent } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, snapshot: { ...boundGraph.snapshot, projectId: "Other_Project" } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, snapshot: { ...boundGraph.snapshot, revision: { ...boundGraph.snapshot.revision, worktreeId: "wt_two" } } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js", "consumer.js"]).map((file) => file.path === "consumer.js" ? { ...file, text: "// stale\n" } : file), graph: boundGraph }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, snapshotToken: "snap-stale" } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, projectId: "Other_Project", snapshot: { ...boundGraph.snapshot, projectId: "Project_One" } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, revision: { commitSha: "a".repeat(40) }, snapshot: { ...boundGraph.snapshot, revision: { commitSha: "b".repeat(40) } } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, worktree: { id: "one" }, snapshot: { ...boundGraph.snapshot, worktree: { id: "two" } } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, snapshot: { ...boundGraph.snapshot, files: boundGraph.snapshot.files.filter((file) => file.path !== "consumer.js") } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, edges: [edge("consumer", "origin", "references", { path: "missing.js", line: 1, column: 1 })] } }), { code: "invalid_impact_traversal" });
});

test("validates optional source identity independently for text and hash records", () => {
  const boundGraph = graph({ nodes: [node("origin", "origin.js"), node("consumer", "consumer.js")], edges: [edge("consumer", "origin", "references")] });
  const [consumer, origin] = boundGraph.snapshot.files;
  const run = (sourceFiles) => analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles, graph: boundGraph });
  const invalid = (sourceFiles) => assert.throws(() => run(sourceFiles), { code: "invalid_impact_traversal" });

  assert.equal(run(boundGraph.snapshot.files).findingState, "evidence_found");
  assert.equal(run(boundGraph.snapshot.files.map(({ path, sha256 }) => ({ path, sha256 }))).findingState, "evidence_found");
  assert.equal(run([{ path: consumer.path, sha256: consumer.sha256 }, { path: origin.path, text: origin.text, sha256: origin.sha256 }]).findingState, "evidence_found");
  assert.equal(run([{ path: origin.path, text: origin.text }, { path: consumer.path, hash: consumer.sha256 }]).findingState, "evidence_found");

  invalid([{ path: consumer.path, sha256: consumer.sha256 }, { path: origin.path, text: "// stale\n", sha256: origin.sha256 }]);
  invalid([{ path: origin.path, text: "// stale\n" }, { path: consumer.path, sha256: consumer.sha256 }]);
  invalid([{ path: consumer.path, sha256: consumer.sha256 }, { path: origin.path, text: 1, sha256: origin.sha256 }]);
  invalid([{ path: origin.path, text: origin.text, sha256: consumer.sha256 }, { path: consumer.path, sha256: consumer.sha256 }]);
  invalid([{ path: origin.path, text: origin.text, sha256: origin.sha256, hash: consumer.sha256 }, { path: consumer.path, sha256: consumer.sha256 }]);
  invalid([{ path: origin.path, sha256: "0".repeat(64) }, { path: consumer.path, sha256: consumer.sha256 }]);
  invalid([{ path: origin.path, text: "// stale\n" }, { path: consumer.path, text: consumer.text }]);
  invalid([{ path: origin.path, sha256: origin.sha256 }, { path: consumer.path, sha256: "0".repeat(64) }]);
  invalid([{ path: origin.path, sha256: origin.sha256 }, { path: origin.path, sha256: origin.sha256 }, { path: consumer.path, sha256: consumer.sha256 }]);
  invalid([{ path: origin.path, sha256: origin.sha256 }]);
  invalid([{ path: origin.path, sha256: origin.sha256 }, { path: consumer.path, sha256: consumer.sha256 }, { path: "extra.js", sha256: "0".repeat(64) }]);
});

test("requires exact optional source identities in text, hash-only and mixed modes", () => {
  const boundGraph = graph({ nodes: [node("origin", "origin.js"), node("consumer", "a.js")], edges: [edge("consumer", "origin", "references", { path: "a.js", line: 1, column: 1 })] });
  const byPath = new Map(boundGraph.snapshot.files.map((source) => [source.path, source]));
  const origin = byPath.get("origin.js");
  const canonical = byPath.get("a.js");
  const run = (sourceFiles) => analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles, graph: boundGraph });
  const invalid = (sourceFiles) => assert.throws(() => run(sourceFiles), { code: "invalid_impact_traversal" });

  const result = run([
    { path: "origin.js", text: origin.text },
    { path: "a.js", sha256: canonical.sha256 }
  ]);
  const item = result.affectedFiles[0];
  const witness = item.origins[0].witness;
  assert.equal(item.path, "a.js");
  assert.equal(item.origins[0].originPath, "origin.js");
  assert.equal(witness.source.path, "a.js");
  assert.equal(witness.source.hash, canonical.sha256);
  assert.deepEqual(witness.location, { path: "a.js", line: 1, column: 1 });

  for (const alias of ["a.js/", " a.js", "a.js ", "./a.js"]) {
    const aliasedText = { path: alias, text: canonical.text };
    const aliasedHash = { path: alias, sha256: canonical.sha256 };
    invalid([{ path: origin.path, sha256: origin.sha256 }, aliasedText]);
    invalid([{ path: origin.path, sha256: origin.sha256 }, aliasedHash]);
    invalid([{ path: origin.path, text: origin.text }, aliasedHash]);
    invalid([aliasedHash, { path: origin.path, text: origin.text }]);
  }
});

test("requires exact graph node and explicit location identities before traversal", () => {
  const base = graph({
    sourcePaths: ["origin.js", "a.js", "other.js"],
    nodes: [node("origin", "origin.js"), node("consumer", "a.js"), node("other", "other.js")],
    edges: [edge("consumer", "origin", "references", { path: "a.js", line: 1, column: 1 })]
  });
  const run = (patch, limits) => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...base, ...patch }, ...(limits ? { limits } : {}) });
  const invalid = (patch, limits) => assert.throws(() => run(patch, limits), { code: "invalid_impact_traversal" });

  for (const alias of ["a.js/", " a.js", "a.js ", "./a.js"]) {
    const originAlias = alias.replace("a.js", "origin.js");
    invalid({ nodes: [node("origin", "origin.js"), node("consumer", alias)], edges: [edge("consumer", "origin", "references", { path: "other.js", line: 1, column: 1 })] });
    invalid({ nodes: [node("origin", originAlias), node("consumer", "a.js")] });
    invalid({ edges: [edge("consumer", "origin", "references", { path: alias, line: 1, column: 1 })] });
    invalid({ nodes: [...base.nodes, node("disconnected", alias)] }, { depth: 0 });
    invalid({ edges: [...base.edges, edge("other", "consumer", "references", { path: alias, line: 1, column: 1 })] }, { depth: 0, traversalEdgeExaminations: 1 });
  }

  const canonical = run({ edges: [base.edges[0], base.edges[0]] });
  assert.deepEqual(pathsOf(canonical), ["a.js:1"]);
  assert.equal(canonical.affectedFiles[0].origins[0].witness.source.path, "a.js");
});

test("rejects evidence aliases without changing request path normalization", () => {
  const nested = graph({
    sourcePaths: ["origin.js", "dir/a.js"],
    nodes: [node("origin", "origin.js"), node("consumer", "dir/a.js")],
    edges: [edge("consumer", "origin", "references")]
  });
  assert.deepEqual(normalizeImpactRequest({ paths: [" dir\\a.js/ "] }).paths, ["dir/a.js"]);
  assert.throws(() => normalizeImpactRequest({ paths: ["./a.js"] }), { code: "invalid_impact_request" });
  assert.throws(() => analyzeSingleFileReverseImpact({
    originPath: "origin.js",
    graph: { ...nested, nodes: [node("origin", "origin.js"), node("consumer", "dir\\a.js")] }
  }), { code: "invalid_impact_traversal" });
  for (const alias of ["dir/a.js/", "dir/a.js\\", "dir//a.js", "dir/./a.js", "dir/../a.js", "DIR/a.js", "dir/%61.js"]) {
    assert.throws(() => analyzeSingleFileReverseImpact({
      originPath: "origin.js",
      graph: { ...nested, nodes: [node("origin", "origin.js"), node("consumer", alias)] }
    }), { code: "invalid_impact_traversal" });
  }
});

test("preserves exact valid evidence spellings and deterministic identity failures", () => {
  const exactPaths = ["origin.js", "Dir/Case.js", "nested/internal space.js", "unicode/ä.js"];
  const exactNodes = [node("origin", exactPaths[0]), ...exactPaths.slice(1).map((file, index) => node(`consumer${index}`, file))];
  const exactEdges = exactNodes.slice(1).map((consumer) => edge(consumer.id, "origin", "references", { path: consumer.file, line: 1, column: 1 }));
  const exact = analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ sourcePaths: exactPaths, nodes: exactNodes, edges: exactEdges }) });
  assert.deepEqual(exact.affectedFiles.map((item) => item.path).sort(), exactPaths.slice(1).sort());
  for (const item of exact.affectedFiles) {
    assert.equal(item.origins[0].witness.source.path, item.path);
    assert.equal(item.origins[0].witness.location.path, item.path);
  }

  const boundGraph = graph({ nodes: [node("origin", "origin.js"), node("consumer", "a.js")], edges: [edge("consumer", "origin")] });
  const [a, origin] = boundGraph.snapshot.files;
  const invalid = (sourceFiles) => assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles, graph: boundGraph }), { code: "invalid_impact_traversal" });
  for (const records of [
    [{ path: origin.path, sha256: origin.sha256 }],
    [{ path: origin.path, sha256: origin.sha256 }, { path: a.path, sha256: a.sha256 }, { path: "extra.js", sha256: a.sha256 }],
    [{ path: a.path, sha256: a.sha256 }, { path: a.path, sha256: a.sha256 }, { path: origin.path, sha256: origin.sha256 }]
  ]) {
    invalid(records);
    invalid([...records].reverse());
  }
});

test("gates no-evidence on supported capabilities and target coverage", () => {
  const symbolsOnly = normalizeProviderDescriptor({ ...nativeProvider, capabilities: capabilities({ dependencies: "unsupported", references: "unsupported" }) });
  const unsupported = analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js"]), graph: graph({ provider: symbolsOnly, sourcePaths: ["origin.js"] }) });
  assert.equal(unsupported.findingState, "not_evaluated");
  assert.deepEqual(unsupported.completeness.provider, ["provider_unsupported"]);

  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js", "consumer.js"]), graph: graph({ provider: normalizeProviderDescriptor({ ...nativeProvider, capabilities: capabilities({ references: "unsupported" }) }), nodes: [node("origin", "origin.js"), node("consumer", "consumer.js")], edges: [edge("consumer", "origin", "references")] }) }), { code: "invalid_impact_traversal" });

  const uncovered = analyzeSingleFileReverseImpact({ originPath: "one.py", sourceFiles: sources(["one.py"]), graph: graph({ provider: pythonProvider, uncovered: ["python"], sourcePaths: ["one.py"] }) });
  assert.equal(uncovered.findingState, "not_evaluated");
  assert.deepEqual(uncovered.completeness.provider, ["uncovered_language"]);

  for (const target of ["target.go", "target.rs", "Target.java", "script.sh", "build.ps1", "ONE.PY", "README.md"]) {
    const result = analyzeSingleFileReverseImpact({ originPath: target, graph: graph({ sourcePaths: ["origin.js", target] }) });
    assert.equal(result.findingState, "not_evaluated", target);
    assert(result.completeness.provider.includes("uncovered_language"), target);
  }
  const uncoveredUpperTs = analyzeSingleFileReverseImpact({ originPath: "APP.TS", graph: graph({ provider: pythonProvider, sourcePaths: ["origin.py", "APP.TS"] }) });
  assert.equal(uncoveredUpperTs.findingState, "not_evaluated");
  assert(uncoveredUpperTs.completeness.provider.includes("uncovered_language"));

  const mixedFiles = [
    { path: "origin.js", text: "export const origin = 1;\n" },
    { path: "target.go", text: "package main\n" },
    { path: "TARGET.PY", text: "def target():\n    return 1\n" }
  ];
  const mixedGraph = analyzeProviderSnapshot({ projectId: "Prj_Impact" }, mixedFiles, { revision: { status: "not_git" } });
  for (const target of ["target.go", "TARGET.PY"]) {
    const result = analyzeSingleFileReverseImpact({ originPath: target, snapshot: createProviderSnapshot({ projectId: "Prj_Impact" }, mixedFiles, { status: "not_git" }), graph: mixedGraph });
    assert.equal(result.findingState, "not_evaluated", target);
    assert(result.completeness.provider.includes("uncovered_language"), target);
  }
});

test("uses normalized capability defaults for eligibility, edges and witnesses", () => {
  const rawProvider = (operation, level, explicitNull = false) => ({
    id: "native.raw",
    version: "1",
    kind: "native",
    priority: 100,
    languages: ["javascript"],
    capabilities: {
      boundedSourceAnalysis: "structural",
      symbols: "structural",
      ...(operation ? { [operation]: level } : {}),
      ...(explicitNull ? { dependencies: null, references: null } : {})
    }
  });
  for (const provider of [rawProvider(), rawProvider(null, null, true)]) {
    const result = analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ provider, sourcePaths: ["origin.js"] }) });
    assert.equal(result.findingState, "not_evaluated");
    assert.deepEqual(result.completeness.provider, ["provider_unsupported"]);
    assert.deepEqual(result.provider, { id: "native.raw", version: "1" });
  }

  for (const [supportedOperation, supportedRelation, unsupportedRelation] of [
    ["dependencies", "imports", "references"],
    ["references", "references", "imports"]
  ]) {
    const provider = rawProvider(supportedOperation, "semantic");
    const nodes = [node("origin", "origin.js"), node("consumer", "consumer.js")];
    const valid = analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ provider, nodes, edges: [edge("consumer", "origin", supportedRelation)] }) });
    assert.equal(valid.findingState, "evidence_found");
    assert.equal(valid.affectedFiles[0].origins[0].witness.capability, supportedOperation);
    assert.equal(valid.affectedFiles[0].origins[0].witness.basis, "semantic");
    assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ provider, nodes, edges: [edge("consumer", "origin", unsupportedRelation)] }) }), { code: "invalid_impact_traversal" });
  }

  const dependencyProvider = rawProvider("dependencies", "structural");
  const nullReferences = { ...dependencyProvider, capabilities: { ...dependencyProvider.capabilities, references: null } };
  const nodes = [node("origin", "origin.js"), node("consumer", "consumer.js")];
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ provider: nullReferences, nodes, edges: [edge("consumer", "origin", "references")] }) }), { code: "invalid_impact_traversal" });
  const referenceProvider = rawProvider("references", "structural");
  const nullDependencies = { ...referenceProvider, capabilities: { ...referenceProvider.capabilities, dependencies: null } };
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ provider: nullDependencies, nodes, edges: [edge("consumer", "origin", "imports")] }) }), { code: "invalid_impact_traversal" });
  const validControl = analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ provider: nativeProvider, nodes, edges: [edge("consumer", "origin", "references")] }) });
  assert.equal(validControl.findingState, "evidence_found");
});

test("binds graph node files and UTF-16 positions to observed sources", () => {
  const unicodeLine = "const face = \"😀\";";
  const sourceFiles = [
    { path: "origin.js", text: "export const origin = 1;\n" },
    { path: "consumer.js", text: `${unicodeLine}\nuse(origin);\n` },
    { path: "reference.js", text: "origin;\n" }
  ];
  const nodes = [node("origin", "origin.js"), { ...node("consumer", "consumer.js"), line: 2 }];
  const base = graph({ sourceFiles, nodes, edges: [edge("consumer", "origin", "references")] });
  const run = (patch) => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...base, ...patch } });
  const invalid = (patch) => assert.throws(() => run(patch), { code: "invalid_impact_traversal" });

  for (const location of [undefined, { path: "origin.js", line: 1, column: 1 }]) {
    invalid({ nodes: [node("origin", "origin.js"), { ...node("consumer", "consumer.js"), file: "absent.js" }], edges: [edge("consumer", "origin", "references", location)] });
  }
  for (const line of [0, 4, "1", {}, 1n, Number.MAX_SAFE_INTEGER + 1]) {
    invalid({ nodes: [node("origin", "origin.js"), { ...node("consumer", "consumer.js"), line }] });
  }
  for (const location of [
    { path: "consumer.js", line: 0, column: 1 },
    { path: "consumer.js", line: 4, column: 1 },
    { path: "consumer.js", line: 1, column: 0 },
    { path: "consumer.js", line: 1, column: unicodeLine.length + 2 },
    { path: "consumer.js", line: 1n, column: 1 },
    { path: "consumer.js", line: 1, column: Number.MAX_SAFE_INTEGER + 1 }
  ]) invalid({ edges: [edge("consumer", "origin", "references", location)] });

  const boundary = run({ edges: [edge("consumer", "origin", "references", { path: "consumer.js", line: 1, column: unicodeLine.length + 1 })] });
  assert.equal(boundary.affectedFiles[0].origins[0].witness.location.column, unicodeLine.length + 1);
  const nullable = run({ nodes: [node("origin", "origin.js"), { ...node("consumer", "consumer.js"), line: null }], edges: [edge("consumer", "origin", "references")] });
  assert.equal(nullable.affectedFiles[0].origins[0].witness.location, null);
  const perReferenceSource = run({ edges: [edge("consumer", "origin", "references", { path: "reference.js", line: 1, column: 7 })] });
  assert.equal(perReferenceSource.affectedFiles[0].path, "consumer.js");
  assert.equal(perReferenceSource.affectedFiles[0].origins[0].witness.source.path, "reference.js");
});

test("budgets seed admission under the visited-state limit", () => {
  const originSymbols = [node("o1", "origin.js"), node("o2", "origin.js"), node("o3", "origin.js")];
  assert.deepEqual(analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js"]), graph: graph({ nodes: originSymbols, edges: [] }), limits: { traversalVisitedStates: 3 } }).completeness.traversal, []);
  assert.deepEqual(analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js"]), graph: graph({ nodes: originSymbols.slice(0, 2), edges: [] }), limits: { traversalVisitedStates: 2 } }).completeness.traversal, []);
  assert.deepEqual(analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js"]), graph: graph({ nodes: originSymbols, edges: [] }), limits: { traversalVisitedStates: 2 } }).completeness.traversal, ["traversal_work_limit"]);
  const withConsumer = analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js", "consumer.js"]), graph: graph({ nodes: [...originSymbols, node("consumer", "consumer.js")], edges: [edge("consumer", "o1")] }), limits: { traversalVisitedStates: 3 } });
  assert.deepEqual(withConsumer.completeness.traversal, ["traversal_work_limit"]);
  assert.deepEqual(pathsOf(withConsumer), ["consumer.js:1"]);
});

test("keeps retained origin summaries truthful when affected files are trimmed", () => {
  const base = { originPath: "origin.js", sourceFiles: sources(["origin.js", "a.js", "b.js"]), graph: graph({ nodes: [node("origin", "origin.js"), node("a", "a.js"), node("b", "b.js")], edges: [edge("a", "origin"), edge("b", "origin")] }) };
  const exact = analyzeSingleFileReverseImpact({ ...base, limits: { affectedFiles: 2 } });
  assert.deepEqual(exact.completeness.output, []);
  for (const item of exact.affectedFiles) assert.deepEqual(item.originSummary, { discoveredOriginCount: 1, retainedOriginWitnessCount: 1, attributionTruncated: false, reasons: [] });
  const trimmed = analyzeSingleFileReverseImpact({ ...base, limits: { affectedFiles: 1 } });
  assert.deepEqual(trimmed.completeness.output, ["origin_limit"]);
  assert.deepEqual(trimmed.affectedFiles[0].originSummary, { discoveredOriginCount: 1, retainedOriginWitnessCount: 1, attributionTruncated: false, reasons: [] });
  validateCompletedAffectedItem(trimmed.affectedFiles[0]);
});

test("rejects malformed and conflicting graph/source evidence deterministically", () => {
  const duplicateA = node("dup", "a.js");
  const duplicateB = node("dup", "b.js");
  for (const nodes of [[node("origin", "origin.js"), duplicateA, duplicateB], [node("origin", "origin.js"), duplicateB, duplicateA]]) {
    assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: graph({ nodes, edges: [edge("dup", "origin")] }) }), { code: "invalid_impact_traversal" });
  }
  const identical = analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js", "a.js"]), graph: graph({ nodes: [node("origin", "origin.js"), duplicateA, duplicateA], edges: [edge("dup", "origin")] }) });
  assert.deepEqual(pathsOf(identical), ["a.js:1"]);
  const base = graph({ nodes: [node("origin", "origin.js")], edges: [] });
  for (const patch of [
    { nodes: undefined },
    { edges: {} },
    { edges: [edge("missing", "origin")] },
    { provider: {} },
    { provider: { ...nativeProvider, capabilities: { ...nativeProvider.capabilities, symbols: {} } } },
    { coverage: { observed: {}, covered: [], uncovered: [] } },
    { coverage: { observed: [], covered: [null], uncovered: [] } },
    { coverage: { observed: [], covered: [], uncovered: [null] } },
    { snapshot: { ...base.snapshot, revision: { ...base.snapshot.revision, commitSha: { bad: true } } } },
    { snapshot: { ...base.snapshot, revision: { ...base.snapshot.revision, commitSha: 1n } } },
    { snapshot: { ...base.snapshot, files: [...base.snapshot.files, base.snapshot.files[0]] } },
    { snapshot: { ...base.snapshot, files: base.snapshot.files.map((file) => ({ path: file.path, sha256: file.sha256 })) } }
  ]) {
    assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...base, ...patch } }), { code: "invalid_impact_traversal" });
  }
});

test("does not report depth truncation for redundant out-of-bound paths", () => {
  const boundaryCycle = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "b.js"]), graph: graph({ nodes: [node("o", "o.js"), node("b", "b.js")], edges: [edge("b", "o"), edge("o", "b")] }), limits: { depth: 1 } });
  assert.deepEqual(boundaryCycle.completeness.traversal, []);

  const redundant = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js"]), graph: graph({ nodes: [node("o", "o.js"), node("a", "a.js"), node("b", "b.js")], edges: [edge("a", "o"), edge("b", "o"), edge("b", "a")] }), limits: { depth: 1 } });
  assert.deepEqual(redundant.completeness.traversal, []);

  const laterShorter = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js"]), graph: graph({ nodes: [node("o", "o.js"), node("a", "a.js"), node("z", "b.js"), node("c", "b.js")], edges: [edge("a", "o"), edge("z", "o"), edge("c", "a"), edge("c", "z")] }), limits: { depth: 1 } });
  assert.deepEqual(laterShorter.completeness.traversal, []);

  const laterShorterStateLimited = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js"]), graph: graph({ nodes: [node("o", "o.js"), node("a", "a.js"), node("z", "b.js"), node("c", "b.js")], edges: [edge("a", "o"), edge("z", "o"), edge("c", "a"), edge("c", "z")] }), limits: { depth: 1, traversalVisitedStates: 3 } });
  assert.deepEqual(laterShorterStateLimited.completeness.traversal, ["traversal_work_limit"]);

  const reversedLaterShorterStateLimited = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js"]), graph: graph({ nodes: [node("c", "b.js"), node("z", "b.js"), node("a", "a.js"), node("o", "o.js")], edges: [edge("c", "z"), edge("c", "a"), edge("z", "o"), edge("a", "o")] }), limits: { depth: 1, traversalVisitedStates: 3 } });
  assert.deepEqual(reversedLaterShorterStateLimited.completeness.traversal, ["traversal_work_limit"]);

  const combinedBudgets = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js"]), graph: graph({ nodes: [node("o", "o.js"), node("a", "a.js"), node("z", "b.js"), node("c", "b.js")], edges: [edge("a", "o"), edge("z", "o"), edge("c", "a"), edge("c", "z")] }), limits: { depth: 1, traversalVisitedStates: 3, traversalEdgeExaminations: 4 } });
  assert.deepEqual(combinedBudgets.completeness.traversal, ["traversal_work_limit"]);

  const trueDepthAndWork = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js", "c.js"]), graph: graph({ nodes: [node("o", "o.js"), node("a", "a.js"), node("b", "b.js"), node("c", "c.js")], edges: [edge("a", "o"), edge("b", "a"), edge("c", "o")] }), limits: { depth: 1, traversalVisitedStates: 2 } });
  assert.deepEqual(trueDepthAndWork.completeness.traversal, ["depth_limit", "traversal_work_limit"]);

  const genuine = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js"]), graph: graph({ nodes: [node("o", "o.js"), node("a", "a.js"), node("b", "b.js")], edges: [edge("a", "o"), edge("b", "a")] }), limits: { depth: 1 } });
  assert.deepEqual(genuine.completeness.traversal, ["depth_limit"]);
});

test("multi-target traversal merges per-origin witnesses before deterministic output caps", () => {
  const boundGraph = graph({
    sourcePaths: ["a.js", "b.js", "a-shared.js", "z-first.js"],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("shared", "a-shared.js"), node("first", "z-first.js")],
    edges: [edge("first", "a"), edge("shared", "first"), edge("shared", "b")]
  });
  const result = analyzeMultiFileReverseImpact({
    originPaths: ["b.js", "a.js"],
    graph: boundGraph,
    limits: { affectedFiles: 1 }
  });
  assert.deepEqual(result.targets.map((target) => target.originPath), ["a.js", "b.js"]);
  assert.deepEqual(result.affectedFiles.map((item) => item.path), ["a-shared.js"]);
  assert.deepEqual(result.affectedFiles[0].origins.map(({ originPath, minimumDistance }) => ({ originPath, minimumDistance })), [
    { originPath: "b.js", minimumDistance: 1 },
    { originPath: "a.js", minimumDistance: 2 }
  ]);
  assert.deepEqual(result.affectedFiles[0].originSummary, {
    discoveredOriginCount: 2,
    retainedOriginWitnessCount: 2,
    attributionTruncated: false,
    reasons: []
  });
  assert(result.completeness.output.includes("origin_limit"));
});

test("multi-target traversal applies per-item origin caps without originless output", () => {
  const boundGraph = graph({
    sourcePaths: ["a.js", "b.js", "consumer.js"],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b")]
  });
  const result = analyzeMultiFileReverseImpact({
    originPaths: ["a.js", "b.js"],
    graph: boundGraph,
    limits: { originWitnessesPerItem: 1 }
  });
  assert.equal(result.affectedFiles.length, 1);
  assert.deepEqual(result.affectedFiles[0].origins.map((origin) => origin.originPath), ["a.js"]);
  assert.deepEqual(result.affectedFiles[0].originSummary, {
    discoveredOriginCount: 2,
    retainedOriginWitnessCount: 1,
    attributionTruncated: true,
    reasons: ["origin_limit"]
  });
  assert.equal(result.targets[0].findingState, "evidence_found");
  assert.equal(result.targets[1].findingState, "not_evaluated");
  assert.deepEqual(result.targets[1].completeness.output, ["origin_limit"]);
});

test("multi-target retained origins match roomy independent single-origin witnesses", () => {
  const boundGraph = graph({
    sourcePaths: ["a.js", "b.js", "consumer.js", "tail.js"],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js"), node("tail", "tail.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b"), edge("tail", "consumer")]
  });
  const multi = analyzeMultiFileReverseImpact({ originPaths: ["a.js", "b.js"], graph: boundGraph });
  for (const item of multi.affectedFiles) {
    for (const origin of item.origins) {
      const single = analyzeSingleFileReverseImpact({ originPath: origin.originPath, graph: boundGraph });
      const expected = single.affectedFiles.find((candidate) => candidate.path === item.path)?.origins[0];
      assert.deepEqual(origin, expected);
    }
  }
});

test("multi-target traversal shares visited-state work globally and identifies later unstarted origins", () => {
  const boundGraph = graph({
    sourcePaths: ["a.js", "b.js", "consumer.js"],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b")]
  });
  const result = analyzeMultiFileReverseImpact({
    originPaths: ["a.js", "b.js"],
    graph: boundGraph,
    limits: { traversalVisitedStates: 2 }
  });
  assert.equal(result.targets[0].findingState, "evidence_found");
  assert.deepEqual(result.targets[0].completeness.traversal, []);
  assert.equal(result.targets[1].findingState, "not_evaluated");
  assert.deepEqual(result.targets[1].completeness.traversal, ["traversal_work_limit"]);
  assert.deepEqual(result.affectedFiles[0].origins.map((origin) => origin.originPath), ["a.js"]);
});

test("multi-target traversal shares edge-examination work globally across origin-node states", () => {
  const boundGraph = graph({
    sourcePaths: ["a.js", "b.js", "consumer.js"],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b")]
  });
  const result = analyzeMultiFileReverseImpact({
    originPaths: ["a.js", "b.js"],
    graph: boundGraph,
    limits: { traversalEdgeExaminations: 1 }
  });
  assert.equal(result.targets[0].findingState, "evidence_found");
  assert.equal(result.targets[1].findingState, "not_evaluated");
  assert.deepEqual(result.targets[1].completeness.traversal, ["traversal_work_limit"]);
  assert.deepEqual(result.affectedFiles[0].origins.map((origin) => origin.originPath), ["a.js"]);
});

test("multi-target traversal preserves one target's evaluated absence beside missing evidence", () => {
  const boundGraph = graph({ sourcePaths: ["empty.js"], nodes: [], edges: [] });
  const result = analyzeMultiFileReverseImpact({ originPaths: ["missing.js", "empty.js"], graph: boundGraph });
  assert.deepEqual(result.targets.map(({ originPath, findingState }) => ({ originPath, findingState })), [
    { originPath: "empty.js", findingState: "no_evidence_found" },
    { originPath: "missing.js", findingState: "not_evaluated" }
  ]);
  assert.equal(result.findingState, "not_evaluated");
});
