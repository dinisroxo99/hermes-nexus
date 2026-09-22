import test from "node:test";
import assert from "node:assert/strict";
import {
  IMPACT_ANALYSIS_STATUSES,
  IMPACT_COMPLETENESS_DIMENSIONS,
  IMPACT_COMPLETENESS_REASONS,
  IMPACT_EVIDENCE_BASIS,
  IMPACT_FINDING_STATES,
  IMPACT_LIMITS,
  IMPACT_SECTION_STATUSES,
  normalizeImpactRequest,
  normalizeImpactCompleteness,
  normalizeImpactFindingState,
  normalizeImpactStatus,
  normalizeEvidenceBasis,
  normalizeOriginWitnessSummary,
  validateCompletedAffectedItem
} from "../src/lib/impact-policy.js";

function invalid(fn) {
  assert.throws(fn, { code: "invalid_impact_request" });
}

test("normalizes one-path and 32-path Impact requests without filesystem access", () => {
  assert.deepEqual(normalizeImpactRequest({ paths: ["src\\A.js"] }), {
    paths: ["src/A.js"],
    includeTests: false,
    limits: Object.fromEntries(Object.entries(IMPACT_LIMITS).map(([key, value]) => [key, value.default]))
  });
  const paths = Array.from({ length: 32 }, (_, i) => `src/${String(i).padStart(2, "0")}.js`).reverse();
  assert.deepEqual(normalizeImpactRequest({ paths }).paths, [...paths].sort());
});

test("rejects malformed, hostile and over-bounded request fields", () => {
  invalid(() => normalizeImpactRequest({ paths: [] }));
  invalid(() => normalizeImpactRequest({ paths: Array.from({ length: 33 }, (_, i) => `f${i}.js`) }));
  for (const path of ["../x.js", "/x.js", "file:///x.js", "https://x.test/a.js", "C:/x.js", "C:x.js", "src/\u0000x.js", "src/\u001fx.js", "src/*.js", "src/{a,b}.js"]) {
    invalid(() => normalizeImpactRequest({ paths: [path] }));
  }
  for (const body of [
    { paths: ["a.js"], extra: true },
    { paths: ["a.js"], projectId: "PrJ_Body" },
    { paths: ["a.js"], revision: "abc" },
    { paths: ["a.js"], repositoryIdentity: "repo" },
    { paths: ["a.js"], provider: { id: "external" } },
    { paths: ["a.js"], providerResponse: {} },
    { paths: ["a.js"], serena: { image: "sha256:bad" } },
    { paths: ["a.js"], command: "rm -rf ." },
    { paths: ["a.js"], executable: "/bin/sh" },
    { paths: ["a.js"], url: "https://example.test" },
    { paths: ["a.js"], root: "/repo" },
    { paths: ["a.js"], policy: "allow" },
    { paths: ["a.js"], scopeMode: "write" },
    { paths: ["a.js"], model: "x" },
    { paths: ["a.js"], profile: "admin" },
    { paths: ["a.js"], limits: { depth: 1, unknown: 2 } }
  ]) invalid(() => normalizeImpactRequest(body));
});

test("deduplicates and ordinally sorts canonical target paths deterministically", () => {
  const first = normalizeImpactRequest({ paths: ["b.js", "a.js", "b.js", "dir\\c.js"] });
  const second = normalizeImpactRequest({ limits: {}, paths: ["dir/c.js", "b.js", "a.js"] });
  assert.deepEqual(first.paths, ["a.js", "b.js", "dir/c.js"]);
  assert.deepEqual(first, second);
  assert.deepEqual(normalizeImpactRequest({ paths: ["ä.js", "z.js"] }).paths, ["z.js", "ä.js"]);
});

test("normalizes limits with strict integers and approved maxima", () => {
  assert.deepEqual(normalizeImpactRequest({ paths: ["a.js"], limits: {
    depth: 0,
    affectedFiles: 250,
    affectedTests: 32,
    diagnostics: 40,
    originWitnessesPerItem: 32,
    originWitnessRecords: 1024,
    traversalVisitedStates: 16000,
    traversalEdgeExaminations: 64000,
    compactBytes: 128 * 1024
  } }).limits, {
    depth: 0,
    affectedFiles: 250,
    affectedTests: 32,
    diagnostics: 40,
    originWitnessesPerItem: 32,
    originWitnessRecords: 1024,
    traversalVisitedStates: 16000,
    traversalEdgeExaminations: 64000,
    compactBytes: 128 * 1024
  });
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    invalid(() => normalizeImpactRequest({ paths: ["a.js"], limits: { depth: value } }));
  }
  invalid(() => normalizeImpactRequest({ paths: ["a.js"], limits: { depth: 6 } }));
});

