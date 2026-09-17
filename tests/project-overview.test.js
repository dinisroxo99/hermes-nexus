import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectOverview } from "../src/lib/project-overview.js";
import { getProjectByNameForIntelligence } from "../src/lib/projects.js";
import { getCachedAnalysis, invalidateAnalysisCache } from "../src/lib/analysis-cache.js";
import { gitFixture } from "./helpers/git-fixture.js";

test("overview exposes stable identity and safe Git evidence without internal paths", (t) => {
  const f = gitFixture(t);
  const overview = buildProjectOverview(f.project, { now: "2026-01-01T00:00:00Z" });
  assert.equal(overview.project.projectId, "PrJ_Fixture");
  assert.equal(overview.revision.commitSha, f.git(["rev-parse", "HEAD"]));
  assert.equal(overview.revision.capturedAt, "2026-01-01T00:00:00Z");
  assert.equal(overview.revision.dirty, false);
  assert.equal(Object.hasOwn(overview.revision, "evidence"), false);
  assert.equal(JSON.stringify(overview).includes(f.root), false);
  f.git(["checkout", "--detach"]);
  assert.equal(buildProjectOverview(f.project).revision.branch, null);
});

test("overview matches exact cached identity and rejects stale HEAD or dirty state", (t) => {
  const f = gitFixture(t);
  f.write("tsconfig.json", "{}\n");
  f.commit();
  invalidateAnalysisCache();
  t.after(() => invalidateAnalysisCache());
  const cache = () => getCachedAnalysis(f.project, { projectType: "typescript", fileExtensions: [".ts"] }, {}, () => ({ nodes: [], edges: [] }));
  cache();
  assert.equal(buildProjectOverview(f.project).analysis.status, "fresh");
  assert.equal(buildProjectOverview(f.project).statistics.nodeCount, 0);
  assert.equal(buildProjectOverview({ ...f.project, projectId: "PrJ_Other" }).analysis.status, "not_analyzed");
  f.git(["commit", "--allow-empty", "--no-gpg-sign", "-m", "new revision"]);
  assert.equal(buildProjectOverview(f.project).analysis.status, "not_analyzed");
  cache();
  f.write("src/source.ts", "export const dirty = 1;\n");
  const dirty = buildProjectOverview(f.project);
  assert.equal(dirty.revision.dirty, true);
  assert.equal(dirty.analysis.status, "not_analyzed");
  assert.equal(dirty.statistics.nodeCount, null);
});

test("overview preserves legacy non-Git identity and rejects cache path-prefix collisions", (t) => {
  const root = makeTempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = makeProject(root, "legacy");
  writeJson(path.join(project.absolutePath, "package.json"), {});
  const overview = buildProjectOverview(project, { getAnalysisCacheStats: () => ({ entries: [{
    project: "legacy", projectType: "nodejs", key: `legacy:nodejs:${project.absolutePath}-other`, expiresInMs: 300000, nodeCount: 99
  }] }) });
  assert.equal(overview.project.projectId, null);
  assert.equal(overview.revision.status, "not_git");
  assert.equal(overview.analysis.status, "not_analyzed");
});

