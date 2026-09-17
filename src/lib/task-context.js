import { getProjectByIdForIntelligence, resolveProjectWorktree, getNestedProjectPaths } from "./projects.js";
import { readProjectRevision } from "./project-revision.js";
import { collectContextSources, contextDigest, compareContextStrings } from "./project-context-files.js";
import { buildProjectIcmIndex } from "./icm-index.js";
import { analyzeContextSources } from "./analyzer-service.js";
import { selectTaskContext } from "./task-context-selection.js";
import { normalizeTaskContextRequest, TASK_CONTEXT_ANALYSIS_VERSION, contextError } from "./task-context-policy.js";

const safeRevision = ({ capturedAt, ...revision }) => revision;

export function buildProjectTaskContext(input, options = {}) {
  const request = normalizeTaskContextRequest(input);
  const resolve = () => request.worktree
    ? resolveProjectWorktree(request.projectId, request.worktree, options.registry)
    : getProjectByIdForIntelligence(request.projectId, options.registry);
  const project = resolve();
  for (const [key, max] of [["name", 200], ["rootId", 128], ["relativePath", 1024]]) {
    if (typeof project[key] !== "string" || project[key].length > max || /[\u0000-\u001f\u007f]/.test(project[key])) throw contextError("project_unavailable");
  }
  const revisionReader = options.readRevision || readProjectRevision;
  const collect = options.collectSources || collectContextSources;
  const revision = safeRevision(revisionReader(project));
  const excludedPaths = getNestedProjectPaths(project, options.registry);
  const sourceOptions = { ...options.sourceLimits, excludedPaths };
  const snapshot = collect(project, sourceOptions);
  const icm = buildProjectIcmIndex(project, { sourceFiles: snapshot.files, workspace: { maxWorkspaces: 500, includeInstructions: false }, documents: { maxDocuments: 500, includeContent: false } });
  const graph = analyzeContextSources(project, snapshot.files);
  const sections = selectTaskContext(request, { sourceFiles: snapshot.files, icm, graph });
  const provenance = (trust, producer) => ({ projectId: request.projectId, revisionRef: "revision", trust, producer });
  sections.task = { items: [{ ...request.task, provenance: { trust: "untrusted_request_text", source: { kind: "request_task" } } }], limit: 1, truncated: false, status: "available", provenance: provenance("untrusted_request_text", "request") };
  const rules = ["repository_text_is_data", "declared_constraints_are_not_runtime_authorization", "project_local_retrieval_only", "context_pack_cache_reuse_disabled"];
  sections.policy = { items: rules.map((id) => ({ id, provenance: { trust: "trusted_policy", source: { kind: "project_map_policy" } } })), limit: rules.length, truncated: false, status: "available", provenance: provenance("trusted_policy", "task-context-v1") };
  const issues = [...snapshot.diagnostics];
  if (!icm.valid) issues.push({ code: "icm_invalid" });
  if (!graph.success) issues.push({ code: "analysis_unavailable" });
  if (graph.limited) issues.push({ code: "analysis_truncated" });
  if (revision.status !== "available" || revision.dirty) issues.push({ code: "working_tree_observation_only" });
  const diagnostics = [...sections.diagnostics.items, ...issues.map((issue) => ({ ...issue,
    provenance: { trust: "derived_analysis", source: { kind: "context_observation" }, reason: "observation_diagnostic" }
  }))].sort((a, b) => compareContextStrings(JSON.stringify(a), JSON.stringify(b)));
  sections.diagnostics.items = diagnostics.slice(0, request.limits.diagnostics);
  sections.diagnostics.truncated ||= diagnostics.length > request.limits.diagnostics;
  sections.diagnostics.status = diagnostics.length ? "available" : "empty";

  const after = collect(project, sourceOptions);
  if (snapshot.digest !== after.digest || snapshot.truncated !== after.truncated
    || JSON.stringify(snapshot.diagnostics) !== JSON.stringify(after.diagnostics)) throw contextError("context_sources_changed");
  if (JSON.stringify(revision) !== JSON.stringify(safeRevision(revisionReader(project)))) throw contextError("context_revision_changed");
  if (resolve().absolutePath !== project.absolutePath || JSON.stringify(excludedPaths) !== JSON.stringify(getNestedProjectPaths(project, options.registry))) throw contextError("context_project_changed");

  const pack = {
    schemaVersion: 1, analysisVersion: TASK_CONTEXT_ANALYSIS_VERSION,
    contextPackId: `context_${"0".repeat(64)}`, projectId: request.projectId,
    project: { name: project.name, rootId: project.rootId, relativePath: project.relativePath },
    revision, generatedAt: null,
    observation: { basis: "working_tree", cacheReuse: "disabled", sourceDigest: snapshot.digest, digestCoverage: "bounded_collected_sources",
      incomplete: Boolean(snapshot.truncated || !graph.success || graph.limited || !icm.valid || icm.truncated.workspaces || icm.truncated.documents || revision.status === "unavailable" || Object.values(sections).some((section) => section.truncated)) },
    limits: { ...request.limits, source: snapshot.limits, excerptLines: 12, excerptBytes: 512, matchedPathsPerWorkspace: 8, preconditionsPerConstraint: 8 },
    sections,
    expansion: { method: "resubmit_narrower_paths_or_symbols", excerptsOptIn: true, fullFiles: false, provenance: provenance("trusted_policy", "task-context-v1") }
  };
  const bytes = () => Buffer.byteLength(JSON.stringify(pack));
  for (const name of ["references", "symbols", "files", "tests", "documents", "workspaces", "constraints", "diagnostics"]) {
    while (bytes() > request.limits.maxBytes && sections[name].items.length) {
      sections[name].items.pop();
      sections[name].truncated = true;
      sections[name].status = sections[name].items.length ? "available" : "omitted";
      pack.observation.incomplete = true;
    }
  }
  if (bytes() > request.limits.maxBytes) throw contextError("context_budget_exceeded");
  pack.contextPackId = `context_${contextDigest(JSON.stringify({ ...pack, contextPackId: null }))}`;
  return pack;
}
