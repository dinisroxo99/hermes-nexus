import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { produceSymbolTargetCompletenessWitness } from "../src/lib/symbol-target-completeness-witness.js";
import { contextDigest, CONTEXT_SOURCE_LIMITS } from "../src/lib/project-context-files.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ETS_PATH = "src/lib/effective-task-scope.js";
const ETS_SHA256 =
  "d4f2a531bf5fd356ea1c88af097f304914541bfb3a480e83381c731978f0271b";
const ADMITTED_COMMIT = "b76dc68ebed71c7d09f3a7ccd53a6c2938a87bc6";
const PROJECT_ID = "prj_synthetic";
const REPOSITORY_ID = "ab".repeat(32);
const WORKTREE_ID = "cd".repeat(32);
const ROOT_ID = "root_synthetic";
const RELATIVE_PATH = "apps/synthetic";

const FIXTURE_TWO_TOP_LEVEL_FOO = [
  "// synthetic fixture: two top-level function declarations named foo",
  "function foo() {",
  "  return 1;",
  "}",
  "function foo() {",
  "  return 2;",
  "}",
  ""
].join("\n");

const FIXTURE_NO_FOO = "export const other = 1;\n";

const FIXTURE_TRUNCATED = [
  "// synthetic fixture: truncated / invalid source",
  "export function foo() {"
].join("\n");

const FIXTURE_SINGLE_FOO = [
  "// synthetic fixture: exactly one declaration of foo",
  "export function foo() {",
  "  return 1;",
  "}",
  ""
].join("\n");

const REQUIRED_ARCHW_KEYS = [
  "kind",
  "producerIdentity",
  "version",
  "createdAt",
  "admittedCommit",
  "projectId",
  "repositoryId",
  "worktreeId",
  "snapshotToken",
  "sourceHashes",
  "taskPaths",
  "claimedDomains",
  "pathCoverage",
  "requiredNames",
  "nameListTruncated",
  "evaluations",
  "failClosedMatrix",
  "completenessHolds",
  "completenessDefinitionNote",
  "uniquenessHolds",
  "compositionRule",
  "a1AloneInsufficientForNogo2",
  "a1AloneInsufficient",
  "a1Citations",
  "nonSatisfiers",
  "hardFlags",
  "nonAuthorization"
];

function loadRealEtsBytes() {
  return readFileSync(join(ROOT, ETS_PATH), "utf8");
}

function adapterCollection(files, { truncated = false } = {}) {
  const list = Array.isArray(files) ? files : [];
  return {
    limits: {
      maxDepth: CONTEXT_SOURCE_LIMITS.maxDepth,
      maxEntries: CONTEXT_SOURCE_LIMITS.maxEntries,
      maxFiles: CONTEXT_SOURCE_LIMITS.maxFiles,
      maxFileBytes: CONTEXT_SOURCE_LIMITS.maxFileBytes,
      maxTotalBytes: CONTEXT_SOURCE_LIMITS.maxTotalBytes
    },
    truncated: truncated === true,
    diagnostics: [],
    digest: contextDigest(JSON.stringify(list.map((f) => [f.path, f.sha256])))
  };
}

function standardRevision(overrides = {}) {
  return {
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    status: "available",
    commitSha: "11".repeat(20),
    branch: null,
    dirty: false,
    isLinkedWorktree: true,
    ...overrides
  };
}

function buildLiveGoldenBinding(fileContents, taskPaths, { truncated = false, revisionOverrides = {} } = {}) {
  const revision = standardRevision(revisionOverrides);
  const ordered = taskPaths.map((path) => ({ path, text: fileContents[path] }));
  const produced = createProviderSnapshot({ projectId: PROJECT_ID }, ordered, revision);
  const files = produced.files.map((f) => ({
    path: f.path,
    text: f.text,
    byteSize: f.byteSize,
    sha256: f.sha256
  }));
  return {
    revision,
    produced,
    sourceHashes: Object.fromEntries(files.map((f) => [f.path, f.sha256])),
    snapshotToken: produced.token,
    observation: {
      project: {
        projectId: PROJECT_ID,
        rootId: ROOT_ID,
        relativePath: RELATIVE_PATH
      },
      snapshot: {
        schemaVersion: produced.schemaVersion,
        projectId: produced.projectId,
        token: produced.token,
        revision: { ...produced.revision },
        languages: produced.languages.slice(),
        files
      },
      collection: adapterCollection(files, { truncated })
    }
  };
}

