import { types as utilTypes } from "node:util";
import { validateProjectId } from "./project-registry.js";
import { validateRelativeProjectPath } from "./project-roots.js";
import {
  normalizeImpactPaths, normalizeImpactStatus, normalizeImpactFindingState,
  normalizeImpactCompleteness, IMPACT_COMPLETENESS_DIMENSIONS, IMPACT_COMPLETENESS_REASONS, IMPACT_LIMITS
} from "./impact-policy.js";
import { TASK_CONTEXT_LIMITS } from "./task-context-policy.js";

export const EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION = 2;
export const EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION = "effective-task-scope-v2";
export const EFFECTIVE_TASK_SCOPE_POLICY_VERSION = "step4-foundation-4";

export const ETS_STATUSES = Object.freeze([
  "available",
  "incomplete",
  "not_evaluated",
  "rejected",
  "stale"
]);

export const ETS_CATEGORY_STATUSES = Object.freeze(["available", "incomplete", "not_evaluated"]);

export const CHANGE_SEMANTICS_CATEGORIES = Object.freeze([
  "documentation",
  "test_only",
  "local_implementation",
  "public_signature",
  "interface_contract",
  "schema_migration",
  "unknown"
]);

export const ETS_COMPLETENESS_DIMENSIONS = Object.freeze(["source", "provider", "traversal", "output", "resolver"]);

export const DOCUMENTATION_EXTENSIONS = Object.freeze([".md", ".rst", ".txt"]);

const CONTROL = /[\u0000-\u001f\u007f]/;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OPAQUE_ID_PATTERN = /^[a-f0-9]{64}$/;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const effectiveTaskScopeError = (code = "invalid_effective_task_scope_request", message = "Invalid effective task scope request.") =>
  Object.assign(new Error(message), { code });

function assertRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw effectiveTaskScopeError("invalid_record", "Expected record object.");
  }
}

function assertAllowedFields(obj, allowed) {
  const keys = Object.keys(obj);
  if (keys.some((k) => !allowed.includes(k))) {
    throw effectiveTaskScopeError("unexpected_field", "Unexpected field in record.");
  }
}

function boundedText(value, max, required = false) {
  if (value === undefined || value === null) {
    if (required) throw effectiveTaskScopeError("missing_required_text");
    return "";
  }
  if (typeof value !== "string") throw effectiveTaskScopeError("invalid_text_type");
  if (value.length > max || CONTROL.test(value)) throw effectiveTaskScopeError("text_bounds_exceeded");
  if (required && value.trim().length === 0) throw effectiveTaskScopeError("empty_required_text");
  return value;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Shared request normalizer. Create intents are denied by default: only a caller that
 * passes `{ allowCreateIntent: true }` (strictly `=== true`; today only the pure composer)
 * gets create normalization. Every other caller (including the HTTP route) routes any
 * operationIntent through the delete normalizer, which refuses kind "create" with
 * `invalid_delete_intent` exactly like base 95ea609.
 */
export function normalizeEffectiveTaskScopeRequest(input, options) {
  const allowCreateIntent = options?.allowCreateIntent === true;
  input = materializeBoundedJsonData(input);
  const invalid = () => effectiveTaskScopeError("invalid_effective_task_scope_request", "Invalid bounded effective task scope request.");
  assertRecord(input);

  const allowed = ["task", "projectId", "worktree", "expectedRevision", "includeTests", "changeSemantics", "operationIntent", "limits"];
  assertAllowedFields(input, allowed);

  if (!Object.hasOwn(input, "task") || !Object.hasOwn(input, "projectId") ||
      !Object.hasOwn(input, "worktree") || !Object.hasOwn(input, "expectedRevision") ||
      !Object.hasOwn(input, "includeTests")) {
    throw invalid();
  }

  validateProjectId(input.projectId);

  // task
  assertRecord(input.task);
  const taskAllowed = ["id", "title", "paths", "symbols"];
  assertAllowedFields(input.task, taskAllowed);
  const taskId = input.task.id !== undefined ? boundedText(input.task.id, 128) : null;
  if (taskId === null || taskId.trim().length === 0) throw invalid();
  const title = boundedText(input.task.title, 200, true);
  if (!Array.isArray(input.task.paths) || input.task.paths.length < 1 || input.task.paths.length > 32) throw invalid();
  // validate via normalizeImpactPaths + reject spelling change (no repair)
  const rawPaths = input.task.paths;
  for (const p of rawPaths) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 1024 || CONTROL.test(p) ||
        p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p) || /^\s/.test(p)) {
      throw invalid();
    }
    let n;
    try { n = normalizeImpactPaths([p])[0]; } catch { throw invalid(); }
    if (n !== p) throw invalid();
  }
  const paths = normalizeImpactPaths(rawPaths); // canonical sorted deduped; spelling already equal
  if (paths.length === 0 || paths.length > 32) throw invalid();
  let symbols = [];
  if (input.task.symbols !== undefined) {
    if (!Array.isArray(input.task.symbols) || input.task.symbols.length > 8) throw invalid();
    symbols = [...new Set(input.task.symbols.map((s) => boundedText(s, 128, true)))].sort(compareStrings);
  }

  // worktree
  assertRecord(input.worktree);
  assertAllowedFields(input.worktree, ["rootId", "relativePath"]);
  const rootId = boundedText(input.worktree.rootId, 128, true);
  const relative = validateRelativeProjectPath(input.worktree.relativePath);
  if (!relative.valid || relative.relativePath !== input.worktree.relativePath) throw invalid();
  const worktree = { rootId, relativePath: relative.relativePath };

  // expectedRevision - accept terminal statuses for not_evaluated paths
  assertRecord(input.expectedRevision);
  const revAllowed = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
  assertAllowedFields(input.expectedRevision, revAllowed);
  const revStatus = boundedText(input.expectedRevision.status, 32, true);
  if (!["available", "unavailable", "unborn", "not_git"].includes(revStatus)) throw invalid();
  // accept explicit null for commitSha/dirty/isLinked on terminal observations (truthful unknown)
  let commitSha;
  const rawSha = input.expectedRevision.commitSha;
  if (rawSha === null || rawSha === undefined) {
    if (revStatus === "available") throw invalid();
    commitSha = null;
  } else {
    commitSha = boundedText(rawSha, 64, true);
    if (!SHA_PATTERN.test(commitSha)) throw invalid();
  }
  let branch = input.expectedRevision.branch;
  if (branch !== null && branch !== undefined) branch = boundedText(branch, 512, true);
  let dirty = input.expectedRevision.dirty;
  if (dirty === null || dirty === undefined) {
    if (revStatus === "available") throw invalid();
    dirty = null;
  } else if (typeof dirty !== "boolean") {
    throw invalid();
  }
  let isLinkedWorktree = input.expectedRevision.isLinkedWorktree;
  if (isLinkedWorktree === null || isLinkedWorktree === undefined) {
    if (revStatus === "available") throw invalid();
    isLinkedWorktree = null;
  } else if (typeof isLinkedWorktree !== "boolean") {
    throw invalid();
  }
  let repositoryId = null;
  let worktreeId = null;
  if (Object.hasOwn(input.expectedRevision, "repositoryId") || Object.hasOwn(input.expectedRevision, "worktreeId")) {
    if (!Object.hasOwn(input.expectedRevision, "repositoryId") || !Object.hasOwn(input.expectedRevision, "worktreeId")) throw invalid();
    repositoryId = boundedText(input.expectedRevision.repositoryId, 64, true);
    worktreeId = boundedText(input.expectedRevision.worktreeId, 64, true);
    if (!OPAQUE_ID_PATTERN.test(repositoryId) || !OPAQUE_ID_PATTERN.test(worktreeId)) throw invalid();
  }
  const expectedRevision = {
    status: revStatus,
    commitSha,
    branch,
    dirty,
    isLinkedWorktree,
    ...(repositoryId ? { repositoryId, worktreeId } : {})
  };

  // includeTests
  if (typeof input.includeTests !== "boolean") throw invalid();

  // changeSemantics optional
  let changeSemantics = undefined;
  if (Object.hasOwn(input, "changeSemantics")) {
    if (input.changeSemantics === null || input.changeSemantics === undefined) {
      // omission
    } else {
      assertRecord(input.changeSemantics);
      assertAllowedFields(input.changeSemantics, ["category"]);
      const cat = input.changeSemantics.category;
      if (typeof cat !== "string" || !CHANGE_SEMANTICS_CATEGORIES.includes(cat)) throw invalid();
      changeSemantics = { category: cat };
    }
  }

  // limits optional
  let limits = undefined;
  if (Object.hasOwn(input, "limits")) {
    assertRecord(input.limits);
    assertAllowedFields(input.limits, ["compactBytes"]);
    if (Object.hasOwn(input.limits, "compactBytes")) {
      const cb = input.limits.compactBytes;
      if (typeof cb !== "number" || !Number.isFinite(cb) || !Number.isSafeInteger(cb) || cb < 1 || cb > 131072) throw invalid();
      limits = { compactBytes: cb };
    }
  }

  return {
    task: { id: taskId, title, paths, symbols },
    projectId: input.projectId,
    worktree,
    expectedRevision,
    includeTests: input.includeTests,
    ...(changeSemantics ? { changeSemantics } : {}),
    ...(Object.hasOwn(input, "operationIntent")
      ? {
          operationIntent:
            allowCreateIntent
            && input.operationIntent
            && typeof input.operationIntent === "object"
            && !Array.isArray(input.operationIntent)
            && input.operationIntent.kind === "create"
              ? normalizeCreateIntent(input.operationIntent)
              : normalizeDeleteIntent(input.operationIntent)
        }
      : {}),
    ...(limits ? { limits } : {})
  };
}

