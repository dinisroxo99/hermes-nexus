import { analyzeMultiFileReverseImpact, analyzeSingleFileReverseImpact } from "./impact-traversal.js";
import {
  IMPACT_ANALYSIS_VERSION,
  normalizeImpactCompleteness,
  normalizeImpactRequest
} from "./impact-policy.js";
import {
  PROVIDER_LIMITS,
  createProviderSnapshot,
  normalizeProviderDescriptor
} from "../analyzers/common/analyzer-provider-contract.js";
import { validateProjectId } from "./project-registry.js";
import { validateRelativeProjectPath } from "./project-roots.js";

const OBSERVATION_FIELDS = Object.freeze(["project", "snapshot", "graph", "sourceLimited", "sourceUnavailable"]);
const PROJECT_FIELDS = Object.freeze(["projectId", "rootId", "relativePath"]);
const SNAPSHOT_FIELDS = Object.freeze(["schemaVersion", "projectId", "token", "revision", "languages", "files"]);
const COVERAGE_FIELDS = Object.freeze(["observed", "covered", "uncovered"]);
const ANALYSIS_STATUSES = Object.freeze(["available", "partial", "unsupported", "unavailable"]);
const LANGUAGE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Composes bounded Impact v2 evidence from a caller-supplied project observation.
 * This seam is deliberately synchronous and observation-bound: it performs no
 * project resolution, source collection, analyzer execution, cache access or IO.
 */
export function composeProjectImpact(input, observation) {
  const request = normalizeImpactRequest(input);
  if (request.includeTests) throw projectImpactError("impact_request_not_supported", "This Impact v2 composer supports one file without affected tests.");

  const bound = validateObservation(request, observation);
  if (request.paths.length > 1) {
    const primitive = bound.snapshot.files.length === 0
      ? emptyMultiSourceImpact(bound, observation, request.paths)
      : analyzeMultiFileReverseImpact({
        originPaths: request.paths,
        limits: request.limits,
        snapshot: observation.snapshot,
        graph: observation.graph,
        sourceFiles: observation.snapshot.files,
        sourceLimited: bound.sourceLimited,
        sourceUnavailable: bound.sourceUnavailable
      });
    return enforceMultiOutputBounds({ request, bound, primitive });
  }
  const primitive = bound.snapshot.files.length === 0
    ? emptySourceImpact(bound, observation)
    : analyzeSingleFileReverseImpact({
      originPath: request.paths[0],
      limits: request.limits,
      snapshot: observation.snapshot,
      graph: observation.graph,
      sourceFiles: observation.snapshot.files,
      sourceLimited: bound.sourceLimited,
      sourceUnavailable: bound.sourceUnavailable
    });

  return enforceOutputBounds({ request, bound, primitive });
}

function validateObservation(request, observation) {
  try {
    assertRecord(observation);
    assertAllowedFields(observation, OBSERVATION_FIELDS);
    assertRecord(observation.project);
    assertAllowedFields(observation.project, PROJECT_FIELDS);
    if (Object.keys(observation.project).length !== PROJECT_FIELDS.length) throw invalidObservation();

    const { projectId, rootId, relativePath } = observation.project;
    validateProjectId(projectId);
    boundedText(rootId, 128);
    const relative = validateRelativeProjectPath(relativePath);
    if (!relative.valid || relative.relativePath !== relativePath || relativePath.length > 1024 || CONTROL.test(relativePath)) throw invalidObservation();

    const sourceLimited = strictOptionalBoolean(observation.sourceLimited);
    const sourceUnavailable = strictOptionalBoolean(observation.sourceUnavailable);
    const snapshot = normalizeSnapshot(observation.snapshot, projectId);
    const graph = normalizeGraph(observation.graph, snapshot);
    validateWorktreeRequest(request, observation.project, snapshot.revision);

    return {
      project: { projectId, rootId, relativePath },
      snapshot,
      graph,
      sourceLimited,
      sourceUnavailable
    };
  } catch (error) {
    if (error?.code === "invalid_impact_observation") throw error;
    throw invalidObservation();
  }
}