function scoreP1(witness) {
  const accept = Array(26).fill(false);
  const reject = Array(14).fill(false);

  const ns = witness.nonSatisfiers ?? [];
  const na = witness.nonAuthorization ?? [];
  const hf = witness.hardFlags ?? {};
  const matrix = witness.failClosedMatrix ?? {};
  const citations = witness.a1Citations ?? [];
  const evals = witness.evaluations ?? [];

  accept[0] = witness.a1AloneInsufficientForNogo2 === true
    && witness.a1AloneInsufficient === true;

  accept[1] = citations.length > 0 && citations.every((c) =>
    c.entryPoint === "resolveTypeScriptDeclarationEvidence"
    && c.schemaVersion === 1
    && c.analysisVersion === "symbol-resolution-evidence-v1"
    && c.policyVersion === "tsjs-direct-declarations-1"
  );

  accept[2] = witness.a1AloneInsufficient === true
    && witness.a1AloneInsufficientForNogo2 === true;

  accept[3] = witness.compositionRule
    === "uniqueness_holds_for_domain_of_evaluated_names AND completeness_obligations_1_through_4_hold";

  accept[4] = Array.isArray(witness.taskPaths) && witness.taskPaths.length > 0;

  accept[5] = typeof witness.snapshotToken === "string"
    && typeof witness.projectId === "string"
    && typeof witness.repositoryId === "string"
    && typeof witness.worktreeId === "string"
    && typeof witness.admittedCommit === "string"
    && !!witness.sourceHashes;

  accept[6] = Array.isArray(witness.claimedDomains)
    && witness.claimedDomains.length > 0
    && Array.isArray(witness.pathCoverage)
    && witness.taskPaths.every((p) =>
      witness.pathCoverage.some((e) => e.path === p
        && ["covered", "uncovered_language", "unevaluated"].includes(e.status)));

  accept[7] = matrix.partialImpliesCompletenessFalse === true;
  accept[8] = matrix.truncatedImpliesCompletenessFalse === true;
  accept[9] = matrix.uncoveredLanguageImpliesCompletenessFalse === true;
  accept[10] = matrix.bindingMismatchImpliesCompletenessFalse === true;

  accept[11] = Array.isArray(witness.requiredNames)
    && witness.requiredNames.every((n) => evals.some((e) => e.name === n));

  accept[12] = !(witness.completenessHolds === true
    && evals.length < (witness.requiredNames?.length ?? 0));

  accept[13] = evals.every((e) =>
    ["unique", "not_found", "unevaluated", "ambiguous"].includes(e.outcome));

  accept[14] = true;
  accept[15] = accept[6];
  accept[16] = accept[11];

  accept[17] = witness.nameListTruncated === false
    || (witness.nameListTruncated === true && witness.completenessHolds === false);

  accept[18] = witness.completenessDefinitionNote
    === "completeness = all required names evaluated under fail-closed rules — NOT all unique";

  accept[19] = accept[3];

  const needNs = [
    "Context Pack retained symbols/rows",
    "Impact imports",
    "Impact uses",
    "Impact references",
    "Impact minimumDistance",
    "Bare declaration-count / text search / export function greps",
    "Flat resolveTrackA1 outcomes alone"
  ];
  accept[20] = needNs.every((s) => ns.includes(s));

  accept[21] = accept[1];
  accept[22] = witness.a1AloneInsufficient === true;

  accept[23] = hf.IMPLEMENTATION_AUTHORIZED === "NO"
    && hf.SLICE4 === "NOT_STARTED"
    && hf.STEP4_SLICE4_READY_TO_IMPLEMENT === "NO"
    && hf.confinementFlipped === false;

  accept[24] = na.some((x) => /ETS|composeEffectiveTaskScope|HTTP/i.test(x))
    && na.some((x) => /Slice 4/i.test(x))
    && na.some((x) => /A0\/A2/i.test(x))
    && na.some((x) => /conflict/i.test(x))
    && na.some((x) => /guard/i.test(x));

  accept[25] = hf.pr53ReservedUntouched === true
    && hf.trackBUntouched === true
    && na.some((x) => /PR #53|Track B/i.test(x));

  reject[0] = witness.a1AloneInsufficientForNogo2 !== true;
  reject[1] = !ns.includes("Flat resolveTrackA1 outcomes alone");
  reject[2] = !ns.includes("Context Pack retained symbols/rows");
  reject[3] = !(ns.includes("Impact imports") && ns.includes("Impact uses")
    && ns.includes("Impact references") && ns.includes("Impact minimumDistance"));
  reject[4] = witness.nameListTruncated === true && witness.completenessHolds === true;
  reject[5] = witness.nameListTruncated === true && witness.completenessHolds === true;
  reject[6] = false;
  reject[7] = false;
  reject[8] = witness.completenessDefinitionNote
    !== "completeness = all required names evaluated under fail-closed rules — NOT all unique";
  reject[9] = !accept[3];
  reject[10] = !accept[24];
  reject[11] = hf.IMPLEMENTATION_AUTHORIZED === "YES"
    || hf.SLICE4 === "STARTED"
    || hf.STEP4_SLICE4_READY_TO_IMPLEMENT === "YES"
    || hf.confinementFlipped === true;
  reject[12] = hf.pr53ReservedUntouched !== true || hf.trackBUntouched !== true;
  reject[13] = !REQUIRED_ARCHW_KEYS.every((k) => Object.hasOwn(witness, k));

  return {
    accept,
    reject,
    acceptAllTrue: accept.every(Boolean),
    rejectAllFalse: reject.every((v) => v === false)
  };
}

function assertArchWShape(witness) {
  for (const key of REQUIRED_ARCHW_KEYS) {
    assert.equal(Object.hasOwn(witness, key), true, `missing ArchW key: ${key}`);
  }
  assert.equal(witness.kind, "symbol-target-completeness-witness");
  assert.equal(
    witness.producerIdentity,
    "hermes-nexus-in-repo-symbol-target-completeness-witness"
  );
  assert.equal(witness.version, "symbol-target-completeness-witness-v1");
  assert.equal(witness.hardFlags.IMPLEMENTATION_AUTHORIZED, "NO");
  assert.equal(witness.hardFlags.SLICE4, "NOT_STARTED");
  assert.equal(witness.hardFlags.STEP4_SLICE4_READY_TO_IMPLEMENT, "NO");
  assert.equal(witness.hardFlags.confinementFlipped, false);
  assert.equal(witness.hardFlags.pr53ReservedUntouched, true);
  assert.equal(witness.hardFlags.trackBUntouched, true);
  assert.equal(witness.a1AloneInsufficient, true);
  assert.equal(witness.a1AloneInsufficientForNogo2, true);
  assert.deepEqual(witness.failClosedMatrix, {
    partialImpliesCompletenessFalse: true,
    truncatedImpliesCompletenessFalse: true,
    uncoveredLanguageImpliesCompletenessFalse: true,
    bindingMismatchImpliesCompletenessFalse: true
  });
  assert.ok(!witness.nonAuthorization.some((x) =>
    x === "in-repo producer / src/ / docs/ / feature branch writes for this witness"
  ));
}

function assertHardFlagsUnchanged(witness) {
  assert.equal(witness.hardFlags.IMPLEMENTATION_AUTHORIZED, "NO");
  assert.equal(witness.hardFlags.SLICE4, "NOT_STARTED");
  assert.equal(witness.hardFlags.STEP4_SLICE4_READY_TO_IMPLEMENT, "NO");
  assert.equal(witness.hardFlags.confinementFlipped, false);
}

function goldenRequest(overrides = {}) {
  const etsText = loadRealEtsBytes();
  const fileContents = { [ETS_PATH]: etsText };
  const taskPaths = [ETS_PATH];
  const live = buildLiveGoldenBinding(fileContents, taskPaths);
  return {
    taskPaths,
    requiredNames: ["composeEffectiveTaskScope"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    taskId: "task_completeness_golden",
    live,
    ...overrides
  };
}

test("golden: real ETS bytes + live resolveTypeScriptDeclarationEvidence", () => {
  const etsText = loadRealEtsBytes();
  const digest = createHash("sha256").update(etsText, "utf8").digest("hex");
  assert.equal(digest, ETS_SHA256, "worktree ETS bytes must match pinned digest");

  const req = goldenRequest();
  const { live, ...request } = req;
  const witness = produceSymbolTargetCompletenessWitness(request);

  assertArchWShape(witness);
  assert.equal(witness.completenessHolds, true);
  assert.equal(witness.uniquenessHolds, true);
  assert.equal(witness.nameListTruncated, false);
  assert.equal(witness.admittedCommit, ADMITTED_COMMIT);
  assert.deepEqual(witness.taskPaths, [ETS_PATH]);
  assert.deepEqual(witness.requiredNames, ["composeEffectiveTaskScope"]);
  assert.deepEqual(witness.pathCoverage, [{ path: ETS_PATH, status: "covered" }]);
  assert.equal(witness.evaluations.length, 1);
  assert.equal(witness.evaluations[0].name, "composeEffectiveTaskScope");
  assert.equal(witness.evaluations[0].outcome, "unique");
  assert.equal(
    witness.evaluations[0].a1Citation.entryPoint,
    "resolveTypeScriptDeclarationEvidence"
  );
  assert.equal(witness.evaluations[0].a1Citation.schemaVersion, 1);
  assert.equal(
    witness.evaluations[0].a1Citation.analysisVersion,
    "symbol-resolution-evidence-v1"
  );
  assert.equal(
    witness.evaluations[0].a1Citation.policyVersion,
    "tsjs-direct-declarations-1"
  );
  assert.equal(witness.evaluations[0].a1Citation.runStatus, "resolved_unique");
  assert.equal(witness.evaluations[0].a1Citation.evidenceComplete, true);
  assert.ok(witness.a1Citations.length >= 1);
  assert.equal(witness.sourceHashes[ETS_PATH], ETS_SHA256);
  assert.equal(witness.snapshotToken, live.snapshotToken);
  assert.equal(
    witness.claimedDomains[0],
    "typescript-javascript-direct-declarations-tsjs-direct-declarations-1"
  );

  const scored = scoreP1(witness);
  assert.equal(
    scored.acceptAllTrue,
    true,
    `Accept miss at ${scored.accept.map((v, i) => (v ? null : i + 1)).filter(Boolean)}`
  );
  assert.equal(
    scored.rejectAllFalse,
    true,
    `Reject hit at ${scored.reject.map((v, i) => (v ? i + 1 : null)).filter(Boolean)}`
  );
});

test("negative: truncated name list fails closed", () => {
  const { live, ...base } = goldenRequest({ nameListTruncated: true });
  void live;
  const witness = produceSymbolTargetCompletenessWitness(base);
  assert.equal(witness.nameListTruncated, true);
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.failClosedMatrix.truncatedImpliesCompletenessFalse, true);
  assert.equal(witness.evaluations[0].outcome, "unevaluated");
  assert.equal(witness.evaluations[0].reason, "name_list_truncated");
  assert.equal(witness.hardFlags.IMPLEMENTATION_AUTHORIZED, "NO");
});

test("negative: binding mismatch on snapshotToken fails closed", () => {
  const { live, ...base } = goldenRequest({
    snapshotToken: "0".repeat(64)
  });
  void live;
  const witness = produceSymbolTargetCompletenessWitness(base);
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.uniquenessHolds, false);
  assert.equal(witness.failClosedMatrix.bindingMismatchImpliesCompletenessFalse, true);
  assert.ok(
    witness.evaluations.every((e) => e.outcome === "unevaluated")
  );
  assert.equal(witness.provenance?.bindingMismatchReason, "snapshotToken_mismatch");
});

