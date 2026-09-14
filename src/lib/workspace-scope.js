import { Minimatch } from "minimatch";

import { validateRelativeProjectPath } from "./project-roots.js";

export const WORKSPACE_SCOPE_LIMITS = Object.freeze({
  defaultMaxTaskPaths: 100,
  maxTaskPaths: 100,
  maxTaskPathLength: 1024,
  defaultMaxWorkspaces: 500,
  maxWorkspaces: 500,
  defaultMaxMatches: 500,
  maxMatches: 500,
  defaultMaxReasonsPerWorkspace: 100,
  maxReasonsPerWorkspace: 100,
  defaultMaxWarnings: 50,
  maxWarnings: 50,
  maxScopePatterns: 100,
  maxScopePatternLength: 200
});

const GLOB_OPTIONS = Object.freeze({
  dot: false,
  nocase: false,
  nocomment: true,
  nonegate: true,
  nobrace: true,
  noext: true,
  platform: "linux"
});
const WORKSPACE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$/;

export class WorkspaceScopeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WorkspaceScopeError";
    this.code = code;
  }
}

export function matchWorkspaceScopes(workspaces, taskPaths, options = {}) {
  const limits = buildLimits(options);
  validateInputs(workspaces, taskPaths, limits);

  const paths = normalizeTaskPaths(taskPaths);
  const warnings = [];
  const preparedWorkspaceCandidates = workspaces
    .map((workspace) => prepareWorkspace(workspace, warnings))
    .filter(Boolean)
    .sort(compareWorkspaces);
  const preparedWorkspaces = removeAmbiguousWorkspaceEntries(preparedWorkspaceCandidates, warnings);

  const candidateMatches = [];
  const matchedPathSet = new Set();

  for (const workspace of preparedWorkspaces) {
    const match = matchWorkspace(workspace, paths, warnings, limits);
    if (!match) continue;

    candidateMatches.push(match);
    for (const matchedPath of match.matchedPaths) {
      matchedPathSet.add(matchedPath);
    }
  }

  return {
    schemaVersion: 1,
    bounded: true,
    limits,
    paths,
    matches: candidateMatches.slice(0, limits.maxMatches),
    unmatchedPaths: paths.filter((taskPath) => !matchedPathSet.has(taskPath)),
    warnings: warnings.sort(compareWarnings).slice(0, limits.maxWarnings),
    truncated: candidateMatches.length > limits.maxMatches
  };
}

function buildLimits(options) {
  return {
    maxTaskPaths: clampInteger(options.maxTaskPaths, {
      fallback: WORKSPACE_SCOPE_LIMITS.defaultMaxTaskPaths,
      max: WORKSPACE_SCOPE_LIMITS.maxTaskPaths
    }),
    maxTaskPathLength: WORKSPACE_SCOPE_LIMITS.maxTaskPathLength,
    maxWorkspaces: clampInteger(options.maxWorkspaces, {
      fallback: WORKSPACE_SCOPE_LIMITS.defaultMaxWorkspaces,
      max: WORKSPACE_SCOPE_LIMITS.maxWorkspaces
    }),
    maxMatches: clampInteger(options.maxMatches, {
      fallback: WORKSPACE_SCOPE_LIMITS.defaultMaxMatches,
      max: WORKSPACE_SCOPE_LIMITS.maxMatches
    }),
    maxReasonsPerWorkspace: clampInteger(options.maxReasonsPerWorkspace, {
      fallback: WORKSPACE_SCOPE_LIMITS.defaultMaxReasonsPerWorkspace,
      max: WORKSPACE_SCOPE_LIMITS.maxReasonsPerWorkspace
    }),
    maxWarnings: clampInteger(options.maxWarnings, {
      fallback: WORKSPACE_SCOPE_LIMITS.defaultMaxWarnings,
      max: WORKSPACE_SCOPE_LIMITS.maxWarnings
    })
  };
}

