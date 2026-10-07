import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { composeEffectiveTaskScope } from "../src/lib/effective-task-scope.js";
import {
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  evaluateSymbolTargetCompletenessWitness,
  normalizeSymbolTargetCompletenessWitness
} from "../src/lib/effective-task-scope-policy.js";
import { produceSymbolTargetCompletenessWitness } from "../src/lib/symbol-target-completeness-witness.js";
import { contextDigest, CONTEXT_SOURCE_LIMITS } from "../src/lib/project-context-files.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ETS_PATH = "src/lib/effective-task-scope.js";
const PROJECT_ID = "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd";
const REPOSITORY_ID = "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529";
const WORKTREE_ID = "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d";
const COMMIT_SHA = "618718247352fa6ae5e2a530c209845ef43e7378";
const BRANCH = "feat/step4-slice1-ets-v2";
const ROOT_ID = "local";
const RELATIVE_PATH = "hermes-nexus-step4-slice1-write";
const ADMITTED_COMMIT = "4741b82ce4dcc46451a82a1f1100d83a7693ffb6";

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

function buildLiveBinding(fileContents, taskPaths) {
  const revision = {
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    status: "available",
    commitSha: COMMIT_SHA,
    branch: BRANCH,
    dirty: false,
    isLinkedWorktree: true
  };
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
      collection: adapterCollection(files)
    }
  };
}

function produceBoundWitness({ requiredNames = ["composeEffectiveTaskScope"], overrides = {} } = {}) {
  const etsText = loadRealEtsBytes();
  const fileContents = { [ETS_PATH]: etsText };
  const taskPaths = [ETS_PATH];
  const live = buildLiveBinding(fileContents, taskPaths);
  const request = {
    taskPaths,
    requiredNames,
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    taskId: "task_ets_symbol_consume",
    ...overrides
  };
  const witness = produceSymbolTargetCompletenessWitness(request);
  return { witness, live, etsText, snapshotToken: live.snapshotToken };
}