test("negative: binding mismatch on sourceHashes fails closed", () => {
  const { live, ...base } = goldenRequest();
  const witness = produceSymbolTargetCompletenessWitness({
    ...base,
    sourceHashes: { [ETS_PATH]: "f".repeat(64) }
  });
  void live;
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.provenance?.bindingMismatchReason, "sourceHashes_mismatch");
});

test("negative: missing required binding does not invent ids", () => {
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [ETS_PATH],
    requiredNames: ["composeEffectiveTaskScope"]
  });
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.uniquenessHolds, false);
  assert.equal(Object.hasOwn(witness, "projectId"), false);
  assert.equal(Object.hasOwn(witness, "snapshotToken"), false);
  assert.equal(Object.hasOwn(witness, "admittedCommit"), false);
  assert.equal(witness.hardFlags.IMPLEMENTATION_AUTHORIZED, "NO");
});

test("negative: uncovered_language path fails closed", () => {
  const pyPath = "src/lib/notes.py";
  const pyText = "def composeEffectiveTaskScope():\n    return 1\n";
  const fileContents = { [pyPath]: pyText };
  const live = buildLiveGoldenBinding(fileContents, [pyPath]);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [pyPath],
    requiredNames: ["composeEffectiveTaskScope"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.deepEqual(witness.pathCoverage, [{ path: pyPath, status: "uncovered_language" }]);
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.failClosedMatrix.uncoveredLanguageImpliesCompletenessFalse, true);
  assert.equal(witness.evaluations[0].outcome, "unevaluated");
  assert.equal(witness.evaluations[0].reason, "uncovered_language");
});

