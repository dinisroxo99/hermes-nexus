import { buildCreateDestinationAbsenceWitness } from "./create-destination-absence-witness.js";
import { namesCollide } from "./create-name-key.js";
import { composeEffectiveTaskScopeFromEnvelopes } from "./effective-task-scope-adapter.js";
import { materializeBoundedJsonData, normalizeEffectiveTaskScopeRequest } from "./effective-task-scope-policy.js";
import { canonicalImpactOriginForm } from "./impact-origin-form.js";
import { normalizeImpactRequest } from "./impact-policy.js";
import { buildProjectImpact } from "./project-impact-service.js";
import { readProjectRevision } from "./project-revision.js";
import { getNestedProjectPaths, getProjectByIdForIntelligence, resolveProjectWorktree } from "./projects.js";
import { buildProjectTaskContext } from "./task-context.js";
import { normalizeTaskContextRequest } from "./task-context-policy.js";

const error = (code) => Object.assign(new Error(code), { code });
const invalid = () => error("invalid_create_observation_request");
const fields = (object, keys) => object && typeof object === "object" && !Array.isArray(object)
  && Object.keys(object).every((key) => keys.includes(key));

function normalizeInput(raw) {
  const input = materializeBoundedJsonData(raw);
  if (!fields(input, ["projectId", "worktree", "task", "expectedCommitSha"])
      || !fields(input.task, ["id", "title", "paths"]) || !input.task.id
      || !fields(input.worktree, ["rootId", "relativePath"]) || !input.worktree.rootId) throw invalid();
  if (Object.hasOwn(input, "expectedCommitSha") && (typeof input.expectedCommitSha !== "string"
      || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.expectedCommitSha))) throw invalid();
  const { paths, worktree } = normalizeImpactRequest({ paths: input.task.paths, worktree: input.worktree });
  const { task } = normalizeTaskContextRequest({ projectId: input.projectId, worktree, task: input.task });
  if (!task.id || !input.task.paths.every((p) => paths.includes(p))
      || worktree.relativePath !== input.worktree.relativePath) throw invalid();
  return { projectId: input.projectId, task: { id: task.id, title: task.title, paths, symbols: [] },
    worktree, expectedCommitSha: input.expectedCommitSha };
}

function readBinding(input, registry) {
  const parent = getProjectByIdForIntelligence(input.projectId, registry);
  const forwarded = parent.rootId !== input.worktree.rootId || parent.relativePath !== input.worktree.relativePath;
  const project = forwarded ? resolveProjectWorktree(input.projectId, input.worktree, registry) : parent;
  const { status, commitSha, branch, dirty, isLinkedWorktree, repositoryIdentity, worktreeId } = readProjectRevision(project);
  if (!repositoryIdentity || !worktreeId) throw error("create_observation_identity_unavailable");
  return {
    root: project.absolutePath, parent: parent.absolutePath, forwarded,
    excluded: getNestedProjectPaths(project, registry),
    revision: { status, commitSha, branch, dirty, isLinkedWorktree },
    repositoryId: repositoryIdentity, worktreeId
  };
}

// A registered root is reserved even if its directory disappeared in this revision. The
// absence producer walks ancestors, so this also protects the root basename itself and aliases.
function crossesNestedBoundary(target, boundaries) {
  const parts = target.split("/");
  return boundaries.some((boundary) => {
    const prefix = boundary.split("/");
    return prefix.length <= parts.length && prefix.every((segment, i) => namesCollide(segment, parts[i]));
  });
}

/** Read-only classification of explicitly proposed file creations on a registered project/worktree. */
export function observeProjectCreate(raw, registry = {}) {
  const input = normalizeInput(raw);
  const binding = readBinding(input, registry);
  if (input.expectedCommitSha && input.expectedCommitSha !== binding.revision.commitSha) {
    throw error("create_observation_stale");
  }
  const { projectId, worktree, task } = input;
  if (task.paths.some((target) => crossesNestedBoundary(target, binding.excluded))) {
    throw error("create_observation_nested_project_target");
  }
  const { repositoryId, worktreeId, revision } = binding;
  const request = normalizeEffectiveTaskScopeRequest({
    projectId, worktree, task, expectedRevision: { ...revision, repositoryId, worktreeId }, includeTests: false,
    operationIntent: { kind: "create", targets: task.paths.map((newPath) => ({ oldPath: null, newPath })) }
  }, { allowCreateIntent: true });
  const location = binding.forwarded ? { worktree } : {};
  const pack = buildProjectTaskContext({ projectId, task, ...location }, { registry });
  const impact = buildProjectImpact(projectId, { paths: task.paths, includeTests: false, ...location }, { registry });
  const envelopes = { pack: { ok: true, data: pack }, impact: { ok: true, data: canonicalImpactOriginForm(request, impact) } };
  let scope = composeEffectiveTaskScopeFromEnvelopes(request, envelopes);
  let observations = [];
  // A no-witness composition checks task, revision, snapshot, provider, origin, and clean linked-worktree gates first.
  const needsWitness = scope.status === "not_evaluated" && scope.reasons.some(({ code }) =>
    code === "create_destination_absence_not_proven" || code === "impact_not_evaluated");
  if (needsWitness) {
    const witness = buildCreateDestinationAbsenceWitness({
      projectRoot: binding.root, request: { paths: task.paths }, nestedProjectPaths: binding.excluded,
      expected: { projectId, repositoryId, worktreeId, revision, locator: worktree, snapshotToken: pack.analysis.snapshotToken }
    });
    scope = composeEffectiveTaskScopeFromEnvelopes(request, { ...envelopes, createDestinationAbsenceWitness: { ok: true, data: witness } });
    observations = witness.targets.map(({ newPath, verdict, complete, incompleteReason }) => ({ newPath, verdict, complete, incompleteReason }));
  }
  if (JSON.stringify(binding) !== JSON.stringify(readBinding(input, registry))) throw error("create_observation_changed");
  return { projectId, worktree, commitSha: revision.commitSha, snapshotToken: pack.analysis.snapshotToken, observations, scope };
}
