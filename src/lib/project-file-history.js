import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { materializeBoundedJsonData } from "./effective-task-scope-policy.js";
import { isContextPathAllowed } from "./project-context-files.js";
import { validateProjectId } from "./project-registry.js";
import { readProjectRevision } from "./project-revision.js";
import { validateRelativeProjectPath } from "./project-roots.js";
import { getNestedProjectPaths, getProjectByIdForIntelligence, resolveProjectWorktree } from "./projects.js";

const HISTORY_LIMIT = 64;
const ENTRY_LIMIT = 16;
const TIMEOUT_MS = 3000;
const MAX_COMMAND_BYTES = 8192;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const METADATA_ONLY = Object.freeze({ metadataOnly: true });
const error = (code) => Object.assign(new Error(code), { code });

function normalizeInput(raw) {
  let input;
  try { input = materializeBoundedJsonData(raw); } catch { throw error("invalid_history_request"); }
  if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["projectId", "path", "worktree"].includes(key))) throw error("invalid_history_request");
  validateProjectId(input.projectId);
  if (!isContextPathAllowed(input.path)) throw error("invalid_history_path");
  if (Object.hasOwn(input, "worktree")) {
    const w = input.worktree;
    if (!w || typeof w !== "object" || Array.isArray(w) || Object.keys(w).length !== 2
        || typeof w.rootId !== "string" || !w.rootId.trim() || w.rootId.length > 128 || /[\u0000-\u001f\u007f]/.test(w.rootId)
        || typeof w.relativePath !== "string" || w.relativePath.length > 1024 || /[\u0000-\u001f\u007f]/.test(w.relativePath)
        || validateRelativeProjectPath(w.relativePath).relativePath !== w.relativePath) throw error("invalid_history_worktree");
  }
  return input;
}

function assertBoundary(project, file, excluded) {
  if (excluded.some((prefix) => file === prefix || file.startsWith(prefix + "/"))) throw error("history_boundary_excluded");
  let directory = project.absolutePath;
  for (const segment of file.split("/")) {
    directory = path.join(directory, segment);
    let entry;
    try { entry = fs.lstatSync(directory, { throwIfNoEntry: false }); } catch { throw error("history_boundary_unavailable"); }
    if (!entry) break; // Files and namespaces can have been deleted since the commit.
    if (entry.isSymbolicLink()) throw error("history_boundary_excluded");
    if (!entry.isDirectory()) break;
    try {
      if (fs.lstatSync(path.join(directory, ".git"), { throwIfNoEntry: false })) throw error("history_boundary_excluded");
    } catch (e) {
      if (e.code === "history_boundary_excluded") throw e;
      throw error("history_boundary_unavailable");
    }
  }
}

function readView(input, options) {
  const { projectId, worktree } = input;
  const parent = getProjectByIdForIntelligence(projectId, options.registry);
  const forward = worktree && (parent.rootId !== worktree.rootId || parent.relativePath !== worktree.relativePath);
  const project = forward ? resolveProjectWorktree(projectId, worktree, options.registry, METADATA_ONLY) : parent;
  const excluded = getNestedProjectPaths(project, options.registry);
  assertBoundary(project, input.path, excluded);
  const observed = (options.readRevision || readProjectRevision)(project, METADATA_ONLY);
  const { status, commitSha, branch, dirty, repositoryIdentity, worktreeId, isLinkedWorktree } = observed;
  return {
    root: project.absolutePath, parent: parent.absolutePath, excluded,
    project: { name: project.name, rootId: project.rootId, relativePath: project.relativePath },
    revision: { status, commitSha, branch, dirty, repositoryIdentity, worktreeId, isLinkedWorktree }
  };
}