function normalizeSnapshot(snapshot, projectId) {
  assertRecord(snapshot);
  assertAllowedFields(snapshot, SNAPSHOT_FIELDS);
  if (Object.keys(snapshot).length !== SNAPSHOT_FIELDS.length || snapshot.schemaVersion !== 1 || snapshot.projectId !== projectId) throw invalidObservation();
  boundedText(snapshot.token, 128);
  if (!Array.isArray(snapshot.languages) || snapshot.languages.length > 32) throw invalidObservation();
  const suppliedLanguages = canonicalLanguages(snapshot.languages);
  if (!Array.isArray(snapshot.files)) throw invalidObservation();

  const derived = createProviderSnapshot({ projectId }, snapshot.files, snapshot.revision);
  if (derived.token !== snapshot.token || canonicalJson(suppliedLanguages) !== canonicalJson(derived.languages)) throw invalidObservation();
  if (canonicalJson(snapshot.revision) !== canonicalJson(derived.revision)) throw invalidObservation();
  if (canonicalJson(canonicalSnapshotFiles(snapshot.files)) !== canonicalJson(derived.files)) throw invalidObservation();
  return derived;
}

function canonicalSnapshotFiles(files) {
  if (!Array.isArray(files)) throw invalidObservation();
  return files.map((file) => {
    assertRecord(file);
    assertAllowedFields(file, ["path", "text", "byteSize", "sha256"]);
    if (Object.keys(file).length !== 4) throw invalidObservation();
    return { path: file.path, text: file.text, byteSize: file.byteSize, sha256: file.sha256 };
  }).sort((left, right) => compare(left.path, right.path));
}

function normalizeGraph(graph, snapshot) {
  assertRecord(graph);
  if (!Object.hasOwn(graph, "provider") || graph.schemaVersion !== 1 || typeof graph.success !== "boolean" || typeof graph.limited !== "boolean" || !ANALYSIS_STATUSES.includes(graph.status)) throw invalidObservation();
  if (graph.snapshotToken !== snapshot.token) throw invalidObservation();
  if (!Array.isArray(graph.nodes) || graph.nodes.length > PROVIDER_LIMITS.nodes || !Array.isArray(graph.edges) || graph.edges.length > PROVIDER_LIMITS.edges) throw invalidObservation();

  const terminal = graph.status === "unsupported" || graph.status === "unavailable";
  if (terminal ? (graph.success || graph.nodes.length > 0 || graph.edges.length > 0) : !graph.success) throw invalidObservation();
  const provider = graph.provider === null || graph.provider === undefined ? null : normalizeProviderDescriptor(graph.provider);
  if (!terminal && !provider) throw invalidObservation();

  const coverage = normalizeCoverage(graph.coverage, snapshot.languages, provider);
  if (graph.projectId !== undefined && graph.projectId !== null && graph.projectId !== snapshot.projectId) throw invalidObservation();
  const worktree = snapshot.revision.worktreeId === null ? null : { worktreeId: snapshot.revision.worktreeId };
  if (graph.revision !== undefined && canonicalJson(graph.revision) !== canonicalJson(snapshot.revision)) throw invalidObservation();
  if (graph.worktree !== undefined && canonicalJson(graph.worktree) !== canonicalJson(worktree)) throw invalidObservation();

  return { provider, coverage };
}

function normalizeCoverage(coverage, snapshotLanguages, provider) {
  assertRecord(coverage);
  assertAllowedFields(coverage, COVERAGE_FIELDS);
  if (Object.keys(coverage).length !== COVERAGE_FIELDS.length) throw invalidObservation();
  const observed = canonicalLanguages(coverage.observed);
  const covered = canonicalLanguages(coverage.covered);
  const uncovered = canonicalLanguages(coverage.uncovered);
  if (canonicalJson(observed) !== canonicalJson(snapshotLanguages)) throw invalidObservation();
  if (covered.some((language) => uncovered.includes(language))) throw invalidObservation();
  if (canonicalJson([...covered, ...uncovered].sort(compare)) !== canonicalJson(observed)) throw invalidObservation();
  if (covered.some((language) => !provider?.languages.includes(language)) || (!provider && covered.length > 0)) throw invalidObservation();
  return { observed, covered, uncovered };
}

