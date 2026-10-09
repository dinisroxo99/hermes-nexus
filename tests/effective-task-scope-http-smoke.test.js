import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

// Read-only HTTP smoke: the real server entry (src/server.js) in a child process on 127.0.0.1 with an
// ephemeral port (PORT=0; never 8770/8771), against a disposable fixture project under os.tmpdir().
// It calls the read-only task-context and effective-task-scope endpoints, checks that the pack echoes the
// request task (no task_echo_mismatch), that create and the absence witness stay refused over HTTP,
// and that the fixture tree is byte-identical afterwards. The child is always terminated.
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.js");
const REVISION_KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];

function treeDigest(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name === ".git") continue; // git may refresh its index stat cache on read
      hash.update(`${path.relative(root, full)}\0${entry.isDirectory() ? "d" : "f"}\0`);
      if (entry.isDirectory()) walk(full); else hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest("hex");
}

async function startServer(t, f) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")
    && !["PORT", "HOST", "DATA_DIR", "PROJECTS_ROOT", "PROJECTS_ROOT_CONTAINER", "PROJECTS_ROOTS", "SERENA_PYTHON_IMAGE", "INTELLIGENCE_REGISTRY_WRITES_ENABLED"].includes(key)));
  Object.assign(env, { PORT: "0", HOST: "127.0.0.1", DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify([{ id: "test", path: f.root }]) });
  // cwd is the fixture root, so no repository .env is read by the server's config resolver.
  const child = spawn(process.execPath, [SERVER], { cwd: f.root, env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exited; });
  let output = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 15000);
    const onData = (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${output}`)); });
  });
  assert.ok(port > 0 && port !== 8770 && port !== 8771, `ephemeral port ${port}`);
  return `http://127.0.0.1:${port}`;
}

async function post(base, route, body) {
  const response = await fetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify(body) });
  return { status: response.status, payload: await response.json() };
}

test("HTTP smoke (read-only): ETS over the real server echoes the request task, no task_echo_mismatch; create and the absence witness stay refused", async (t) => {
  const f = taskContextFixture(t);
  const before = treeDigest(f.root);
  const base = await startServer(t, f);
  const projectRoute = `/api/intelligence/projects/${f.request.projectId}`;
  const task = { id: "smoke-1", title: "Smoke task echo", paths: ["src/one.ts", "src/unrelated.ts"], symbols: ["One"] };

  const health = await fetch(`${base}/api/health`, { headers: { connection: "close" } });
  assert.equal(health.status, 200);

  const pack = await post(base, `${projectRoute}/task-context`, { task });
  assert.equal(pack.status, 200, JSON.stringify(pack.payload));
  const [echo] = pack.payload.data.sections.task.items;
  assert.deepEqual({ id: echo.id, title: echo.title, paths: echo.paths, symbols: echo.symbols }, task);

  const observed = buildProjectTaskContext({ projectId: f.request.projectId, task: { title: task.title } }, f.options).revision;
  const source = { ...observed, repositoryId: observed.repositoryIdentity };
  const expectedRevision = Object.fromEntries(REVISION_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  const body = { task, worktree: { rootId: "test", relativePath: "main" }, expectedRevision, includeTests: true, changeSemantics: { category: "local_implementation" } };
  const ets = await post(base, `${projectRoute}/effective-task-scope`, body);
  assert.equal(ets.status, 200, JSON.stringify(ets.payload));
  const codes = ets.payload.data.reasons.map((reason) => reason.code);
  assert.equal(codes.includes("task_echo_mismatch"), false, JSON.stringify(codes));
  assert.equal(codes.includes("task_echo_missing"), false, JSON.stringify(codes));
  assert.notEqual(ets.payload.data.status, "rejected", JSON.stringify(codes));

  const create = await post(base, `${projectRoute}/effective-task-scope`, { ...body, operationIntent: { kind: "create", targets: task.paths.map((newPath) => ({ oldPath: null, newPath })) } });
  assert.equal(create.status, 400); assert.equal(create.payload.error, "invalid_delete_intent");
  const witness = await post(base, `${projectRoute}/effective-task-scope`, { ...body, createDestinationAbsenceWitness: { kind: "labelled-synthetic-absence-witness" } });
  assert.equal(witness.status, 400); assert.equal(witness.payload.error, "unexpected_field");

  assert.equal(treeDigest(f.root), before, "fixture tree unchanged (read-only)");
  assert.equal(fs.existsSync(f.options.registry.discoveredProjectsFile), false);
});
