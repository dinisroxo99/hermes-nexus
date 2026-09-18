import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contextDigest, collectContextSources } from "../src/lib/project-context-files.js";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest, readExternalSnapshotResponse } from "../src/analyzers/external/snapshot-provider.js";
import { runSerenaSnapshot } from "../src/analyzers/external/serena-transport.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";

const enabled = process.env.SERENA_DOCKER_TESTS === "1";
const provider = { id: "external.serena-python", version: "1-f8f53b77-pyright-1.1.403", kind: "external", priority: 50, languages: ["python"],
  capabilities: { boundedSourceAnalysis: "structural", detection: "structural", symbols: "semantic", definitions: "semantic", references: "semantic" } };
const files = [{ path: "models.py", text: "class Greeter:\n    def greet(self):\n        return 'hello'\n" }];

function runWorker(t, sources = files, alterRequest, expectFailure = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-serena-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.chmodSync(root, 0o755);
  for (const file of sources) {
    const target = path.join(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.text, { mode: 0o444 });
  }
  const snapshot = createProviderSnapshot({ projectId: "Prj_Python" }, sources, { status: "not_git" });
  const request = createExternalSnapshotRequest(snapshot, provider);
  const observedSourceToken = contextDigest(JSON.stringify(request.files.map(({ path, sha256 }) => [path, sha256])));
  const input = { ...request, observedSourceToken };
  alterRequest?.(input);
  const image = spawnSync("docker", ["image", "inspect", "project-map-serena-python:1", "--format", "{{.Id}}"], { encoding: "utf8" });
  assert.equal(image.status, 0, `Build the optional image first: ${image.stderr}`);
  const result = spawnSync("docker", ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--user=65532:65532",
    "--cap-drop=ALL", "--security-opt=no-new-privileges", "--cpus=2", "--memory=1g", "--memory-swap=1g", "--pids-limit=64", "--log-driver=none",
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m", "--shm-size=1m", "--mount", `type=bind,source=${root},target=/snapshot,readonly`, "-i", image.stdout.trim()],
  { encoding: "utf8", input: JSON.stringify(input), timeout: 30000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined);
  if (expectFailure) {
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "serena_analysis_unavailable\n");
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  const raw = JSON.parse(result.stdout);
  assert.equal(raw.observedSourceToken, observedSourceToken);
  // The generic observed-source field is introduced with the transport slice.
  const { observedSourceToken: observed, ...legacyEnvelope } = raw;
  return { raw, normalized: readExternalSnapshotResponse(snapshot, provider, JSON.stringify(legacyEnvelope)) };
}

test("real sandboxed Serena/Pyright discovers Python symbols", { skip: !enabled }, (t) => {
  const { raw, normalized } = runWorker(t);
  assert.equal(raw.status, "available");
  assert.ok(normalized.nodes.some((node) => node.label === "Greeter" && node.line === 1));
  assert.ok(normalized.nodes.some((node) => node.label === "greet" && node.line === 2));
});

test("real Pyright resolves cross-file Python definitions and references", { skip: !enabled }, (t) => {
  const { normalized: result } = runWorker(t, [
    { path: "models.py", text: "def greet(name: str):\n    return name\n" },
    { path: "usage.py", text: "from models import greet\n\ndef caller():\n    return greet('world')\n" }
  ]);
  const greet = result.nodes.find((n) => n.label === "greet" && n.file === "models.py");
  const caller = result.nodes.find((n) => n.label === "caller");
  assert.ok(greet); assert.ok(caller);
  assert.ok(result.definitions.some((d) => d.symbolId === greet.id && d.target.path === "models.py" && d.target.line === 1 && d.target.column === 5));
  assert.ok(result.edges.some((e) => e.from === caller.id && e.to === greet.id && e.relation === "references" && e.location.path === "usage.py" && e.location.line === 4 && e.location.column === 12));
});

test("real Docker transport validates and disposes a Python snapshot", { skip: !enabled }, () => {
  const image = spawnSync("docker", ["image", "inspect", "project-map-serena-python:1", "--format", "{{.Id}}"], { encoding: "utf8" }).stdout.trim();
  const snapshot = createProviderSnapshot({ projectId: "Prj_Transport" }, files, { status: "not_git" });
  const result = runSerenaSnapshot(snapshot, { image });
  assert.equal(result.status, "available");
  const graph = readExternalSnapshotResponse(snapshot, provider, result.response, { requireObservedSource: true });
  assert.ok(graph.nodes.some((node) => node.label === "Greeter"));
  for (const other of [
    createProviderSnapshot({ projectId: "Other_Project" }, files, { status: "not_git" }),
    createProviderSnapshot({ projectId: "Prj_Transport" }, files, { status: "available", commitSha: "a".repeat(40) }),
    createProviderSnapshot({ projectId: "Prj_Transport" }, files, { status: "not_git", worktreeId: "other_worktree" }),
    createProviderSnapshot({ projectId: "Prj_Transport" }, [{ ...files[0], text: "class Changed: pass\n" }], { status: "not_git" })
  ]) assert.throws(() => readExternalSnapshotResponse(other, provider, result.response, { requireObservedSource: true }), { code: "invalid_external_evidence" });
});

test("Context Pack consumes real normalized Python evidence without changing source security", { skip: !enabled }, (t) => {
  const f = taskContextFixture(t);
  f.write("models.py", "def greet(name: str):\n    return name\n");
  f.write("usage.py", "from models import greet\n\ndef caller():\n    return greet('world')\n");
  const image = spawnSync("docker", ["image", "inspect", "project-map-serena-python:1", "--format", "{{.Id}}"], { encoding: "utf8" }).stdout.trim();
  const request = { ...f.request, task: { title: "Inspect greet", paths: ["models.py"] } };
  const options = { ...f.options, analyzer: { serena: { image }, requiredLanguages: ["python"] } };
  const pack = buildProjectTaskContext(request, options);
  assert.equal(pack.analysis.provider.id, provider.id);
  assert.equal(pack.analysis.status, "partial");
  assert.deepEqual(pack.analysis.coverage.uncovered, ["typescript"]);
  assert.ok(pack.sections.symbols.items.some((s) => s.name === "greet" && s.line === 1));
  assert.ok(pack.sections.references.items.length > 0);
  assert.equal(pack.sections.symbols.items[0].provenance.trust, "untrusted_external_analysis");
  assert.equal(pack.observation.cacheReuse, "disabled");
  assert.equal(JSON.stringify(pack).includes(f.root), false);
  assert.deepEqual(buildProjectTaskContext(request, options), pack);
  const changed = { ...options, collectSources(project, limits) {
    const result = collectContextSources(project, limits);
    f.write("models.py", "def changed(): pass\n");
    return result;
  } };
  assert.throws(() => buildProjectTaskContext(request, changed), { code: "context_sources_changed" });
});

test("worker rejects commands, incomplete operations and false mounted-source bindings", { skip: !enabled }, (t) => {
  for (const alter of [
    (r) => { r.command = "shell"; },
    (r) => { r.operations = []; },
    (r) => { r.operations.push("write_memory"); },
    (r) => { r.providerId = "other"; },
    (r) => { r.providerVersion = "other"; },
    (r) => { r.files[0].sha256 = "a".repeat(64); },
    (r) => { r.files[0].text = "class Other: pass\n"; },
    (r) => { r.observedSourceToken = "a".repeat(64); }
  ]) runWorker(t, files, alter, true);
});

test("real Python evidence retains UTF-16 columns and encoded snapshot paths", { skip: !enabled }, (t) => {
  const { normalized: result } = runWorker(t, [
    { path: "models.py", text: "def greet():\n    return 'hello'\n" },
    { path: "🐍.py", text: "from models import greet\ndef caller():\n    return '🐍' + greet()\n" },
    { path: "\ue000.py", text: "class Other: pass\n" }
  ]);
  const greet = result.nodes.find((n) => n.label === "greet");
  assert.ok(result.edges.some((edge) => edge.to === greet.id && edge.location.path === "🐍.py" && edge.location.line === 3 && edge.location.column === 19));
});

test("real Python symbol budget reports partial rather than complete evidence", { skip: !enabled }, (t) => {
  const { raw, normalized } = runWorker(t, [{ path: "many.py", text: Array.from({ length: 300 }, (_, i) => `def fn_${i}(): pass`).join("\n") }]);
  assert.equal(raw.status, "partial");
  assert.equal(normalized.limited, true);
  assert.equal(normalized.nodes.length, 256);
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) <= 256 * 1024);
});

test("real Serena accepts uppercase Python suffixes without renaming source paths", { skip: !enabled }, (t) => {
  for (const sources of [
    [{ path: "models.PY", text: "class Upper: pass\n" }],
    [{ path: "models.pY", text: "class Upper: pass\n" }, { path: "valid.py", text: "class Lower: pass\n" }]
  ]) {
    const { normalized } = runWorker(t, sources);
    assert.ok(normalized.nodes.some((node) => node.label === "Upper" && node.file === sources[0].path));
    if (sources.length > 1) assert.ok(normalized.nodes.some((node) => node.label === "Lower"));
  }
});
