import fs from "node:fs";
import path from "node:path";

import { parseDocument } from "yaml";

export const AGENT_MANIFEST_LIMITS = Object.freeze({
  maxFileSizeBytes: 128 * 1024,
  maxIdLength: 100,
  maxInstructionBytes: 128 * 1024,
  maxReviewers: 20,
  maxScopeInclude: 100,
  maxScopeExclude: 100,
  maxScopePatternLength: 200,
  maxPreconditions: 50,
  maxRoutingEntries: 50,
  maxUnknownTopLevelWarnings: 20
});

const SUPPORTED_SCHEMA_VERSION = 1;
const KNOWN_TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "workspace",
  "executor",
  "owner",
  "reviewers",
  "permissions",
  "scope",
  "preconditions",
  "routing"
]);
const PERMISSION_KEYS = ["read", "write", "executeCommands", "createAgents"];
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,98}[a-z0-9])?$/;
const ROUTE_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/;
const PRECONDITION_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,99}$/;

export class AgentManifestError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AgentManifestError";
    this.code = code;
    if (details) this.details = details;
  }
}

export function parseAgentManifest(text, options = {}) {
  try {
    return parseAgentManifestOrThrow(text, options);
  } catch (error) {
    if (error instanceof AgentManifestError) {
      return {
        ok: false,
        error: formatManifestError(error),
        warnings: []
      };
    }

    return {
      ok: false,
      error: {
        code: "invalid_yaml",
        message: "AGENT.md front matter could not be parsed."
      },
      warnings: []
    };
  }
}

export function readAgentManifest(filePath, options = {}) {
  const contents = fs.readFileSync(filePath, "utf8");
  return parseAgentManifest(contents, {
    ...options,
    sourcePath: options.sourcePath ?? path.basename(filePath)
  });
}

function parseAgentManifestOrThrow(text, options) {
  if (typeof text !== "string") {
    throw new AgentManifestError("invalid_manifest_input", "AGENT.md content must be a string.");
  }

  if (Buffer.byteLength(text, "utf8") > AGENT_MANIFEST_LIMITS.maxFileSizeBytes) {
    throw new AgentManifestError("manifest_too_large", "AGENT.md exceeds the maximum supported size.");
  }

  const sourcePath = normalizeSourcePath(options.sourcePath);
  const extracted = extractFrontMatter(text);
  if (!extracted) {
    throw new AgentManifestError("missing_front_matter", "AGENT.md must start with YAML front matter.");
  }

  const document = parseDocument(extracted.yaml, {
    schema: "core",
    uniqueKeys: true,
    merge: false,
    maxAliasCount: 50
  });

  if (document.errors.length > 0) {
    const duplicate = document.errors.find((yamlError) => isDuplicateKeyError(yamlError));
    if (duplicate) {
      throw new AgentManifestError("duplicate_yaml_key", "AGENT.md front matter contains duplicate YAML keys.");
    }

    throw new AgentManifestError("invalid_yaml", "AGENT.md front matter could not be parsed.");
  }

  let raw;
  try {
    raw = document.toJSON();
  } catch {
    throw new AgentManifestError("invalid_yaml", "AGENT.md front matter could not be parsed safely.");
  }

  if (!isRecord(raw)) {
    throw new AgentManifestError("invalid_yaml", "AGENT.md front matter must be a mapping.");
  }

  const warnings = collectUnknownTopLevelWarnings(raw);
  const schemaVersion = normalizeSchemaVersion(raw.schemaVersion);
  const workspace = normalizeWorkspace(raw.workspace);
  const executor = normalizeExecutor(raw.executor);
  const owner = normalizeOwner(raw.owner);
  const reviewers = normalizeReviewers(raw.reviewers);
  const permissions = normalizePermissions(raw.permissions);
  const scope = normalizeScope(raw.scope);
  const preconditions = normalizePreconditions(raw.preconditions);
  const routing = normalizeRouting(raw.routing);

  return {
    ok: true,
    manifest: {
      schemaVersion,
      workspace,
      executor,
      owner,
      reviewers,
      permissions,
      scope,
      preconditions,
      routing,
      instructions: extracted.instructions,
      source: {
        path: sourcePath,
        frontMatterStartLine: 1,
        frontMatterEndLine: extracted.frontMatterEndLine,
        instructionsStartLine: extracted.instructionsStartLine
      }
    },
    warnings
  };
}

