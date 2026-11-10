import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

async function post(f, body, dependencies = {}, projectId = f.request.projectId) {
  const router = createRouter();
  registerIntelligenceRoutes(router, { getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots, ...dependencies });
  const req = Readable.from([typeof body === "string" ? body : JSON.stringify(body)]);
  Object.assign(req, { method: "POST", url: `/api/intelligence/projects/${projectId}/task-brief`, headers: { host: "localhost" } });
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(content) { this.body = content; } };
  assert.equal(await router.dispatch(req, res), true);
  return { status: res.status, headers: res.headers, body: JSON.parse(res.body) };
}

test("registered task-brief combines actual pack and impact evidence with separate provenance", async (t) => {
  const f = taskContextFixture(t);
  const first = await post(f, { task: f.request.task });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const result = first.body.data;
  assert.equal(first.headers["cache-control"], "no-store");
  assert.equal(result.analysisVersion, "task-brief-v1");
  assert.ok(result.text.includes("One@src/one.ts"));
  assert.ok(result.text.includes("Tests tests/one.test.ts"));
  assert.equal(result.binding.revision.commitSha, f.git(["rev-parse", "HEAD"]));
  assert.equal(result.binding.provider.id, "native.typescript");
  assert.match(result.binding.contextPackId, /^context_[a-f0-9]{64}$/);
  assert.equal(result.binding.contextVersion, "task-context-v1");
  assert.equal(result.binding.impactVersion, "impact-v2");
  assert.equal(result.coverage.projection.truncated, false);
  assert.equal(JSON.stringify(result).includes("export class"), false);
  assert.equal(JSON.stringify(result).includes("Canonical project description."), false);
  assert.equal(JSON.stringify(result).includes(f.root), false);
  const pinned = await post(f, { task: f.request.task, expectedSnapshotToken: result.binding.snapshotToken,
    expectedCommitSha: result.binding.revision.commitSha, worktree: result.binding.project });
  assert.deepEqual(pinned.body, first.body);
});

test("linked worktree uses its own revision, sources and worktree ID", async (t) => {
  const f = taskContextFixture(t);
  const linked = f.worktree("linked");
  f.write("src/one.ts", "export class LinkedOne {}\n", linked);
  f.commit("linked origin", linked);
  const parent = (await post(f, { task: f.request.task })).body.data;
  const result = await post(f, { task: f.request.task, worktree: { rootId: "test", relativePath: "linked" } });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.match(result.body.data.text, /LinkedOne@src\/one.ts/);
  assert.equal(result.body.data.binding.revision.commitSha, f.git(["rev-parse", "HEAD"], linked));
  assert.notEqual(result.body.data.binding.revision.worktreeId, parent.binding.revision.worktreeId);
  assert.equal(result.body.data.binding.revision.isLinkedWorktree, true);
  fs.mkdirSync(path.join(f.root, "foreign"));
  f.git(["init"], path.join(f.root, "foreign"));
  assert.equal((await post(f, { task: f.request.task, worktree: { rootId: "test", relativePath: "foreign" } })).status, 409);
});

test("stale revision, stale dirty snapshot, producer identity and mid-build mutation return 409 without text", async (t) => {
  const f = taskContextFixture(t);
  const input = { task: f.request.task };
  const clean = (await post(f, input)).body.data.binding;
  const wrong = "0".repeat(64);
  const conflict = async (body, overrides = {}) => {
    const result = await post(f, body, overrides);
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.data, undefined);
  };
  await conflict({ ...input, expectedCommitSha: "0".repeat(40) });
  await conflict({ ...input, expectedSnapshotToken: wrong });
  await conflict(input, { buildProjectImpact(...args) {
    const result = buildProjectImpact(...args);
    result.observation.targetSource.hash = wrong;
    return result;
  } });
  for (const mutate of [
    (pack) => { pack.projectId = "PrJ_Foreign"; }, (pack) => { pack.revision.repositoryIdentity = wrong; },
    (pack) => { pack.analysis.snapshotToken = wrong; }, (pack) => { pack.sections.task.items[0].paths = ["other.ts"]; }
  ]) {
    await conflict(input, { buildProjectTaskContext(...args) { const p = buildProjectTaskContext(...args); mutate(p); return p; } });
  }
  // Leave the tree dirty before the builder, then change its contents again while it is still dirty.
  f.write("src/unrelated.ts", "export class Dirty {}\n");
  await conflict({ ...input, expectedSnapshotToken: clean.snapshotToken });
  const dirty = (await post(f, input)).body.data.binding;
  assert.equal(dirty.revision.dirty, true);
  await conflict(input, { buildProjectImpact(...args) {
    const result = buildProjectImpact(...args);
    f.write("src/unrelated.ts", "export class OtherDirty {}\n");
    return result;
  } });
});

