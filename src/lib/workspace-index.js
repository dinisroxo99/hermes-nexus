import fs from "node:fs";
import path from "node:path";

import { parseAgentManifest } from "./agent-manifest.js";
import { isPathInsideRoot } from "./project-roots.js";
import { isIgnoredProjectScanDir } from "./project-scan-policy.js";
import { normalizeContextSources } from "./project-context-files.js";

export const WORKSPACE_INDEX_LIMITS = Object.freeze({
  defaultMaxDepth: 8,
  maxMaxDepth: 16,
  defaultMaxWorkspaces: 100,
  maxMaxWorkspaces: 500,
  defaultMaxErrors: 50,
  defaultMaxWarnings: 50,
  maxInstructionBytes: 16 * 1024,
  maxTotalInstructionBytes: 64 * 1024
});

export function buildWorkspaceIndex(project, options = {}) {
  const absolutePath = typeof project?.absolutePath === "string" ? path.resolve(project.absolutePath) : null;
  const projectName = typeof project?.name === "string" ? project.name : null;
  const projectRelativePath = typeof project?.relativePath === "string" ? project.relativePath : projectName;
  const maxDepth = clampInteger(options.maxDepth, {
    defaultValue: WORKSPACE_INDEX_LIMITS.defaultMaxDepth,
    min: 0,
    max: WORKSPACE_INDEX_LIMITS.maxMaxDepth
  });
  const maxWorkspaces = clampInteger(options.maxWorkspaces, {
    defaultValue: WORKSPACE_INDEX_LIMITS.defaultMaxWorkspaces,
    min: 1,
    max: WORKSPACE_INDEX_LIMITS.maxMaxWorkspaces
  });
  const maxErrors = clampInteger(options.maxErrors, {
    defaultValue: WORKSPACE_INDEX_LIMITS.defaultMaxErrors,
    min: 1,
    max: WORKSPACE_INDEX_LIMITS.defaultMaxErrors
  });
  const maxWarnings = clampInteger(options.maxWarnings, {
    defaultValue: WORKSPACE_INDEX_LIMITS.defaultMaxWarnings,
    min: 1,
    max: WORKSPACE_INDEX_LIMITS.defaultMaxWarnings
  });
  const includeInstructions = options.includeInstructions === true;
  const errors = [];
  const warnings = [];
  const workspaceCandidates = [];

  const index = {
    schemaVersion: 1,
    valid: true,
    bounded: true,
    project: {
      name: projectName,
      relativePath: projectRelativePath
    },
    limits: {
      maxDepth,
      maxWorkspaces,
      maxErrors,
      maxWarnings,
      includeInstructions
    },
    workspaces: [],
    errors,
    warnings,
    truncated: false
  };

  if (!projectName || !absolutePath) {
    addError(errors, { code: "invalid_project", message: "Workspace Index requires a resolved project with name and absolutePath." }, maxErrors);
    index.valid = false;
    return index;
  }

  const rootStat = safeLstat(absolutePath);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    addError(errors, { code: "project_unavailable", message: "Resolved project path is not a directory." }, maxErrors);
    index.valid = false;
    return index;
  }

  const sources = options.sourceFiles === undefined ? null : new Map(normalizeContextSources(options.sourceFiles).map((file) => [file.path, file]));
  const manifests = sources
    ? [...sources.keys()].filter((file) => path.posix.basename(file) === "AGENT.md" && file.split("/").length - 1 <= maxDepth).map((file) => path.join(absolutePath, file))
    : findAgentManifestPaths(absolutePath, { maxDepth });
  let includedInstructionsBytes = 0;

  for (const manifestPath of manifests) {
    const relativeManifestPath = normalizeRelative(path.relative(absolutePath, manifestPath));
    const contents = sources ? { ok: true, text: sources.get(relativeManifestPath).text } : readManifestFile(manifestPath);

    if (!contents.ok) {
      addError(errors, {
        code: contents.code,
        path: relativeManifestPath,
        message: contents.message
      }, maxErrors);
      continue;
    }

    const parsed = parseAgentManifest(contents.text, { sourcePath: relativeManifestPath });
    if (!parsed.ok) {
      addError(errors, {
        code: parsed.error.code,
        path: relativeManifestPath,
        message: parsed.error.message
      }, maxErrors);
      continue;
    }

    appendBoundedWarnings(warnings, parsed.warnings.map((warning) => ({
      ...warning,
      path: relativeManifestPath
    })), maxWarnings);

    const manifest = parsed.manifest;
    if (manifest.workspace.project && manifest.workspace.project !== projectName) {
      addError(errors, {
        code: "workspace_project_mismatch",
        path: relativeManifestPath,
        expectedProject: projectName,
        actualProject: manifest.workspace.project
      }, maxErrors);
      continue;
    }

    const workspace = toWorkspaceIndexEntry(manifest, {
      projectName,
      includeInstructions,
      includedInstructionsBytes
    });

    if (includeInstructions && typeof workspace.instructions === "string") {
      includedInstructionsBytes += Buffer.byteLength(workspace.instructions, "utf8");
    }

    workspaceCandidates.push(workspace);
  }

  const uniqueWorkspaces = removeDuplicateWorkspaceIds(workspaceCandidates, errors, maxErrors);
  const boundedWorkspaces = uniqueWorkspaces.slice(0, maxWorkspaces);
  index.truncated = uniqueWorkspaces.length > maxWorkspaces;
  index.workspaces = boundedWorkspaces;

  if (errors.omittedCount) {
    appendBoundedWarnings(warnings, [{
      code: "errors_truncated",
      omitted: errors.omittedCount
    }], maxWarnings);
    delete errors.omittedCount;
  }

  if (warnings.length > maxWarnings) {
    warnings.length = maxWarnings;
  }

  index.valid = errors.length === 0;
  return index;
}

