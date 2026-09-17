import fs from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

async function dispatch(f, body, extra = {}, id = "PrJ_Context") {
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots,
    ...extra
  });
  const req = Readable.from([typeof body === "string" ? body : JSON.stringify(body)]);
  req.method = "POST";
  req.url = `/api/intelligence/projects/${id}/task-context`;
  req.headers = { host: "localhost" };
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
  assert.equal(await router.dispatch(req, res), true);
  return { status: res.status, headers: res.headers, payload: JSON.parse(res.body) };
}

test("task context POST resolves the route ID and returns a bounded no-store pack without writes", async (t) => {
  const f = taskContextFixture(t);
  const before = fs.readFileSync(f.options.registry.manualProjectsFile, "utf8");
  const result = await dispatch(f, { task: f.request.task });
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.payload.data.projectId, "PrJ_Context");
  assert.equal(result.payload.data.analysisVersion, "task-context-v1");
  assert.equal(JSON.stringify(result.payload).includes(f.root), false);
  assert.equal(fs.readFileSync(f.options.registry.manualProjectsFile, "utf8"), before);
  assert.equal(fs.existsSync(f.options.registry.discoveredProjectsFile), false);
});

test("task context route rejects malformed, oversized and identity-spoofing requests", async (t) => {
  const f = taskContextFixture(t);
  for (const body of ["{bad", [], { task: { title: "task", paths: ["../other"] } }, { task: f.request.task, projectId: "PrJ_Other" }, { task: f.request.task, provider: "forbidden" }]) {
    assert.equal((await dispatch(f, body)).status, 400);
  }
  assert.equal((await dispatch(f, " ".repeat(65537))).status, 413);
  assert.equal((await dispatch(f, { task: f.request.task }, {}, "PrJ_Missing")).status, 404);
});

test("task context route sanitizes failures and reports observation conflicts", async (t) => {
  const f = taskContextFixture(t);
  for (const [code, status] of [["context_sources_changed", 409], ["worktree_parent_mismatch", 409], [undefined, 500]]) {
    const result = await dispatch(f, { task: f.request.task }, { buildProjectTaskContext: () => { throw Object.assign(new Error("/private/git/metadata"), { code }); } });
    assert.equal(result.status, status);
    assert.equal(JSON.stringify(result.payload).includes("/private"), false);
  }
});