test("negative: partial/unevaluated upgrade attempt fails closed", () => {
  const { live, ...base } = goldenRequest({
    nameListTruncated: true,
    forceCompletenessHolds: true,
    claimCompletenessDespiteFailClosed: true
  });
  void live;
  const witness = produceSymbolTargetCompletenessWitness(base);
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.failClosedMatrix.partialImpliesCompletenessFalse, true);
});

test("negative: nonSatisfiers reject flat resolveTrackA1 / Context Pack / Impact", () => {
  const { live, ...base } = goldenRequest();
  void live;
  const witness = produceSymbolTargetCompletenessWitness(base);
  const ns = witness.nonSatisfiers;
  assert.ok(ns.includes("Flat resolveTrackA1 outcomes alone"));
  assert.ok(ns.includes("Context Pack retained symbols/rows"));
  assert.ok(ns.includes("Impact imports"));
  assert.ok(ns.includes("Impact uses"));
  assert.ok(ns.includes("Impact references"));
  assert.ok(ns.includes("Impact minimumDistance"));
  assert.ok(ns.includes("Bare declaration-count / text search / export function greps"));
});

test("negative: observation-only fixture with forged token fails closed", () => {
  const etsText = loadRealEtsBytes();
  const fileContents = { [ETS_PATH]: etsText };
  const live = buildLiveGoldenBinding(fileContents, [ETS_PATH]);
  const forged = structuredClone(live.observation);
  forged.snapshot.token = "1".repeat(64);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [ETS_PATH],
    requiredNames: ["composeEffectiveTaskScope"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    observation: forged,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.provenance?.bindingMismatchReason, "snapshotToken_mismatch");
});

