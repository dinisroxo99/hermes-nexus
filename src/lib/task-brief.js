import { isDeepStrictEqual } from "node:util";
import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";
import {
  IMPACT_ANALYSIS_VERSION, IMPACT_ANALYSIS_STATUSES, IMPACT_FINDING_STATES, IMPACT_SECTION_STATUSES,
  normalizeImpactCompleteness, normalizeImpactLimits, normalizeImpactRequest
} from "./impact-policy.js";
import { collectContextSources, contextDigest } from "./project-context-files.js";
import { crossesNestedBoundary } from "./project-create-observation.js";
import { buildProjectImpact } from "./project-impact-service.js";
import { readProjectRevision } from "./project-revision.js";
import { getNestedProjectPaths, getProjectByIdForIntelligence, resolveProjectWorktree } from "./projects.js";
import { briefError, briefLimits, renderTaskBrief } from "./task-brief-renderer.js";
import { normalizeTaskContextRequest, TASK_CONTEXT_ANALYSIS_VERSION, TASK_CONTEXT_LIMITS } from "./task-context-policy.js";
import { buildProjectTaskContext } from "./task-context.js";

const HASH = /^[0-9a-f]{64}$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const FIELDS = ["task", "worktree", "includeTests", "expectedCommitSha", "expectedSnapshotToken", "limits"];
const SYM_STATUS = new Set(["available", "partial", "empty", "omitted", "not_analyzed"]);
const mismatch = () => { throw briefError("task_brief_observation_changed"); };
const invalid = () => { throw briefError("invalid_task_brief"); };
const opaque = (s, pattern) => typeof s === "string" && pattern.test(s);

function requestFor(projectId, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((k) => !FIELDS.includes(k))) invalid();
  if (Object.hasOwn(raw, "expectedCommitSha") && !opaque(raw.expectedCommitSha, SHA)) invalid();
  if (Object.hasOwn(raw, "expectedSnapshotToken") && !opaque(raw.expectedSnapshotToken, HASH)) invalid();
  if (Object.hasOwn(raw, "includeTests") && typeof raw.includeTests !== "boolean") invalid();
  const location = Object.hasOwn(raw, "worktree") ? { worktree: raw.worktree } : {};
  const pack = normalizeTaskContextRequest({ projectId, task: raw.task, ...location });
  const impact = normalizeImpactRequest({ paths: pack.task.paths, includeTests: raw.includeTests ?? true, ...location });
  if (location.worktree && pack.worktree.relativePath !== impact.worktree.relativePath) invalid();
  return { task: pack.task, paths: impact.paths, worktree: pack.worktree, includeTests: impact.includeTests,
    expectedCommitSha: raw.expectedCommitSha, expectedSnapshotToken: raw.expectedSnapshotToken, limits: briefLimits(raw.limits) };
}

function observe(projectId, requested, registry) {
  const parent = getProjectByIdForIntelligence(projectId, registry);
  const forward = requested && (parent.rootId !== requested.rootId || parent.relativePath !== requested.relativePath);
  const project = forward ? resolveProjectWorktree(projectId, requested, registry) : parent;
  const revision = readProjectRevision(project);
  if (revision.status !== "available" || !opaque(revision.commitSha, SHA) || !opaque(revision.repositoryIdentity, HASH)
      || !opaque(revision.worktreeId, HASH) || typeof revision.dirty !== "boolean" || typeof revision.isLinkedWorktree !== "boolean") {
    throw briefError("task_brief_revision_unavailable");
  }
  const { capturedAt, ...bound } = revision;
  return { project, revision: bound, locator: { rootId: project.rootId, relativePath: project.relativePath },
    forwarded: forward ? { worktree: requested } : {}, excluded: getNestedProjectPaths(project, registry) };
}

function providerRef(descriptor) {
  if (descriptor === null) return null;
  if (!descriptor || typeof descriptor.id !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(descriptor.id)
      || typeof descriptor.version !== "string" || !/^[A-Za-z0-9_.+-]{1,64}$/.test(descriptor.version)) {
    throw briefError("task_brief_evidence_invalid");
  }
  return { id: descriptor.id, version: descriptor.version };
}

