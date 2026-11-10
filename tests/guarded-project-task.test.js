import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { prepareGuardedTask } from "../src/lib/guarded-task-context.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

function fixture(t) {
  const f = taskContextFixture(t);
  const directory = f.worktree("linked");
  const location = { projectId: f.request.projectId, worktree: { rootId: "test", relativePath: "linked" } };
  const options = { dataDir: f.root, roots: f.options.registry.roots };
  const revision = f.git(["rev-parse", "HEAD"], directory);
  return { ...f, location, options, directory, revision };
}

test("operator grants intersect actual WRITE and project-bound source files before execution", (t) => {
  const f = fixture(t);
  const plan = (read, write, rev = f.revision) => prepareGuardedTask(f.location, f.request.task, rev, read, write, f.options);
  const p = plan(["src/unrelated.ts"], ["src/one.ts"]);
  assert.equal(p.context.projectId, f.location.projectId);
  assert.equal(p.context.snapshotToken, JSON.parse(p.receipt).snapshotToken);
  assert.equal(p.directory, f.directory);
  for (const source of p.context.sources) {
    assert.equal(source.sha256, createHash("sha256").update(fs.readFileSync(path.join(p.directory, source.path))).digest("hex"));
  }
  assert.throws(() => plan([], ["src/unrelated.ts"]), { code: "guard_write_outside_scope" });
  assert.throws(() => plan(["src/missing.ts"], ["src/one.ts"]), { code: "guard_read_evidence_unavailable" });
  assert.throws(() => plan([".env"], ["src/one.ts"]), { code: "invalid_operator_grants" });
  assert.throws(() => plan([], ["src/one.ts"], "f".repeat(40)), { code: "guard_revision_mismatch" });
});

test("project-aware Hermes worker produces a patch within the operator grant", {
  skip: !process.env.HERMES_GUARD_PROBE_CHECKOUT || !process.env.HERMES_GUARD_PYTHON
}, (t) => {
  const f = fixture(t);
  const target = "src/one.ts";
  const encoded = fs.readFileSync(path.join(f.directory, target));
  const task = f.request.task;
  const calls = [{ tool: "nexus_guard_replace", args: { path: target,
    beforeSha256: createHash("sha256").update(encoded).digest("hex"), text: "export class Renamed {}\n" } }];
  const script = fileURLToPath(new URL("../scripts/guarded-project-task.mjs", import.meta.url));
  const proc = spawnSync(process.execPath, [script, "--project-id", f.location.projectId, "--root-id", "test",
    "--worktree", "linked", "--task-id", task.id, "--revision", f.revision, "--write", target,
    "--hermes-checkout", process.env.HERMES_GUARD_PROBE_CHECKOUT, "--python", process.env.HERMES_GUARD_PYTHON],
  { env: { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify(f.options.roots) },
    input: JSON.stringify({ task, calls }), timeout: 120000, encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout);
  assert.match(result.patch, /\+export class Renamed/);
  assert.ok(result.context.includes(result.snapshotToken));
  assert.deepEqual(fs.readFileSync(path.join(f.directory, target)), encoded);
});

test("a conflicting active peer blocks launch and a stale peer requires revalidation", (t) => {
  const f = fixture(t);
  const args = [f.location, f.request.task, f.revision, [], ["src/one.ts"]];
  const original = prepareGuardedTask(...args, f.options);
  const expectedRevision = JSON.parse(original.receipt).revision;
  const peer = { worktree: f.location.worktree, expectedRevision, includeTests: true,
    task: { ...f.request.task, id: "peer" }, changeSemantics: { category: "local_implementation" } };
  assert.throws(() => prepareGuardedTask(...args, { ...f.options, peers: [peer] }), { code: "guard_peer_conflict" });
  const stale = { ...peer, expectedRevision: { ...expectedRevision, commitSha: "f".repeat(40) } };
  assert.throws(() => prepareGuardedTask(...args, { ...f.options, peers: [stale] }), { code: "guard_peer_revalidation_required" });
});