function normalizeDeleteIntent(intent) {
  const invalid = () => effectiveTaskScopeError("invalid_delete_intent");
  try {
    assertRecord(intent);
    assertAllowedFields(intent, ["kind", "targets"]);
    if (intent.kind !== "delete" || !Array.isArray(intent.targets) || intent.targets.length === 0) throw invalid();
    if (intent.targets.length > MAX_RAW_PATHS_BEFORE_DEDUPE) throw effectiveTaskScopeError("scope_budget_exceeded");
    const paths = intent.targets.map(target => {
      assertRecord(target);
      assertAllowedFields(target, ["oldPath", "newPath"]);
      if (!Object.hasOwn(target, "oldPath") || !Object.hasOwn(target, "newPath") || target.newPath !== null) throw invalid();
      const path = target.oldPath;
      if (typeof path !== "string" || path.length === 0 || path.length > 1024 || CONTROL.test(path) ||
          normalizeImpactPaths([path])[0] !== path) throw invalid();
      return path;
    });
    return { kind: "delete", targets: [...new Set(paths)].sort(compareStrings).map(oldPath => ({ oldPath, newPath: null })) };
  } catch (error) {
    if (error.code === "scope_budget_exceeded") throw error;
    throw invalid();
  }
}


function normalizeCreateIntent(intent) {
  const invalid = () => effectiveTaskScopeError("invalid_create_intent");
  try {
    assertRecord(intent);
    assertAllowedFields(intent, ["kind", "targets"]);
    if (intent.kind !== "create" || !Array.isArray(intent.targets) || intent.targets.length === 0) throw invalid();
    if (intent.targets.length > MAX_RAW_PATHS_BEFORE_DEDUPE) throw effectiveTaskScopeError("scope_budget_exceeded");
    const paths = intent.targets.map(target => {
      assertRecord(target);
      assertAllowedFields(target, ["oldPath", "newPath"]);
      if (!Object.hasOwn(target, "oldPath") || !Object.hasOwn(target, "newPath") || target.oldPath !== null) throw invalid();
      const path = target.newPath;
      if (typeof path !== "string" || path.length === 0 || path.length > 1024 || CONTROL.test(path) ||
          normalizeImpactPaths([path])[0] !== path) throw invalid();
      return path;
    });
    return { kind: "create", targets: [...new Set(paths)].sort(compareStrings).map(newPath => ({ oldPath: null, newPath })) };
  } catch (error) {
    if (error.code === "scope_budget_exceeded") throw error;
    throw invalid();
  }
}

