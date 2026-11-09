import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CREATE_ABSENCE_WITNESS_FS_ALLOWLIST } from "../src/lib/create-destination-absence-witness-constants.js";
import { observeProjectCreate } from "../src/lib/project-create-observation.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

const cli = fileURLToPath(new URL("../scripts/observe-project-create.mjs", import.meta.url));
const request = (paths, relativePath = "linked") => ({
  projectId: "PrJ_Context", worktree: { rootId: "test", relativePath },
  task: { id: "create-1", title: "Observe proposed files", paths }
});

test("operator CLI binds a real clean linked worktree and classifies proposed files without creating them", (t) => {
  const f = taskContextFixture(t);
  const tree = f.worktree("linked");
  const sha = f.git(["rev-parse", "HEAD"], tree);
  const paths = ["src/new.ts", "src/second.ts"];
  for (const targets of [paths.slice(0, 1), paths]) {
    const input = { ...request(targets), expectedCommitSha: sha };
    const env = { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify([{ id: "test", path: f.root }]) };
    const out = JSON.parse(execFileSync(process.execPath, [cli], { env, cwd: f.root, input: JSON.stringify(input), encoding: "utf8" }));
    assert.equal(out.commitSha, sha);
    assert.equal(out.snapshotToken.length, 64);
    assert.deepEqual(out.observations.map((r) => r.newPath), targets);
    for (const row of out.observations) {
      assert.deepEqual(Object.keys(row).sort(), ["complete", "incompleteReason", "newPath", "verdict"]);
    }
    const fsType = "0x" + (Number(fs.statfsSync(tree).type) >>> 0).toString(16);
    if (process.platform === "linux" && process.versions.unicode === "17.0"
        && CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes(fsType) && fs.existsSync("/proc/self/fd")) {
      assert.deepEqual(out.observations.map((r) => r.verdict), targets.map(() => "absent"));
      assert.deepEqual(out.scope.write.items.map((item) => item.target.path), targets);
      assert.equal(out.scope.status, "incomplete");
    } else {
      assert.ok(out.observations.every((r) => r.verdict === "unknown" && r.complete === false));
      if (process.versions.unicode !== "17.0") {
        assert.ok(out.observations.every((r) => r.incompleteReason === "unicode_version_mismatch"));
      } else if (process.platform === "linux" && fs.existsSync("/proc/self/fd") && !CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes(fsType)) {
        assert.ok(out.observations.every((r) => r.incompleteReason === "filesystem_unsupported"));
      }
      assert.equal(out.scope.status, "not_evaluated");
      assert.equal(out.scope.write, undefined);
    }
    for (const target of targets) assert.equal(fs.existsSync(path.join(tree, target)), false);
  }
  assert.equal(f.git(["status", "--porcelain"], tree), "");
  assert.equal(f.git(["rev-parse", "HEAD"], tree), sha);
});

test("stale and unbound create requests fail without creating any files", (t) => {
  const f = taskContextFixture(t);
  const tree = f.worktree("linked");
  const base = request(["src/new.ts"]);
  assert.throws(() => observeProjectCreate({ ...base, expectedCommitSha: "a".repeat(40) }, f.options.registry),
    { code: "create_observation_stale" });
  assert.throws(() => observeProjectCreate({ ...base, createDestinationAbsenceWitness: {} }, f.options.registry),
    { code: "invalid_create_observation_request" });
  assert.throws(() => observeProjectCreate(request(["../outside"]), f.options.registry), { code: "invalid_impact_request" });
  fs.mkdirSync(path.join(f.root, "unrelated"));
  assert.throws(() => observeProjectCreate(request(["src/new.ts"], "unrelated"), f.options.registry),
    { code: "worktree_parent_mismatch" });
  assert.equal(fs.existsSync(path.join(tree, "src/new.ts")), false);
});

