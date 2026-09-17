import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { createProviderSnapshot, normalizeProviderDescriptor } from "../src/analyzers/common/analyzer-provider-contract.js";
import { analyzeProviderSnapshot } from "../src/analyzers/common/analyzer-providers.js";
import { listAnalyzerProviders } from "../src/analyzers/common/analyzer-registry.js";
let externalApi;
async function api() { const m = await import("../src/analyzers/external/snapshot-provider.js").catch(() => ({})); assert.equal(typeof m.createExternalSnapshotRequest, "function"); externalApi = m; return m; }
const project = { projectId: "PrJ_External", name: "fixture", absolutePath: "/private/project" };
const sources = [{ path: "one.py", text: "class One: pass\n" }];
const descriptor = { id: "external.a", version: "1", kind: "external", priority: 50, languages: ["python"], capabilities: { symbols: "semantic", boundedSourceAnalysis: "structural", definitions: "semantic", references: "semantic", dependencies: "structural", implementations: "semantic", diagnostics: "semantic" } };
function response(snapshot, overrides = {}) {
  const request = externalApi.createExternalSnapshotRequest(snapshot, { ...descriptor, id: overrides.providerId || descriptor.id });
  return JSON.stringify({ schemaVersion: 1, projectId: snapshot.projectId, providerId: "external.a", providerVersion: "1", snapshotToken: snapshot.token, requestToken: request.requestToken, status: "available", nodes: [{ id: "one", label: "One", file: "one.py", kind: "class", line: 1 }], edges: [], definitions: [{ symbolId: "one", target: { path: "one.py", line: 1, column: 1 } }], implementations: [], diagnostics: [], ...overrides });
}

test("external adapter accepts only bounded snapshot-bound data, without filesystem reads", async (t) => {
  const { createExternalSnapshotRequest, readExternalSnapshotResponse } = await api();
  const snapshot = createProviderSnapshot(project, sources);
  const provider = normalizeProviderDescriptor(descriptor);
  t.mock.method(fs, "readFileSync", () => { throw new Error("filesystem forbidden"); });
  const request = createExternalSnapshotRequest(snapshot, provider);
  assert.equal(request.projectId, project.projectId);
  assert.equal(JSON.stringify(request).includes("/private"), false);
  const result = readExternalSnapshotResponse(snapshot, provider, response(snapshot));
  assert.equal(result.nodes[0].label, "One");
  assert.equal(result.definitions[0].symbolId, result.nodes[0].id);
  for (const overrides of [{ projectId: "PrJ_Other" }, { snapshotToken: "wrong" }, { providerVersion: "2" }, { command: "execute" }]) {
    assert.throws(() => readExternalSnapshotResponse(snapshot, provider, response(snapshot, overrides)), { code: "invalid_external_evidence" });
  }
});

test("external evidence cannot reference outside, absent, ambiguous or invalid source locations", async () => {
  const { readExternalSnapshotResponse } = await api(); const snapshot = createProviderSnapshot(project, sources); const provider = normalizeProviderDescriptor(descriptor);
  for (const file of ["../other.py", "/private/other.py", "file:///private/other.py", "C:other.py", "missing.py", ".env"]) {
    assert.throws(() => readExternalSnapshotResponse(snapshot, provider, response(snapshot, { nodes: [{ id: "one", label: "One", file, line: 1 }] })), { code: "invalid_external_evidence" });
  }
  for (const changes of [
    { nodes: [{ id: "one", label: "One", file: "one.py" }, { id: "one", label: "Two", file: "one.py" }] },
    { edges: [{ from: "one", to: "missing", relation: "references" }] },
    { definitions: [{ symbolId: "one", target: { path: "one.py", line: 999, column: 1 } }] },
    { implementations: [{ symbolId: "one", target: { path: "../other.py", line: 1, column: 1 } }] }
  ]) assert.throws(() => readExternalSnapshotResponse(snapshot, provider, response(snapshot, changes)), { code: "invalid_external_evidence" });
  assert.throws(() => readExternalSnapshotResponse(snapshot, provider, " ".repeat(262145)), { code: "invalid_external_evidence" });
});

