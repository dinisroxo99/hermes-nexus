import { execFileSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION, compareStrings, normalizeEffectiveTaskScopeRequest
} from "./effective-task-scope-policy.js";
import { createEffectiveTaskScopeBuilder } from "./effective-task-scope-service.js";
import { normalizeImpactPaths } from "./impact-policy.js";
import { resolveProjectConfig } from "./project-config.js";
import { readProjectRevision } from "./project-revision.js";
import { getConfiguredProjectRoots, resolveProjectLocation } from "./project-roots.js";
import { getProjectByIdForIntelligence, getNestedProjectPaths, resolveProjectWorktree } from "./projects.js";

const FORMAT = "task-diff-baseline-v1";
const MAX_PATHS = 256;
export const MAX_RECEIPT_BYTES = 131072;
const HEX = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
export const baselineDigest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readGit(directory, args, maxBuffer, input, overrides = []) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", LC_ALL: "C" });
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...overrides, "--literal-pathspecs", "-C", directory, ...args], {
      env, timeout: 3000, maxBuffer, input, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"]
    });
  } catch {
    fail("diff_git_observation_unavailable");
  }
}

function filterOverrides(directory, names, index) {
  const drivers = new Set();
  for (const key of names) {
    const match = /^filter\.(.*)\.(?:clean|smudge|process)$/s.exec(key);
    if (match) drivers.add(match[1]);
  }
  if (!drivers.size) return [];

  // Query both attribute views before status reads file contents. The index can contain arbitrary pathname bytes.
  const paths = index.map((entry) => entry.slice(entry.indexOf("\t") + 1));
  const input = Buffer.from(paths.length ? paths.join("\0") + "\0" : "", "latin1");
  for (const flags of [[], ["--cached"]]) {
    const attrs = readGit(directory, ["check-attr", ...flags, "-z", "--stdin", "filter"], 4194304, input)
      .toString("latin1").split("\0");
    if (attrs.pop() !== "" || attrs.length !== 3 * paths.length) fail("diff_git_helpers_unsupported");
    for (let i = 0; i < paths.length; i++) {
      if (attrs[i * 3] !== paths[i] || attrs[i * 3 + 1] !== "filter" || drivers.has(attrs[i * 3 + 2])) {
        fail("diff_git_helpers_unsupported");
      }
    }
  }
  // Disable known, inactive drivers in the audit's own status subprocess too. Shared revision readers use preflight.
  const overrides = [];
  for (const name of drivers) {
    // Round-trip raw bytes from Git config instead of interpreting a byte sequence as another driver.
    let driver;
    try { driver = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Buffer.from(name, "latin1")); }
    catch { fail("diff_git_helpers_unsupported"); }
    for (const setting of ["clean=", "smudge=", "process=", "required=false"]) {
      overrides.push("-c", `filter.${driver}.${setting}`);
    }
  }
  return overrides;
}

export function preflightGit(directory) {
  // git config only reads configuration. Check system/global/local/worktree settings and includes before status.
  const names = readGit(directory, ["config", "--includes", "--null", "--name-only", "--list"], 262144)
    .toString("latin1").split("\0");
  if (names.some((key) => key.startsWith("diff.") && /\.(command|textconv|external)$/.test(key)
      || key === "extensions.partialclone" || key.startsWith("remote.") && /\.(promisor|partialclonefilter)$/.test(key))) {
    fail("diff_git_helpers_unsupported");
  }
  // A status scan could descend into a submodule with its own unchecked config. Inspect index metadata only.
  const index = readGit(directory, ["ls-files", "-v", "--stage", "-z", "--cached"], 1048576)
    .toString("latin1").split("\0");
  if (index.pop() !== "" || index.some((entry) => !/^[HRMKUC] [0-7]{6} [a-f0-9]+ [0-3]\t/.test(entry))) {
    fail("diff_index_coverage_unavailable");
  }
  if (index.some((entry) => entry.startsWith("160000 ", 2))) fail("diff_submodule_unsupported");
  // A staged deletion can remove a gitlink from the index while HEAD still supplies its diff endpoint.
  const modes = readGit(directory, ["ls-tree", "-r", "--format=%(objectmode)", "HEAD"], 1048576).toString("ascii");
  if (modes.split("\n").includes("160000")) fail("diff_submodule_unsupported");
  return filterOverrides(directory, names, index);
}

