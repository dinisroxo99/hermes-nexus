import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectOverview } from "../src/lib/project-overview.js";
import { getProjectByNameForIntelligence } from "../src/lib/projects.js";

function makeTempRoot(prefix = "project-overview-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
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
