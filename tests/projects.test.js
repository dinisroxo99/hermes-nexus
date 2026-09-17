import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import * as projects from "../src/lib/projects.js";
import { gitFixture } from "./helpers/git-fixture.js";

function fixture(t, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-lookup-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const options = {
    roots: ["a", "b", "default"].map((id) => ({ id, path: path.join(dir, id) })),
    manualProjectsFile: path.join(dir, "projects.json"),
    discoveredProjectsFile: path.join(dir, "discovered-projects.json")
  };
  for (const entry of entries) fs.mkdirSync(path.join(dir, entry.rootId || "default", entry.relativePath), { recursive: true });
  fs.writeFileSync(options.manualProjectsFile, JSON.stringify(entries));
  return { dir, options };
}

test("name lookups reject ambiguity and allow explicit root qualification", (t) => {
  const { options } = fixture(t, [
    { name: "api", rootId: "a", relativePath: "api", projectId: "PrJ_A" },
    { name: "api", rootId: "b", relativePath: "api", projectId: "PrJ_B" }
  ]);
  for (const lookup of [projects.getProjectByName, projects.getProjectByNameForIntelligence]) {
    assert.throws(() => lookup("api", options), { code: "ambiguous_project" });
  }
  assert.equal(projects.getProjectByNameForIntelligence("api", { ...options, rootId: "b" }).projectId, "PrJ_B");
});

test("ID lookup is exact and never falls back to a name", (t) => {
  const { options } = fixture(t, [
    { name: "PrJ_Other", relativePath: "api", projectId: "PrJ_A" },
    { name: "legacy", relativePath: "legacy" }
  ]);
  assert.equal(typeof projects.getProjectByIdForIntelligence, "function");
  assert.equal(projects.getProjectByIdForIntelligence("PrJ_A", options).name, "PrJ_Other");
  for (const id of ["PrJ_Other", "prj_a", "legacy"]) {
    assert.throws(() => projects.getProjectByIdForIntelligence(id, options), { code: "project_not_found" });
  }
  assert.throws(() => projects.getProjectByIdForIntelligence(" PrJ_A", options), { code: "invalid_project_identity" });
  assert.equal(projects.getProjectByNameForIntelligence("legacy", options).projectId, undefined);
});

test("explicit relocation preserves projectId without generating a new identity", (t) => {
  const entry = { name: "api", relativePath: "first", projectId: "PrJ_A" };
  const { dir, options } = fixture(t, [entry]);
  fs.renameSync(path.join(dir, "default", "first"), path.join(dir, "default", "moved"));
  fs.writeFileSync(options.manualProjectsFile, JSON.stringify([{ ...entry, relativePath: "moved" }]));
  assert.equal(typeof projects.getProjectByIdForIntelligence, "function");
  const resolved = projects.getProjectByIdForIntelligence("PrJ_A", options);
  assert.equal(resolved.projectId, "PrJ_A");
  assert.equal(resolved.relativePath, "moved");
});

test("legacy lookup and listing resolve the registered root before projecting metadata", (t) => {
  const { dir, options } = fixture(t, [{ name: "api", rootId: "b", relativePath: "api" }]);
  const expected = path.join(dir, "b", "api");
  assert.equal(projects.getProjectByName("api", options).absolutePath, expected);
  assert.equal(projects.listProjects(options)[0].absolutePath, expected);
  assert.equal(Object.hasOwn(projects.getProjectByName("api", options), "rootId"), false);
});

test("lookup rejects unknown roots, non-directories and symlink escapes without leaking paths", (t) => {
  const { dir, options } = fixture(t, [{ name: "api", rootId: "b", relativePath: "api" }]);
  for (const lookup of [projects.getProjectByName, projects.getProjectByNameForIntelligence]) {
    assert.throws(() => lookup("api", { ...options, roots: [] }), { code: "project_unavailable" });
  }
  const target = path.join(dir, "b", "api");
  fs.rmdirSync(target);
  fs.writeFileSync(target, "not a directory");
  assert.throws(() => projects.getProjectByNameForIntelligence("api", options), { code: "project_unavailable" });
  fs.unlinkSync(target);
  fs.mkdirSync(path.join(dir, "external"));
  fs.symlinkSync(path.join(dir, "external"), target, "dir");
  assert.throws(() => projects.getProjectByNameForIntelligence("api", options), (error) => {
    assert.equal(error.code, "project_unavailable");
    assert.equal(error.message.includes(dir), false);
    return true;
  });
});