function bind(pack, impact, request, selected, snapshot, sourceDigest) {
  const { project, locator, revision } = selected;
  if (pack?.schemaVersion !== 1 || pack.analysisVersion !== TASK_CONTEXT_ANALYSIS_VERSION
      || impact?.schemaVersion !== 1 || impact.analysisVersion !== IMPACT_ANALYSIS_VERSION) mismatch();
  for (const result of [pack, impact]) {
    if (result.projectId !== project.projectId || result.project?.rootId !== locator.rootId
        || result.project.relativePath !== locator.relativePath) mismatch();
  }
  if (!isDeepStrictEqual(pack.revision, revision) || !isDeepStrictEqual(impact.revision, snapshot.revision)
      || impact.worktree?.worktreeId !== revision.worktreeId || pack.analysis?.snapshotToken !== snapshot.token
      || impact.snapshotToken !== snapshot.token || pack.observation?.sourceDigest !== sourceDigest) mismatch();
  if (request.expectedSnapshotToken && request.expectedSnapshotToken !== snapshot.token) mismatch();
  const task = pack.sections?.task?.items?.[0];
  if (!task || Object.keys(request.task).some((k) => !isDeepStrictEqual(request.task[k], task[k]))) mismatch();
  const origins = Object.hasOwn(impact, "targets") && !Object.hasOwn(impact, "originPath") && Array.isArray(impact.targets)
    ? impact.targets : [{ originPath: impact.originPath, targetSource: impact.observation?.targetSource }];
  if (!isDeepStrictEqual(origins.map((entry) => entry.originPath), request.paths)
      || !opaque(pack.contextPackId, /^context_[0-9a-f]{64}$/)) mismatch();
  const hashes = new Map(snapshot.files.map((f) => [f.path, f.sha256]));
  for (const { originPath, targetSource } of origins) {
    const expected = hashes.has(originPath) ? { path: originPath, hash: hashes.get(originPath) } : null;
    if (!isDeepStrictEqual(targetSource, expected)) mismatch();
  }
  const provider = providerRef(pack.analysis.provider);
  if (!isDeepStrictEqual(provider, providerRef(impact.provider))) mismatch();
  const trust = pack.analysis.provenance?.trust;
  if (trust !== (pack.analysis.provider?.kind === "external" ? "untrusted_external_analysis" : "derived_analysis")) mismatch();
  return { projectId: project.projectId, project: locator, revision: snapshot.revision, snapshotToken: snapshot.token,
    sourceDigest, contextPackId: pack.contextPackId, provider, trust,
    originCount: origins.length, originPathsDigest: contextDigest(JSON.stringify(request.paths)), contextVersion: pack.analysisVersion, impactVersion: impact.analysisVersion };
}

function consistentLocation(left, right) {
  if (left.project.absolutePath !== right.project.absolutePath || !isDeepStrictEqual(left.locator, right.locator)
      || !isDeepStrictEqual(left.excluded, right.excluded) || !isDeepStrictEqual(left.revision, right.revision)) mismatch();
}

function publicImpactCoverage(impact) {
  try {
    const completeness = normalizeImpactCompleteness(impact.completeness);
    const limits = normalizeImpactLimits(impact.limits);
    if (!isDeepStrictEqual(completeness, impact.completeness) || !isDeepStrictEqual(limits, impact.limits)
        || impact.affectedFiles.length > limits.affectedFiles || impact.affectedTests.candidates.length > limits.affectedTests) {
      throw briefError("task_brief_evidence_invalid");
    }
    return { completeness, limits };
  } catch {
    throw briefError("task_brief_evidence_invalid");
  }
}

