import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

async function fixture(t, dependencies = {}) {
  const f = taskContextFixture(t);
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots,
    ...dependencies
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

test("siblings corroborate consumer dependency witnesses in both snapshots, including at distinct commits", async (t) => {
  const f = await fixture(t);
  f.worktree("left");
  const rightTree = f.worktree("right");
  const left = f.intent("library", "left");
  for (const diverged of [false, true]) {
    if (diverged) { f.write("unrelated.md", "different branch contents", rightTree); f.commit("unrelated edit", rightTree); }
    const right = f.intent("consumer", "right", "tests/one.test.ts");
    const { payload } = await f.post({ left, right });
    const data = payload.data;
    assert.equal(data.severity, "warning", JSON.stringify(data));
    const row = data.overlaps.find(item => item.path === "tests/one.test.ts");
    assert.deepEqual(row.categories, ["write", "watch"]);
    assert.equal(row.dependency.originPath, "src/one.ts");
    assert.equal(data.dimensions.dependencies, "evidence_found");
    assert.equal(row.dependency.citations.length, 2);
    for (const c of row.dependency.citations) {
      assert.match(c.witnessId, /^impact_edge_[a-f0-9]{64}$/);
      assert.equal(c.minimumDistance, 1);
      assert.equal(c.basis, "structural");
    }
    assert.equal(data.revalidation.distinctCommits, diverged);
    assert.equal(data.revalidation.required, true);
    assert.equal(data.recommendedAction, "revalidate");
    assert.deepEqual((await f.post({ left: right, right: left })).payload.data, data);
  }
  f.write("tests/one.test.ts", "export const standalone = 1;", rightTree);
  f.commit("remove dependency on right", rightTree);
  const result = (await f.post({ left, right: f.intent("consumer", "right", "tests/one.test.ts") })).payload.data;
  assert.equal(result.findingState, "not_evaluated");
  assert.deepEqual(result.overlaps, []);
  assert.equal(result.revalidation.required, true);
});

test("same-byte symbol citations distinguish a shared declaration from two declarations in one file", async (t) => {
  const f = await fixture(t);
  f.write("src/one.ts", "export class One {}\nexport class Other {}\n");
  f.commit();
  f.worktree("left"); f.worktree("right");
  const named = (id, tree, name) => {
    const request = f.intent(id, tree);
    request.task.symbols = [name];
    request.includeTests = false;
    return request;
  };
  for (const tree of ["left", "right"]) {
    const left = named("A", "left", "One"), right = named("B", tree, "One");
    const same = (await f.post({ left, right })).payload.data;
    const row = same.overlaps.find(item => item.path === "src/one.ts");
    assert.equal(same.dimensions.declarations, "evidence_found");
    assert.equal(row.declarations[0].name, "One");
    assert.equal(row.declarations[0].citations.length, 2);
    assert.equal(row.declarations[0].citations[0].declarationId === row.declarations[0].citations[1].declarationId, tree === "left");
    const other = (await f.post({ left, right: named("B", tree, "Other") })).payload.data;
    assert.equal(other.severity, "high");
    assert.equal(other.dimensions.declarations, "not_established");
    assert.equal(other.overlaps.find(item => item.path === "src/one.ts").declarations, undefined);
  }
});

test("a diverged same-path intent cites both byte hashes and requires revalidation", async (t) => {
  const f = await fixture(t);
  const l = f.worktree("left"); const r = f.worktree("right");
  f.write("src/one.ts", "export class One { left = true; }", l); f.commit("left version", l);
  f.write("src/one.ts", "export class One { right = true; }", r); f.commit("right version", r);
  const left = f.intent("a", "left"); const right = f.intent("b", "right");
  const result = (await f.post({ left, right })).payload.data;
  assert.deepEqual(result, (await f.post({ left: right, right: left })).payload.data);
  const row = result.overlaps.find(item => item.path === "src/one.ts");
  assert.equal(row.basis, "same_path_distinct_content");
  assert.ok(row.sourceHashes.every(hash => /^[a-f0-9]{64}$/.test(hash)));
  assert.notEqual(...row.sourceHashes);
  assert.equal(row.severity, "warning");
  assert.deepEqual(result.revalidation, { required: true, distinctCommits: true });
  assert.equal(result.recommendedAction, "revalidate");
});

test("identical endpoint bytes cannot corroborate a dependency after tsconfig changes its resolution", async (t) => {
  const f = await fixture(t);
  const config = target => JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@one": [target] } } });
  f.write("tsconfig.json", config("src/one.ts"));
  f.write("src/fallback.ts", "export class One { alternative = true; }");
  f.write("src/consumer.ts", "import { One } from '@one'; export class Consumer extends One {}");
  f.commit();
  f.worktree("left"); const r = f.worktree("right");
  const left = f.intent("a", "left");
  const get = () => f.post({ left, right: f.intent("b", "right", "src/consumer.ts") });
  assert.equal((await get()).payload.data.severity, "warning");
  f.write("tsconfig.json", config("src/fallback.ts"), r); f.commit("retarget alias only", r);
  const changed = (await get()).payload.data;
  assert.equal(changed.findingState, "not_evaluated");
  assert.deepEqual(changed.overlaps, []);
  assert.ok(changed.reasons.includes("unverified_dependency_overlap"));
});

test("a transitive WATCH cites reachability distance without inventing intermediate edges", async (t) => {
  const f = await fixture(t);
  f.write("src/middle.ts", "import { One } from './one'; export class Middle extends One {}");
  f.write("src/consumer.ts", "import { Middle } from './middle'; export class Consumer extends Middle {}");
  f.commit();
  f.worktree("left"); f.worktree("right");
  const left = f.intent("a", "left"); const right = f.intent("b", "right", "src/consumer.ts");
  const result = (await f.post({ left, right })).payload.data;
  const row = result.overlaps.find(item => item.path === "src/consumer.ts");
  assert.equal(row.severity, "warning");
  assert.deepEqual(row.dependency.citations.map(item => item.minimumDistance), [2, 2]);
  assert.equal(row.dependency.originPath, "src/one.ts");
});

test("late changes to the first sibling discard the entire pair instead of returning stale overlap evidence", async (t) => {
  let calls = 0, moveCheckout;
  const f = await fixture(t, {
    buildProjectImpact(id, request, options) {
      if (++calls === 3) moveCheckout();
      return buildProjectImpact(id, request, options);
    }
  });
  const firstTree = f.worktree("left");
  f.worktree("right");
  const left = f.intent("a", "left"), right = f.intent("b", "right");
  moveCheckout = () => { f.write("late.ts", "export const late = 1;", firstTree); f.commit("move left", firstTree); };
  const changed = await f.post({ left, right });
  assert.equal(changed.status, 409);
  assert.equal(changed.payload.error, "impact_sources_changed");
  assert.equal(Object.hasOwn(changed.payload, "data"), false);
});