test("fallback order is deterministic, rejects invalid evidence and never merges providers", async () => {
  await api(); const snapshot = createProviderSnapshot(project, sources);
  const second = { ...descriptor, id: "external.b" };
  const options = { externalProviders: [second, descriptor], externalResponses: { "external.a": "bad JSON", "external.b": response(snapshot, { providerId: "external.b" }) } };
  const result = analyzeProviderSnapshot(project, sources, options);
  assert.equal(result.provider.id, "external.b");
  assert.deepEqual(result.attempts.map((a) => a.status), ["invalid", "available"]);
  assert.equal(result.nodes.length, 1);
  assert.deepEqual(result, analyzeProviderSnapshot(project, sources, { ...options, externalProviders: [descriptor, second] }));
  assert.deepEqual(listAnalyzerProviders([second, descriptor]), listAnalyzerProviders([descriptor, second]));
  assert.equal(analyzeProviderSnapshot(project, sources, { externalProviders: [descriptor] }).status, "unavailable");
  const native = analyzeProviderSnapshot(project, [{ path: "one.ts", text: "export class Native {}" }], { externalProviders: [{ ...descriptor, languages: ["typescript"] }] });
  assert.equal(native.provider.id, "native.typescript");
});

test("external operations cannot exceed declared capabilities", async () => {
  const { readExternalSnapshotResponse } = await api(); const snapshot = createProviderSnapshot(project, sources);
  const rawProvider = { ...descriptor, capabilities: { symbols: "structural", boundedSourceAnalysis: "structural" } };
  const requestToken = externalApi.createExternalSnapshotRequest(snapshot, rawProvider).requestToken;
  for (const provider of [rawProvider, normalizeProviderDescriptor(rawProvider)]) {
    assert.throws(() => readExternalSnapshotResponse(snapshot, provider, response(snapshot, { requestToken })), { code: "invalid_external_evidence" });
    assert.throws(() => readExternalSnapshotResponse(snapshot, provider, response(snapshot, { requestToken, definitions: [], diagnostics: [{ code: "fixture", severity: "warning" }] })), { code: "invalid_external_evidence" });
  }
  assert.throws(() => listAnalyzerProviders([{ ...descriptor, analyze() { throw new Error("must never run"); } }]), { code: "invalid_analyzer_provider" });
});

test("external definitions, implementations and diagnostics retain bounded local positions", async () => {
  const { readExternalSnapshotResponse } = await api(); const snapshot = createProviderSnapshot(project, sources); const provider = normalizeProviderDescriptor(descriptor);
  const result = readExternalSnapshotResponse(snapshot, provider, response(snapshot, {
    implementations: [{ symbolId: "one", target: { path: "one.py", line: 1, column: 7 } }],
    diagnostics: [{ code: "fixture_warning", severity: "warning", location: { path: "one.py", line: 1, column: 1 } }]
  }));
  assert.equal(result.implementations[0].symbolId, result.nodes[0].id);
  assert.equal(result.diagnostics[0].location.path, "one.py");
  assert.throws(() => readExternalSnapshotResponse(snapshot, provider, response(snapshot, { nodes: new Array(2001).fill({}) })), { code: "invalid_external_evidence" });
});

test("providers cannot claim evidence for undeclared languages and callers can request language coverage", async () => {
  const { createExternalSnapshotRequest, readExternalSnapshotResponse } = await api();
  const mixed = [...sources, { path: "other.ts", text: "export class Other {}" }];
  const snapshot = createProviderSnapshot(project, mixed); const provider = normalizeProviderDescriptor(descriptor);
  assert.deepEqual(createExternalSnapshotRequest(snapshot, provider).files.map((file) => file.path), ["one.py"]);
  assert.throws(() => readExternalSnapshotResponse(snapshot, provider, response(snapshot, { nodes: [{ id: "one", label: "Other", file: "other.ts" }] })), { code: "invalid_external_evidence" });
  const result = analyzeProviderSnapshot(project, mixed, { requiredLanguages: ["python"], externalProviders: [descriptor], externalResponses: { "external.a": response(snapshot) } });
  assert.equal(result.provider.id, "external.a");
  assert.deepEqual(result.coverage.uncovered, ["typescript"]);
});

test("normalized symbols and Context Pack selection accept non-JavaScript symbol names", async () => {
  const { createExternalSnapshotRequest, readExternalSnapshotResponse } = await api();
  const { selectTaskContext } = await import("../src/lib/task-context-selection.js");
  const { normalizeTaskContextRequest } = await import("../src/lib/task-context-policy.js");
  const files = [{ path: "script.ps1", text: "function Get-Thing {}\n" }];
  const snapshot = createProviderSnapshot(project, files);
  const provider = { ...descriptor, languages: ["powershell"] };
  const requestToken = createExternalSnapshotRequest(snapshot, provider).requestToken;
  const graph = readExternalSnapshotResponse(snapshot, provider, response(snapshot, { requestToken, nodes: [{ id: "one", label: "Get-Thing", file: "script.ps1", kind: "function", line: 1 }], definitions: [] }));
  const request = normalizeTaskContextRequest({ projectId: project.projectId, task: { title: "Inspect script", paths: ["script.ps1"] } });
  assert.equal(selectTaskContext(request, { sourceFiles: files, graph }).symbols.items[0].name, "Get-Thing");
});