function findAgentManifestPaths(root, { maxDepth }) {
  const manifests = [];

  function visit(dir, depth) {
    if (!isPathInsideRoot(root, dir)) {
      return;
    }

    const dirStat = safeLstat(dir);
    if (!dirStat || !dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      return;
    }

    const manifestPath = path.join(dir, "AGENT.md");
    const manifestStat = safeLstat(manifestPath);
    if (manifestStat?.isFile() && !manifestStat.isSymbolicLink() && isPathInsideRoot(root, manifestPath)) {
      manifests.push(manifestPath);
    }

    if (depth >= maxDepth) {
      return;
    }

    for (const entry of readDirEntries(dir)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || isIgnoredProjectScanDir(entry.name)) {
        continue;
      }

      visit(path.join(dir, entry.name), depth + 1);
    }
  }

  visit(root, 0);
  return manifests.sort((a, b) => normalizeRelative(path.relative(root, a)).localeCompare(normalizeRelative(path.relative(root, b))));
}

function toWorkspaceIndexEntry(manifest, { projectName, includeInstructions, includedInstructionsBytes }) {
  const manifestPath = manifest.source.path;
  const workspacePath = manifestPath === "AGENT.md" ? "." : path.dirname(manifestPath).replace(/\\/g, "/");
  const workspace = {
    id: manifest.workspace.id,
    manifestPath,
    workspacePath,
    project: manifest.workspace.project || projectName,
    executor: manifest.executor,
    owner: manifest.owner,
    reviewers: manifest.reviewers,
    permissions: manifest.permissions,
    scope: manifest.scope,
    preconditions: manifest.preconditions,
    routing: manifest.routing,
    source: manifest.source
  };

  if (includeInstructions) {
    workspace.instructions = boundInstructions(manifest.instructions, includedInstructionsBytes);
  }

  return workspace;
}

function removeDuplicateWorkspaceIds(workspaces, errors, maxErrors) {
  const groups = new Map();

  for (const workspace of workspaces) {
    if (!groups.has(workspace.id)) {
      groups.set(workspace.id, []);
    }
    groups.get(workspace.id).push(workspace);
  }

  const duplicateIds = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([id]) => id)
    .sort((left, right) => left.localeCompare(right));

  for (const workspaceId of duplicateIds) {
    addError(errors, {
      code: "duplicate_workspace_id",
      workspaceId,
      paths: groups.get(workspaceId).map((workspace) => workspace.manifestPath).sort((a, b) => a.localeCompare(b))
    }, maxErrors);
  }

  return workspaces
    .filter((workspace) => groups.get(workspace.id).length === 1)
    .sort((left, right) => left.manifestPath.localeCompare(right.manifestPath));
}

function boundInstructions(instructions, includedInstructionsBytes) {
  const value = String(instructions || "");
  const remaining = WORKSPACE_INDEX_LIMITS.maxTotalInstructionBytes - includedInstructionsBytes;
  if (remaining <= 0) {
    return "";
  }

  const maxBytes = Math.min(WORKSPACE_INDEX_LIMITS.maxInstructionBytes, remaining);
  const buffer = Buffer.from(value, "utf8");
  if (buffer.length <= maxBytes) {
    return value;
  }

  return buffer.subarray(0, maxBytes).toString("utf8");
}

function readManifestFile(filePath) {
  try {
    return {
      ok: true,
      text: fs.readFileSync(filePath, "utf8")
    };
  } catch {
    return {
      ok: false,
      code: "manifest_read_failed",
      message: "AGENT.md could not be read."
    };
  }
}

function appendBoundedWarnings(warnings, nextWarnings, maxWarnings) {
  for (const warning of nextWarnings) {
    if (warnings.length < maxWarnings) {
      warnings.push(warning);
    }
  }
}

function addError(errors, error, maxErrors) {
  if (errors.length < maxErrors) {
    errors.push(error);
    return;
  }

  errors.omittedCount = (errors.omittedCount || 0) + 1;
}

function readDirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function safeLstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

function normalizeRelative(value) {
  return String(value || "").replaceAll("\\", "/");
}

function clampInteger(raw, { defaultValue, min, max }) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
