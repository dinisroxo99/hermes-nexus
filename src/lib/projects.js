import fs from "node:fs";
import path from "node:path";
import {
  detectProjectType,
  getProjectTypeLabel,
  isSupportedProjectType
} from "../analyzers/common/analyzer-detection.js";
import { resolveProjectConfig } from "./project-config.js";
import { resolveProjectLocation, validateRelativeProjectPath } from "./project-roots.js";
import { readProjectRevision, isLinkedProjectWorktree } from "./project-revision.js";
import {
  mergeProjectRegistries,
  readDiscoveredProjectRegistry,
  readManualProjectRegistry,
  validateProjectId
} from "./project-registry.js";

const PROJECT_CONFIG = resolveProjectConfig();
const DATA_DIR = PROJECT_CONFIG.dataDir;

const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const DISCOVERED_PROJECTS_FILE = path.join(DATA_DIR, "discovered-projects.json");

function readProjectsFile(options = {}) {
  const manualProjects = readManualProjectRegistry(options.manualProjectsFile || PROJECTS_FILE);
  const discoveredProjects = readDiscoveredProjectRegistry(options.discoveredProjectsFile || DISCOVERED_PROJECTS_FILE);
  const { projects } = mergeProjectRegistries(manualProjects, discoveredProjects);

  return projects;
}

export function getProjectAbsolutePath(project, roots) {
  return resolveProjectLocation(project, roots, { allowMissing: true });
}

export function getProjectByName(name, options = {}) {
  const project = selectProject("name", name, options);

  const absolutePath = resolveProjectLocation(project, options.roots);

  return {
    ...toLegacyProjectView(project),
    absolutePath
  };
}

export function getProjectByNameForIntelligence(name, options = {}) {
  return resolveIntelligenceProject(selectProject("name", name, options), options);
}

export function getProjectByIdForIntelligence(projectId, options = {}) {
  validateProjectId(projectId);
  return resolveIntelligenceProject(selectProject("projectId", projectId, options), options);
}

export function resolveProjectWorktree(projectId, locator, options = {}) {
  if (projectId === undefined || projectId === null) {
    const error = new Error("A persisted parent projectId is required.");
    error.code = "project_identity_required";
    throw error;
  }
  const parent = getProjectByIdForIntelligence(projectId, options);
  const absolutePath = resolveProjectLocation(locator, options.roots);
  const candidate = { ...parent, absolutePath };
  if (!isLinkedProjectWorktree(readProjectRevision(parent), readProjectRevision(candidate))) {
    const error = new Error("Worktree does not match the registered parent project.");
    error.code = "worktree_parent_mismatch";
    throw error;
  }
  return {
    ...candidate,
    rootId: locator.rootId || "default",
    relativePath: validateRelativeProjectPath(locator.relativePath).relativePath,
    parentProjectId: parent.projectId,
    canonicalLocation: { rootId: parent.rootId, relativePath: parent.relativePath }
  };
}

function selectProject(field, value, options) {
  const matches = readProjectsFile(options).filter((project) => project[field] === value
    && (options.rootId === undefined || project.rootId === options.rootId));
  if (matches.length !== 1) {
    const error = new Error(matches.length ? "Ambiguous project lookup." : `Projeto não encontrado: ${value}`);
    error.code = matches.length ? "ambiguous_project" : "project_not_found";
    throw error;
  }
  return matches[0];
}

function resolveIntelligenceProject(project, options) {
  const absolutePath = resolveProjectLocation(project, options.roots);

  return {
    ...project,
    absolutePath
  };
}

export function listProjects(options = {}) {
  return readProjectsFile(options).map((project) => {
    let absolutePath = null;
    try { absolutePath = getProjectAbsolutePath(project, options.roots); } catch (error) {
      if (error.code !== "project_unavailable") throw error;
    }
    return { ...toLegacyProjectView(project), absolutePath };
  });
}

export function getNestedProjectPaths(project, options = {}) {
  const bases = [project.absolutePath];
  if (project.canonicalLocation) bases.push(resolveProjectLocation(project.canonicalLocation, options.roots));
  const excluded = [];
  for (const entry of readProjectsFile(options)) {
    if (entry.projectId && entry.projectId === project.projectId) continue;
    let location;
    try { location = resolveProjectLocation(entry, options.roots); } catch { continue; }
    for (const base of bases) {
      const relative = path.relative(base, location).replaceAll("\\", "/");
      if (relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative)) excluded.push(relative);
    }
  }
  return [...new Set(excluded)].sort();
}

export function listProjectSummaries() {
  return listProjects().map((project) => {
    const exists = fs.existsSync(project.absolutePath);
    const projectType = exists ? detectProjectType(project.absolutePath) : "unknown";
    const tsFileCount = exists ? countFiles(project.absolutePath, [".ts"]) : 0;
    const tsxFileCount = exists ? countFiles(project.absolutePath, [".tsx"]) : 0;
    const jsFileCount = exists ? countFiles(project.absolutePath, [".js"]) : 0;
    const jsxFileCount = exists ? countFiles(project.absolutePath, [".jsx"]) : 0;

    return {
      name: project.name,
      relativePath: project.relativePath,
      absolutePath: project.absolutePath,
      addedAt: project.addedAt,
      exists,
      projectType,
      typeLabel: getProjectTypeLabel(projectType),
      supported: isSupportedProjectType(projectType),
      csprojCount: exists ? countFiles(project.absolutePath, [".csproj"]) : 0,
      slnCount: exists ? countFiles(project.absolutePath, [".sln", ".slnx"]) : 0,
      tsFileCount,
      tsxFileCount,
      jsFileCount,
      jsxFileCount,
      sourceFileCount: tsFileCount + tsxFileCount + jsFileCount + jsxFileCount
    };
  });
}

function countFiles(root, extensions) {
  let count = 0;
  const wanted = new Set(extensions.map((extension) => extension.toLowerCase()));

  for (const file of walk(root)) {
    if (wanted.has(path.extname(file).toLowerCase())) {
      count += 1;
    }
  }

  return count;
}

function* walk(dir) {
  const ignored = new Set([
    "bin",
    "obj",
    ".git",
    ".vs",
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage"
  ]);

  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (ignored.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

function toLegacyProjectView(project) {
  const { registrySource, rootId, ...legacyProject } = project;
  return legacyProject;
}
