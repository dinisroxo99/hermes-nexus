import test from "node:test";
import assert from "node:assert/strict";
import { taskContextFixture } from "./helpers/task-context-fixture.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { getProjectByIdForIntelligence } from "../src/lib/projects.js";
import { readProjectRevision } from "../src/lib/project-revision.js";
import { collectContextSources } from "../src/lib/project-context-files.js";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest } from "../src/analyzers/external/snapshot-provider.js";

test("Context Pack reports native provider provenance without changing its section contract", (t) => {
  const f = taskContextFixture(t); const pack = buildProjectTaskContext(f.request, f.options);
  assert.equal(pack.schemaVersion, 1);
  assert.equal(pack.analysis.provider.id, "native.typescript");
  assert.equal(pack.analysis.provider.capabilities.definitions, "unsupported");
  assert.equal(pack.sections.symbols.provenance.provider.id, "native.typescript");
  assert.equal(pack.sections.symbols.items[0].provenance.provider.id, "native.typescript");
});

test("Context Pack can consume snapshot-bound external evidence without language-specific selection", (t) => {
  const f = taskContextFixture(t); f.write("one.py", "class PythonOne: pass\n");
  const project = getProjectByIdForIntelligence(f.request.projectId, f.options.registry);
  const snapshot = createProviderSnapshot(project, collectContextSources(project).files, readProjectRevision(project));
  const provider = { id: "external.fixture", version: "1", kind: "external", priority: 50, languages: ["python"], capabilities: { symbols: "semantic", boundedSourceAnalysis: "structural" } };
  const request = createExternalSnapshotRequest(snapshot, provider);
  const externalResponses = { "external.fixture": JSON.stringify({ schemaVersion: 1, projectId: request.projectId, snapshotToken: request.snapshotToken, requestToken: request.requestToken, providerId: provider.id, providerVersion: provider.version, status: "available", nodes: [{ id: "one", label: "PythonOne", file: "one.py", kind: "class", line: 1 }], edges: [], definitions: [], implementations: [], diagnostics: [] }) };
  const input = { ...f.request, task: { title: "Change PythonOne", paths: ["one.py"] } };
  const options = { ...f.options, analyzer: { externalProviders: [provider], externalResponses, requiredLanguages: ["python"] } };
  const pack = buildProjectTaskContext(input, options);
  assert.equal(pack.analysis.provider.id, provider.id);
  assert.equal(pack.analysis.provenance.trust, "untrusted_external_analysis");
  assert.equal(pack.sections.symbols.provenance.trust, "untrusted_external_analysis");
  assert.equal(pack.sections.symbols.items[0].provenance.trust, "untrusted_external_analysis");
  assert.equal(pack.sections.symbols.items[0].name, "PythonOne");
  assert.equal(pack.sections.symbols.items[0].line, 1);
  assert.equal(pack.sections.references.status, "not_analyzed");
  assert.equal(JSON.stringify(pack).includes(f.root), false);
  assert.deepEqual(buildProjectTaskContext(input, options), pack);
  const dependencyProvider = { ...provider, capabilities: { ...provider.capabilities, dependencies: "structural" } };
  const dependencyRequest = createExternalSnapshotRequest(snapshot, dependencyProvider);
  const dependencyResponse = JSON.stringify({ ...JSON.parse(externalResponses[provider.id]), requestToken: dependencyRequest.requestToken, edges: [{ from: "one", to: "one", relation: "imports" }] });
  const dependencyPack = buildProjectTaskContext(input, { ...f.options, analyzer: { requiredLanguages: ["python"], externalProviders: [dependencyProvider], externalResponses: { [provider.id]: dependencyResponse } } });
  assert.equal(dependencyPack.sections.references.status, "partial");
  assert.equal(dependencyPack.sections.references.items[0].provenance.trust, "untrusted_external_analysis");
  const fullLanguageProvider = { ...provider, languages: ["python", "typescript"] };
  const fullLanguageRequest = createExternalSnapshotRequest(snapshot, fullLanguageProvider);
  const fullLanguageResponse = JSON.stringify({ ...JSON.parse(externalResponses[provider.id]), requestToken: fullLanguageRequest.requestToken });
  const missingOperationPack = buildProjectTaskContext(input, { ...f.options, analyzer: { requiredLanguages: ["python"], externalProviders: [fullLanguageProvider], externalResponses: { [provider.id]: fullLanguageResponse } } });
  assert.equal(missingOperationPack.analysis.status, "available");
  assert.equal(missingOperationPack.sections.references.status, "not_analyzed");
  assert.equal(missingOperationPack.observation.incomplete, true);
  f.write("one.py", "class Changed: pass\n");
  const changed = buildProjectTaskContext(input, options);
  assert.equal(changed.analysis.status, "unavailable");
  assert.equal(changed.sections.symbols.items.length, 0);
  assert.equal(changed.observation.incomplete, true);
});

test("unsupported provider requirements are explicit rather than a proven empty semantic result", (t) => {
  const f = taskContextFixture(t);
  const pack = buildProjectTaskContext(f.request, { ...f.options, analyzer: { requiredCapabilities: ["implementations"] } });
  assert.equal(pack.analysis.status, "unsupported");
  assert.equal(pack.sections.symbols.status, "not_analyzed");
  assert.equal(pack.observation.incomplete, true);
});

test("byte trimming preserves partial dependency-only references", (t) => {
  const f = taskContextFixture(t);
  const file = "many.py";
  f.write(file, Array.from({ length: 64 }, (_, i) => `class Node${i}: pass`).join("\n"));
  const project = getProjectByIdForIntelligence(f.request.projectId, f.options.registry);
  const snapshot = createProviderSnapshot(project, collectContextSources(project).files, readProjectRevision(project));
  const provider = { id: "external.budget", version: "1", kind: "external", priority: 10, languages: ["python"], capabilities: { boundedSourceAnalysis: "structural", symbols: "structural", dependencies: "structural" } };
  const request = createExternalSnapshotRequest(snapshot, provider);
  const response = JSON.stringify({ schemaVersion: 1, projectId: request.projectId, providerId: provider.id, providerVersion: provider.version, snapshotToken: request.snapshotToken, requestToken: request.requestToken, status: "available",
    nodes: Array.from({ length: 64 }, (_, i) => ({ id: `n${i}`, label: `Node${i}`, file, kind: "class", line: i + 1 })),
    edges: Array.from({ length: 64 }, (_, i) => ({ from: "n0", to: `n${i}`, relation: "imports" })), definitions: [], implementations: [], diagnostics: [] });
  const pack = buildProjectTaskContext({ ...f.request, task: { title: "Inspect", paths: [file] }, limits: { maxBytes: 16384, symbols: 1, files: 1, references: 64, documents: 0, constraints: 0, workspaces: 0 } },
    { ...f.options, analyzer: { requiredLanguages: ["python"], externalProviders: [provider], externalResponses: { [provider.id]: response } } });
  assert.ok(pack.sections.references.items.length > 0);
  assert.equal(pack.sections.references.truncated, true);
  assert.equal(pack.sections.references.status, "partial");
  assert.ok(Buffer.byteLength(JSON.stringify(pack)) <= 16384);
});
