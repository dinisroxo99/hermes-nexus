import { createEffectiveTaskScopeBuilder } from "../lib/effective-task-scope-service.js";
import { validateProjectId } from "../lib/project-registry.js";
import { compareObservedTaskEvidence } from "../lib/compare-observed-tasks.js";
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
      const result = compareObservedTaskEvidence(first, second);
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
