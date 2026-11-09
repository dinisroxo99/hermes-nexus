import { types as utilTypes } from "node:util";
import {
  EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION, EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION, ETS_CATEGORY_STATUSES, ETS_COMPLETENESS_DIMENSIONS,
  MAX_CLASSIFIED_TARGETS, MAX_COMPACT_OUTPUT, compareStrings, materializeBoundedJsonData
} from "./effective-task-scope-policy.js";
import { IMPACT_LIMITS_TARGETS_MAX } from "./impact-policy.js";
import { validateProjectId } from "./project-registry.js";
import { validateRelativeProjectPath } from "./project-roots.js";

const VERSION = "task-conflict-comparison-v1";
const CATEGORIES = ["write", "reserved", "watch", "impact"];
const SEVERITIES = ["high", "warning", "info"];
const MAX_OVERLAPS = 16;
const isHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const isCommit = (value) => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);

const boundedText = (value, max) => typeof value === "string" && value.length <= max
  && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
const canonicalPath = (value) => boundedText(value, 1024) && validateRelativeProjectPath(value).relativePath === value;

function emptyResult() {
  return {
    schemaVersion: 1, analysisVersion: VERSION, status: "not_evaluated", findingState: "not_evaluated",
    severity: null, recommendedAction: "reobserve", taskIds: [], binding: null, scopeBindings: [],
    overlaps: [], totalOverlaps: 0, truncated: false, reasons: []
  };
}

function scopeProblem(scope) {
  if (scope?.schemaVersion !== EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION
      || scope.analysisVersion !== EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION
      || scope.policyVersion !== EFFECTIVE_TASK_SCOPE_POLICY_VERSION) return "unsupported_scope";
  if (["stale", "rejected", "not_evaluated"].includes(scope.status)) return `scope_${scope.status}`;
  if (!["available", "incomplete"].includes(scope.status) || !boundedText(scope.task?.id, 128)
      || !Array.isArray(scope.task.paths) || scope.task.paths.length < 1 || scope.task.paths.length > IMPACT_LIMITS_TARGETS_MAX
      || !scope.task.paths.every(canonicalPath) || new Set(scope.task.paths).size !== scope.task.paths.length) return "invalid_scope";
  if (scope.stale?.state !== "bound") return "scope_stale";
  const revision = scope.revisionBinding;
  if (revision?.status !== "available" || revision.dirty !== false || revision.isLinkedWorktree !== true
      || !isCommit(revision.commitSha) || !isHash(revision.repositoryId) || !isHash(revision.worktreeId)
      || !(revision.branch === null || boundedText(revision.branch, 512))) return "invalid_revision_binding";
  if (!boundedText(scope.project?.rootId, 128) || !canonicalPath(scope.project.relativePath)) return "invalid_project_binding";
  try { validateProjectId(scope.projectId); } catch { return "invalid_project_binding"; }
  const source = scope.sourceBinding;
  if (!isHash(source?.contextSnapshotToken) || source.contextSnapshotToken !== source.impactSnapshotToken
      || (source.contextSourceDigest != null && !isHash(source.contextSourceDigest))) return "invalid_source_binding";
  if (!ETS_COMPLETENESS_DIMENSIONS.every((dimension) => Array.isArray(scope.completeness?.[dimension]))) return "invalid_scope";
  return null;
}

function pairProblem(a, b) {
  if (a.projectId !== b.projectId) return "different_projects";
  if (a.task.id === b.task.id) return "same_task";
  if (a.revisionBinding.repositoryId !== b.revisionBinding.repositoryId) return "different_repositories";
  if (a.revisionBinding.commitSha !== b.revisionBinding.commitSha) return "different_revisions";
  const distinctLocator = a.project.rootId !== b.project.rootId || a.project.relativePath !== b.project.relativePath;
  if (a.revisionBinding.worktreeId !== b.revisionBinding.worktreeId) {
    return distinctLocator ? "different_worktrees" : "worktree_locator_mismatch";
  }
  if (distinctLocator) return "worktree_locator_mismatch";
  if (a.revisionBinding.branch !== b.revisionBinding.branch) return "different_revisions";
  if (a.sourceBinding.contextSnapshotToken !== b.sourceBinding.contextSnapshotToken
      || a.sourceBinding.contextSourceDigest !== b.sourceBinding.contextSourceDigest) return "different_snapshots";
  return null;
}

