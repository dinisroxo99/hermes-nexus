import { validateRelativeProjectPath } from "./project-roots.js";

export const IMPACT_ANALYSIS_VERSION = "impact-v2";

export const IMPACT_ANALYSIS_STATUSES = Object.freeze(["available", "partial", "unsupported", "unavailable"]);
export const IMPACT_SECTION_STATUSES = Object.freeze([...IMPACT_ANALYSIS_STATUSES, "not_requested"]);
export const IMPACT_FINDING_STATES = Object.freeze(["evidence_found", "no_evidence_found", "not_evaluated"]);
export const IMPACT_EVIDENCE_BASIS = Object.freeze(["semantic", "structural", "heuristic", "unknown"]);
export const IMPACT_TRUST_LABELS = Object.freeze(["derived_analysis", "untrusted_external_analysis"]);

export const IMPACT_COMPLETENESS_DIMENSIONS = Object.freeze(["source", "provider", "traversal", "output"]);
export const IMPACT_COMPLETENESS_REASONS = Object.freeze([
  "source_limit",
  "source_unavailable",
  "provider_partial",
  "provider_unsupported",
  "uncovered_language",
  "depth_limit",
  "traversal_work_limit",
  "origin_limit",
  "witness_budget",
  "output_byte_limit"
]);

export const IMPACT_LIMITS = deepFreeze({
  depth: {
    default: 2,
    max: 5,
    semantics: {
      seedDistance: 0,
      sameFileRelationshipConsumesFileHop: false,
      depthZero: "target_observation_only",
      depthZeroPropagatesAffectedFilesOrTests: false,
      reachingMaximumDepthImpliesTruncation: false,
      depthLimitRequiresKnownEligibleEvidenceBeyondBoundary: true,
      workBudgetExhaustionReason: "traversal_work_limit"
    }
  },
  affectedFiles: { default: 80, max: 250 },
  affectedTests: { default: 16, max: 32 },
  diagnostics: { default: 20, max: 40 },
  originWitnessesPerItem: { default: 8, max: 32 },
  originWitnessRecords: { default: 256, max: 1024 },
  traversalVisitedStates: { default: 2000, max: 16000 },
  traversalEdgeExaminations: { default: 16000, max: 64000 },
  compactBytes: { default: 64 * 1024, max: 128 * 1024 }
});

const REQUEST_FIELDS = Object.freeze(["paths", "worktree", "includeTests", "limits"]);
const WORKTREE_FIELDS = Object.freeze(["rootId", "relativePath"]);
const GLOB_META = /[*?\[\]{}]/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE = /^[A-Za-z]:/;
const PROVIDER_OPERATIONS = Object.freeze(["boundedSourceAnalysis", "detection", "symbols", "definitions", "references", "dependencies", "implementations", "diagnostics"]);

export const impactError = (code = "invalid_impact_request", message = "Invalid bounded Impact v2 request.") => Object.assign(new Error(message), { code });

export function normalizeImpactRequest(input) {
  assertRecord(input);
  assertAllowedFields(input, REQUEST_FIELDS);
  if (!Object.hasOwn(input, "paths")) throw invalid();

  return canonicalObject({
    paths: normalizeImpactPaths(input.paths),
    ...(input.worktree === undefined ? {} : { worktree: normalizeImpactWorktree(input.worktree) }),
    includeTests: normalizeOptionalBoolean(input.includeTests, false),
    limits: normalizeImpactLimits(input.limits)
  }, ["paths", "worktree", "includeTests", "limits"]);
}

export function normalizeImpactPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > IMPACT_LIMITS_TARGETS_MAX) throw invalid();
  const normalized = paths.map(normalizeImpactPath);
  const unique = [...new Set(normalized)].sort(compareStrings);
  if (unique.length === 0) throw invalid();
  return unique;
}

export const IMPACT_LIMITS_TARGETS_MAX = 32;

export function normalizeImpactLimits(rawLimits) {
  if (rawLimits === undefined) {
    return Object.fromEntries(Object.entries(IMPACT_LIMITS).map(([key, config]) => [key, config.default]));
  }
  assertRecord(rawLimits);
  assertAllowedFields(rawLimits, Object.keys(IMPACT_LIMITS));
  const normalized = {};
  for (const [key, config] of Object.entries(IMPACT_LIMITS)) {
    const value = rawLimits[key];
    normalized[key] = value === undefined ? config.default : normalizeIntegerLimit(value, config, key);
  }
  return normalized;
}

export function normalizeImpactStatus(value, options = {}) {
  return enumValue(value, options.section ? IMPACT_SECTION_STATUSES : IMPACT_ANALYSIS_STATUSES);
}

export function normalizeImpactFindingState(value) {
  return enumValue(value, IMPACT_FINDING_STATES);
}

export function normalizeEvidenceBasis(value) {
  return enumValue(value, IMPACT_EVIDENCE_BASIS);
}

export function normalizeImpactCompleteness(value = {}) {
  assertRecord(value);
  assertAllowedFields(value, IMPACT_COMPLETENESS_DIMENSIONS);
  const normalized = {};
  for (const dimension of IMPACT_COMPLETENESS_DIMENSIONS) {
    const reasons = value[dimension] ?? [];
    if (!Array.isArray(reasons)) throw invalid();
    normalized[dimension] = normalizeReasonList(reasons, IMPACT_COMPLETENESS_REASONS);
  }
  return normalized;
}