function buildPackImpactRequest({ symbols, snapshotToken, paths = [ETS_PATH], sourceHashes = null }) {
  const sortedPaths = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const sortedSymbols = [...new Set(symbols)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const request = {
    task: {
      id: "t_symbol_consume",
      title: "Slice4 bounded ETS symbol consume",
      paths: sortedPaths,
      symbols: sortedSymbols
    },
    projectId: PROJECT_ID,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    expectedRevision: {
      status: "available",
      commitSha: COMMIT_SHA,
      branch: BRANCH,
      dirty: false,
      isLinkedWorktree: true,
      repositoryId: REPOSITORY_ID,
      worktreeId: WORKTREE_ID
    },
    includeTests: false
  };

  const fileItems = sourceHashes
    ? sortedPaths.map((p) => ({
      path: p,
      provenance: {
        trust: "canonical_fact",
        reason: "task_path",
        source: { path: p, sha256: sourceHashes[p] }
      }
    }))
    : [];

  const pack = {
    schemaVersion: 1,
    analysisVersion: "task-context-v1",
    contextPackId: "context_symbol_consume_pack_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: PROJECT_ID,
    project: { name: "hermes-project-map", rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    revision: {
      status: "available",
      commitSha: COMMIT_SHA,
      branch: BRANCH,
      dirty: false,
      repositoryIdentity: REPOSITORY_ID,
      worktreeId: WORKTREE_ID,
      isLinkedWorktree: true
    },
    analysis: {
      schemaVersion: 1,
      status: "partial",
      snapshotToken,
      provider: { id: "native.typescript", version: "1" }
    },
    observation: {
      basis: "working_tree",
      incomplete: true,
      sourceDigest: "fd20451a9bd4547d01377c4afe1d75127659212703e2a903f75f839250cb8850"
    },
    sections: {
      task: {
        items: [{
          id: request.task.id,
          title: request.task.title,
          paths: sortedPaths,
          symbols: sortedSymbols
        }],
        status: "available"
      },
      workspaces: { items: [], status: "empty" },
      documents: { items: [], status: "empty" },
      constraints: { items: [], status: "empty" },
      files: sourceHashes
        ? { items: fileItems, status: "available" }
        : { items: [], status: "empty" },
      symbols: { items: [], status: "partial" },
      references: { items: [], status: "partial" },
      tests: { items: [], status: "empty" },
      diagnostics: { items: [], status: "available" },
      policy: { items: [], status: "available" }
    },
    limits: { maxBytes: 65536 }
  };

  const fallbackHash = createHash("sha256").update(ETS_PATH, "utf8").digest("hex");
  const impact = {
    schemaVersion: 1,
    analysisVersion: "impact-v2",
    projectId: PROJECT_ID,
    project: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    targets: sortedPaths.map((p) => ({
      originPath: p,
      targetSource: { path: p, hash: (sourceHashes && sourceHashes[p]) || fallbackHash },
      status: "partial",
      findingState: "evidence_found",
      completeness: { source: ["source_limit"], provider: ["provider_partial"] }
    })),
    revision: {
      status: "available",
      commitSha: COMMIT_SHA,
      branch: BRANCH,
      repositoryId: REPOSITORY_ID,
      worktreeId: WORKTREE_ID,
      dirty: false,
      isLinkedWorktree: true
    },
    snapshotToken,
    provider: { id: "native.typescript", version: "1" },
    coverage: { observed: ["javascript"], covered: ["javascript"], uncovered: [] },
    observation: { basis: "working_tree", incomplete: true },
    limits: { depth: 2, affectedFiles: 80, compactBytes: 65536 },
    status: "partial",
    findingState: "evidence_found",
    affectedFiles: [],
    affectedTests: {
      status: "not_requested",
      findingState: "not_requested",
      candidates: []
    },
    completeness: { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: [] }
  };

  return { request, pack, impact };
}

function cloneWitness(witness) {
  return JSON.parse(JSON.stringify(witness));
}

test("T1 success: real producer+A1 witness lifts symbol gate; WRITEsubseteq explicit paths", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  assert.equal(witness.completenessHolds, true);
  assert.equal(witness.uniquenessHolds, true);
  assert.equal(witness.hardFlags.IMPLEMENTATION_AUTHORIZED, "NO");
  assert.equal(witness.hardFlags.SLICE4, "NOT_STARTED");
  assert.equal(witness.hardFlags.STEP4_SLICE4_READY_TO_IMPLEMENT, "NO");

  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  assert.equal(
    pack.sections.files.items[0].provenance.source.sha256,
    witness.sourceHashes[ETS_PATH]
  );
  assert.equal(impact.targets[0].targetSource.hash, witness.sourceHashes[ETS_PATH]);
  const res = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: witness
  });

  assert.equal(EFFECTIVE_TASK_SCOPE_POLICY_VERSION, "step4-foundation-3");
  assert.equal(res.policyVersion, "step4-foundation-3");
  assert.equal(res.schemaVersion, 2);
  assert.equal(res.analysisVersion, "effective-task-scope-v2");
  assert.ok(!res.reasons.some((r) => r.code === "symbol_targets_not_supported"));
  assert.ok(!res.reasons.some((r) => String(r.code || "").startsWith("symbol_target_")));
  assert.ok(res.status === "incomplete" || res.status === "available");
  assert.ok(res.write);
  assert.equal(res.write.status, "available");
  const writePaths = res.write.items.map((i) => i.target.path).sort();
  assert.deepEqual(writePaths, [ETS_PATH]);
  assert.ok(res.write.items.every((i) => i.target.kind === "file"));
  assert.ok(res.write.items.every((i) => !(i.target.kind === "symbol")));
  assert.deepEqual(res.task.symbols, ["composeEffectiveTaskScope"]);
  assert.deepEqual(res.task.paths, [ETS_PATH]);
});

test("T2 refuse incomplete: completenessHolds=false", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const bad = cloneWitness(witness);
  bad.completenessHolds = false;
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  const res = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: bad
  });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some((r) => r.code === "symbol_target_completeness_not_established"));
  assert.ok(!("write" in res));
});

test("T3 refuse non-unique: uniquenessHolds=false", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const bad = cloneWitness(witness);
  bad.uniquenessHolds = false;
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  const res = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: bad
  });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some((r) => r.code === "symbol_target_uniqueness_not_established"));
  assert.ok(!("write" in res));
});