function historyReader(directory) {
  const deadline = Date.now() + TIMEOUT_MS;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { LC_ALL: "C", GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });
  return (args) => {
    const timeout = deadline - Date.now();
    if (timeout < 1) throw error("history_read_timeout");
    try {
      return execFileSync("git", ["--no-pager", "--no-replace-objects", "--literal-pathspecs", "-C", directory, ...args],
        { env, timeout, maxBuffer: MAX_COMMAND_BYTES, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    } catch (e) { throw error(e.code === "ETIMEDOUT" ? "history_read_timeout" : "history_read_unavailable"); }
  };
}

function regularFileEntry(run, commit, file) {
  // ls-tree is non-recursive and prints object IDs and modes. No blob contents or descendants are requested.
  const raw = run(["ls-tree", "-z", commit, "--", file]);
  if (!raw) return null;
  const match = /^(\d{6}) (blob|commit|tree) ([a-f0-9]+)\t([^\0]+)\0$/.exec(raw);
  if (!match || !SHA.test(match[3]) || match[4] !== file) throw error("history_entry_unavailable");
  return match[1] === "100644" || match[1] === "100755" ? match[1] + " " + match[3] : null;
}

function scan(view, file, evidence, observation) {
  const run = historyReader(view.root);
  const shallow = run(["rev-parse", "--is-shallow-repository"]).trim();
  if (shallow !== "true" && shallow !== "false") throw error("history_read_unavailable");
  const commits = run(["rev-list", "--first-parent", "--max-count=" + (HISTORY_LIMIT + 1), view.revision.commitSha])
    .trim().split("\n");
  if (commits[0] !== view.revision.commitSha || commits.length > HISTORY_LIMIT + 1
      || !commits.every((sha) => SHA.test(sha))) throw error("history_read_unavailable");

  if (shallow === "true") observation.reasons.push("shallow_repository");
  if (commits.length > HISTORY_LIMIT) observation.reasons.push("history_commit_limit");
  let current = regularFileEntry(run, commits[0], file);
  for (let index = 0; index < Math.min(commits.length, HISTORY_LIMIT); index++) {
    // A shallow boundary with no local parent cannot establish an addition at a root.
    if (!commits[index + 1] && shallow === "true") break;
    const parent = commits[index + 1] ? regularFileEntry(run, commits[index + 1], file) : null;
    observation.commitsExamined++;
    if (current !== parent) {
      if (evidence.length === ENTRY_LIMIT) {
        observation.reasons.push("history_entry_limit");
        break;
      }
      const change = current === null ? "deleted" : parent === null ? "added" : "modified";
      evidence.push({ commitSha: commits[index], path: file, change });
    }
    current = parent;
  }
}

/** Return observed first-parent changes to one exact regular-file name at the registered project's commit. */
export function readProjectFileHistory(raw, options = {}) {
  const input = normalizeInput(raw);
  const view = readView(input, options);
  const observation = { basis: "first_parent_commit_history", historyLimit: HISTORY_LIMIT, entryLimit: ENTRY_LIMIT,
    commitsExamined: 0, incomplete: true, reasons: [] };
  const evidence = [];
  if (view.revision.status !== "available" || !SHA.test(view.revision.commitSha)) {
    observation.reasons.push("history_revision_unavailable");
  } else {
    try { scan(view, input.path, evidence, observation); }
    catch (e) { observation.reasons.push(e.code || "history_read_unavailable"); }
  }
  let after;
  try { after = readView(input, options); } catch { throw error("history_observation_changed"); }
  if (!isDeepStrictEqual(view, after)) throw error("history_observation_changed");
  observation.incomplete = observation.reasons.length > 0;
  const status = observation.incomplete
    ? (observation.commitsExamined ? "partial" : "unknown")
    : (evidence.length ? "available" : "unknown");
  return { schemaVersion: 1, operation: "project_file_history", projectId: input.projectId, project: view.project,
    revision: view.revision, path: input.path, status,
    findingState: evidence.length ? "evidence_found" : observation.commitsExamined ? "no_evidence_found" : "not_evaluated",
    observation, evidence };
}