function indexClassifications(scope, reasons) {
  const paths = new Map();
  if (scope.status === "incomplete" || ETS_COMPLETENESS_DIMENSIONS.some((dim) => scope.completeness[dim].length)) {
    reasons.add("scope_incomplete");
  }
  for (const category of CATEGORIES) {
    const section = scope[category];
    if (!ETS_CATEGORY_STATUSES.includes(section?.status) || !Array.isArray(section.items)
        || section.items.length > MAX_CLASSIFIED_TARGETS || typeof section.truncated !== "boolean"
        || (section.status === "not_evaluated" && section.items.length)) return null;
    if (section.status !== "available" || section.truncated) reasons.add(`${category}_incomplete`);
    for (const item of section.items) {
      if (item?.target?.kind !== "file" || !canonicalPath(item.target.path)) return null;
      // ETS can emit a RESERVED obligation alongside another category for the same file.
      // Categories are visited strongest first, so each file yields one symmetric finding.
      if (!paths.has(item.target.path)) paths.set(item.target.path, category);
    }
  }
  const writes = scope.write.items;
  if (scope.write.status !== "available" || writes.length !== scope.task.paths.length
      || !scope.task.paths.every((path) => paths.get(path) === "write")) return null;
  // Up to MAX_CLASSIFIED_TARGETS plus one independent Track B RESERVED item.
  return paths.size <= MAX_CLASSIFIED_TARGETS + 1 ? paths : null;
}

function overlapSeverity(first, second) {
  if (first !== "write" && second !== "write") return "info";
  const other = first === "write" ? second : first;
  if (other === "write" || other === "reserved") return "high";
  return other === "watch" ? "warning" : "info";
}

function recommendation(severity, incomplete) {
  if (severity === "high") return "serialize";
  if (severity === "warning") return "revalidate";
  return incomplete ? "reobserve" : "none";
}

function observationBinding(scope) {
  const revision = scope.revisionBinding;
  return {
    projectId: scope.projectId, project: { rootId: scope.project.rootId, relativePath: scope.project.relativePath },
    revision: {
      status: revision.status, commitSha: revision.commitSha, branch: revision.branch, dirty: revision.dirty,
      isLinkedWorktree: revision.isLinkedWorktree, repositoryId: revision.repositoryId, worktreeId: revision.worktreeId
    },
    snapshotToken: scope.sourceBinding.contextSnapshotToken
  };
}

// Sibling worktree evidence must be local to its own scope. Scope v2 does not retain the target byte hashes.
function explicitTargetHashes(rawImpact, scope) {
  let impact;
  try { impact = materializeBoundedJsonData(rawImpact); } catch { return null; }
  if (Buffer.byteLength(JSON.stringify(impact), "utf8") > MAX_COMPACT_OUTPUT
      || impact?.schemaVersion !== 1 || impact.analysisVersion !== "impact-v2"
      || impact.projectId !== scope.projectId || impact.project?.rootId !== scope.project.rootId
      || impact.project.relativePath !== scope.project.relativePath
      || impact.snapshotToken !== scope.sourceBinding.impactSnapshotToken
      || !Object.keys(observationBinding(scope).revision).every((key) => impact.revision?.[key] === scope.revisionBinding[key])
      || !["available", "partial"].includes(impact.status)
      || !["evidence_found", "no_evidence_found"].includes(impact.findingState)
      || Object.hasOwn(impact, "originPath") || !Array.isArray(impact.targets)
      || scope.task.paths.length !== impact.targets.length) return null;
  const requested = new Set(scope.task.paths);
  const hashes = new Map();
  for (const target of impact.targets) {
    if (!requested.delete(target?.originPath)) return null;
    const source = target.targetSource;
    if (source && source.path === target.originPath && isHash(source.hash)
        && ["available", "partial"].includes(target.status)
        && ["evidence_found", "no_evidence_found"].includes(target.findingState)) {
      hashes.set(target.originPath, source.hash);
    }
  }
  return hashes;
}

