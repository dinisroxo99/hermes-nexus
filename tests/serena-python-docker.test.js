import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { contextDigest } from "../src/lib/project-context-files.js";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest, readExternalSnapshotResponse } from "../src/analyzers/external/snapshot-provider.js";
import { runSerenaSnapshot } from "../src/analyzers/external/serena-transport.js";

const enabled = process.env.SERENA_DOCKER_TESTS === "1";
const provider = { id: "external.serena-python", version: "1-f8f53b77-pyright-1.1.403", kind: "external", priority: 50, languages: ["python"],
  capabilities: { boundedSourceAnalysis: "structural", detection: "structural", symbols: "semantic", definitions: "semantic", references: "semantic" } };
const files = [{ path: "models.py", text: "class Greeter:\n    def greet(self):\n        return 'hello'\n" }];

function runWorker(t, sources = files) {
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
  const image = spawnSync("docker", ["image", "inspect", "project-map-serena-python:1", "--format", "{{.Id}}"], { encoding: "utf8" });
  assert.equal(image.status, 0, `Build the optional image first: ${image.stderr}`);
  const result = spawnSync("docker", ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--user=65532:65532",
    "--cap-drop=ALL", "--security-opt=no-new-privileges", "--cpus=2", "--memory=1g", "--memory-swap=1g", "--pids-limit=64", "--log-driver=none",
    "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m", "--shm-size=1m", "--mount", `type=bind,source=${root},target=/snapshot,readonly`, "-i", image.stdout.trim()],
  { encoding: "utf8", input: JSON.stringify({ ...request, observedSourceToken }), timeout: 30000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined);
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
  assert.equal(spawnSync("docker", ["ps", "-aq", "--filter", "name=project-map-serena-"], { encoding: "utf8" }).stdout.trim(), "");
});
