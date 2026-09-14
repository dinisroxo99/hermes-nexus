import fs from "node:fs";
import path from "node:path";

import {
  detectProjectType,
  getProjectTypeLabel,
  isSupportedProjectType
} from "../analyzers/common/analyzer-detection.js";
import { listAnalyzerCapabilities } from "../analyzers/common/analyzer-registry.js";
import { getAnalysisCacheStats as getAnalysisCacheStatsDefault } from "./analysis-cache.js";
import { buildProjectIcmIndex } from "./icm-index.js";
import { analyzeProjectStructure } from "./project-structure.js";

export const PROJECT_OVERVIEW_LIMITS = Object.freeze({
  scripts: 50,
  frameworks: 20,
  layers: 20,
  features: 20,
  entryPoints: 20,
  testCommands: 20,
  warnings: 20,
  graphLimitDefault: 20,
  graphLimitMax: 100,
  icmWorkspaceMaxDepth: 8,
  icmMaxWorkspaces: 50,
  icmDocumentMaxDepth: 8,
  icmMaxDocuments: 100
});

const FRAMEWORK_PACKAGES = [
  "@fastify/core",
  "@nestjs/core",
  "@sveltejs/kit",
  "astro",
  "express",
  "fastify",
  "hono",
  "next",
  "nuxt",
  "react",
  "remix",
  "svelte",
  "vue"
];

const ENTRY_POINT_CANDIDATES = [
  "src/server.js",
  "src/server.ts",
  "src/index.js",
  "src/index.ts",
  "server.js",
  "server.ts",
  "index.js",
  "index.ts"
];

const SOURCE_EXTENSIONS = new Set([".cs", ".ts", ".tsx", ".js", ".jsx", ".py"]);
const IGNORED_DIRS = new Set(["bin", "obj", ".git", ".vs", "node_modules", ".next", "dist", "build", "coverage"]);

export function buildProjectOverview(project, options = {}) {
  const warnings = [];
  const limits = {
    scripts: options.scriptLimit || PROJECT_OVERVIEW_LIMITS.scripts,
    frameworks: options.frameworkLimit || PROJECT_OVERVIEW_LIMITS.frameworks,
    layers: options.layerLimit || PROJECT_OVERVIEW_LIMITS.layers,
    features: options.featureLimit || PROJECT_OVERVIEW_LIMITS.features,
    entryPoints: options.entryPointLimit || PROJECT_OVERVIEW_LIMITS.entryPoints,
    testCommands: options.testCommandLimit || PROJECT_OVERVIEW_LIMITS.testCommands,
    warnings: options.warningLimit || PROJECT_OVERVIEW_LIMITS.warnings,
    graphLimit: normalizeGraphLimit(options.graphLimit),
    icm: buildIcmOverviewLimits(options.icmOptions)
  };

  const projectType = detectProjectType(project.absolutePath);
  const supported = isSupportedProjectType(projectType);
  const packageInfo = readPackageJson(project.absolutePath, warnings);
  const structure = readProjectStructure(project, warnings);
  const analysis = readAnalysisState(project, projectType, options.getAnalysisCacheStats || getAnalysisCacheStatsDefault);
  const sourceFileCount = inferSourceFileCount(project, structure);
  const icmIndex = buildProjectIcmIndex(project, limits.icm);

  if (!supported) {
    addWarning(warnings, "unsupported_project_type", `Project type is not supported for analysis: ${projectType}`);
  }

  return {
    schemaVersion: 1,
    bounded: true,
    limits: {
      scripts: limits.scripts,
      frameworks: limits.frameworks,
      layers: limits.layers,
      features: limits.features,
      entryPoints: limits.entryPoints,
      testCommands: limits.testCommands,
      warnings: limits.warnings,
      graphLimit: limits.graphLimit,
      icm: {
        workspace: limits.icm.workspace,
        documents: limits.icm.documents
      }
    },
    project: {
      name: project.name,
      rootId: project.rootId || "default",
      relativePath: normalizeRelativePath(project.relativePath || project.name || ""),
      projectType,
      typeLabel: getProjectTypeLabel(projectType),
      supported,
      registrySource: project.registrySource || project.source || "manual"
    },
    stack: {
      languages: inferLanguages(projectType),
      frameworks: detectFrameworks(packageInfo.packageJson).slice(0, limits.frameworks),
      packageManager: detectPackageManager(project.absolutePath, packageInfo.packageJson),
      runtime: inferRuntime(projectType),
      scripts: listScripts(packageInfo.packageJson).slice(0, limits.scripts)
    },
    architecture: {
      layers: compactStructureList(structure?.layers, limits.layers),
      features: compactStructureList(structure?.features, limits.features),
      entryPoints: detectEntryPoints(project.absolutePath, packageInfo.packageJson).slice(0, limits.entryPoints),
      testCommands: listTestCommands(packageInfo.packageJson).slice(0, limits.testCommands)
    },
    statistics: {
      sourceFileCount,
      nodeCount: analysis.nodeCount,
      edgeCount: analysis.edgeCount
    },
    analysis: {
      status: analysis.status,
      lastAnalyzedAt: null
    },
    icm: summarizeIcmIndex(icmIndex),
    analyzers: listProjectAnalyzers(projectType),
    warnings: warnings.slice(0, limits.warnings)
  };
}