test("arch matrix 1: collection.truncated=true fails closed via live A1", () => {
  const path = "src/lib/matrix-trunc.js";
  const fileContents = { [path]: FIXTURE_SINGLE_FOO };
  const live = buildLiveGoldenBinding(fileContents, [path], { truncated: true });
  assert.equal(live.observation.collection.truncated, true);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [path],
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    observation: live.observation,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.equal(witness.completenessHolds, false);
  assert.notEqual(witness.uniquenessHolds, true);
  assert.equal(witness.failClosedMatrix.truncatedImpliesCompletenessFalse, true);
  assert.ok(witness.evaluations.every((e) => e.a1Citation.evidenceComplete !== true));
  assertHardFlagsUnchanged(witness);
});

test("arch matrix 2: incomplete parsing fails closed via live A1", () => {
  const path = "src/lib/matrix-incomplete-parse.js";
  const fileContents = { [path]: FIXTURE_TRUNCATED };
  const live = buildLiveGoldenBinding(fileContents, [path]);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [path],
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.equal(witness.completenessHolds, false);
  assert.notEqual(witness.uniquenessHolds, true);
  assert.equal(witness.evaluations[0].outcome, "unevaluated");
  assert.equal(witness.evaluations[0].a1Citation.evidenceComplete, false);
  assert.equal(witness.evaluations[0].a1Citation.runStatus, "partial");
  assertHardFlagsUnchanged(witness);
});

test("arch matrix 3: ambiguous with partial coverage fails closed via live A1", () => {
  const path = "src/lib/matrix-ambiguous-partial.js";
  const fileContents = { [path]: FIXTURE_TWO_TOP_LEVEL_FOO };
  const live = buildLiveGoldenBinding(fileContents, [path], { truncated: true });
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [path],
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    observation: live.observation,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.uniquenessHolds, false);
  assert.equal(witness.evaluations[0].outcome, "ambiguous");
  assert.equal(witness.evaluations[0].a1Citation.evidenceComplete, false);
  assert.equal(witness.evaluations[0].a1Citation.runStatus, "ambiguous");
  assert.equal(witness.evaluations[0].a1Citation.completeness?.source, "partial");
  assertHardFlagsUnchanged(witness);
});