function validateInputs(workspaces, taskPaths, limits) {
  if (!Array.isArray(workspaces)) {
    throw new WorkspaceScopeError("invalid_workspaces", "Workspace scope matching requires a workspaces array.");
  }

  if (!Array.isArray(taskPaths)) {
    throw new WorkspaceScopeError("invalid_task_paths", "Workspace scope matching requires a taskPaths array.");
  }

  if (taskPaths.length > limits.maxTaskPaths) {
    throw new WorkspaceScopeError("too_many_task_paths", "Task path input exceeds the configured bound.");
  }

  if (workspaces.length > limits.maxWorkspaces) {
    throw new WorkspaceScopeError("too_many_workspaces", "Workspace input exceeds the configured bound.");
  }
}

function normalizeTaskPaths(taskPaths) {
  const normalized = taskPaths.map((taskPath) => {
    if (
      typeof taskPath !== "string"
      || taskPath.length > WORKSPACE_SCOPE_LIMITS.maxTaskPathLength
      || /[\u0000-\u001F\u007F]/.test(taskPath)
      || /^[A-Za-z]:/.test(taskPath.trim())
    ) {
      throw new WorkspaceScopeError("invalid_task_path", "Task paths must be safe project-relative paths.");
    }

    const result = validateRelativeProjectPath(taskPath);
    if (!result.valid) {
      throw new WorkspaceScopeError("invalid_task_path", "Task paths must be safe project-relative paths.");
    }
    return result.relativePath;
  });

  return [...new Set(normalized)].sort(compareStrings);
}

function prepareWorkspace(workspace, warnings) {
  const workspaceId = normalizeWorkspaceId(workspace?.id);
  const manifestPath = normalizeWorkspaceRelativePath(workspace?.manifestPath);
  const workspacePath = normalizeWorkspacePath(workspace?.workspacePath);

  if (!workspaceId || !manifestPath || workspacePath === null) {
    addWarning(warnings, {
      code: "invalid_workspace",
      workspaceId,
      manifestPath
    });
    return null;
  }

  if (!isRecord(workspace.scope)) {
    addInvalidScopeWarning(warnings, workspaceId, manifestPath);
    return null;
  }

  const include = preparePatternList(workspace.scope.include, "include");
  const exclude = preparePatternList(workspace.scope.exclude, "exclude");
  if (!include.ok || !exclude.ok) {
    addInvalidScopeWarning(warnings, workspaceId, manifestPath);
    return null;
  }

  return {
    workspaceId,
    manifestPath,
    workspacePath,
    include: include.patterns,
    exclude: exclude.patterns
  };
}

function normalizeWorkspaceId(value) {
  if (typeof value !== "string" || !WORKSPACE_ID_PATTERN.test(value) || value.includes("..")) {
    return null;
  }
  return value;
}

function normalizeWorkspaceRelativePath(value) {
  if (!isSafeBoundedRelativeValue(value)) {
    return null;
  }

  const result = validateRelativeProjectPath(value);
  return result.valid ? result.relativePath : null;
}

function normalizeWorkspacePath(value) {
  if (value === "" || value === ".") {
    return ".";
  }

  if (!isSafeBoundedRelativeValue(value)) {
    return null;
  }

  const result = validateRelativeProjectPath(value);
  return result.valid ? result.relativePath : null;
}

function isSafeBoundedRelativeValue(value) {
  return typeof value === "string"
    && value.length <= WORKSPACE_SCOPE_LIMITS.maxTaskPathLength
    && !/[\u0000-\u001F\u007F]/.test(value)
    && !/^[A-Za-z]:/.test(value.trim());
}

function preparePatternList(value, kind) {
  if (!Array.isArray(value) || value.length > WORKSPACE_SCOPE_LIMITS.maxScopePatterns) {
    return { ok: false };
  }

  const patterns = [];
  for (const rawPattern of value) {
    const normalized = normalizeScopePattern(rawPattern);
    if (!normalized) {
      return { ok: false };
    }

    try {
      patterns.push({
        pattern: normalized,
        matcher: new Minimatch(normalized, GLOB_OPTIONS),
        kind
      });
    } catch {
      return { ok: false };
    }
  }

  const unique = new Map(patterns.map((pattern) => [pattern.pattern, pattern]));
  return {
    ok: true,
    patterns: [...unique.values()].sort((left, right) => compareStrings(left.pattern, right.pattern))
  };
}

