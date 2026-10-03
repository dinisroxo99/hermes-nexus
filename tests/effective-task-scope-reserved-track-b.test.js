import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeEffectiveTaskScope } from "../src/lib/effective-task-scope.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WITNESS = JSON.parse(fs.readFileSync(
  path.join(root, "tests/fixtures/track-b-strong-direct-coupling-witness.json"),
  "utf8"
));

const EXPECTED_RESERVED_ITEM = {
  target: { kind: "file", path: "docs/project-icm.md" },
  roles: ["consistency_obligation"],
  ruleIds: ["agent-manifest.machine-id-rule-source-equality"],
  evidenceRefs: [],
  origins: [],
  attribution: null
};

const BASE_REQ = {
  task: {
    id: "t_track_b_reserved",
    title: "Track B reserved emission",
    paths: ["src/lib/agent-manifest.js"],
    symbols: []
  },
  projectId: "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd",
  worktree: { rootId: "local", relativePath: "hermes-nexus-step4-reserved" },
  expectedRevision: {
    status: "available",
    commitSha: "618718247352fa6ae5e2a530c209845ef43e7378",
    branch: "feat/step4-reserved-track-b-item",
    dirty: false,
    isLinkedWorktree: true,
    repositoryId: "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529",
    worktreeId: "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d"
  },
  includeTests: false
};

const MIN_PACK = {
  schemaVersion: 1,
  analysisVersion: "task-context-v1",
  contextPackId: "context_track_b_reserved_pack",
  projectId: BASE_REQ.projectId,
  project: { name: "hermes-project-map", rootId: "local", relativePath: BASE_REQ.worktree.relativePath },
  revision: {
    status: "available",
    commitSha: BASE_REQ.expectedRevision.commitSha,
    branch: BASE_REQ.expectedRevision.branch,
    dirty: false,
    repositoryIdentity: BASE_REQ.expectedRevision.repositoryId,
    worktreeId: BASE_REQ.expectedRevision.worktreeId,
    isLinkedWorktree: true
  },
  analysis: { schemaVersion: 1, status: "partial", snapshotToken: "snap_track_b_reserved", provider: { id: "native.typescript", version: "1" } },
  observation: { basis: "working_tree", incomplete: true, sourceDigest: "digest_track_b_reserved" },
  sections: {
    task: {
      items: [{
        id: BASE_REQ.task.id,
        title: BASE_REQ.task.title,
        paths: BASE_REQ.task.paths,
        symbols: []
      }],
      status: "available"
    },
    workspaces: { items: [], status: "empty" },
    documents: { items: [], status: "empty" },
    constraints: { items: [], status: "empty" },
    files: { items: [], status: "empty" },
    symbols: { items: [], status: "partial" },
    references: { items: [], status: "partial" },
    tests: { items: [], status: "empty" },
    diagnostics: { items: [], status: "available" },
    policy: { items: [], status: "available" }
  },
  limits: { maxBytes: 65536 }
};

const MIN_IMPACT = {
  schemaVersion: 1,
  analysisVersion: "impact-v2",
  projectId: BASE_REQ.projectId,
  project: { rootId: "local", relativePath: BASE_REQ.worktree.relativePath },
  targets: [
    {
      originPath: "src/lib/agent-manifest.js",
      targetSource: { path: "src/lib/agent-manifest.js", hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      status: "partial",
      findingState: "no_evidence_found",
      completeness: { source: ["source_limit"], provider: ["provider_partial"] }
    }
  ],
  revision: {
    status: "available",
    commitSha: BASE_REQ.expectedRevision.commitSha,
    branch: BASE_REQ.expectedRevision.branch,
    repositoryId: BASE_REQ.expectedRevision.repositoryId,
    worktreeId: BASE_REQ.expectedRevision.worktreeId,
    dirty: false,
    isLinkedWorktree: true
  },
  snapshotToken: "snap_track_b_reserved",
  provider: { id: "native.typescript", version: "1" },
  coverage: { observed: ["javascript"], covered: ["javascript"], uncovered: [] },
  observation: { basis: "working_tree", incomplete: true },
  limits: { depth: 2, affectedFiles: 80, compactBytes: 65536 },
  status: "partial",
  findingState: "no_evidence_found",
  affectedFiles: [],
  affectedTests: { status: "not_requested", findingState: "not_requested", candidates: [] },
  completeness: { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: [] }
};

test("RESERVED emits one incomplete item when Track B witness is fully established", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, {
    pack: MIN_PACK,
    impact: MIN_IMPACT,
    directCouplingWitness: WITNESS
  });
  assert.equal(res.status, "incomplete");
  assert.equal(res.reserved.status, "incomplete");
  assert.equal(res.reserved.items.length, 1);
  assert.deepEqual(res.reserved.items[0], EXPECTED_RESERVED_ITEM);
  assert.deepEqual(res.reserved.reasons, []);
  assert.equal(res.reserved.truncated, false);
});

test("RESERVED stays empty not_evaluated when any required witness part is missing", () => {
  const incomplete = structuredClone(WITNESS);
  delete incomplete.oneSidedViolation.equalAfter;
  const res = composeEffectiveTaskScope(BASE_REQ, {
    pack: MIN_PACK,
    impact: MIN_IMPACT,
    directCouplingWitness: incomplete
  });
  assert.equal(res.reserved.status, "not_evaluated");
  assert.deepEqual(res.reserved.items, []);
  assert.ok(res.reserved.reasons.includes("coupling_evidence_not_supported"));
});

test("RESERVED stays empty not_evaluated when Track B witness is absent", () => {
  const res = composeEffectiveTaskScope(BASE_REQ, {
    pack: MIN_PACK,
    impact: MIN_IMPACT
  });
  assert.equal(res.reserved.status, "not_evaluated");
  assert.deepEqual(res.reserved.items, []);
  assert.ok(res.reserved.reasons.includes("coupling_evidence_not_supported"));
});


test("RESERVED stays the one incomplete item when the obligation file is already a write path", () => {
  const req = structuredClone(BASE_REQ);
  req.task.paths = ["docs/project-icm.md", "src/lib/agent-manifest.js"];
  const pack = structuredClone(MIN_PACK);
  pack.sections.task.items[0].paths = req.task.paths.slice();
  const impact = structuredClone(MIN_IMPACT);
  const docTarget = structuredClone(impact.targets[0]);
  docTarget.originPath = "docs/project-icm.md";
  docTarget.targetSource = { path: "docs/project-icm.md", hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };
  impact.targets = [docTarget, impact.targets[0]];
  const res = composeEffectiveTaskScope(req, {
    pack,
    impact,
    directCouplingWitness: WITNESS
  });
  assert.equal(res.reserved.status, "incomplete");
  assert.equal(res.reserved.items.length, 1);
  assert.deepEqual(res.reserved.items[0], EXPECTED_RESERVED_ITEM);
  assert.ok(res.write.items.some((item) => item.target.path === "docs/project-icm.md"));
});
