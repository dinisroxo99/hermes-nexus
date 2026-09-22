import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSingleFileReverseImpact } from "../src/lib/impact-traversal.js";
import { IMPACT_LIMITS, validateCompletedAffectedItem } from "../src/lib/impact-policy.js";

const nativeProvider = Object.freeze({
  id: "native.typescript",
  version: "1",
  kind: "native",
  capabilities: { dependencies: "structural", references: "structural" }
});
const dotnetProvider = Object.freeze({
  id: "native.dotnet",
  version: "1",
  kind: "native",
  capabilities: { dependencies: "structural", references: "structural" }
});
const pythonProvider = Object.freeze({
  id: "external.serena-python",
  version: "1-f8f53b77-pyright-1.1.403",
  kind: "external",
  capabilities: { dependencies: "unsupported", references: "semantic" }
});

function sources(paths) {
  return paths.map((path) => ({ path, text: `// ${path}\nexport const marker = 1;\n` }));
}

function node(id, file) {
  return { id, label: id, kind: "function", file, line: 1 };
}

function edge(from, to, relation = "imports", location) {
  return { from, to, relation, ...(location ? { location } : {}) };
}

function languageFor(path) {
  if (path.endsWith(".cs")) return "csharp";
  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".js")) return "javascript";
  return "javascript";
}

function graph({ provider = nativeProvider, nodes = [], edges = [], status = "available", limited = false, uncovered = [], sourcePaths } = {}) {
  const paths = sourcePaths ?? [...new Set(nodes.map((n) => n.file))].sort();
  const observed = [...new Set(paths.map(languageFor))].sort();
  const covered = observed.filter((language) => !uncovered.includes(language));
  const snapshot = { token: `snap-${provider.id}`, files: sources(paths) };
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
  assert.equal(result.affectedFiles[0].origins[0].witness.source.path, "consumer.js");
  assert.notEqual(result.affectedFiles[0].origins[0].witness.source.hash, "unknown");

  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js", "consumer.js"]).map((file) => file.path === "consumer.js" ? { ...file, text: "// stale\n" } : file), graph: boundGraph }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, snapshotToken: "snap-stale" } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, projectId: "Other_Project", snapshot: { ...boundGraph.snapshot, projectId: "Project_One" } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, revision: { commitSha: "a".repeat(40) }, snapshot: { ...boundGraph.snapshot, revision: { commitSha: "b".repeat(40) } } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, worktree: { id: "one" }, snapshot: { ...boundGraph.snapshot, worktree: { id: "two" } } } }), { code: "invalid_impact_traversal" });
  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", graph: { ...boundGraph, snapshot: { ...boundGraph.snapshot, files: boundGraph.snapshot.files.filter((file) => file.path !== "consumer.js") } } }), { code: "invalid_impact_traversal" });
});

test("gates no-evidence on supported capabilities and target coverage", () => {
  const symbolsOnly = { ...nativeProvider, capabilities: { dependencies: "unsupported", references: "unsupported" } };
  const unsupported = analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js"]), graph: graph({ provider: symbolsOnly, sourcePaths: ["origin.js"] }) });
  assert.equal(unsupported.findingState, "not_evaluated");
  assert.deepEqual(unsupported.completeness.provider, ["provider_unsupported"]);

  assert.throws(() => analyzeSingleFileReverseImpact({ originPath: "origin.js", sourceFiles: sources(["origin.js", "consumer.js"]), graph: graph({ provider: { ...nativeProvider, capabilities: { dependencies: "structural", references: "unsupported" } }, nodes: [node("origin", "origin.js"), node("consumer", "consumer.js")], edges: [edge("consumer", "origin", "references")] }) }), { code: "invalid_impact_traversal" });

  const uncovered = analyzeSingleFileReverseImpact({ originPath: "one.py", sourceFiles: sources(["one.py"]), graph: graph({ provider: pythonProvider, uncovered: ["python"], sourcePaths: ["one.py"] }) });
  assert.equal(uncovered.findingState, "not_evaluated");
  assert.deepEqual(uncovered.completeness.provider, ["uncovered_language"]);
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
  for (const patch of [{ nodes: undefined }, { edges: {} }, { edges: [edge("missing", "origin")] }, { provider: {} }, { coverage: { uncovered: {} } }, { snapshot: { ...base.snapshot, files: [...base.snapshot.files, base.snapshot.files[0]] } }]) {
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

  const genuine = analyzeSingleFileReverseImpact({ originPath: "o.js", sourceFiles: sources(["o.js", "a.js", "b.js"]), graph: graph({ nodes: [node("o", "o.js"), node("a", "a.js"), node("b", "b.js")], edges: [edge("a", "o"), edge("b", "a")] }), limits: { depth: 1 } });
  assert.deepEqual(genuine.completeness.traversal, ["depth_limit"]);
});