function normalizeScopePattern(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > WORKSPACE_SCOPE_LIMITS.maxScopePatternLength) {
    return null;
  }

  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:/.test(value)) {
    return null;
  }

  if (/[\u0000-\u001F\u007F]/.test(value) || value.split(/[\\/]+/).includes("..")) {
    return null;
  }

  return value.replaceAll("\\", "/");
}

function matchWorkspace(workspace, paths, warnings, limits) {
  const matchedPaths = [];
  const reasons = [];
  let omittedReasons = 0;

  for (const taskPath of paths) {
    if (matchesAnyPattern(workspace.exclude, taskPath)) {
      continue;
    }

    const positiveReasons = workspace.include.length > 0
      ? explicitIncludeReasons(workspace.include, taskPath)
      : workspacePathReasons(workspace.workspacePath, taskPath);

    if (positiveReasons.length === 0) {
      continue;
    }

    matchedPaths.push(taskPath);
    for (const reason of positiveReasons) {
      if (reasons.length < limits.maxReasonsPerWorkspace) {
        reasons.push(reason);
      } else {
        omittedReasons += 1;
      }
    }
  }

  if (matchedPaths.length === 0) {
    return null;
  }

  if (omittedReasons > 0) {
    addWarning(warnings, {
      code: "match_reasons_truncated",
      workspaceId: workspace.workspaceId,
      manifestPath: workspace.manifestPath,
      omitted: omittedReasons
    });
  }

  return {
    workspaceId: workspace.workspaceId,
    manifestPath: workspace.manifestPath,
    workspacePath: workspace.workspacePath,
    matchedPaths,
    reasons
  };
}

function explicitIncludeReasons(includePatterns, taskPath) {
  return includePatterns
    .filter((entry) => matchesPattern(entry, taskPath))
    .map((entry) => ({
      path: taskPath,
      type: "scope_include",
      pattern: entry.pattern
    }));
}

function workspacePathReasons(workspacePath, taskPath) {
  if (workspacePath !== "." && taskPath !== workspacePath && !taskPath.startsWith(`${workspacePath}/`)) {
    return [];
  }

  return [{
    path: taskPath,
    type: "workspace_path",
    pattern: workspacePath === "." ? "**" : `${workspacePath}/**`
  }];
}

function matchesAnyPattern(patterns, taskPath) {
  return patterns.some((entry) => matchesPattern(entry, taskPath));
}

function matchesPattern(entry, taskPath) {
  if (entry.matcher.match(taskPath)) {
    return true;
  }

  if (entry.pattern.endsWith("/**")) {
    return taskPath === entry.pattern.slice(0, -3);
  }

  return false;
}

function addInvalidScopeWarning(warnings, workspaceId, manifestPath) {
  addWarning(warnings, {
    code: "invalid_workspace_scope",
    workspaceId,
    manifestPath
  });
}

function addWarning(warnings, warning) {
  warnings.push(warning);
}

function removeAmbiguousWorkspaceEntries(workspaces, warnings) {
  const idCounts = countBy(workspaces, (workspace) => workspace.workspaceId);
  const manifestCounts = countBy(workspaces, (workspace) => workspace.manifestPath);
  const reported = new Set();

  return workspaces.filter((workspace) => {
    const ambiguous = idCounts.get(workspace.workspaceId) > 1
      || manifestCounts.get(workspace.manifestPath) > 1;
    if (!ambiguous) {
      return true;
    }

    const key = `${workspace.workspaceId}\u0000${workspace.manifestPath}`;
    if (!reported.has(key)) {
      reported.add(key);
      addWarning(warnings, {
        code: "duplicate_workspace_scope_entry",
        workspaceId: workspace.workspaceId,
        manifestPath: workspace.manifestPath
      });
    }
    return false;
  });
}

function countBy(values, selectKey) {
  const counts = new Map();
  for (const value of values) {
    const key = selectKey(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function compareWorkspaces(left, right) {
  return compareStrings(left.manifestPath, right.manifestPath)
    || compareStrings(left.workspaceId, right.workspaceId);
}

function compareWarnings(left, right) {
  return compareStrings(left.manifestPath || "", right.manifestPath || "")
    || compareStrings(left.workspaceId || "", right.workspaceId || "")
    || compareStrings(left.code || "", right.code || "")
    || compareStrings(JSON.stringify(left), JSON.stringify(right));
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function clampInteger(raw, { fallback, max }) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
