import { buildWorkspaceIndex } from "./workspace-index.js";
import { buildIcmDocumentIndex } from "./icm-documents.js";

export const ICM_INDEX_LIMITS = Object.freeze({
  defaultMaxErrors: 100,
  maxMaxErrors: 100,
  defaultMaxWarnings: 100,
  maxMaxWarnings: 100
});

const FATAL_DOCUMENT_ERROR_CODES = new Set([
  "invalid_project",
  "project_unavailable"
]);

export function buildProjectIcmIndex(project, options = {}) {
  const maxErrors = clampInteger(options.maxErrors, {
    defaultValue: ICM_INDEX_LIMITS.defaultMaxErrors,
    min: 1,
    max: ICM_INDEX_LIMITS.maxMaxErrors
  });
  const maxWarnings = clampInteger(options.maxWarnings, {
    defaultValue: ICM_INDEX_LIMITS.defaultMaxWarnings,
    min: 1,
    max: ICM_INDEX_LIMITS.maxMaxWarnings
  });

  const workspaceIndex = buildWorkspaceIndex(project, options.workspace || {});
  const documentIndex = buildIcmDocumentIndex(project, options.documents || {});
  const errors = [];
  const warnings = [];

  appendBoundedIssues(errors, sourceIssues("workspace", workspaceIndex.errors), maxErrors);
  appendBoundedIssues(errors, sourceIssues("document", documentIndex.errors), maxErrors);

  if (errors.omittedCount) {
    appendBoundedIssues(warnings, [{
      source: "icm",
      code: "errors_truncated",
      omitted: errors.omittedCount
    }], maxWarnings);
    delete errors.omittedCount;
  }

  appendBoundedIssues(warnings, sourceIssues("workspace", workspaceIndex.warnings), maxWarnings);
  appendBoundedIssues(warnings, sourceIssues("document", documentIndex.warnings), maxWarnings);

  if (warnings.omittedCount) {
    delete warnings.omittedCount;
  }

  const hasFatalDocumentError = documentIndex.errors.some((error) => FATAL_DOCUMENT_ERROR_CODES.has(error.code));

  return {
    schemaVersion: 1,
    valid: workspaceIndex.valid && !hasFatalDocumentError,
    bounded: true,
    authority: {
      workspaceContracts: "agent_manifest_front_matter",
      contextualDocuments: "context_only"
    },
    project: workspaceIndex.project,
    limits: {
      maxErrors,
      maxWarnings,
      workspace: workspaceIndex.limits,
      documents: documentIndex.limits
    },
    workspaces: workspaceIndex.workspaces,
    documents: documentIndex.documents,
    errors,
    warnings,
    truncated: {
      workspaces: workspaceIndex.truncated,
      documents: documentIndex.truncated
    }
  };
}

function sourceIssues(source, issues) {
  return issues.map((issue) => ({
    source,
    ...issue
  }));
}

function appendBoundedIssues(target, issues, maxIssues) {
  for (const issue of issues) {
    if (target.length < maxIssues) {
      target.push(issue);
      continue;
    }

    target.omittedCount = (target.omittedCount || 0) + 1;
  }
}

function clampInteger(raw, { defaultValue, min, max }) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
