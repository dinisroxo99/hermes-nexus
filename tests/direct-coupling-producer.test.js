import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  A_REL,
  B_REL,
  applyIdPatternDelta,
  extractDocumentedMachineIdRegex,
  extractIdPattern,
  produceStrongDirectCouplingWitness
} from "../src/lib/direct-coupling-producer.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function revisionBytes(rel) {
  return execFileSync("git", ["cat-file", "-p", `HEAD:${rel}`], { cwd: root });
}

test("machine-id rule is initially equal and the A-only class edit breaks it", () => {
  const parser = fs.readFileSync(path.join(root, A_REL), "utf8");
  const doc = revisionBytes(B_REL).toString("utf8");
  assert.equal(extractIdPattern(parser).regex, extractDocumentedMachineIdRegex(doc).regex);
  const delta = applyIdPatternDelta(parser);
  assert.equal(extractIdPattern(delta.source).regex, delta.after);
  assert.notEqual(delta.after, extractDocumentedMachineIdRegex(doc).regex);
  assert.equal(new RegExp(delta.before).test("a_b"), false);
  assert.equal(new RegExp(delta.after).test("a_b"), true);
  assert.equal(new RegExp(extractDocumentedMachineIdRegex(doc).regex).test("a_b"), false);
});

test("producer rejects an observation that disagrees with git HEAD", () => {
  assert.throws(() => produceStrongDirectCouplingWitness(root, {
    projectId: "not-from-disk",
    repositoryIdentity: "a".repeat(64),
    worktreeId: "b".repeat(64),
    pack: {
      projectId: "not-from-disk",
      repositoryIdentity: "a".repeat(64),
      worktreeId: "b".repeat(64),
      branch: "nope",
      commitSha: "c".repeat(40),
      dirty: true,
      httpStatus: 200,
      hasRepositoryIdField: false
    },
    git: { head: "c".repeat(40), branch: "nope" }
  }), /does not match/);
});

test("emitted witness binds B and authority to revision bytes and the one-sided check failed equality", () => {
  const witnessPath = path.join(root, "tests/fixtures/track-b-strong-direct-coupling-witness.json");
  const witness = JSON.parse(fs.readFileSync(witnessPath, "utf8"));
  const bRevision = createHash("sha256").update(revisionBytes(B_REL)).digest("hex");
  assert.equal(witness.binding.contentHashes.A.sha256, sha256(path.join(root, A_REL)));
  assert.equal(witness.binding.contentHashes.A.sha256, createHash("sha256").update(revisionBytes(A_REL)).digest("hex"));
  assert.equal(witness.binding.contentHashes.B.sha256, bRevision);
  assert.equal(witness.binding.contentHashes.authority.sha256, bRevision);
  assert.equal(witness.binding.contentHashes.B.hashIsRevisionBytes, true);
  assert.equal(witness.binding.contentHashes.authority.hashIsRevisionBytes, true);
  assert.equal(Object.hasOwn(witness.binding, "repositoryId"), false);
  assert.match(witness.binding.repositoryIdentity, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(witness.binding.howObserved, "repositoryId"), false);
  assert.equal(witness.proposedSourceDelta.boundToContentSha256, witness.binding.contentHashes.A.sha256);
  assert.equal(witness.initialSatisfaction.satisfied, true);
  assert.equal(witness.initialSatisfaction.equal, true);
  assert.equal(witness.oneSidedViolation.shown, true);
  assert.equal(witness.oneSidedViolation.equalAfter, false);
  assert.equal(witness.oneSidedViolation.bChanged, false);
  assert.equal(witness.coverage.unresolvedOrOmitted.requiredPartsUnresolved.length, 0);
  assert.equal(witness.coverage.unresolvedOrOmitted.requiredPartsOmitted.length, 0);
  assert.equal(witness.pair.direction, "A_to_B");
  assert.equal(witness.binding.branchesMatch, true);
  assert.equal(witness.binding.contentHashes.A.worktreeBytesMatchHeadBlob, true);
  assert.equal(witness.binding.contentHashes.B.machineIdLocusMatchesHeadBlob, true);
});
