import path from "node:path";
import { buildProjectTaskContext } from "../lib/task-context.js";
import { validateProjectId } from "../lib/project-registry.js";
import { getConfiguredProjectRoots } from "../lib/project-roots.js";
import { resolveProjectConfig } from "../lib/project-config.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendOk, sendError } from "../utils/response.js";

const BAD_REQUEST = new Set(["invalid_json", "invalid_project_identity", "invalid_task_context_request", "invalid_context_sources", "invalid_context_analysis", "project_identity_required", "context_budget_exceeded"]);
const CONFLICT = new Set(["ambiguous_project", "project_identity_conflict", "worktree_parent_mismatch", "context_sources_changed", "context_revision_changed", "context_project_changed"]);

export function createTaskContextHandler(dependencies = {}) {
  const build = dependencies.buildProjectTaskContext || buildProjectTaskContext;
  return async function handleTaskContext(req, res, params) {
    try {
      validateProjectId(params.projectId);
      const body = await readJsonBody(req, { limitBytes: 64 * 1024 });
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "projectId")) {
        throw Object.assign(new Error("Invalid request."), { code: "invalid_task_context_request" });
      }
      const config = (dependencies.getProjectConfig || resolveProjectConfig)();
      const registry = {
        roots: (dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots)(),
        manualProjectsFile: path.join(config.dataDir, "projects.json"),
        discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json")
      };
      const pack = build({ ...body, projectId: params.projectId }, { registry });
      sendOk(res, 200, pack, "Task context constructed.");
    } catch (error) {
      const code = error?.code;
      const status = code === "request_body_too_large" ? 413 : BAD_REQUEST.has(code) ? 400
        : CONFLICT.has(code) ? 409 : ["project_not_found", "project_unavailable"].includes(code) ? 404 : 500;
      sendError(res, status, status === 500 ? "task_context_failed" : code, "Task context could not be constructed safely.");
    }
  };
}
