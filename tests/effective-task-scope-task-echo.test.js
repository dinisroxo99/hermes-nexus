import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

// The effective-task-scope route builds the Context Pack with the REAL builder (no builder mock) and the
// composer requires the pack's task echo to equal the request task (id, title, paths, symbols). The
// builder is wrapped only to observe its input and output; it always delegates to the real function.
const REVISION_KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];

function etsBody(f, task) {
  const observed = buildProjectTaskContext({ projectId: f.request.projectId, task: { title: task.title } }, f.options).revision;
  // The pack reports the repository id as repositoryIdentity; the ETS request names it repositoryId.
  const source = { ...observed, repositoryId: observed.repositoryIdentity };
  const expectedRevision = Object.fromEntries(REVISION_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  return { task, worktree: { rootId: "test", relativePath: "main" }, expectedRevision, includeTests: true, changeSemantics: { category: "local_implementation" } };
}

async function dispatchEts(f, body) {
  const calls = [];
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots,
    buildProjectTaskContext(input, options) {
      const pack = buildProjectTaskContext(input, options);
      calls.push({ input, echo: pack.sections.task.items });
      return pack;
    }
  });
  const req = Readable.from([JSON.stringify(body)]);
  req.method = "POST";
  req.url = `/api/intelligence/projects/${f.request.projectId}/effective-task-scope`;
  req.headers = { host: "localhost" };
  const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.body = text; } };
  assert.equal(await router.dispatch(req, res), true);
  return { status: res.status, payload: JSON.parse(res.body), calls };
}

const codes = (data) => (data?.reasons || []).map((reason) => reason.code);

for (const [name, task] of [
  ["two paths", { id: "task-1", title: "Fix One", paths: ["src/one.ts", "src/unrelated.ts"] }],
  ["paths and symbols", { id: "task-2", title: "Fix One symbol", paths: ["src/one.ts", "tests/one.test.ts"], symbols: ["One"] }]
]) {
  test(`ETS route + real Context Pack builder: task echo equals the request task, no task_echo_mismatch (${name})`, async (t) => {
    const f = taskContextFixture(t);
    const result = await dispatchEts(f, etsBody(f, task));
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(codes(result.payload.data).includes("task_echo_mismatch"), false, JSON.stringify(result.payload.data.reasons));
    assert.equal(codes(result.payload.data).includes("task_echo_missing"), false);
    assert.notEqual(result.payload.data.status, "rejected", JSON.stringify(result.payload.data.reasons));
    assert.equal(result.calls.length, 1);
    const [echo] = result.calls[0].echo;
    assert.deepEqual({ id: echo.id, title: echo.title, paths: echo.paths, symbols: echo.symbols },
      { id: task.id, title: task.title, paths: [...task.paths].sort(), symbols: task.symbols ?? [] });
  });
}

test("ETS route + real Context Pack builder: a single-path task is not an echo mismatch (it stays the documented origin_form_mismatch)", async (t) => {
  const f = taskContextFixture(t);
  const task = { id: "task-3", title: "Fix One alone", paths: ["src/one.ts"] };
  const result = await dispatchEts(f, etsBody(f, task));
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(codes(result.payload.data).includes("task_echo_mismatch"), false, JSON.stringify(result.payload.data.reasons));
  const [echo] = result.calls[0].echo;
  assert.deepEqual({ id: echo.id, title: echo.title, paths: echo.paths, symbols: echo.symbols }, { ...task, symbols: [] });
  assert.equal(result.payload.data.status, "rejected");
  assert.deepEqual(codes(result.payload.data), ["origin_form_mismatch"]);
});
