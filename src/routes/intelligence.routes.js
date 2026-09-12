import path from "node:path";

import { discoverProjects as discoverProjectsDefault } from "../lib/project-discovery.js";
import { resolveProjectConfig } from "../lib/project-config.js";
import { getConfiguredProjectRoots } from "../lib/project-roots.js";
import { readEffectiveProjectRegistry } from "../lib/project-registry.js";
import { sendOk, sendError } from "../utils/response.js";

export function registerIntelligenceRoutes(router, dependencies = {}) {
  router.add("GET", "/api/intelligence/discover", createDiscoverProjectsHandler(dependencies));
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

function getEffectiveProjectRegistry() {
  const config = resolveProjectConfig();
  const { projects } = readEffectiveProjectRegistry({
    manualProjectsFile: path.join(config.dataDir, "projects.json"),
    discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json")
  });

  return projects;
}
