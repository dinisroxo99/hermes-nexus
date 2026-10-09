import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

// Read-only HTTP smoke for SB-2 (ETS worktree locator forwarding): the real server entry (src/server.js) in a child
// process on 127.0.0.1 with an ephemeral port (PORT=0; never 8770/8771), against a disposable parent repository
// (registered as PrJ_Context at test/main) with an unregistered linked worktree test/linked that carries a committed
// tests/linked-only.test.ts. It compares the self-located main checkout with the parent + linked-locator request
// (1 and 2 paths), pins the 404/409/400 locator outcomes, and checks create and the absence witness stay refused.
// The fixture tree is byte-identical afterwards; the child is always terminated.
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.js");
const REVISION_KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
const MAIN = { rootId: "test", relativePath: "main" };
const LINKED = { rootId: "test", relativePath: "linked" };

function treeDigest(root) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const full = path.join(dir, entry.name);
      if (entry.name === ".git") continue; // git may refresh its index stat cache on read; linked worktrees hold a .git file
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
  const child = spawn(process.execPath, [SERVER], { cwd: f.root, env, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await exited; });
  let output = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
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

test("SB-2 HTTP smoke (read-only): parent + linked locator vs self-located main, 1 and 2 paths; 404/409/400 locator pins; create/witness 400", async (t) => {
  const f = taskContextFixture(t);
  const linkedDir = f.worktree("linked");
  f.write("tests/linked-only.test.ts", "import { One } from '../src/one'; export function LinkedOnly() { return One; }\n", linkedDir);
  f.commit("linked-only", linkedDir);
  fs.mkdirSync(path.join(f.root, "plain"));
  const before = treeDigest(f.root);
  const base = await startServer(t, f);
  const projectId = f.request.projectId;
  const route = `/api/intelligence/projects/${projectId}/effective-task-scope`;
  const revisionFor = (worktree) => {
    const observed = buildProjectTaskContext({ projectId, ...(worktree === MAIN ? {} : { worktree }), task: { title: "SB-2 smoke" } }, f.options).revision;
    const source = { ...observed, repositoryId: observed.repositoryIdentity };
    return Object.fromEntries(REVISION_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  };
  const expected = { main: revisionFor(MAIN), linked: revisionFor(LINKED) };
  assert.notEqual(expected.main.worktreeId, expected.linked.worktreeId);
  const bodyFor = (worktree, paths, includeTests = true) => ({ task: { id: `sb2-${paths.length}`, title: "SB-2 smoke", paths }, worktree,
    expectedRevision: worktree === LINKED ? expected.linked : expected.main, includeTests, changeSemantics: { category: "local_implementation" } });

  for (const paths of [["src/one.ts"], ["src/one.ts", "src/unrelated.ts"]]) {
    const main = await post(base, route, bodyFor(MAIN, paths));
    assert.equal(main.status, 200, JSON.stringify(main.payload));
    const m = main.payload.data;
    assert.equal(m.status, "not_evaluated");
    assert.deepEqual(m.reasons.map((r) => r.code), ["working_tree_observation_only"]);
    assert.equal(m.stale.state, "bound");
    for (const key of ["write", "watch", "impact", "reserved", "operationIntent"]) assert.equal(Object.hasOwn(m, key), false, key);
    console.log(`SMOKE SB-2 main ${paths.length}p ${JSON.stringify({ status: m.status, reasons: m.reasons.map((r) => r.code), stale: m.stale.state, limits: m.limits })}`);

    for (const includeTests of [true, false]) {
      const linked = await post(base, route, bodyFor(LINKED, paths, includeTests));
      assert.equal(linked.status, 200, JSON.stringify(linked.payload));
      const d = linked.payload.data;
      const label = `linked ${paths.length}p includeTests=${includeTests}`;
      assert.equal(d.status, "incomplete", `${label}: ${JSON.stringify(d.reasons)}`);
      assert.deepEqual(d.reasons, [], label);
      assert.deepEqual(d.completeness.resolver, [], label);
      assert.equal(d.stale.state, "bound", label);
      assert.equal(d.policyVersion, "step4-foundation-6", label);
      assert.deepEqual(d.task.paths, paths, label);
      assert.deepEqual(d.write.items.map((item) => [item.target.path, item.ruleIds]), paths.map((p) => [p, ["explicit_task_path"]]), label);
      assert.deepEqual(d.watch.items.map((item) => item.target.path).sort(), ["tests/linked-only.test.ts", "tests/one.test.ts"], label);
      assert.deepEqual(d.impact.items, [], label);
      assert.equal(d.reserved.status, "not_evaluated", label);
      assert.equal(Object.hasOwn(d, "operationIntent"), false, label);
      assert.deepEqual(d.limits, { compactBytes: 65536, classifiedTargets: paths.length + 2, originWitnessRefs: 2, resolverReasons: 0 }, label);
      console.log(`SMOKE SB-2 ${label} ${JSON.stringify({ status: d.status, reasons: d.reasons, stale: d.stale.state, write: d.write.items.map((i) => i.target.path),
        watch: d.watch.items.map((i) => [i.target.path, i.roles]), reserved: d.reserved.status, limits: d.limits })}`);
    }
  }

  const pins = [
    ["unregistered rootId", { rootId: "nope", relativePath: "linked" }, 404, "project_unavailable"],
    ["missing directory", { rootId: "test", relativePath: "missing" }, 404, "project_unavailable"],
    ["plain directory", { rootId: "test", relativePath: "plain" }, 409, "worktree_parent_mismatch"],
    ["subdirectory of the parent", { rootId: "test", relativePath: "main/src" }, 409, "worktree_parent_mismatch"],
    ["subdirectory of the linked worktree", { rootId: "test", relativePath: "linked/src" }, 409, "worktree_parent_mismatch"],
    ["glob metacharacters (Impact contract)", { rootId: "test", relativePath: "wt[1]" }, 400, "invalid_impact_request"],
    [".git segment (Pack contract)", { rootId: "test", relativePath: ".git" }, 400, "invalid_task_context_request"]
  ];
  for (const [name, worktree, status, code] of pins) {
    const r = await post(base, route, { ...bodyFor(MAIN, ["src/one.ts"]), worktree });
    assert.deepEqual([r.status, r.payload.error], [status, code], `${name}: ${JSON.stringify(r.payload)}`);
    console.log(`SMOKE SB-2 locator ${name} -> ${r.status} ${r.payload.error}`);
  }
  const unknown = await post(base, `/api/intelligence/projects/PrJ_Unknown/effective-task-scope`, bodyFor(LINKED, ["src/one.ts"]));
  assert.deepEqual([unknown.status, unknown.payload.error], [404, "project_not_found"]);
  console.log(`SMOKE SB-2 unknown projectId -> ${unknown.status} ${unknown.payload.error}`);

  for (const worktree of [MAIN, LINKED]) {
    const b = bodyFor(worktree, ["src/new.ts"]);
    const create = await post(base, route, { ...b, operationIntent: { kind: "create", targets: [{ oldPath: null, newPath: "src/new.ts" }] } });
    assert.deepEqual([create.status, create.payload.error], [400, "invalid_delete_intent"]);
    const witness = await post(base, route, { ...b, createDestinationAbsenceWitness: { kind: "labelled-synthetic-absence-witness" } });
    assert.deepEqual([witness.status, witness.payload.error], [400, "unexpected_field"]);
  }
  console.log("SMOKE SB-2 create -> 400 invalid_delete_intent; witness -> 400 unexpected_field (main and linked locator)");

  assert.equal(treeDigest(f.root), before, "fixture tree unchanged (read-only)");
  assert.equal(fs.existsSync(f.options.registry.discoveredProjectsFile), false);
});