// Inspect the wrapper without reading accessors; each original envelope has its own materialization budget.
function siblingImpactInputs(evidence) {
  if (evidence === null || typeof evidence !== "object" || utilTypes.isProxy(evidence)) return null;
  const prototype = Object.getPrototypeOf(evidence);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const impacts = [];
  for (const key of ["leftImpact", "rightImpact"]) {
    const descriptor = Object.getOwnPropertyDescriptor(evidence, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
    impacts.push(descriptor.value);
  }
  return impacts;
}

function siblingOverlaps(scopes, indexes, impacts, reasons) {
  const hashes = scopes.map((scope, i) => explicitTargetHashes(impacts[i], scope));
  if (hashes.some((hash) => !hash)) return null;
  const overlaps = [];
  reasons.add("sibling_write_evidence_only");
  for (const [path, category] of indexes[0]) {
    if (category !== "write" || indexes[1].get(path) !== "write") continue;
    const hash = hashes[0].get(path);
    if (hash && hash === hashes[1].get(path)) {
      overlaps.push({ path, categories: ["write", "write"], severity: "high", sourceHash: hash });
    } else {
      reasons.add("unverified_shared_write");
    }
  }
  return overlaps;
}

function sharedSnapshotOverlaps(first, second) {
  const overlaps = [];
  for (const [path, category] of first) {
    const peer = second.get(path);
    if (peer) overlaps.push({ path, categories: [category, peer], severity: overlapSeverity(category, peer) });
  }
  return overlaps;
}

function boundedScope(raw) {
  try {
    const scope = materializeBoundedJsonData(raw);
    if (Buffer.byteLength(JSON.stringify(scope), "utf8") > MAX_COMPACT_OUTPUT) return { problem: "scope_budget_exceeded" };
    return { scope, problem: scopeProblem(scope) };
  } catch (error) {
    return { problem: error.code === "scope_budget_exceeded" ? error.code : "invalid_scope" };
  }
}

/** Compare two server-produced scopes. Sibling worktrees additionally require both original Impact envelopes. */
export function compareTaskScopes(leftScope, rightScope, evidence = {}) {
  const result = emptyResult();
  const sides = [boundedScope(leftScope), boundedScope(rightScope)];
  const problems = sides.map((side) => side.problem).filter(Boolean);
  if (problems.length) return { ...result, reasons: [...new Set(problems)].sort(compareStrings) };

  const scopes = sides.map((side) => side.scope).sort((a, b) => compareStrings(a.task.id, b.task.id));
  const [a, b] = scopes;
  result.taskIds = scopes.map((scope) => scope.task.id);
  const problem = pairProblem(a, b);
  const siblings = problem === "different_worktrees";
  if (problem && !siblings) return { ...result, reasons: [problem] };

  const reasons = new Set();
  const indexes = scopes.map((scope) => indexClassifications(scope, reasons));
  if (indexes.includes(null)) return { ...result, reasons: ["invalid_classification"] };

  let overlaps;
  if (siblings) {
    result.scopeBindings = scopes.map((scope) => ({ taskId: scope.task.id, ...observationBinding(scope) }));
    if (a.sourceBinding.contextSnapshotToken === b.sourceBinding.contextSnapshotToken) {
      return { ...result, reasons: ["inconsistent_sibling_snapshots"] };
    }
    const impacts = siblingImpactInputs(evidence);
    if (!impacts) return { ...result, reasons: ["unbound_sibling_impact"] };
    if (a !== sides[0].scope) impacts.reverse();
    overlaps = siblingOverlaps(scopes, indexes, impacts, reasons);
    if (!overlaps) return { ...result, reasons: ["unbound_sibling_impact"] };
    if (!overlaps.length) return { ...result, reasons: [...reasons, "no_verified_shared_write"].sort(compareStrings) };
  } else {
    result.binding = observationBinding(a);
    overlaps = sharedSnapshotOverlaps(...indexes);
  }
  overlaps.sort((x, y) => SEVERITIES.indexOf(x.severity) - SEVERITIES.indexOf(y.severity) || compareStrings(x.path, y.path));
  const truncated = overlaps.length > MAX_OVERLAPS;
  if (truncated) reasons.add("overlap_limit");
  const incomplete = reasons.size > 0;
  const severity = overlaps[0]?.severity ?? (incomplete ? null : "none");
  return {
    ...result,
    status: incomplete ? "incomplete" : "available",
    findingState: overlaps.length ? "overlap_observed" : "no_overlap_observed",
    severity, recommendedAction: recommendation(severity, incomplete),
    overlaps: overlaps.slice(0, MAX_OVERLAPS), totalOverlaps: overlaps.length, truncated,
    reasons: [...reasons].sort(compareStrings)
  };
}
