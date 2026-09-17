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
    const status = required(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]);
    Object.assign(result, {
      status: head.error ? "unborn" : "available",
      commitSha: head.error ? null : head.output.trim(), branch, dirty: status.length > 0,
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