/** Project materialized, retained old-file proof after the composer's existing gates. */
export function bindDeleteIntent(intent, paths, pack, impact) {
  const mismatch = () => effectiveTaskScopeError("delete_source_binding_mismatch");
  const record = value => value && typeof value === "object" && !Array.isArray(value);
  const text = value => typeof value === "string" && value.length > 0 && value.length <= 128 && !CONTROL.test(value);
  const hash = value => typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
  const literal = value => {
    try { return typeof value === "string" && value.length <= 1024 && normalizeImpactPaths([value])[0] === value; }
    catch { return false; }
  };
  const reasons = new Set();
  const add = code => reasons.add(code);
  const completeness = value => {
    if (!record(value) || IMPACT_COMPLETENESS_DIMENSIONS.some(key => !Array.isArray(value[key]))) throw mismatch();
    if (IMPACT_COMPLETENESS_DIMENSIONS.some(key => value[key].length > IMPACT_COMPLETENESS_REASONS.length)) {
      throw effectiveTaskScopeError("scope_budget_exceeded");
    }
    return normalizeImpactCompleteness(value);
  };
  const observation = value => {
    if (!record(value) || typeof value.incomplete !== "boolean" || !text(value.digestCoverage)) throw mismatch();
    return { incomplete: value.incomplete, digestCoverage: value.digestCoverage };
  };
  const provider = value => {
    if (!record(value) || !text(value.id) || !text(value.version)) throw mismatch();
    return { id: value.id, version: value.version };
  };
  const coverage = value => {
    if (!record(value) || Object.keys(value).some(key => !["observed", "covered", "uncovered"].includes(key)) ||
        ["observed", "covered", "uncovered"].some(key => !Array.isArray(value[key]) || value[key].some(v => !text(v)))) throw mismatch();
    return Object.fromEntries(["observed", "covered", "uncovered"].map(key => [key, [...value[key]]]));
  };
  try {
    if (JSON.stringify(intent.targets.map(target => target.oldPath)) !== JSON.stringify(paths)) {
      throw effectiveTaskScopeError("delete_intent_target_mismatch");
    }
    const sections = {};
    const maxima = { ...Object.fromEntries(Object.entries(TASK_CONTEXT_LIMITS).filter(([key]) => key !== "maxBytes").map(([key, limits]) => [key, limits[1]])), task: 1, policy: 4 };
    const sectionStatuses = ["available", "empty", "partial", "omitted", "not_analyzed"];
    for (const name of Object.keys(pack.sections).sort(compareStrings)) {
      const section = pack.sections[name];
      if (!Object.hasOwn(maxima, name) || !record(section) || !sectionStatuses.includes(section.status) ||
          typeof section.truncated !== "boolean" || !Number.isSafeInteger(section.limit) || section.limit < 0 || !Array.isArray(section.items)) throw mismatch();
      if (section.limit > maxima[name] || section.items.length > section.limit || section.items.length > maxima[name]) {
        throw effectiveTaskScopeError("scope_budget_exceeded");
      }
      if (Object.hasOwn(pack.limits || {}, name)) {
        const limit = pack.limits[name];
        if (!Number.isSafeInteger(limit) || limit < 0) throw mismatch();
        if (limit > maxima[name] || section.limit > limit || section.items.length > limit) throw effectiveTaskScopeError("scope_budget_exceeded");
      }
      const provenance = section.provenance;
      if (!record(provenance) || provenance.projectId !== pack.projectId || provenance.revisionRef !== "revision" ||
          !text(provenance.producer) || !["canonical_fact", "derived_analysis", "untrusted_repository_text", "untrusted_external_analysis", "untrusted_request_text", "trusted_policy"].includes(provenance.trust)) throw mismatch();
      if (name === "files" && (provenance.producer !== "context-source-observation" || provenance.trust !== "untrusted_repository_text")) throw mismatch();
      if (["empty", "omitted", "not_analyzed"].includes(section.status) && section.items.length > 0) throw mismatch();
      sections[name] = { status: section.status, limit: section.limit, truncated: section.truncated };
      if (section.truncated) add(`delete_context_section_${name}_truncated`);
      if (["partial", "omitted", "not_analyzed"].includes(section.status)) add(`delete_context_section_${name}_${section.status}`);
    }
    const files = pack.sections.files;
    const sourcesByPath = new Map();
    for (const file of files?.items || []) {
      if (!record(file) || !literal(file.path) || sourcesByPath.has(file.path)) throw mismatch();
      const provenance = file.provenance;
      if (!record(provenance) || !record(provenance.source) || provenance.source.path !== file.path || !hash(provenance.source.sha256)) throw mismatch();
      sourcesByPath.set(file.path, file);
    }
    if (impact.targets.length > MAX_RAW_PATHS_BEFORE_DEDUPE) throw effectiveTaskScopeError("scope_budget_exceeded");
    const targetsByPath = new Map();
    const targets = [];
    let unevaluated = false;
    let missingSource = !files || ["empty", "omitted", "not_analyzed"].includes(files.status);
    for (const target of impact.targets) {
      if (!record(target) || !literal(target.originPath) || targetsByPath.has(target.originPath)) throw mismatch();
      const status = normalizeImpactStatus(target.status);
      const findingState = normalizeImpactFindingState(target.findingState);
      const comp = completeness(target.completeness);
      if (findingState === "not_evaluated") unevaluated = true;
      if (target.targetSource == null) missingSource = true;
      else if (!record(target.targetSource) || target.targetSource.path !== target.originPath || !hash(target.targetSource.hash)) throw mismatch();
      targetsByPath.set(target.originPath, target);
      targets.push({ originPath: target.originPath, status, findingState, completeness: comp });
      if (status !== "available") add(`delete_impact_target_${status}`);
      for (const dimension of IMPACT_COMPLETENESS_DIMENSIONS) for (const cause of comp[dimension]) add(`delete_impact_${dimension}_${cause}`);
    }
    const sources = [];
    for (const oldPath of paths) {
      const file = sourcesByPath.get(oldPath);
      const target = targetsByPath.get(oldPath);
      if (!target) throw effectiveTaskScopeError("delete_intent_target_mismatch");
      if (!file) { missingSource = true; continue; }
      const p = file.provenance;
      if (!["canonical_fact", "untrusted_repository_text"].includes(p.trust) || p.reason !== "task_path") throw mismatch();
      if (!target.targetSource) continue;
      if (p.source.sha256 !== target.targetSource.hash) throw mismatch();
      sources.push({ oldPath, context: { source: { path: p.source.path, sha256: p.source.sha256 }, trust: p.trust, reason: p.reason },
        impact: { path: target.targetSource.path, hash: target.targetSource.hash } });
    }
    const contextObservation = observation(pack.observation);
    const impactObservation = observation(impact.observation);
    const at = impact.affectedTests;
    if (!record(at)) throw mismatch();
    // Retained records must obey both hard maxima and any supplied producer budget.
    const bound = (count, name) => {
      const supplied = impact.limits?.[name];
      if (supplied !== undefined && (!Number.isSafeInteger(supplied) || supplied < 1)) throw mismatch();
      if (count > IMPACT_LIMITS[name].max || supplied > IMPACT_LIMITS[name].max || count > supplied) {
        throw effectiveTaskScopeError("scope_budget_exceeded");
      }
    };
    if (!Array.isArray(impact.affectedFiles) || !Array.isArray(at.candidates)) throw mismatch();
    bound(impact.affectedFiles.length, "affectedFiles");
    bound(at.candidates.length, "affectedTests");
    let rawWitnessCount = 0;
    for (const item of [...impact.affectedFiles, ...at.candidates]) {
      if (!record(item) || !Array.isArray(item.origins)) throw mismatch();
      bound(item.origins.length, "originWitnessesPerItem");
      rawWitnessCount += item.origins.length;
    }
    bound(rawWitnessCount, "originWitnessRecords");
    const affectedTests = { status: normalizeImpactStatus(at.status, { section: true }) };
    if (Object.hasOwn(at, "findingState")) affectedTests.findingState = normalizeImpactFindingState(at.findingState);
    if (Object.hasOwn(at, "completeness")) affectedTests.completeness = completeness(at.completeness);
    const comp = completeness(impact.completeness);
    const providers = { context: provider(pack.analysis.provider), impact: provider(impact.provider) };
    const coverages = { context: coverage(pack.analysis.coverage), impact: coverage(impact.coverage) };
    const contextStatus = normalizeImpactStatus(pack.analysis.status);
    if (contextStatus !== "available") add(`delete_context_provider_${contextStatus}`);
    if (coverages.context.uncovered.length) add("delete_context_coverage_uncovered");
    if (coverages.impact.uncovered.length) add("delete_impact_coverage_uncovered");
    if (contextObservation.incomplete) add("delete_context_observation_incomplete");
    if (impactObservation.incomplete) add("delete_impact_observation_incomplete");
    for (const dimension of IMPACT_COMPLETENESS_DIMENSIONS) {
      for (const cause of [...comp[dimension], ...(affectedTests.completeness?.[dimension] || [])]) add(`delete_impact_${dimension}_${cause}`);
    }
    if (affectedTests.status !== "available") add(`delete_affected_tests_${affectedTests.status}`);
    if (affectedTests.findingState === "not_evaluated") add("delete_affected_tests_not_evaluated");
    if (unevaluated) return { notEvaluated: "delete_target_not_evaluated" };
    if (missingSource) return { notEvaluated: "delete_source_not_evaluated" };
    return { operationIntent: { kind: "delete", provenance: "task_declaration", targets: intent.targets,
      evidence: { sources, context: { observation: contextObservation, sections },
        impact: { observation: impactObservation, targets: targets.sort((a, b) => compareStrings(a.originPath, b.originPath)), affectedTests, completeness: comp },
        providers, coverage: coverages } }, reasons: [...reasons].sort(compareStrings) };
  } catch (error) {
    if (["scope_budget_exceeded", "delete_intent_target_mismatch"].includes(error.code)) throw error;
    throw mismatch();
  }
}

