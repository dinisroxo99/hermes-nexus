import test from "node:test";
import assert from "node:assert/strict";

import { composeProjectImpact } from "../src/lib/project-impact.js";
import { createProviderSnapshot, normalizeProviderDescriptor, PROVIDER_LIMITS } from "../src/analyzers/common/analyzer-provider-contract.js";
import { analyzeContextSources } from "../src/lib/analyzer-service.js";
import { analyzeSingleFileReverseImpact } from "../src/lib/impact-traversal.js";
import { normalizeImpactRequest } from "../src/lib/impact-policy.js";

const project = Object.freeze({ projectId: "Prj_Impact", rootId: "default", relativePath: "repo" });
const revision = Object.freeze({
  status: "available",
  commitSha: "a".repeat(40),
  branch: "main",
  repositoryIdentity: "Repo_Impact",
  worktreeId: null,
  dirty: false,
  isGit: true,
  isLinkedWorktree: false
});

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

const nativeProvider = normalizeProviderDescriptor({
  id: "native.typescript",
  version: "1",
  kind: "native",
  priority: 190,
  languages: ["javascript", "typescript"],
  capabilities: capabilities()
});
const externalProvider = normalizeProviderDescriptor({
  id: "external.python",
  version: "1",
  kind: "external",
  priority: 90,
  languages: ["python"],
  capabilities: capabilities({ dependencies: "unsupported", references: "semantic" })
});
const dotnetProvider = normalizeProviderDescriptor({
  id: "native.dotnet",
  version: "1",
  kind: "native",
  priority: 200,
  languages: ["csharp"],
  capabilities: capabilities()
});

function source(path, text = `// ${path}\nexport const marker = 1;\n`) {
  return { path, text };
}

function fixture({
  files = [source("origin.js"), source("consumer.js")],
  nodes = [node("origin", "origin.js"), node("consumer", "consumer.js")],
  edges = [edge("consumer", "origin")],
  provider = nativeProvider,
  status = "available",
  limited = false,
  selectedProject = project,
  selectedRevision = revision,
  uncovered = [],
  sourceLimited = false,
  sourceUnavailable = false
} = {}) {
  const snapshot = createProviderSnapshot({ projectId: selectedProject.projectId }, files, selectedRevision);
  const observed = snapshot.languages;
  const terminal = ["unsupported", "unavailable"].includes(status);
  const covered = !terminal && provider ? observed.filter((language) => provider.languages.includes(language) && !uncovered.includes(language)) : [];
  const effectiveUncovered = terminal ? observed : uncovered;
  const graph = {
    schemaVersion: 1,
    success: !["unsupported", "unavailable"].includes(status),
    status,
    provider: ["unsupported", "unavailable"].includes(status) ? null : provider,
    snapshotToken: snapshot.token,
    coverage: { observed, covered, uncovered: effectiveUncovered },
    nodes,
    edges,
    limited,
    attempts: [{ providerId: "private", reason: "must not leak" }],
    diagnostics: [{ message: "must not leak" }],
    absolutePath: "/must/not/leak"
  };
  return { project: selectedProject, snapshot, graph, sourceLimited, sourceUnavailable };
}

function node(id, file, line = 1) {
  return { id, label: id, kind: "function", file, line };
}

