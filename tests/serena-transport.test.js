import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest } from "../src/analyzers/external/snapshot-provider.js";
import { SERENA_PROVIDER } from "../src/analyzers/external/serena-provider.js";

const image = `sha256:${"a".repeat(64)}`;
const snapshot = () => createProviderSnapshot({ projectId: "Prj_Serena" }, [{ path: "src/one.py", text: "class One: pass\n" }, { path: "other.ts", text: "export class Other {}" }], { status: "not_git" });
const repositorySnapshot = () => createProviderSnapshot({ projectId: "Prj_Serena" }, [{ path: "src/one.py", text: "class One: pass\n" }], { status: "available", repositoryIdentity: "Repo_One", commitSha: "a".repeat(40) });
async function api() {
  const m = await import("../src/analyzers/external/serena-transport.js").catch(() => ({}));
  assert.equal(typeof m.runSerenaSnapshot, "function");
  return m;
}
function envelope(request) {
  return JSON.stringify({ ...Object.fromEntries(["schemaVersion", "projectId", "snapshotToken", "requestToken", "providerId", "providerVersion", "observedSourceToken"].map((key) => [key, request[key]])),
    status: "available", nodes: [{ id: "one", label: "One", file: "src/one.py", kind: "class", line: 1 }], edges: [], definitions: [], implementations: [], diagnostics: [] });
}

test("Serena transport materializes only snapshot Python sources with fixed isolation and cleanup", async (t) => {
  const { runSerenaSnapshot } = await api();
  const calls = []; let source;
  t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("run")) {
      assert.equal(command, "/usr/bin/docker");
      for (const flag of ["--network=none", "--read-only", "--user=65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--cpus=2", "--memory=1g", "--memory-swap=1g", "--pids-limit=64", "--pull=never", "--log-driver=none"]) assert.ok(args.includes(flag), flag);
      const mount = args[args.indexOf("--mount") + 1];
      source = mount.match(/source=([^,]+)/)[1];
      assert.ok(mount.endsWith(",target=/snapshot,readonly"));
      assert.equal(fs.readFileSync(`${source}/src/one.py`, "utf8"), "class One: pass\n");
      assert.equal(fs.existsSync(`${source}/other.ts`), false);
      assert.equal(fs.existsSync(`${source}/.git`), false);
      assert.equal(options.shell, false);
      assert.equal(options.timeout <= 30000, true);
      assert.equal(options.maxBuffer, 256 * 1024);
      assert.equal(options.env.HOME, undefined);
      assert.equal(options.env.DOCKER_HOST, undefined);
      return { status: 0, stdout: envelope(JSON.parse(options.input)), stderr: "" };
    }
    assert.ok(args.includes("rm"));
    return { status: 0, stdout: "", stderr: "" };
  });
  const result = runSerenaSnapshot(snapshot(), { image });
  assert.equal(result.status, "available");
  assert.equal(JSON.parse(result.response).nodes[0].label, "One");
  assert.equal(fs.existsSync(source), false);
  assert.equal(calls.length, 2);
});

test("missing Docker executable degrades as unavailable without a cleanup attempt", async (t) => {
  const { runSerenaSnapshot } = await api();
  let calls = 0;
  t.mock.method(childProcess, "spawnSync", () => { calls += 1; return { error: { code: "ENOENT" }, status: null }; });
  assert.deepEqual(runSerenaSnapshot(snapshot(), { image }), { status: "unavailable" });
  assert.equal(calls, 1);
});

test("transport failures are bounded, sanitized and dispose snapshot/container state", async (t) => {
  const { runSerenaSnapshot } = await api();
  for (const [run, status] of [
    [{ error: { code: "ETIMEDOUT" } }, "timeout"], [{ error: { code: "ENOBUFS" } }, "oversized"],
    [{ status: 137, stderr: "/secret/host/path" }, "crashed"], [{ status: 125 }, "unavailable"],
    [{ status: 0, stdout: "x".repeat(262145) }, "oversized"], [{ status: 0, stdout: "not JSON" }, "invalid"]
  ]) {
    await t.test(status, () => {
      let source; let cleaned = false;
      const mock = t.mock.method(childProcess, "spawnSync", (_, args) => {
        if (args.includes("run")) { source = args[args.indexOf("--mount") + 1].match(/source=([^,]+)/)[1]; return run; }
        cleaned = true; return { status: 0 };
      });
      assert.deepEqual(runSerenaSnapshot(snapshot(), { image }), { status });
      assert.ok(cleaned); assert.equal(fs.existsSync(source), false);
      mock.mock.restore();
    });
  }
});

