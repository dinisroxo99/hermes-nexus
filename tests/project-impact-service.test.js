import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest } from "../src/analyzers/external/snapshot-provider.js";
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

test("buildProjectImpact isolates same-name projects by persisted ID and rejects unavailable IDs", (t) => {
  const f = taskContextFixture(t);
  const secondRoot = path.join(f.root, "second-root");
  const secondProject = path.join(secondRoot, "project");
  fs.mkdirSync(path.join(secondProject, "src"), { recursive: true });
  fs.writeFileSync(path.join(secondProject, "src", "two.ts"), "export class Two {}\n");
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
    ...f.entries,
    { name: "fixture", rootId: "second", relativePath: "project", projectId: "PrJ_Other" }
  ]));
  const registry = {
    ...f.options.registry,
    roots: [...f.options.registry.roots, { id: "second", path: secondRoot }]
  };
  let observed = [];
  const result = buildProjectImpact("PrJ_Other", { paths: ["src/two.ts"] }, {
    registry,
    analyzeSources(project, files, options) {
      observed = files.map((file) => file.path);
      return analyzeContextSources(project, files, options);
    }
  });
  assert.equal(result.projectId, "PrJ_Other");
  assert.deepEqual(result.project, { rootId: "second", relativePath: "project" });
  assert.deepEqual(observed, ["src/two.ts"]);
  throwsCode("project_not_found", () => buildProjectImpact("PrJ_Missing", { paths: ["src/two.ts"] }, { registry }));

  fs.rmSync(secondProject, { recursive: true });
  throwsCode("project_unavailable", () => buildProjectImpact("PrJ_Other", { paths: ["src/two.ts"] }, { registry }));
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

test("buildProjectImpact detects a genuine successive dirty-source mutation before later stages", (t) => {
  const f = taskContextFixture(t);
  f.write("src/one.ts", "export class One { dirtyVersion = 1; }\n");
  const calls = [];
  const project = getProjectByIdForIntelligence(f.request.projectId, f.options.registry);
  const excludedPaths = getNestedProjectPaths(project, f.options.registry);
  let collections = 0;
  const options = {
    ...f.options,
    readRevision(selected) { calls.push("revision"); return safeRevision(selected); },
    collectSources(selected, sourceOptions) {
      collections += 1;
      calls.push(`collect:${collections}`);
      return collectContextSources(selected, sourceOptions);
    },
    analyzeSources(selected, files, analyzerOptions) {
      calls.push("analyze");
      const graph = analyzeContextSources(selected, files, analyzerOptions);
      f.write("src/one.ts", "export class One { dirtyVersion = 2; }\n");
      return graph;
    }
  };
  throwsCode("impact_sources_changed", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options));
  assert.deepEqual(calls, ["revision", "collect:1", "analyze", "collect:2"]);
  assert.deepEqual(excludedPaths, []);
});

test("buildProjectImpact preserves source then revision then project race precedence and stage call order", (t) => {
  for (const winner of ["source", "revision", "project"]) {
    const f = taskContextFixture(t);
    const calls = [];
    const initial = collected([{ path: "src/one.ts", text: "export class One {}\n" }]);
    let collections = 0;
    let revisions = 0;
    const options = stubOptions(f, {
      collectSources() {
        calls.push(`collect:${++collections}`);
        return winner === "source" && collections === 2 ? { ...initial, digest: "changed" } : initial;
      },
      readRevision() {
        calls.push(`revision:${++revisions}`);
        if (revisions === 2 && ["revision", "project"].includes(winner)) {
          fs.writeFileSync(f.options.registry.manualProjectsFile, "[]");
        }
        return { status: ["source", "revision"].includes(winner) && revisions === 2 ? "unavailable" : "not_git" };
      },
      analyzeSources(project, files, analyzerOptions) {
        calls.push("analyze");
        if (winner === "source") fs.writeFileSync(f.options.registry.manualProjectsFile, "[]");
        return analyzeContextSources(project, files, analyzerOptions);
      }
    });
    throwsCode(`impact_${winner === "source" ? "sources" : winner}_changed`, () => {
      buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options);
    });
    assert.deepEqual(calls, winner === "source"
      ? ["revision:1", "collect:1", "analyze", "collect:2"]
      : ["revision:1", "collect:1", "analyze", "collect:2", "revision:2"]);
  }
});

