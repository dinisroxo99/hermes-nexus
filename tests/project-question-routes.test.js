import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRouter } from "../src/utils/router.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

async function setup(t, extra = {}) {
  const f = taskContextFixture(t);
  const router = createRouter();
  registerIntelligenceRoutes(router, { getProjectConfig: () => ({ dataDir: f.root }), getConfiguredProjectRoots: () => f.options.registry.roots, ...extra });
  const server = http.createServer((req, res) => router.dispatch(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return async (body) => {
    const reply = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/projects/${f.request.projectId}/ask-project`,
      { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify(body) });
    return { status: reply.status, body: await reply.json() };
  };
}

test("project questions HTTP returns source evidence and rejects client-supplied backend or store configuration", async (t) => {
  const post = await setup(t);
  const answer = await post({ question: "tests", subject: "src/one.ts" });
  assert.equal(answer.status, 200);
  assert.ok(answer.body.data.evidence.some((e) => e.path === "tests/one.test.ts"));
  assert.match(answer.body.data.revision.commitSha, /^[a-f0-9]{40}$/);
  for (const extra of [{ model: "foo" }, { historyStore: "/tmp/db" }, { synthesize: "true" }, { projectId: "other" }]) {
    assert.equal((await post({ question: "symbol", subject: "One", ...extra })).status, 400);
  }
});

test("a busy model leaves deterministic questions available and releases its slot on failure", async (t) => {
  let started, finish;
  let active = new Promise((r) => { started = r; });
  const post = await setup(t, { askProject: async (input, options) => {
    if (options.synthesize) { started(); await new Promise((resolve) => { finish = resolve; }); throw new Error("failure"); }
    return { question: input.question };
  } });
  const req = { question: "symbol", subject: "One", synthesize: true };
  const first = post(req);
  await active;
  assert.equal((await post(req)).status, 429);
  assert.equal((await post({ ...req, synthesize: false })).status, 200);
  finish();
  assert.equal((await first).status, 500);
  active = new Promise((r) => { started = r; });
  const again = post(req);
  await active;
  assert.equal((await post(req)).status, 429);
  finish();
  assert.equal((await again).status, 500);
});
