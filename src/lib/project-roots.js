import path from "node:path";
import fs from "node:fs";

import { resolveProjectConfig, toRuntimePath } from "./project-config.js";

export function getConfiguredProjectRoots(options = {}) {
  const config = resolveProjectConfig(options);

  return config.projectRoots.map((root) => ({
    id: root.id,
    path: normalizeRootPath(root.path),
    source: root.source || "env",
    writableRegistry: root.writableRegistry !== false
  }));
}

export function resolveProjectLocation(project, roots = getConfiguredProjectRoots(), options = {}) {
  const fail = () => {
    const error = new Error("Pasta do projeto indisponível no runtime.");
    error.code = "project_unavailable";
    return error;
  };
  const relative = validateRelativeProjectPath(project?.relativePath);
  const matches = roots.filter((root) => root.id === (project?.rootId || "default"));
  if (!relative.valid || /^[A-Za-z]:/.test(relative.relativePath) || matches.length !== 1) throw fail();
  try {
    const root = fs.realpathSync(matches[0].path);
    const candidate = path.resolve(root, relative.relativePath);
    if (!isPathInsideRoot(root, candidate)) throw fail();
    let ancestor = candidate;
    while (options.allowMissing && !fs.existsSync(ancestor) && ancestor !== root) {
      // A dangling symlink is unavailable, not a missing directory.
      try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw fail(); } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      ancestor = path.dirname(ancestor);
    }
    const canonical = fs.realpathSync(ancestor);
    if (!isPathInsideRoot(root, canonical) || !fs.statSync(canonical).isDirectory()) throw fail();
    return path.join(canonical, path.relative(ancestor, candidate));
  } catch {
    throw fail();
  }
}

export function normalizeRootPath(value, options = {}) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const runtimePath = toRuntimePath(value.trim(), options);
  if (!runtimePath) {
    return null;
  }

  return stripTrailingSlash(runtimePath.trim().replace(/\\/g, "/"));
}

export function isPathInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relativePath = path.relative(root, candidate);

  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function validateRelativeProjectPath(value) {
  if (typeof value !== "string") {
    return { valid: false, error: "Project path must be a string." };
  }

  const raw = value.trim();

  if (!raw) {
    return { valid: false, error: "Project path is required." };
  }

  if (raw === ".") {
    return { valid: false, error: "Project path must name a project directory." };
  }

  if (raw.startsWith("/") || raw.startsWith("\\")) {
    return { valid: false, error: "Project path must be relative." };
  }

  if (/^[a-zA-Z]:[\\/]/.test(raw)) {
    return { valid: false, error: "Project path must not be a Windows absolute path." };
  }

  const normalized = stripTrailingSlash(raw.replace(/\\/g, "/"));
  const parts = normalized.split("/");

  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    return { valid: false, error: "Project path contains unsafe segments." };
  }

  return {
    valid: true,
    relativePath: normalized
  };
}

function stripTrailingSlash(value) {
  let normalized = value;

  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}
