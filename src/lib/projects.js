import fs from "node:fs";
import path from "node:path";
import {
  detectProjectType,
  getProjectTypeLabel,
  isSupportedProjectType
} from "../analyzers/common/analyzer-detection.js";
import { resolveProjectConfig } from "./project-config.js";
import { getConfiguredProjectRoots } from "./project-roots.js";
import {
  mergeProjectRegistries,
  readDiscoveredProjectRegistry,
  readManualProjectRegistry,
  validateProjectId
} from "./project-registry.js";

const PROJECT_CONFIG = resolveProjectConfig();
const DATA_DIR = PROJECT_CONFIG.dataDir;
const PROJECTS_ROOT_CONTAINER = PROJECT_CONFIG.legacyProjectsRootContainer;

const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const DISCOVERED_PROJECTS_FILE = path.join(DATA_DIR, "discovered-projects.json");

function readProjectsFile(options = {}) {
  const manualProjects = readManualProjectRegistry(options.manualProjectsFile || PROJECTS_FILE);
  const discoveredProjects = readDiscoveredProjectRegistry(options.discoveredProjectsFile || DISCOVERED_PROJECTS_FILE);
  const { projects } = mergeProjectRegistries(manualProjects, discoveredProjects);

  return projects;
}

export function getProjectAbsolutePath(project) {
  return path.join(PROJECTS_ROOT_CONTAINER, project.relativePath || "");
}

export function getProjectByName(name, options = {}) {
  const project = selectProject("name", name, options);

  const absolutePath = getProjectAbsolutePath(project);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Pasta do projeto não encontrada no runtime: ${absolutePath}`);
  }

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
  const absolutePath = getProjectAbsolutePathForIntelligence(project, options.roots);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Pasta do projeto não encontrada no runtime: ${absolutePath}`);
  }

  return {
    ...project,
    absolutePath
  };
}

export function listProjects() {
  return readProjectsFile().map((project) => ({
    ...toLegacyProjectView(project),
    absolutePath: getProjectAbsolutePath(project)
  }));
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

function getProjectAbsolutePathForIntelligence(project, roots = getConfiguredProjectRoots()) {
  const root = roots.find((item) => item.id === (project.rootId || "default"));

  if (root) {
    return path.join(root.path, project.relativePath || "");
  }

  return getProjectAbsolutePath(project);
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
