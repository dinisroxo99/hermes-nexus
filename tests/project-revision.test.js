import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { gitFixture } from "./helpers/git-fixture.js";

/**
 * Environment isolation for "no Git repository" reads. Git discovery and the reader's ancestor `.git`
 * marker walk both look above the directory under test, so a transient `.git` in an ancestor such as
 * `/tmp` or `/` (outside the fixture) would turn `not_git` into another status. Isolation is test-side:
 * - a unique mkdtemp root (realpath) holds the directory under test and is removed afterwards;
 * - the git the reader spawns gets `GIT_CEILING_DIRECTORIES=<root>` through the reader's own
 *   `execFileSync` seam (the reader strips inherited `GIT_*` variables, so `process.env` cannot carry it);
 * - for the duration of the read only, `.git` lookups in strict ancestors of the root report ENOENT,
 *   so the reader's marker walk still runs inside the root (and the directory itself) unchanged.
 */
function isolatedNoRepoRoot(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "project-revision-nogit-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const withinRoot = (candidate) => { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); };
  const execFileSyncWithCeiling = (command, args, options) => execFileSync(command, args, { ...options, env: { ...options.env, GIT_CEILING_DIRECTORIES: root } });
  const isolated = (read, project, options = {}) => {
    const lstatSync = fs.lstatSync;
    fs.lstatSync = function isolatedLstatSync(target, ...rest) {
      const text = String(target);
      if (path.basename(text) === ".git" && !withinRoot(path.dirname(text))) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${text}'`), { code: "ENOENT" });
      }
      return lstatSync.call(this, target, ...rest);
    };
    try {
      return read(project, { execFileSync: execFileSyncWithCeiling, ...options });
    } finally {
      fs.lstatSync = lstatSync;
    }
  };
  return { root, isolated };
}

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
  const noRepo = isolatedNoRepoRoot(t);
  const plain = path.join(noRepo.root, "plain");
  fs.mkdirSync(plain);
  assert.equal(noRepo.isolated(read, { absolutePath: plain }).status, "not_git");
  fs.writeFileSync(path.join(plain, ".git"), "invalid marker");
  assert.equal(noRepo.isolated(read, { absolutePath: plain }).status, "unavailable");
  for (const code of ["ENOENT", "ETIMEDOUT", "ENOBUFS"]) {
    const revision = read(f.project, { execFileSync: () => { throw Object.assign(new Error("sensitive stderr"), { code }); } });
    assert.equal(revision.status, "unavailable");
    assert.equal(revision.dirty, null);
    assert.equal(JSON.stringify(revision).includes("sensitive"), false);
  }

  // D2: extend with status-output injection for x\0 and other structural failures.
  // Must get unavailable/dirty:null (throw to catch before assign), never fabricate clean false.
  // Use existing readProjectRevision execFileSync seam.
  const f2 = gitFixture(t);
  const badStatus = (badOut) => read(f2.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) {
        return badOut;
      }
      return execFileSync(command, args, options);
    }
  });
  let r = badStatus("x\0");
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus("R  old\0"); // truncated paired path
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus(" M foo\0x\0"); // malformed after dirtying entry
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus("?? foo"); // missing final NUL
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus("??\0"); // empty path
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);

  // D2-R1: interior empty tokens (after final-NUL only trailing artifact dropped; empties refuse)
  // must unavailable + dirty null, never invent clean false
  r = badStatus("\0");
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus("\0\0");
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus("?? mod.pyc\0\0");
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus("?? src/a.py\0\0?? src/b.py\0"); // interior empty between records
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
  r = badStatus("R  old\0\0?? mod.pyc\0"); // empty second path for rename (was swallowing)
  assert.equal(r.status, "unavailable");
  assert.equal(r.dirty, null);
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