test("validates status, finding state and evidence basis vocabularies", () => {
  assert.deepEqual(IMPACT_ANALYSIS_STATUSES, ["available", "partial", "unsupported", "unavailable"]);
  assert.deepEqual(IMPACT_SECTION_STATUSES, ["available", "partial", "unsupported", "unavailable", "not_requested"]);
  assert.deepEqual(IMPACT_FINDING_STATES, ["evidence_found", "no_evidence_found", "not_evaluated"]);
  assert.deepEqual(IMPACT_EVIDENCE_BASIS, ["semantic", "structural", "heuristic", "unknown"]);
  for (const status of IMPACT_SECTION_STATUSES) assert.equal(normalizeImpactStatus(status, { section: true }), status);
  for (const state of IMPACT_FINDING_STATES) assert.equal(normalizeImpactFindingState(state), state);
  for (const basis of IMPACT_EVIDENCE_BASIS) assert.equal(normalizeEvidenceBasis(basis), basis);
  assert.throws(() => normalizeImpactStatus("safe"), { code: "invalid_impact_request" });
  assert.throws(() => normalizeImpactFindingState("allowed"), { code: "invalid_impact_request" });
  assert.throws(() => normalizeEvidenceBasis("native"), { code: "invalid_impact_request" });
});

test("completeness dimensions and bounded reasons survive empty partial evidence", () => {
  assert.deepEqual(IMPACT_COMPLETENESS_DIMENSIONS, ["source", "provider", "traversal", "output"]);
  assert.ok(IMPACT_COMPLETENESS_REASONS.includes("output_byte_limit"));
  const completeness = normalizeImpactCompleteness({
    source: ["source_limit", "source_limit"],
    provider: ["provider_partial", "uncovered_language"],
    traversal: ["depth_limit", "traversal_work_limit", "depth_limit"],
    output: ["witness_budget", "output_byte_limit", "origin_limit"]
  });
  assert.deepEqual(completeness.traversal, ["depth_limit", "traversal_work_limit"]);
  const dto = { status: normalizeImpactStatus("partial"), affectedFiles: [], affectedTests: [], evidence: [], completeness };
  assert.equal(dto.status, "partial");
  assert.deepEqual(dto.affectedFiles, []);
  assert.notDeepEqual(dto.completeness, { source: [], provider: [], traversal: [], output: [] });
  assert.throws(() => normalizeImpactCompleteness({ source: ["provider said maybe"] }), { code: "invalid_impact_request" });
});

test("per-origin witness contract is bounded and rejects bare claimed origins", () => {
  const item = {
    path: "src/consumer.js",
    origins: [{
      originPath: "src/source.js",
      minimumDistance: 1,
      witness: {
        id: "w1",
        provider: { id: "native.typescript", version: "1" },
        capability: "references",
        relationshipKind: "references",
        source: { path: "src/source.js", hash: "abc" },
        location: null,
        trust: "derived_analysis",
        basis: "structural"
      }
    }],
    originSummary: {
      discoveredOriginCount: 3,
      retainedOriginWitnessCount: 1,
      attributionTruncated: true,
      reasons: ["origin_limit", "witness_budget", "origin_limit"]
    }
  };
  assert.deepEqual(validateCompletedAffectedItem(item), {
    path: "src/consumer.js",
    origins: item.origins,
    originSummary: {
      discoveredOriginCount: 3,
      retainedOriginWitnessCount: 1,
      attributionTruncated: true,
      reasons: ["origin_limit", "witness_budget"]
    }
  });
  assert.deepEqual(normalizeOriginWitnessSummary({ discoveredOriginCount: 2, retainedOriginWitnessCount: 1, attributionTruncated: true, reasons: ["origin_limit"] }).reasons, ["origin_limit"]);
  assert.throws(() => validateCompletedAffectedItem({ path: "src/consumer.js", origins: [{ originPath: "src/source.js", minimumDistance: 1 }] }), { code: "invalid_impact_request" });
  assert.throws(() => normalizeOriginWitnessSummary({ discoveredOriginCount: 1, retainedOriginWitnessCount: 2, attributionTruncated: false, reasons: [] }), { code: "invalid_impact_request" });
});

test("depth and traversal policy documents future bounded traversal semantics", () => {
  assert.deepEqual(IMPACT_LIMITS.depth.semantics, {
    seedDistance: 0,
    sameFileRelationshipConsumesFileHop: false,
    depthZero: "target_observation_only",
    depthZeroPropagatesAffectedFilesOrTests: false,
    reachingMaximumDepthImpliesTruncation: false,
    depthLimitRequiresKnownEligibleEvidenceBeyondBoundary: true,
    workBudgetExhaustionReason: "traversal_work_limit"
  });
});
