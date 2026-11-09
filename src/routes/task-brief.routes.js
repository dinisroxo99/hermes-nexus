import { buildTaskBrief } from "../lib/task-brief.js";
import { validateProjectId } from "../lib/project-registry.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendError, sendOk } from "../utils/response.js";
import { projectEvidenceOptions } from "./project-evidence-options.js";

const BAD = new Set(["invalid_json", "invalid_project_identity", "invalid_task_brief", "invalid_task_context_request",
  "invalid_impact_request", "task_brief_boundary_excluded", "context_budget_exceeded", "impact_budget_exceeded"]);
const MISSING = new Set(["project_unavailable", "project_not_found"]);
const CONFLICT = new Set(["task_brief_observation_changed", "task_brief_revision_unavailable", "worktree_parent_mismatch",
  "project_identity_conflict", "ambiguous_project", "context_sources_changed", "context_revision_changed", "context_project_changed",
  "impact_sources_changed", "impact_revision_changed", "impact_project_changed"]);

export function createTaskBriefHandler(dependencies = {}) {
  return async (req, res, { projectId }) => {
    try {
      validateProjectId(projectId);
      const body = await readJsonBody(req, { limitBytes: 65536 });
      const result = buildTaskBrief(projectId, body, projectEvidenceOptions(dependencies), dependencies);
      sendOk(res, 200, result, "Task brief constructed.");
    } catch (error) {
      const code = error?.code;
      const status = code === "request_body_too_large" ? 413 : BAD.has(code) ? 400 : MISSING.has(code) ? 404
        : CONFLICT.has(code) ? 409 : 500;
      sendError(res, status, status === 500 ? "task_brief_failed" : code, "Task brief could not be constructed.");
    }
  };
}
