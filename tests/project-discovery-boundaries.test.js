import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { discoverProjectBoundaries } from "../src/lib/project-discovery.js";

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "project-map-boundaries-"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function candidateNames(result) {
  return result.candidates.map((candidate) => candidate.name);
}

test("classifies a standalone TypeScript repository as one top-level candidate", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-service");

  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  writeJson(path.join(repo, "package.json"), { type: "module" });
  writeJson(path.join(repo, "tsconfig.json"), { compilerOptions: {} });
  fs.writeFileSync(path.join(repo, "src", "server.ts"), "export function start() {}\n");

  const result = discoverProjectBoundaries({ rootPath: root, rootId: "default" });

  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0], {
    name: "sample-service",
    rootId: "default",
    relativePath: "sample-service",
    boundaryKind: "repository",
    projectType: "typescript",
    signals: [".git", "package.json", "tsconfig.json"],
    modules: []
  });
});

test("classifies csproj files under a .NET solution as modules, not top-level projects", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-dotnet-solution");

  fs.mkdirSync(path.join(repo, "src", "Sample.Api"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "Sample.Domain"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "Sample.Infrastructure"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tests", "Sample.Tests"), { recursive: true });
  fs.writeFileSync(path.join(repo, "Sample.sln"), "solution\n");
  fs.writeFileSync(path.join(repo, "src", "Sample.Api", "Sample.Api.csproj"), "<Project />\n");
  fs.writeFileSync(path.join(repo, "src", "Sample.Domain", "Sample.Domain.csproj"), "<Project />\n");
  fs.writeFileSync(path.join(repo, "src", "Sample.Infrastructure", "Sample.Infrastructure.csproj"), "<Project />\n");
  fs.writeFileSync(path.join(repo, "tests", "Sample.Tests", "Sample.Tests.csproj"), "<Project />\n");

  const result = discoverProjectBoundaries({ rootPath: root, rootId: "default" });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "sample-dotnet-solution");
  assert.equal(result.candidates[0].boundaryKind, "repository");
  assert.equal(result.candidates[0].projectType, "dotnet");
  assert.deepEqual(result.candidates[0].signals, ["Sample.sln"]);
  assert.deepEqual(result.candidates[0].modules, [
    { path: "src/Sample.Api/Sample.Api.csproj", kind: "dotnet-project" },
    { path: "src/Sample.Domain/Sample.Domain.csproj", kind: "dotnet-project" },
    { path: "src/Sample.Infrastructure/Sample.Infrastructure.csproj", kind: "dotnet-project" },
    { path: "tests/Sample.Tests/Sample.Tests.csproj", kind: "dotnet-project" }
  ]);
});

test("classifies workspace packages as modules of one monorepo candidate", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-monorepo");

  fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true });
  fs.mkdirSync(path.join(repo, "packages", "shared"), { recursive: true });
  writeJson(path.join(repo, "package.json"), {
    private: true,
    workspaces: ["apps/*", "packages/*"]
  });
  fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
  writeJson(path.join(repo, "apps", "web", "package.json"), { name: "web" });
  writeJson(path.join(repo, "packages", "shared", "package.json"), { name: "shared" });

  const result = discoverProjectBoundaries({ rootPath: root, rootId: "default" });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].name, "sample-monorepo");
  assert.equal(result.candidates[0].boundaryKind, "repository");
  assert.deepEqual(result.candidates[0].modules, [
    { path: "apps/web", kind: "node-workspace" },
    { path: "packages/shared", kind: "node-workspace" }
  ]);
});

test("classifies nested repositories as independent only when not declared workspace modules", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-monorepo");

  fs.mkdirSync(path.join(repo, "packages", "shared"), { recursive: true });
  fs.mkdirSync(path.join(repo, "tools", "nested-tool", ".git"), { recursive: true });
  writeJson(path.join(repo, "package.json"), {
    private: true,
    workspaces: ["packages/*"]
  });
  writeJson(path.join(repo, "packages", "shared", "package.json"), { name: "shared" });
  writeJson(path.join(repo, "tools", "nested-tool", "package.json"), { name: "nested-tool" });
  writeJson(path.join(repo, "tools", "nested-tool", "tsconfig.json"), { compilerOptions: {} });

  const result = discoverProjectBoundaries({ rootPath: root, rootId: "default" });

  assert.deepEqual(candidateNames(result), ["sample-monorepo", "nested-tool"]);
  assert.deepEqual(result.candidates[0].modules, [
    { path: "packages/shared", kind: "node-workspace" }
  ]);
  assert.equal(result.candidates[1].relativePath, "sample-monorepo/tools/nested-tool");
  assert.equal(result.candidates[1].boundaryKind, "repository");
});

