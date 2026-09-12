import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { validateRelativeProjectPath } from "./project-roots.js";

export function readManualProjectRegistry(filePath) {
  return readRegistryArray(filePath)
    .map((entry) => normalizeProjectEntryForRuntime(entry, { registrySource: "manual" }))
    .filter(Boolean);
}

export function readDiscoveredProjectRegistry(filePath) {
  return readRegistryArray(filePath)
    .map((entry) => normalizeProjectEntryForRuntime(entry, { registrySource: "discovered" }))
    .filter(Boolean);
}

export function normalizeProjectEntryForRuntime(entry, options = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const name = typeof entry.name === "string" ? entry.name.trim() : "";
  const relativePathResult = validateRelativeProjectPath(entry.relativePath);

  if (!name || !relativePathResult.valid) {
    return null;
  }

  return {
    ...entry,
    name,
    rootId: typeof entry.rootId === "string" && entry.rootId.trim()
      ? entry.rootId.trim()
      : "default",
    relativePath: relativePathResult.relativePath,
    registrySource: options.registrySource || entry.registrySource || entry.source || "manual"
  };
}

export function mergeProjectRegistries(manualProjects = [], discoveredProjects = []) {
  const projects = [];
  const warnings = [];
  const manualNames = new Set();
  const manualPaths = new Set();

  for (const entry of manualProjects) {
    const project = normalizeProjectEntryForRuntime(entry, { registrySource: "manual" });

    if (!project) {
      warnings.push(`Invalid manual project registry entry skipped: ${describeEntry(entry)}`);
      continue;
    }

    projects.push(project);
    manualNames.add(project.name);
    manualPaths.add(projectPathKey(project));
  }

  const discoveredNames = new Set();
  const discoveredPaths = new Set();

  for (const entry of discoveredProjects) {
    const project = normalizeProjectEntryForRuntime(entry, { registrySource: "discovered" });

    if (!project) {
      warnings.push(`Invalid discovered project registry entry skipped: ${describeEntry(entry)}`);
      continue;
    }

    if (manualNames.has(project.name) || manualPaths.has(projectPathKey(project))) {
      continue;
    }

    if (discoveredNames.has(project.name) || discoveredPaths.has(projectPathKey(project))) {
      warnings.push(`Duplicate discovered project registry entry skipped: ${project.name}`);
      continue;
    }

    projects.push(project);
    discoveredNames.add(project.name);
    discoveredPaths.add(projectPathKey(project));
  }

  return { projects, warnings };
}

export function writeDiscoveredProjectRegistryAtomic(filePath, projects) {
  if (path.basename(filePath) !== "discovered-projects.json") {
    throw new Error("Discovered registry writer only writes discovered-projects.json.");
  }

  const persistedProjects = projects.map(toPersistedDiscoveredEntry);
  const contents = `${JSON.stringify(persistedProjects, null, 2)}\n`;
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.discovered-projects.json.tmp-${process.pid}-${randomUUID()}`);
  let fd = null;

  try {
    fd = fs.openSync(tempPath, "wx");
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close errors while preserving the original failure.
      }
    }

    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors while preserving the original failure.
      }
    }

    throw error;
  }
}

function readRegistryArray(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();

  if (!raw) {
    return [];
  }

  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed;
}

function projectPathKey(project) {
  return `${project.rootId}:${project.relativePath}`;
}

function toPersistedDiscoveredEntry(entry) {
  const normalized = normalizeProjectEntryForRuntime(entry, { registrySource: "discovered" });

  if (!normalized) {
    throw new Error(`Invalid discovered project registry entry: ${describeEntry(entry)}`);
  }

  const { registrySource, source, ...persistedEntry } = normalized;

  return {
    ...persistedEntry,
    source: "discovered"
  };
}

function describeEntry(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.name === "string") {
    return entry.name;
  }

  return "unnamed";
}
