import path from "node:path";

import { composeEffectiveTaskScopeFromEnvelopes as composeEffectiveTaskScopeFromEnvelopesDefault } from "../lib/effective-task-scope-adapter.js";
import { normalizeEffectiveTaskScopeRequest } from "../lib/effective-task-scope-policy.js";
import { buildProjectImpact as buildProjectImpactDefault } from "../lib/project-impact-service.js";
import { resolveProjectConfig } from "../lib/project-config.js";
import { validateProjectId } from "../lib/project-registry.js";
import { getConfiguredProjectRoots } from "../lib/project-roots.js";
import { buildProjectTaskContext as buildProjectTaskContextDefault } from "../lib/task-context.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendOk, sendError } from "../utils/response.js";

const SUCCESS_MESSAGE = "Effective task scope constructed.";
const ERROR_MESSAGE = "Effective task scope could not be constructed safely.";
const TASK_CONTEXT_MESSAGE = "Task context constructed.";
const IMPACT_MESSAGE = "Project impact constructed.";

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

export function createEffectiveTaskScopeHandler(dependencies = {}) {
  const buildTaskContext = dependencies.buildProjectTaskContext || buildProjectTaskContextDefault;
  const buildImpact = dependencies.buildProjectImpact || buildProjectImpactDefault;
  const compose = dependencies.composeEffectiveTaskScopeFromEnvelopes || composeEffectiveTaskScopeFromEnvelopesDefault;
  const getConfig = dependencies.getProjectConfig || resolveProjectConfig;
  const getRoots = dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots;

  return async function handleEffectiveTaskScope(req, res, params) {
    try {
      validateProjectId(params.projectId);
      const body = await readJsonBody(req, { limitBytes: 65536 });
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "projectId")) {
        throw routeError("invalid_effective_task_scope_request");
      }
      const request = normalizeEffectiveTaskScopeRequest({ ...body, projectId: params.projectId });
      const config = getConfig();
      const registry = {
        roots: getRoots(),
        manualProjectsFile: path.join(config.dataDir, "projects.json"),
        discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json")
      };
      const analyzer = config.serenaPythonImage ? { serena: { image: config.serenaPythonImage } } : undefined;
      const options = { registry, ...(analyzer ? { analyzer } : {}) };

      let pack;
      try {
        // The pack echoes the task it is built from, and the composer binds that echo to the request
        // task (id, title, paths, symbols), so forward exactly the normalized request task.
        pack = buildTaskContext({
          projectId: params.projectId,
          task: { id: request.task.id, title: request.task.title, paths: request.task.paths, symbols: request.task.symbols }
        }, options);
      } catch (error) {
        throw sourced(error, "task-context");
      }

      const impactRequest = impactEvidenceRequest(request, pack);
      let impact;
      try {
        impact = buildImpact(params.projectId, impactRequest, options);
      } catch (error) {
        throw sourced(error, "impact");
      }

      let data;
      try {
        data = compose(request, {
          pack: { ok: true, data: pack, message: TASK_CONTEXT_MESSAGE },
          impact: { ok: true, data: canonicalImpactOriginForm(request, impact), message: IMPACT_MESSAGE }
        });
      } catch (error) {
        throw sourced(error, "compose");
      }

      sendOk(res, 200, data, SUCCESS_MESSAGE);
    } catch (error) {
      const { status, code } = classifyEffectiveTaskScopeError(error);
      sendError(res, status, code, ERROR_MESSAGE);
    }
  };
}

function impactEvidenceRequest(request, pack) {
  const impactRequest = { paths: request.task.paths, includeTests: request.includeTests };
  const revision = pack && typeof pack === "object" && !Array.isArray(pack) ? pack.revision : undefined;
  if (!revision || typeof revision !== "object" || Array.isArray(revision)) return impactRequest;
  if (revision.repositoryId != null && revision.worktreeId != null) {
    impactRequest.repositoryId = revision.repositoryId;
    impactRequest.worktreeId = revision.worktreeId;
  }
  return impactRequest;
}

const LEGACY_IMPACT_KEYS = Object.freeze(["schemaVersion", "analysisVersion", "projectId", "project", "originPath", "revision",
  "worktree", "snapshotToken", "generatedAt", "provider", "coverage", "observation", "limits", "status", "findingState",
  "affectedFiles", "affectedTests", "completeness"]);
const LEGACY_OBSERVATION_KEYS = Object.freeze(["basis", "cacheReuse", "digestCoverage", "targetSource", "incomplete"]);

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Pure, total view: the single-origin Impact the route itself just built for a one-path task
 * is re-expressed in the multi-origin targets[] form the composer accepts. Any shape that is not
 * exactly that (both forms, other key sets, a different or non-string origin, a malformed
 * targetSource, a task with != 1 path) is returned unchanged, so the composer still rejects it.
 * No field value is recomputed; bound bytes (snapshotToken, targetSource.hash, witnesses) are copied.
 */
function canonicalImpactOriginForm(request, impact) {
  const paths = request?.task?.paths;
  if (!Array.isArray(paths) || paths.length !== 1) return impact;
  if (!exactKeys(impact, LEGACY_IMPACT_KEYS) || Object.hasOwn(impact, "targets")) return impact;
  if (typeof impact.originPath !== "string" || impact.originPath !== paths[0]) return impact;
  const observation = impact.observation;
  if (!exactKeys(observation, LEGACY_OBSERVATION_KEYS)) return impact;
  const source = observation.targetSource;
  if (source !== null && !(exactKeys(source, ["path", "hash"]) && source.path === impact.originPath && typeof source.hash === "string")) return impact;
  if (typeof impact.status !== "string" || typeof impact.findingState !== "string") return impact;
  if (!impact.completeness || typeof impact.completeness !== "object" || Array.isArray(impact.completeness)) return impact;
  const copy = JSON.parse(JSON.stringify(impact));
  const { originPath, observation: { targetSource, ...restObservation }, ...rest } = copy;
  const out = {};
  for (const key of LEGACY_IMPACT_KEYS) {
    if (key === "originPath") {
      out.targets = [{ originPath, targetSource, status: copy.status, findingState: copy.findingState, completeness: JSON.parse(JSON.stringify(copy.completeness)) }];
    } else if (key === "observation") {
      out.observation = restObservation;
    } else {
      out[key] = rest[key];
    }
  }
  return out;
}

function sourced(error, source) {
  const tagged = new Error(ERROR_MESSAGE);
  tagged.code = error?.code;
  tagged.source = source;
  return tagged;
}

function routeError(code) {
  return Object.assign(new Error(ERROR_MESSAGE), { code });
}

function classifyEffectiveTaskScopeError(error) {
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