function makeTempRoot(prefix = "project-overview-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("overview reports unborn and unavailable Git without claiming a clean revision", (t) => {
  const f = gitFixture(t, { committed: false });
  const unborn = buildProjectOverview(f.project);
  assert.equal(unborn.revision.status, "unborn");
  assert.equal(unborn.revision.commitSha, null);
  const broken = path.join(f.root, "broken");
  fs.mkdirSync(broken);
  fs.writeFileSync(path.join(broken, ".git"), "gitdir: /private/unreachable-metadata\n");
  const unavailable = buildProjectOverview({ ...f.project, absolutePath: broken });
  assert.equal(unavailable.revision.status, "unavailable");
  assert.equal(unavailable.revision.dirty, null);
  assert.equal(unavailable.analysis.status, "not_analyzed");
  assert.equal(JSON.stringify(unavailable).includes("/private"), false);
});

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(project, relativePath, contents) {
  const filePath = path.join(project.absolutePath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeAgent(project, relativePath = "engineering/backend/AGENT.md", workspaceId = "sample-backend") {
  writeText(project, relativePath, `---
schemaVersion: 1
workspace:
  id: ${workspaceId}
  project: ${project.name}
executor:
  required: sample-backend-engineer
owner:
  agent: sample-backend-architect
reviewers:
  - sample-review
permissions:
  read: true
  write: true
scope:
  include:
    - src/backend/**
routing:
  success:
    agent: sample-review
---

# Backend Workspace

SUPER_SECRET_CONTEXT_SENTINEL from AGENT instructions.
`);
}

function makeProject(root, name, extra = {}) {
  const absolutePath = path.join(root, name);
  fs.mkdirSync(absolutePath, { recursive: true });
  return {
    name,
    rootId: extra.rootId || "default",
    relativePath: name,
    registrySource: extra.registrySource || "manual",
    absolutePath
  };
}

test("buildProjectOverview returns bounded TypeScript identity, stack and architecture without absolute paths", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-service", { registrySource: "discovered" });
  writeJson(path.join(project.absolutePath, "package.json"), {
    type: "module",
    scripts: {
      start: "node src/server.js",
      test: "node --test",
      check: "node --check src/server.js",
      lint: "eslint .",
      "test:unit": "node --test tests/*.test.ts",
      deploy: "ship-it"
    },
    dependencies: {
      express: "^5.0.0",
      react: "^19.0.0"
    }
  });
  fs.writeFileSync(path.join(project.absolutePath, "package-lock.json"), "{}\n");
  writeJson(path.join(project.absolutePath, "tsconfig.json"), { compilerOptions: {} });
  fs.mkdirSync(path.join(project.absolutePath, "src"), { recursive: true });
  fs.writeFileSync(path.join(project.absolutePath, "src", "server.ts"), "export function start() {}\n");
  fs.mkdirSync(path.join(project.absolutePath, "tests"), { recursive: true });
  fs.writeFileSync(path.join(project.absolutePath, "tests", "server.test.ts"), "import test from 'node:test';\n");

  const overview = buildProjectOverview(project, { now: "2026-09-12T00:00:00.000Z" });

  assert.equal(overview.schemaVersion, 1);
  assert.equal(overview.bounded, true);
  assert.deepEqual(overview.project, {
    projectId: null,
    name: "sample-service",
    rootId: "default",
    relativePath: "sample-service",
    projectType: "typescript",
    typeLabel: "TypeScript",
    supported: true,
    registrySource: "discovered"
  });
  assert.deepEqual(overview.stack.languages, ["JavaScript", "TypeScript"]);
  assert.deepEqual(overview.stack.frameworks, ["express", "react"]);
  assert.equal(overview.stack.packageManager, "npm");
  assert.ok(overview.stack.scripts.some((script) => script.name === "start" && script.command === "node src/server.js"));
  assert.deepEqual(overview.architecture.entryPoints, ["src/server.ts"]);
  assert.deepEqual(
    overview.architecture.testCommands.map((script) => script.name),
    ["check", "lint", "test", "test:unit"]
  );
  assert.equal(overview.statistics.sourceFileCount, 2);
  assert.equal(overview.statistics.nodeCount, null);
  assert.equal(overview.statistics.edgeCount, null);
  assert.equal(overview.analysis.status, "not_analyzed");
  assert.equal(overview.analysis.lastAnalyzedAt, null);
  assert.deepEqual(overview.analyzers.map((analyzer) => analyzer.projectType), ["typescript"]);
  assert.deepEqual(overview.warnings, []);
  assert.equal(JSON.stringify(overview).includes(root), false);
  assert.equal(JSON.stringify(overview).includes(project.absolutePath), false);
});

test("buildProjectOverview distinguishes not analyzed null counts from analyzed zero counts", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-service");
  writeJson(path.join(project.absolutePath, "package.json"), { type: "module" });
  writeJson(path.join(project.absolutePath, "tsconfig.json"), { compilerOptions: {} });

  const notAnalyzed = buildProjectOverview(project, {
    getAnalysisCacheStats: () => ({ entries: [] })
  });
  assert.equal(notAnalyzed.analysis.status, "not_analyzed");
  assert.equal(notAnalyzed.statistics.nodeCount, null);
  assert.equal(notAnalyzed.statistics.edgeCount, null);

  const zeroGraph = buildProjectOverview(project, {
    getAnalysisCacheStats: () => ({
      entries: [{
        key: `sample-service:typescript:${project.absolutePath}`,
        project: "sample-service",
        projectType: "typescript",
        expiresInMs: 300000,
        nodeCount: 0,
        edgeCount: 0
      }]
    })
  });
  assert.equal(zeroGraph.analysis.status, "fresh");
  assert.equal(zeroGraph.statistics.nodeCount, 0);
  assert.equal(zeroGraph.statistics.edgeCount, 0);
});