function buildIcmOverviewLimits(icmOptions = {}) {
  return {
    maxErrors: icmOptions.maxErrors,
    maxWarnings: icmOptions.maxWarnings,
    workspace: {
      maxDepth: icmOptions.workspace?.maxDepth ?? PROJECT_OVERVIEW_LIMITS.icmWorkspaceMaxDepth,
      maxWorkspaces: icmOptions.workspace?.maxWorkspaces ?? PROJECT_OVERVIEW_LIMITS.icmMaxWorkspaces,
      includeInstructions: false
    },
    documents: {
      maxDepth: icmOptions.documents?.maxDepth ?? PROJECT_OVERVIEW_LIMITS.icmDocumentMaxDepth,
      maxDocuments: icmOptions.documents?.maxDocuments ?? PROJECT_OVERVIEW_LIMITS.icmMaxDocuments,
      includeContent: false
    }
  };
}

function summarizeIcmIndex(icmIndex) {
  const workspaceCount = icmIndex.workspaces.length;
  const documentCount = icmIndex.documents.length;
  const errorCount = icmIndex.errors.length;
  const warningCount = icmIndex.warnings.length;

  return {
    status: icmStatus(icmIndex, { workspaceCount, documentCount, errorCount, warningCount }),
    valid: icmIndex.valid,
    workspaceCount,
    documentCount,
    errorCount,
    warningCount,
    truncated: {
      workspaces: icmIndex.truncated.workspaces,
      documents: icmIndex.truncated.documents
    }
  };
}

function icmStatus(icmIndex, { workspaceCount, documentCount, errorCount, warningCount }) {
  if (!icmIndex.valid) {
    return "invalid";
  }

  if (workspaceCount > 0 || documentCount > 0 || errorCount > 0 || warningCount > 0 || icmIndex.truncated.workspaces || icmIndex.truncated.documents) {
    return "available";
  }

  return "not_configured";
}

function normalizeGraphLimit(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return PROJECT_OVERVIEW_LIMITS.graphLimitDefault;
  }

  return Math.max(1, Math.min(PROJECT_OVERVIEW_LIMITS.graphLimitMax, Math.floor(parsed)));
}

function readPackageJson(rootPath, warnings) {
  const packageJsonPath = path.join(rootPath, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    return { packageJson: null };
  }

  try {
    return { packageJson: JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) };
  } catch {
    addWarning(warnings, "malformed_package_json", "package.json could not be parsed.");
    return { packageJson: null };
  }
}

function readProjectStructure(project, warnings) {
  try {
    return analyzeProjectStructure(project);
  } catch (error) {
    addWarning(warnings, "structure_unavailable", error.message || "Project structure could not be analyzed.");
    return null;
  }
}

