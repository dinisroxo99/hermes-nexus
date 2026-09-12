import fs from "node:fs";
import path from "node:path";

import { detectProjectType } from "../analyzers/common/analyzer-detection.js";

const IGNORED_DIRS = new Set([
  ".git",
  ".vs",
  ".vscode",
  "node_modules",
  "bin",
  "obj",
  "dist",
  "build",
  "coverage",
  ".next"
]);

export function discoverProjectBoundaries(options = {}) {
  const rootPath = options.rootPath;
  const rootId = options.rootId || "default";
  const candidates = [];

  if (!rootPath || !fs.existsSync(rootPath)) {
    return { candidates };
  }

  const root = path.resolve(rootPath);

  function visit(dir, inheritedSkipDirs = []) {
    const dirName = path.basename(dir);
    if (dir !== root && IGNORED_DIRS.has(dirName)) {
      return;
    }

    const stat = safeLstat(dir);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
      return;
    }

    const skipDirs = [...inheritedSkipDirs];
    const boundary = classifyProjectBoundary({ rootPath: root, projectPath: dir, rootId });

    if (boundary) {
      candidates.push(boundary);
      skipDirs.push(...boundary.modules.map((module) => moduleDirectory(root, boundary.relativePath, module)));
    }

    for (const child of readDirEntries(dir)) {
      if (!child.isDirectory() || child.isSymbolicLink() || IGNORED_DIRS.has(child.name)) {
        continue;
      }

      const childPath = path.join(dir, child.name);
      if (skipDirs.some((skipDir) => isSameOrDescendant(skipDir, childPath))) {
        continue;
      }

      visit(childPath, skipDirs);
    }
  }

  visit(root);

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

    if (entry.isDirectory() && entry.name === ".git") {
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
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !IGNORED_DIRS.has(entry.name))
    .map((entry) => path.join(parentDir, entry.name))
    .filter((moduleDir) => fs.existsSync(path.join(moduleDir, "package.json")))
    .sort((a, b) => normalizeRelative(path.relative(projectPath, a)).localeCompare(normalizeRelative(path.relative(projectPath, b))));
}

function* walkFiles(dir) {
  for (const entry of readDirEntries(dir)) {
    if (entry.isSymbolicLink() || IGNORED_DIRS.has(entry.name)) {
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
