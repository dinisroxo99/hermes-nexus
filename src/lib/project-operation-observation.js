import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";
import { UNICODE_VERSION, namesCollide } from "./create-name-key.js";
import { materializeBoundedJsonData } from "./effective-task-scope-policy.js";
import { normalizeImpactPaths } from "./impact-policy.js";
import { OPERATION_TREE_LIMITS, observeTrackedTree, refuse, verifyDestinationDirectory } from "./operation-tree-evidence.js";
import { collectContextSources, isContextPathAllowed } from "./project-context-files.js";
import { crossesNestedBoundary, observeProjectCreate, readObservationBinding } from "./project-create-observation.js";
import { resolveProjectLocation } from "./project-roots.js";
import { getProjectByIdForIntelligence } from "./projects.js";
import { preflightGit } from "./task-diff-audit.js";
import { normalizeTaskContextRequest } from "./task-context-policy.js";

const FORMAT = "project-operation-evidence-v1";
const allowed = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj)
  && Object.keys(obj).every((key) => keys.includes(key));
const invalid = () => refuse("invalid_project_operation_request");

function checkPath(p) {
  if (typeof p !== "string" || !isContextPathAllowed(p) || normalizeImpactPaths([p])[0] !== p
      || p.split("/").length > 64 || !p.isWellFormed()) invalid();
}

function normalizeOperation(raw) {
  if (raw?.kind === "expand_directory" && allowed(raw, ["kind", "path"])) {
    checkPath(raw.path);
    return { kind: raw.kind, path: raw.path };
  }
  if (!allowed(raw, ["kind", "oldPath", "newPath"]) || !["move", "rename"].includes(raw.kind)) invalid();
  checkPath(raw.oldPath);
  checkPath(raw.newPath);
  const oldParts = raw.oldPath.split("/");
  const newParts = raw.newPath.split("/");
  if (oldParts.length === newParts.length && oldParts.every((s, i) => namesCollide(s, newParts[i]))) {
    refuse("operation_name_collision");
  }
  return { kind: raw.kind, oldPath: raw.oldPath, newPath: raw.newPath };
}

function normalizeInput(raw) {
  const input = materializeBoundedJsonData(raw);
  if (!allowed(input, ["projectId", "worktree", "task", "operation", "expectedCommitSha", "expectedEvidenceDigest"])
      || !allowed(input.worktree, ["rootId", "relativePath"]) || !input.worktree.rootId
      || !allowed(input.task, ["id", "title"]) || !input.task.id) invalid();
  if (Object.hasOwn(input, "expectedCommitSha") && (typeof input.expectedCommitSha !== "string"
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.expectedCommitSha))) invalid();
  if (Object.hasOwn(input, "expectedEvidenceDigest") && (typeof input.expectedEvidenceDigest !== "string"
      || !/^[0-9a-f]{64}$/.test(input.expectedEvidenceDigest))) invalid();
  const { projectId, task, worktree } = normalizeTaskContextRequest({
    projectId: input.projectId, task: input.task, worktree: input.worktree
  });
  if (!task.id || worktree.relativePath !== input.worktree.relativePath || worktree.rootId !== input.worktree.rootId) invalid();
  return { projectId, task: { id: task.id, title: task.title }, worktree,
    operation: normalizeOperation(input.operation), expectedCommitSha: input.expectedCommitSha,
    expectedEvidenceDigest: input.expectedEvidenceDigest };
}

function checkedBinding(input, registry) {
  const parent = getProjectByIdForIntelligence(input.projectId, registry);
  const target = resolveProjectLocation(input.worktree, registry.roots);
  try {
    preflightGit(parent.absolutePath);
    if (target !== parent.absolutePath) preflightGit(target);
  } catch { refuse("operation_git_preflight_unsupported"); }
  const binding = readObservationBinding(input, registry);
  if (input.expectedCommitSha && binding.revision.commitSha !== input.expectedCommitSha) refuse("operation_stale");
  if (binding.revision.status !== "available" || binding.revision.dirty !== false || !binding.revision.isLinkedWorktree) {
    refuse("operation_clean_linked_worktree_required");
  }
  return binding;
}

function observeSnapshot(input, binding) {
  const project = { projectId: input.projectId, absolutePath: binding.root };
  const result = collectContextSources(project, { excludedPaths: binding.excluded });
  if (result.truncated || result.diagnostics.length) refuse("operation_source_evidence_incomplete");
  return createProviderSnapshot(project, result.files, { ...binding.revision,
    repositoryId: binding.repositoryId, worktreeId: binding.worktreeId });
}

function destinationFor(input, binding, token, registry) {
  const dest = input.operation.newPath;
  const result = observeProjectCreate({ projectId: input.projectId, worktree: input.worktree,
    expectedCommitSha: binding.revision.commitSha, task: { ...input.task, paths: [dest] } }, registry);
  const row = result.observations[0];
  if (result.snapshotToken !== token) refuse("operation_source_changed");
  if (result.scope.status !== "incomplete" || result.scope.operationIntent?.kind !== "create"
      || result.scope.write?.items?.length !== 1 || result.scope.write.items[0].target.path !== dest
      || row?.newPath !== dest || !row.complete || row.verdict !== "absent") refuse("operation_destination_not_proven_absent");
  verifyDestinationDirectory(binding.root, dest);
  return { path: dest, verdict: row.verdict, complete: true };
}

/** Produce a point-in-time read-only file operation manifest. A refusal returns no partial file list. */
export function observeProjectOperation(raw, registry = {}) {
  const input = normalizeInput(raw);
  if (process.versions.unicode !== UNICODE_VERSION) refuse("operation_unicode_unsupported");
  const binding = checkedBinding(input, registry);
  const { operation } = input;
  const directory = operation.kind === "expand_directory";
  const targets = directory ? [operation.path] : [operation.oldPath, operation.newPath];
  if (targets.some((p) => crossesNestedBoundary(p, binding.excluded))) refuse("operation_nested_project_target");
  // A registered child remains a boundary even when the directory no longer exists in this checkout.
  if (directory && binding.excluded.some((p) => crossesNestedBoundary(p, targets))) refuse("operation_directory_boundary");
  const snapshot = observeSnapshot(input, binding);
  const tree = observeTrackedTree(binding, snapshot, operation);
  const destination = directory ? null : destinationFor(input, binding, snapshot.token, registry);
  const after = observeSnapshot(input, binding);
  if (snapshot.token !== after.token || !isDeepStrictEqual(tree, observeTrackedTree(binding, after, operation))) {
    refuse("operation_observation_changed");
  }
  if (!directory) destinationFor(input, binding, after.token, registry);
  if (!isDeepStrictEqual(binding, checkedBinding(input, registry))) refuse("operation_observation_changed");

  const evidence = { format: FORMAT, projectId: input.projectId, worktree: input.worktree, task: input.task,
    revision: binding.revision, repositoryId: binding.repositoryId, worktreeId: binding.worktreeId,
    snapshotToken: snapshot.token, operation, destination, ...tree, limits: OPERATION_TREE_LIMITS, complete: true };
  const evidenceDigest = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  if (input.expectedEvidenceDigest && input.expectedEvidenceDigest !== evidenceDigest) refuse("operation_evidence_changed");
  return { ...evidence, evidenceDigest };
}