test("invalid client fields, nested paths and output limits fail or report exact truncation", async (t) => {
  const f = taskContextFixture(t);
  for (const body of ["{", { task: f.request.task, includeExcerpts: true }, { task: f.request.task, projectId: "PrJ_Other" },
    { task: f.request.task, expectedCommitSha: "branch" }, { task: f.request.task, limits: { textBytes: 25 } },
    { task: f.request.task, limits: { upload: true } }, { task: { title: "Missing paths" } },
    { task: { ...f.request.task, paths: [".env"] } }]) {
    assert.equal((await post(f, body)).status, 400);
  }
  assert.equal((await post(f, { task: f.request.task }, {}, "PrJ_Unknown")).status, 404);
  assert.equal((await post(f, " ".repeat(65537))).status, 413);
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries,
    { rootId: "test", relativePath: "main/private", name: "private", projectId: "PrJ_Child" }]));
  assert.equal((await post(f, { task: { ...f.request.task, paths: ["private/file.ts"] } })).body.error,
    "task_brief_boundary_excluded");

  const result = (await post(f, { task: f.request.task, includeTests: false, limits: { symbols: 0, affectedFiles: 0 } })).body.data;
  assert.equal(result.coverage.impact.testCandidatesStatus, "not_requested");
  assert.ok(result.coverage.projection.counts.symbols.received > 0);
  assert.equal(result.coverage.projection.counts.symbols.rendered, 0);
  assert.ok(result.coverage.projection.truncated);
  assert.match(result.text, /Tests \(not requested\)/);
  assert.match(result.text, /briefTruncated=true/);
});


test("real HTTP supports multi-origin tasks and enforces the UTF-8 text budget independently of producer caps", async (t) => {
  const f = taskContextFixture(t);
  const functions = Array.from({ length: 40 }, (_, i) =>
    `export function LongSymbolName_é_${i}() { return ${i}; }`).join("\n");
  f.write("src/one.ts", functions);
  const router = createRouter();
  registerIntelligenceRoutes(router, { getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots });
  const server = http.createServer((req, res) => router.dispatch(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/projects/PrJ_Context/task-brief`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: { title: "Inspect exports", paths: ["src/unrelated.ts", "src/one.ts"] },
      limits: { symbols: 24, textBytes: 256 } })
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  const { text, binding, coverage } = payload.data;
  assert.equal(binding.originCount, 2);
  assert.equal(binding.trust, "derived_analysis");
  assert.equal(Buffer.byteLength(text), coverage.projection.textBytes);
  assert.ok(Buffer.byteLength(text) <= 256);
  assert.equal(coverage.context.symbolsTruncated, true);
  assert.equal(coverage.projection.truncated, true);
  assert.ok(coverage.projection.counts.symbols.received > coverage.projection.counts.symbols.rendered);
  assert.equal(binding.renderedSymbolIds.length, coverage.projection.counts.symbols.rendered);
  for (const id of binding.renderedSymbolIds) assert.match(id, /^symbol_[a-f0-9]{64}$/);
});

test("unresolved imports preserve upstream partial status and reasons; missing origins never imply complete coverage", async (t) => {
  const f = taskContextFixture(t);
  f.write("src/one.ts", "import './missing.js'; export class One {}");
  const partial = await post(f, { task: f.request.task });
  assert.equal(partial.status, 200, JSON.stringify(partial.body));
  assert.equal(partial.body.data.coverage.incomplete, true);
  assert.equal(partial.body.data.coverage.impact.status, "partial");
  assert.ok(partial.body.data.coverage.impact.completeness.provider.includes("provider_partial"));
  assert.match(partial.body.data.text, /sourceIncomplete=true/);
  const missing = await post(f, { task: { title: "Missing", paths: ["src/missing.js"] } });
  assert.equal(missing.status, 200, JSON.stringify(missing.body));
  assert.equal(missing.body.data.coverage.impact.finding, "not_evaluated");
});