function formatManifestError(error) {
  return {
    code: error.code,
    message: error.message,
    ...(error.details ? { details: error.details } : {})
  };
}

function normalizeSourcePath(sourcePath) {
  if (typeof sourcePath !== "string" || sourcePath.trim() === "") {
    return "AGENT.md";
  }

  const normalized = sourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === "" ? "AGENT.md" : normalized;
}

function extractFrontMatter(text) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  if (lines[0] !== "---") {
    return null;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closingIndex === -1) {
    return null;
  }

  const yaml = lines.slice(1, closingIndex).join(newline);
  const instructionsLines = lines.slice(closingIndex + 1);
  const instructionsStartOffset = instructionsLines[0] === "" ? 2 : 1;
  const bodyLines = instructionsLines[0] === "" ? instructionsLines.slice(1) : instructionsLines;

  return {
    yaml,
    instructions: bodyLines.join(newline),
    frontMatterEndLine: closingIndex + 1,
    instructionsStartLine: closingIndex + 1 + instructionsStartOffset
  };
}

function isDuplicateKeyError(yamlError) {
  return yamlError?.code === "DUPLICATE_KEY" || /duplicate key/i.test(yamlError?.message ?? "");
}

function collectUnknownTopLevelWarnings(raw) {
  return Object.keys(raw)
    .filter((key) => !KNOWN_TOP_LEVEL_FIELDS.has(key))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, AGENT_MANIFEST_LIMITS.maxUnknownTopLevelWarnings)
    .map((field) => ({ code: "unknown_top_level_field", field }));
}

function normalizeSchemaVersion(value) {
  if (value === undefined || value === null) {
    throw new AgentManifestError("missing_schema_version", "AGENT.md schemaVersion is required.");
  }

  if (value !== SUPPORTED_SCHEMA_VERSION) {
    throw new AgentManifestError("unsupported_schema_version", "AGENT.md schemaVersion is not supported.");
  }

  return SUPPORTED_SCHEMA_VERSION;
}

function normalizeWorkspace(value) {
  if (!isRecord(value)) {
    throw new AgentManifestError("invalid_workspace_id", "workspace.id is required and must be a canonical ID.");
  }

  const id = normalizeId(value.id, "invalid_workspace_id", "workspace.id is required and must be a canonical ID.");
  const workspace = { id };

  if (value.project !== undefined && value.project !== null) {
    workspace.project = normalizeId(value.project, "invalid_workspace_project", "workspace.project must be a canonical ID.");
  }

  return workspace;
}

function normalizeExecutor(value) {
  if (!isRecord(value) || value.required === undefined || value.required === null) {
    throw new AgentManifestError("missing_required_executor", "executor.required is required.");
  }

  return {
    required: normalizeId(value.required, "invalid_required_executor", "executor.required must be a canonical agent ID.")
  };
}

function normalizeOwner(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new AgentManifestError("invalid_owner", "owner must be a mapping when present.");
  }

  return {
    agent: normalizeId(value.agent, "invalid_owner_agent", "owner.agent must be a canonical agent ID.")
  };
}

function normalizeReviewers(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const values = normalizeArray(value, "invalid_reviewers", "reviewers must be a list.");
  if (values.length > AGENT_MANIFEST_LIMITS.maxReviewers) {
    throw new AgentManifestError("too_many_reviewers", "reviewers exceeds the maximum supported item count.");
  }

  return dedupe(values.map((reviewer) => normalizeId(
    reviewer,
    "invalid_reviewer_id",
    "reviewers must contain canonical agent IDs."
  )));
}