function edge(from, to, relation = "references", location) {
  return { from, to, relation, ...(location === undefined ? {} : { location }) };
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

function throwsCode(code, fn) {
  assert.throws(fn, (error) => error?.code === code && !JSON.stringify(error).includes("must not leak"));
}

function throwsInvalidObservation(fn) {
  assert.throws(fn, (error) => error?.code === "invalid_impact_observation"
    && error.message === "Invalid Impact v2 observation."
    && !JSON.stringify(error).includes("must not leak"));
}

function throwsExact(code, message, fn) {
  assert.throws(fn, (error) => error?.code === code
    && error.message === message
    && !JSON.stringify(error).includes("must not leak"));
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function affectedProjection(candidate) {
  return { path: candidate.path, origins: candidate.origins, originSummary: candidate.originSummary };
}

const complete = Object.freeze({ source: [], provider: [], traversal: [], output: [] });

function findBudgetResult(request, observation, predicate) {
  const roomy = composeProjectImpact({ ...request, limits: { ...request.limits, compactBytes: 128 * 1024 } }, observation);
  for (let compactBytes = bytes(roomy) - 1; compactBytes > 0; compactBytes -= 1) {
    try {
      const result = composeProjectImpact({ ...request, limits: { ...request.limits, compactBytes } }, observation);
      if (predicate(result)) return result;
    } catch (error) {
      if (error?.code !== "impact_budget_exceeded") throw error;
    }
  }
  assert.fail("No compact byte budget produced the expected result.");
}

test("C1 composes pure immutable requests, preserving aliases as the single-target variant", () => {
  const observation = deepFreeze(fixture());
  const request = deepFreeze({ paths: [" origin.js/ ", "origin.js"], includeTests: false });
  const result = composeProjectImpact(request, observation);
  assert.equal(result.originPath, "origin.js");
  assert.equal(result.generatedAt, null);
  assert.deepEqual(result.affectedTests, { status: "not_requested", candidates: [] });
  assert.doesNotThrow(() => normalizeImpactRequest({ paths: ["a.js", "b.js"], includeTests: true }));
  const multi = composeProjectImpact({ paths: ["origin.js", "consumer.js"] }, observation);
  assert.deepEqual(multi.targets.map((target) => target.originPath), ["consumer.js", "origin.js"]);
  assert.deepEqual(composeProjectImpact({ paths: ["origin.js"], includeTests: true }, observation).affectedTests.candidates, []);
  assert.deepEqual(composeProjectImpact({ paths: ["origin.js", "consumer.js"], includeTests: true }, observation).affectedTests.candidates, []);
  throwsCode("invalid_impact_request", () => composeProjectImpact({ paths: ["origin.js"], command: "run" }, observation));
});

test("C2 emits the fixed safe envelope and rejects malformed or stale observation bindings", () => {
  const observation = fixture();
  const result = composeProjectImpact({ paths: ["origin.js"] }, observation);
  assert.deepEqual(Object.keys(result), [
    "schemaVersion", "analysisVersion", "projectId", "project", "originPath", "revision", "worktree", "snapshotToken", "generatedAt",
    "provider", "coverage", "observation", "limits", "status", "findingState", "affectedFiles", "affectedTests", "completeness"
  ]);
  assert.deepEqual(result.project, { rootId: "default", relativePath: "repo" });
  assert.equal(result.revision.repositoryId, "Repo_Impact");
  assert.equal(JSON.stringify(result).includes("must not leak"), false);
  assert.equal(JSON.stringify(result).includes("absolutePath"), false);
  assert.equal(JSON.stringify(result).includes("export const"), false);

  for (const invalid of [
    { ...observation, extra: true },
    { ...observation, sourceLimited: "yes" },
    { ...observation, project: { ...project, projectId: "Other" } },
    { ...observation, snapshot: { ...observation.snapshot, token: "stale" } },
    { ...observation, snapshot: { ...observation.snapshot, files: observation.snapshot.files.map((file) => file.path === "origin.js" ? { ...file, text: "changed" } : file) } },
    { ...observation, graph: { ...observation.graph, snapshotToken: "stale" } },
    { ...observation, graph: Object.fromEntries(Object.entries(observation.graph).filter(([key]) => key !== "provider")) },
    { ...observation, graph: { ...observation.graph, coverage: { observed: ["python"], covered: [], uncovered: ["python"] } } },
    { ...observation, graph: { ...observation.graph, nodes: Array(PROVIDER_LIMITS.nodes + 1).fill(observation.graph.nodes[0]) } }
  ]) throwsCode("invalid_impact_observation", () => composeProjectImpact({ paths: ["origin.js"] }, invalid));
});

test("C3 enforces selected worktree consistency and rejects cross-snapshot graph replay", () => {
  const selectedProject = { ...project, rootId: "worktrees", relativePath: "repo/task" };
  const selectedRevision = { ...revision, worktreeId: "wt_task", isLinkedWorktree: true };
  const observation = fixture({ selectedProject, selectedRevision });
  const result = composeProjectImpact({ paths: ["origin.js"], worktree: { rootId: "worktrees", relativePath: "repo/task" } }, observation);
  assert.deepEqual(result.worktree, { worktreeId: "wt_task" });
  throwsCode("invalid_impact_observation", () => composeProjectImpact({ paths: ["origin.js"], worktree: { rootId: "wrong", relativePath: "repo/task" } }, observation));
  throwsCode("invalid_impact_observation", () => composeProjectImpact({ paths: ["origin.js"], worktree: { relativePath: "repo/task" } }, observation));
  throwsCode("invalid_impact_observation", () => composeProjectImpact({ paths: ["origin.js"], worktree: { rootId: "default", relativePath: "repo" } }, fixture()));

  const changed = fixture({ files: [source("origin.js", "changed\n"), source("consumer.js")] });
  throwsCode("invalid_impact_observation", () => composeProjectImpact({ paths: ["origin.js"] }, { ...changed, graph: observation.graph }));
});

test("C2/C3 validates optional graph identities before terminal and zero-source traversal bypasses", () => {
  const empty = fixture({ files: [], nodes: [], edges: [], status: "unsupported", provider: null });
  const matchingGraph = {
    ...empty.graph,
    projectId: empty.snapshot.projectId,
    revision: empty.snapshot.revision,
    worktree: null
  };
  const matching = composeProjectImpact({ paths: ["origin.js"] }, { ...empty, graph: matchingGraph });
  assert.equal(matching.status, "unavailable");
  assert.equal(matching.findingState, "not_evaluated");

  const conflicts = [
    { name: "projectId", value: "Other_Project" },
    { name: "revision", value: { ...empty.snapshot.revision, branch: "replayed" } },
    { name: "worktree", value: { worktreeId: "wt_replayed" } }
  ];
  for (const { name, value } of conflicts) {
    throwsInvalidObservation(() => composeProjectImpact({ paths: ["origin.js"] }, {
      ...empty,
      graph: { ...matchingGraph, [name]: value, diagnostics: [{ message: "must not leak" }] }
    }));
  }

  for (const invalid of [
    { ...empty, snapshot: { ...empty.snapshot, token: "stale" } },
    { ...empty, graph: { ...matchingGraph, snapshotToken: "stale", attempts: [{ reason: "must not leak" }] } }
  ]) throwsInvalidObservation(() => composeProjectImpact({ paths: ["origin.js"] }, invalid));

  const linkedProject = { ...project, rootId: "worktrees", relativePath: "repo/task" };
  const linkedRevision = { ...revision, worktreeId: "wt_task", isLinkedWorktree: true };
  const linked = fixture({ selectedProject: linkedProject, selectedRevision: linkedRevision });
  const linkedGraph = {
    ...linked.graph,
    projectId: linked.snapshot.projectId,
    revision: linked.snapshot.revision,
    worktree: { worktreeId: "wt_task" }
  };
  assert.equal(composeProjectImpact({ paths: ["origin.js"], worktree: { rootId: "worktrees", relativePath: "repo/task" } }, {
    ...linked,
    graph: linkedGraph
  }).worktree.worktreeId, "wt_task");
});

test("C2 rejects a conflicting declared source hash without changing canonical source evidence", () => {
  const observation = fixture();
  const files = observation.snapshot.files.map((file) => file.path === "origin.js"
    ? { ...file, sha256: "0".repeat(64) }
    : file);
  throwsInvalidObservation(() => composeProjectImpact({ paths: ["origin.js"] }, {
    ...observation,
    snapshot: { ...observation.snapshot, files }
  }));
});

test("C4/C5 consumes native and external facade-shaped evidence and matches the accepted primitive", () => {
  for (const provider of [nativeProvider, externalProvider]) {
    const extension = provider.kind === "external" ? "py" : "js";
    const files = [source(`origin.${extension}`), source(`consumer.${extension}`)];
    const observation = fixture({
      files,
      provider,
      nodes: [node("origin", `origin.${extension}`), node("consumer", `consumer.${extension}`)],
      edges: [edge("consumer", "origin", "references", { path: `consumer.${extension}`, line: 1, column: 1 })]
    });
    const result = composeProjectImpact({ paths: [`origin.${extension}`] }, observation);
    const direct = analyzeSingleFileReverseImpact({
      originPath: `origin.${extension}`,
      snapshot: observation.snapshot,
      graph: observation.graph,
      sourceFiles: observation.snapshot.files
    });
    assert.deepEqual(result.affectedFiles, direct.affectedFiles);
    assert.equal(result.status, direct.status);
    assert.equal(result.findingState, direct.findingState);
    assert.equal(result.affectedFiles[0].origins[0].witness.trust, provider.kind === "external" ? "untrusted_external_analysis" : "derived_analysis");
    assert.equal(result.affectedFiles[0].origins[0].witness.relationshipKind, "references");
  }
});

test("C4 consumes externally constructed native, mixed and unsupported provider facade results", () => {
  const cases = [
    {
      files: [source("origin.js", "export function origin() {}\n")],
      expectedProvider: "native.typescript",
      expectedStatus: "available"
    },
    {
      files: [source("origin.cs", "public class Origin {}\n")],
      expectedProvider: "native.dotnet",
      expectedStatus: "available"
    },
    {
      files: [source("origin.cs", "public class Origin {}\n"), source("other.ts", "export class Other {}\n")],
      expectedProvider: "native.dotnet",
      expectedStatus: "partial"
    },
    {
      files: [source("origin.py", "def origin():\n    pass\n")],
      expectedProvider: null,
      expectedStatus: "unsupported"
    }
  ];

  for (const { files, expectedProvider, expectedStatus } of cases) {
    const snapshot = createProviderSnapshot(project, files, revision);
    const graph = analyzeContextSources({ ...project, type: "nodejs" }, files, { revision });
    const result = composeProjectImpact({ paths: [files[0].path] }, { project, snapshot, graph });
    assert.equal(graph.provider?.id ?? null, expectedProvider);
    assert.equal(result.provider?.id ?? null, expectedProvider);
    assert.equal(result.status, expectedStatus);
  }
});

test("C6 preserves exact evidence validation while request aliases remain normalized", () => {
  const observation = fixture();
  assert.equal(composeProjectImpact({ paths: [" origin.js/ "] }, observation).originPath, "origin.js");
  for (const alias of ["consumer.js/", " consumer.js", "consumer.js ", "./consumer.js", "CONSUMER.js", "unicode/e\u0301.js"]) {
    const invalid = { ...observation, graph: { ...observation.graph, nodes: [node("origin", "origin.js"), node("consumer", alias)] } };
    throwsCode("invalid_impact_traversal", () => composeProjectImpact({ paths: ["origin.js"], limits: { depth: 0 } }, invalid));
  }
  const alternate = fixture({
    files: [source("origin.js"), source("consumer.js"), source("reference.js", "origin;\n")],
    nodes: [node("origin", "origin.js"), node("consumer", "consumer.js")],
    edges: [edge("consumer", "origin", "references", { path: "reference.js", line: 1, column: 7 })]
  });
  assert.equal(composeProjectImpact({ paths: ["origin.js"] }, alternate).affectedFiles[0].origins[0].witness.source.path, "reference.js");
});

test("C7 reports symbol-free, missing, partial, unsupported, unavailable and zero-source observations honestly", () => {
  const symbolFree = composeProjectImpact({ paths: ["origin.js"] }, fixture({ nodes: [], edges: [] }));
  assert.equal(symbolFree.findingState, "no_evidence_found");
  const missing = composeProjectImpact({ paths: ["missing.js"] }, fixture({ nodes: [], edges: [] }));
  assert.equal(missing.findingState, "not_evaluated");
  assert(missing.completeness.source.includes("source_unavailable"));
  const partial = composeProjectImpact({ paths: ["origin.js"] }, fixture({ nodes: [], edges: [], status: "partial", limited: true, sourceLimited: true, sourceUnavailable: true }));
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.completeness.source, ["source_limit", "source_unavailable"]);
  for (const status of ["unsupported", "unavailable"]) {
    const result = composeProjectImpact({ paths: ["origin.js"] }, fixture({ status, nodes: [], edges: [] }));
    assert.equal(result.status, status);
    assert.equal(result.findingState, "not_evaluated");
  }

  const empty = fixture({ files: [], nodes: [], edges: [], status: "unsupported", provider: null, sourceLimited: true });
  const emptyResult = composeProjectImpact({ paths: ["origin.js"] }, empty);
  assert.equal(emptyResult.status, "unavailable");
  assert.equal(emptyResult.findingState, "not_evaluated");
  assert.deepEqual(emptyResult.completeness.source, ["source_limit", "source_unavailable"]);
  assert.deepEqual(emptyResult.completeness.provider, ["provider_unsupported"]);
  throwsCode("invalid_impact_observation", () => composeProjectImpact({ paths: ["origin.js"] }, { ...empty, graph: { ...empty.graph, nodes: [node("x", "origin.js")] } }));
});

test("C7 preserves selected-provider partial and limited completeness on valid zero-source observations", () => {
  const cases = [
    { status: "partial", limited: false },
    { status: "available", limited: true }
  ];
  for (const selected of cases) {
    const observation = fixture({
      files: [],
      nodes: [],
      edges: [],
      provider: nativeProvider,
      status: selected.status,
      limited: selected.limited,
      sourceLimited: true
    });
    const result = composeProjectImpact({ paths: ["origin.js"] }, observation);
    assert.equal(result.status, "unavailable");
    assert.equal(result.findingState, "not_evaluated");
    assert.deepEqual(result.provider, { id: nativeProvider.id, version: nativeProvider.version });
    assert.deepEqual(result.completeness.source, ["source_limit", "source_unavailable"]);
    assert.deepEqual(result.completeness.provider, ["provider_partial"]);
    assert.equal(result.observation.incomplete, true);
  }
});

test("C8 safely projects clean, dirty, unborn, not_git, unavailable and null revision states", () => {
  for (const [status, dirty] of [["available", false], ["available", true], ["unborn", false], ["not_git", false], ["unavailable", null], [null, null]]) {
    const selectedRevision = { ...revision, status, dirty, commitSha: status === "available" ? "b".repeat(40) : null, branch: null, isGit: status === "available" ? true : status === "not_git" ? false : null };
    const result = composeProjectImpact({ paths: ["origin.js"] }, fixture({ selectedRevision }));
    assert.equal(result.observation.basis, "working_tree");
    assert.equal(result.observation.cacheReuse, "disabled");
    assert.equal(result.generatedAt, null);
    assert.equal(result.observation.incomplete, result.status !== "available" || status === "unavailable" || status === null);
  }
});

test("C9 applies file and total witness budgets by retaining complete deterministic items", () => {
  const observation = fixture({
    files: [source("origin.js"), source("a.js"), source("b.js")],
    nodes: [node("origin", "origin.js"), node("a", "a.js"), node("b", "b.js")],
    edges: [edge("a", "origin"), edge("b", "origin")]
  });
  const exact = composeProjectImpact({ paths: ["origin.js"], limits: { affectedFiles: 2, originWitnessRecords: 2 } }, observation);
  assert.deepEqual(exact.affectedFiles.map((item) => item.path), ["a.js", "b.js"]);
  assert.deepEqual(exact.completeness.output, []);
  const limited = composeProjectImpact({ paths: ["origin.js"], limits: { affectedFiles: 2, originWitnessRecords: 1 } }, observation);
  assert.deepEqual(limited.affectedFiles.map((item) => item.path), ["a.js"]);
  assert(limited.completeness.output.includes("witness_budget"));
  assert.deepEqual(limited.affectedFiles[0].originSummary, { discoveredOriginCount: 1, retainedOriginWitnessCount: 1, attributionTruncated: false, reasons: [] });
});

test("C10 enforces the full UTF-8 compact envelope and throws when mandatory metadata cannot fit", () => {
  const observation = fixture({
    files: [source("origin.js"), source("a.js"), source("unicode/ä.js")],
    nodes: [node("origin", "origin.js"), node("a", "a.js"), node("unicode", "unicode/ä.js")],
    edges: [edge("a", "origin"), edge("unicode", "origin")]
  });
  let budget = 4096;
  for (let i = 0; i < 5; i += 1) {
    const result = composeProjectImpact({ paths: ["origin.js"], limits: { compactBytes: budget } }, observation);
    assert.equal(result.affectedFiles.length, 2);
    budget = bytes(result);
  }
  const exact = composeProjectImpact({ paths: ["origin.js"], limits: { compactBytes: budget } }, observation);
  assert.equal(bytes(exact), budget);
  assert.equal(exact.completeness.output.includes("output_byte_limit"), false);
  const trimmed = composeProjectImpact({ paths: ["origin.js"], limits: { compactBytes: budget - 1 } }, observation);
  assert(bytes(trimmed) <= budget - 1);
  assert(trimmed.affectedFiles.length < 2);
  assert(trimmed.completeness.output.includes("output_byte_limit"));
  throwsCode("impact_budget_exceeded", () => composeProjectImpact({ paths: ["origin.js"], limits: { compactBytes: 1 } }, observation));
});

test("C10 trims the full envelope to zero evidence with honest semantics at the exact UTF-8 boundary", () => {
  const observation = fixture({
    files: [source("origin.js"), source("a.js"), source("unicode/ä.js")],
    nodes: [node("origin", "origin.js"), node("a", "a.js"), node("unicode", "unicode/ä.js")],
    edges: [edge("a", "origin"), edge("unicode", "origin")],
    status: "partial",
    limited: true,
    sourceLimited: true
  });
  const request = { paths: ["origin.js"] };
  const zero = findBudgetResult(request, observation, (result) => result.affectedFiles.length === 0);
  let exactBudget = bytes(zero);
  let exact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exact = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget } }, observation);
    assert.equal(exact.affectedFiles.length, 0);
    const measured = bytes(exact);
    if (measured === exactBudget) break;
    exactBudget = measured;
  }

  assert.equal(bytes(exact), exactBudget);
  assert.equal(bytes(exact) <= exact.limits.compactBytes, true);
  assert.equal(exact.status, "partial");
  assert.equal(exact.findingState, "not_evaluated");
  assert.equal(exact.observation.incomplete, true);
  assert.deepEqual(exact.completeness.source, ["source_limit"]);
  assert.deepEqual(exact.completeness.provider, ["provider_partial"]);
  assert(exact.completeness.output.includes("output_byte_limit"));
  throwsCode("impact_budget_exceeded", () => composeProjectImpact({ ...request, limits: { compactBytes: exactBudget - 1 } }, observation));
});

test("C9/C10 preserves file, witness and byte reasons while retaining an unchanged deterministic prefix", () => {
  const observation = fixture({
    files: [source("origin.js"), source("a.js"), source("b.js"), source("c.js"), source("d.js")],
    nodes: [node("origin", "origin.js"), node("a", "a.js"), node("b", "b.js"), node("c", "c.js"), node("d", "d.js")],
    edges: [edge("a", "origin"), edge("b", "origin"), edge("c", "origin"), edge("d", "origin")]
  });
  const request = { paths: ["origin.js"], limits: { affectedFiles: 3, originWitnessRecords: 2 } };
  const beforeBytes = composeProjectImpact(request, observation);
  assert.deepEqual(beforeBytes.affectedFiles.map((item) => item.path), ["a.js", "b.js"]);
  assert.deepEqual(beforeBytes.completeness.output, ["origin_limit", "witness_budget"]);

  const trimmed = findBudgetResult(request, observation, (result) => result.affectedFiles.length === 1);
  assert.deepEqual(trimmed.affectedFiles.map((item) => item.path), ["a.js"]);
  assert.deepEqual(trimmed.affectedFiles[0], beforeBytes.affectedFiles[0]);
  assert.equal(trimmed.affectedFiles[0].origins[0].witness.trust, "derived_analysis");
  assert.equal(trimmed.affectedFiles[0].origins[0].witness.basis, "structural");
  assert.deepEqual(trimmed.affectedFiles[0].originSummary, {
    discoveredOriginCount: 1,
    retainedOriginWitnessCount: 1,
    attributionTruncated: false,
    reasons: []
  });
  assert.deepEqual(trimmed.completeness.output, ["origin_limit", "output_byte_limit", "witness_budget"]);
  assert.equal(bytes(trimmed) <= trimmed.limits.compactBytes, true);
});