function protectedPath(name, excluded) {
  // Conservatively cover alternate case and Unicode normalization on case-insensitive filesystems.
  const key = name.normalize("NFC").toLowerCase();
  return excluded.some((base) => {
    const prefix = base.normalize("NFC").toLowerCase();
    return key === prefix || key.startsWith(prefix + "/");
  });
}

function auditRegistry(dataDir, roots) {
  return { roots, manualProjectsFile: path.join(dataDir, "projects.json"),
    discoveredProjectsFile: path.join(dataDir, "discovered-projects.json") };
}

function observe(location, registry) {
  if (!exact(location, ["projectId", "worktree"])) fail("diff_invalid_worktree");
  const { projectId, worktree } = location;
  // Validate the raw locator before resolving the Git-listed checkout of this registered parent.
  if (!exact(worktree, ["rootId", "relativePath"]) || typeof worktree.rootId !== "string"
      || !worktree.rootId.trim() || worktree.rootId.length > 128 || /[\u0000-\u001f\u007f]/.test(worktree.rootId)
      || normalizeImpactPaths([worktree.relativePath])[0] !== worktree.relativePath) fail("diff_invalid_worktree");
  const parent = getProjectByIdForIntelligence(projectId, registry);
  const checkout = resolveProjectLocation(worktree, registry.roots);
  preflightGit(parent.absolutePath);
  const overrides = preflightGit(checkout);
  const project = resolveProjectWorktree(projectId, worktree, registry);
  const r = readProjectRevision(project);
  if (r.status !== "available" || r.isLinkedWorktree !== true || r.evidence?.projectSubdirectory !== "."
      || !HEX.test(r.repositoryIdentity) || !HEX.test(r.worktreeId)) fail("diff_binding_unavailable");
  const revision = { status: r.status, commitSha: r.commitSha, branch: r.branch, dirty: r.dirty,
    isLinkedWorktree: true, repositoryId: r.repositoryIdentity, worktreeId: r.worktreeId };
  const excluded = getNestedProjectPaths(project, registry);
  const status = readGit(project.absolutePath, ["status", "--porcelain=v1", "-z", "--renames",
    "--untracked-files=all", "--ignore-submodules=none"], 65536, undefined, overrides);
  // Inspect both rename endpoints before exporting any path, even when other ordinary paths also changed.
  const changes = changedPaths(status, excluded);
  return { directory: project.absolutePath, revision, excluded, status, changes };
}

function taskRequest(location, task, revision) {
  const request = normalizeEffectiveTaskScopeRequest({ ...location, task, expectedRevision: revision, includeTests: false });
  if (request.task.symbols.length) fail("diff_file_tasks_only");
  return request;
}

export function captureDiffBaseline(location, task, { dataDir = resolveProjectConfig().dataDir, roots = getConfiguredProjectRoots() } = {}) {
  const registry = auditRegistry(dataDir, roots);
  const before = observe(location, registry);
  if (before.revision.dirty !== false || before.status.length) fail("diff_base_not_clean");
  const request = taskRequest(location, task, before.revision);
  if (request.task.paths.some((name) => protectedPath(name, before.excluded))) fail("diff_nested_project_target");
  // The offline capture uses the built-in producers, including when a deployment enables the optional container.
  const build = createEffectiveTaskScopeBuilder({ getProjectConfig: () => ({ dataDir }), getConfiguredProjectRoots: () => roots });
  const { scope, impact } = build(request);
  const paths = scope.write?.items?.map((item) => item.target?.kind === "file" && item.target.path);
  const token = scope.sourceBinding?.contextSnapshotToken;
  if (!["available", "incomplete"].includes(scope.status) || scope.stale?.state !== "bound"
      || scope.write?.status !== "available" || scope.write.truncated !== false
      || !isDeepStrictEqual(paths, request.task.paths) || !isDeepStrictEqual(scope.revisionBinding, before.revision)
      || !HEX.test(token) || token !== scope.sourceBinding.impactSnapshotToken) fail("diff_write_evidence_unavailable");
  for (const file of paths) {
    const target = impact.targets.find((entry) => entry.originPath === file)?.targetSource;
    if (target?.path !== file || !HEX.test(target.hash)) fail("diff_base_source_unavailable");
    // Verify the source backing WRITE really belongs to this commit, even if an ignore rule or filter hid a change.
    const contents = readGit(before.directory, ["cat-file", "blob", before.revision.commitSha + ":" + file], 131072);
    if (baselineDigest(contents) !== target.hash) fail("diff_base_source_unavailable");
  }
  if (!isDeepStrictEqual(before, observe(location, registry))) fail("diff_observation_changed");
  const receipt = { format: FORMAT, policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION, ...location,
    task: request.task, revision: before.revision, snapshotToken: token, writePaths: paths };
  const bytes = Buffer.from(JSON.stringify(receipt) + "\n");
  if (bytes.length > MAX_RECEIPT_BYTES) fail("diff_baseline_too_large");
  return bytes;
}

