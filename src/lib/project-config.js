import fs from "node:fs";
import path from "node:path";

export function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }

  const values = {};
  const lines = fs.readFileSync(envPath, "utf8").split(String.fromCharCode(10));

  for (const line of lines) {
    const trimmed = line.replace(/\r$/, "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['\"]|['\"]$/g, "");
    values[key] = value;
  }

  return values;
}

export function toRuntimePath(value, options = {}) {
  if (!value) {
    return null;
  }

  const platform = options.platform || process.platform;
  const normalized = String(value).replace(/\\/g, "/");
  const windowsDriveMatch = normalized.match(/^([a-zA-Z]):\/(.*)$/);

  if (platform === "linux" && windowsDriveMatch) {
    return `/mnt/${windowsDriveMatch[1].toLowerCase()}/${windowsDriveMatch[2]}`;
  }

  return normalized;
}

export function parseProjectRootsJson(value) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error("PROJECTS_ROOTS must be a JSON array.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("PROJECTS_ROOTS must be a JSON array.");
  }

  const seenIds = new Set();

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`PROJECTS_ROOTS entry ${index + 1} must be an object.`);
    }

    const id = typeof entry.id === "string" ? entry.id.trim() : `root-${index + 1}`;
    const rootPath = typeof entry.path === "string" ? entry.path.trim() : "";

    if (!id) {
      throw new Error(`PROJECTS_ROOTS entry ${index + 1} must include an id.`);
    }

    if (!rootPath) {
      throw new Error(`PROJECTS_ROOTS entry ${index + 1} must include a path.`);
    }

    if (seenIds.has(id)) {
      throw new Error(`Duplicate PROJECTS_ROOTS id: ${id}`);
    }

    seenIds.add(id);

    return {
      id,
      path: rootPath,
      writableRegistry: entry.writableRegistry !== false
    };
  });
}

export function resolveProjectConfig(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const env = options.env || process.env;
  const envFileValues = options.envFileValues ?? readEnvFile(path.join(repoRoot, ".env"));

  const dataDir = env.DATA_DIR || envFileValues.DATA_DIR || path.join(repoRoot, "data");
  const legacyProjectsRoot = env.PROJECTS_ROOT || envFileValues.PROJECTS_ROOT || null;
  const legacyProjectsRootContainer = env.PROJECTS_ROOT_CONTAINER
    || envFileValues.PROJECTS_ROOT_CONTAINER
    || toRuntimePath(legacyProjectsRoot)
    || "/projects";
  const projectRootsValue = env.PROJECTS_ROOTS || envFileValues.PROJECTS_ROOTS || null;
  const projectRoots = projectRootsValue
    ? parseProjectRootsJson(projectRootsValue)
    : [{ id: "default", path: legacyProjectsRootContainer, writableRegistry: true }];

  return {
    repoRoot,
    dataDir,
    legacyProjectsRoot,
    legacyProjectsRootContainer,
    projectRoots,
    serenaPythonImage: (env.SERENA_PYTHON_IMAGE ?? envFileValues.SERENA_PYTHON_IMAGE) || null,
    intelligenceRegistryWritesEnabled: parseBoolean(
      env.INTELLIGENCE_REGISTRY_WRITES_ENABLED ?? envFileValues.INTELLIGENCE_REGISTRY_WRITES_ENABLED,
      false
    )
  };
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return ["true", "1", "yes"].includes(String(value).trim().toLowerCase());
}