test("C11 is deterministic under source, node, edge and coverage permutations without mutation", () => {
  const first = fixture({
    files: [source("origin.js"), source("a.js"), source("unicode/ä.js")],
    nodes: [node("origin", "origin.js"), node("a", "a.js"), node("unicode", "unicode/ä.js")],
    edges: [edge("a", "origin"), edge("unicode", "origin")]
  });
  const secondSnapshot = { ...first.snapshot, files: [...first.snapshot.files].reverse(), languages: [...first.snapshot.languages].reverse() };
  const secondGraph = {
    ...first.graph,
    nodes: [...first.graph.nodes].reverse(),
    edges: [...first.graph.edges].reverse(),
    coverage: Object.fromEntries(Object.entries(first.graph.coverage).map(([key, values]) => [key, [...values].reverse()]))
  };
  const second = deepFreeze({ ...first, snapshot: secondSnapshot, graph: secondGraph });
  assert.equal(JSON.stringify(composeProjectImpact({ paths: ["origin.js"] }, first)), JSON.stringify(composeProjectImpact({ paths: ["origin.js"] }, second)));
});

test("C12 leaves the foundation normalizer and primitive behavior intact", () => {
  assert.equal(normalizeImpactRequest({ paths: Array.from({ length: 32 }, (_, index) => `f${index}.js`), includeTests: true }).paths.length, 32);
  const observation = fixture();
  const before = analyzeSingleFileReverseImpact({ originPath: "origin.js", snapshot: observation.snapshot, graph: observation.graph, sourceFiles: observation.snapshot.files });
  composeProjectImpact({ paths: ["origin.js"] }, observation);
  const after = analyzeSingleFileReverseImpact({ originPath: "origin.js", snapshot: observation.snapshot, graph: observation.graph, sourceFiles: observation.snapshot.files });
  assert.deepEqual(after, before);
});

test("M1 emits the fixed multi-target envelope with per-origin witnesses and target sources", () => {
  const observation = fixture({
    files: [source("a.js"), source("b.js"), source("consumer.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b")]
  });
  const result = composeProjectImpact({ paths: ["b.js", "a.js"] }, observation);
  assert.deepEqual(Object.keys(result), [
    "schemaVersion", "analysisVersion", "projectId", "project", "targets", "revision", "worktree", "snapshotToken", "generatedAt",
    "provider", "coverage", "observation", "limits", "status", "findingState", "affectedFiles", "affectedTests", "completeness"
  ]);
  assert.deepEqual(Object.keys(result.observation), ["basis", "cacheReuse", "digestCoverage", "incomplete"]);
  assert.deepEqual(result.targets.map((target) => Object.keys(target)), [
    ["originPath", "targetSource", "status", "findingState", "completeness"],
    ["originPath", "targetSource", "status", "findingState", "completeness"]
  ]);
  assert.deepEqual(result.targets.map((target) => target.originPath), ["a.js", "b.js"]);
  assert(result.targets.every((target) => target.targetSource?.path === target.originPath));
  assert.deepEqual(result.affectedFiles[0].origins.map((origin) => origin.originPath), ["a.js", "b.js"]);
  assert.deepEqual(result.affectedFiles[0].originSummary, {
    discoveredOriginCount: 2,
    retainedOriginWitnessCount: 2,
    attributionTruncated: false,
    reasons: []
  });
  assert.deepEqual(result.affectedTests, { status: "not_requested", candidates: [] });
  assert.equal(Object.hasOwn(result, "originPath"), false);
});

test("M2 bounds raw and normalized target counts while preserving the exact single variant", () => {
  const observation = fixture();
  const single = composeProjectImpact({ paths: [" origin.js/ ", "origin.js"] }, observation);
  assert.equal(single.originPath, "origin.js");
  assert.equal(Object.hasOwn(single, "targets"), false);
  throwsCode("invalid_impact_request", () => composeProjectImpact({ paths: Array(33).fill("origin.js") }, observation));

  const paths = Array.from({ length: 32 }, (_, index) => `target-${String(index).padStart(2, "0")}.js`);
  const many = fixture({ files: paths.map((path) => source(path)), nodes: [], edges: [] });
  const result = composeProjectImpact({ paths: [...paths].reverse() }, many);
  assert.deepEqual(result.targets.map((target) => target.originPath), paths);
  assert(result.targets.every((target) => target.findingState === "no_evidence_found"));
});

test("M3 applies whole-item witness budgets and attributes omissions to every removed origin", () => {
  const observation = fixture({
    files: [source("a.js"), source("b.js"), source("consumer.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b")]
  });
  const result = composeProjectImpact({ paths: ["a.js", "b.js"], limits: { originWitnessRecords: 1 } }, observation);
  assert.deepEqual(result.affectedFiles, []);
  assert.equal(result.findingState, "not_evaluated");
  assert.deepEqual(result.completeness.output, ["witness_budget"]);
  assert(result.targets.every((target) => target.findingState === "not_evaluated"));
  assert(result.targets.every((target) => target.completeness.output.includes("witness_budget")));
});

test("M4 is byte-identical under target and evidence permutations and enforces UTF-8 envelope bounds", () => {
  const first = fixture({
    files: [source("a.js"), source("b.js"), source("unicode/ä.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("unicode", "unicode/ä.js")],
    edges: [edge("unicode", "a"), edge("unicode", "b")]
  });
  const second = deepFreeze({
    ...first,
    snapshot: { ...first.snapshot, files: [...first.snapshot.files].reverse(), languages: [...first.snapshot.languages].reverse() },
    graph: {
      ...first.graph,
      nodes: [...first.graph.nodes].reverse(),
      edges: [...first.graph.edges].reverse(),
      coverage: Object.fromEntries(Object.entries(first.graph.coverage).map(([key, values]) => [key, [...values].reverse()]))
    }
  });
  const request = { paths: ["b.js", "a.js"] };
  const roomy = composeProjectImpact(request, first);
  assert.equal(JSON.stringify(roomy), JSON.stringify(composeProjectImpact({ paths: [...request.paths].reverse() }, second)));

  let exactBudget = bytes(roomy);
  let exact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exact = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget } }, first);
    const measured = bytes(exact);
    if (measured === exactBudget) break;
    exactBudget = measured;
  }
  assert.equal(bytes(exact), exactBudget);
  assert.equal(exact.completeness.output.includes("output_byte_limit"), false);
  const trimmed = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget - 1 } }, first);
  assert.equal(trimmed.affectedFiles.length, 0);
  assert(trimmed.completeness.output.includes("output_byte_limit"));
  assert(trimmed.targets.every((target) => target.completeness.output.includes("output_byte_limit")));
  assert(bytes(trimmed) <= trimmed.limits.compactBytes);
  throwsCode("impact_budget_exceeded", () => composeProjectImpact({ ...request, limits: { compactBytes: bytes(trimmed) - 1 } }, first));
});

test("M5 preserves evaluated, missing and zero-source target semantics", () => {
  const mixed = composeProjectImpact({ paths: ["empty.js", "missing.js"] }, fixture({ files: [source("empty.js")], nodes: [], edges: [] }));
  assert.deepEqual(mixed.targets.map(({ originPath, findingState, targetSource }) => ({ originPath, findingState, targetSource: targetSource?.path ?? null })), [
    { originPath: "empty.js", findingState: "no_evidence_found", targetSource: "empty.js" },
    { originPath: "missing.js", findingState: "not_evaluated", targetSource: null }
  ]);
  assert.equal(mixed.findingState, "not_evaluated");

  const empty = fixture({ files: [], nodes: [], edges: [], status: "unsupported", provider: null, sourceLimited: true });
  const emptyResult = composeProjectImpact({ paths: ["a.js", "b.js"] }, empty);
  assert.equal(emptyResult.status, "unavailable");
  assert.equal(emptyResult.findingState, "not_evaluated");
  assert(emptyResult.targets.every((target) => target.targetSource === null && target.status === "unavailable"));
  assert.deepEqual(emptyResult.completeness.source, ["source_limit", "source_unavailable"]);
  assert.deepEqual(emptyResult.completeness.provider, ["provider_unsupported"]);
});

test("M6 preserves exact mixed eligibility and terminal provider semantics in canonical target order", () => {
  const mixedObservation = fixture({
    files: [source("eligible.js"), source("uncovered.py"), source("consumer.js")],
    nodes: [node("eligible", "eligible.js"), node("consumer", "consumer.js")],
    edges: [edge("consumer", "eligible")],
    uncovered: ["python"]
  });
  const run = (paths) => composeProjectImpact({ paths }, mixedObservation);
  const mixed = run(["uncovered.py", "missing.js", "eligible.js"]);
  assert.equal(JSON.stringify(mixed), JSON.stringify(run(["eligible.js", "uncovered.py", "missing.js"])));
  assert.deepEqual(mixed.targets.map(({ originPath, status, findingState, completeness }) => ({ originPath, status, findingState, completeness })), [
    { originPath: "eligible.js", status: "partial", findingState: "evidence_found", completeness: { source: [], provider: ["uncovered_language"], traversal: [], output: [] } },
    { originPath: "missing.js", status: "partial", findingState: "not_evaluated", completeness: { source: ["source_unavailable"], provider: ["uncovered_language"], traversal: [], output: [] } },
    { originPath: "uncovered.py", status: "partial", findingState: "not_evaluated", completeness: { source: [], provider: ["uncovered_language"], traversal: [], output: [] } }
  ]);
  assert.equal(mixed.status, "partial");
  assert.equal(mixed.findingState, "evidence_found");
  assert.deepEqual(mixed.completeness, { source: ["source_unavailable"], provider: ["uncovered_language"], traversal: [], output: [] });

  const allIneligibleObservation = fixture({
    files: [source("uncovered.py")],
    nodes: [{ malformed: true }],
    edges: [{ malformed: true }],
    uncovered: ["python"]
  });
  const allIneligible = composeProjectImpact({ paths: ["uncovered.py", "missing.js"] }, allIneligibleObservation);
  assert.deepEqual(allIneligible.targets, [
    {
      originPath: "missing.js",
      targetSource: null,
      status: "partial",
      findingState: "not_evaluated",
      completeness: { source: ["source_unavailable"], provider: ["uncovered_language"], traversal: [], output: [] }
    },
    {
      originPath: "uncovered.py",
      targetSource: { path: "uncovered.py", hash: allIneligibleObservation.snapshot.files[0].sha256 },
      status: "partial",
      findingState: "not_evaluated",
      completeness: { source: [], provider: ["uncovered_language"], traversal: [], output: [] }
    }
  ]);
  assert.equal(allIneligible.status, "partial");
  assert.equal(allIneligible.findingState, "not_evaluated");
  assert.deepEqual(allIneligible.affectedFiles, []);
  assert.deepEqual(allIneligible.completeness, {
    source: ["source_unavailable"], provider: ["uncovered_language"], traversal: [], output: []
  });
  assert.deepEqual(allIneligible.provider, { id: nativeProvider.id, version: nativeProvider.version });
  assert.equal(allIneligible.snapshotToken, allIneligibleObservation.snapshot.token);

  const symbolsOnly = normalizeProviderDescriptor({ ...nativeProvider, capabilities: capabilities({ dependencies: "unsupported", references: "unsupported" }) });
  for (const { observation, expectedStatus, providerReason, expectedProvider } of [
    {
      observation: fixture({ files: [source("a.js"), source("b.js")], nodes: [], edges: [], status: "unsupported", provider: null }),
      expectedStatus: "unsupported",
      providerReason: "provider_unsupported",
      expectedProvider: null
    },
    {
      observation: fixture({ files: [source("a.js"), source("b.js")], nodes: [], edges: [], status: "unavailable", provider: null }),
      expectedStatus: "unavailable",
      providerReason: "provider_partial",
      expectedProvider: null
    },
    {
      observation: fixture({ files: [source("a.js"), source("b.js")], nodes: [], edges: [], provider: symbolsOnly }),
      expectedStatus: "partial",
      providerReason: "provider_unsupported",
      expectedProvider: { id: symbolsOnly.id, version: symbolsOnly.version }
    }
  ]) {
    const result = composeProjectImpact({ paths: ["b.js", "a.js"] }, observation);
    const expectedCompleteness = { source: [], provider: [providerReason], traversal: [], output: [] };
    assert.deepEqual(result.targets, ["a.js", "b.js"].map((originPath) => ({
      originPath,
      targetSource: {
        path: originPath,
        hash: observation.snapshot.files.find((file) => file.path === originPath).sha256
      },
      status: expectedStatus,
      findingState: "not_evaluated",
      completeness: expectedCompleteness
    })));
    assert.equal(result.status, expectedStatus);
    assert.equal(result.findingState, "not_evaluated");
    assert.deepEqual(result.affectedFiles, []);
    assert.deepEqual(result.completeness, expectedCompleteness);
    assert.deepEqual(result.provider, expectedProvider);
    assert.equal(result.snapshotToken, observation.snapshot.token);
  }
});

