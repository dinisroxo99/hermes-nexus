import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { gitFixture } from "./helpers/git-fixture.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";

// Read-only HTTP smoke for F1 (SB-1, symbol-less import edges): the real server entry (src/server.js) in a
// child process on 127.0.0.1 with an ephemeral port (PORT=0; never 8770/8771), against disposable fixture
// repositories under os.tmpdir(). It checks that the MIXED fixture is no longer silently complete
// (provider_partial surfaces through Pack, Impact and ETS), that module anchors never appear in any output,
// that ETS never adds WRITE beyond the explicit task path (and none on a main checkout), and that create and
// the absence witness stay refused. The fixture tree is byte-identical afterwards; the child is always terminated.
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.js");
const REVISION_KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
const LIB = "export function helper() { return 1; }\nexport class Widget {}\nexport const lowerConst = 2;\n";
const CLEAN = {
  "src/lib.js": LIB,
  "tests/lib.test.js": "import test from \"node:test\";\nimport { helper } from \"../src/lib.js\";\ntest(\"helper\", () => helper());\n"
};
const MIXED = {
  ...CLEAN,
  "src/side-effect.js": "import { helper } from \"./lib.js\";\nhelper();\n",
  "src/import-only.js": "import { Widget } from \"./lib.js\";\n",
  "src/index.js": "export { helper, Widget } from \"./lib.js\";\n",
  "src/consumer.js": "import { Widget } from \"./index.js\";\nexport function UseWidget() { return Widget; }\n",
  "src/app.js": "import \"./side-effect.js\";\nexport function App() { return 1; }\n",
  "src/uses-const.js": "import { lowerConst } from \"./lib.js\";\nexport function UsesConst() { return lowerConst; }\n",
  "tests/ns.test.js": "import test from \"node:test\";\nimport * as lib from \"../src/lib.js\";\ntest(\"ns\", () => lib.helper());\n"
};
const MIXED_WATCH = ["src/consumer.js", "src/import-only.js", "src/index.js", "src/side-effect.js", "tests/lib.test.js"];

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

function fixture(t, files, kind) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{\"type\":\"module\"}\n");
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  f.commit();
  if (kind === "linked") f.worktree("linked");
  const projectId = kind === "linked" ? "PrJ_F1_Linked" : "PrJ_F1";
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: kind, projectId }]));
  const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "discovered-projects.json") } };
  return { ...f, kind, projectId, options };
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
  const text = await response.text();
  return { status: response.status, text, payload: JSON.parse(text) };
}

function assertNoAnchor(label, text) {
  assert.equal(text.includes("<module>"), false, `${label}: module anchor label leaked`);
  assert.equal(/"kind":"module"/.test(text), false, `${label}: module kind leaked`);
}

