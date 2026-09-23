import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { analyzeContextSources } from "../src/lib/analyzer-service.js";
import { collectContextSources, contextDigest, normalizeContextSources } from "../src/lib/project-context-files.js";
import { composeProjectImpact } from "../src/lib/project-impact.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { readProjectRevision } from "../src/lib/project-revision.js";
import { getNestedProjectPaths, getProjectByIdForIntelligence } from "../src/lib/projects.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

function throwsCode(code, fn) {
  assert.throws(fn, (error) => error?.code === code);
}

function safeRevision(project) {
  const { capturedAt, ...revision } = readProjectRevision(project);
  return revision;
}

function observationFor(f, input) {
  const project = getProjectByIdForIntelligence(f.request.projectId, f.options.registry);
  const revision = safeRevision(project);
  const excludedPaths = getNestedProjectPaths(project, f.options.registry);
  const collected = collectContextSources(project, { excludedPaths });
  const snapshot = createProviderSnapshot(project, collected.files, revision);
  const graph = analyzeContextSources(project, snapshot.files, { revision: snapshot.revision });
  return {
    request: input,
    observation: {
      project: { projectId: project.projectId, rootId: project.rootId, relativePath: project.relativePath },
      snapshot,
      graph,
      sourceLimited: collected.truncated,
      sourceUnavailable: collected.files.length === 0 || collected.diagnostics.some(({ code }) => ["source_directory_unavailable", "source_unavailable", "source_changed"].includes(code))
    }
  };
}

function collected(files, extra = {}) {
  const normalized = normalizeContextSources(files);
  return {
    files: normalized,
    limits: {},
    truncated: false,
    diagnostics: [],
    digest: contextDigest(JSON.stringify(normalized.map((file) => [file.path, file.sha256]))),
    ...extra
  };
}

function stubOptions(f, overrides = {}) {
  const first = collected([
    { path: "src/one.ts", text: "export class One {}\n" },
    { path: "tests/one.test.ts", text: "import { One } from '../src/one'; export const used = One;\n" }
  ]);
  return {
    registry: f.options.registry,
    readRevision: () => ({ status: "not_git" }),
    collectSources: () => first,
    analyzeSources: (project, files, options) => analyzeContextSources(project, files, options),
    ...overrides
  };
}

test("buildProjectImpact composes the accepted result from the same bounded live observation", (t) => {
  const f = taskContextFixture(t);
  const input = { paths: ["src/one.ts"], includeTests: true };
  const expected = observationFor(f, input);
  assert.deepEqual(buildProjectImpact(f.request.projectId, input, f.options), composeProjectImpact(expected.request, expected.observation));
});

test("buildProjectImpact validates identity and request before registry, source, or provider IO", (t) => {
  const f = taskContextFixture(t);
  let calls = 0;
  const options = stubOptions(f, {
    collectSources: () => { calls += 1; throw new Error("must not run"); },
    analyzeSources: () => { calls += 1; throw new Error("must not run"); }
  });
  throwsCode("invalid_project_identity", () => buildProjectImpact("../other", { paths: ["src/one.ts"] }, options));
  throwsCode("invalid_impact_request", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"], graph: {} }, options));
  throwsCode("invalid_impact_request", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"], projectId: f.request.projectId }, options));
  assert.equal(calls, 0);
});

test("buildProjectImpact forwards trusted analyzer options after binding the actual revision", (t) => {
  const f = taskContextFixture(t);
  let supplied;
  const options = stubOptions(f, {
    analyzer: { serena: { image: `sha256:${"a".repeat(64)}` }, revision: { status: "forged" } },
    analyzeSources(project, files, analyzerOptions) {
      supplied = analyzerOptions;
      return analyzeContextSources(project, files, analyzerOptions);
    }
  });
  const result = buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options);
  assert.equal(result.projectId, f.request.projectId);
  assert.deepEqual(supplied.revision, createProviderSnapshot({ projectId: f.request.projectId }, options.collectSources().files, { status: "not_git" }).revision);
  assert.deepEqual(supplied.serena, { image: `sha256:${"a".repeat(64)}` });
});

test("buildProjectImpact reobserves exactly once after successful composition", (t) => {
  const f = taskContextFixture(t);
  let collections = 0;
  let revisions = 0;
  let analyses = 0;
  const options = stubOptions(f, {
    collectSources: () => { collections += 1; return collected([{ path: "src/one.ts", text: "export class One {}\n" }]); },
    readRevision: () => { revisions += 1; return { status: "not_git", capturedAt: `volatile-${revisions}` }; },
    analyzeSources(project, files, analyzerOptions) { analyses += 1; return analyzeContextSources(project, files, analyzerOptions); }
  });
  buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options);
  assert.deepEqual({ collections, revisions, analyses }, { collections: 2, revisions: 2, analyses: 1 });
});