test("M7 validates disconnected evidence and stale bindings before multi-target shortcuts", () => {
  const observation = fixture({
    files: [source("a.js"), source("b.js"), source("consumer.js"), source("other.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js"), node("other", "other.js")],
    edges: [edge("consumer", "a")]
  });
  for (const patch of [
    { nodes: [...observation.graph.nodes, node("disconnected", "other.js/")] },
    { edges: [...observation.graph.edges, edge("other", "consumer", "references", { path: "other.js/", line: 1, column: 1 })] },
    { edges: [...observation.graph.edges, edge("absent", "consumer")] }
  ]) throwsCode("invalid_impact_traversal", () => composeProjectImpact({
    paths: ["a.js", "b.js"],
    limits: { depth: 0, traversalVisitedStates: 1, traversalEdgeExaminations: 1 }
  }, { ...observation, graph: { ...observation.graph, ...patch } }));

  const empty = fixture({ files: [], nodes: [], edges: [], status: "unsupported", provider: null });
  const terminal = fixture({ files: [source("a.js"), source("b.js")], nodes: [], edges: [], status: "unsupported", provider: null });
  for (const selected of [empty, terminal]) {
    for (const graphPatch of [
      { snapshotToken: "stale" },
      { projectId: "Other_Project" },
      { revision: { ...selected.snapshot.revision, branch: "stale" } },
      { worktree: { worktreeId: "stale" } }
    ]) throwsInvalidObservation(() => composeProjectImpact({ paths: ["a.js", "b.js"] }, {
      ...selected,
      graph: { ...selected.graph, ...graphPatch, diagnostics: [{ message: "must not leak" }] }
    }));
  }
});

test("M8 composes every multi-output stage cumulatively while preserving a truthful multi-origin survivor", () => {
  const origins = ["a.js", "b.js", "c.js"];
  const consumers = ["aa.js", "bb.js", "cc.js", "dd.js"];
  const files = [...origins, ...consumers].map((path) => source(path));
  const nodes = [...origins, ...consumers].map((path) => node(path, path));
  const edges = consumers.flatMap((consumer) => origins.map((origin) => edge(consumer, origin)));
  const observation = fixture({ files, nodes, edges, status: "partial", limited: true, sourceLimited: true });
  const request = {
    paths: ["c.js", "a.js", "b.js"],
    limits: { originWitnessesPerItem: 2, affectedFiles: 3, originWitnessRecords: 4 }
  };
  const beforeBytes = composeProjectImpact(request, observation);
  assert.deepEqual(beforeBytes.affectedFiles.map((item) => item.path), ["aa.js", "bb.js"]);
  assert.deepEqual(beforeBytes.completeness.output, ["origin_limit", "witness_budget"]);

  const trimmed = findBudgetResult(request, observation, (result) => result.affectedFiles.length === 1);
  assert.deepEqual(trimmed.affectedFiles, [beforeBytes.affectedFiles[0]]);
  const survivor = trimmed.affectedFiles[0];
  assert.deepEqual(survivor.originSummary, {
    discoveredOriginCount: 3,
    retainedOriginWitnessCount: 2,
    attributionTruncated: true,
    reasons: ["origin_limit"]
  });
  assert.deepEqual(survivor.origins.map((origin) => origin.originPath), ["a.js", "b.js"]);
  const sourceHashes = new Map(observation.snapshot.files.map((file) => [file.path, file.sha256]));
  for (const origin of survivor.origins) {
    assert.equal(origin.minimumDistance, 1);
    assert.equal(origin.witness.source.path, "aa.js");
    assert.equal(origin.witness.source.hash, sourceHashes.get("aa.js"));
    assert.equal(origin.witness.trust, "derived_analysis");
    assert.equal(origin.witness.basis, "structural");
    assert.equal(origin.witness.relationshipKind, "references");
  }
  assert.deepEqual(trimmed.targets.map(({ originPath, status, findingState, completeness }) => ({ originPath, status, findingState, completeness })), [
    { originPath: "a.js", status: "partial", findingState: "evidence_found", completeness: { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: ["origin_limit", "output_byte_limit", "witness_budget"] } },
    { originPath: "b.js", status: "partial", findingState: "evidence_found", completeness: { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: ["origin_limit", "output_byte_limit", "witness_budget"] } },
    { originPath: "c.js", status: "partial", findingState: "not_evaluated", completeness: { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: ["origin_limit"] } }
  ]);
  assert.equal(trimmed.status, "partial");
  assert.equal(trimmed.findingState, "evidence_found");
  assert.deepEqual(trimmed.completeness, {
    source: ["source_limit"], provider: ["provider_partial"], traversal: [],
    output: ["origin_limit", "output_byte_limit", "witness_budget"]
  });
  assert(bytes(trimmed) <= trimmed.limits.compactBytes);

  const permuted = deepFreeze({
    ...observation,
    snapshot: { ...observation.snapshot, files: [...observation.snapshot.files].reverse(), languages: [...observation.snapshot.languages].reverse() },
    graph: {
      ...observation.graph,
      nodes: [...observation.graph.nodes].reverse(),
      edges: [...observation.graph.edges].reverse(),
      coverage: Object.fromEntries(Object.entries(observation.graph.coverage).map(([key, values]) => [key, [...values].reverse()]))
    }
  });
  const tightRequest = { ...request, paths: [...request.paths].reverse(), limits: { ...request.limits, compactBytes: trimmed.limits.compactBytes } };
  assert.equal(JSON.stringify(composeProjectImpact(tightRequest, permuted)), JSON.stringify(trimmed));
});

test("M9 keeps a whole-item prefix without skipping a cheaper item and counts shared witness IDs per origin", () => {
  const prefixObservation = fixture({
    files: [source("a.js"), source("b.js"), source("aa.js"), source("zz.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("aa", "aa.js"), node("zz", "zz.js")],
    edges: [edge("aa", "a"), edge("aa", "b"), edge("zz", "a")]
  });
  const noSkip = composeProjectImpact({ paths: ["a.js", "b.js"], limits: { originWitnessRecords: 1 } }, prefixObservation);
  assert.deepEqual(noSkip.affectedFiles, []);
  assert.deepEqual(noSkip.completeness.output, ["witness_budget"]);
  assert(noSkip.targets.every((target) => target.findingState === "not_evaluated"));

  const sharedObservation = fixture({
    files: [source("a.js"), source("b.js"), source("consumer.js"), source("tail.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("consumer", "consumer.js"), node("tail", "tail.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b"), edge("tail", "consumer")]
  });
  const roomy = composeProjectImpact({ paths: ["a.js", "b.js"] }, sharedObservation);
  const tail = roomy.affectedFiles.find((item) => item.path === "tail.js");
  assert.equal(tail.origins.length, 2);
  assert.equal(new Set(tail.origins.map((origin) => origin.witness.id)).size, 1);
  const limited = composeProjectImpact({ paths: ["a.js", "b.js"], limits: { originWitnessRecords: 3 } }, sharedObservation);
  assert.deepEqual(limited.affectedFiles.map((item) => item.path), ["consumer.js"]);
  assert.equal(limited.affectedFiles[0].origins.length, 2);
  assert.deepEqual(limited.completeness.output, ["witness_budget"]);
});

test("M10 accepts the exact empty Unicode multi-envelope and rejects one byte less", () => {
  const paths = ["origins/ä.js", "origins/ß.js"];
  const observation = fixture({
    files: [...paths.map((path) => source(path)), source("consumers/漢.js")],
    nodes: [node("a", paths[0]), node("b", paths[1]), node("consumer", "consumers/漢.js")],
    edges: [edge("consumer", "a"), edge("consumer", "b")],
    status: "partial",
    limited: true,
    sourceLimited: true
  });
  const request = { paths: [...paths].reverse() };
  const zero = findBudgetResult(request, observation, (result) => result.affectedFiles.length === 0);
  let exactBudget = bytes(zero);
  let exact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exact = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget } }, observation);
    assert.deepEqual(exact.affectedFiles, []);
    const measured = bytes(exact);
    if (measured === exactBudget) break;
    exactBudget = measured;
  }
  assert.equal(bytes(exact), exactBudget);
  const canonicalPaths = [...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  assert.deepEqual(exact.targets.map(({ originPath, targetSource, findingState, completeness }) => ({ originPath, targetSource, findingState, completeness })), canonicalPaths.map((originPath) => ({
    originPath,
    targetSource: { path: originPath, hash: observation.snapshot.files.find((file) => file.path === originPath).sha256 },
    findingState: "not_evaluated",
    completeness: { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: ["output_byte_limit"] }
  })));
  assert.deepEqual(exact.completeness, { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: ["output_byte_limit"] });
  assert.equal(exact.findingState, "not_evaluated");
  assert.equal(exact.observation.incomplete, true);
  throwsCode("impact_budget_exceeded", () => composeProjectImpact({ ...request, limits: { compactBytes: exactBudget - 1 } }, observation));
});

test("T1/T2 activates affected tests without changing false mode and recognizes only witnessed path conventions", () => {
  const positive = [
    "src/unit.test.js", "src/unit.SPEC.TS", "tests/helper.tsx", "test/view.jsx", "specs/api.java",
    "__TESTS__/worker.rs", "ServiceTest.cs", "ServiceTests.CS", "test_module.py", "pkg/value_test.go"
  ];
  const negative = ["src/contest.js", "docs/tests.md", "src/helper.js"];
  const files = [source("origin.js"), ...positive.map((path) => source(path)), ...negative.map((path) => source(path))];
  const nodes = [node("origin", "origin.js"), ...positive.map((path, index) => node(`p${index}`, path)), ...negative.map((path, index) => node(`n${index}`, path))];
  const edges = [...positive.map((path, index) => edge(`p${index}`, "origin")), ...negative.map((path, index) => edge(`n${index}`, "origin"))];
  const polyglotProvider = normalizeProviderDescriptor({
    ...nativeProvider,
    id: "fixture.polyglot",
    languages: ["csharp", "go", "java", "javascript", "python", "rust", "typescript"]
  });
  const observation = deepFreeze(fixture({ files, nodes, edges, provider: polyglotProvider }));
  const request = deepFreeze({ paths: ["origin.js"] });

  const omitted = composeProjectImpact(request, observation);
  const explicitFalse = composeProjectImpact({ ...request, includeTests: false }, observation);
  assert.equal(JSON.stringify(omitted), JSON.stringify(explicitFalse));
  const tightFalseRequest = { ...request, limits: { originWitnessRecords: 1, compactBytes: bytes(omitted) } };
  assert.equal(
    JSON.stringify(composeProjectImpact(tightFalseRequest, observation)),
    JSON.stringify(composeProjectImpact({ ...tightFalseRequest, includeTests: false }, observation))
  );
  const requested = deepFreeze({ ...request, includeTests: true });
  const result = composeProjectImpact(requested, observation);
  assert.equal(JSON.stringify(result), JSON.stringify(composeProjectImpact(requested, observation)));
  assert.deepEqual(result.affectedTests.candidates.map((candidate) => candidate.path), [...positive].sort());
  assert.deepEqual(Object.keys(result.affectedTests), ["status", "findingState", "candidates", "completeness"]);
  for (const candidate of result.affectedTests.candidates) {
    assert.deepEqual(Object.keys(candidate), ["path", "origins", "originSummary", "provenance"]);
    const affected = result.affectedFiles.find((item) => item.path === candidate.path);
    assert.deepEqual({ path: candidate.path, origins: candidate.origins, originSummary: candidate.originSummary }, affected);
    const boundSource = observation.snapshot.files.find((file) => file.path === candidate.path);
    assert.deepEqual(candidate.provenance, {
      trust: "derived_analysis", basis: "heuristic", reason: "test_path_convention",
      source: { path: candidate.path, hash: boundSource.sha256 }
    });
  }
  assert.equal(result.affectedTests.status, "available");
  assert.equal(result.affectedTests.findingState, "evidence_found");
  assert.deepEqual(result.affectedTests.completeness, result.completeness);
  assert.equal(JSON.stringify(result).includes("must not leak"), false);
});

test("T2/T3 rejects target-only, disconnected, label, location and basename-only test inference", () => {
  const observation = fixture({
    files: [
      source("requested.test.js"), source("origin.js"), source("src/helper.js"), source("tests/disconnected.js"),
      source("tests/location.js"), source("tests/origin.js"), source("tests/reverse.test.js")
    ],
    nodes: [
      node("requested", "requested.test.js"), node("origin", "origin.js"),
      { ...node("test_named_symbol", "src/helper.js"), label: "SomethingTests" },
      node("disconnected", "tests/disconnected.js"), node("location", "src/helper.js"),
      node("basename", "tests/origin.js"), node("reverse", "tests/reverse.test.js")
    ],
    edges: [
      edge("test_named_symbol", "origin"),
      edge("location", "origin", "references", { path: "tests/location.js", line: 1, column: 1 }),
      edge("origin", "reverse")
    ]
  });
  const result = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, observation);
  assert.deepEqual(result.affectedFiles.map((item) => item.path), ["src/helper.js"]);
  assert.deepEqual(result.affectedTests, {
    status: "available", findingState: "no_evidence_found", candidates: [],
    completeness: { source: [], provider: [], traversal: [], output: [] }
  });
  const depthZero = composeProjectImpact({ paths: ["requested.test.js"], includeTests: true, limits: { depth: 0 } }, observation);
  assert.deepEqual(depthZero.affectedTests.candidates, []);
  assert.equal(depthZero.affectedTests.findingState, "no_evidence_found");
});

