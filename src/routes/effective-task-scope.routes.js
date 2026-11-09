import { normalizeEffectiveTaskScopeRequest } from "../lib/effective-task-scope-policy.js";
import { createEffectiveTaskScopeBuilder } from "../lib/effective-task-scope-service.js";
import { validateProjectId } from "../lib/project-registry.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendOk, sendError } from "../utils/response.js";

const SUCCESS_MESSAGE = "Effective task scope constructed.";
const ERROR_MESSAGE = "Effective task scope could not be constructed safely.";
const TASK_BAD_REQUEST = new Set([
  "invalid_json",
  "invalid_project_identity",
  "invalid_task_context_request",
  "invalid_context_sources",
  "invalid_context_analysis",
  "project_identity_required",
  "context_budget_exceeded"
]);
const TASK_CONFLICT = new Set([
  "ambiguous_project",
  "project_identity_conflict",
  "worktree_parent_mismatch",
  "context_sources_changed",
  "context_revision_changed",
  "context_project_changed"
]);
const IMPACT_BAD_REQUEST = new Set([
  "invalid_project_identity",
  "project_identity_required",
  "invalid_json",
  "invalid_impact_request",
  "impact_budget_exceeded"
]);
const IMPACT_CONFLICT = new Set([
  "ambiguous_project",
  "project_identity_conflict",
  "worktree_parent_mismatch",
  "impact_sources_changed",
  "impact_revision_changed",
  "impact_project_changed"
]);
const NOT_FOUND = new Set(["project_not_found", "project_unavailable"]);

export function normalizeScopeBody(projectId, body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "projectId")) {
    throw routeError("invalid_effective_task_scope_request");
  }
  return normalizeEffectiveTaskScopeRequest({ ...body, projectId });
}

export function createEffectiveTaskScopeHandler(dependencies = {}) {
  const buildEvidence = createEffectiveTaskScopeBuilder(dependencies);
  return async function handleEffectiveTaskScope(req, res, params) {
    try {
      validateProjectId(params.projectId);
      const body = await readJsonBody(req, { limitBytes: 65536 });
      const { scope } = buildEvidence(normalizeScopeBody(params.projectId, body));
      sendOk(res, 200, scope, SUCCESS_MESSAGE);
    } catch (error) {
      const { status, code } = classifyEffectiveTaskScopeError(error);
      sendError(res, status, code, ERROR_MESSAGE);
    }
  };
}

function routeError(code) {
  return Object.assign(new Error(ERROR_MESSAGE), { code });
}

export function classifyEffectiveTaskScopeError(error) {
  const code = error?.code;
  if (error?.source === "task-context") return classifyTaskContextCode(code);
  if (error?.source === "impact") return classifyImpactCode(code);
  return classifyRouteCode(code);
}

function classifyTaskContextCode(code) {
  const status = code === "request_body_too_large" ? 413
    : TASK_BAD_REQUEST.has(code) ? 400
      : TASK_CONFLICT.has(code) ? 409
        : NOT_FOUND.has(code) ? 404
          : 500;
  return { status, code: status === 500 ? "task_context_failed" : code };
}

function classifyImpactCode(code) {
  if (code === "request_body_too_large") return { status: 413, code };
  if (IMPACT_BAD_REQUEST.has(code)) return { status: 400, code };
  if (NOT_FOUND.has(code)) return { status: 404, code };
  if (IMPACT_CONFLICT.has(code)) return { status: 409, code };
  return { status: 500, code: "impact_failed" };
}

function classifyRouteCode(code) {
  if (code === "request_body_too_large") return { status: 413, code };
  if (NOT_FOUND.has(code)) return { status: 404, code };
  if (TASK_CONFLICT.has(code) || IMPACT_CONFLICT.has(code)) return { status: 409, code };
  if (code === "effective_task_scope_adapter_failed" || code === undefined) {
    return { status: 500, code: "effective_task_scope_failed" };
  }
  return { status: 400, code };
}
