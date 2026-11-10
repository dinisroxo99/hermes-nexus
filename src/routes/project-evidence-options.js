import path from "node:path";
import { resolveProjectConfig } from "../lib/project-config.js";
import { getConfiguredProjectRoots } from "../lib/project-roots.js";

export function projectEvidenceOptions(dependencies) {
  const config = (dependencies.getProjectConfig || resolveProjectConfig)();
  const registry = { roots: (dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots)(),
    manualProjectsFile: path.join(config.dataDir, "projects.json"),
    discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json") };
  return { registry, ...(config.serenaPythonImage ? { analyzer: { serena: { image: config.serenaPythonImage } } } : {}) };
}