test("arch matrix 4: contradictory repositoryId/worktreeId on observation and fileContents paths", () => {
  const path = "src/lib/matrix-binding.js";
  const fileContents = { [path]: FIXTURE_SINGLE_FOO };
  const live = buildLiveGoldenBinding(fileContents, [path]);

  const badRepo = "ef".repeat(32);
  const badWorktree = "01".repeat(32);

  const obsWitness = produceSymbolTargetCompletenessWitness({
    taskPaths: [path],
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: badRepo,
    worktreeId: badWorktree,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    observation: live.observation,
    revision: {
      ...live.revision,
      repositoryId: badRepo,
      worktreeId: badWorktree
    },
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.equal(obsWitness.completenessHolds, false);
  assert.equal(obsWitness.uniquenessHolds, false);
  assert.equal(
    obsWitness.provenance?.bindingMismatchReason,
    "repository_or_worktree_mismatch"
  );
  assertHardFlagsUnchanged(obsWitness);

  const fcRevision = {
    ...live.revision,
    repositoryId: badRepo,
    worktreeId: badWorktree
  };
  const fcLive = buildLiveGoldenBinding(fileContents, [path], {
    revisionOverrides: { repositoryId: badRepo, worktreeId: badWorktree }
  });
  const fcWitness = produceSymbolTargetCompletenessWitness({
    taskPaths: [path],
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: fcLive.snapshotToken,
    sourceHashes: fcLive.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: fcRevision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.equal(fcWitness.completenessHolds, false);
  assert.equal(fcWitness.uniquenessHolds, false);
  assert.equal(
    fcWitness.provenance?.bindingMismatchReason,
    "repository_or_worktree_mismatch"
  );
  assert.notEqual(fcRevision.repositoryId, REPOSITORY_ID);
  assertHardFlagsUnchanged(fcWitness);
});

test("arch matrix 5: missing revision/location without observation is not established", () => {
  const path = "src/lib/matrix-missing-rev.js";
  const fileContents = { [path]: FIXTURE_SINGLE_FOO };
  const live = buildLiveGoldenBinding(fileContents, [path]);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [path],
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents
  });
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.uniquenessHolds, false);
  assert.equal(
    witness.provenance?.bindingMismatchReason,
    "revision_or_location_unavailable"
  );
  const serialized = JSON.stringify(witness);
  assert.equal(serialized.includes("root_synthetic"), false);
  assert.equal(serialized.includes("apps/synthetic"), false);
  assert.equal(serialized.includes("11".repeat(20)), false);
  assertHardFlagsUnchanged(witness);
});

test("arch matrix 6: complete not_found and complete ambiguous hold completeness not uniqueness", () => {
  const path = "src/lib/matrix-complete-mixed.js";
  const fileContents = { [path]: FIXTURE_TWO_TOP_LEVEL_FOO };
  const live = buildLiveGoldenBinding(fileContents, [path]);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths: [path],
    requiredNames: ["foo", "bar"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  });
  assert.equal(witness.completenessHolds, true);
  assert.equal(witness.uniquenessHolds, false);
  const byName = Object.fromEntries(witness.evaluations.map((e) => [e.name, e]));
  assert.equal(byName.foo.outcome, "ambiguous");
  assert.equal(byName.bar.outcome, "not_found");
  assert.equal(byName.foo.a1Citation.evidenceComplete, true);
  assert.equal(byName.bar.a1Citation.evidenceComplete, true);
  assert.equal(byName.foo.a1Citation.runStatus, "ambiguous");
  assert.equal(byName.bar.a1Citation.runStatus, "not_found");
  assertHardFlagsUnchanged(witness);
});

