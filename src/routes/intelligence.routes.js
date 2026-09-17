import path from "node:path";

import { discoverProjects as discoverProjectsDefault } from "../lib/project-discovery.js";
import { buildProjectOverview as buildProjectOverviewDefault } from "../lib/project-overview.js";
import { resolveProjectConfig } from "../lib/project-config.js";
import { getConfiguredProjectRoots, validateRelativeProjectPath } from "../lib/project-roots.js";
import { getProjectByNameForIntelligence as getProjectByNameDefault } from "../lib/projects.js";
import {
  mergeProjectRegistries,
  readDiscoveredProjectRegistry,
  readEffectiveProjectRegistry,
  readManualProjectRegistry,
  upsertDiscoveredProjects,
  writeDiscoveredProjectRegistryAtomic as writeDiscoveredProjectRegistryAtomicDefault
} from "../lib/project-registry.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendOk, sendError } from "../utils/response.js";
import { parseLimit, validateProjectName } from "../utils/validation.js";

const MAX_REGISTRATION_PROJECTS = 100;
const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

export function registerIntelligenceRoutes(router, dependencies = {}) {
  router.add("GET", "/api/intelligence/discover", createDiscoverProjectsHandler(dependencies));
  router.add("POST", "/api/intelligence/discover/register", createRegisterDiscoveredProjectsHandler(dependencies));
  router.add("GET", "/api/intelligence/projects/:name/overview", createProjectOverviewHandler(dependencies));
}

export function createDiscoverProjectsHandler(dependencies = {}) {
  const discoverProjects = dependencies.discoverProjects || discoverProjectsDefault;
  const getRoots = dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots;
  const getRegisteredProjects = dependencies.getEffectiveProjectRegistry || getEffectiveProjectRegistry;

  return async function handleDiscoverProjects(_req, res, _params, query) {
    try {
      const result = discoverProjects({
        roots: getRoots(),
        registeredProjects: getRegisteredProjects(),
        maxDepth: query.get("maxDepth") ?? undefined,
        limit: query.get("limit") ?? undefined,
        includeRegistered: query.get("includeRegistered") === "true"
      });

      sendOk(res, 200, result, "Descoberta de projetos concluída");
    } catch (error) {
      sendError(res, 500, "discovery_failed", error.message || "Falha ao descobrir projetos.");
    }
  };
}

export function createRegisterDiscoveredProjectsHandler(dependencies = {}) {
  const discoverProjects = dependencies.discoverProjects || discoverProjectsDefault;
  const getRoots = dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots;
  const getConfig = dependencies.getProjectConfig || resolveProjectConfig;
  const now = dependencies.now || (() => new Date().toISOString());
  const writeDiscoveredProjectRegistryAtomic = dependencies.writeDiscoveredProjectRegistryAtomic
    || writeDiscoveredProjectRegistryAtomicDefault;
  const bodyLimitBytes = dependencies.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;

  return async function handleRegisterDiscoveredProjects(req, res) {
    const config = getConfig();

    if (!config.intelligenceRegistryWritesEnabled) {
      sendError(res, 403, "registry_writes_disabled", "Discovered project registry writes are disabled.");
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, { limitBytes: bodyLimitBytes });
    } catch (error) {
      sendError(res, error.status || 400, error.code || "invalid_json", error.message);
      return;
    }

    const requested = parseRegistrationRequest(body);
    if (!requested.valid) {
      sendError(res, 400, "invalid_registration_request", requested.error);
      return;
    }

    const manualProjectsFile = path.join(config.dataDir, "projects.json");
    const discoveredProjectsFile = path.join(config.dataDir, "discovered-projects.json");

    try {
      const roots = getRoots();
      const manualProjects = readManualProjectRegistry(manualProjectsFile);
      const discoveredProjects = readDiscoveredProjectRegistry(discoveredProjectsFile);
      const effectiveRegistry = mergeProjectRegistries(manualProjects, discoveredProjects);
      const discovery = discoverProjects({
        roots,
        registeredProjects: effectiveRegistry.projects,
        includeRegistered: true
      });
      const upsert = upsertDiscoveredProjects({
        manualProjects,
        discoveredProjects,
        candidates: discovery.candidates,
        requestedProjects: requested.projects,
        now: now()
      });

      if (!upsert.ok) {
        sendError(res, 400, upsert.error, upsert.error === "worktree_parent_unresolved"
          ? "Worktree parent identity could not be verified."
          : "Requested project is not a current discovery candidate.");
        return;
      }

      if (upsert.result.registeredCount > 0 || upsert.result.updatedCount > 0) {
        writeDiscoveredProjectRegistryAtomic(discoveredProjectsFile, upsert.projects);
      }

      sendOk(res, 200, upsert.result, "Projetos descobertos registados");
    } catch (error) {
      sendError(res, 500, "registration_failed", error.message || "Falha ao registar projetos descobertos.");
    }
  };
}

export function createProjectOverviewHandler(dependencies = {}) {
  const getProjectByName = dependencies.getProjectByName || getProjectByNameDefault;
  const buildProjectOverview = dependencies.buildProjectOverview || buildProjectOverviewDefault;

  return async function handleProjectOverview(_req, res, params, query) {
    const validation = validateProjectName(params.name);
    if (!validation.valid) {
      sendError(res, 400, "invalid_project_name", validation.error);
      return;
    }

    let project;
    try {
      project = getProjectByName(params.name);
    } catch (error) {
      const { status, code, message } = classifyProjectLookupError(error, params.name);
      sendError(res, status, code, message);
      return;
    }

    try {
      const overview = buildProjectOverview(project, {
        graphLimit: parseLimit(query.get("graphLimit"), 20, 1, 100)
      });
      sendOk(res, 200, overview, "Resumo do projeto construído");
    } catch (error) {
      sendError(res, 500, "overview_failed", error.message || "Falha ao construir resumo do projeto.");
    }
  };
}

function getEffectiveProjectRegistry() {
  const config = resolveProjectConfig();
  const { projects } = readEffectiveProjectRegistry({
    manualProjectsFile: path.join(config.dataDir, "projects.json"),
    discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json")
  });

  return projects;
}

function parseRegistrationRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "Request body must be an object." };
  }

  if (!Array.isArray(body.projects)) {
    return { valid: false, error: "Request body must include a projects array." };
  }

  if (body.projects.length < 1) {
    return { valid: false, error: "At least one project must be requested." };
  }

  if (body.projects.length > MAX_REGISTRATION_PROJECTS) {
    return { valid: false, error: `At most ${MAX_REGISTRATION_PROJECTS} projects may be registered at once.` };
  }

  const projects = [];
  for (const project of body.projects) {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      return { valid: false, error: "Each requested project must be an object." };
    }

    const rootId = typeof project.rootId === "string" && project.rootId.trim()
      ? project.rootId.trim()
      : "default";
    const relativePath = validateRelativeProjectPath(project.relativePath);

    if (!relativePath.valid) {
      return { valid: false, error: relativePath.error };
    }

    projects.push({
      rootId,
      relativePath: relativePath.relativePath
    });
  }

  return { valid: true, projects };
}

function classifyProjectLookupError(error, projectName) {
  const message = error?.message || `Projeto não encontrado: ${projectName}`;

  if (message.includes("Pasta do projeto")) {
    return {
      status: 404,
      code: "project_unavailable",
      message: `Projeto indisponível: ${projectName}`
    };
  }

  return {
    status: 404,
    code: "project_not_found",
    message
  };
}