test("T4 refuse binding mismatch: paths/symbols/ids/snapshot diverge", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });

  const cases = [
    { label: "symbols", mutate: (w) => { w.requiredNames = ["otherName"]; } },
    { label: "paths", mutate: (w) => { w.taskPaths = ["src/lib/other.js"]; } },
    { label: "projectId", mutate: (w) => { w.projectId = "prj_other"; } },
    { label: "repositoryId", mutate: (w) => { w.repositoryId = "ff".repeat(32); } },
    { label: "worktreeId", mutate: (w) => { w.worktreeId = "ee".repeat(32); } },
    { label: "snapshotToken", mutate: (w) => { w.snapshotToken = "aa".repeat(32); } }
  ];

  for (const c of cases) {
    const bad = cloneWitness(witness);
    c.mutate(bad);
    const res = composeEffectiveTaskScope(request, {
      pack,
      impact,
      symbolTargetCompletenessWitness: bad
    });
    assert.equal(res.status, "not_evaluated", c.label);
    assert.ok(
      res.reasons.some((r) => r.code === "symbol_target_binding_mismatch"),
      c.label
    );
    assert.ok(!("write" in res), c.label);
  }
});

test("T5 refuse wrong identity/version / out-of-domain", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });

  const identityCases = [
    { label: "kind", mutate: (w) => { w.kind = "wrong-kind"; }, code: "symbol_target_evidence_missing" },
    { label: "producer", mutate: (w) => { w.producerIdentity = "other"; }, code: "symbol_target_evidence_missing" },
    { label: "version", mutate: (w) => { w.version = "symbol-target-completeness-witness-v0"; }, code: "symbol_target_evidence_missing" },
    {
      label: "domain",
      mutate: (w) => { w.claimedDomains = ["other-domain"]; },
      code: "symbol_target_domain_unsupported"
    },
    {
      label: "a1Stamp",
      mutate: (w) => {
        w.a1Citations = w.a1Citations.map((c) => ({ ...c, entryPoint: "resolveTrackA1" }));
      },
      code: "symbol_target_domain_unsupported"
    }
  ];

  for (const c of identityCases) {
    const bad = cloneWitness(witness);
    c.mutate(bad);
    const res = composeEffectiveTaskScope(request, {
      pack,
      impact,
      symbolTargetCompletenessWitness: bad
    });
    assert.equal(res.status, "not_evaluated", c.label);
    assert.ok(res.reasons.some((r) => r.code === c.code), `${c.label} got ${JSON.stringify(res.reasons)}`);
    assert.ok(!("write" in res), c.label);
  }
});

test("T6 missing witness + symbols -> not_evaluated symbol_target_evidence_missing", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  const res = composeEffectiveTaskScope(request, { pack, impact });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some((r) => r.code === "symbol_target_evidence_missing"));
  assert.ok(!("write" in res));
});

test("T7 empty symbols regression + composer purity (data-only witness)", () => {
  const { snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: [],
    snapshotToken
  });
  // empty symbols: unchanged path even without witness
  const res = composeEffectiveTaskScope(request, { pack, impact });
  assert.ok(res.status === "incomplete" || res.status === "available");
  assert.ok(!res.reasons.some((r) => String(r.code || "").includes("symbol_target")));
  assert.ok(res.write);
  assert.deepEqual(res.task.symbols, []);

  // purity: composer source must not import/call producer or A1
  const composerSrc = readFileSync(join(ROOT, "src/lib/effective-task-scope.js"), "utf8");
  assert.ok(!composerSrc.includes("produceSymbolTargetCompletenessWitness"));
  assert.ok(!composerSrc.includes("resolveTypeScriptDeclarationEvidence"));
  assert.ok(!composerSrc.includes("resolveTrackA1"));
  assert.ok(!composerSrc.includes("symbol-target-completeness-witness.js"));

  // policy helpers are pure data checks
  const evalMissing = evaluateSymbolTargetCompletenessWitness(null, {
    taskPaths: [ETS_PATH],
    symbols: ["composeEffectiveTaskScope"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken
  });
  assert.equal(evalMissing.ok, false);
  assert.equal(evalMissing.code, "symbol_target_evidence_missing");
  assert.equal(normalizeSymbolTargetCompletenessWitness(undefined), null);
});


test("F1-H1: requiredNames renamed to unbound name while evals stay on original -> refuse no WRITE", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const bad = cloneWitness(witness);
  bad.requiredNames = ["bar"];
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["bar"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  const res = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: bad
  });
  assert.equal(res.status, "not_evaluated");
  assert.ok(
    res.reasons.some((r) =>
      r.code === "symbol_target_binding_mismatch"
      || r.code === "symbol_target_evidence_inconsistent"
    ),
    JSON.stringify(res.reasons)
  );
  assert.ok(!("write" in res));
});