test("buildProjectImpact maps a second revision-reader exception to the revision race", (t) => {
  const f = taskContextFixture(t);
  const calls = [];
  let reads = 0;
  const options = stubOptions(f, {
    collectSources() { calls.push("collect"); return collected([{ path: "src/one.ts", text: "export class One {}\n" }]); },
    readRevision() {
      calls.push(`revision:${++reads}`);
      if (reads === 2) throw new Error("/private/git failure");
      return { status: "not_git" };
    },
    analyzeSources(project, files, analyzerOptions) {
      calls.push("analyze");
      return analyzeContextSources(project, files, analyzerOptions);
    }
  });
  throwsCode("impact_revision_changed", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options));
  assert.deepEqual(calls, ["revision:1", "collect", "analyze", "collect", "revision:2"]);
});

test("buildProjectImpact maps removed and conflicting registrations during identity re-resolution", (t) => {
  for (const registration of ["removed", "conflicting"]) {
    const f = taskContextFixture(t);
    let reads = 0;
    const options = stubOptions(f, { readRevision: () => {
      if (++reads === 2) {
        fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify(registration === "removed" ? [] : [
          ...f.entries,
          { ...f.entries[0], name: "duplicate", relativePath: "other" }
        ]));
      }
      return { status: "not_git" };
    } });
    throwsCode("impact_project_changed", () => buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, options));
  }
});

test("buildProjectImpact maps stable empty, limited, and descriptor-unavailable collections truthfully", (t) => {
  const cases = [
    ["empty", collected([]), ["source_unavailable"], "not_evaluated"],
    ["limited", collected([{ path: "src/one.ts", text: "export class One {}\n" }], { truncated: true }), ["source_limit"], "no_evidence_found"],
    ["descriptor-unavailable", collected([], { diagnostics: [{ code: "source_changed" }] }), ["source_unavailable"], "not_evaluated"]
  ];
  for (const [label, observation, expected, findingState] of cases) {
    const f = taskContextFixture(t);
    const result = buildProjectImpact(f.request.projectId, { paths: ["src/one.ts"] }, stubOptions(f, {
      collectSources: () => observation
    }));
    assert.deepEqual(result.completeness.source, expected, label);
    assert.equal(result.observation.incomplete, true, label);
    assert.equal(result.findingState, findingState, label);
  }
});

test("buildProjectImpact consumes labelled bound external Python evidence and preserves partial/fallback truth", (t) => {
  const descriptor = {
    id: "external.python.fixture",
    version: "1",
    kind: "external",
    priority: 50,
    languages: ["python"],
    capabilities: {
      symbols: "semantic",
      boundedSourceAnalysis: "structural",
      definitions: "semantic",
      references: "semantic",
      dependencies: "unsupported",
      implementations: "unsupported",
      diagnostics: "semantic"
    }
  };
  for (const mode of ["partial", "invalid-fallback"]) {
    const f = taskContextFixture(t);
    const source = collected([
      { path: "origin.py", text: "class Origin: pass\n" },
      { path: "consumer.py", text: "def use(): return Origin()\n" }
    ]);
    const project = getProjectByIdForIntelligence(f.request.projectId, f.options.registry);
    const snapshot = createProviderSnapshot(project, source.files, { status: "not_git" });
    const request = createExternalSnapshotRequest(snapshot, descriptor);
    const response = JSON.stringify({
      schemaVersion: 1,
      projectId: snapshot.projectId,
      snapshotToken: snapshot.token,
      requestToken: request.requestToken,
      providerId: descriptor.id,
      providerVersion: descriptor.version,
      status: "partial",
      nodes: [
        { id: "origin", label: "Origin", file: "origin.py", kind: "class", line: 1 },
        { id: "consumer", label: "use", file: "consumer.py", kind: "function", line: 1 }
      ],
      edges: [{ from: "consumer", to: "origin", relation: "references", location: { path: "consumer.py", line: 1, column: 1 } }],
      definitions: [],
      implementations: [],
      diagnostics: []
    });
    const result = buildProjectImpact(f.request.projectId, { paths: ["origin.py"] }, stubOptions(f, {
      collectSources: () => source,
      analyzer: {
        requiredLanguages: ["python"],
        externalProviders: [descriptor],
        externalResponses: { [descriptor.id]: mode === "partial" ? response : "invalid JSON" }
      },
      analyzeSources: analyzeContextSources
    }));
    if (mode === "partial") {
      assert.deepEqual(result.provider, { id: descriptor.id, version: descriptor.version });
      assert.equal(result.status, "partial");
      assert.deepEqual(result.completeness.provider, ["provider_partial"]);
      assert.equal(result.affectedFiles[0].origins[0].witness.trust, "untrusted_external_analysis");
      assert.equal(result.affectedFiles[0].origins[0].witness.basis, "semantic");
    } else {
      assert.equal(result.provider, null);
      assert.equal(result.status, "unavailable");
      assert.deepEqual(result.completeness.provider, ["provider_partial"]);
    }
  }
});

