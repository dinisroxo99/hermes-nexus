import { observeProjectOperation } from "../lib/project-operation-observation.js";
import { validateProjectId } from "../lib/project-registry.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendError, sendOk } from "../utils/response.js";
import { projectEvidenceOptions } from "./project-evidence-options.js";

const CONFLICT = new Set(["operation_source_changed", "operation_directory_changed", "operation_observation_changed", "operation_evidence_changed", "operation_destination_changed",
  "operation_stale", "worktree_parent_mismatch", "ambiguous_project", "project_identity_conflict"]);
const MISSING = new Set(["project_not_found", "project_unavailable"]);

export function createProjectOperationHandler(dependencies = {}) {
  return async (req, res, { projectId }) => {
    try {
      validateProjectId(projectId);
      const input = await readJsonBody(req, { limitBytes: 65536 });
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.hasOwn(input, "projectId")) {
        throw Object.assign(new Error(), { code: "invalid_project_operation_request" });
      }
      const { registry } = projectEvidenceOptions(dependencies);
      const evidence = observeProjectOperation({ ...input, projectId }, registry);
      sendOk(res, 200, evidence, "Project operation observed.");
    } catch (error) {
      const code = error?.code;
      const status = code === "request_body_too_large" ? 413 : CONFLICT.has(code) ? 409 : MISSING.has(code) ? 404
        : /^invalid_[a-z_]{1,50}$/.test(code) ? 400 : /^(?:operation|diff|create_observation)_[a-z_]{1,60}$/.test(code) ? 422 : 500;
      sendError(res, status, status === 500 ? "project_operation_failed" : code, "Project operation could not be observed.");
    }
  };
}