function validateWorktreeRequest(request, project, revision) {
  if (!request.worktree) return;
  const rootId = request.worktree.rootId ?? "default";
  if (rootId !== project.rootId || request.worktree.relativePath !== project.relativePath
    || revision.isLinkedWorktree !== true || revision.worktreeId === null) throw invalidObservation();
}

function emptySourceImpact(bound, observation) {
  if (observation.graph.nodes.length > 0 || observation.graph.edges.length > 0) throw invalidObservation();
  const completeness = { source: ["source_unavailable"], provider: [], traversal: [], output: [] };
  if (bound.sourceLimited) addReason(completeness, "source", "source_limit");
  if (observation.graph.status === "unsupported") addReason(completeness, "provider", "provider_unsupported");
  if (observation.graph.status === "unavailable" || observation.graph.status === "partial" || observation.graph.limited) addReason(completeness, "provider", "provider_partial");
  if (bound.graph.coverage.uncovered.length > 0) addReason(completeness, "provider", "uncovered_language");
  return {
    provider: bound.graph.provider ? providerSummary(bound.graph.provider) : null,
    status: "unavailable",
    findingState: "not_evaluated",
    affectedFiles: [],
    completeness: normalizeImpactCompleteness(completeness)
  };
}

function emptyMultiSourceImpact(bound, observation, originPaths) {
  const primitive = emptySourceImpact(bound, observation);
  return {
    ...primitive,
    targets: originPaths.map((originPath) => ({
      originPath,
      status: primitive.status,
      findingState: primitive.findingState,
      completeness: cloneCompleteness(primitive.completeness)
    }))
  };
}

function enforceMultiOutputBounds({ request, bound, primitive }) {
  let affectedFiles = primitive.affectedFiles.slice();
  const completeness = cloneCompleteness(primitive.completeness);
  const targetState = new Map(primitive.targets.map((target) => [target.originPath, {
    ...target,
    completeness: cloneCompleteness(target.completeness)
  }]));

  let retainedWitnesses = 0;
  let witnessCut = affectedFiles.length;
  for (let index = 0; index < affectedFiles.length; index += 1) {
    const count = affectedFiles[index].origins.length;
    if (retainedWitnesses + count > request.limits.originWitnessRecords) {
      witnessCut = index;
      break;
    }
    retainedWitnesses += count;
  }
  if (witnessCut < affectedFiles.length) {
    addTargetOmissionReasons(targetState, affectedFiles.slice(witnessCut), "witness_budget");
    affectedFiles = affectedFiles.slice(0, witnessCut);
    addReason(completeness, "output", "witness_budget");
  }

  let result = buildMultiResult({ request, bound, primitive, targetState, affectedFiles, completeness });
  if (byteLength(result) <= request.limits.compactBytes) return result;
  if (affectedFiles.length === 0) throw projectImpactError("impact_budget_exceeded", "Impact v2 result cannot fit the requested compact byte budget.");

  addReason(completeness, "output", "output_byte_limit");
  while (affectedFiles.length > 0) {
    const removed = affectedFiles[affectedFiles.length - 1];
    addTargetOmissionReasons(targetState, [removed], "output_byte_limit");
    affectedFiles = affectedFiles.slice(0, -1);
    result = buildMultiResult({ request, bound, primitive, targetState, affectedFiles, completeness });
    if (byteLength(result) <= request.limits.compactBytes) return result;
  }
  result = buildMultiResult({ request, bound, primitive, targetState, affectedFiles, completeness });
  if (byteLength(result) <= request.limits.compactBytes) return result;
  throw projectImpactError("impact_budget_exceeded", "Impact v2 result cannot fit the requested compact byte budget.");
}