test("F1-H2: delete evaluations / pathCoverage / sourceHashes with holds true -> each refuse no WRITE", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  for (const field of ["evaluations", "pathCoverage", "sourceHashes"]) {
    const bad = cloneWitness(witness);
    delete bad[field];
    assert.equal(bad.completenessHolds, true);
    assert.equal(bad.uniquenessHolds, true);
    const res = composeEffectiveTaskScope(request, {
      pack,
      impact,
      symbolTargetCompletenessWitness: bad
    });
    assert.equal(res.status, "not_evaluated", field);
    assert.ok(
      res.reasons.some((r) =>
        r.code === "symbol_target_evidence_inconsistent"
        || r.code === "symbol_target_binding_mismatch"
      ),
      field + " " + JSON.stringify(res.reasons)
    );
    assert.ok(!("write" in res), field);
  }
});

test("F1-H3: outcome unevaluated and/or evidenceComplete false while holds true -> inconsistent no WRITE", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });

  const cases = [
    {
      label: "outcome-unevaluated",
      mutate: (w) => {
        w.evaluations[0].outcome = "unevaluated";
      }
    },
    {
      label: "evidenceComplete-false",
      mutate: (w) => {
        w.evaluations[0].a1Citation.evidenceComplete = false;
        w.a1Citations[0].evidenceComplete = false;
      }
    }
  ];

  for (const c of cases) {
    const bad = cloneWitness(witness);
    c.mutate(bad);
    assert.equal(bad.completenessHolds, true);
    assert.equal(bad.uniquenessHolds, true);
    const res = composeEffectiveTaskScope(request, {
      pack,
      impact,
      symbolTargetCompletenessWitness: bad
    });
    assert.equal(res.status, "not_evaluated", c.label);
    assert.ok(
      res.reasons.some((r) => r.code === "symbol_target_evidence_inconsistent"),
      c.label + " " + JSON.stringify(res.reasons)
    );
    assert.ok(!("write" in res), c.label);
  }
});

test("F1-H4: mutate sourceHashes away from retained pack/impact -> binding_mismatch no WRITE", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  const bad = cloneWitness(witness);
  const other = createHash("sha256").update("mutated-content-for-f1-h4", "utf8").digest("hex");
  assert.notEqual(other, witness.sourceHashes[ETS_PATH]);
  bad.sourceHashes[ETS_PATH] = other;
  const res = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: bad
  });
  assert.equal(res.status, "not_evaluated");
  assert.ok(res.reasons.some((r) => r.code === "symbol_target_binding_mismatch"));
  assert.ok(!("write" in res));
});

test("F2-B1: inflated consistent witness exceeds total input budget -> scope_budget_exceeded", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const inflated = cloneWitness(witness);
  // Pad until JSON.stringify({request,pack,impact,witness}) > MAX_COMPACT_INPUT while pack/impact each <= 131072
  inflated.budgetPadding = "x".repeat(330000);
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  const packBytes = Buffer.byteLength(JSON.stringify(pack), "utf8");
  const impactBytes = Buffer.byteLength(JSON.stringify(impact), "utf8");
  assert.ok(packBytes <= 131072, "pack " + packBytes);
  assert.ok(impactBytes <= 131072, "impact " + impactBytes);
  const total = Buffer.byteLength(
    JSON.stringify({
      request,
      pack,
      impact,
      symbolTargetCompletenessWitness: inflated
    }),
    "utf8"
  );
  assert.ok(total > 327680, "total " + total);
  const res = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: inflated
  });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.some((r) => r.code === "scope_budget_exceeded"));
});

test("F2-B2: compact live witness under budget is not budget-rejected", () => {
  const { witness, snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes: witness.sourceHashes
  });
  const res = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: witness
  });
  assert.ok(!res.reasons.some((r) => r.code === "scope_budget_exceeded"));
  assert.ok(res.status === "incomplete" || res.status === "available");
  assert.ok(res.write);
});

test("F2-B3: empty symbols omit witness; oversized pack still rejected", () => {
  const { snapshotToken } = produceBoundWitness();
  const { request, pack, impact } = buildPackImpactRequest({
    symbols: [],
    snapshotToken
  });
  pack.sections.diagnostics.items = [{ pad: "y".repeat(140000) }];
  const packBytes = Buffer.byteLength(JSON.stringify(pack), "utf8");
  assert.ok(packBytes > 131072, "pack " + packBytes);
  const res = composeEffectiveTaskScope(request, { pack, impact });
  assert.equal(res.status, "rejected");
  assert.ok(res.reasons.some((r) => r.code === "scope_budget_exceeded"));
});
