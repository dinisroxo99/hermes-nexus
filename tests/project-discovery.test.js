import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { discoverProjects } from "../src/lib/project-discovery.js";
import { gitFixture } from "./helpers/git-fixture.js";

test("discovery recognizes Git-only linked worktrees without assigning a new identity", (t) => {
  const f = gitFixture(t, { committed: false });
  f.write("README.md", "fixture\n");
  f.commit();
  f.worktree();
  const options = { roots: [{ id: "test", path: f.root }], registeredProjects: [{ name: "parent", rootId: "test", relativePath: "main", projectId: "PrJ_Parent" }], includeRegistered: true };
  const result = discoverProjects(options);
  const linked = result.candidates.find((p) => p.relativePath === "linked");
  assert.ok(linked);
  assert.equal(linked.isLinkedWorktree, true);
  assert.equal(linked.parentProjectId, "PrJ_Parent");
  assert.equal(linked.registered, true);
  assert.equal(Object.hasOwn(linked, "projectId"), false);
  assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.equal(discoverProjects({ ...options, includeRegistered: false }).candidates.length, 0);
  const orphan = discoverProjects({ ...options, registeredProjects: [] }).candidates.find((p) => p.relativePath === "linked");
  assert.equal(orphan.parentProjectId, null);
  assert.equal(orphan.registered, false);
  const ambiguous = discoverProjects({ ...options, registeredProjects: [
    ...options.registeredProjects,
    { ...options.registeredProjects[0], projectId: "PrJ_Other" }
  ] }).candidates.find((p) => p.relativePath === "linked");
  assert.equal(ambiguous.parentProjectId, null);
});

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "project-map-discovery-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTypeScriptProject(parent, name) {
  const project = path.join(parent, name);
  fs.mkdirSync(project, { recursive: true });
  writeJson(path.join(project, "package.json"), { name });
  writeJson(path.join(project, "tsconfig.json"), { compilerOptions: {} });
  return project;
}

function candidateNames(result) {
  return result.candidates.map((candidate) => candidate.name);
}

test("discovers top-level candidates in one configured root with public bounded output", () => {
  const root = makeRoot();
  makeTypeScriptProject(root, "b-service");
  makeTypeScriptProject(root, "a-service");

  const result = discoverProjects({
    roots: [{ id: "default", path: root }]
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.bounded, true);
  assert.deepEqual(result.limits, { maxDepth: 3, limit: 100 });
  assert.deepEqual(result.roots, [{ id: "default" }]);
  assert.deepEqual(candidateNames(result), ["a-service", "b-service"]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.relativePath), ["a-service", "b-service"]);
  assert.equal(result.candidates[0].projectType, "typescript");
  assert.equal(result.candidates[0].boundaryKind, "repository");
  assert.equal(result.candidates[0].registered, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.truncated, false);
  assert.ok(!Object.hasOwn(result.roots[0], "path"));
});

test("discovers multiple roots in supplied root order then relativePath order", () => {
  const rootA = makeRoot();
  const rootB = makeRoot();
  makeTypeScriptProject(rootA, "z-service");
  makeTypeScriptProject(rootA, "a-service");
  makeTypeScriptProject(rootB, "b-service");

  const result = discoverProjects({
    roots: [
      { id: "personal", path: rootA },
      { id: "work", path: rootB }
    ]
  });

  assert.deepEqual(
    result.candidates.map((candidate) => [candidate.rootId, candidate.relativePath]),
    [
      ["personal", "a-service"],
      ["personal", "z-service"],
      ["work", "b-service"]
    ]
  );
  assert.deepEqual(result.roots, [{ id: "personal" }, { id: "work" }]);
});

test("applies the result limit globally across roots and reports true truncation", () => {
  const rootA = makeRoot();
  const rootB = makeRoot();
  makeTypeScriptProject(rootA, "a-one");
  makeTypeScriptProject(rootA, "a-two");
  makeTypeScriptProject(rootB, "b-one");
  makeTypeScriptProject(rootB, "b-two");

  const result = discoverProjects({
    roots: [
      { id: "personal", path: rootA },
      { id: "work", path: rootB }
    ],
    limit: 3
  });

  assert.equal(result.candidates.length, 3);
  assert.deepEqual(candidateNames(result), ["a-one", "a-two", "b-one"]);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.limits, { maxDepth: 3, limit: 3 });
});

test("does not mark exact-limit results as truncated", () => {
  const root = makeRoot();
  makeTypeScriptProject(root, "a-service");
  makeTypeScriptProject(root, "b-service");

  const result = discoverProjects({
    roots: [{ id: "default", path: root }],
    limit: 2
  });

  assert.equal(result.candidates.length, 2);
  assert.deepEqual(candidateNames(result), ["a-service", "b-service"]);
  assert.equal(result.truncated, false);
});

test("filters or marks registered projects using canonical rootId and relativePath identity", () => {
  const personal = makeRoot();
  const work = makeRoot();
  makeTypeScriptProject(personal, path.join("tools", "api"));
  makeTypeScriptProject(work, path.join("tools", "api"));

  const roots = [
    { id: "personal", path: personal },
    { id: "work", path: work }
  ];
  const registeredProjects = [
    { name: "api", rootId: "personal", relativePath: "tools/api" }
  ];

  const hidden = discoverProjects({ roots, registeredProjects, includeRegistered: false });
  assert.deepEqual(
    hidden.candidates.map((candidate) => [candidate.rootId, candidate.relativePath]),
    [["work", "tools/api"]]
  );

  const included = discoverProjects({ roots, registeredProjects, includeRegistered: true });
  assert.deepEqual(
    included.candidates.map((candidate) => [candidate.rootId, candidate.relativePath, candidate.registered]),
    [
      ["personal", "tools/api", true],
      ["work", "tools/api", false]
    ]
  );
});

