import fs from "node:fs";
import path from "node:path";

import { detectProjectType } from "../analyzers/common/analyzer-detection.js";
import { getConfiguredProjectRoots, normalizeRootPath, resolveProjectLocation } from "./project-roots.js";
import { normalizeProjectEntryForRuntime } from "./project-registry.js";
import { readProjectRevision, isLinkedProjectWorktree } from "./project-revision.js";
import { isIgnoredProjectScanDir } from "./project-scan-policy.js";

const DEFAULT_MAX_DEPTH = 3;
const MAX_MAX_DEPTH = 6;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const WARNING_LIMIT = 20;

export function discoverProjects(options = {}) {
  const maxDepth = clampInteger(options.maxDepth, {
    defaultValue: DEFAULT_MAX_DEPTH,
    min: 1,
    max: MAX_MAX_DEPTH
  });
  const limit = clampInteger(options.limit, {
    defaultValue: DEFAULT_LIMIT,
    min: 1,
    max: MAX_LIMIT
  });
  const roots = (options.roots || getConfiguredProjectRoots())
    .map((root, index) => normalizeDiscoveryRoot(root, index));
  const registry = createRegisteredProjectIndex(options.registeredProjects || []);
  let parentRevisions;
  const worktreeMetadata = (candidate) => {
    let absolutePath;
    try { absolutePath = resolveProjectLocation(candidate, roots); } catch {
      return { identityStatus: "unavailable", registered: false };
    }
    const revision = readProjectRevision({ absolutePath });
    if (revision.status === "unavailable" && hasGitFile(absolutePath)) {
      return { identityStatus: "unavailable", registered: false };
    }
    if (!revision.isLinkedWorktree) return {};
    parentRevisions ??= (options.registeredProjects || []).flatMap((entry) => {
      const project = normalizeProjectEntryForRuntime(entry);
      if (!project?.projectId) return [];
      try {
        return [{ projectId: project.projectId, revision: readProjectRevision({ absolutePath: resolveProjectLocation(project, roots) }) }];
      } catch { return []; }
    });
    const parents = parentRevisions.filter((parent) => isLinkedProjectWorktree(parent.revision, revision));
    const parentProjectId = parents.length === 1 ? parents[0].projectId : null;
    return { isLinkedWorktree: true, parentProjectId, registered: parentProjectId !== null };
  };
  const includeRegistered = options.includeRegistered === true;
  const warnings = [];
  const candidates = [];
  let truncated = false;

  for (const root of roots) {
    if (truncated) {
      break;
    }

    const rootStat = getRootStat(root);

    if (!rootStat.exists) {
      addWarning(warnings, { code: "root_missing", rootId: root.id });
      continue;
    }

    if (!rootStat.isDirectory) {
      addWarning(warnings, { code: "root_not_directory", rootId: root.id });
      continue;
    }

    const remaining = limit + 1 - candidates.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const result = discoverProjectBoundaries({
      rootPath: root.path,
      rootId: root.id,
      maxDepth,
      limit: remaining,
      mapCandidate: (candidate) => {
        const metadata = worktreeMetadata(candidate);
        const registered = metadata.registered ?? isRegisteredCandidate(candidate, registry);

        if (registered && !includeRegistered) {
          return null;
        }

        return {
          ...candidate,
          ...metadata,
          registered
        };
      }
    });

    for (const candidate of result.candidates) {
      candidates.push(candidate);

      if (candidates.length > limit) {
        truncated = true;
        break;
      }
    }
  }

  return {
    schemaVersion: 1,
    bounded: true,
    limits: { maxDepth, limit },
    roots: roots.map((root) => ({ id: root.id })),
    candidates: candidates.slice(0, limit),
    truncated,
    warnings
  };
}