function normalizePermissions(value) {
  const permissions = {
    read: false,
    write: false,
    executeCommands: false,
    createAgents: false
  };

  if (value === undefined || value === null) {
    return permissions;
  }

  if (!isRecord(value)) {
    throw new AgentManifestError("invalid_permissions", "permissions must be a mapping when present.");
  }

  for (const key of Object.keys(value)) {
    if (!PERMISSION_KEYS.includes(key)) {
      throw new AgentManifestError("invalid_permission_key", "permissions contains an unsupported key.", { key });
    }

    if (typeof value[key] !== "boolean") {
      throw new AgentManifestError("invalid_permission_value", "permission values must be booleans.", { key });
    }

    permissions[key] = value[key];
  }

  return permissions;
}

function normalizeScope(value) {
  const scope = {
    include: [],
    exclude: []
  };

  if (value === undefined || value === null) {
    return scope;
  }

  if (!isRecord(value)) {
    throw new AgentManifestError("invalid_scope", "scope must be a mapping when present.");
  }

  scope.include = normalizeScopeList(value.include, AGENT_MANIFEST_LIMITS.maxScopeInclude);
  scope.exclude = normalizeScopeList(value.exclude, AGENT_MANIFEST_LIMITS.maxScopeExclude);
  return scope;
}

function normalizeScopeList(value, maxItems) {
  if (value === undefined || value === null) {
    return [];
  }

  const values = normalizeArray(value, "invalid_scope", "scope include/exclude values must be lists.");
  if (values.length > maxItems) {
    throw new AgentManifestError("too_many_scope_patterns", "scope include/exclude exceeds the maximum supported item count.");
  }

  return values.map((item) => normalizeScopePattern(item));
}

function normalizeScopePattern(value) {
  if (typeof value !== "string") {
    throw new AgentManifestError("invalid_scope_pattern", "scope patterns must be strings.");
  }

  if (value.length === 0 || value.length > AGENT_MANIFEST_LIMITS.maxScopePatternLength) {
    throw new AgentManifestError("invalid_scope_pattern", "scope pattern length is invalid.");
  }

  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\")) {
    throw new AgentManifestError("invalid_scope_pattern", "scope patterns must be project-relative.");
  }

  if (value.split(/[\\/]+/).includes("..")) {
    throw new AgentManifestError("invalid_scope_pattern", "scope patterns must not contain traversal segments.");
  }

  if (/[\u0000-\u001F\u007F]/.test(value)) {
    throw new AgentManifestError("invalid_scope_pattern", "scope patterns must not contain control characters.");
  }

  return value;
}

function normalizePreconditions(value) {
  if (value === undefined || value === null) {
    return [];
  }

  const values = normalizeArray(value, "invalid_preconditions", "preconditions must be a list.");
  if (values.length > AGENT_MANIFEST_LIMITS.maxPreconditions) {
    throw new AgentManifestError("too_many_preconditions", "preconditions exceeds the maximum supported item count.");
  }

  return dedupe(values.map((precondition) => {
    if (typeof precondition !== "string" || !PRECONDITION_PATTERN.test(precondition)) {
      throw new AgentManifestError("invalid_precondition", "preconditions must contain bounded metadata IDs.");
    }
    return precondition;
  }));
}

function normalizeRouting(value) {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    throw new AgentManifestError("invalid_routing", "routing must be a mapping when present.");
  }

  const entries = Object.entries(value);
  if (entries.length > AGENT_MANIFEST_LIMITS.maxRoutingEntries) {
    throw new AgentManifestError("too_many_routing_entries", "routing exceeds the maximum supported entry count.");
  }

  return Object.fromEntries(entries
    .map(([eventName, route]) => {
      if (!ROUTE_NAME_PATTERN.test(eventName)) {
        throw new AgentManifestError("invalid_route_name", "routing event names must be bounded safe identifiers.");
      }

      if (!isRecord(route)) {
        throw new AgentManifestError("invalid_route", "routing entries must be mappings.");
      }

      return [eventName, {
        agent: normalizeId(route.agent, "invalid_route_agent", "routing agents must be canonical agent IDs.")
      }];
    })
    .sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeId(value, code, message) {
  if (typeof value !== "string" || !ID_PATTERN.test(value) || value.includes("..")) {
    throw new AgentManifestError(code, message);
  }

  return value;
}

function normalizeArray(value, code, message) {
  if (!Array.isArray(value)) {
    throw new AgentManifestError(code, message);
  }

  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function dedupe(values) {
  return [...new Set(values)];
}