export function buildTaskBrief(projectId, raw, options = {}, producers = {}) {
  const request = requestFor(projectId, raw);
  const selected = observe(projectId, request.worktree, options.registry);
  if (request.expectedCommitSha && request.expectedCommitSha !== selected.revision.commitSha) mismatch();
  if (request.paths.some((p) => crossesNestedBoundary(p, selected.excluded))) throw briefError("task_brief_boundary_excluded");

  const pack = (producers.buildProjectTaskContext || buildProjectTaskContext)(
    { projectId, task: raw.task, ...selected.forwarded, includeExcerpts: false }, options);
  const impact = (producers.buildProjectImpact || buildProjectImpact)(projectId,
    { paths: request.paths, ...selected.forwarded, includeTests: request.includeTests }, options);
  const current = observe(projectId, request.worktree, options.registry);
  consistentLocation(selected, current);
  const source = collectContextSources(current.project, { excludedPaths: current.excluded });
  consistentLocation(current, observe(projectId, request.worktree, options.registry));
  const snapshot = createProviderSnapshot(current.project, source.files, current.revision);
  const binding = bind(pack, impact, request, current, snapshot, source.digest);
  const symbols = pack.sections.symbols;
  const tests = impact.affectedTests;
  if (typeof pack.observation.incomplete !== "boolean" || typeof impact.observation?.incomplete !== "boolean"
      || !SYM_STATUS.has(symbols?.status) || typeof symbols.truncated !== "boolean" || !Array.isArray(symbols.items)
      || !IMPACT_ANALYSIS_STATUSES.includes(impact.status) || !IMPACT_FINDING_STATES.includes(impact.findingState)
      || !IMPACT_SECTION_STATUSES.includes(tests?.status) || !Array.isArray(tests.candidates) || !Array.isArray(impact.affectedFiles)
      || (tests.status === "not_requested") !== !request.includeTests || (!request.includeTests && tests.candidates.length)) {
    throw briefError("task_brief_evidence_invalid");
  }
  const impactCoverage = publicImpactCoverage(impact);
  if (!Number.isInteger(pack.limits.symbols) || pack.limits.symbols < 0 || pack.limits.symbols > TASK_CONTEXT_LIMITS.symbols[1]
      || !Number.isInteger(pack.limits.maxBytes) || pack.limits.maxBytes < 16384 || pack.limits.maxBytes > TASK_CONTEXT_LIMITS.maxBytes[1]
      || symbols.items.length > pack.limits.symbols || (request.includeTests && !IMPACT_FINDING_STATES.includes(tests.findingState))) {
    throw briefError("task_brief_evidence_invalid");
  }
  const admitted = new Map(source.files.map(({ path, sha256 }) => [path, sha256]));
  if ([...symbols.items, ...impact.affectedFiles, ...tests.candidates].some((item) => !admitted.has(item?.path))) mismatch();
  for (const symbol of symbols.items) {
    if (!opaque(symbol.id, /^symbol_[0-9a-f]{64}$/) || symbol.provenance?.source?.path !== symbol.path
        || symbol.provenance.source.sha256 !== admitted.get(symbol.path)) mismatch();
  }
  const producerIncomplete = pack.observation.incomplete || impact.observation.incomplete || source.truncated;
  const brief = renderTaskBrief({ symbols: symbols.items, affectedFiles: impact.affectedFiles.map((x) => x.path),
    testCandidates: tests.candidates.map((x) => x.path), status: impact.status, finding: impact.findingState,
    incomplete: producerIncomplete, testsStatus: tests.status }, request.limits);
  const rendered = brief.projection.counts.symbols.rendered;
  return { schemaVersion: 1, analysisVersion: "task-brief-v1", text: brief.text,
    binding: { ...binding, renderedSymbolIds: symbols.items.slice(0, rendered).map((symbol) => symbol.id) },
    coverage: { incomplete: producerIncomplete || brief.projection.truncated,
      source: { truncated: source.truncated, limits: source.limits },
      context: { incomplete: pack.observation.incomplete, symbolsStatus: symbols.status, symbolsTruncated: symbols.truncated,
        symbolLimit: pack.limits.symbols, byteLimit: pack.limits.maxBytes },
      impact: { incomplete: impact.observation.incomplete, status: impact.status, finding: impact.findingState,
        testCandidatesStatus: tests.status, testCandidatesFinding: tests.findingState ?? null, ...impactCoverage },
      projection: brief.projection } };
}
