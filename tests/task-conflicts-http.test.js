import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

async function fixture(t) {
  const f = taskContextFixture(t);
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots
  });
  const server = http.createServer((req, res) => router.dispatch(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/intelligence/projects/${f.request.projectId}/task-conflicts`;
  const post = async (body) => {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", Connection: "close" }, body: JSON.stringify(body)
    });
    return { status: response.status, payload: await response.json() };
  };
  const intent = (id, tree, target = "src/one.ts") => {
    const worktree = { rootId: "test", relativePath: tree };
    const task = { id, title: "Edit a project file", paths: [target] };
    const { revision } = buildProjectTaskContext({ projectId: f.request.projectId, ...(tree === "main" ? {} : { worktree }), task }, f.options);
    const { status, commitSha, branch, dirty, isLinkedWorktree, repositoryIdentity, worktreeId } = revision;
    return { task, worktree, includeTests: true, changeSemantics: { category: "local_implementation" },
      expectedRevision: { status, commitSha, branch, dirty, isLinkedWorktree, repositoryId: repositoryIdentity, worktreeId } };
  };
  return { ...f, post, intent };
}

test("task-conflicts HTTP computes symmetric overlap from live scopes and refuses stale evidence", async (t) => {
  const f = await fixture(t);
  f.worktree("left");
  const left = f.intent("fix", "left");
  const right = f.intent("refactor", "left");
  const forward = await f.post({ left, right });
  assert.equal(forward.status, 200);
  const data = forward.payload.data;
  assert.equal(data.severity, "high", JSON.stringify(data));
  assert.ok(data.overlaps.some((item) => item.path === "src/one.ts"));
  assert.deepEqual((await f.post({ left: right, right: left })).payload.data, data);
  const stale = { ...right, expectedRevision: { ...right.expectedRevision, commitSha: "1".repeat(40) } };
  const result = await f.post({ left, right: stale });
  assert.equal(result.status, 200);
  assert.equal(result.payload.data.findingState, "not_evaluated");
  assert.deepEqual(result.payload.data.overlaps, []);
});

test("task-conflicts HTTP compares only witnessed same-file writes across clean sibling worktrees", async (t) => {
  const f = await fixture(t);
  f.worktree("left");
  f.worktree("right");
  const left = f.intent("fix", "left");
  const right = f.intent("refactor", "right");
  assert.notEqual(left.expectedRevision.worktreeId, right.expectedRevision.worktreeId);
  const { status, payload } = await f.post({ left, right });
  assert.equal(status, 200);
  assert.equal(payload.data.status, "incomplete", JSON.stringify(payload));
  assert.equal(payload.data.severity, "high");
  assert.deepEqual(payload.data.overlaps.map((row) => row.path), ["src/one.ts"]);
  assert.deepEqual((await f.post({ left: right, right: left })).payload.data, payload.data);
  const { payload: other } = await f.post({ left, right: f.intent("different", "right", "src/unrelated.ts") });
  assert.deepEqual(other.data.overlaps, []);
  assert.notEqual(other.data.status, "available");
});

test("task-conflicts HTTP requires distinct task intents and rejects client evidence", async (t) => {
  const f = await fixture(t);
  const left = f.intent("same", "main");
  const right = f.intent("other", "main");
  const main = await f.post({ left, right });
  assert.equal(main.status, 200);
  assert.equal(main.payload.data.findingState, "not_evaluated");
  for (const body of [{ left, right: left }, { left }, { left, right, scope: {} },
    { left, right: { ...right, impact: {} } }, { left, right: { ...right, projectId: "Other" } }]) {
    const refused = await f.post(body);
    assert.equal(refused.status, 400, JSON.stringify(refused));
  }
});
