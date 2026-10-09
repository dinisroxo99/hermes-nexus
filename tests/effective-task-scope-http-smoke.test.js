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

test("HTTP smoke (read-only): one path and two paths both pass binding -> not_evaluated / working_tree_observation_only, no containers", async (t) => {
  const f = taskContextFixture(t);
  const before = treeDigest(f.root);
  const base = await startServer(t, f);
  const route = `/api/intelligence/projects/${f.request.projectId}/effective-task-scope`;
  const observed = buildProjectTaskContext({ projectId: f.request.projectId, task: { title: "Smoke origin form" } }, f.options).revision;
  const source = { ...observed, repositoryId: observed.repositoryIdentity };
  const expectedRevision = Object.fromEntries(REVISION_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  // The temp fixture has no src/lib/project-overview.js; src/one.ts is its single-path equivalent.
  for (const paths of [["src/one.ts"], ["src/one.ts", "src/unrelated.ts"]]) {
    const body = { task: { id: `smoke-${paths.length}`, title: "Smoke origin form", paths }, worktree: { rootId: "test", relativePath: "main" },
      expectedRevision, includeTests: true, changeSemantics: { category: "local_implementation" } };
    const { status, payload } = await post(base, route, body);
    assert.equal(status, 200, JSON.stringify(payload));
    assert.equal(payload.ok, true);
    const data = payload.data;
    const codes = data.reasons.map((reason) => reason.code);
    assert.equal(data.status, "not_evaluated", `${paths.length} path(s): ${JSON.stringify(codes)}`);
    assert.ok(codes.includes("working_tree_observation_only"), JSON.stringify(codes));
    for (const code of ["origin_form_mismatch", "task_echo_mismatch", "origin_set_mismatch"]) assert.equal(codes.includes(code), false, code);
    assert.equal(data.stale.state, "bound");
    assert.equal(data.policyVersion, "step4-foundation-6");
    assert.deepEqual(data.task.paths, paths);
    for (const key of ["write", "watch", "impact", "reserved", "operationIntent"]) assert.equal(Object.hasOwn(data, key), false, key);
    console.log(`SMOKE ${paths.length}-path ${JSON.stringify({ status: data.status, reasons: data.reasons, stale: data.stale, policyVersion: data.policyVersion, task: data.task.paths })}`);
  }
  assert.equal(treeDigest(f.root), before, "fixture tree unchanged (read-only)");
});

test("HTTP smoke (read-only): includeTests true/false forwarded; main checkout and clean linked worktree, one and two paths", async (t) => {
  const ONE = ["src/one.ts"];
  const TWO = ["src/one.ts", "src/unrelated.ts"];
  const cases = [];
  for (const kind of ["main", "linked"]) {
    const f = taskContextFixture(t);
    let projectId = f.request.projectId;
    let options = f.options;
    if (kind === "linked") {
      // Same registry shape as the in-process include-tests suite; the name must stay "fixture" (AGENT.md project).
      f.worktree("linked");
      projectId = "PrJ_Linked";
      fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "linked", projectId }]));
      options = { registry: { ...f.options.registry } };
    }
    const before = treeDigest(f.root);
    const base = await startServer(t, f);
    const route = `/api/intelligence/projects/${projectId}/effective-task-scope`;
    const observed = buildProjectTaskContext({ projectId, task: { title: "Smoke includeTests" } }, options).revision;
    const source = { ...observed, repositoryId: observed.repositoryIdentity };
    const expectedRevision = Object.fromEntries(REVISION_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
    const bodyFor = (paths, includeTests) => ({ task: { id: `smoke-it-${paths.length}`, title: "Smoke includeTests", paths },
      worktree: { rootId: "test", relativePath: kind }, expectedRevision, includeTests, changeSemantics: { category: "local_implementation" } });
    for (const paths of [ONE, TWO]) for (const includeTests of [true, false]) {
      const { status, payload } = await post(base, route, bodyFor(paths, includeTests));
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.ok, true);
      const data = payload.data;
      const codes = data.reasons.map((reason) => reason.code);
      const label = `${kind} ${paths.length}p includeTests=${includeTests}`;
      assert.equal(data.policyVersion, "step4-foundation-6", label);
      assert.equal(data.stale.state, "bound", label);
      assert.deepEqual(data.task.paths, paths, label);
      if (kind === "main") {
        assert.equal(data.status, "not_evaluated", `${label}: ${JSON.stringify(codes)}`);
        assert.deepEqual(codes, ["working_tree_observation_only"], label);
        assert.deepEqual(data.completeness.resolver, ["working_tree_observation_only"], label);
        assert.deepEqual(data.limits, { compactBytes: 65536, classifiedTargets: 0, originWitnessRefs: 0, resolverReasons: 1 }, label);
        for (const key of ["write", "watch", "impact", "reserved", "operationIntent"]) assert.equal(Object.hasOwn(data, key), false, `${label} ${key}`);
      } else {
        assert.equal(data.status, "incomplete", `${label}: ${JSON.stringify(codes)}`);
        assert.deepEqual(codes, [], label);
        assert.equal(codes.includes("includeTests_true_not_requested_mismatch"), false, label);
        assert.deepEqual(data.completeness.resolver, [], label);
        assert.deepEqual(data.write.items.map((item) => [item.target.path, item.roles, item.ruleIds]), paths.map((p) => [p, ["explicit_task_path"], ["explicit_task_path"]]), label);
        assert.deepEqual(data.watch.items.map((item) => [item.target.path, item.roles, item.ruleIds]),
          [["tests/one.test.ts", includeTests ? ["affected_file", "affected_test_candidate"] : ["affected_file"], ["distance_1_2_awareness"]]], label);
        assert.deepEqual(data.impact.items, [], label);
        assert.equal(data.reserved.status, "not_evaluated", label);
        assert.equal(Object.hasOwn(data, "operationIntent"), false, label);
        assert.deepEqual(data.limits, { compactBytes: 65536, classifiedTargets: paths.length + 1, originWitnessRefs: 1, resolverReasons: 0 }, label);
      }
      cases.push(label);
      console.log(`SMOKE ${label} ${JSON.stringify({ status: data.status, reasons: codes, resolver: data.completeness.resolver, stale: data.stale.state,
        write: data.write?.items.map((item) => item.target.path), watch: data.watch?.items.map((item) => [item.target.path, item.roles]), limits: data.limits })}`);
    }
    for (const includeTests of [true, false]) {
      const create = await post(base, route, { ...bodyFor(ONE, includeTests), operationIntent: { kind: "create", targets: [{ oldPath: null, newPath: "src/new.ts" }] } });
      assert.equal(create.status, 400); assert.equal(create.payload.error, "invalid_delete_intent");
      const witness = await post(base, route, { ...bodyFor(ONE, includeTests), createDestinationAbsenceWitness: { kind: "labelled-synthetic-absence-witness" } });
      assert.equal(witness.status, 400); assert.equal(witness.payload.error, "unexpected_field");
    }
    console.log(`SMOKE ${kind} create -> 400 invalid_delete_intent; witness -> 400 unexpected_field (includeTests true and false)`);
    assert.equal(treeDigest(f.root), before, `${kind} fixture tree unchanged (read-only)`);
    assert.equal(fs.existsSync(f.options.registry.discoveredProjectsFile), false);
  }
  assert.equal(cases.length, 8);
});