function detectPackageManager(rootPath, packageJson) {
  const packageManager = typeof packageJson?.packageManager === "string"
    ? parsePackageManagerName(packageJson.packageManager)
    : null;

  if (packageManager) return packageManager;
  if (fs.existsSync(path.join(rootPath, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(rootPath, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(rootPath, "package-lock.json"))) return "npm";
  if (fs.existsSync(path.join(rootPath, "bun.lock")) || fs.existsSync(path.join(rootPath, "bun.lockb"))) return "bun";
  if (fs.existsSync(path.join(rootPath, "package.json"))) return "unknown";
  return null;
}

function parsePackageManagerName(value) {
  const match = String(value).trim().match(/^(@?[^@/]+|@[A-Za-z0-9_.-]+\/[^@/]+)@/);
  if (!match) return null;

  const name = match[1].toLowerCase();
  if (name === "npm" || name === "pnpm" || name === "yarn" || name === "bun") {
    return name;
  }

  return name;
}

function detectFrameworks(packageJson) {
  if (!packageJson || typeof packageJson !== "object") return [];

  const dependencyNames = new Set();
  for (const key of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = packageJson[key];
    if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;

    for (const name of Object.keys(dependencies)) {
      dependencyNames.add(name.toLowerCase());
    }
  }

  return FRAMEWORK_PACKAGES
    .filter((name) => dependencyNames.has(name))
    .map(normalizeFrameworkName)
    .filter((name, index, values) => values.indexOf(name) === index);
}

function normalizeFrameworkName(name) {
  if (name === "@fastify/core") return "fastify";
  if (name === "@nestjs/core") return "nestjs";
  if (name === "@sveltejs/kit") return "sveltekit";
  return name;
}

function listScripts(packageJson) {
  const scripts = packageJson?.scripts;
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];

  return Object.entries(scripts)
    .filter(([, command]) => typeof command === "string")
    .map(([name, command]) => ({ name, command }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listTestCommands(packageJson) {
  return listScripts(packageJson).filter((script) => {
    return script.name === "test"
      || script.name === "check"
      || script.name === "lint"
      || script.name.startsWith("test:");
  });
}

function detectEntryPoints(rootPath, packageJson) {
  const entryPoints = [];
  const main = safePackageMain(packageJson?.main);

  if (main && fs.existsSync(path.join(rootPath, main))) {
    entryPoints.push(main);
  }

  for (const candidate of ENTRY_POINT_CANDIDATES) {
    if (fs.existsSync(path.join(rootPath, candidate)) && !entryPoints.includes(candidate)) {
      entryPoints.push(candidate);
    }
  }

  return entryPoints;
}

function safePackageMain(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = normalizeRelativePath(value.trim());

  if (path.isAbsolute(normalized) || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }

  return normalized;
}

function inferLanguages(projectType) {
  if (projectType === "typescript") return ["JavaScript", "TypeScript"];
  if (projectType === "nodejs") return ["JavaScript"];
  if (projectType === "dotnet") return ["C#"];
  if (projectType === "python") return ["Python"];
  return [];
}

function inferRuntime(projectType) {
  if (projectType === "typescript" || projectType === "nodejs") return "node";
  if (projectType === "dotnet") return "dotnet";
  if (projectType === "python") return "python";
  return null;
}

function compactStructureList(items, limit) {
  if (!Array.isArray(items)) return [];

  return items.slice(0, limit).map((item) => {
    const compact = { name: item.name };

    for (const key of ["projectCount", "sourceFileCount", "csFileCount", "symbolCount", "featureCount", "layers", "projectNames", "projects"]) {
      if (Object.hasOwn(item, key)) {
        compact[key] = Array.isArray(item[key]) ? item[key].slice(0, limit) : item[key];
      }
    }

    return compact;
  });
}

function inferSourceFileCount(project, structure) {
  const projectCounts = structure?.projects;

  if (Array.isArray(projectCounts) && projectCounts.length) {
    const total = projectCounts.reduce((sum, item) => {
      if (typeof item.sourceFileCount === "number") return sum + item.sourceFileCount;
      if (typeof item.csFileCount === "number") return sum + item.csFileCount;
      return sum;
    }, 0);

    if (total > 0) return total;
  }

  return countKnownSourceFiles(project.absolutePath);
}

function countKnownSourceFiles(rootPath) {
  let count = 0;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !entry.name.toLowerCase().endsWith(".d.ts")) {
        count += 1;
      }
    }
  }

  walk(rootPath);
  return count;
}

function readAnalysisState(project, projectType, getAnalysisCacheStats) {
  const stats = getAnalysisCacheStats?.() || {};
  const entries = Array.isArray(stats.entries) ? stats.entries : [];
  const entry = entries.find((item) => {
    return item.project === project.name
      && item.projectType === projectType
      && (!item.key || String(item.key).includes(project.absolutePath));
  });

  if (!entry) {
    return { status: "not_analyzed", nodeCount: null, edgeCount: null };
  }

  const status = typeof entry.expiresInMs === "number"
    ? (entry.expiresInMs > 0 ? "fresh" : "stale")
    : "unknown";

  return {
    status,
    nodeCount: typeof entry.nodeCount === "number" ? entry.nodeCount : null,
    edgeCount: typeof entry.edgeCount === "number" ? entry.edgeCount : null
  };
}

function listProjectAnalyzers(projectType) {
  return listAnalyzerCapabilities()
    .filter((analyzer) => analyzer.projectType === projectType)
    .map((analyzer) => ({
      projectType: analyzer.projectType,
      name: analyzer.name,
      capabilities: analyzer.capabilities || {}
    }));
}

function addWarning(warnings, code, message) {
  warnings.push({ code, message });
}

function normalizeRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}