test("buildProjectImpact fails closed on source digest, truncation, diagnostics, and source-stage exceptions", (t) => {
  for (const variant of ["digest", "truncated", "diagnostics", "throw"]) {
    const f = taskContextFixture(t);
    const initial = collected([{ path: "src/one.ts", text: "export class One {}\n" }]);
    let count = 0;
    const options = stubOptions(f, { collectSources: () => {
      count += 1;
      if (count === 1) return initial;
      if (variant === "throw") throw new Error("/private/source");
      if (variant === "digest") return { ...initial, digest: "changed" };
      if (variant === "truncated") return { ...initial, truncated: true };
      return { ...initial, diagnostics: [{ code: "source_limit" }] };
    } });
    throwsCode("impact_sources_changed", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options));
  }
});

test("buildProjectImpact checks revision before project identity and ignores capturedAt", (t) => {
  const f = taskContextFixture(t);
  let reads = 0;
  const stable = stubOptions(f, { readRevision: () => ({ status: "not_git", capturedAt: `time-${++reads}` }) });
  assert.equal(buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, stable).revision.status, "not_git");

  reads = 0;
  const changed = stubOptions(f, { readRevision: () => ({ status: ++reads === 1 ? "not_git" : "unavailable", capturedAt: `time-${reads}` }) });
  throwsCode("impact_revision_changed", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, changed));
});

test("buildProjectImpact detects project relocation and nested-exclusion races", (t) => {
  {
    const f = taskContextFixture(t);
    fs.mkdirSync(path.join(f.root, "relocated"));
    let reads = 0;
    const options = stubOptions(f, { readRevision: () => {
      reads += 1;
      if (reads === 2) fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([{ ...f.entries[0], relativePath: "relocated" }]));
      return { status: "not_git" };
    } });
    throwsCode("impact_project_changed", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options));
  }
  {
    const f = taskContextFixture(t);
    fs.mkdirSync(path.join(f.repo, "nested"));
    let reads = 0;
    const options = stubOptions(f, { readRevision: () => {
      reads += 1;
      if (reads === 2) fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
        ...f.entries,
        { name: "nested", rootId: "test", relativePath: "main/nested", projectId: "PrJ_Nested" }
      ]));
      return { status: "not_git" };
    } });
    throwsCode("impact_project_changed", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options));
  }
});

test("buildProjectImpact excludes registered nested project sources from provider evidence", (t) => {
  const f = taskContextFixture(t);
  f.write("nested/src/secret.ts", "export const CROSS_PROJECT_SENTINEL = true;\n");
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
    ...f.entries,
    { name: "nested", rootId: "test", relativePath: "main/nested", projectId: "PrJ_Nested" }
  ]));
  let observed = [];
  const result = buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, {
    ...f.options,
    analyzeSources(project, files, options) {
      observed = files.map((file) => file.path);
      return analyzeContextSources(project, files, options);
    }
  });
  assert.equal(result.projectId, f.request.projectId);
  assert.equal(observed.some((file) => file.startsWith("nested/")), false);
});

test("buildProjectImpact resolves a real linked worktree and rejects an unrelated checkout", (t) => {
  const f = taskContextFixture(t);
  const linked = f.worktree();
  const linkedResult = buildProjectImpact(f.request.projectId, {
    paths: ["src/one.ts"],
    worktree: { rootId: "test", relativePath: path.basename(linked) }
  }, f.options);
  assert.equal(linkedResult.revision.isLinkedWorktree, true);

  const unrelated = path.join(f.root, "unrelated");
  fs.mkdirSync(unrelated);
  f.git(["init", "--initial-branch=main"], unrelated);
  fs.writeFileSync(path.join(unrelated, "package.json"), "{}\n");
  fs.mkdirSync(path.join(unrelated, "src"));
  fs.writeFileSync(path.join(unrelated, "src", "one.ts"), "export class One {}\n");
  f.git(["add", "."], unrelated);
  f.git(["commit", "--no-gpg-sign", "-m", "unrelated"], unrelated);
  throwsCode("worktree_parent_mismatch", () => buildProjectImpact(f.request.projectId, {
    paths: ["src/one.ts"],
    worktree: { rootId: "test", relativePath: "unrelated" }
  }, f.options));
});

test("composition errors abort before all live reobservation stages", (t) => {
  const f = taskContextFixture(t);
  let collections = 0;
  let revisions = 0;
  const options = stubOptions(f, {
    collectSources: () => { collections += 1; return collected([{ path: "src/one.ts", text: "export class One {}\n" }]); },
    readRevision: () => { revisions += 1; return { status: "not_git" }; }
  });
  throwsCode("impact_budget_exceeded", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"], limits: { compactBytes: 1 } }, options));
  assert.deepEqual({ collections, revisions }, { collections: 1, revisions: 1 });
});