test("preserves name-based registered-project compatibility within the same root only", () => {
  const personal = makeRoot();
  const work = makeRoot();
  makeTypeScriptProject(personal, "a-service");
  makeTypeScriptProject(work, "a-service");

  const result = discoverProjects({
    roots: [
      { id: "personal", path: personal },
      { id: "work", path: work }
    ],
    registeredProjects: [{ name: "a-service", rootId: "personal", relativePath: "renamed-service" }],
    includeRegistered: true
  });

  assert.deepEqual(
    result.candidates.map((candidate) => [candidate.rootId, candidate.relativePath, candidate.registered]),
    [
      ["personal", "a-service", true],
      ["work", "a-service", false]
    ]
  );
});

test("returns bounded warnings for missing and non-directory roots without exposing absolute paths", () => {
  const validRoot = makeRoot();
  const fileRootParent = makeRoot();
  const fileRoot = path.join(fileRootParent, "not-a-directory");
  fs.writeFileSync(fileRoot, "not a directory\n");
  makeTypeScriptProject(validRoot, "a-service");

  const result = discoverProjects({
    roots: [
      { id: "missing", path: path.join(validRoot, "missing-root") },
      { id: "file", path: fileRoot },
      { id: "valid", path: validRoot }
    ]
  });

  assert.deepEqual(candidateNames(result), ["a-service"]);
  assert.deepEqual(result.warnings, [
    { code: "root_missing", rootId: "missing" },
    { code: "root_not_directory", rootId: "file" }
  ]);
  assert.ok(result.warnings.every((warning) => !Object.hasOwn(warning, "path")));
});

test("bounds warning output deterministically", () => {
  const roots = Array.from({ length: 25 }, (_, index) => ({
    id: `missing-${String(index).padStart(2, "0")}`,
    path: path.join(makeRoot(), "missing")
  }));

  const result = discoverProjects({ roots });

  assert.equal(result.warnings.length, 20);
  assert.equal(result.warnings[0].rootId, "missing-00");
  assert.equal(result.warnings[19].rootId, "missing-19");
});

test("honors maxDepth for top-level candidates while keeping modules of in-scope repositories", () => {
  const root = makeRoot();
  const deepRepo = path.join(root, "level1", "level2", "deep-independent-repo");
  const solution = path.join(root, "sample-dotnet-solution");
  fs.mkdirSync(deepRepo, { recursive: true });
  writeJson(path.join(deepRepo, "package.json"), { name: "deep-independent-repo" });
  writeJson(path.join(deepRepo, "tsconfig.json"), { compilerOptions: {} });
  fs.mkdirSync(path.join(solution, "src", "Sample.Api"), { recursive: true });
  fs.writeFileSync(path.join(solution, "Sample.sln"), "solution\n");
  fs.writeFileSync(path.join(solution, "src", "Sample.Api", "Sample.Api.csproj"), "<Project />\n");

  const result = discoverProjects({
    roots: [{ id: "default", path: root }],
    maxDepth: 2
  });

  assert.deepEqual(candidateNames(result), ["sample-dotnet-solution"]);
  assert.deepEqual(result.candidates[0].modules, [
    { path: "src/Sample.Api/Sample.Api.csproj", kind: "dotnet-project" }
  ]);
  assert.deepEqual(result.limits, { maxDepth: 2, limit: 100 });
});

test("clamps maxDepth and limit to deterministic bounds", () => {
  const root = makeRoot();
  makeTypeScriptProject(root, "a-service");

  const high = discoverProjects({
    roots: [{ id: "default", path: root }],
    maxDepth: 99,
    limit: 999
  });
  assert.deepEqual(high.limits, { maxDepth: 6, limit: 500 });

  const low = discoverProjects({
    roots: [{ id: "default", path: root }],
    maxDepth: -10,
    limit: -10
  });
  assert.deepEqual(low.limits, { maxDepth: 1, limit: 1 });
  assert.equal(low.candidates.length, 1);
});

test("reuses ignored-directory and symlink behavior during orchestration", { skip: !canCreateSymlink() }, () => {
  const root = makeRoot();
  const external = makeRoot();
  makeTypeScriptProject(root, "a-service");
  makeTypeScriptProject(path.join(root, "node_modules"), "b-service");
  makeTypeScriptProject(path.join(root, ".next"), "c-service");
  makeTypeScriptProject(external, "linked-service");
  fs.symlinkSync(path.join(external, "linked-service"), path.join(root, "linked-service"), "dir");

  const result = discoverProjects({ roots: [{ id: "default", path: root }] });

  assert.deepEqual(candidateNames(result), ["a-service"]);
});

test("does not mutate supplied registry data or registry files", () => {
  const root = makeRoot();
  const registryDir = makeRoot();
  const registryFile = path.join(registryDir, "projects.json");
  const registryContents = "[{\"name\":\"a-service\",\"relativePath\":\"a-service\"}]\n";
  const registeredProjects = [{ name: "a-service", rootId: "default", relativePath: "a-service" }];
  makeTypeScriptProject(root, "a-service");
  fs.writeFileSync(registryFile, registryContents);

  const result = discoverProjects({
    roots: [{ id: "default", path: root }],
    registeredProjects,
    includeRegistered: true
  });

  assert.equal(result.candidates[0].registered, true);
  assert.deepEqual(registeredProjects, [{ name: "a-service", rootId: "default", relativePath: "a-service" }]);
  assert.equal(fs.readFileSync(registryFile, "utf8"), registryContents);
  assert.equal(fs.existsSync(path.join(registryDir, "discovered-projects.json")), false);
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