test("missing project remains listable but cannot be resolved or assigned a new ID", (t) => {
  const { dir, options } = fixture(t, [{ name: "api", relativePath: "api", projectId: "PrJ_A" }]);
  fs.rmdirSync(path.join(dir, "default", "api"));
  assert.throws(() => projects.getProjectByIdForIntelligence("PrJ_A", options), { code: "project_unavailable" });
  assert.equal(projects.listProjects(options)[0].absolutePath, path.join(dir, "default", "api"));
  assert.equal(JSON.parse(fs.readFileSync(options.manualProjectsFile))[0].projectId, "PrJ_A");
});

test("linked worktree resolves under its parent's persisted identity without registry writes", (t) => {
  const f = gitFixture(t);
  const linked = f.worktree();
  const manualProjectsFile = path.join(f.root, "projects.json");
  const contents = JSON.stringify([{ name: "parent", rootId: "test", relativePath: "main", projectId: "PrJ_Parent" }]);
  fs.writeFileSync(manualProjectsFile, contents);
  const options = { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "discovered-projects.json") };
  assert.equal(typeof projects.resolveProjectWorktree, "function");
  const result = projects.resolveProjectWorktree("PrJ_Parent", { rootId: "test", relativePath: "linked" }, options);
  assert.equal(result.projectId, "PrJ_Parent");
  assert.equal(result.parentProjectId, "PrJ_Parent");
  assert.equal(result.name, "parent");
  assert.equal(result.absolutePath, linked);
  assert.deepEqual(result.canonicalLocation, { rootId: "test", relativePath: "main" });
  assert.equal(fs.readFileSync(manualProjectsFile, "utf8"), contents);
  assert.equal(fs.existsSync(options.discoveredProjectsFile), false);
  fs.mkdirSync(path.join(f.root, "imposter"));
  fs.copyFileSync(path.join(linked, ".git"), path.join(f.root, "imposter", ".git"));
  assert.throws(() => projects.resolveProjectWorktree("PrJ_Parent", { rootId: "test", relativePath: "imposter" }, options), { code: "worktree_parent_mismatch" });
  assert.throws(() => projects.resolveProjectWorktree("PrJ_Missing", { rootId: "test", relativePath: "linked" }, options), { code: "project_not_found" });
  assert.throws(() => projects.resolveProjectWorktree("PrJ_Parent", { rootId: "outside", relativePath: "linked" }, options), { code: "project_unavailable" });
  assert.throws(() => projects.resolveProjectWorktree(undefined, { relativePath: "linked" }, options), { code: "project_identity_required" });
});

test("worktree binding rejects separate clones and preserves logical project subdirectories", (t) => {
  const f = gitFixture(t);
  f.write("packages/one/package.json", "{}\n");
  f.write("packages/two/package.json", "{}\n");
  f.commit();
  f.worktree();
  f.git(["clone", "--no-hardlinks", f.repo, path.join(f.root, "clone")]);
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([
    { name: "one", rootId: "test", relativePath: "main/packages/one", projectId: "PrJ_One" },
    { name: "two", rootId: "test", relativePath: "main/packages/two", projectId: "PrJ_Two" }
  ]));
  const options = { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "discovered-projects.json") };
  assert.equal(typeof projects.resolveProjectWorktree, "function");
  assert.equal(projects.resolveProjectWorktree("PrJ_One", { rootId: "test", relativePath: "linked/packages/one" }, options).projectId, "PrJ_One");
  for (const relativePath of ["linked/packages/two", "clone/packages/one", "main/packages/one"]) {
    assert.throws(() => projects.resolveProjectWorktree("PrJ_One", { rootId: "test", relativePath }, options), { code: "worktree_parent_mismatch" });
  }
});