/**
 * Validate create-intent proof and return a fail-closed verdict (policy step4-foundation-4).
 * Per declared newPath: any positive byte observation (Context files item or non-null Impact
 * targetSource) is EXISTS; otherwise UNKNOWN. PROVEN-ABSENT needs a positive absence witness
 * that no current pure input supplies, so it is unreachable and create never yields WRITE or
 * operationIntent. Whole-proof structural/budget validation runs before any verdict.
 * Precedence: bind-stage rejection, then any EXISTS => create_destination_exists, then any
 * UNKNOWN => create_destination_absence_not_proven.
 */
export function bindCreateIntent(intent, paths, pack, impact) {
  const mismatch = () => effectiveTaskScopeError("create_source_binding_mismatch");
  const record = value => value && typeof value === "object" && !Array.isArray(value);
  const text = value => typeof value === "string" && value.length > 0 && value.length <= 128 && !CONTROL.test(value);
  const hash = value => typeof value === "string" && OPAQUE_ID_PATTERN.test(value);
  const literal = value => {
    try { return typeof value === "string" && value.length <= 1024 && normalizeImpactPaths([value])[0] === value; }
    catch { return false; }
  };
  const completeness = value => {
    if (!record(value) || IMPACT_COMPLETENESS_DIMENSIONS.some(key => !Array.isArray(value[key]))) throw mismatch();
    if (IMPACT_COMPLETENESS_DIMENSIONS.some(key => value[key].length > IMPACT_COMPLETENESS_REASONS.length)) {
      throw effectiveTaskScopeError("scope_budget_exceeded");
    }
    return normalizeImpactCompleteness(value);
  };
  const observation = value => {
    if (!record(value) || typeof value.incomplete !== "boolean" || !text(value.digestCoverage)) throw mismatch();
  };
  const provider = value => {
    if (!record(value) || !text(value.id) || !text(value.version)) throw mismatch();
  };
  const coverage = value => {
    if (!record(value) || Object.keys(value).some(key => !["observed", "covered", "uncovered"].includes(key)) ||
        ["observed", "covered", "uncovered"].some(key => !Array.isArray(value[key]) || value[key].some(v => !text(v)))) throw mismatch();
  };
  try {
    if (JSON.stringify(intent.targets.map(target => target.newPath)) !== JSON.stringify(paths)) {
      throw effectiveTaskScopeError("create_intent_target_mismatch");
    }
    const maxima = { ...Object.fromEntries(Object.entries(TASK_CONTEXT_LIMITS).filter(([key]) => key !== "maxBytes").map(([key, limits]) => [key, limits[1]])), task: 1, policy: 4 };
    const sectionStatuses = ["available", "empty", "partial", "omitted", "not_analyzed"];
    for (const name of Object.keys(pack.sections).sort(compareStrings)) {
      const section = pack.sections[name];
      if (!Object.hasOwn(maxima, name) || !record(section) || !sectionStatuses.includes(section.status) ||
          typeof section.truncated !== "boolean" || !Number.isSafeInteger(section.limit) || section.limit < 0 || !Array.isArray(section.items)) throw mismatch();
      if (section.limit > maxima[name] || section.items.length > section.limit || section.items.length > maxima[name]) {
        throw effectiveTaskScopeError("scope_budget_exceeded");
      }
      if (Object.hasOwn(pack.limits || {}, name)) {
        const limit = pack.limits[name];
        if (!Number.isSafeInteger(limit) || limit < 0) throw mismatch();
        if (limit > maxima[name] || section.limit > limit || section.items.length > limit) throw effectiveTaskScopeError("scope_budget_exceeded");
      }
      const provenance = section.provenance;
      if (!record(provenance) || provenance.projectId !== pack.projectId || provenance.revisionRef !== "revision" ||
          !text(provenance.producer) || !["canonical_fact", "derived_analysis", "untrusted_repository_text", "untrusted_external_analysis", "untrusted_request_text", "trusted_policy"].includes(provenance.trust)) throw mismatch();
      if (name === "files" && (provenance.producer !== "context-source-observation" || provenance.trust !== "untrusted_repository_text")) throw mismatch();
      if (["empty", "omitted", "not_analyzed"].includes(section.status) && section.items.length > 0) throw mismatch();
    }
    const files = pack.sections.files;
    const sourcesByPath = new Map();
    for (const file of files?.items || []) {
      if (!record(file) || !literal(file.path) || sourcesByPath.has(file.path)) throw mismatch();
      const provenance = file.provenance;
      if (!record(provenance) || !record(provenance.source) || provenance.source.path !== file.path || !hash(provenance.source.sha256)) throw mismatch();
      sourcesByPath.set(file.path, file);
    }
    if (impact.targets.length > MAX_RAW_PATHS_BEFORE_DEDUPE) throw effectiveTaskScopeError("scope_budget_exceeded");
    const targetsByPath = new Map();
    for (const target of impact.targets) {
      if (!record(target) || !literal(target.originPath) || targetsByPath.has(target.originPath)) throw mismatch();
      normalizeImpactStatus(target.status);
      normalizeImpactFindingState(target.findingState);
      completeness(target.completeness);
      if (target.targetSource != null &&
          (!record(target.targetSource) || target.targetSource.path !== target.originPath || !hash(target.targetSource.hash))) throw mismatch();
      targetsByPath.set(target.originPath, target);
    }
    // Per-path destination state: EXISTS on any positive observation, else UNKNOWN.
    let exists = false;
    let unknown = false;
    for (const newPath of paths) {
      const file = sourcesByPath.get(newPath);
      const target = targetsByPath.get(newPath);
      if (!target) throw effectiveTaskScopeError("create_intent_target_mismatch");
      if (file) {
        const p = file.provenance;
        if (!["canonical_fact", "untrusted_repository_text"].includes(p.trust) || p.reason !== "task_path") throw mismatch();
        if (target.targetSource && p.source.sha256 !== target.targetSource.hash) throw mismatch();
      }
      if (file || target.targetSource) exists = true;
      else unknown = true;
    }
    observation(pack.observation);
    observation(impact.observation);
    const at = impact.affectedTests;
    if (!record(at)) throw mismatch();
    // Retained records must obey both hard maxima and any supplied producer budget.
    const bound = (count, name) => {
      const supplied = impact.limits?.[name];
      if (supplied !== undefined && (!Number.isSafeInteger(supplied) || supplied < 1)) throw mismatch();
      if (count > IMPACT_LIMITS[name].max || supplied > IMPACT_LIMITS[name].max || count > supplied) {
        throw effectiveTaskScopeError("scope_budget_exceeded");
      }
    };
    if (!Array.isArray(impact.affectedFiles) || !Array.isArray(at.candidates)) throw mismatch();
    bound(impact.affectedFiles.length, "affectedFiles");
    bound(at.candidates.length, "affectedTests");
    let rawWitnessCount = 0;
    for (const item of [...impact.affectedFiles, ...at.candidates]) {
      if (!record(item) || !Array.isArray(item.origins)) throw mismatch();
      bound(item.origins.length, "originWitnessesPerItem");
      rawWitnessCount += item.origins.length;
    }
    bound(rawWitnessCount, "originWitnessRecords");
    normalizeImpactStatus(at.status, { section: true });
    if (Object.hasOwn(at, "findingState")) normalizeImpactFindingState(at.findingState);
    if (Object.hasOwn(at, "completeness")) completeness(at.completeness);
    completeness(impact.completeness);
    provider(pack.analysis.provider);
    provider(impact.provider);
    coverage(pack.analysis.coverage);
    coverage(impact.coverage);
    normalizeImpactStatus(pack.analysis.status);
    if (exists) return { notEvaluated: "create_destination_exists" };
    if (unknown) return { notEvaluated: "create_destination_absence_not_proven" };
    // PROVEN-ABSENT is unreachable under step4-foundation-4 (no absence witness input).
    return { notEvaluated: "create_destination_absence_not_proven" };
  } catch (error) {
    if (["scope_budget_exceeded", "create_intent_target_mismatch"].includes(error.code)) throw error;
    throw mismatch();
  }
}

