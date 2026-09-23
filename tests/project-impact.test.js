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

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

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
  throwsCode("impact_request_not_supported", () => composeProjectImpact({ paths: ["origin.js"], includeTests: true }, observation));
  throwsCode("impact_request_not_supported", () => composeProjectImpact({ paths: ["origin.js", "consumer.js"], includeTests: true }, observation));
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
