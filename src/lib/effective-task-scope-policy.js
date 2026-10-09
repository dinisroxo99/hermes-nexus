import { types as utilTypes } from "node:util";
import { validateProjectId } from "./project-registry.js";
import { validateRelativeProjectPath } from "./project-roots.js";
import {
  normalizeImpactPaths, normalizeImpactStatus, normalizeImpactFindingState,
  normalizeImpactCompleteness, IMPACT_COMPLETENESS_DIMENSIONS, IMPACT_COMPLETENESS_REASONS, IMPACT_LIMITS
} from "./impact-policy.js";
import { TASK_CONTEXT_LIMITS } from "./task-context-policy.js";
import { createHash } from "node:crypto";
import {
  CREATE_ABSENCE_WITNESS_HARD_FLAGS, CREATE_ABSENCE_WITNESS_KIND, CREATE_ABSENCE_WITNESS_PRODUCER_IDENTITY,
  CREATE_ABSENCE_WITNESS_VERSION, CREATE_ABSENCE_WITNESS_METHOD, CREATE_ABSENCE_WITNESS_SECRET_NAME_POLICY,
  CREATE_ABSENCE_WITNESS_SYMLINK_POLICY, CREATE_ABSENCE_WITNESS_FS_POLICY_ID, CREATE_ABSENCE_WITNESS_LIMITS,
  CREATE_ABSENCE_WITNESS_FS_ALLOWLIST, CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX, CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION,
  CREATE_ABSENCE_INCOMPLETE_REASONS, CREATE_ABSENCE_BOUNDARY_STATES, canonicalJson
} from "./create-destination-absence-witness-constants.js";
import { CREATE_NAME_KEY_ID, UNICODE_VERSION, KERNEL_MODEL_KEY_DESCRIPTOR, nameKey, kernelModelNameKey, namesCollide } from "./create-name-key.js";
import { isContextSecretSegment } from "./context-path-secret-policy.js";

export const EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION = 2;
export const EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION = "effective-task-scope-v2";
export const EFFECTIVE_TASK_SCOPE_POLICY_VERSION = "step4-foundation-6";

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
 * Validate create-intent proof and return a fail-closed verdict (policy step4-foundation-6).
 * Whole-proof structural/budget validation runs before any verdict. Per declared newPath: any
 * positive byte observation (Context files item or non-null Impact targetSource) is EXISTS.
 * Without an absence witness (`absence === undefined`) everything else is UNKNOWN, exactly as
 * under the previous policy version. With the evaluated absence witness (5th parameter, from
 * evaluateCreateDestinationAbsenceWitness): R9 retained cross-check first (returned refuse
 * create_absence_binding_mismatch), then EXISTS › parent_absent › ancestor_boundary › UNKNOWN
 * (incl. declared-target dual-key collision and composer Unicode mismatch) › lift
 * `{ notEvaluated: null, lift: { reason: "create_destination_proven_absent" } }`, only when
 * every declared target is PROVEN-ABSENT (absence-witness evidence contract r3.4 §1.4 steps 8–9).
 */