test("buildProjectOverview uses deterministic package-manager precedence", () => {
  const root = makeTempRoot();

  const fromMetadata = makeProject(root, "metadata-service");
  writeJson(path.join(fromMetadata.absolutePath, "package.json"), { packageManager: "pnpm@10.0.0" });
  fs.writeFileSync(path.join(fromMetadata.absolutePath, "package-lock.json"), "{}\n");
  assert.equal(buildProjectOverview(fromMetadata).stack.packageManager, "pnpm");

  const fromPackageLock = makeProject(root, "npm-service");
  writeJson(path.join(fromPackageLock.absolutePath, "package.json"), {});
  fs.writeFileSync(path.join(fromPackageLock.absolutePath, "package-lock.json"), "{}\n");
  assert.equal(buildProjectOverview(fromPackageLock).stack.packageManager, "npm");

  const fromPnpmLock = makeProject(root, "pnpm-service");
  writeJson(path.join(fromPnpmLock.absolutePath, "package.json"), {});
  fs.writeFileSync(path.join(fromPnpmLock.absolutePath, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  assert.equal(buildProjectOverview(fromPnpmLock).stack.packageManager, "pnpm");

  const fromYarnLock = makeProject(root, "yarn-service");
  writeJson(path.join(fromYarnLock.absolutePath, "package.json"), {});
  fs.writeFileSync(path.join(fromYarnLock.absolutePath, "yarn.lock"), "# yarn\n");
  assert.equal(buildProjectOverview(fromYarnLock).stack.packageManager, "yarn");

  const unknown = makeProject(root, "unknown-manager-service");
  writeJson(path.join(unknown.absolutePath, "package.json"), {});
  assert.equal(buildProjectOverview(unknown).stack.packageManager, "unknown");
});

test("buildProjectOverview bounds growing lists deterministically", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-monorepo");
  const scripts = Object.fromEntries(Array.from({ length: 75 }, (_, index) => [`script-${String(index).padStart(2, "0")}`, `run-${index}`]));
  scripts.test = "node --test";
  scripts["test:unit"] = "node --test tests/unit";
  scripts["test:integration"] = "node --test tests/integration";
  scripts.check = "node --check src/index.js";
  scripts.lint = "eslint .";
  writeJson(path.join(project.absolutePath, "package.json"), { scripts });
  fs.mkdirSync(path.join(project.absolutePath, "src"), { recursive: true });
  for (let index = 0; index < 30; index += 1) {
    fs.writeFileSync(path.join(project.absolutePath, "src", `feature-${String(index).padStart(2, "0")}.js`), "export {};\n");
  }

  const overview = buildProjectOverview(project);

  assert.equal(overview.stack.scripts.length, 50);
  assert.ok(overview.architecture.features.length <= 20);
  assert.ok(overview.architecture.layers.length <= 20);
  assert.ok(overview.architecture.entryPoints.length <= 20);
  assert.ok(overview.architecture.testCommands.length <= 20);
  assert.ok(overview.warnings.length <= 20);
});

test("buildProjectOverview reports unsupported projects without failing", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-unsupported");
  fs.writeFileSync(path.join(project.absolutePath, "README.md"), "# sample\n");

  const overview = buildProjectOverview(project);

  assert.equal(overview.project.projectType, "unknown");
  assert.equal(overview.project.supported, false);
  assert.deepEqual(overview.stack.languages, []);
  assert.deepEqual(overview.analyzers, []);
  assert.ok(overview.warnings.some((warning) => warning.code === "unsupported_project_type"));
});

test("buildProjectOverview keeps malformed package.json warnings bounded and avoids false metadata", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-service");
  fs.writeFileSync(path.join(project.absolutePath, "package.json"), "{not-json\n");
  fs.writeFileSync(path.join(project.absolutePath, "package-lock.json"), "{}\n");

  const overview = buildProjectOverview(project);

  assert.equal(overview.stack.packageManager, "npm");
  assert.deepEqual(overview.stack.frameworks, []);
  assert.deepEqual(overview.stack.scripts, []);
  assert.ok(overview.warnings.some((warning) => warning.code === "malformed_package_json"));
  assert.ok(overview.warnings.length <= 20);
});

test("buildProjectOverview summarizes valid ICM without returning ICM content or machine contracts", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-project");
  writeJson(path.join(project.absolutePath, "package.json"), { name: "sample-project" });
  writeText(project, "PROJECT.md", "# Sample Project\n\nSUPER_SECRET_CONTEXT_SENTINEL project context.\n");
  writeText(project, "AGENTS.md", "# Agents\n\nSUPER_SECRET_CONTEXT_SENTINEL agents context.\n");
  writeAgent(project);
  writeText(project, "engineering/backend/CONTEXT.md", "# Context\n\nSUPER_SECRET_CONTEXT_SENTINEL domain context.\n");

  const overview = buildProjectOverview(project);

  assert.deepEqual(overview.icm, {
    status: "available",
    valid: true,
    workspaceCount: 1,
    documentCount: 3,
    errorCount: 0,
    warningCount: 0,
    truncated: {
      workspaces: false,
      documents: false
    }
  });
  const serialized = JSON.stringify(overview);
  assert.equal(serialized.includes("SUPER_SECRET_CONTEXT_SENTINEL"), false);
  assert.equal(serialized.includes("sample-backend-engineer"), false);
  assert.equal(serialized.includes("engineering/backend/AGENT.md"), false);
  assert.equal(Object.hasOwn(overview.icm, "workspaces"), false);
  assert.equal(Object.hasOwn(overview.icm, "documents"), false);
});