test("pathStatusOverrides unknown partial refuse: two-file ambiguous must not become unique", () => {
  const pathA = "src/lib/override-partial-a.js";
  const pathB = "src/lib/override-partial-b.js";
  const fileContents = {
    [pathA]: FIXTURE_SINGLE_FOO,
    [pathB]: FIXTURE_SINGLE_FOO
  };
  const taskPaths = [pathA, pathB];
  const live = buildLiveGoldenBinding(fileContents, taskPaths);
  const baseRequest = {
    taskPaths,
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH }
  };

  const control = produceSymbolTargetCompletenessWitness(baseRequest);
  assert.equal(control.completenessHolds, true);
  assert.equal(control.uniquenessHolds, false);
  assert.equal(control.evaluations[0].outcome, "ambiguous");
  assert.equal(control.evaluations[0].a1Citation.runStatus, "ambiguous");
  assert.equal(control.version, "symbol-target-completeness-witness-v1");
  assertHardFlagsUnchanged(control);

  const treatment = produceSymbolTargetCompletenessWitness({
    ...baseRequest,
    pathStatusOverrides: { [pathB]: "partial" }
  });
  assert.equal(treatment.completenessHolds, false);
  assert.equal(treatment.uniquenessHolds, false);
  assert.notEqual(treatment.evaluations[0].outcome, "unique");
  assert.equal(treatment.evaluations[0].outcome, "unevaluated");
  assert.equal(
    treatment.provenance?.bindingMismatchReason,
    `invalid_path_status_override:${pathB}:partial`
  );
  assert.equal(treatment.evaluations[0].reason, `invalid_path_status_override:${pathB}:partial`);
  const byPath = Object.fromEntries(treatment.pathCoverage.map((e) => [e.path, e.status]));
  assert.equal(byPath[pathA], "covered");
  assert.equal(byPath[pathB], "unevaluated");
  assert.equal(Object.values(byPath).includes("partial"), false);
  assert.equal(treatment.version, "symbol-target-completeness-witness-v1");
  assertHardFlagsUnchanged(treatment);
});

test("pathStatusOverrides known-good unevaluated fails closed without invalid-override reason", () => {
  const pathA = "src/lib/override-unevaluated-a.js";
  const pathB = "src/lib/override-unevaluated-b.js";
  const fileContents = {
    [pathA]: FIXTURE_SINGLE_FOO,
    [pathB]: FIXTURE_SINGLE_FOO
  };
  const taskPaths = [pathA, pathB];
  const live = buildLiveGoldenBinding(fileContents, taskPaths);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths,
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    pathStatusOverrides: { [pathB]: "unevaluated" }
  });
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.uniquenessHolds, false);
  assert.equal(witness.evaluations[0].outcome, "unevaluated");
  assert.equal(witness.evaluations[0].reason, "path_unevaluated");
  assert.notEqual(
    witness.provenance?.bindingMismatchReason?.startsWith("invalid_path_status_override:"),
    true
  );
  assert.equal(
    witness.pathCoverage.find((e) => e.path === pathB)?.status,
    "unevaluated"
  );
  assertHardFlagsUnchanged(witness);
});

test("pathStatusOverrides known-good uncovered_language fails closed", () => {
  const pathA = "src/lib/override-uncovered-a.js";
  const pathB = "src/lib/override-uncovered-b.js";
  const fileContents = {
    [pathA]: FIXTURE_SINGLE_FOO,
    [pathB]: FIXTURE_SINGLE_FOO
  };
  const taskPaths = [pathA, pathB];
  const live = buildLiveGoldenBinding(fileContents, taskPaths);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths,
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    pathStatusOverrides: { [pathB]: "uncovered_language" }
  });
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.uniquenessHolds, false);
  assert.equal(witness.evaluations[0].outcome, "unevaluated");
  assert.equal(witness.evaluations[0].reason, "uncovered_language");
  assert.equal(
    witness.pathCoverage.find((e) => e.path === pathB)?.status,
    "uncovered_language"
  );
  assertHardFlagsUnchanged(witness);
});

test("pathStatusOverrides non-string value refuses like unknown string", () => {
  const pathA = "src/lib/override-nonstr-a.js";
  const pathB = "src/lib/override-nonstr-b.js";
  const fileContents = {
    [pathA]: FIXTURE_SINGLE_FOO,
    [pathB]: FIXTURE_SINGLE_FOO
  };
  const taskPaths = [pathA, pathB];
  const live = buildLiveGoldenBinding(fileContents, taskPaths);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths,
    requiredNames: ["foo"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    pathStatusOverrides: { [pathB]: 1 }
  });
  assert.equal(witness.completenessHolds, false);
  assert.equal(witness.uniquenessHolds, false);
  assert.notEqual(witness.evaluations[0].outcome, "unique");
  assert.equal(
    witness.provenance?.bindingMismatchReason,
    `invalid_path_status_override:${pathB}:1`
  );
  assert.equal(
    witness.pathCoverage.find((e) => e.path === pathB)?.status,
    "unevaluated"
  );
  assertHardFlagsUnchanged(witness);
});
