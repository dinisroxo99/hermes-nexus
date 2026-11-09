import { createEffectiveTaskScopeBuilder } from "../lib/effective-task-scope-service.js";
import { validateProjectId } from "../lib/project-registry.js";
import { matchesImpactBinding } from "../lib/task-conflict-impact.js";
import { compareTaskScopes } from "../lib/task-conflict-comparison.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendOk, sendError } from "../utils/response.js";
import { classifyEffectiveTaskScopeError, normalizeScopeBody } from "./effective-task-scope.routes.js";

export function createTaskConflictsHandler(dependencies = {}) {
  const buildEvidence = createEffectiveTaskScopeBuilder(dependencies);
  return async function handleTaskConflicts(req, res, { projectId }) {
    try {
      validateProjectId(projectId);
      const body = await readJsonBody(req, { limitBytes: 128 * 1024 });
      if (!body || typeof body !== "object" || Object.keys(body).length !== 2
        || !Object.hasOwn(body, "left") || !Object.hasOwn(body, "right")) {
        throw invalidPair();
      }
      // Normalize both intents before either one can read the project.
      const left = normalizeScopeBody(projectId, body.left);
      const right = normalizeScopeBody(projectId, body.right);
      if (left.task.id === right.task.id) throw invalidPair();

      const first = buildEvidence(left);
      const second = buildEvidence(right);
      const result = compareTaskScopes(first.scope, second.scope, {
        leftImpact: first.impact, rightImpact: second.impact,
        leftSymbolWitness: first.acceptedSymbolWitness, rightSymbolWitness: second.acceptedSymbolWitness,
        leftPeerImpact: observePeerOrigins(first, second), rightPeerImpact: observePeerOrigins(second, first)
      });
      sendOk(res, 200, result, "Task scopes compared.");
    } catch (error) {
      const { status, code } = classifyEffectiveTaskScopeError(error);
      sendError(res, status, code, "Task scopes could not be compared safely.");
    }
  };
}

function invalidPair() {
  return Object.assign(new Error("Expected two distinct task requests."), { code: "invalid_task_conflict_request" });
}

// Recheck both sibling observations after the primary scopes have been built. A task
// writing the other's dependant uses this same check to corroborate the origin on its own checkout.
function observePeerOrigins(writer, observer) {
  const a = writer.scope;
  const b = observer.scope;
  if (!["available", "incomplete"].includes(a.status) || !["available", "incomplete"].includes(b.status)
      || a.projectId !== b.projectId || a.revisionBinding.repositoryId !== b.revisionBinding.repositoryId
      || a.revisionBinding.worktreeId === b.revisionBinding.worktreeId) return null;
  const written = new Set(a.write.items.map((item) => item.target.path));
  const needsDependency = [...b.watch.items, ...b.impact.items].some((item) => written.has(item.target.path));
  const observation = writer.impactForPaths(needsDependency ? b.task.paths : a.task.paths);
  if (!matchesImpactBinding(observation, a)) {
    throw Object.assign(new Error("Task comparison observation changed."), { code: "impact_sources_changed", source: "impact" });
  }
  return needsDependency ? observation : null;
}