export function bindCreateIntent(intent, paths, pack, impact, absence) {
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
    if (absence !== undefined) return createAbsenceVerdict(absence, paths, sourcesByPath, targetsByPath);
    if (exists) return { notEvaluated: "create_destination_exists" };
    if (unknown) return { notEvaluated: "create_destination_absence_not_proven" };
    // Without an absence witness PROVEN-ABSENT stays unreachable (no lift).
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

/**
 * Sibling of checkInputBudget for inputs that carry createDestinationAbsenceWitness
 * (absence-witness evidence contract r3.4 D2/D3, N-9, N32-1). Materializes request, pack, impact,
 * symbolTargetCompletenessWitness (only when !== undefined) and createDestinationAbsenceWitness once,
 * applies the same 131072 pack and impact caps and one total against MAX_COMPACT_INPUT.
 * No separate witness sub-cap and no witness semantics. checkInputBudget is unchanged.
 */
export function checkCreateAbsenceInputBudget(request, pack, impact, symbolTargetCompletenessWitness, createDestinationAbsenceWitness) {
  const inputObj = symbolTargetCompletenessWitness !== undefined
    ? { request, pack, impact, symbolTargetCompletenessWitness, createDestinationAbsenceWitness }
    : { request, pack, impact, createDestinationAbsenceWitness };
  const safe = materializeBoundedJsonData(inputObj);
  const packBytes = Buffer.byteLength(JSON.stringify(safe.pack), "utf8");
  const impactBytes = Buffer.byteLength(JSON.stringify(safe.impact), "utf8");
  if (packBytes > 131072 || impactBytes > 131072) {
    throw effectiveTaskScopeError("scope_budget_exceeded", "Pack or Impact exceeds 131072 compact bytes.");
  }
  if (Buffer.byteLength(JSON.stringify(safe), "utf8") > MAX_COMPACT_INPUT) {
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

// ---------------------------------------------------------------------------------------------
// Create-destination absence witness consume (absence-witness evidence contract r3.4, D3; §2.5
// R1–R8, §1.4 steps 5–6). Pure: no fs, no network, no clock. The fs-using producer is never imported;
// only the D1 pure constants module, the key helper and the D0 secret predicate are (§2.6 P-9).
// Every function below returns results and never throws for witness content.
// ---------------------------------------------------------------------------------------------
const ABSENCE_INVALID = "create_absence_evidence_invalid";
const ABSENCE_BINDING = "create_absence_binding_mismatch";
const ABSENCE_INCONSISTENT = "create_absence_evidence_inconsistent";
const ABSENCE_TOP_KEYS = Object.freeze([
  "kind", "producerIdentity", "version", "method", "secretNamePolicy", "projectId", "repositoryId", "worktreeId",
  "project", "revision", "snapshotToken", "generatedAt", "requiresReobservation", "observation", "nameComparison",
  "filesystem", "symlinkPolicy", "filtersApplied", "limits", "targets", "failClosedMatrix", "hardFlags",
  "nonAuthorization", "provenance"
]);
const ABSENCE_REVISION_KEYS = Object.freeze(["status", "commitSha", "branch", "dirty", "isLinkedWorktree"]);
const ABSENCE_RECORD_KEYS = Object.freeze(["newPath", "parentPath", "basename", "ancestors", "nativeLookup", "enumeration", "complete", "incompleteReason", "verdict"]);
const ABSENCE_ANCESTOR_KEYS = Object.freeze(["path", "state", "fsType", "devIno"]);
// Only S2a is admitted (A2): any other enumeration shape fails R1.
const ABSENCE_S2A_ENUMERATION_KEYS = Object.freeze(["entryCount", "entries", "redactedSecretEntryCount", "listingDigest"]);
const ABSENCE_NAME_COMPARISON_KEYS = Object.freeze(["keyId", "unicodeVersion", "caseFolding", "turkicPostFold", "stripDefaultIgnorable", "trimTrailingDotSpace", "collisionRule", "kernelModelKey"]);
const ABSENCE_ANCESTOR_STATES = Object.freeze(["directory", "absent", "symlink", "not_directory", "repository_boundary", "nested_project", "device_boundary", "unreadable"]);
const ABSENCE_NATIVE_LOOKUPS = Object.freeze(["ENOENT", "present", "error"]);
const ABSENCE_VERDICTS = Object.freeze(["absent", "exists", "unknown", "parent_absent", "ancestor_boundary"]);
const ABSENCE_EMPTY_CHAIN_REASONS = Object.freeze(["segment_cap", "unicode_version_mismatch", "non_utf8_name", "descriptor_verification_unavailable", "witness_byte_cap"]);
const CREATE_RELAX_COMPLETENESS_KEYS = Object.freeze(["source", "provider", "traversal", "output"]);

const absenceRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
const absenceExactKeys = (value, keys) => absenceRecord(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const absenceString = value => typeof value === "string";
const absenceStringOrNull = value => value === null || typeof value === "string";
const absenceBooleanOrNull = value => value === null || typeof value === "boolean";
const absenceCount = value => Number.isSafeInteger(value) && value >= 0;
const absenceRevisionShape = value => absenceExactKeys(value, ABSENCE_REVISION_KEYS) && absenceString(value.status) &&
  absenceStringOrNull(value.commitSha) && absenceStringOrNull(value.branch) && absenceBooleanOrNull(value.dirty) && absenceBooleanOrNull(value.isLinkedWorktree);
const absenceSegments = newPath => newPath.split("/");
const absenceParentPath = newPath => absenceSegments(newPath).slice(0, -1).join("/");
const absenceBasename = newPath => { const segments = absenceSegments(newPath); return segments[segments.length - 1]; };
function absenceDerivedChain(newPath) {
  const segments = absenceSegments(newPath);
  const chain = [""];
  for (let i = 1; i < segments.length; i++) chain.push(segments.slice(0, i).join("/"));
  return chain;
}

/** R1: exact keys at every level and JSON types (S2a enumeration schema only). */
function absenceShapeHolds(w) {
  if (!absenceExactKeys(w, ABSENCE_TOP_KEYS)) return false;
  for (const key of ["kind", "producerIdentity", "version", "method", "secretNamePolicy", "projectId", "repositoryId", "worktreeId", "snapshotToken", "symlinkPolicy"]) {
    if (!absenceString(w[key])) return false;
  }
  if (!absenceExactKeys(w.project, ["rootId", "relativePath"]) || !absenceString(w.project.rootId) || !absenceString(w.project.relativePath)) return false;
  if (!absenceRevisionShape(w.revision)) return false;
  if (typeof w.requiresReobservation !== "boolean") return false;
  const o = w.observation;
  if (!absenceExactKeys(o, ["basis", "bracket", "revisionStable", "tokenStable"]) || !absenceString(o.basis) || !absenceString(o.bracket) ||
      typeof o.revisionStable !== "boolean" || typeof o.tokenStable !== "boolean") return false;
  if (!absenceExactKeys(w.nameComparison, ABSENCE_NAME_COMPARISON_KEYS) ||
      !absenceExactKeys(w.nameComparison.kernelModelKey, Object.keys(KERNEL_MODEL_KEY_DESCRIPTOR))) return false;
  if (!absenceExactKeys(w.filesystem, ["policyId", "rootFsType"]) || !absenceString(w.filesystem.policyId) || !absenceStringOrNull(w.filesystem.rootFsType)) return false;
  if (!Array.isArray(w.filtersApplied) || !w.filtersApplied.every(absenceString)) return false;
  if (!absenceExactKeys(w.limits, Object.keys(CREATE_ABSENCE_WITNESS_LIMITS)) || !Object.values(w.limits).every(absenceCount)) return false;
  if (!absenceExactKeys(w.failClosedMatrix, Object.keys(CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX)) ||
      !Object.values(w.failClosedMatrix).every(value => typeof value === "boolean")) return false;
  if (!absenceExactKeys(w.hardFlags, Object.keys(CREATE_ABSENCE_WITNESS_HARD_FLAGS)) ||
      !Object.values(w.hardFlags).every(value => typeof value === "string" || typeof value === "boolean")) return false;
  if (!Array.isArray(w.nonAuthorization) || !w.nonAuthorization.every(absenceString)) return false;
  const p = w.provenance;
  if (p !== null && (!absenceExactKeys(p, ["bindingMismatchReason", "liveSnapshotToken", "liveRevision"]) || !absenceString(p.bindingMismatchReason) ||
      !absenceStringOrNull(p.liveSnapshotToken) || (p.liveRevision !== null && !absenceRevisionShape(p.liveRevision)))) return false;
  if (!Array.isArray(w.targets)) return false;
  for (const t of w.targets) {
    if (!absenceExactKeys(t, ABSENCE_RECORD_KEYS) || !absenceString(t.newPath) || !absenceString(t.parentPath) || !absenceString(t.basename) ||
        typeof t.complete !== "boolean" || !absenceStringOrNull(t.incompleteReason) || !ABSENCE_VERDICTS.includes(t.verdict) ||
        (t.nativeLookup !== null && !ABSENCE_NATIVE_LOOKUPS.includes(t.nativeLookup)) || !Array.isArray(t.ancestors)) return false;
    for (const a of t.ancestors) {
      if (!absenceExactKeys(a, ABSENCE_ANCESTOR_KEYS) || !absenceString(a.path) || !ABSENCE_ANCESTOR_STATES.includes(a.state) ||
          !absenceStringOrNull(a.fsType) || !absenceStringOrNull(a.devIno)) return false;
    }
    const e = t.enumeration;
    if (e !== null && (!absenceExactKeys(e, ABSENCE_S2A_ENUMERATION_KEYS) || !absenceCount(e.entryCount) || !Array.isArray(e.entries) ||
        !e.entries.every(absenceString) || !absenceCount(e.redactedSecretEntryCount) || !absenceString(e.listingDigest))) return false;
  }
  return true;
}

/** R2: constants fixed by the admitted option (S2a) and key bundle hn-create-name-key-v3. */
function absenceConstantsHold(w) {
  const nc = w.nameComparison;
  return w.kind === CREATE_ABSENCE_WITNESS_KIND &&
    w.producerIdentity === CREATE_ABSENCE_WITNESS_PRODUCER_IDENTITY &&
    w.version === CREATE_ABSENCE_WITNESS_VERSION &&
    w.method === CREATE_ABSENCE_WITNESS_METHOD &&
    w.secretNamePolicy === CREATE_ABSENCE_WITNESS_SECRET_NAME_POLICY &&
    w.symlinkPolicy === CREATE_ABSENCE_WITNESS_SYMLINK_POLICY &&
    w.observation.basis === "working_tree" && w.observation.bracket === "before_after_rewalk" &&
    nc.keyId === CREATE_NAME_KEY_ID && nc.unicodeVersion === UNICODE_VERSION && nc.caseFolding === "full_CF" &&
    nc.turkicPostFold === true && nc.stripDefaultIgnorable === true && nc.trimTrailingDotSpace === true && nc.collisionRule === "K_or_Kk" &&
    Object.keys(KERNEL_MODEL_KEY_DESCRIPTOR).every(key => nc.kernelModelKey[key] === KERNEL_MODEL_KEY_DESCRIPTOR[key]) &&
    w.filesystem.policyId === CREATE_ABSENCE_WITNESS_FS_POLICY_ID;
}

/**
 * R1 + R2 on a materialized createDestinationAbsenceWitness. Returns `{ ok: true, witness }` or
 * `{ ok: false, code: "create_absence_evidence_invalid" }`; never throws for content.
 */
export function normalizeCreateDestinationAbsenceWitness(value) {
  try {
    if (!absenceShapeHolds(value) || !absenceConstantsHold(value)) return { ok: false, code: ABSENCE_INVALID };
    return { ok: true, witness: value };
  } catch {
    return { ok: false, code: ABSENCE_INVALID };
  }
}

/** R3: binding to the composer's exterior values (after gates 1–4). */
function absenceBindingHolds(w, exterior) {
  if (w.projectId !== exterior.projectId || w.repositoryId !== exterior.repositoryId || w.worktreeId !== exterior.worktreeId) return false;
  if (w.project.rootId !== exterior.worktree.rootId || w.project.relativePath !== exterior.worktree.relativePath) return false;
  if (ABSENCE_REVISION_KEYS.some(key => w.revision[key] !== exterior.revision[key])) return false;
  if (w.snapshotToken !== exterior.snapshotToken) return false;
  const declared = new Set(exterior.taskPaths);
  if (declared.size !== exterior.taskPaths.length || w.targets.length !== declared.size) return false;
  for (let i = 0; i < w.targets.length; i++) {
    const t = w.targets[i];
    if (!declared.has(t.newPath) || (i > 0 && compareStrings(w.targets[i - 1].newPath, t.newPath) >= 0)) return false;
    if (t.parentPath !== absenceParentPath(t.newPath) || t.basename !== absenceBasename(t.newPath)) return false;
    const chain = absenceDerivedChain(t.newPath);
    if (t.ancestors.length > chain.length || t.ancestors.some((a, j) => a.path !== chain[j])) return false;
  }
  return true;
}

/** R4: global metadata. */
function absenceMetadataConsistent(w) {
  if (w.filtersApplied.length !== 0) return false;
  if (Object.keys(CREATE_ABSENCE_WITNESS_LIMITS).some(key => w.limits[key] !== CREATE_ABSENCE_WITNESS_LIMITS[key])) return false;
  if (w.generatedAt !== null || w.requiresReobservation !== true) return false;
  if (Object.keys(CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX).some(key => w.failClosedMatrix[key] !== true)) return false;
  if (Object.keys(CREATE_ABSENCE_WITNESS_HARD_FLAGS).some(key => w.hardFlags[key] !== CREATE_ABSENCE_WITNESS_HARD_FLAGS[key])) return false;
  if (w.nonAuthorization.length !== CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION.length ||
      CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION.some((text, i) => w.nonAuthorization[i] !== text)) return false;
  const anyComplete = w.targets.some(t => t.complete === true);
  if (anyComplete && (w.observation.revisionStable !== true || w.observation.tokenStable !== true)) return false;
  if (anyComplete && w.provenance !== null) return false;
  return Buffer.byteLength(canonicalJson(w), "utf8") <= CREATE_ABSENCE_WITNESS_LIMITS.maxWitnessBytes;
}

/** R5: per-target structure. */
function absenceRecordConsistent(t) {
  if (t.complete === true && t.incompleteReason !== null) return false;
  if (t.complete === false && (t.incompleteReason === null || !CREATE_ABSENCE_INCOMPLETE_REASONS.includes(t.incompleteReason))) return false;
  if (t.complete === true && (t.enumeration === null || !["ENOENT", "present"].includes(t.nativeLookup))) return false;
  // R5-FC (r3.4 + N-12 full-chain amendment): a complete:true record needs ancestors to be exactly the full
  // chain D(p): length |D(p)|, ancestors[j].path === D(p)[j] and every state "directory" (any verdict).
  if (t.complete === true) {
    const full = absenceDerivedChain(t.newPath);
    if (t.ancestors.length !== full.length || t.ancestors.some((a, j) => a.path !== full[j] || a.state !== "directory")) return false;
  }
  const chain = t.ancestors;
  for (let i = 0; i < chain.length; i++) {
    const a = chain[i];
    if (i > 0 && chain[i - 1].state !== "directory") return false;
    if ((a.state === "directory") !== (a.fsType !== null) || (a.state === "directory") !== (a.devIno !== null)) return false;
  }
  if (chain.length > 0 && !["directory", "unreadable"].includes(chain[0].state)) return false;
  if (chain.length === 0) {
    if (t.complete !== false || !ABSENCE_EMPTY_CHAIN_REASONS.includes(t.incompleteReason)) return false;
    if (t.nativeLookup !== null || t.enumeration !== null || t.verdict !== "unknown") return false;
  }
  if (t.incompleteReason === "witness_byte_cap" && (chain.length !== 0 || t.nativeLookup !== null || t.enumeration !== null ||
      t.complete !== false || t.verdict !== "unknown")) return false;
  const e = t.enumeration;
  if (e !== null) {
    for (let i = 0; i < e.entries.length; i++) {
      const entry = e.entries[i];
      if (i > 0 && compareStrings(e.entries[i - 1], entry) >= 0) return false;
      if (Buffer.byteLength(entry, "utf8") > CREATE_ABSENCE_WITNESS_LIMITS.maxNameBytes || entry.includes("/") || entry.includes("\u0000")) return false;
      if (isContextSecretSegment(entry)) return false;
    }
    if (e.entryCount !== e.entries.length + e.redactedSecretEntryCount) return false;
    if (e.entryCount > CREATE_ABSENCE_WITNESS_LIMITS.maxEntriesPerParent) return false;
    const body = { entryCount: e.entryCount, entries: e.entries, redactedSecretEntryCount: e.redactedSecretEntryCount };
    if (createHash("sha256").update(canonicalJson(body), "utf8").digest("hex") !== e.listingDigest) return false;
    if (t.nativeLookup === "ENOENT" && e.entries.includes(t.basename)) return false;
    if (t.nativeLookup === "present" && e.entryCount === 0) return false;
  }
  return true;
}

/** R6: a complete record needs the root and every ancestor on the G12 allow-list. */
function absenceFilesystemConsistent(w, t) {
  if (t.complete !== true) return true;
  if (!CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes(w.filesystem.rootFsType)) return false;
  return t.ancestors.every(a => CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes(a.fsType));
}

/** §3.3 S2a rule, re-implemented here (never imported from the producer; parity test D3-S2a). */
function absenceS2aRequiresUnknown(redactedSecretEntryCount, basename) {
  if (!(redactedSecretEntryCount > 0)) return false;
  return isContextSecretSegment(nameKey(basename)) || isContextSecretSegment(kernelModelNameKey(basename));
}

/** R8 recompute order (a)–(j). Only reached on a matching runtime Unicode version (R7). */
function absenceRecomputedVerdict(t) {
  const chain = t.ancestors;
  if (chain.some(a => CREATE_ABSENCE_BOUNDARY_STATES.includes(a.state))) return "ancestor_boundary";
  if (chain.length > 0 && chain[chain.length - 1].state === "absent") return "parent_absent";
  if (chain.some(a => a.state === "unreadable")) return "unknown";
  if (t.complete !== true) return "unknown";
  const e = t.enumeration;
  if (e.entryCount === 0) return "unknown";
  if (t.nativeLookup === "present") return "exists";
  if (e.entries.includes(t.basename)) return "exists";
  if (e.entries.some(entry => namesCollide(entry, t.basename))) return "unknown";
  if (absenceS2aRequiresUnknown(e.redactedSecretEntryCount, t.basename)) return "unknown";
  if (nameKey(t.basename) === "" || kernelModelNameKey(t.basename) === "" || /~[0-9]/.test(t.basename)) return "unknown";
  return "absent";
}

/**
 * R1–R8 (§2.5, first failure wins). `exterior` = { taskPaths, projectId, repositoryId, worktreeId,
 * worktree: { rootId, relativePath }, revision, snapshotToken }. Optional internal third argument
 * `{ runtimeUnicodeVersion }` (§1.5; NF-4, N-b, N3-5): absent (fewer than three arguments) → the
 * runtime value; present → it must be a non-null, non-array object, and `Object.hasOwn` decides
 * whether its value (even `undefined`) replaces the default. Anything else is a mismatch. The
 * composer never passes it. Returns a refuse `{ ok: false, code }` or the candidate
 * `{ ok: true, unicodeMismatch, targets: [{ newPath, parentPath, verdict, witnessVerdict, entries }] }`.
 */
export function evaluateCreateDestinationAbsenceWitness(witness, exterior) {
  try {
    const normalized = normalizeCreateDestinationAbsenceWitness(witness);
    if (!normalized.ok) return normalized;
    const w = normalized.witness;
    if (!absenceBindingHolds(w, exterior)) return { ok: false, code: ABSENCE_BINDING };
    if (!absenceMetadataConsistent(w)) return { ok: false, code: ABSENCE_INCONSISTENT };
    if (!w.targets.every(absenceRecordConsistent)) return { ok: false, code: ABSENCE_INCONSISTENT };
    if (!w.targets.every(t => absenceFilesystemConsistent(w, t))) return { ok: false, code: ABSENCE_INCONSISTENT };
    let runtimeUnicodeVersion = process.versions.unicode;
    let unicodeMismatch = false;
    if (arguments.length >= 3) {
      const seam = arguments[2];
      if (!absenceRecord(seam)) unicodeMismatch = true;
      else if (Object.hasOwn(seam, "runtimeUnicodeVersion")) runtimeUnicodeVersion = seam.runtimeUnicodeVersion;
    }
    if (runtimeUnicodeVersion !== UNICODE_VERSION) unicodeMismatch = true;
    const targets = [];
    for (const t of w.targets) {
      let verdict = "unknown";
      if (!unicodeMismatch) {
        verdict = absenceRecomputedVerdict(t);
        if (verdict !== t.verdict) return { ok: false, code: ABSENCE_INCONSISTENT };
      }
      targets.push({ newPath: t.newPath, parentPath: t.parentPath, verdict, witnessVerdict: t.verdict,
        entries: t.enumeration === null ? null : [...t.enumeration.entries] });
    }
    return { ok: true, unicodeMismatch, targets };
  } catch {
    return { ok: false, code: ABSENCE_INVALID };
  }
}

function createRelaxCompleteness(value) {
  return absenceExactKeys(value, CREATE_RELAX_COMPLETENESS_KEYS) &&
    Array.isArray(value.source) && value.source.length === 1 && value.source[0] === "source_unavailable" &&
    Array.isArray(value.provider) && value.provider.length === 0 &&
    Array.isArray(value.traversal) && value.traversal.length === 0 &&
    Array.isArray(value.output) && value.output.length === 0;
}

/**
 * D3-c (contract r3.4 l.768–777): true only for a create whose every declared target has a step-5
 * candidate verdict "absent" (R7 clean) and whose Impact is the real-shaped new-path form.
 * Condition 1 (kind "create") is checked first. Total: odd shapes return false; never throws.
 */
export function isCreateGateRelaxed(normalizedRequest, impact, absenceCandidate) {
  try {
    if (!absenceRecord(normalizedRequest) || !Object.hasOwn(normalizedRequest, "operationIntent")) return false;
    const intent = normalizedRequest.operationIntent;
    if (!absenceRecord(intent) || intent.kind !== "create") return false;
    if (!Array.isArray(intent.targets) || intent.targets.length === 0) return false;
    const declared = new Set();
    for (const target of intent.targets) {
      if (!absenceRecord(target) || typeof target.newPath !== "string") return false;
      declared.add(target.newPath);
    }
    if (!absenceRecord(absenceCandidate) || absenceCandidate.ok !== true || absenceCandidate.unicodeMismatch !== false ||
        !Array.isArray(absenceCandidate.targets)) return false;
    let absent = 0;
    for (const path of declared) {
      const candidate = absenceCandidate.targets.find(t => absenceRecord(t) && t.newPath === path);
      if (!candidate || candidate.verdict !== "absent") return false;
      absent++;
    }
    if (absent !== declared.size || absent < 1) return false;
    if (!absenceRecord(impact) || impact.status !== "partial" || !Array.isArray(impact.affectedFiles) ||
        !createRelaxCompleteness(impact.completeness) || !Array.isArray(impact.targets)) return false;
    for (const target of impact.targets) {
      if (!absenceRecord(target)) return false;
      if (target.findingState === "not_evaluated") {
        if (!declared.has(target.originPath) || !Object.hasOwn(target, "targetSource") || target.targetSource !== null ||
            target.status !== "partial" || !createRelaxCompleteness(target.completeness)) return false;
      } else if (target.findingState !== "evidence_found" && target.findingState !== "no_evidence_found") {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * bindCreateIntent steps 8 (R9 retained cross-check) and 9 (aggregation) when an evaluated absence
 * witness is supplied (§1.4, §2.2, §1.1 ix). Every outcome is returned, never thrown. Lift needs an
 * explicit "absent" for each declared path (count === paths.length ≥ 1); anything else is UNKNOWN.
 */
function createAbsenceVerdict(absence, paths, sourcesByPath, targetsByPath) {
  const notProven = { notEvaluated: "create_destination_absence_not_proven" };
  const valid = absenceRecord(absence) && absence.ok === true && Array.isArray(absence.targets);
  const records = valid ? absence.targets.filter(absenceRecord) : [];
  const recordFor = path => records.find(t => t.newPath === path);
  // R9 (first clause): retained basenames must appear in every non-null entries list of their parent.
  const retained = [...sourcesByPath.keys(), ...[...targetsByPath].filter(([, target]) => target.targetSource != null).map(([path]) => path)];
  for (const record of records) {
    if (!Array.isArray(record.entries)) continue;
    for (const path of retained) {
      if (absenceParentPath(path) === record.parentPath && !record.entries.includes(absenceBasename(path))) {
        return { notEvaluated: ABSENCE_BINDING };
      }
    }
  }
  // R9 (second clause): a retained observation of p itself with a witness verdict "absent".
  for (const path of paths) {
    const record = recordFor(path);
    const observed = sourcesByPath.has(path) || targetsByPath.get(path)?.targetSource != null;
    if (observed && record && record.witnessVerdict === "absent") return { notEvaluated: ABSENCE_BINDING };
  }
  if (!valid) return notProven;
  const verdicts = paths.map(path => {
    if (sourcesByPath.has(path) || targetsByPath.get(path)?.targetSource != null) return "exists";
    const record = recordFor(path);
    if (!record || absence.unicodeMismatch !== false) return "unknown";
    if (record.verdict !== "absent") return ["exists", "parent_absent", "ancestor_boundary"].includes(record.verdict) ? record.verdict : "unknown";
    const segments = absenceSegments(path);
    const collides = paths.some(other => {
      if (other === path) return false;
      const otherSegments = absenceSegments(other);
      return otherSegments.length === segments.length && segments.every((segment, i) => namesCollide(segment, otherSegments[i]));
    });
    return collides ? "unknown" : "absent";
  });
  if (verdicts.includes("exists")) return { notEvaluated: "create_destination_exists" };
  if (verdicts.includes("parent_absent")) return { notEvaluated: "create_parent_directory_absent" };
  if (verdicts.includes("ancestor_boundary")) return { notEvaluated: "create_ancestor_boundary" };
  const absentCount = verdicts.filter(verdict => verdict === "absent").length;
  if (paths.length >= 1 && absentCount === paths.length) return { notEvaluated: null, lift: { reason: "create_destination_proven_absent" } };
  return notProven;
}

export { compareStrings };