function etsBody(f) {
  const observed = buildProjectTaskContext({ projectId: f.projectId, task: { title: "F1 smoke" } }, f.options).revision;
  const source = { ...observed, repositoryId: observed.repositoryIdentity };
  const expectedRevision = Object.fromEntries(REVISION_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  return { task: { id: "f1-smoke", title: "F1 smoke", paths: ["src/lib.js"] }, worktree: { rootId: "test", relativePath: f.kind },
    expectedRevision, includeTests: true, changeSemantics: { category: "local_implementation" } };
}

async function assertGates(base, route, body, label) {
  const create = await post(base, route, { ...body, operationIntent: { kind: "create", targets: [{ oldPath: null, newPath: "src/new.js" }] } });
  assert.equal(create.status, 400, label); assert.equal(create.payload.error, "invalid_delete_intent", label);
  const witness = await post(base, route, { ...body, createDestinationAbsenceWitness: { kind: "labelled-synthetic-absence-witness" } });
  assert.equal(witness.status, 400, label); assert.equal(witness.payload.error, "unexpected_field", label);
}

test("F1 HTTP smoke (read-only): MIXED main checkout: Pack and Impact report provider partial, no anchors, ETS has no WRITE; create/witness 400", async (t) => {
  const f = fixture(t, MIXED, "main");
  const before = treeDigest(f.root);
  const base = await startServer(t, f);
  const projectRoute = `/api/intelligence/projects/${f.projectId}`;

  const pack = await post(base, `${projectRoute}/task-context`, { task: { id: "f1-pack", title: "F1 smoke", paths: ["src/lib.js", "src/side-effect.js", "tests/lib.test.js"] } });
  assert.equal(pack.status, 200, pack.text);
  assertNoAnchor("pack", pack.text);
  const p = pack.payload.data;
  assert.equal(p.analysis.status, "partial");
  assert.equal(p.analysis.provider.id, "native.typescript");
  assert.equal(p.analysis.provider.version, "2");
  assert.equal(p.observation.incomplete, true);
  assert.ok(p.sections.symbols.items.every((s) => s.kind !== "module" && s.name !== "<module>"));

  const impact = await post(base, `${projectRoute}/impact`, { paths: ["src/lib.js"], includeTests: true });
  assert.equal(impact.status, 200, impact.text);
  assertNoAnchor("impact", impact.text);
  const i = impact.payload.data;
  assert.equal(i.status, "partial");
  assert.equal(i.observation.incomplete, true);
  assert.ok(i.completeness.provider.includes("provider_partial"), JSON.stringify(i.completeness));
  const affected = i.affectedFiles.map((a) => a.path).sort();
  for (const file of MIXED_WATCH) assert.ok(affected.includes(file), `${file} missing from ${JSON.stringify(affected)}`);
  assert.ok(i.affectedTests.candidates.map((c) => c.path).includes("tests/lib.test.js"));

  const route = `${projectRoute}/effective-task-scope`;
  const body = etsBody(f);
  const ets = await post(base, route, body);
  assert.equal(ets.status, 200, ets.text);
  assertNoAnchor("ets main", ets.text);
  const d = ets.payload.data;
  assert.equal(d.status, "not_evaluated");
  assert.deepEqual(d.reasons.map((r) => r.code), ["working_tree_observation_only"]);
  assert.equal(d.policyVersion, "step4-foundation-6");
  for (const key of ["write", "watch", "impact", "reserved", "operationIntent"]) assert.equal(Object.hasOwn(d, key), false, key);
  await assertGates(base, route, body, "main");
  console.log(`SMOKE F1 main pack ${JSON.stringify({ analysis: p.analysis.status, provider: `${p.analysis.provider.id}@${p.analysis.provider.version}`, incomplete: p.observation.incomplete })}`);
  console.log(`SMOKE F1 main impact ${JSON.stringify({ status: i.status, completeness: Object.fromEntries(Object.entries(i.completeness).filter(([, v]) => v.length)), affected })}`);
  console.log(`SMOKE F1 main ets ${JSON.stringify({ status: d.status, reasons: d.reasons.map((r) => r.code), write: d.write ?? null })}; create/witness -> 400`);

  assert.equal(treeDigest(f.root), before, "fixture tree unchanged (read-only)");
  assert.equal(fs.existsSync(f.options.registry.discoveredProjectsFile), false);
});

test("F1 HTTP smoke (read-only): clean linked worktree, CLEAN and MIXED: ETS surfaces provider_partial only for MIXED, WRITE is only the task path, no anchors; create/witness 400", async (t) => {
  for (const [name, files] of [["CLEAN", CLEAN], ["MIXED", MIXED]]) {
    const f = fixture(t, files, "linked");
    const before = treeDigest(f.root);
    const base = await startServer(t, f);
    const route = `/api/intelligence/projects/${f.projectId}/effective-task-scope`;
    const body = etsBody(f);
    const ets = await post(base, route, body);
    assert.equal(ets.status, 200, ets.text);
    assertNoAnchor(`ets linked ${name}`, ets.text);
    const d = ets.payload.data;
    const codes = d.reasons.map((r) => r.code);
    const watch = d.watch.items.map((item) => item.target.path).sort();
    assert.equal(d.status, "incomplete", `${name}: ${JSON.stringify(codes)}`);
    assert.equal(d.policyVersion, "step4-foundation-6");
    assert.equal(d.stale.state, "bound");
    assert.deepEqual(d.write.items.map((item) => [item.target.path, item.ruleIds]), [["src/lib.js", ["explicit_task_path"]]], name);
    assert.equal(d.reserved.status, "not_evaluated");
    assert.equal(Object.hasOwn(d, "operationIntent"), false);
    if (name === "CLEAN") {
      assert.deepEqual(codes, []);
      assert.deepEqual(d.completeness.provider, []);
      assert.deepEqual(watch, ["tests/lib.test.js"]);
    } else {
      assert.deepEqual(codes.slice().sort(), ["impact_observation_incomplete", "pack_observation_incomplete"]);
      assert.ok(d.completeness.provider.includes("provider_partial"), JSON.stringify(d.completeness));
      assert.ok(d.completeness.source.includes("pack_incomplete"), JSON.stringify(d.completeness));
      assert.deepEqual(watch, MIXED_WATCH);
    }
    await assertGates(base, route, body, name);
    console.log(`SMOKE F1 linked ${name} ets ${JSON.stringify({ status: d.status, reasons: codes, completeness: Object.fromEntries(Object.entries(d.completeness).filter(([, v]) => v.length)),
      write: d.write.items.map((item) => item.target.path), watch, reserved: d.reserved.status })}; create/witness -> 400`);
    assert.equal(treeDigest(f.root), before, `${name} fixture tree unchanged (read-only)`);
    assert.equal(fs.existsSync(f.options.registry.discoveredProjectsFile), false);
  }
});
