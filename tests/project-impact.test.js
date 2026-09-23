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

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

test("C1 composes a pure immutable single-target observation and locally gates later request slices", () => {
  const observation = deepFreeze(fixture());
  const request = deepFreeze({ paths: [" origin.js/ ", "origin.js"], includeTests: false });
  const result = composeProjectImpact(request, observation);
  assert.equal(result.originPath, "origin.js");
  assert.equal(result.generatedAt, null);
  assert.deepEqual(result.affectedTests, { status: "not_requested", candidates: [] });
  assert.doesNotThrow(() => normalizeImpactRequest({ paths: ["a.js", "b.js"], includeTests: true }));
  throwsCode("impact_request_not_supported", () => composeProjectImpact({ paths: ["a.js", "b.js"] }, observation));
  throwsCode("impact_request_not_supported", () => composeProjectImpact({ paths: ["origin.js"], includeTests: true }, observation));
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