test("ignores project signals inside generated and dependency directories", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-service");

  fs.mkdirSync(path.join(repo, "node_modules", "fake-project"), { recursive: true });
  fs.mkdirSync(path.join(repo, "dist", "fake-dist"), { recursive: true });
  fs.mkdirSync(path.join(repo, "build", "fake-build"), { recursive: true });
  fs.mkdirSync(path.join(repo, "coverage", "fake-coverage"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".next", "fake-next"), { recursive: true });
  fs.mkdirSync(path.join(repo, "bin", "fake-bin"), { recursive: true });
  fs.mkdirSync(path.join(repo, "obj", "fake-obj"), { recursive: true });
  writeJson(path.join(repo, "package.json"), { type: "module" });
  writeJson(path.join(repo, "tsconfig.json"), { compilerOptions: {} });
  writeJson(path.join(repo, "node_modules", "fake-project", "package.json"), { name: "fake-project" });
  writeJson(path.join(repo, "dist", "fake-dist", "package.json"), { name: "fake-dist" });
  writeJson(path.join(repo, "build", "fake-build", "package.json"), { name: "fake-build" });
  writeJson(path.join(repo, "coverage", "fake-coverage", "package.json"), { name: "fake-coverage" });
  writeJson(path.join(repo, ".next", "fake-next", "package.json"), { name: "fake-next" });
  fs.writeFileSync(path.join(repo, "bin", "fake-bin", "Fake.csproj"), "<Project />\n");
  fs.writeFileSync(path.join(repo, "obj", "fake-obj", "Fake.csproj"), "<Project />\n");

  const result = discoverProjectBoundaries({ rootPath: root, rootId: "default" });

  assert.deepEqual(candidateNames(result), ["sample-service"]);
  assert.deepEqual(result.candidates[0].modules, []);
});

test("does not follow symlinked directories when classifying boundaries", { skip: !canCreateSymlink() }, () => {
  const root = makeRoot();
  const external = makeRoot();
  const repo = path.join(root, "sample-service");

  fs.mkdirSync(repo, { recursive: true });
  writeJson(path.join(repo, "package.json"), { type: "module" });
  writeJson(path.join(repo, "tsconfig.json"), { compilerOptions: {} });
  fs.mkdirSync(path.join(external, "linked-project"), { recursive: true });
  writeJson(path.join(external, "linked-project", "package.json"), { name: "linked-project" });
  fs.symlinkSync(path.join(external, "linked-project"), path.join(repo, "linked-project"), "dir");

  const result = discoverProjectBoundaries({ rootPath: root, rootId: "default" });

  assert.deepEqual(candidateNames(result), ["sample-service"]);
  assert.deepEqual(result.candidates[0].modules, []);
});

test("returns deterministic candidate and module ordering", () => {
  const root = makeRoot();
  const repo = path.join(root, "sample-dotnet-solution");

  fs.mkdirSync(path.join(root, "z-service"), { recursive: true });
  fs.mkdirSync(path.join(root, "a-service"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "Zeta"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src", "Alpha"), { recursive: true });
  writeJson(path.join(root, "z-service", "package.json"), { type: "module" });
  writeJson(path.join(root, "z-service", "tsconfig.json"), { compilerOptions: {} });
  writeJson(path.join(root, "a-service", "package.json"), { type: "module" });
  writeJson(path.join(root, "a-service", "tsconfig.json"), { compilerOptions: {} });
  fs.writeFileSync(path.join(repo, "Sample.sln"), "solution\n");
  fs.writeFileSync(path.join(repo, "src", "Zeta", "Zeta.csproj"), "<Project />\n");
  fs.writeFileSync(path.join(repo, "src", "Alpha", "Alpha.csproj"), "<Project />\n");

  const result = discoverProjectBoundaries({ rootPath: root, rootId: "default" });

  assert.deepEqual(candidateNames(result), ["a-service", "sample-dotnet-solution", "z-service"]);
  assert.deepEqual(result.candidates[1].modules, [
    { path: "src/Alpha/Alpha.csproj", kind: "dotnet-project" },
    { path: "src/Zeta/Zeta.csproj", kind: "dotnet-project" }
  ]);
});

function canCreateSymlink() {
  const root = makeRoot();
  const target = path.join(root, "target");
  const link = path.join(root, "link");

  try {
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, "dir");
    return true;
  } catch {
    return false;
  }
}