test("worktrees share repository evidence but have separate revision and dirty state", async (t) => {
  const read = await reader();
  const f = gitFixture(t);
  const linked = { ...f.project, absolutePath: f.worktree() };
  const parent = read(f.project);
  const child = read(linked);
  assert.equal(child.isLinkedWorktree, true);
  assert.equal(child.repositoryIdentity, parent.repositoryIdentity);
  assert.notEqual(child.worktreeId, parent.worktreeId);
  f.write("src/source.ts", "export const childOnly = true;\n", linked.absolutePath);
  assert.equal(read(linked).dirty, true);
  assert.equal(read(f.project).dirty, false);
  f.commit("child", linked.absolutePath);
  assert.notEqual(read(linked).commitSha, read(f.project).commitSha);
});

test("a separate Git directory with a .git file is not a linked worktree", async (t) => {
  const read = await reader();
  const f = gitFixture(t);
  const separate = path.join(f.root, "separate");
  f.git(["init", "--initial-branch=main", "--separate-git-dir", path.join(f.root, "metadata"), separate]);
  const revision = read({ absolutePath: separate });
  assert.equal(revision.status, "unborn");
  assert.equal(revision.isLinkedWorktree, false);
});

test("revision omits untracked __pycache__/ and *.pyc from dirty (other untracked and tracked dirt still dirty)", async (t) => {
  const read = await reader();

  // only untracked pycache dir
  let f = gitFixture(t);
  f.write("foo/__pycache__/bar.cpython-312.pyc", "bytecode\n");
  assert.equal(read(f.project).dirty, false);

  // only untracked .pyc
  f = gitFixture(t);
  f.write("mod.pyc", "bytecode\n");
  assert.equal(read(f.project).dirty, false);

  // untracked .env still dirties
  f = gitFixture(t);
  f.write(".env", "SECRET=1\n");
  assert.equal(read(f.project).dirty, true);

  // untracked debug.log still dirties
  f = gitFixture(t);
  f.write("debug.log", "log\n");
  assert.equal(read(f.project).dirty, true);

  // untracked node_modules/... still dirties
  f = gitFixture(t);
  f.write("node_modules/pkg/index.js", "module\n");
  assert.equal(read(f.project).dirty, true);

  // tracked source edit + untracked pycache -> dirty true
  f = gitFixture(t);
  f.write("src/source.ts", "export const dirty = true;\n");
  f.write("foo/__pycache__/bar.cpython-312.pyc", "bytecode\n");
  assert.equal(read(f.project).dirty, true);

  // committed then modified tracked .pyc -> dirty true
  f = gitFixture(t);
  f.write("tracked.pyc", "initial\n");
  f.commit("add tracked pyc");
  f.write("tracked.pyc", "modified\n");
  assert.equal(read(f.project).dirty, true);

  // clean tree -> false
  f = gitFixture(t);
  assert.equal(read(f.project).dirty, false);

  // D2: extend with mandatory cases 1-3/5, .pyo, leading-space variants (via exec seam for path space),
  // case/suffix boundaries, rename/copy and mixed-record preservation. (no export of privates)
  // 1. normal untracked -> dirty true
  f = gitFixture(t);
  let rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) {
        return "?? src/business.py\0";
      }
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);

  // 2. untracked pycache/pyc omitted -> dirty false
  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "?? __pycache__/cached.pyc\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, false);

  // 3. leading space on pycache path -> dirty true (not eligible for omit)
  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "??  __pycache__/business.py\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);

  // .pyo without leading space omitted
  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "?? mod.pyo\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, false);

  // leading-space .pyo -> dirty true
  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "??  mod.pyo\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);

  // case/suffix boundaries: .pyc.bak dirty, __Pycache__ (case) dirty
  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "?? file.pyc.bak\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);

  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "?? Foo/__Pycache__/a.txt\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);

  // tracked + omitted still dirty (5)
  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return " M tracked.pyc\0?? mod.pyo\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);

  // rename/copy with paired + following omitted
  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "R  old.ts\0new.ts\0?? __pycache__/x.pyc\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);

  f = gitFixture(t);
  rev = read(f.project, {
    execFileSync: (command, args, options) => {
      if (args.includes("status")) return "C  old\0new\0";
      return execFileSync(command, args, options);
    }
  });
  assert.equal(rev.dirty, true);
});