test("immutable image and safe snapshot inputs are mandatory before process launch", async (t) => {
  const { runSerenaSnapshot } = await api();
  t.mock.method(childProcess, "spawnSync", () => { assert.fail("must not launch"); });
  for (const value of ["latest", "project-map-serena-python:1", "--privileged", null]) assert.equal(runSerenaSnapshot(snapshot(), { image: value }).status, "unavailable");
  const original = snapshot();
  for (const path of ["../escape.py", "/outside.py", "C:escape.py", ".git/one.py", ".ssh/key.py", "secrets.py"]) {
    assert.equal(runSerenaSnapshot({ ...original, files: [{ path, text: "pass" }] }, { image }).status, "invalid");
  }
  assert.equal(runSerenaSnapshot({ ...original, token: "stale" }, { image }).status, "invalid");
});

test("transport rejects external bindings, paths, locations, capabilities and ambiguous evidence", async (t) => {
  const { runSerenaSnapshot } = await api();
  const cases = [
    { projectId: "Other" }, { snapshotToken: "stale" }, { requestToken: "stale" }, { providerId: "other" }, { providerVersion: "2" },
    { observedSourceToken: "wrong" }, { observedSourceToken: undefined }, { command: "shell" },
    { nodes: [{ id: "one", label: "One", file: "../escape.py", line: 1 }] },
    { nodes: [{ id: "one", label: "One", file: "src/one.py", line: 50 }] },
    { nodes: [{ id: "one", label: "One", file: "src/one.py" }, { id: "one", label: "Other", file: "src/one.py" }] },
    { edges: [{ from: "one", to: "missing", relation: "references" }] },
    { edges: [{ from: "one", to: "one", relation: "imports" }] },
    { diagnostics: [{ code: "undeclared", severity: "error" }] }
  ];
  for (const change of cases) {
    const mock = t.mock.method(childProcess, "spawnSync", (_, args, options) => args.includes("run")
      ? { status: 0, stdout: JSON.stringify({ ...JSON.parse(envelope(JSON.parse(options.input))), ...change }) } : { status: 0 });
    assert.deepEqual(runSerenaSnapshot(snapshot(), { image }), { status: "invalid" }, JSON.stringify(change));
    mock.mock.restore();
  }
});

test("failed cleanup suppresses otherwise valid evidence", async (t) => {
  const { runSerenaSnapshot } = await api();
  t.mock.method(childProcess, "spawnSync", (_, args, options) => args.includes("run")
    ? { status: 0, stdout: envelope(JSON.parse(options.input)) } : { error: { code: "ETIMEDOUT" } });
  assert.deepEqual(runSerenaSnapshot(snapshot(), { image }), { status: "cleanup_failed" });
});

test("Docker auto-removal races are verified within the cleanup deadline", async (t) => {
  const { runSerenaSnapshot } = await api();
  let removals = 0;
  t.mock.method(childProcess, "spawnSync", (_, args) => {
    if (args.includes("run")) return { error: { code: "ENOBUFS" } };
    removals += 1;
    const name = args.at(-1);
    return { status: 1, stderr: removals === 1
      ? `Error response from daemon: removal of container ${name} is already in progress\n`
      : `Error response from daemon: No such container: ${name}\n` };
  });
  assert.deepEqual(runSerenaSnapshot(snapshot(), { image }), { status: "oversized" });
  assert.equal(removals, 2);
});

test("Serena transport reconstructs repository-bound snapshots and rejects stale unbound evidence", async (t) => {
  const { runSerenaSnapshot } = await api();
  const bound = repositorySnapshot();
  const unbound = createProviderSnapshot({ projectId: "Prj_Serena" }, bound.files, { status: "available", commitSha: "a".repeat(40) });
  const unboundResponse = envelope(createExternalSnapshotRequest(unbound, SERENA_PROVIDER));
  let sawRepositoryId = false;
  let call = 0;
  t.mock.method(childProcess, "spawnSync", (_, args, options) => {
    if (!args.includes("run")) return { status: 0, stdout: "", stderr: "" };
    call += 1;
    const request = JSON.parse(options.input);
    sawRepositoryId = request.revision.repositoryId === "Repo_One" && Object.hasOwn(request.revision, "repositoryIdentity") === false;
    return call === 1 ? { status: 0, stdout: envelope(request), stderr: "" } : { status: 0, stdout: unboundResponse, stderr: "" };
  });
  assert.equal(runSerenaSnapshot(bound, { image }).status, "available");
  assert.equal(sawRepositoryId, true);
  assert.deepEqual(runSerenaSnapshot(bound, { image }), { status: "invalid" });
});