function buildMultiResult({ request, bound, primitive, targetState, affectedFiles, completeness }) {
  const retainedOrigins = new Set(affectedFiles.flatMap((item) => item.origins.map((origin) => origin.originPath)));
  const targets = request.paths.map((originPath) => {
    const primitiveTarget = primitive.targets.find((target) => target.originPath === originPath);
    const target = targetState.get(originPath);
    const canonicalCompleteness = normalizeImpactCompleteness(target.completeness);
    const targetSource = bound.snapshot.files.find((file) => file.path === originPath);
    return {
      originPath,
      targetSource: targetSource ? { path: targetSource.path, hash: targetSource.sha256 } : null,
      status: finalStatus(target.status, canonicalCompleteness),
      findingState: retainedOrigins.has(originPath)
        ? "evidence_found"
        : primitiveTarget.findingState === "evidence_found" ? "not_evaluated" : primitiveTarget.findingState,
      completeness: canonicalCompleteness
    };
  });
  const canonicalCompleteness = unionCompleteness(completeness, targets.map((target) => target.completeness));
  const status = finalStatus(primitive.status, canonicalCompleteness);
  const findingState = affectedFiles.length > 0
    ? "evidence_found"
    : targets.every((target) => target.findingState === "no_evidence_found") ? "no_evidence_found" : "not_evaluated";
  const revision = bound.snapshot.revision;
  const incomplete = hasCompleteness(canonicalCompleteness) || status !== "available" || revision.status === "unavailable" || revision.status === null;

  return {
    schemaVersion: 1,
    analysisVersion: IMPACT_ANALYSIS_VERSION,
    projectId: bound.project.projectId,
    project: { rootId: bound.project.rootId, relativePath: bound.project.relativePath },
    targets,
    revision,
    worktree: revision.worktreeId === null ? null : { worktreeId: revision.worktreeId },
    snapshotToken: bound.snapshot.token,
    generatedAt: null,
    provider: primitive.provider,
    coverage: bound.graph.coverage,
    observation: {
      basis: "working_tree",
      cacheReuse: "disabled",
      digestCoverage: "bounded_collected_sources",
      incomplete
    },
    limits: request.limits,
    status,
    findingState,
    affectedFiles,
    affectedTests: { status: "not_requested", candidates: [] },
    completeness: canonicalCompleteness
  };
}

function addTargetOmissionReasons(targetState, items, reason) {
  const origins = new Set(items.flatMap((item) => item.origins.map((origin) => origin.originPath)));
  for (const originPath of origins) addReason(targetState.get(originPath).completeness, "output", reason);
}

function unionCompleteness(base, additions) {
  const result = cloneCompleteness(base);
  for (const completeness of additions) {
    for (const [dimension, reasons] of Object.entries(completeness)) {
      for (const reason of reasons) addReason(result, dimension, reason);
    }
  }
  return normalizeImpactCompleteness(result);
}

function enforceOutputBounds({ request, bound, primitive }) {
  let affectedFiles = primitive.affectedFiles.slice();
  const completeness = cloneCompleteness(primitive.completeness);
  const originallyHadEvidence = affectedFiles.length > 0;
  let retainedWitnesses = 0;
  let witnessCut = affectedFiles.length;
  for (let index = 0; index < affectedFiles.length; index += 1) {
    const count = affectedFiles[index].origins.length;
    if (retainedWitnesses + count > request.limits.originWitnessRecords) {
      witnessCut = index;
      break;
    }
    retainedWitnesses += count;
  }
  if (witnessCut < affectedFiles.length) {
    affectedFiles = affectedFiles.slice(0, witnessCut);
    addReason(completeness, "output", "witness_budget");
  }

  let result = buildResult({ request, bound, primitive, affectedFiles, completeness, originallyHadEvidence });
  if (byteLength(result) <= request.limits.compactBytes) return result;
  if (affectedFiles.length === 0) throw projectImpactError("impact_budget_exceeded", "Impact v2 result cannot fit the requested compact byte budget.");

  addReason(completeness, "output", "output_byte_limit");
  while (affectedFiles.length > 0) {
    affectedFiles = affectedFiles.slice(0, -1);
    result = buildResult({ request, bound, primitive, affectedFiles, completeness, originallyHadEvidence });
    if (byteLength(result) <= request.limits.compactBytes) return result;
  }
  result = buildResult({ request, bound, primitive, affectedFiles, completeness, originallyHadEvidence });
  if (byteLength(result) <= request.limits.compactBytes) return result;
  throw projectImpactError("impact_budget_exceeded", "Impact v2 result cannot fit the requested compact byte budget.");
}

