import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Environment isolation for "no Git repository" reads. Git discovery and the revision reader's ancestor
 * `.git` marker walk both look above the directory under test, so a transient `.git` in an ancestor such
 * as `/tmp` or `/` (outside the fixture) would turn `not_git` into another status. Isolation is test-side:
 * - `execFileSync` adds `GIT_CEILING_DIRECTORIES=<root>` for the git the reader spawns; pass it through the
 *   reader's `execFileSync` seam (the reader strips inherited `GIT_*` variables, so `process.env` cannot
 *   carry it);
 * - `run(fn)` makes `.git` lookups in strict ancestors of the root report ENOENT for the duration of `fn`
 *   only, so the reader's marker walk still runs inside the root (and the directory itself) unchanged.
 */
export function noRepoIsolation(rootPath) {
  const root = fs.realpathSync(rootPath);
  const withinRoot = (candidate) => { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); };
  const execFileSyncWithCeiling = (command, args, options) => execFileSync(command, args, { ...options, env: { ...options.env, GIT_CEILING_DIRECTORIES: root } });
  const run = (fn) => {
    const lstatSync = fs.lstatSync;
    fs.lstatSync = function isolatedLstatSync(target, ...rest) {
      const text = String(target);
      if (path.basename(text) === ".git" && !withinRoot(path.dirname(text))) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${text}'`), { code: "ENOENT" });
      }
      return lstatSync.call(this, target, ...rest);
    };
    try {
      return fn();
    } finally {
      fs.lstatSync = lstatSync;
    }
  };
  /** Reads with the ceiling seam and isolated markers (`read` = readProjectRevision). */
  const isolated = (read, project, options = {}) => run(() => read(project, { execFileSync: execFileSyncWithCeiling, ...options }));
  return { root, execFileSync: execFileSyncWithCeiling, run, isolated };
}

/** A unique realpath'd mkdtemp root, removed in t.after, with noRepoIsolation over it. */
export function isolatedNoRepoRoot(t, prefix = "project-revision-nogit-") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return noRepoIsolation(root);
}
