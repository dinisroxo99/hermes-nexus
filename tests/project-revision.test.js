import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { gitFixture } from "./helpers/git-fixture.js";

async function reader() {
  const module = await import("../src/lib/project-revision.js").catch(() => ({}));
  assert.equal(typeof module.readProjectRevision, "function", "bounded Git revision reader must exist");
  return module.readProjectRevision;
}

test("revision captures full live HEAD and detached state without exposing Git paths", async (t) => {
  const read = await reader();
  const f = gitFixture(t);
  const first = read(f.project, { now: () => "fixed-clock" });
  assert.equal(first.status, "available");
  assert.equal(first.commitSha, f.git(["rev-parse", "HEAD"]));
  assert.equal(first.branch, "main");
  assert.equal(first.dirty, false);
  assert.equal(first.capturedAt, "fixed-clock");
  assert.equal(first.isLinkedWorktree, false);
  assert.equal(JSON.stringify(first).includes(f.root), false);
  f.write("src/source.ts", "export const second = 2;\n");
  f.commit("second");
  assert.notEqual(read(f.project).commitSha, first.commitSha);
  f.git(["checkout", "--detach", first.commitSha]);
  assert.equal(read(f.project).branch, null);
});

test("revision distinguishes unstaged, staged and untracked changes", async (t) => {
  const read = await reader();
  const f = gitFixture(t);
  f.write("src/source.ts", "export const dirty = 2;\n");
  assert.equal(read(f.project).dirty, true);
  f.git(["add", "."]);
  assert.equal(read(f.project).dirty, true);
  f.commit();
  assert.equal(read(f.project).dirty, false);
  f.write("new.txt", "untracked\n");
  assert.equal(read(f.project).dirty, true);
});

test("revision distinguishes unborn, non-Git, corrupt and unavailable repositories", async (t) => {
  const read = await reader();
  const f = gitFixture(t, { committed: false });
  const unborn = read(f.project);
  assert.equal(unborn.status, "unborn");
  assert.equal(unborn.commitSha, null);
  const plain = path.join(f.root, "plain");
  fs.mkdirSync(plain);
  assert.equal(read({ absolutePath: plain }).status, "not_git");
  fs.writeFileSync(path.join(plain, ".git"), "invalid marker");
  assert.equal(read({ absolutePath: plain }).status, "unavailable");
  for (const code of ["ENOENT", "ETIMEDOUT", "ENOBUFS"]) {
    const revision = read(f.project, { execFileSync: () => { throw Object.assign(new Error("sensitive stderr"), { code }); } });
    assert.equal(revision.status, "unavailable");
    assert.equal(revision.dirty, null);
    assert.equal(JSON.stringify(revision).includes("sensitive"), false);
  }
});

test("revision bounds subprocesses and ignores inherited Git location overrides", async (t) => {
  const read = await reader();
  const f = gitFixture(t);
  const commands = [];
  const revision = read(f.project, {
    env: { ...process.env, GIT_DIR: "/wrong", GIT_WORK_TREE: "/wrong", GIT_INDEX_FILE: "/wrong", GIT_CONFIG_COUNT: "99" },
    execFileSync: (command, args, options) => {
      commands.push(args);
      assert.equal(command, "git");
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 2000);
      assert.equal(options.maxBuffer, 1024 * 1024);
      assert.equal(options.env.GIT_DIR, undefined);
      assert.equal(options.env.GIT_CONFIG_COUNT, undefined);
      assert.equal(options.env.GIT_OPTIONAL_LOCKS, "0");
      return execFileSync(command, args, options);
    }
  });
  assert.equal(revision.status, "available");
  assert.ok(commands.length > 0);
  assert.equal(commands.some((args) => args.includes("config") || args.includes("remote")), false);
});