function buildResult({ request, bound, primitive, affectedFiles, completeness, originallyHadEvidence }) {
  const canonicalCompleteness = normalizeImpactCompleteness(completeness);
  const status = finalStatus(primitive.status, canonicalCompleteness);
  const findingState = affectedFiles.length > 0
    ? "evidence_found"
    : originallyHadEvidence ? "not_evaluated" : primitive.findingState;
  const targetSource = bound.snapshot.files.find((file) => file.path === request.paths[0]);
  const revision = bound.snapshot.revision;
  const incomplete = hasCompleteness(canonicalCompleteness) || status !== "available" || revision.status === "unavailable" || revision.status === null;

  return {
    schemaVersion: 1,
    analysisVersion: IMPACT_ANALYSIS_VERSION,
    projectId: bound.project.projectId,
    project: { rootId: bound.project.rootId, relativePath: bound.project.relativePath },
    originPath: request.paths[0],
    revision,
    worktree: revision.worktreeId === null ? null : { worktreeId: revision.worktreeId },
    snapshotToken: bound.snapshot.token,
    generatedAt: null,
    provider: primitive.provider,
    coverage: bound.graph.coverage,
    observation: {
      basis: "working_tree",
      cacheReuse: "disabled",
      digestCoverage: "bounded_collected_sources",
      targetSource: targetSource ? { path: targetSource.path, hash: targetSource.sha256 } : null,
      incomplete
    },
    limits: request.limits,
    status,
    findingState,
    affectedFiles,
    affectedTests: { status: "not_requested", candidates: [] },
    completeness: canonicalCompleteness
  };
}

function finalStatus(original, completeness) {
  if (original === "unsupported" || original === "unavailable") return original;
  return hasCompleteness(completeness) ? "partial" : "available";
}

function cloneCompleteness(completeness) {
  const normalized = normalizeImpactCompleteness(completeness);
  return Object.fromEntries(Object.entries(normalized).map(([dimension, reasons]) => [dimension, [...reasons]]));
}

function hasCompleteness(completeness) {
  return Object.values(completeness).some((reasons) => reasons.length > 0);
}

function addReason(completeness, dimension, reason) {
  if (!completeness[dimension].includes(reason)) completeness[dimension].push(reason);
  completeness[dimension].sort(compare);
}

function canonicalLanguages(value) {
  if (!Array.isArray(value) || value.length > 32 || value.some((language) => typeof language !== "string" || !LANGUAGE_ID.test(language))) throw invalidObservation();
  const result = [...new Set(value)].sort(compare);
  if (result.length !== value.length) throw invalidObservation();
  return result;
}

function providerSummary(provider) {
  return { id: provider.id, version: provider.version };
}

function strictOptionalBoolean(value) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw invalidObservation();
  return value;
}

function boundedText(value, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL.test(value)) throw invalidObservation();
  return value;
}

function assertRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidObservation();
}

function assertAllowedFields(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw invalidObservation();
}

function canonicalJson(value) {
  try { return JSON.stringify(canonicalValue(value)); }
  catch { throw invalidObservation(); }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])]));
  return value;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalidObservation() {
  return projectImpactError("invalid_impact_observation", "Invalid Impact v2 observation.");
}

function projectImpactError(code, message) {
  return Object.assign(new Error(message), { code });
}