test("T3/T4 preserves transitive multi-origin witnesses and candidate-local provenance exactly", () => {
  const observation = fixture({
    files: [source("a.js"), source("b.js"), source("middle.js"), source("tests/shared.spec.js"), source("references/evidence.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("middle", "middle.js"), node("test", "tests/shared.spec.js")],
    edges: [edge("middle", "a"), edge("test", "middle"), edge("test", "b", "references", { path: "references/evidence.js", line: 1, column: 1 })]
  });
  const result = composeProjectImpact({ paths: ["b.js", "a.js"], includeTests: true }, observation);
  const file = result.affectedFiles.find((item) => item.path === "tests/shared.spec.js");
  const candidate = result.affectedTests.candidates[0];
  assert.deepEqual({ path: candidate.path, origins: candidate.origins, originSummary: candidate.originSummary }, file);
  assert.deepEqual(candidate.origins.map(({ originPath, minimumDistance }) => ({ originPath, minimumDistance })), [
    { originPath: "b.js", minimumDistance: 1 }, { originPath: "a.js", minimumDistance: 2 }
  ]);
  assert.equal(candidate.origins[0].witness.source.path, "references/evidence.js");
  assert.equal(candidate.provenance.source.path, "tests/shared.spec.js");
  assert.equal(result.targets.every((target) => target.findingState === "evidence_found"), true);
});

test("T5 projects clean, incomplete and terminal affected-test status independently", () => {
  const clean = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, fixture({ nodes: [], edges: [] }));
  assert.deepEqual(clean.affectedTests, {
    status: "available", findingState: "no_evidence_found", candidates: [],
    completeness: { source: [], provider: [], traversal: [], output: [] }
  });
  const partial = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, fixture({ nodes: [], edges: [], status: "partial", limited: true }));
  assert.equal(partial.affectedTests.status, "partial");
  assert.equal(partial.affectedTests.findingState, "not_evaluated");
  assert.deepEqual(partial.affectedTests.completeness, partial.completeness);
  for (const status of ["unsupported", "unavailable"]) {
    const terminal = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, fixture({ status, nodes: [], edges: [] }));
    assert.equal(terminal.affectedTests.status, status);
    assert.equal(terminal.affectedTests.findingState, "not_evaluated");
    assert.deepEqual(terminal.affectedTests.candidates, []);
  }
});

test("T6 applies affected-test count and combined serialized-origin budgets as whole prefixes", () => {
  const paths = Array.from({ length: 33 }, (_, index) => `tests/t${String(index).padStart(2, "0")}.test.js`);
  const observation = fixture({
    files: [source("origin.js"), ...paths.map((path) => source(path))],
    nodes: [node("origin", "origin.js"), ...paths.map((path, index) => node(`t${index}`, path))],
    edges: paths.map((path, index) => edge(`t${index}`, "origin"))
  });
  const defaults = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, observation);
  assert.equal(defaults.affectedTests.candidates.length, 16);
  assert(defaults.completeness.output.includes("origin_limit"));
  const maximum = composeProjectImpact({ paths: ["origin.js"], includeTests: true, limits: { affectedTests: 32 } }, observation);
  assert.equal(maximum.affectedTests.candidates.length, 32);
  assert(maximum.completeness.output.includes("origin_limit"));

  const one = fixture({
    files: [source("origin.js"), source("tests/one.test.js")],
    nodes: [node("origin", "origin.js"), node("test", "tests/one.test.js")], edges: [edge("test", "origin")]
  });
  const exact = composeProjectImpact({ paths: ["origin.js"], includeTests: true, limits: { originWitnessRecords: 2 } }, one);
  assert.equal(exact.affectedTests.candidates.length, 1);
  assert.equal(exact.completeness.output.includes("witness_budget"), false);
  const limited = composeProjectImpact({ paths: ["origin.js"], includeTests: true, limits: { originWitnessRecords: 1 } }, one);
  assert.equal(limited.affectedFiles.length, 1);
  assert.deepEqual(limited.affectedTests.candidates, []);
  assert.deepEqual(limited.completeness.output, ["witness_budget"]);
  assert.equal(limited.findingState, "evidence_found");
  assert.equal(limited.affectedTests.findingState, "not_evaluated");
});

test("T6 stops at the first candidate that cannot fit without skipping a cheaper suffix", () => {
  const observation = fixture({
    files: [source("a.js"), source("b.js"), source("tests/aa.test.js"), source("tests/zz.test.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("aa", "tests/aa.test.js"), node("zz", "tests/zz.test.js")],
    edges: [edge("aa", "a"), edge("aa", "b"), edge("zz", "a")]
  });
  const result = composeProjectImpact({ paths: ["a.js", "b.js"], includeTests: true, limits: { originWitnessRecords: 4 } }, observation);
  assert.deepEqual(result.affectedFiles.map((item) => item.path), ["tests/aa.test.js", "tests/zz.test.js"]);
  assert.deepEqual(result.affectedTests.candidates, []);
  assert(result.completeness.output.includes("witness_budget"));
  assert.equal(result.targets.every((target) => target.findingState === "evidence_found"), true);
  assert.equal(result.targets.every((target) => target.completeness.output.includes("witness_budget")), true);
  assert.equal(result.affectedTests.status, "partial");
  assert.equal(result.affectedTests.findingState, "not_evaluated");
});

test("T7 trims candidate suffixes before affected files and honors requested-envelope UTF-8 boundaries", () => {
  const observation = fixture({
    files: [source("origin.js"), source("tests/ä.test.js"), source("tests/漢.spec.js")],
    nodes: [node("origin", "origin.js"), node("a", "tests/ä.test.js"), node("b", "tests/漢.spec.js")],
    edges: [edge("a", "origin"), edge("b", "origin")]
  });
  const request = { paths: ["origin.js"], includeTests: true };
  const roomy = composeProjectImpact(request, observation);
  let exactBudget = bytes(roomy);
  let exact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exact = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget } }, observation);
    const measured = bytes(exact);
    if (measured === exactBudget) break;
    exactBudget = measured;
  }
  assert.equal(bytes(exact), exactBudget);
  assert.equal(exact.affectedTests.candidates.length, 2);
  const candidateTrimmed = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget - 1 } }, observation);
  assert.deepEqual(candidateTrimmed.affectedFiles, exact.affectedFiles);
  assert(candidateTrimmed.affectedTests.candidates.length < exact.affectedTests.candidates.length);
  assert(candidateTrimmed.completeness.output.includes("output_byte_limit"));

  const zero = findBudgetResult(request, observation, (result) => result.affectedFiles.length === 0 && result.affectedTests.candidates.length === 0);
  let zeroBudget = bytes(zero);
  let boundary;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    boundary = composeProjectImpact({ ...request, limits: { compactBytes: zeroBudget } }, observation);
    const measured = bytes(boundary);
    if (measured === zeroBudget) break;
    zeroBudget = measured;
  }
  assert.equal(bytes(boundary), zeroBudget);
  assert.deepEqual(boundary.affectedFiles, []);
  assert.deepEqual(boundary.affectedTests.candidates, []);
  throwsCode("impact_budget_exceeded", () => composeProjectImpact({ ...request, limits: { compactBytes: zeroBudget - 1 } }, observation));
});

test("T8 validates hostile evidence before affected-test shortcuts and supports 32 normalized targets", () => {
  const observation = fixture();
  throwsCode("invalid_impact_traversal", () => composeProjectImpact({
    paths: ["origin.js"], includeTests: true, limits: { depth: 0, compactBytes: 1 }
  }, { ...observation, graph: { ...observation.graph, nodes: [...observation.graph.nodes, node("bad", "consumer.js/")] } }));
  const paths = Array.from({ length: 32 }, (_, index) => `target-${String(index).padStart(2, "0")}.js`);
  const many = fixture({ files: paths.map((path) => source(path)), nodes: [], edges: [] });
  const result = composeProjectImpact({ paths: [...paths].reverse(), includeTests: true }, many);
  assert.equal(result.targets.length, 32);
  assert.equal(result.affectedTests.findingState, "no_evidence_found");
  assert.deepEqual(result.affectedTests.completeness, result.completeness);
});

