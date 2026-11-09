import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { readProjectRevision } from "../src/lib/project-revision.js";
import { createEffectiveTaskScopeHandler } from "../src/routes/effective-task-scope.routes.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

async function example(t, extra = {}) {
  const f = taskContextFixture(t);
  const tree = f.worktree("linked");
  for (const [p, content] of Object.entries(extra)) f.write(p, content, tree);
  if (Object.keys(extra).length) f.commit("add declarations", tree);
  const original = readProjectRevision({ absolutePath: tree });
  const { status, commitSha, branch, dirty, isLinkedWorktree, repositoryIdentity: repositoryId, worktreeId } = original;
  const expectedRevision = { status, commitSha, branch, dirty, isLinkedWorktree, repositoryId, worktreeId };
  const worktree = { rootId: "test", relativePath: "linked" };
  const handler = createEffectiveTaskScopeHandler({
    getProjectConfig: () => ({ dataDir: f.root }), getConfiguredProjectRoots: () => f.options.registry.roots
  });
  const id = f.request.projectId;
  const server = createServer((req, res) => handler(req, res, { projectId: id }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((done) => server.close(done)));
  const post = async (paths, symbols, overrides = {}) => {
    const body = { task: { id: "task-1", title: "Observe declarations", paths, symbols },
      expectedRevision, worktree, includeTests: false, ...overrides };
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/projects/${id}/effective-task-scope`, {
      method: "POST", body: JSON.stringify(body), headers: { connection: "close", "content-type": "application/json" }
    });
    return { status: res.status, body: await res.json() };
  };
  return { post, expectedRevision, tree, fixture: f };
}

test("real ETS HTTP path accepts a unique direct declaration on one or more explicit files", async (t) => {
  const { post, tree, fixture } = await example(t, { "src/other.ts": "export class Other {}" });
  for (const [paths, symbols] of [
    [["src/one.ts"], ["One"]], [["src/one.ts", "src/other.ts"], ["One", "Other"]]
  ]) {
    const { status, body } = await post(paths, symbols);
    assert.equal(status, 200);
    assert.equal(body.data.status, "incomplete", JSON.stringify(body.data.reasons));
    assert.deepEqual(body.data.write.items.map((row) => row.target.path), paths);
    assert.ok(body.data.write.items.every((row) => row.target.kind === "file"));
    assert.equal(Object.hasOwn(body.data, "symbolTargetCompletenessWitness"), false);
  }
  assert.equal(fixture.git(["status", "--porcelain"], tree), "");
});

test("ambiguous declarations and absent names keep WRITE unclassified", async (t) => {
  const { post } = await example(t, { "src/duplicate.ts": "export class One {}" });
  for (const [paths, name, expectedCode] of [
    [["src/duplicate.ts", "src/one.ts"], "One", "symbol_target_binding_mismatch"],
    [["src/one.ts"], "Missing", "symbol_target_uniqueness_not_established"]
  ]) {
    const { status, body } = await post(paths, [name]);
    assert.equal(status, 200);
    assert.equal(body.data.status, "not_evaluated");
    assert.equal(body.data.write, undefined);
    assert.equal(body.data.reasons[0].code, expectedCode);
  }
});

test("stale revision, partial coverage, unparseable declarations and client-supplied witnesses cannot lift WRITE", async (t) => {
  const { post, expectedRevision } = await example(t, { "src/broken.ts": "export function Broken( {" });
  const stale = await post(["src/one.ts"], ["One"], { expectedRevision: { ...expectedRevision, commitSha: "a".repeat(40) } });
  assert.equal(stale.body.data.status, "stale");
  assert.equal(stale.body.data.write, undefined);
  const bad = await post(["src/broken.ts"], ["Broken"]);
  assert.equal(bad.body.data.status, "not_evaluated");
  assert.equal(bad.body.data.write, undefined);
  const forged = await post(["src/one.ts"], ["One"], { symbolTargetCompletenessWitness: { completenessHolds: true } });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, "unexpected_field");
  const partial = await example(t, { "src/bad-import.ts": 'import "./missing.js"; export class B {}' });
  const incomplete = await partial.post(["src/one.ts"], ["One"]);
  assert.equal(incomplete.body.data.reasons[0].code, "symbol_target_evidence_missing");
  assert.equal(incomplete.body.data.write, undefined);
});

test("the symbol producers match their admitted Git revision independently of the analyzed project", async () => {
  const pins = [
    ["symbol-target-completeness-witness", "ee20624d62cbac5c83c64540dda4e10c6e34463d2344b9c8716f4bc3ab94d7e7"],
    ["track-a-symbol-resolution", "995c9d22130d01fe3ee032a551037c774972b2ab52ac89cf700f0a546d66bd0b"]
  ];
  for (const [name, digest] of pins) {
    const content = await fs.readFile(new URL(`../src/lib/${name}.js`, import.meta.url));
    assert.equal(createHash("sha256").update(content).digest("hex"), digest, name);
  }
});
