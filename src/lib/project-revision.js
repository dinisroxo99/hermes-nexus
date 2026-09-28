import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const TIMEOUT_MS = 2000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** Read-only checkout evidence. `evidence` is internal and non-enumerable. */
export function readProjectRevision(project, options = {}) {
  const result = {
    status: "unavailable", commitSha: null, branch: null, dirty: null,
    repositoryIdentity: null, worktreeId: null, isLinkedWorktree: null,
    capturedAt: (options.now || (() => new Date().toISOString()))()
  };
  try {
    const absolutePath = fs.realpathSync(project.absolutePath);
    const run = (args) => runGit(absolutePath, args, options);
    const inside = run(["rev-parse", "--is-inside-work-tree"]);
    if (inside.error) {
      if (!hasGitMarker(absolutePath) && String(inside.error.stderr || "").includes("not a git repository")) {
        result.status = "not_git";
      }
      return result;
    }
    if (inside.output.trim() !== "true") return result;
    const required = (args) => {
      const response = run(args);
      if (response.error) throw response.error;
      return response.output.trim();
    };
    const gitRoot = fs.realpathSync(required(["rev-parse", "--show-toplevel"]));
    const gitDir = fs.realpathSync(required(["rev-parse", "--absolute-git-dir"]));
    const gitCommonDir = fs.realpathSync(required(["rev-parse", "--path-format=absolute", "--git-common-dir"]));
    const branchResult = run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (branchResult.error && branchResult.error.status !== 1) return result;
    const branch = branchResult.error ? null : branchResult.output.trim();
    const head = run(["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (head.error) {
      if (head.error.status !== 1 || !branch) return result;
      const ref = run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]);
      if (!ref.error || ref.error.status !== 1) return result;
    }
    const statusRes = run(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
    if (statusRes.error) throw statusRes.error;
    const status = statusRes.output; // raw porcelain v1 -z; required() trimming kept only for metadata
    Object.assign(result, {
      status: head.error ? "unborn" : "available",
      commitSha: head.error ? null : head.output.trim(), branch, dirty: porcelainIndicatesDirty(status),
      repositoryIdentity: digest([gitCommonDir]),
      worktreeId: digest([gitDir, gitRoot]),
      isLinkedWorktree: gitDir !== gitCommonDir
    });
    Object.defineProperty(result, "evidence", { value: {
      gitRoot, gitDir, gitCommonDir,
      projectSubdirectory: path.relative(gitRoot, absolutePath).replaceAll("\\", "/") || "."
    } });
    return result;
  } catch {
    return result;
  }
}

export function isLinkedProjectWorktree(parent, candidate, options = {}) {
  const a = parent.evidence;
  const b = candidate.evidence;
  if (!a || !b || !candidate.isLinkedWorktree || a.gitCommonDir !== b.gitCommonDir
    || a.projectSubdirectory !== b.projectSubdirectory || a.gitRoot === b.gitRoot) return false;
  const listed = runGit(a.gitRoot, ["worktree", "list", "--porcelain", "-z"], options);
  if (listed.error) return false;
  return listed.output.split("\0").some((field) => {
    if (!field.startsWith("worktree ")) return false;
    try { return fs.realpathSync(field.slice(9)) === b.gitRoot; } catch { return false; }
  });
}

export function getProjectCacheIdentity(project, options = {}) {
  const revision = readProjectRevision(project, options);
  let location = project.absolutePath;
  try { location = fs.realpathSync(location); } catch { /* Unavailable state disables reuse. */ }
  const contextKey = digest([project.projectId ?? null, project.name, location]);
  return {
    contextKey,
    key: digest([contextKey, revision.status, revision.repositoryIdentity, revision.worktreeId, revision.commitSha]),
    reusable: revision.status === "not_git" || (revision.status === "available" && revision.dirty === false),
    revision
  };
}

function runGit(absolutePath, args, options) {
  const env = Object.fromEntries(Object.entries(options.env || process.env).filter(([key]) => !key.startsWith("GIT_")));
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  env.LC_ALL = "C";
  try {
    const output = (options.execFileSync || execFileSync)("git", ["-c", "core.fsmonitor=false", "-C", absolutePath, ...args], {
      env, encoding: "utf8", shell: false, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { output, error: null };
  } catch (error) {
    return { output: "", error };
  }
}

function hasGitMarker(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    try { fs.lstatSync(path.join(current, ".git")); return true; } catch (error) {
      if (error.code !== "ENOENT") return true;
    }
    if (path.dirname(current) === current) return false;
  }
}

function digest(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function porcelainIndicatesDirty(statusText) {
  if (!statusText || statusText.length === 0) {
    return false;
  }
  if (!statusText.endsWith("\0")) {
    throw new Error("malformed porcelain: missing final NUL");
  }
  // drop ONLY the trailing split artifact (from final NUL); any remaining empty token
  // is interior empty / malformed and must be rejected by subsequent checks (short/empty-path etc)
  // to prevent silent drop that causes invented clean or path-swallow on renames.
  const raw = statusText.split("\0");
  const tokens = raw.slice(0, -1);
  let i = 0;
  let dirty = false;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.length < 2) {
      throw new Error("malformed porcelain: short record");
    }
    if (tok[2] !== " ") {
      throw new Error("malformed porcelain: missing separator");
    }
    const xy = tok.slice(0, 2);
    const path = tok.slice(3); // exactly after structural separator at offset 2; no trimStart, preserve leading U+0020 in pathname if present
    if (path.length === 0) {
      throw new Error("malformed porcelain: empty pathname");
    }
    i++;
    const x = xy[0];
    const y = xy[1];
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      // rename/copy consumes two paths (per porcelain v1 -z); validate second present
      if (i < tokens.length) {
        const second = tokens[i];
        if (second.length === 0) {
          throw new Error("truncated rename/copy");
        }
        i++;
      } else {
        throw new Error("truncated rename/copy");
      }
    }
    if (xy === "??" && isOmittedUntrackedBytecode(path)) {
      continue;
    }
    dirty = true;
    // continue full scan; malformed after dirty entry must still fail (no early return)
  }
  return dirty;
}

function isOmittedUntrackedBytecode(pathname) {
  if (!pathname || pathname[0] === " ") return false;
  // split segments on / and \\ ; exact == for __pycache__ segment, endsWith for .pyc/.pyo basename. case sensitive.
  // leading space in retained pathname (i.e. untracked filename begins with space) makes ineligible for omission
  const segments = pathname.split(/[/\\]/).filter((s) => s.length > 0);
  if (segments.some((s) => s === "__pycache__")) {
    return true;
  }
  const basename = segments[segments.length - 1] || "";
  return basename.endsWith(".pyc") || basename.endsWith(".pyo");
}