test("T1 preserves false/omitted multi output under real witness and byte pressure and validates the full request surface", () => {
  const observation = deepFreeze(fixture({
    files: [source("a.js"), source("b.js"), source("tests/ä.test.js"), source("tests/漢.spec.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("one", "tests/ä.test.js"), node("two", "tests/漢.spec.js")],
    edges: [edge("one", "a"), edge("one", "b"), edge("two", "a")]
  }));
  const pressured = findBudgetResult(
    { paths: ["b.js", "a.js"], limits: { originWitnessRecords: 2 } },
    observation,
    (result) => result.affectedFiles.length === 0 && result.completeness.output.includes("output_byte_limit")
  );
  const request = deepFreeze({
    paths: ["b.js", "a.js"],
    limits: { originWitnessRecords: 2, compactBytes: pressured.limits.compactBytes }
  });
  const omitted = composeProjectImpact(request, observation);
  const explicitFalse = composeProjectImpact(deepFreeze({ ...request, includeTests: false }), observation);
  assert.equal(JSON.stringify(omitted), JSON.stringify(explicitFalse));
  assert.deepEqual(omitted.affectedTests, { status: "not_requested", candidates: [] });
  assert.deepEqual(omitted.completeness.output, ["output_byte_limit", "witness_budget"]);

  const alias = composeProjectImpact({ paths: [" a.js/ ", "a.js"], includeTests: true }, observation);
  assert.equal(alias.originPath, "a.js");
  assert.equal(Object.hasOwn(alias, "targets"), false);
  const invalidRequests = [
    { paths: Array(33).fill("a.js"), includeTests: true },
    { paths: ["a.js"], includeTests: "true" },
    ...[0, 33, 1.5, "2"].map((affectedTests) => ({ paths: ["a.js"], includeTests: true, limits: { affectedTests } })),
    ...["testPatterns", "tests", "provider", "commands", "configuration"].map((field) => ({ paths: ["a.js"], includeTests: true, [field]: [] }))
  ];
  for (const invalid of invalidRequests) {
    throwsExact("invalid_impact_request", "Invalid bounded Impact v2 request.", () => composeProjectImpact(invalid, observation));
  }
});

test("T2/T4 preserves exact path spellings and native/external relationship identity independently of heuristic provenance", () => {
  const exactPaths = ["tests/internal space.test.js", "tests/caf\u00e9.test.js", "tests/cafe\u0301.test.js"];
  const exactObservation = fixture({
    files: [source("origin.js"), ...exactPaths.map((path) => source(path))],
    nodes: [node("origin", "origin.js"), ...exactPaths.map((path, index) => node(`exact-${index}`, path))],
    edges: exactPaths.map((path, index) => edge(`exact-${index}`, "origin", "references", index === 0
      ? { path, line: 1, column: 1 }
      : undefined))
  });
  const exact = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, exactObservation);
  assert.deepEqual(exact.affectedTests.candidates.map((candidate) => candidate.path), [...exactPaths].sort());
  assert.equal(new Set(exact.affectedTests.candidates.map((candidate) => candidate.path)).size, 3);
  for (const candidate of exact.affectedTests.candidates) {
    const file = exact.affectedFiles.find((item) => item.path === candidate.path);
    assert.deepEqual(affectedProjection(candidate), file);
    assert.equal(candidate.origins[0].witness.provider.id, "native.typescript");
    assert.equal(candidate.origins[0].witness.trust, "derived_analysis");
    assert.equal(candidate.origins[0].witness.basis, "structural");
    assert.equal(candidate.provenance.trust, "derived_analysis");
    assert.equal(candidate.provenance.basis, "heuristic");
  }
  assert.notEqual(exactPaths[1], exactPaths[2]);
  assert.equal(exactPaths[1].normalize("NFC"), exactPaths[2].normalize("NFC"));
  assert(exact.affectedTests.candidates.some((candidate) => candidate.origins[0].witness.location === null));
  assert(exact.affectedTests.candidates.some((candidate) => candidate.origins[0].witness.location?.column === 1));

  const dotnetObservation = fixture({
    files: [source("Origin.cs"), source("ServiceTests.cs")],
    nodes: [node("origin", "Origin.cs"), node("test", "ServiceTests.cs")],
    edges: [edge("test", "origin", "uses", { path: "ServiceTests.cs", line: 1, column: 1 })],
    provider: dotnetProvider
  });
  const dotnet = composeProjectImpact({ paths: ["Origin.cs"], includeTests: true }, dotnetObservation);
  assert.deepEqual(affectedProjection(dotnet.affectedTests.candidates[0]), dotnet.affectedFiles[0]);
  assert.deepEqual(dotnet.affectedTests.candidates[0].origins[0].witness.provider, { id: "native.dotnet", version: "1" });
  assert.equal(dotnet.affectedTests.candidates[0].origins[0].witness.basis, "structural");

  const pythonObservation = fixture({
    files: [source("origin.py", "value = 1\n"), source("tests/test_worker.py", "value\n"), source("evidence.py", "value\n")],
    nodes: [node("origin", "origin.py"), { ...node("module", "tests/test_worker.py"), label: "<module>", kind: "module" }],
    edges: [edge("module", "origin", "references", { path: "evidence.py", line: 1, column: 1 })],
    provider: externalProvider
  });
  const python = composeProjectImpact({ paths: ["origin.py"], includeTests: true }, pythonObservation);
  const pythonCandidate = python.affectedTests.candidates[0];
  assert.deepEqual(affectedProjection(pythonCandidate), python.affectedFiles[0]);
  assert.deepEqual(pythonCandidate.origins[0].witness.provider, { id: "external.python", version: "1" });
  assert.equal(pythonCandidate.origins[0].witness.trust, "untrusted_external_analysis");
  assert.equal(pythonCandidate.origins[0].witness.basis, "semantic");
  assert.equal(pythonCandidate.origins[0].witness.source.path, "evidence.py");
  assert.equal(pythonCandidate.origins[0].witness.location.path, "evidence.py");
  assert.equal(pythonCandidate.provenance.source.path, "tests/test_worker.py");
  assert.equal(pythonCandidate.provenance.source.hash, pythonObservation.snapshot.files.find((file) => file.path === "tests/test_worker.py").sha256);
});

test("T3 distinguishes legitimate same-file distance zero from depth-zero target-only evidence", () => {
  const observation = fixture({
    files: [source("tests/requested.test.js")],
    nodes: [node("origin", "tests/requested.test.js"), node("consumer", "tests/requested.test.js")],
    edges: [edge("consumer", "origin")]
  });
  const related = composeProjectImpact({ paths: ["tests/requested.test.js"], includeTests: true, limits: { depth: 1 } }, observation);
  assert.equal(related.affectedTests.candidates.length, 1);
  assert.equal(related.affectedTests.candidates[0].origins[0].minimumDistance, 0);
  assert.deepEqual(affectedProjection(related.affectedTests.candidates[0]), related.affectedFiles[0]);
  const targetOnly = composeProjectImpact({ paths: ["tests/requested.test.js"], includeTests: true, limits: { depth: 0 } }, observation);
  assert.deepEqual(targetOnly.affectedFiles, []);
  assert.deepEqual(targetOnly.affectedTests, { status: "available", findingState: "no_evidence_found", candidates: [], completeness: complete });
});

test("T3 honors default/max depth boundaries and shares traversal work across canonical origins", () => {
  const chainPaths = ["origin.js", "one.js", "two.js", "three.js", "four.js", "tests/five.test.js", "tests/six.test.js"];
  const chain = fixture({
    files: chainPaths.map((path) => source(path)),
    nodes: chainPaths.map((path, index) => node(`n${index}`, path)),
    edges: chainPaths.slice(1).map((path, index) => edge(`n${index + 1}`, `n${index}`))
  });
  const defaultDepth = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, chain);
  assert.deepEqual(defaultDepth.affectedTests.candidates, []);
  assert.deepEqual(defaultDepth.completeness.traversal, ["depth_limit"]);
  const maximum = composeProjectImpact({ paths: ["origin.js"], includeTests: true, limits: { depth: 5 } }, chain);
  assert.deepEqual(maximum.affectedTests.candidates.map((candidate) => candidate.path), ["tests/five.test.js"]);
  assert.equal(maximum.affectedTests.candidates[0].origins[0].minimumDistance, 5);
  assert.deepEqual(maximum.completeness.traversal, ["depth_limit"]);

  const sharedWork = fixture({
    files: [source("a.js"), source("b.js"), source("tests/a.test.js"), source("tests/b.test.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("ta", "tests/a.test.js"), node("tb", "tests/b.test.js")],
    edges: [edge("ta", "a"), edge("tb", "b")]
  });
  const limited = composeProjectImpact({
    paths: ["b.js", "a.js"], includeTests: true,
    limits: { traversalVisitedStates: 2, traversalEdgeExaminations: 1 }
  }, sharedWork);
  assert.deepEqual(limited.affectedTests.candidates.map((candidate) => candidate.path), ["tests/a.test.js"]);
  assert.equal(limited.targets.find((target) => target.originPath === "a.js").findingState, "evidence_found");
  assert.equal(limited.targets.find((target) => target.originPath === "b.js").findingState, "not_evaluated");
  assert.deepEqual(limited.targets.find((target) => target.originPath === "b.js").completeness.traversal, ["traversal_work_limit"]);
});

test("T4 deduplicates ties, cycles and reciprocal origins while preserving shared witness IDs per origin", () => {
  const observation = fixture({
    files: [source("a.js"), source("b.js"), source("shared.js"), source("tests/tail.test.js")],
    nodes: [
      node("a", "a.js"), node("b", "b.js"), node("shared", "shared.js"), node("shared", "shared.js"),
      node("tail", "tests/tail.test.js"), node("alternate", "tests/tail.test.js")
    ],
    edges: [
      edge("shared", "a"), edge("shared", "a"), edge("shared", "b"),
      edge("tail", "shared"), edge("alternate", "shared"), edge("a", "b"), edge("b", "a"), edge("shared", "tail")
    ]
  });
  const first = composeProjectImpact({ paths: ["b.js", "a.js"], includeTests: true }, observation);
  assert.equal(first.affectedTests.candidates.length, 1);
  const candidate = first.affectedTests.candidates[0];
  const file = first.affectedFiles.find((item) => item.path === candidate.path);
  assert.deepEqual(affectedProjection(candidate), file);
  assert.deepEqual(candidate.origins.map(({ originPath, minimumDistance }) => ({ originPath, minimumDistance })), [
    { originPath: "a.js", minimumDistance: 2 }, { originPath: "b.js", minimumDistance: 2 }
  ]);
  assert.equal(new Set(candidate.origins.map((origin) => origin.witness.id)).size, 1);
  assert.equal(new Set(first.affectedTests.candidates.map((item) => item.path)).size, 1);
  const permuted = deepFreeze({
    ...observation,
    snapshot: { ...observation.snapshot, files: [...observation.snapshot.files].reverse(), languages: [...observation.snapshot.languages].reverse() },
    graph: { ...observation.graph, nodes: [...observation.graph.nodes].reverse(), edges: [...observation.graph.edges].reverse() }
  });
  assert.equal(JSON.stringify(first), JSON.stringify(composeProjectImpact({ paths: ["a.js", "b.js"], includeTests: true }, permuted)));
});

test("T5 covers requested-section empty, terminal, unavailable, no-capability and source/provider-partial states exactly", () => {
  const symbolsOnly = normalizeProviderDescriptor({
    ...nativeProvider,
    capabilities: capabilities({ dependencies: "unsupported", references: "unsupported" })
  });
  const cases = [
    {
      name: "clean symbol-free",
      observation: fixture({ nodes: [], edges: [] }),
      path: "origin.js",
      status: "available",
      findingState: "no_evidence_found",
      completeness: complete,
      targetSource: true,
      incomplete: false
    },
    {
      name: "missing",
      observation: fixture({ nodes: [], edges: [] }),
      path: "missing.js",
      status: "partial",
      findingState: "not_evaluated",
      completeness: { source: ["source_unavailable"], provider: [], traversal: [], output: [] },
      targetSource: false,
      incomplete: true
    },
    {
      name: "provider partial",
      observation: fixture({ nodes: [], edges: [], status: "partial" }),
      path: "origin.js",
      status: "partial",
      findingState: "not_evaluated",
      topFindingState: "no_evidence_found",
      completeness: { source: [], provider: ["provider_partial"], traversal: [], output: [] },
      targetSource: true,
      incomplete: true
    },
    {
      name: "provider limited and source limited/unavailable",
      observation: fixture({ nodes: [], edges: [], limited: true, sourceLimited: true, sourceUnavailable: true }),
      path: "origin.js",
      status: "partial",
      findingState: "not_evaluated",
      topFindingState: "no_evidence_found",
      completeness: { source: ["source_limit", "source_unavailable"], provider: ["provider_partial"], traversal: [], output: [] },
      targetSource: true,
      incomplete: true
    },
    {
      name: "no dependency/reference capability",
      observation: fixture({ nodes: [{ malformed: true }], edges: [{ malformed: true }], provider: symbolsOnly }),
      path: "origin.js",
      status: "partial",
      findingState: "not_evaluated",
      completeness: { source: [], provider: ["provider_unsupported"], traversal: [], output: [] },
      targetSource: true,
      incomplete: true
    },
    ...["unsupported", "unavailable"].map((status) => ({
      name: `terminal ${status}`,
      observation: fixture({ status, nodes: [], edges: [] }),
      path: "origin.js",
      status,
      findingState: "not_evaluated",
      completeness: {
        source: [],
        provider: [status === "unsupported" ? "provider_unsupported" : "provider_partial"],
        traversal: [],
        output: []
      },
      targetSource: true,
      incomplete: true
    })),
    {
      name: "zero sources",
      observation: fixture({ files: [], nodes: [], edges: [], status: "unsupported", provider: null, sourceLimited: true }),
      path: "origin.js",
      status: "unavailable",
      findingState: "not_evaluated",
      completeness: { source: ["source_limit", "source_unavailable"], provider: ["provider_unsupported"], traversal: [], output: [] },
      targetSource: false,
      incomplete: true
    }
  ];
  for (const selected of cases) {
    const result = composeProjectImpact({ paths: [selected.path], includeTests: true }, selected.observation);
    assert.deepEqual(result.affectedTests, {
      status: selected.status,
      findingState: selected.findingState,
      candidates: [],
      completeness: selected.completeness
    }, selected.name);
    assert.equal(result.status, selected.status, selected.name);
    assert.equal(result.findingState, selected.topFindingState ?? selected.findingState, selected.name);
    assert.deepEqual(result.completeness, selected.completeness, selected.name);
    assert.equal(result.observation.targetSource !== null, selected.targetSource, selected.name);
    assert.equal(result.observation.incomplete, selected.incomplete, selected.name);
  }
});

test("T5 covers multi missing/uncovered/mixed evidence, target metadata and deliberate all-ineligible bypass", () => {
  const observation = fixture({
    files: [source("eligible.js"), source("uncovered.py"), source("tests/live.test.js")],
    nodes: [node("eligible", "eligible.js"), node("test", "tests/live.test.js")],
    edges: [edge("test", "eligible")],
    uncovered: ["python"]
  });
  const result = composeProjectImpact({ paths: ["uncovered.py", "missing.js", "eligible.js"], includeTests: true }, observation);
  assert.equal(result.status, "partial");
  assert.equal(result.findingState, "evidence_found");
  assert.equal(result.observation.incomplete, true);
  assert.deepEqual(result.affectedTests, {
    status: "partial",
    findingState: "evidence_found",
    candidates: result.affectedTests.candidates,
    completeness: { source: ["source_unavailable"], provider: ["uncovered_language"], traversal: [], output: [] }
  });
  assert.equal(result.affectedTests.candidates.length, 1);
  assert.deepEqual(result.targets.map(({ originPath, targetSource, status, findingState, completeness }) => ({
    originPath, targetSource: targetSource?.path ?? null, status, findingState, completeness
  })), [
    {
      originPath: "eligible.js", targetSource: "eligible.js", status: "partial", findingState: "evidence_found",
      completeness: { source: [], provider: ["uncovered_language"], traversal: [], output: [] }
    },
    {
      originPath: "missing.js", targetSource: null, status: "partial", findingState: "not_evaluated",
      completeness: { source: ["source_unavailable"], provider: ["uncovered_language"], traversal: [], output: [] }
    },
    {
      originPath: "uncovered.py", targetSource: "uncovered.py", status: "partial", findingState: "not_evaluated",
      completeness: { source: [], provider: ["uncovered_language"], traversal: [], output: [] }
    }
  ]);

  const bypassObservation = fixture({
    files: [source("uncovered.py")], nodes: [{ malformed: true }], edges: [{ malformed: true }], uncovered: ["python"]
  });
  const bypass = composeProjectImpact({ paths: ["uncovered.py", "missing.py"], includeTests: true }, bypassObservation);
  assert.deepEqual(bypass.affectedTests, {
    status: "partial", findingState: "not_evaluated", candidates: [],
    completeness: { source: ["source_unavailable"], provider: ["uncovered_language"], traversal: [], output: [] }
  });
  assert.equal(bypass.observation.incomplete, true);
  assert(bypass.targets.every((target) => target.status === "partial" && target.findingState === "not_evaluated"));
});

test("T5 projects depth/work limits and every accepted revision variant without promoting empty partial evidence", () => {
  const depthObservation = fixture({
    files: [source("origin.js"), source("middle.js"), source("tests/deep.test.js")],
    nodes: [node("origin", "origin.js"), node("middle", "middle.js"), node("deep", "tests/deep.test.js")],
    edges: [edge("middle", "origin"), edge("deep", "middle")]
  });
  const depth = composeProjectImpact({ paths: ["origin.js"], includeTests: true, limits: { depth: 1 } }, depthObservation);
  assert.deepEqual(depth.affectedTests, {
    status: "partial", findingState: "not_evaluated", candidates: [],
    completeness: { source: [], provider: [], traversal: ["depth_limit"], output: [] }
  });
  const work = composeProjectImpact({
    paths: ["origin.js"], includeTests: true, limits: { traversalVisitedStates: 1, traversalEdgeExaminations: 1 }
  }, depthObservation);
  assert.deepEqual(work.affectedTests, {
    status: "partial", findingState: "not_evaluated", candidates: [],
    completeness: { source: [], provider: [], traversal: ["traversal_work_limit"], output: [] }
  });

  for (const [status, dirty, expectedIncomplete] of [
    ["available", false, false], ["available", true, false], ["unborn", false, false],
    ["not_git", false, false], ["unavailable", null, true], [null, null, true]
  ]) {
    const selectedRevision = {
      ...revision,
      status,
      dirty,
      commitSha: status === "available" ? "b".repeat(40) : null,
      branch: null,
      isGit: status === "available" ? true : status === "not_git" ? false : null
    };
    const result = composeProjectImpact({ paths: ["origin.js"], includeTests: true }, fixture({ selectedRevision, nodes: [], edges: [] }));
    assert.deepEqual(result.affectedTests, { status: "available", findingState: "no_evidence_found", candidates: [], completeness: complete });
    assert.equal(result.observation.incomplete, expectedIncomplete);
    assert.equal(result.revision.status, status);
    assert.equal(result.revision.dirty, dirty);
  }
});

test("T6 accepts exact default/custom/max candidate counts and marks only actual whole-prefix omissions", () => {
  const run = (count, affectedTests) => {
    const paths = Array.from({ length: count }, (_, index) => `tests/t${String(index).padStart(2, "0")}.test.js`);
    const observation = fixture({
      files: [source("origin.js"), ...paths.map((path) => source(path))],
      nodes: [node("origin", "origin.js"), ...paths.map((path, index) => node(`t${index}`, path))],
      edges: paths.map((path, index) => edge(`t${index}`, "origin"))
    });
    return composeProjectImpact({
      paths: ["origin.js"], includeTests: true,
      ...(affectedTests === undefined ? {} : { limits: { affectedTests } })
    }, observation);
  };
  for (const [limit, exactCount] of [[undefined, 16], [2, 2], [32, 32]]) {
    const exact = run(exactCount, limit);
    assert.equal(exact.affectedTests.candidates.length, exactCount);
    assert.equal(exact.completeness.output.includes("origin_limit"), false);
    const overflow = run(exactCount + 1, limit);
    assert.equal(overflow.affectedTests.candidates.length, exactCount);
    assert.deepEqual(overflow.completeness.output, ["origin_limit"]);
    assert.equal(overflow.affectedTests.status, "partial");
    assert.equal(overflow.affectedTests.findingState, "evidence_found");
  }
});

test("T6 charges shared witness IDs once per origin in both serialized sections and retains a whole multi-origin candidate only at exact fit", () => {
  const observation = fixture({
    files: [source("a.js"), source("b.js"), source("shared.js"), source("tests/tail.test.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("shared", "shared.js"), node("tail", "tests/tail.test.js")],
    edges: [edge("shared", "a"), edge("shared", "b"), edge("tail", "shared")]
  });
  const exact = composeProjectImpact({
    paths: ["a.js", "b.js"], includeTests: true, limits: { originWitnessRecords: 6 }
  }, observation);
  assert.equal(exact.affectedFiles.reduce((sum, item) => sum + item.origins.length, 0), 4);
  assert.equal(exact.affectedTests.candidates.reduce((sum, item) => sum + item.origins.length, 0), 2);
  const candidate = exact.affectedTests.candidates[0];
  assert.equal(candidate.origins.length, 2);
  assert.equal(new Set(candidate.origins.map((origin) => origin.witness.id)).size, 1);
  assert.deepEqual(affectedProjection(candidate), exact.affectedFiles.find((item) => item.path === candidate.path));
  assert.deepEqual(exact.completeness.output, []);

  const oneUnder = composeProjectImpact({
    paths: ["a.js", "b.js"], includeTests: true, limits: { originWitnessRecords: 5 }
  }, observation);
  assert.deepEqual(oneUnder.affectedTests.candidates, []);
  assert.equal(oneUnder.affectedFiles.length, 2);
  assert.deepEqual(oneUnder.completeness.output, ["witness_budget"]);
  assert(oneUnder.targets.every((target) => target.findingState === "evidence_found"));
  assert(oneUnder.targets.every((target) => target.completeness.output.includes("witness_budget")));
});

test("T6 applies the file-origin witness prefix before candidate derivation in both requested variants", () => {
  const singleObservation = fixture({
    files: [source("origin.js"), source("aa.js"), source("tests/zz.test.js")],
    nodes: [node("origin", "origin.js"), node("aa", "aa.js"), node("test", "tests/zz.test.js")],
    edges: [edge("aa", "origin"), edge("test", "origin")]
  });
  const single = composeProjectImpact({
    paths: ["origin.js"], includeTests: true, limits: { originWitnessRecords: 1 }
  }, singleObservation);
  assert.deepEqual(single.affectedFiles.map((item) => item.path), ["aa.js"]);
  assert.deepEqual(single.affectedTests.candidates, []);
  assert.deepEqual(single.completeness.output, ["witness_budget"]);
  assert.equal(single.findingState, "evidence_found");
  assert.equal(single.affectedTests.findingState, "not_evaluated");

  const multiObservation = fixture({
    files: [source("a.js"), source("b.js"), source("tests/aa.test.js"), source("tests/zz.test.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("aa", "tests/aa.test.js"), node("zz", "tests/zz.test.js")],
    edges: [edge("aa", "a"), edge("zz", "b")]
  });
  const multi = composeProjectImpact({
    paths: ["a.js", "b.js"], includeTests: true, limits: { originWitnessRecords: 1 }
  }, multiObservation);
  assert.deepEqual(multi.affectedFiles.map((item) => item.path), ["tests/aa.test.js"]);
  assert.deepEqual(multi.affectedTests.candidates, []);
  assert.deepEqual(multi.completeness.output, ["witness_budget"]);
  assert.equal(multi.targets.find((target) => target.originPath === "a.js").findingState, "evidence_found");
  assert.equal(multi.targets.find((target) => target.originPath === "b.js").findingState, "not_evaluated");
  assert.deepEqual(multi.targets.find((target) => target.originPath === "b.js").completeness.output, ["witness_budget"]);
});

test("T6 preserves upstream file/per-origin omissions, hides capped tests, and attributes candidate count omissions only to retained origins", () => {
  const hiddenObservation = fixture({
    files: [source("a.js"), source("b.js"), source("aa.js"), source("tests/zz.test.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("aa", "aa.js"), node("test", "tests/zz.test.js")],
    edges: [edge("aa", "a"), edge("aa", "b"), edge("test", "a"), edge("test", "b")]
  });
  const hidden = composeProjectImpact({
    paths: ["a.js", "b.js"], includeTests: true,
    limits: { affectedFiles: 1, originWitnessesPerItem: 1, originWitnessRecords: 4 }
  }, hiddenObservation);
  assert.deepEqual(hidden.affectedFiles.map((item) => item.path), ["aa.js"]);
  assert.deepEqual(hidden.affectedTests.candidates, []);
  assert.deepEqual(hidden.affectedFiles[0].originSummary, {
    discoveredOriginCount: 2, retainedOriginWitnessCount: 1, attributionTruncated: true, reasons: ["origin_limit"]
  });
  assert.deepEqual(hidden.completeness.output, ["origin_limit"]);

  const attributionObservation = fixture({
    files: [source("a.js"), source("b.js"), source("tests/a.test.js"), source("tests/b.test.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("ta", "tests/a.test.js"), node("tb", "tests/b.test.js")],
    edges: [edge("ta", "a"), edge("tb", "b")]
  });
  const attributed = composeProjectImpact({
    paths: ["a.js", "b.js"], includeTests: true, limits: { affectedTests: 1 }
  }, attributionObservation);
  assert.deepEqual(attributed.affectedTests.candidates.map((item) => item.path), ["tests/a.test.js"]);
  const a = attributed.targets.find((target) => target.originPath === "a.js");
  const b = attributed.targets.find((target) => target.originPath === "b.js");
  assert.deepEqual(a.completeness.output, []);
  assert.deepEqual(b.completeness.output, ["origin_limit"]);
  assert.equal(a.findingState, "evidence_found");
  assert.equal(b.findingState, "evidence_found");
});

test("T7 measures the full multi-target UTF-8 envelope and removes exact candidate suffixes before any file evidence", () => {
  const observation = fixture({
    files: [source("origins/ä.js"), source("origins/ß.js"), source("tests/ä.test.js"), source("tests/漢.spec.js")],
    nodes: [node("a", "origins/ä.js"), node("b", "origins/ß.js"), node("ta", "tests/ä.test.js"), node("tb", "tests/漢.spec.js")],
    edges: [edge("ta", "a"), edge("tb", "b")]
  });
  const request = { paths: ["origins/ß.js", "origins/ä.js"], includeTests: true };
  const roomy = composeProjectImpact({ ...request, limits: { compactBytes: 128 * 1024 } }, observation);
  let exactBudget = bytes(roomy);
  let exact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exact = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget } }, observation);
    const measured = bytes(exact);
    if (measured === exactBudget) break;
    exactBudget = measured;
  }
  assert.equal(bytes(exact), exactBudget);
  assert.equal(exact.affectedFiles.length, 2);
  assert.equal(exact.affectedTests.candidates.length, 2);
  assert.deepEqual(exact.completeness.output, []);

  const oneUnder = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget - 1 } }, observation);
  assert.equal(oneUnder.affectedFiles.length, 2);
  assert.equal(oneUnder.affectedTests.candidates.length, 1);
  assert.deepEqual(oneUnder.affectedFiles, exact.affectedFiles);
  assert.deepEqual(oneUnder.affectedTests.candidates[0], exact.affectedTests.candidates[0]);
  assert.deepEqual(oneUnder.completeness.output, ["output_byte_limit"]);
  assert(bytes(oneUnder) <= oneUnder.limits.compactBytes);
  const retainedOrigin = oneUnder.affectedTests.candidates[0].origins[0].originPath;
  const removedOrigin = exact.affectedTests.candidates[1].origins[0].originPath;
  assert.deepEqual(oneUnder.targets.find((target) => target.originPath === retainedOrigin).completeness.output, []);
  assert.deepEqual(oneUnder.targets.find((target) => target.originPath === removedOrigin).completeness.output, ["output_byte_limit"]);
  assert(oneUnder.targets.every((target) => target.findingState === "evidence_found"));

  const candidatesExhausted = findBudgetResult(request, observation, (result) =>
    result.affectedTests.candidates.length === 0 && result.affectedFiles.length === 2);
  assert.deepEqual(candidatesExhausted.affectedFiles, exact.affectedFiles);
  assert.deepEqual(candidatesExhausted.affectedTests.candidates, []);
  assert.equal(candidatesExhausted.affectedTests.findingState, "not_evaluated");
  assert.equal(candidatesExhausted.findingState, "evidence_found");
  assert(candidatesExhausted.targets.every((target) => target.findingState === "evidence_found"));

  const fileTrimmed = findBudgetResult(request, observation, (result) =>
    result.affectedTests.candidates.length === 0 && result.affectedFiles.length === 1);
  assert.deepEqual(fileTrimmed.affectedFiles, [exact.affectedFiles[0]]);
  assert.deepEqual(fileTrimmed.affectedTests.candidates, []);
  assert.equal(fileTrimmed.findingState, "evidence_found");
  assert.equal(fileTrimmed.targets.filter((target) => target.findingState === "evidence_found").length, 1);

  const zero = findBudgetResult(request, observation, (result) =>
    result.affectedTests.candidates.length === 0 && result.affectedFiles.length === 0);
  let zeroBudget = bytes(zero);
  let exactZero;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exactZero = composeProjectImpact({ ...request, limits: { compactBytes: zeroBudget } }, observation);
    const measured = bytes(exactZero);
    if (measured === zeroBudget) break;
    zeroBudget = measured;
  }
  assert.equal(bytes(exactZero), zeroBudget);
  assert.deepEqual(exactZero.affectedFiles, []);
  assert.deepEqual(exactZero.affectedTests.candidates, []);
  throwsExact(
    "impact_budget_exceeded",
    "Impact v2 result cannot fit the requested compact byte budget.",
    () => composeProjectImpact({ ...request, limits: { compactBytes: zeroBudget - 1 } }, observation)
  );

  const noEvidence = fixture({ files: [source("a.js"), source("b.js")], nodes: [], edges: [] });
  throwsExact(
    "impact_budget_exceeded",
    "Impact v2 result cannot fit the requested compact byte budget.",
    () => composeProjectImpact({ paths: ["a.js", "b.js"], includeTests: true, limits: { compactBytes: 1 } }, noEvidence)
  );

  const permuted = deepFreeze({
    ...observation,
    snapshot: { ...observation.snapshot, files: [...observation.snapshot.files].reverse(), languages: [...observation.snapshot.languages].reverse() },
    graph: {
      ...observation.graph,
      nodes: [...observation.graph.nodes].reverse(),
      edges: [...observation.graph.edges].reverse(),
      coverage: Object.fromEntries(Object.entries(observation.graph.coverage).map(([key, values]) => [key, [...values].reverse()]))
    }
  });
  const tightPermuted = composeProjectImpact({
    paths: [...request.paths].reverse(), includeTests: true,
    limits: { compactBytes: oneUnder.limits.compactBytes }
  }, permuted);
  assert.equal(JSON.stringify(tightPermuted), JSON.stringify(oneUnder));
});

test("T7 accepts the exact requested zero-evidence envelope and rejects one byte less with the fixed error", () => {
  const observation = fixture({
    files: [source("origin.js"), source("tests/ä.test.js")],
    nodes: [node("origin", "origin.js"), node("test", "tests/ä.test.js")],
    edges: [edge("test", "origin")],
    status: "partial",
    limited: true,
    sourceLimited: true
  });
  const request = { paths: ["origin.js"], includeTests: true };
  const zero = findBudgetResult(request, observation, (result) =>
    result.affectedFiles.length === 0 && result.affectedTests.candidates.length === 0);
  let exactBudget = bytes(zero);
  let exact;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    exact = composeProjectImpact({ ...request, limits: { compactBytes: exactBudget } }, observation);
    const measured = bytes(exact);
    if (measured === exactBudget) break;
    exactBudget = measured;
  }
  assert.equal(bytes(exact), exactBudget);
  assert.deepEqual(exact.affectedFiles, []);
  assert.deepEqual(exact.affectedTests, {
    status: "partial", findingState: "not_evaluated", candidates: [],
    completeness: {
      source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: ["output_byte_limit"]
    }
  });
  assert.equal(exact.findingState, "not_evaluated");
  assert.equal(exact.observation.incomplete, true);
  throwsExact(
    "impact_budget_exceeded",
    "Impact v2 result cannot fit the requested compact byte budget.",
    () => composeProjectImpact({ ...request, limits: { compactBytes: exactBudget - 1 } }, observation)
  );
});

test("T7 composes per-origin, file, candidate-count, witness and byte omissions without later reattribution", () => {
  const origins = ["a.js", "b.js", "c.js"];
  const tests = ["tests/aa.test.js", "tests/bb.test.js", "tests/cc.test.js", "tests/dd.test.js"];
  const observation = fixture({
    files: [...origins, ...tests].map((path) => source(path)),
    nodes: [...origins, ...tests].map((path) => node(path, path)),
    edges: tests.flatMap((testPath) => origins.map((originPath) => edge(testPath, originPath)))
  });
  const request = {
    paths: [...origins].reverse(), includeTests: true,
    limits: { originWitnessesPerItem: 2, affectedFiles: 3, affectedTests: 2, originWitnessRecords: 8 }
  };
  const beforeBytes = composeProjectImpact(request, observation);
  assert.deepEqual(beforeBytes.affectedFiles.map((item) => item.path), tests.slice(0, 3));
  assert.deepEqual(beforeBytes.affectedTests.candidates.map((item) => item.path), tests.slice(0, 1));
  assert.deepEqual(beforeBytes.completeness.output, ["origin_limit", "witness_budget"]);
  assert.deepEqual(beforeBytes.affectedTests.candidates[0].originSummary, {
    discoveredOriginCount: 3, retainedOriginWitnessCount: 2, attributionTruncated: true, reasons: ["origin_limit"]
  });

  const trimmed = findBudgetResult(request, observation, (result) =>
    result.affectedTests.candidates.length === 0 && result.affectedFiles.length === 2);
  assert.deepEqual(trimmed.affectedFiles, beforeBytes.affectedFiles.slice(0, 2));
  assert.deepEqual(trimmed.completeness.output, ["origin_limit", "output_byte_limit", "witness_budget"]);
  assert.deepEqual(trimmed.affectedTests.completeness, trimmed.completeness);
  assert.equal(trimmed.affectedTests.findingState, "not_evaluated");
  assert.equal(trimmed.findingState, "evidence_found");
  assert(bytes(trimmed) <= trimmed.limits.compactBytes);
  const targetA = trimmed.targets.find((target) => target.originPath === "a.js");
  const targetB = trimmed.targets.find((target) => target.originPath === "b.js");
  const targetC = trimmed.targets.find((target) => target.originPath === "c.js");
  assert.deepEqual(targetA.completeness.output, ["origin_limit", "output_byte_limit", "witness_budget"]);
  assert.deepEqual(targetB.completeness.output, ["origin_limit", "output_byte_limit", "witness_budget"]);
  assert.deepEqual(targetC.completeness.output, ["origin_limit"]);
  assert.equal(targetA.findingState, "evidence_found");
  assert.equal(targetB.findingState, "evidence_found");
  assert.equal(targetC.findingState, "not_evaluated");
});

test("T8 validates stale bindings, raw cardinality and malformed disconnected evidence before every requested-mode shortcut", () => {
  const observation = fixture({
    files: [source("origin.js"), source("tests/live.test.js"), source("other.js")],
    nodes: [node("origin", "origin.js"), node("test", "tests/live.test.js"), node("other", "other.js")],
    edges: [edge("test", "origin")]
  });
  const request = {
    paths: ["origin.js"], includeTests: true,
    limits: { depth: 0, traversalVisitedStates: 1, traversalEdgeExaminations: 1, affectedTests: 1, compactBytes: 1 }
  };
  for (const invalid of [
    { ...observation, snapshot: { ...observation.snapshot, token: "stale" } },
    { ...observation, snapshot: { ...observation.snapshot, projectId: "Other_Project" } },
    {
      ...observation,
      snapshot: {
        ...observation.snapshot,
        files: observation.snapshot.files.map((file) => file.path === "origin.js" ? { ...file, sha256: "0".repeat(64) } : file)
      }
    },
    { ...observation, graph: { ...observation.graph, snapshotToken: "stale" } },
    { ...observation, graph: { ...observation.graph, projectId: "Other_Project" } },
    { ...observation, graph: { ...observation.graph, revision: { ...observation.snapshot.revision, branch: "stale" } } },
    { ...observation, graph: { ...observation.graph, worktree: { worktreeId: "stale" } } },
    { ...observation, graph: { ...observation.graph, nodes: Array(PROVIDER_LIMITS.nodes + 1).fill(observation.graph.nodes[0]) } },
    { ...observation, graph: { ...observation.graph, edges: Array(PROVIDER_LIMITS.edges + 1).fill(observation.graph.edges[0]) } }
  ]) {
    throwsInvalidObservation(() => composeProjectImpact(request, invalid));
  }

  for (const patch of [
    { nodes: [...observation.graph.nodes, node("aliased", "other.js/")] },
    { nodes: [...observation.graph.nodes, node("spaced", " other.js")] },
    { nodes: [...observation.graph.nodes, node("cased", "OTHER.js")] },
    { edges: [...observation.graph.edges, edge("absent", "origin")] },
    { edges: [...observation.graph.edges, edge("other", "origin", "references", { path: "missing.js", line: 1, column: 1 })] },
    { edges: [...observation.graph.edges, edge("other", "origin", "references", { path: "other.js", line: 99, column: 1 })] },
    { edges: [...observation.graph.edges, edge("other", "origin", "references", { path: "other.js", line: 1, column: 0 })] }
  ]) {
    throwsExact(
      "invalid_impact_traversal",
      "Invalid Impact v2 traversal input.",
      () => composeProjectImpact(request, { ...observation, graph: { ...observation.graph, ...patch } })
    );
  }

  const terminal = fixture({ files: [source("origin.js")], nodes: [], edges: [], status: "unsupported", provider: null });
  throwsInvalidObservation(() => composeProjectImpact(request, {
    ...terminal,
    graph: { ...terminal.graph, nodes: [node("private", "origin.js")], diagnostics: [{ message: "must not leak" }] }
  }));
  throwsExact(
    "impact_budget_exceeded",
    "Impact v2 result cannot fit the requested compact byte budget.",
    () => composeProjectImpact(request, observation)
  );
});

test("T8 requested mode remains pure, deterministic and leak-free while direct traversal stays not requested", () => {
  const observation = deepFreeze(fixture({
    files: [source("a.js"), source("b.js"), source("tests/live.test.js")],
    nodes: [node("a", "a.js"), node("b", "b.js"), node("test", "tests/live.test.js")],
    edges: [edge("test", "a"), edge("test", "b")]
  }));
  const request = deepFreeze({ paths: ["b.js", "a.js"], includeTests: true });
  const first = composeProjectImpact(request, observation);
  const second = composeProjectImpact(request, observation);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(first).includes("must not leak"), false);
  assert.equal(JSON.stringify(first).includes("absolutePath"), false);
  assert.equal(JSON.stringify(first).includes("export const"), false);
  assert.equal(JSON.stringify(first).includes("attempts"), false);

  const direct = analyzeSingleFileReverseImpact({
    originPath: "a.js", snapshot: observation.snapshot, graph: observation.graph, sourceFiles: observation.snapshot.files
  });
  assert.deepEqual(direct.affectedTests, { status: "not_requested", candidates: [] });
});