test("main and dirty linked worktrees do not enumerate directories or report WRITE", (t) => {
  const f = taskContextFixture(t);
  const tree = f.worktree("linked");
  fs.writeFileSync(path.join(tree, "dirty.ts"), "export {};");
  for (const locator of ["main", "linked"]) {
    const result = observeProjectCreate(request(["src/proposed.ts"], locator), f.options.registry);
    assert.equal(result.scope.status, "not_evaluated");
    assert.deepEqual(result.scope.reasons.map((r) => r.code), ["working_tree_observation_only"]);
    assert.deepEqual(result.observations, []);
    assert.equal(result.scope.write, undefined);
  }
});

test("an existing target refuses the entire create batch", (t) => {
  const f = taskContextFixture(t);
  f.worktree("linked");
  const result = observeProjectCreate(request(["src/one.ts", "src/proposed.ts"]), f.options.registry);
  assert.equal(result.scope.status, "not_evaluated");
  assert.equal(result.scope.write, undefined);
});

test("a nested registered project below the parent checkout is excluded in the linked worktree", (t) => {
  const f = taskContextFixture(t);
  f.worktree("linked");
  const child = { name: "child", rootId: "test", relativePath: "main/src", projectId: "PrJ_Child" };
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries, child]));
  assert.throws(() => observeProjectCreate(request(["src/new.ts"]), f.options.registry),
    { code: "create_observation_nested_project_target" });
});

for (const state of ["missing", "dangling symlink"]) {
  test(`registered child stays excluded when the parent checkout's directory is ${state} but the linked tree still has it`, (t) => {
    const f = taskContextFixture(t);
    const file = "child/private.ts";
    f.write(file, "import { One } from '../src/one'; export class ChildOnlyMarker extends One {}");
    f.commit("add registered child project");
    const linked = f.worktree("linked");
    const child = { name: "child", rootId: "test", relativePath: "main/child", projectId: "PrJ_Child" };
    fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries, child]));
    fs.rmSync(path.join(f.repo, "child"), { recursive: true });
    if (state === "dangling symlink") {
      try { fs.symlinkSync("gone", path.join(f.repo, "child"), "dir"); }
      catch (e) { if (e.code === "EPERM") return t.skip("symlink creation unavailable"); throw e; }
    }
    f.commit("remove child in the parent checkout");
    assert.equal(f.git(["status", "--porcelain"], linked), "");
    assert.ok(fs.existsSync(path.join(linked, file)));

    const { projectId, worktree } = request(["child/new.ts"]);
    const pack = buildProjectTaskContext({ projectId, worktree,
      task: { title: "Find ChildOnlyMarker", paths: [file], symbols: ["ChildOnlyMarker"] } }, f.options);
    assert.equal(pack.sections.files.items.some((item) => item.path === file), false, "nested file leaked");
    assert.equal(pack.sections.symbols.items.some((item) => item.name === "ChildOnlyMarker"), false, "nested symbol leaked");
    const impact = buildProjectImpact(projectId, { worktree, paths: ["src/one.ts"] }, f.options);
    assert.equal(impact.affectedFiles.some((item) => item.path === file), false, "nested reverse import leaked");

    assert.throws(() => observeProjectCreate(request(["child/new.ts"]), f.options.registry),
      { code: "create_observation_nested_project_target" });
    assert.equal(fs.existsSync(path.join(linked, "child/new.ts")), false);
  });
}


test("a registered directory's own name and its portable aliases cannot be file create targets", (t) => {
  const f = taskContextFixture(t);
  const linked = f.worktree("linked");
  f.write("reserved/seed.ts", "export class Seed {}");
  f.commit("child only in parent checkout");
  const child = { name: "child", rootId: "test", relativePath: "main/reserved", projectId: "PrJ_Child" };
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries, child]));
  for (const target of ["reserved", "RESERVED", "ReSeRvEd/new.ts"]) {
    assert.equal(fs.existsSync(path.join(linked, target)), false);
    assert.throws(() => observeProjectCreate(request(["src/other.ts", target]), f.options.registry),
      { code: "create_observation_nested_project_target" });
  }
});
