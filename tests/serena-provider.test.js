import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { analyzeContextSources, getAnalyzerProviderCapabilities } from "../src/lib/analyzer-service.js";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest } from "../src/analyzers/external/snapshot-provider.js";
import { SERENA_PROVIDER } from "../src/analyzers/external/serena-provider.js";
const project = { projectId: "Prj_Python", name: "fixture" };
const sources = [{ path: "one.py", text: "class One: pass\n" }];
const serena = { image: `sha256:${"a".repeat(64)}` };

test("optional Serena reports only verified Python semantic capabilities", () => {
  assert.equal(getAnalyzerProviderCapabilities().some((p) => p.id === SERENA_PROVIDER.id), false);
  const provider = getAnalyzerProviderCapabilities([], { serena }).find((p) => p.id === SERENA_PROVIDER.id);
  assert.deepEqual(provider, SERENA_PROVIDER);
  assert.equal(provider.capabilities.diagnostics, "unsupported");
  assert.equal(provider.capabilities.implementations, "unsupported");
  assert.equal(provider.capabilities.dependencies, "unsupported");
});

test("unavailable Serena permits explicit deterministic single-provider fallback", (t) => {
  t.mock.method(childProcess, "spawnSync", () => ({ error: { code: "ENOENT" } }));
  const fallback = { ...SERENA_PROVIDER, id: "external.fallback", priority: 10 };
  const request = createExternalSnapshotRequest(createProviderSnapshot(project, sources), fallback);
  const response = JSON.stringify({ ...Object.fromEntries(["schemaVersion", "projectId", "snapshotToken", "requestToken", "providerId", "providerVersion"].map((key) => [key, request[key]])), status: "available",
    nodes: [{ id: "fallback", label: "Fallback", file: "one.py", kind: "class", line: 1 }], edges: [], definitions: [], implementations: [], diagnostics: [] });
  const result = analyzeContextSources(project, sources, { serena, externalProviders: [fallback], externalResponses: { [fallback.id]: response } });
  assert.equal(result.provider.id, fallback.id);
  assert.deepEqual(result.attempts, [{ providerId: SERENA_PROVIDER.id, status: "unavailable", reason: "unavailable" }, { providerId: fallback.id, status: "available" }]);
  assert.deepEqual(result.nodes.map((n) => n.label), ["Fallback"]);
  const failed = analyzeContextSources(project, sources, { serena });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.provider, null);
});

test("native dotnet, TypeScript and JavaScript do not invoke optional Serena", (t) => {
  t.mock.method(childProcess, "spawnSync", () => { assert.fail("native analysis must not execute Docker"); });
  for (const [path, text, providerId] of [
    ["one.cs", "public class One {}", "native.dotnet"], ["one.ts", "export class One {}", "native.typescript"], ["one.js", "export class One {}", "native.typescript"]
  ]) {
    const files = [{ path, text }, ...sources];
    const plain = analyzeContextSources(project, files);
    const optional = analyzeContextSources(project, files, { serena });
    assert.deepEqual(optional, plain);
    assert.equal(optional.provider.id, providerId);
  }
});