export function discoverProjectBoundaries(options = {}) {
  const rootPath = options.rootPath;
  const rootId = options.rootId || "default";
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(0, Math.floor(options.maxDepth)) : Infinity;
  const limit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : Infinity;
  const mapCandidate = typeof options.mapCandidate === "function" ? options.mapCandidate : (candidate) => candidate;
  const candidates = [];

  if (!rootPath || !fs.existsSync(rootPath)) {
    return { candidates };
  }

  const root = path.resolve(rootPath);

  function visit(dir, depth = 0, inheritedSkipDirs = []) {
    if (depth > maxDepth || candidates.length >= limit) {
      return;
    }

    const dirName = path.basename(dir);
    if (dir !== root && isIgnoredProjectScanDir(dirName)) {
      return;
    }

    const stat = safeLstat(dir);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
      return;
    }

    const skipDirs = [...inheritedSkipDirs];
    const boundary = classifyProjectBoundary({ rootPath: root, projectPath: dir, rootId });

    if (boundary) {
      const candidate = mapCandidate(boundary);
      if (candidate) {
        candidates.push(candidate);
      }

      skipDirs.push(...boundary.modules.map((module) => moduleDirectory(root, boundary.relativePath, module)));
    }

    if (depth >= maxDepth || candidates.length >= limit) {
      return;
    }

    for (const child of readDirEntries(dir)) {
      if (!child.isDirectory() || child.isSymbolicLink() || isIgnoredProjectScanDir(child.name)) {
        continue;
      }

      const childPath = path.join(dir, child.name);
      if (skipDirs.some((skipDir) => isSameOrDescendant(skipDir, childPath))) {
        continue;
      }

      visit(childPath, depth + 1, skipDirs);

      if (candidates.length >= limit) {
        return;
      }
    }
  }

  visit(root, 0);

  return {
    candidates: candidates
      .filter((candidate) => candidate.relativePath !== ".")
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  };
}

export function classifyProjectBoundary({ rootPath, projectPath, rootId = "default" }) {
  const signals = detectProjectSignals(projectPath);
  if (!signals.length) {
    return null;
  }

  const relativePath = normalizeRelative(path.relative(rootPath, projectPath)) || ".";
  const projectType = detectProjectType(projectPath);
  const modules = [
    ...detectDotnetModules(projectPath),
    ...detectNodeWorkspaceModules(projectPath)
  ].sort((a, b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));

  return {
    name: path.basename(projectPath),
    rootId,
    relativePath,
    boundaryKind: "repository",
    projectType,
    signals,
    modules
  };
}

export function detectProjectSignals(projectPath) {
  const entries = readDirEntries(projectPath);
  const signals = [];

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();

    if (entry.isSymbolicLink()) {
      continue;
    }

    if ((entry.isDirectory() || entry.isFile()) && entry.name === ".git") {
      signals.push(".git");
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (lowerName === "package.json") signals.push(entry.name);
    if (lowerName === "pnpm-workspace.yaml") signals.push(entry.name);
    if (lowerName === "tsconfig.json") signals.push(entry.name);
    if (lowerName === "directory.build.props") signals.push(entry.name);
    if (lowerName.endsWith(".sln") || lowerName.endsWith(".slnx") || lowerName.endsWith(".csproj")) {
      signals.push(entry.name);
    }
  }

  return signals.sort((a, b) => signalRank(a) - signalRank(b) || a.localeCompare(b));
}

export function detectDotnetModules(projectPath) {
  const modules = [];

  for (const file of walkFiles(projectPath)) {
    if (file.toLowerCase().endsWith(".csproj")) {
      modules.push({
        path: normalizeRelative(path.relative(projectPath, file)),
        kind: "dotnet-project"
      });
    }
  }

  return modules.sort((a, b) => a.path.localeCompare(b.path));
}

export function detectNodeWorkspaceModules(projectPath) {
  const patterns = getWorkspacePatterns(projectPath);
  const modules = [];
  const seen = new Set();

  for (const pattern of patterns) {
    const moduleDirs = expandSimpleWorkspacePattern(projectPath, pattern);

    for (const moduleDir of moduleDirs) {
      const relativePath = normalizeRelative(path.relative(projectPath, moduleDir));
      if (seen.has(relativePath)) {
        continue;
      }

      seen.add(relativePath);
      modules.push({
        path: relativePath,
        kind: "node-workspace"
      });
    }
  }

  return modules.sort((a, b) => a.path.localeCompare(b.path));
}

function getWorkspacePatterns(projectPath) {
  return [
    ...getPackageJsonWorkspacePatterns(projectPath),
    ...getPnpmWorkspacePatterns(projectPath)
  ];
}

function getPackageJsonWorkspacePatterns(projectPath) {
  const packageJsonPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    if (Array.isArray(parsed.workspaces)) {
      return parsed.workspaces.filter((item) => typeof item === "string");
    }

    if (parsed.workspaces && Array.isArray(parsed.workspaces.packages)) {
      return parsed.workspaces.packages.filter((item) => typeof item === "string");
    }
  } catch {
    return [];
  }

  return [];
}

