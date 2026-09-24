import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";
import { analyzeContextSources } from "./analyzer-service.js";
import { normalizeImpactRequest } from "./impact-policy.js";
import { collectContextSources } from "./project-context-files.js";
import { composeProjectImpact } from "./project-impact.js";
import { validateProjectId } from "./project-registry.js";
import { readProjectRevision } from "./project-revision.js";
import { validateRelativeProjectPath } from "./project-roots.js";
import { getNestedProjectPaths, getProjectByIdForIntelligence, resolveProjectWorktree } from "./projects.js";

const CONTROL = /[\u0000-\u001f\u007f]/;
const SOURCE_UNAVAILABLE_CODES = new Set(["source_directory_unavailable", "source_unavailable", "source_changed"]);

export function buildProjectImpact(projectId, input, options = {}) {
  validateProjectId(projectId);
  const request = normalizeImpactRequest(input);
  const resolve = () => request.worktree
    ? resolveProjectWorktree(projectId, request.worktree, options.registry)
    : getProjectByIdForIntelligence(projectId, options.registry);

  const project = resolve();
  const identity = projectIdentity(project, projectId);
  const revisionReader = options.readRevision || readProjectRevision;
  const collect = options.collectSources || collectContextSources;
  const analyze = options.analyzeSources || analyzeContextSources;
  const revision = safeRevision(revisionReader(project));
  const excludedPaths = getNestedProjectPaths(project, options.registry);
  const sourceOptions = { excludedPaths };
  const observed = collect(project, sourceOptions);
  const snapshot = createProviderSnapshot(project, observed.files, revision);
  const graph = analyze(project, snapshot.files, { ...options.analyzer, revision: snapshot.revision });
  const result = composeProjectImpact(request, {
    project: { projectId, rootId: project.rootId, relativePath: project.relativePath },
    snapshot,
    graph,
    sourceLimited: Boolean(observed.truncated),
    sourceUnavailable: observed.files.length === 0
      || observed.diagnostics.some((diagnostic) => SOURCE_UNAVAILABLE_CODES.has(diagnostic?.code))
  });

  let after;
  try {
    after = collect(project, sourceOptions);
  } catch {
    throw impactServiceError("impact_sources_changed");
  }
  if (observed.digest !== after.digest || observed.truncated !== after.truncated
    || JSON.stringify(observed.diagnostics) !== JSON.stringify(after.diagnostics)) {
    throw impactServiceError("impact_sources_changed");
  }

  let afterRevision;
  try {
    afterRevision = safeRevision(revisionReader(project));
  } catch {
    throw impactServiceError("impact_revision_changed");
  }
  if (JSON.stringify(revision) !== JSON.stringify(afterRevision)) {
    throw impactServiceError("impact_revision_changed");
  }

  try {
    const afterProject = resolve();
    const afterIdentity = projectIdentity(afterProject, projectId);
    const afterExcludedPaths = getNestedProjectPaths(afterProject, options.registry);
    if (JSON.stringify(identity) !== JSON.stringify(afterIdentity)
      || JSON.stringify(excludedPaths) !== JSON.stringify(afterExcludedPaths)) {
      throw impactServiceError("impact_project_changed");
    }
  } catch (error) {
    if (error?.code === "impact_project_changed") throw error;
    throw impactServiceError("impact_project_changed");
  }

  return result;
}

function safeRevision(revision) {
  const { capturedAt, ...safe } = revision;
  return safe;
}

function projectIdentity(project, projectId) {
  const relative = validateRelativeProjectPath(project?.relativePath);
  if (project?.projectId !== projectId
    || typeof project.rootId !== "string" || project.rootId.length === 0 || project.rootId.length > 128 || CONTROL.test(project.rootId)
    || !relative.valid || relative.relativePath !== project.relativePath || project.relativePath.length > 1024 || CONTROL.test(project.relativePath)
    || typeof project.absolutePath !== "string" || project.absolutePath.length === 0) {
    throw projectUnavailable();
  }
  return {
    projectId,
    rootId: project.rootId,
    relativePath: project.relativePath,
    absolutePath: project.absolutePath,
    parentProjectId: project.parentProjectId ?? null,
    canonicalLocation: project.canonicalLocation
      ? { rootId: project.canonicalLocation.rootId, relativePath: project.canonicalLocation.relativePath }
      : null
  };
}

function projectUnavailable() {
  return Object.assign(new Error("Project is unavailable."), { code: "project_unavailable" });
}

function impactServiceError(code) {
  return Object.assign(new Error("Live Impact v2 observation changed."), { code });
}
