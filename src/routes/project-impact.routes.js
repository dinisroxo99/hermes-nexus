import path from "node:path";
import { TextDecoder } from "node:util";

import { normalizeImpactRequest } from "../lib/impact-policy.js";
import { buildProjectImpact } from "../lib/project-impact-service.js";
import { resolveProjectConfig } from "../lib/project-config.js";
import { validateProjectId } from "../lib/project-registry.js";
import { getConfiguredProjectRoots } from "../lib/project-roots.js";
import { ok, sendError } from "../utils/response.js";

const IMPACT_HTTP_REQUEST_MAX_BYTES = 65536;
const IMPACT_HTTP_RESPONSE_MAX_BYTES = 163840;
const SUCCESS_MESSAGE = "Project impact constructed.";
const ERROR_MESSAGE = "Project impact could not be constructed safely.";
const BAD_REQUEST = new Set([
  "invalid_project_identity",
  "project_identity_required",
  "invalid_json",
  "invalid_impact_request",
  "impact_budget_exceeded"
]);
const NOT_FOUND = new Set(["project_not_found", "project_unavailable"]);
const CONFLICT = new Set([
  "ambiguous_project",
  "project_identity_conflict",
  "worktree_parent_mismatch",
  "impact_sources_changed",
  "impact_revision_changed",
  "impact_project_changed"
]);

export function createProjectImpactHandler(dependencies = {}) {
  const build = dependencies.buildProjectImpact || buildProjectImpact;
  const getConfig = dependencies.getProjectConfig || resolveProjectConfig;
  const getRoots = dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots;

  return async function handleProjectImpact(req, res, params) {
    let bodyBuffer;
    let responseTooLarge = false;
    try {
      validateProjectId(params.projectId);
      const body = await readBoundedImpactBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "projectId")) {
        throw impactRouteError("invalid_impact_request");
      }
      const request = normalizeImpactRequest(body);
      const config = getConfig();
      const registry = {
        roots: getRoots(),
        manualProjectsFile: path.join(config.dataDir, "projects.json"),
        discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json")
      };
      const analyzer = config.serenaPythonImage ? { serena: { image: config.serenaPythonImage } } : undefined;
      const result = build(params.projectId, request, { registry, ...(analyzer ? { analyzer } : {}) });
      const serialized = JSON.stringify(ok(result, SUCCESS_MESSAGE));
      bodyBuffer = Buffer.from(serialized, "utf8");
      if (bodyBuffer.length > IMPACT_HTTP_RESPONSE_MAX_BYTES) {
        responseTooLarge = true;
      }
    } catch (error) {
      const { status, code } = classifyImpactError(error);
      sendError(res, status, code, ERROR_MESSAGE);
      return;
    }

    if (responseTooLarge) {
      sendError(res, 500, "impact_response_too_large", ERROR_MESSAGE);
      return;
    }

    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "content-length": bodyBuffer.length
    });
    res.end(bodyBuffer);
  };
}

function readBoundedImpactBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      total += buffer.length;
      if (total > IMPACT_HTTP_REQUEST_MAX_BYTES) {
        req.off("data", onData);
        req.off("end", onEnd);
        req.resume?.();
        reject(impactRouteError("request_body_too_large"));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      try {
        if (total === 0) {
          resolve({});
          return;
        }
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
        resolve(JSON.parse(text));
      } catch {
        reject(impactRouteError("invalid_json"));
      }
    };
    req.on("error", onError);
    req.on("data", onData);
    req.on("end", onEnd);
  });
}

function classifyImpactError(error) {
  const code = error?.code;
  if (code === "request_body_too_large") return { status: 413, code };
  if (BAD_REQUEST.has(code)) return { status: 400, code };
  if (NOT_FOUND.has(code)) return { status: 404, code };
  if (CONFLICT.has(code)) return { status: 409, code };
  return { status: 500, code: "impact_failed" };
}

function impactRouteError(code) {
  return Object.assign(new Error("Invalid project impact request."), { code });
}