export function resolveChangeSemantics(declared, paths) {
  const inferred = inferFromPaths(paths);
  if (!declared) {
    return { declared: null, inferred, effective: inferred, provenance: "path_inference", reasons: [] };
  }
  const dec = declared.category;
  if (dec === "public_signature" || dec === "interface_contract" || dec === "schema_migration" || dec === "unknown") {
    return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
  }
  if (dec === "local_implementation") {
    if (inferred === "unknown") {
      return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
    }
    if (inferred === "documentation" || inferred === "test_only") {
      return { declared: dec, inferred, effective: "unknown", provenance: "task_declaration", reasons: ["declaration_path_disagreement"] };
    }
    return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
  }
  // declared doc or test_only
  if ((dec === "documentation" && inferred === "documentation") || (dec === "test_only" && inferred === "test_only")) {
    return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
  }
  return { declared: dec, inferred, effective: "unknown", provenance: "task_declaration", reasons: ["declaration_path_disagreement"] };
}

function inferFromPaths(paths) {
  if (paths.length === 0) return "unknown";
  // docs: case-sensitive, only exact lowercase extensions
  const allDocs = paths.every((p) => DOCUMENTATION_EXTENSIONS.some((ext) => p.endsWith(ext)));
  if (allDocs) return "documentation";
  // reuse existing Impact/Context test path predicate (no extra escape)
  const isTestPred = (p) => /\.(?:tsx?|jsx?|cs|py|go|rs|java)$/i.test(p)
    && /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.|Tests?\.cs$|(?:^|\/)test_|_test\.go$/i.test(p);
  const allTest = paths.every(isTestPred);
  if (allTest) return "test_only";
  return "unknown";
}

export function normalizeEffectiveTaskScopeEvidence(pack, impact) {
  ({ pack, impact } = materializeBoundedJsonData({ pack, impact }));
  // basic shape checks; full binding later in composer
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    throw effectiveTaskScopeError("invalid_pack", "Pack must be accepted task-context-v1");
  }
  if (!impact || typeof impact !== "object" || Array.isArray(impact)) {
    throw effectiveTaskScopeError("invalid_impact", "Impact must be accepted impact-v2");
  }
  if (pack.schemaVersion !== 1 || pack.analysisVersion !== "task-context-v1") {
    throw effectiveTaskScopeError("invalid_pack", "Pack must be accepted task-context-v1");
  }
  if (impact.schemaVersion !== 1 || impact.analysisVersion !== "impact-v2") {
    throw effectiveTaskScopeError("invalid_impact", "Impact must be accepted impact-v2");
  }
  return { pack, impact };
}

export const MAX_RAW_PATHS_BEFORE_DEDUPE = 32;
export const MAX_SYMBOLS = 8;
export const MAX_CLASSIFIED_TARGETS = 320;
export const MAX_ORIGIN_WITNESS_REFS = 1024;
export const MAX_RESOLVER_REASONS = 128;
export const MAX_NESTING = 32;
export const MAX_VISITED_VALUES = 20000;
export const MAX_COMPACT_INPUT = 327680;
export const MAX_COMPACT_OUTPUT = 131072;

export function checkInputBudget(request, pack, impact, symbolTargetCompletenessWitness) {
  // Callers pass materialized data. Reapply the same boundary for direct callers.
  // Optional 4th arg: when !== undefined, include witness in total compact input budget.
  const inputObj = symbolTargetCompletenessWitness !== undefined
    ? { request, pack, impact, symbolTargetCompletenessWitness }
    : { request, pack, impact };
  const safe = materializeBoundedJsonData(inputObj);
  // pack and impact each <=131072 (no separate witness sub-cap)
  const packBytes = Buffer.byteLength(JSON.stringify(safe.pack), "utf8");
  const impactBytes = Buffer.byteLength(JSON.stringify(safe.impact), "utf8");
  if (packBytes > 131072 || impactBytes > 131072) {
    throw effectiveTaskScopeError("scope_budget_exceeded", "Pack or Impact exceeds 131072 compact bytes.");
  }
  const reqStr = JSON.stringify(safe);
  if (Buffer.byteLength(reqStr, "utf8") > MAX_COMPACT_INPUT) {
    throw effectiveTaskScopeError("scope_budget_exceeded", "Input exceeds compactBytes budget.");
  }
}