test("buildProjectOverview reports not_configured when no ICM files exist", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-project");
  writeJson(path.join(project.absolutePath, "package.json"), { name: "sample-project" });

  const overview = buildProjectOverview(project);

  assert.deepEqual(overview.icm, {
    status: "not_configured",
    valid: true,
    workspaceCount: 0,
    documentCount: 0,
    errorCount: 0,
    warningCount: 0,
    truncated: {
      workspaces: false,
      documents: false
    }
  });
});

test("buildProjectOverview reports invalid when authoritative workspace ICM is invalid", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-project");
  writeJson(path.join(project.absolutePath, "package.json"), { name: "sample-project" });
  writeAgent(project, "engineering/backend/AGENT.md", "sample-backend");
  writeAgent(project, "engineering/frontend/AGENT.md", "sample-backend");

  const overview = buildProjectOverview(project);

  assert.equal(overview.icm.status, "invalid");
  assert.equal(overview.icm.valid, false);
  assert.equal(overview.icm.workspaceCount, 0);
  assert.equal(overview.icm.errorCount, 1);
  assert.equal(JSON.stringify(overview).includes("sample-backend-engineer"), false);
});

test("buildProjectOverview keeps context document issues non-fatal when Project ICM remains valid", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-project");
  writeJson(path.join(project.absolutePath, "package.json"), { name: "sample-project" });
  writeAgent(project);
  writeText(project, "CONTEXT.md", "# Oversized\n" + "x".repeat(128 * 1024 + 1));

  const overview = buildProjectOverview(project);

  assert.equal(overview.icm.status, "available");
  assert.equal(overview.icm.valid, true);
  assert.equal(overview.icm.workspaceCount, 1);
  assert.equal(overview.icm.documentCount, 0);
  assert.equal(overview.icm.errorCount, 1);
});

test("buildProjectOverview uses conservative ICM options and reports independent truncation", () => {
  const root = makeTempRoot();
  const project = makeProject(root, "sample-project");
  writeJson(path.join(project.absolutePath, "package.json"), { name: "sample-project" });
  writeAgent(project, "a/AGENT.md", "sample-a");
  writeAgent(project, "b/AGENT.md", "sample-b");
  writeText(project, "a/AGENTS.md", "# A\nSUPER_SECRET_CONTEXT_SENTINEL\n");
  writeText(project, "b/AGENTS.md", "# B\nSUPER_SECRET_CONTEXT_SENTINEL\n");

  const overview = buildProjectOverview(project, {
    icmOptions: {
      workspace: { maxWorkspaces: 1 },
      documents: { maxDocuments: 1 }
    }
  });

  assert.equal(overview.icm.workspaceCount, 1);
  assert.equal(overview.icm.documentCount, 1);
  assert.deepEqual(overview.icm.truncated, {
    workspaces: true,
    documents: true
  });
  assert.equal(JSON.stringify(overview).includes("SUPER_SECRET_CONTEXT_SENTINEL"), false);
});

test("getProjectByNameForIntelligence resolves discovered entries with runtime registry metadata", () => {
  const root = makeTempRoot();
  const registryDir = makeTempRoot("project-overview-registry-");
  makeOverviewCandidate(root, "sample-service");
  writeJson(path.join(registryDir, "projects.json"), []);
  writeJson(path.join(registryDir, "discovered-projects.json"), [{
    name: "sample-service",
    rootId: "work",
    relativePath: "sample-service",
    source: "discovered"
  }]);

  const project = getProjectByNameForIntelligence("sample-service", {
    roots: [{ id: "work", path: root }],
    manualProjectsFile: path.join(registryDir, "projects.json"),
    discoveredProjectsFile: path.join(registryDir, "discovered-projects.json")
  });

  assert.equal(project.name, "sample-service");
  assert.equal(project.rootId, "work");
  assert.equal(project.relativePath, "sample-service");
  assert.equal(project.registrySource, "discovered");
  assert.equal(project.absolutePath, path.join(root, "sample-service"));
});

function makeOverviewCandidate(root, name) {
  const absolutePath = path.join(root, name);
  fs.mkdirSync(absolutePath, { recursive: true });
  writeJson(path.join(absolutePath, "package.json"), { name });
  return absolutePath;
}