function getPnpmWorkspacePatterns(projectPath) {
  const workspacePath = path.join(projectPath, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspacePath)) {
    return [];
  }

  return fs.readFileSync(workspacePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim().replace(/^['\"]|['\"]$/g, ""))
    .filter(Boolean);
}

function expandSimpleWorkspacePattern(projectPath, pattern) {
  const normalizedPattern = normalizeRelative(pattern);
  if (!normalizedPattern || !normalizedPattern.endsWith("/*") || normalizedPattern.includes("**")) {
    return [];
  }

  const parentRelative = normalizedPattern.slice(0, -2);
  const parentDir = path.join(projectPath, parentRelative);
  if (!fs.existsSync(parentDir)) {
    return [];
  }

  return readDirEntries(parentDir)
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !isIgnoredProjectScanDir(entry.name))
    .map((entry) => path.join(parentDir, entry.name))
    .filter((moduleDir) => fs.existsSync(path.join(moduleDir, "package.json")))
    .sort((a, b) => normalizeRelative(path.relative(projectPath, a)).localeCompare(normalizeRelative(path.relative(projectPath, b))));
}

function* walkFiles(dir) {
  for (const entry of readDirEntries(dir)) {
    if (entry.isSymbolicLink() || isIgnoredProjectScanDir(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

function readDirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function safeLstat(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

function hasGitFile(directory) {
  for (let current = directory; ; current = path.dirname(current)) {
    const marker = safeLstat(path.join(current, ".git"));
    if (marker) return marker.isFile();
    if (path.dirname(current) === current) return false;
  }
}

function moduleDirectory(root, candidateRelativePath, module) {
  const moduleRelativePath = module.kind === "dotnet-project"
    ? path.dirname(module.path)
    : module.path;

  return path.join(root, candidateRelativePath, moduleRelativePath);
}

function isSameOrDescendant(parent, child) {
  const relativePath = path.relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalizeRelative(value) {
  return String(value || "").replaceAll("\\", "/");
}

function signalRank(signal) {
  if (signal === ".git") return 0;
  if (signal === "package.json") return 1;
  if (signal === "pnpm-workspace.yaml") return 2;
  if (signal === "tsconfig.json") return 3;
  if (signal.toLowerCase().endsWith(".sln") || signal.toLowerCase().endsWith(".slnx")) return 4;
  if (signal.toLowerCase().endsWith(".csproj")) return 5;
  if (signal.toLowerCase() === "directory.build.props") return 6;
  return 7;
}

function normalizeDiscoveryRoot(root, index) {
  const id = typeof root?.id === "string" && root.id.trim() ? root.id.trim() : `root-${index + 1}`;
  const rootPath = typeof root?.path === "string" ? normalizeRootPath(root.path) : null;

  return {
    id,
    path: rootPath
  };
}

function getRootStat(root) {
  if (!root.path) {
    return { exists: false, isDirectory: false };
  }

  try {
    const stat = fs.lstatSync(root.path);
    return {
      exists: true,
      isDirectory: stat.isDirectory() && !stat.isSymbolicLink()
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { exists: false, isDirectory: false };
    }

    return { exists: true, isDirectory: false };
  }
}

function createRegisteredProjectIndex(projects) {
  const byPath = new Set();
  const byRootAndName = new Set();

  for (const entry of projects) {
    const project = normalizeProjectEntryForRuntime(entry, {
      registrySource: entry?.registrySource || entry?.source || "manual"
    });

    if (!project) {
      continue;
    }

    byPath.add(projectIdentityKey(project));
    byRootAndName.add(projectNameKey(project));
  }

  return { byPath, byRootAndName };
}

function isRegisteredCandidate(candidate, registry) {
  return registry.byPath.has(projectIdentityKey(candidate))
    || registry.byRootAndName.has(projectNameKey(candidate));
}

function projectIdentityKey(project) {
  return `${project.rootId || "default"}:${project.relativePath}`;
}

function projectNameKey(project) {
  return `${project.rootId || "default"}:${project.name}`;
}

function clampInteger(value, { defaultValue, min, max }) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, Math.floor(number)));
}

function addWarning(warnings, warning) {
  if (warnings.length < WARNING_LIMIT) {
    warnings.push(warning);
  }
}