function validateReceipt(location, taskId, bytes, pin, observed) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_RECEIPT_BYTES || !HEX.test(pin)
      || baselineDigest(bytes) !== pin) fail("diff_baseline_pin_mismatch");
  let receipt;
  try { receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { fail("diff_invalid_baseline"); }
  if (!exact(receipt, ["format", "policyVersion", "projectId", "worktree", "task", "revision", "snapshotToken", "writePaths"])
      || receipt.format !== FORMAT || receipt.policyVersion !== EFFECTIVE_TASK_SCOPE_POLICY_VERSION
      || !HEX.test(receipt.snapshotToken) || typeof receipt.snapshotToken !== "string") fail("diff_invalid_baseline");
  if (receipt.projectId !== location.projectId || !isDeepStrictEqual(receipt.worktree, location.worktree)
      || receipt.task?.id !== taskId || !isDeepStrictEqual(receipt.revision, { ...observed, dirty: false })) {
    fail("diff_baseline_binding_mismatch");
  }
  const request = taskRequest(location, receipt.task, receipt.revision);
  if (!isDeepStrictEqual(request.task, receipt.task) || !isDeepStrictEqual(receipt.writePaths, request.task.paths)) {
    fail("diff_invalid_baseline");
  }
  return new Set(receipt.writePaths);
}

// In porcelain v1 -z a rename/copy record is followed by its original pathname.
function changedPaths(bytes, excluded) {
  if (!bytes.length) return [];
  let fields;
  try { fields = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes).split("\0"); }
  catch { fail("diff_path_encoding_unsupported"); }
  if (fields.pop() !== "") fail("diff_status_unavailable");
  const paths = new Set();
  for (let index = 0; index < fields.length; index++) {
    const record = fields[index];
    const status = record.slice(0, 2);
    if (record[2] !== " " || !/^[ MADRCUT?]{2}$/.test(status)) fail("diff_status_unavailable");
    const names = [record.slice(3)];
    if (/[RC]/.test(status)) names.push(fields[++index]);
    for (const name of names) {
      if (name && protectedPath(name, excluded)) fail("diff_nested_project_change");
      if (!name || name.endsWith("/") || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)
          || Buffer.byteLength(name) > 1024) fail("diff_path_unsupported");
      paths.add(name);
      if (paths.size > MAX_PATHS) fail("diff_path_limit");
    }
  }
  return [...paths].sort(compareStrings);
}

export function auditTaskDiff(location, taskId, bytes, pin, { dataDir = resolveProjectConfig().dataDir, roots = getConfiguredProjectRoots() } = {}) {
  const registry = auditRegistry(dataDir, roots);
  const before = observe(location, registry);
  const write = validateReceipt(location, taskId, bytes, pin, before.revision);
  if ([...write].some((name) => protectedPath(name, before.excluded))) fail("diff_nested_project_target");
  const changes = before.changes.map((path) => ({
    path, classification: write.has(path) ? "in_write" : "outside_write"
  }));
  if (!isDeepStrictEqual(before, observe(location, registry))) fail("diff_observation_changed");
  const report = { format: "task-diff-audit-v1", ...location, taskId, baseCommit: before.revision.commitSha,
    baselineDigest: pin, finding: changes.some(({ classification }) => classification === "outside_write")
      ? "outside_write_observed" : "no_outside_write_observed", changes };
  if (Buffer.byteLength(JSON.stringify(report)) + 1 > MAX_RECEIPT_BYTES) fail("diff_output_too_large");
  return report;
}