test("linked worktree observation uses selected sources and both selected/canonical registered exclusions", (t) => {
  const f = taskContextFixture(t);
  const linked = f.worktree();
  fs.writeFileSync(path.join(linked, "src", "one.ts"), "export class SelectedOnly {}\n");
  fs.mkdirSync(path.join(linked, "selected-nested", "src"), { recursive: true });
  fs.writeFileSync(path.join(linked, "selected-nested", "src", "secret.ts"), "export const SELECTED_SENTINEL = true;\n");
  f.write("canonical-nested/src/secret.ts", "export const CANONICAL_SENTINEL = true;\n");
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
    ...f.entries,
    { name: "canonical nested", rootId: "test", relativePath: "main/canonical-nested", projectId: "PrJ_CanonicalNested" },
    { name: "selected nested", rootId: "test", relativePath: `${path.basename(linked)}/selected-nested`, projectId: "PrJ_SelectedNested" }
  ]));
  const seen = { exclusions: [], files: [] };
  const request = {
    paths: ["src/one.ts"],
    worktree: { rootId: "test", relativePath: path.basename(linked) }
  };
  const result = buildProjectImpact(f.request.projectId, request, {
    ...f.options,
    collectSources(project, options) {
      seen.exclusions.push(options.excludedPaths);
      return collectContextSources(project, options);
    },
    analyzeSources(project, files, options) {
      seen.files = files.map((file) => [file.path, file.text]);
      return analyzeContextSources(project, files, options);
    }
  });
  assert.equal(result.revision.isLinkedWorktree, true);
  assert.equal(seen.files.some(([name, text]) => name === "src/one.ts" && text.includes("SelectedOnly")), true);
  assert.equal(seen.files.some(([, text]) => text.includes("SENTINEL")), false);
  assert.deepEqual(seen.exclusions, [
    ["canonical-nested", "selected-nested"],
    ["canonical-nested", "selected-nested"]
  ]);
});

test("linked worktree re-resolution rejects selected/canonical parent identity changes", (t) => {
  {
    const f = taskContextFixture(t);
    const linked = f.worktree();
    const relocated = path.join(f.root, "relocated-parent");
    fs.mkdirSync(relocated);
    let reads = 0;
    const options = {
      ...f.options,
      readRevision(project) {
        if (++reads === 2) {
          fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
            { ...f.entries[0], relativePath: "relocated-parent" }
          ]));
        }
        return safeRevision(project);
      }
    };
    throwsCode("impact_project_changed", () => buildProjectImpact(f.request.projectId, {
      paths: ["src/one.ts"],
      worktree: { rootId: "test", relativePath: path.basename(linked) }
    }, options));
  }

  {
    const f = taskContextFixture(t);
    const linked = f.worktree();
    const alternateRoot = path.join(f.root, "alternate");
    fs.mkdirSync(alternateRoot);
    f.worktree("alternate/main");
    f.worktree("alternate/linked");
    let reads = 0;
    const options = {
      ...f.options,
      readRevision(project) {
        const revision = safeRevision(project);
        if (++reads === 2) options.registry.roots[0].path = alternateRoot;
        return revision;
      }
    };
    throwsCode("impact_project_changed", () => buildProjectImpact(f.request.projectId, {
      paths: ["src/one.ts"],
      worktree: { rootId: "test", relativePath: path.basename(linked) }
    }, options));
  }
});