export function materializeBoundedJsonData(root) {
  let count = 0;
  const ancestors = new Set();
  function walk(node, depth) {
    if (depth > MAX_NESTING) throw effectiveTaskScopeError("scope_budget_exceeded");
    if (++count > MAX_VISITED_VALUES) throw effectiveTaskScopeError("scope_budget_exceeded");
    if (node === null || typeof node === "string" || typeof node === "boolean" ||
        (typeof node === "number" && Number.isFinite(node))) return node;
    // Native detection never invokes traps, including for revoked Proxies.
    // Every visited value must pass this gate before any container reflection.
    if (utilTypes.isProxy(node)) throw effectiveTaskScopeError("invalid_record");
    if (typeof node !== "object") throw effectiveTaskScopeError("invalid_record");
    const array = Array.isArray(node);
    const prototype = Object.getPrototypeOf(node);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw effectiveTaskScopeError("invalid_record");
    }
    if (ancestors.has(node)) throw effectiveTaskScopeError("invalid_record");
    ancestors.add(node);
    const descriptors = Object.getOwnPropertyDescriptors(node);
    // Null prototype prevents inherited fields from becoming required-field data.
    const result = array ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === "symbol") throw effectiveTaskScopeError("invalid_record");
      const desc = descriptors[key];
      if (!Object.hasOwn(desc, "value")) throw effectiveTaskScopeError("invalid_record");
      if (array && key === "length") continue;
      if (!desc.enumerable) throw effectiveTaskScopeError("invalid_record");
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= descriptors.length.value)) {
        throw effectiveTaskScopeError("invalid_record");
      }
      Object.defineProperty(result, key, { value: walk(desc.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (array && (Reflect.ownKeys(descriptors).length - 1 !== descriptors.length.value)) {
      throw effectiveTaskScopeError("invalid_record");
    }
    ancestors.delete(node);
    return result;
  }
  return walk(root, 0);
}

export function buildEmptyCategory(status = "not_evaluated", reasons = []) {
  return { status, items: [], reasons: reasons.length ? [...reasons].sort(compareStrings) : [], truncated: false };
}


/** Admitted symbol-target completeness witness identity (consume-only; no producer call). */
export const SYMBOL_TARGET_COMPLETENESS_WITNESS_KIND = "symbol-target-completeness-witness";
export const SYMBOL_TARGET_COMPLETENESS_WITNESS_PRODUCER_IDENTITY =
  "hermes-nexus-in-repo-symbol-target-completeness-witness";
export const SYMBOL_TARGET_COMPLETENESS_WITNESS_VERSION = "symbol-target-completeness-witness-v1";
export const SYMBOL_TARGET_ADMITTED_DOMAIN =
  "typescript-javascript-direct-declarations-tsjs-direct-declarations-1";
export const SYMBOL_TARGET_A1_ENTRY_POINT = "resolveTypeScriptDeclarationEvidence";
export const SYMBOL_TARGET_A1_SCHEMA_VERSION = 1;
export const SYMBOL_TARGET_A1_ANALYSIS_VERSION = "symbol-resolution-evidence-v1";
export const SYMBOL_TARGET_A1_POLICY_VERSION = "tsjs-direct-declarations-1";

function isWitnessPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sameSortedStringArrays(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const a = [...left].sort(compareStrings);
  const b = [...right].sort(compareStrings);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function a1CitationAdmitted(citation) {
  return isWitnessPlainObject(citation)
    && citation.entryPoint === SYMBOL_TARGET_A1_ENTRY_POINT
    && citation.schemaVersion === SYMBOL_TARGET_A1_SCHEMA_VERSION
    && citation.analysisVersion === SYMBOL_TARGET_A1_ANALYSIS_VERSION
    && citation.policyVersion === SYMBOL_TARGET_A1_POLICY_VERSION;
}

const SYMBOL_TARGET_EFFECTIVE_OUTCOMES = new Set(["unique", "not_found", "ambiguous"]);
const SYMBOL_TARGET_EFFECTIVE_A1_STATUSES = new Set(["resolved_unique", "not_found", "ambiguous"]);
const SYMBOL_TARGET_OUTCOME_TO_RUN_STATUS = Object.freeze({
  unique: "resolved_unique",
  not_found: "not_found",
  ambiguous: "ambiguous"
});
const SYMBOL_TARGET_PATH_COVERAGE_STATUSES = new Set(["covered", "uncovered_language", "unevaluated"]);
const SYMBOL_TARGET_SHA256_HEX = /^[a-f0-9]{64}$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Consume-side effectivelyEvaluated (data-only; no A1 call).
 * r2 Hole 3: evidenceComplete===true must cohere with runStatus, outcome↔runStatus,
 * and completeness.{source,parse,enumeration} when completeness is a plain object.
 * r3 Hole 2: if completeness is PRESENT and not a plain object → fail (do not skip).
 */
export function isSymbolTargetEffectivelyEvaluated(evaluation) {
  if (!isWitnessPlainObject(evaluation)) return false;
  if (!SYMBOL_TARGET_EFFECTIVE_OUTCOMES.has(evaluation.outcome)) return false;
  const citation = evaluation.a1Citation;
  if (!isWitnessPlainObject(citation) || citation.evidenceComplete !== true) return false;
  if (!SYMBOL_TARGET_EFFECTIVE_A1_STATUSES.has(citation.runStatus)) return false;
  if (SYMBOL_TARGET_OUTCOME_TO_RUN_STATUS[evaluation.outcome] !== citation.runStatus) return false;
  if (Object.prototype.hasOwnProperty.call(citation, "completeness")) {
    if (!isWitnessPlainObject(citation.completeness)) return false;
    if (
      citation.completeness.source !== "complete"
      || citation.completeness.parse !== "complete"
      || citation.completeness.enumeration !== "complete"
    ) {
      return false;
    }
  }
  return true;
}

function sortedStringMultisetEqual(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const a = [...left].sort(compareStrings);
  const b = [...right].sort(compareStrings);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function citationFieldsAgree(evalCitation, topCitation) {
  if (!isWitnessPlainObject(evalCitation) || !isWitnessPlainObject(topCitation)) return false;
  const required = [
    "entryPoint",
    "schemaVersion",
    "analysisVersion",
    "policyVersion",
    "name",
    "runStatus",
    "evidenceComplete"
  ];
  for (const field of required) {
    if (evalCitation[field] !== topCitation[field]) return false;
  }
  // Presence-symmetric: declarationId / symbolId (Fix 1)
  for (const field of ["declarationId", "symbolId"]) {
    if (Object.prototype.hasOwnProperty.call(evalCitation, field)
      || Object.prototype.hasOwnProperty.call(topCitation, field)) {
      if (evalCitation[field] !== topCitation[field]) return false;
    }
  }
  // r3 Hole 1: snapshotToken NOT presence-symmetric — compare only when BOTH carry
  const evalHasToken = Object.prototype.hasOwnProperty.call(evalCitation, "snapshotToken");
  const topHasToken = Object.prototype.hasOwnProperty.call(topCitation, "snapshotToken");
  if (evalHasToken && topHasToken && evalCitation.snapshotToken !== topCitation.snapshotToken) {
    return false;
  }
  return true;
}

/**
 * r2/r3 citation snapshotToken ↔ exterior witness.snapshotToken.
 * - Any layer that CARRIES snapshotToken must equal exterior (r2 strength).
 * - When holds===true: detailed evaluations[].a1Citation MUST present nonempty
 *   snapshotToken === exterior (r3 Hole 1).
 * - Summary a1Citations[] MAY omit snapshotToken; if it carries, must === exterior.
 * @returns {string|null} symbol_target_binding_mismatch or null
 */
export function checkSymbolTargetCitationSnapshotReconcile(witness) {
  const exterior = witness.snapshotToken;
  const holdsTrue = witness.completenessHolds === true || witness.uniquenessHolds === true;

  // Detailed eval citations
  if (Array.isArray(witness.evaluations)) {
    for (const evaluation of witness.evaluations) {
      if (!evaluation || !isWitnessPlainObject(evaluation.a1Citation)) {
        if (holdsTrue) return "symbol_target_binding_mismatch";
        continue;
      }
      const citation = evaluation.a1Citation;
      const carries = Object.prototype.hasOwnProperty.call(citation, "snapshotToken");
      if (holdsTrue) {
        if (!isNonEmptyString(citation.snapshotToken) || citation.snapshotToken !== exterior) {
          return "symbol_target_binding_mismatch";
        }
      } else if (carries && citation.snapshotToken !== exterior) {
        return "symbol_target_binding_mismatch";
      }
    }
  }

  // Summary a1Citations — omission OK; carrying layer must equal exterior
  if (Array.isArray(witness.a1Citations)) {
    for (const citation of witness.a1Citations) {
      if (!isWitnessPlainObject(citation)) continue;
      const carries = Object.prototype.hasOwnProperty.call(citation, "snapshotToken");
      if (!carries) continue;
      if (!isNonEmptyString(citation.snapshotToken) || citation.snapshotToken !== exterior) {
        return "symbol_target_binding_mismatch";
      }
    }
  }

  return null;
}

/**
 * Required structure (B). Missing/invalid → symbol_target_evidence_inconsistent.
 * @returns {string|null} reason code or null if OK
 */
export function checkSymbolTargetWitnessStructure(witness) {
  if (!Array.isArray(witness.evaluations) || witness.evaluations.length === 0) {
    return "symbol_target_evidence_inconsistent";
  }
  if (!witness.evaluations.every(isWitnessPlainObject)) {
    return "symbol_target_evidence_inconsistent";
  }
  if (!Array.isArray(witness.pathCoverage) || witness.pathCoverage.length === 0) {
    return "symbol_target_evidence_inconsistent";
  }
  if (!witness.pathCoverage.every(isWitnessPlainObject)) {
    return "symbol_target_evidence_inconsistent";
  }
  if (!isWitnessPlainObject(witness.sourceHashes)) {
    return "symbol_target_evidence_inconsistent";
  }
  const taskPaths = Array.isArray(witness.taskPaths) ? witness.taskPaths : null;
  if (!taskPaths) return "symbol_target_evidence_inconsistent";
  for (const p of taskPaths) {
    const h = witness.sourceHashes[p];
    if (typeof h !== "string" || !SYMBOL_TARGET_SHA256_HEX.test(h)) {
      return "symbol_target_evidence_inconsistent";
    }
  }
  if (!Array.isArray(witness.a1Citations) || witness.a1Citations.length === 0) {
    return "symbol_target_evidence_inconsistent";
  }
  return null;
}

/**
 * Name/eval/citation correspondence (C). Fail → binding_mismatch.
 * @returns {string|null}
 */
export function checkSymbolTargetNameEvalCitationCorrespondence(witness) {
  const requiredNames = witness.requiredNames;
  const evaluations = witness.evaluations;
  const citations = witness.a1Citations;
  const taskPaths = witness.taskPaths;
  if (!Array.isArray(requiredNames) || !Array.isArray(evaluations) || !Array.isArray(citations)) {
    return "symbol_target_binding_mismatch";
  }
  if (evaluations.length !== requiredNames.length) {
    return "symbol_target_binding_mismatch";
  }
  if (citations.length !== requiredNames.length) {
    return "symbol_target_binding_mismatch";
  }
  const evalNames = evaluations.map((e) => e && e.name);
  const citeNames = citations.map((c) => c && c.name);
  if (!sortedStringMultisetEqual(requiredNames, evalNames)) {
    return "symbol_target_binding_mismatch";
  }
  if (!sortedStringMultisetEqual(requiredNames, citeNames)) {
    return "symbol_target_binding_mismatch";
  }
  // exactly one eval per required name (multiset equality + length already implies this
  // when requiredNames has unique entries; still reject duplicate-eval collisions)
  const seenEval = new Set();
  for (const e of evaluations) {
    if (typeof e.name !== "string" || seenEval.has(e.name)) {
      return "symbol_target_binding_mismatch";
    }
    seenEval.add(e.name);
  }
  const citeByName = new Map();
  for (const c of citations) {
    if (typeof c.name !== "string" || citeByName.has(c.name)) {
      return "symbol_target_binding_mismatch";
    }
    citeByName.set(c.name, c);
  }
  const taskPathSet = new Set(Array.isArray(taskPaths) ? taskPaths : []);
  for (const e of evaluations) {
    const top = citeByName.get(e.name);
    if (!citationFieldsAgree(e.a1Citation, top)) {
      return "symbol_target_binding_mismatch";
    }
    const pathScope = e.pathScope;
    if (!Array.isArray(pathScope)) {
      return "symbol_target_binding_mismatch";
    }
    for (const p of pathScope) {
      if (typeof p !== "string" || !taskPathSet.has(p)) {
        return "symbol_target_binding_mismatch";
      }
    }
  }
  return null;
}

/**
 * Path coverage correspondence (D). Path multiset fail → binding_mismatch;
 * invalid status vocabulary → evidence_inconsistent.
 * @returns {string|null}
 */
export function checkSymbolTargetPathCoverageCorrespondence(witness) {
  const taskPaths = witness.taskPaths;
  const pathCoverage = witness.pathCoverage;
  if (!Array.isArray(taskPaths) || !Array.isArray(pathCoverage)) {
    return "symbol_target_binding_mismatch";
  }
  if (pathCoverage.length !== taskPaths.length) {
    return "symbol_target_binding_mismatch";
  }
  const covPaths = pathCoverage.map((e) => e && e.path);
  if (!sortedStringMultisetEqual(taskPaths, covPaths)) {
    return "symbol_target_binding_mismatch";
  }
  const seen = new Set();
  for (const entry of pathCoverage) {
    if (typeof entry.path !== "string" || seen.has(entry.path)) {
      return "symbol_target_binding_mismatch";
    }
    seen.add(entry.path);
    if (!SYMBOL_TARGET_PATH_COVERAGE_STATUSES.has(entry.status)) {
      return "symbol_target_evidence_inconsistent";
    }
  }
  return null;
}

/**
 * Source hashes vs retained pack/impact (E). Mismatch → binding_mismatch.
 * @param {object} witness
 * @param {{ pack?: object, impact?: object }|null|undefined} retained
 * @returns {string|null}
 */
export function checkSymbolTargetSourceHashesAgainstRetained(witness, retained) {
  const taskPaths = Array.isArray(witness.taskPaths) ? witness.taskPaths : [];
  const hashes = witness.sourceHashes;
  if (!isWitnessPlainObject(hashes)) {
    return "symbol_target_binding_mismatch";
  }
  const packItems = retained && retained.pack
    && retained.pack.sections
    && retained.pack.sections.files
    && Array.isArray(retained.pack.sections.files.items)
    ? retained.pack.sections.files.items
    : null;
  const impactTargets = retained && retained.impact
    && Array.isArray(retained.impact.targets)
    ? retained.impact.targets
    : null;

  for (const P of taskPaths) {
    const witnessHash = hashes[P];
    if (typeof witnessHash !== "string" || !SYMBOL_TARGET_SHA256_HEX.test(witnessHash)) {
      return "symbol_target_binding_mismatch";
    }

    let packHash;
    if (packItems) {
      const file = packItems.find((f) => f && f.path === P);
      if (file && isWitnessPlainObject(file.provenance)
        && isWitnessPlainObject(file.provenance.source)
        && typeof file.provenance.source.sha256 === "string") {
        packHash = file.provenance.source.sha256;
      }
    }

    let impactHash;
    if (impactTargets) {
      const target = impactTargets.find((t) => t && t.originPath === P);
      if (target && isWitnessPlainObject(target.targetSource)
        && typeof target.targetSource.hash === "string") {
        impactHash = target.targetSource.hash;
      }
    }

    if (packHash !== undefined && impactHash !== undefined && packHash !== impactHash) {
      return "symbol_target_binding_mismatch";
    }
    if (packHash !== undefined && witnessHash !== packHash) {
      return "symbol_target_binding_mismatch";
    }
    if (impactHash !== undefined && witnessHash !== impactHash) {
      return "symbol_target_binding_mismatch";
    }
  }
  return null;
}

/**
 * Boolean↔details consistency when holds===true (F).
 * Hole 1: when holds true, each evaluation pathScope must sorted-multiset-equal
 * witness.taskPaths (full required domain; subset or [] refuse inconsistent).
 * Hole 3: effectivelyEvaluated coherence applied via isSymbolTargetEffectivelyEvaluated.
 * @returns {string|null} evidence_inconsistent or null
 */
export function checkSymbolTargetHoldsDetailsConsistency(witness) {
  const evaluations = witness.evaluations;
  const pathCoverage = witness.pathCoverage;
  const requiredNames = witness.requiredNames;
  const taskPaths = witness.taskPaths;
  const holdsTrue = witness.completenessHolds === true || witness.uniquenessHolds === true;

  // Hole 1: full-domain pathScope when either hold is claimed true
  if (holdsTrue) {
    if (!Array.isArray(evaluations) || !Array.isArray(taskPaths)) {
      return "symbol_target_evidence_inconsistent";
    }
    for (const evaluation of evaluations) {
      if (!evaluation || !sortedStringMultisetEqual(evaluation.pathScope, taskPaths)) {
        return "symbol_target_evidence_inconsistent";
      }
    }
  }

  if (witness.completenessHolds === true) {
    if (!Array.isArray(requiredNames) || !Array.isArray(evaluations)) {
      return "symbol_target_evidence_inconsistent";
    }
    for (const name of requiredNames) {
      const matches = evaluations.filter((e) => e && e.name === name);
      if (matches.length !== 1 || !isSymbolTargetEffectivelyEvaluated(matches[0])) {
        return "symbol_target_evidence_inconsistent";
      }
    }
    if (Array.isArray(pathCoverage)) {
      for (const entry of pathCoverage) {
        if (entry && (entry.status === "uncovered_language" || entry.status === "unevaluated")) {
          return "symbol_target_evidence_inconsistent";
        }
      }
    }
    if (witness.nameListTruncated === true) {
      return "symbol_target_evidence_inconsistent";
    }
  }

  if (witness.uniquenessHolds === true) {
    if (!Array.isArray(evaluations) || evaluations.length === 0) {
      return "symbol_target_evidence_inconsistent";
    }
    for (const e of evaluations) {
      if (!e || e.outcome !== "unique" || !isSymbolTargetEffectivelyEvaluated(e)) {
        return "symbol_target_evidence_inconsistent";
      }
    }
  }

  return null;
}

/**
 * Normalize optional symbol-target completeness witness for ETS consume.
 * Returns null when absent; otherwise a materialized plain object.
 * Identity/binding/holds evaluation is separate (evaluateSymbolTargetCompletenessWitness).
 */
export function normalizeSymbolTargetCompletenessWitness(raw) {
  if (raw === undefined || raw === null) return null;
  const witness = materializeBoundedJsonData(raw);
  if (!isWitnessPlainObject(witness)) {
    throw effectiveTaskScopeError("symbol_target_evidence_missing", "symbolTargetCompletenessWitness must be a plain object.");
  }
  return witness;
}

/**
 * Pure bind+consume check for already-produced symbol-target completeness witness.
 * Does not call producer, A1, analyzers, Git, FS, or HTTP.
 *
 * Structure/correspondence/hash consistency are checked BEFORE lift (Fix 1).
 * Binding/consistency failure → refuse codes (not honest not_established).
 *
 * @param {object|null|undefined} witness
 * @param {{ taskPaths: string[], symbols: string[], projectId: string, repositoryId: string, worktreeId: string, snapshotToken: string }} binding
 * @param {{ pack?: object, impact?: object }|null|undefined} [retained] optional retained pack/impact for sourceHashes cross-check
 * @returns {{ ok: true, witness: object } | { ok: false, code: string }}
 */
export function evaluateSymbolTargetCompletenessWitness(witness, binding, retained) {
  if (witness === undefined || witness === null) {
    return { ok: false, code: "symbol_target_evidence_missing" };
  }
  if (!isWitnessPlainObject(witness)) {
    return { ok: false, code: "symbol_target_evidence_missing" };
  }
  if (
    witness.kind !== SYMBOL_TARGET_COMPLETENESS_WITNESS_KIND
    || witness.producerIdentity !== SYMBOL_TARGET_COMPLETENESS_WITNESS_PRODUCER_IDENTITY
    || witness.version !== SYMBOL_TARGET_COMPLETENESS_WITNESS_VERSION
  ) {
    return { ok: false, code: "symbol_target_evidence_missing" };
  }

  const domains = witness.claimedDomains;
  if (!Array.isArray(domains) || !domains.includes(SYMBOL_TARGET_ADMITTED_DOMAIN)) {
    return { ok: false, code: "symbol_target_domain_unsupported" };
  }

  const citations = Array.isArray(witness.a1Citations) ? witness.a1Citations : [];
  if (citations.length === 0 || !citations.every(a1CitationAdmitted)) {
    return { ok: false, code: "symbol_target_domain_unsupported" };
  }

  if (!binding || typeof binding !== "object") {
    return { ok: false, code: "symbol_target_binding_mismatch" };
  }

  if (!sameSortedStringArrays(witness.taskPaths, binding.taskPaths)) {
    return { ok: false, code: "symbol_target_binding_mismatch" };
  }
  if (!sameSortedStringArrays(witness.requiredNames, binding.symbols)) {
    return { ok: false, code: "symbol_target_binding_mismatch" };
  }
  if (witness.projectId !== binding.projectId) {
    return { ok: false, code: "symbol_target_binding_mismatch" };
  }
  if (witness.repositoryId !== binding.repositoryId) {
    return { ok: false, code: "symbol_target_binding_mismatch" };
  }
  if (witness.worktreeId !== binding.worktreeId) {
    return { ok: false, code: "symbol_target_binding_mismatch" };
  }
  if (witness.snapshotToken !== binding.snapshotToken) {
    return { ok: false, code: "symbol_target_binding_mismatch" };
  }

  // Fix 1: structure + correspondence BEFORE holds (refuse outranks honest not_established)
  const structureCode = checkSymbolTargetWitnessStructure(witness);
  if (structureCode) return { ok: false, code: structureCode };

  const nameCode = checkSymbolTargetNameEvalCitationCorrespondence(witness);
  if (nameCode) return { ok: false, code: nameCode };

  const pathCode = checkSymbolTargetPathCoverageCorrespondence(witness);
  if (pathCode) return { ok: false, code: pathCode };

  const hashCode = checkSymbolTargetSourceHashesAgainstRetained(witness, retained);
  if (hashCode) return { ok: false, code: hashCode };

  // Hole 2: citation snapshotToken ↔ exterior (binding_mismatch outranks holds-details)
  const snapshotCode = checkSymbolTargetCitationSnapshotReconcile(witness);
  if (snapshotCode) return { ok: false, code: snapshotCode };

  const holdsDetailsCode = checkSymbolTargetHoldsDetailsConsistency(witness);
  if (holdsDetailsCode) return { ok: false, code: holdsDetailsCode };

  if (witness.completenessHolds !== true) {
    return { ok: false, code: "symbol_target_completeness_not_established" };
  }
  if (witness.uniquenessHolds !== true) {
    return { ok: false, code: "symbol_target_uniqueness_not_established" };
  }

  return { ok: true, witness };
}

export { compareStrings };