export function normalizeOriginWitnessSummary(value = {}) {
  assertRecord(value);
  assertAllowedFields(value, ["discoveredOriginCount", "retainedOriginWitnessCount", "attributionTruncated", "reasons"]);
  const discoveredOriginCount = normalizeCount(value.discoveredOriginCount ?? 0);
  const retainedOriginWitnessCount = normalizeCount(value.retainedOriginWitnessCount ?? 0);
  if (retainedOriginWitnessCount > discoveredOriginCount) throw invalid();
  const reasons = normalizeReasonList(value.reasons ?? [], ["origin_limit", "witness_budget", "output_byte_limit"]);
  const attributionTruncated = value.attributionTruncated === undefined ? reasons.length > 0 : normalizeOptionalBoolean(value.attributionTruncated);
  if (attributionTruncated && reasons.length === 0) throw invalid();
  if (!attributionTruncated && reasons.length > 0) throw invalid();
  return { discoveredOriginCount, retainedOriginWitnessCount, attributionTruncated, reasons };
}

export function validateCompletedAffectedItem(item) {
  assertRecord(item);
  assertAllowedFields(item, ["path", "origins", "originSummary"]);
  const path = normalizeImpactPath(item.path);
  if (!Array.isArray(item.origins)) throw invalid();
  const origins = item.origins.map(normalizeCompletedOrigin);
  const originSummary = normalizeOriginWitnessSummary(item.originSummary ?? {
    discoveredOriginCount: origins.length,
    retainedOriginWitnessCount: origins.length,
    attributionTruncated: false,
    reasons: []
  });
  if (originSummary.retainedOriginWitnessCount !== origins.length) throw invalid();
  if (originSummary.discoveredOriginCount < origins.length) throw invalid();
  return { path, origins, originSummary };
}

function normalizeCompletedOrigin(origin) {
  assertRecord(origin);
  assertAllowedFields(origin, ["originPath", "minimumDistance", "witness"]);
  const normalized = {
    originPath: normalizeImpactPath(origin.originPath),
    minimumDistance: normalizeCount(origin.minimumDistance),
    witness: normalizeWitness(origin.witness)
  };
  return normalized;
}

function normalizeWitness(witness) {
  assertRecord(witness);
  assertAllowedFields(witness, ["id", "provider", "capability", "relationshipKind", "source", "location", "trust", "basis"]);
  const id = boundedText(witness.id, 128);
  assertRecord(witness.provider);
  assertAllowedFields(witness.provider, ["id", "version"]);
  const provider = { id: boundedText(witness.provider.id, 128), version: boundedText(witness.provider.version, 128) };
  const capability = enumValue(witness.capability, PROVIDER_OPERATIONS);
  const relationshipKind = boundedText(witness.relationshipKind, 128);
  const source = normalizeWitnessSource(witness.source);
  const location = normalizeWitnessLocation(witness.location);
  const trust = enumValue(witness.trust, IMPACT_TRUST_LABELS);
  const basis = normalizeEvidenceBasis(witness.basis);
  return { id, provider, capability, relationshipKind, source, location, trust, basis };
}

function normalizeWitnessSource(source) {
  assertRecord(source);
  assertAllowedFields(source, ["path", "hash"]);
  return { path: normalizeImpactPath(source.path), hash: boundedText(source.hash, 128) };
}

function normalizeWitnessLocation(location) {
  if (location === null) return null;
  assertRecord(location);
  assertAllowedFields(location, ["path", "line", "column"]);
  return {
    path: normalizeImpactPath(location.path),
    line: positiveInteger(location.line),
    column: positiveInteger(location.column)
  };
}

function normalizeImpactWorktree(worktree) {
  assertRecord(worktree);
  assertAllowedFields(worktree, WORKTREE_FIELDS);
  return {
    ...(worktree.rootId === undefined ? {} : { rootId: boundedText(worktree.rootId, 128) }),
    relativePath: normalizeImpactPath(worktree.relativePath)
  };
}

function normalizeImpactPath(value) {
  if (typeof value !== "string" || value.length > 1024 || CONTROL.test(value) || WINDOWS_DRIVE.test(value.trim()) || URI_SCHEME.test(value.trim()) || GLOB_META.test(value)) {
    throw invalid();
  }
  const result = validateRelativeProjectPath(value);
  if (!result.valid) throw invalid();
  return result.relativePath;
}

function normalizeIntegerLimit(value, config, key) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0 || value > config.max) throw invalid();
  if (key !== "depth" && value === 0) throw invalid();
  return value;
}

function normalizeCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) throw invalid();
  return value;
}

function positiveInteger(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
}

function normalizeOptionalBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw invalid();
  return value;
}

function normalizeReasonList(reasons, allowed) {
  return [...new Set(reasons.map((reason) => enumValue(reason, allowed)))].sort(compareStrings);
}

function enumValue(value, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) throw invalid();
  return value;
}

function boundedText(value, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || CONTROL.test(value)) throw invalid();
  return value;
}

function assertRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
}

function assertAllowedFields(object, allowed) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) throw invalid();
  }
}

function canonicalObject(object, orderedKeys) {
  const normalized = {};
  for (const key of orderedKeys) {
    if (Object.hasOwn(object, key)) normalized[key] = object[key];
  }
  return normalized;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

function invalid() {
  return impactError();
}
