import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { detectProjectType } from "../src/analyzers/common/analyzer-detection.js";
import { getAnalyzer, resolveAnalyzer } from "../src/analyzers/common/analyzer-registry.js";
import { analyzeContextSources, analyzeProject, getImpact } from "../src/lib/analyzer-service.js";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest, readExternalSnapshotResponse } from "../src/analyzers/external/snapshot-provider.js";
import { SERENA_PROVIDER } from "../src/analyzers/external/serena-provider.js";

function tempProject(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "impact-v2-foundation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return { name: path.basename(root), absolutePath: root };
}

function emptyEdgesAreNotSafety(result) {
  assert.deepEqual(result.edges, []);
  return { outcome: "no_evidence_found", safe: false };
}

test("legacy impact response shape and reverse-direction semantics stay compatible", (t) => {
  const project = tempProject(t, {
    "package.json": '{"type":"module"}\n',
    "src/service.js": "export class Service {}\n",
    "src/app.js": "import { Service } from './service.js';\nexport function App() { return Service; }\n"
  });
  const graph = analyzeProject(project);
  const service = graph.nodes.find((node) => node.label === "Service");
  const app = graph.nodes.find((node) => node.label === "App");
  assert.ok(service);
  assert.ok(app);
  assert.ok(graph.edges.some((edge) => edge.from === app.id && edge.to === service.id));

  const impact = getImpact(project, service.id, { depth: 2, limit: 10 });
  assert.equal(impact.success, true);
  assert.equal(impact.node.id, service.id);
  assert.deepEqual(impact.dependencies.map((node) => node.id), []);
  assert.ok(impact.dependents.some((node) => node.id === app.id));
  assert.ok(impact.affectedFiles.includes("src/service.js"));
  assert.ok(impact.affectedFiles.includes("src/app.js"));
  assert.equal(typeof impact.impact.score, "number");
});

test("package-only JavaScript remains classified as nodejs while using native.typescript", (t) => {
  const project = tempProject(t, {
    "package.json": '{"name":"package-only","type":"module"}\n',
    "index.js": "export function main() { return 1; }\n"
  });
  assert.equal(fs.existsSync(path.join(project.absolutePath, "tsconfig.json")), false);
  assert.equal(detectProjectType(project.absolutePath), "nodejs");
  assert.equal(resolveAnalyzer(project).projectType, "nodejs");
  assert.equal(resolveAnalyzer(project).analyzer, getAnalyzer("typescript"));
  const result = analyzeContextSources(project, [{ path: "index.js", text: "export function main() { return 1; }\n" }]);
  assert.equal(result.provider.id, "native.typescript");
  assert.deepEqual(result.coverage, { observed: ["javascript"], covered: ["javascript"], uncovered: [] });
});

test("CommonJS require currently leaves normalized dependency evidence incomplete", () => {
  const result = analyzeContextSources({ name: "commonjs" }, [
    { path: "dep.js", text: "module.exports = { value: 1 };\n" },
    { path: "user.js", text: "const dep = require('./dep');\nexports.run = () => dep.value;\n" }
  ]);
  assert.equal(result.provider.id, "native.typescript");
  assert.equal(result.status, "available");
  assert.deepEqual(result.edges, []);
  assert.deepEqual(emptyEdgesAreNotSafety(result), { outcome: "no_evidence_found", safe: false });
});

test("symbol-free node:test modules currently provide no normalized symbols or safety proof", () => {
  const result = analyzeContextSources({ name: "node-test" }, [
    { path: "sample.test.js", text: "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('sample', () => assert.equal(1, 1));\n" }
  ]);
  assert.equal(result.provider.id, "native.typescript");
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(emptyEdgesAreNotSafety(result), { outcome: "no_evidence_found", safe: false });
});

test("mjs and cjs sources are currently rejected before snapshot language support", () => {
  assert.throws(() => analyzeContextSources({ name: "module-extensions" }, [
    { path: "esm.mjs", text: "export class ESM {}\n" },
    { path: "common.cjs", text: "exports.CJS = class CJS {};\n" }
  ]), { code: "invalid_context_sources" });
});

test("Python remains unsupported when Serena is disabled", () => {
  const result = analyzeContextSources({ projectId: "Prj_Python" }, [{ path: "one.py", text: "class One: pass\n" }]);
  assert.equal(result.status, "unsupported");
  assert.equal(result.provider, null);
  assert.deepEqual(result.coverage, { observed: ["python"], covered: [], uncovered: ["python"] });
  assert.deepEqual(result.nodes, []);
  assert.deepEqual(result.edges, []);
});

test("Serena fixture references are semantic references, not dependency or caller proof", () => {
  const project = { projectId: "Prj_Python" };
  const sources = [
    { path: "models.py", text: "def greet():\n    return 'hello'\n" },
    { path: "usage.py", text: "from models import greet\ndef caller():\n    return greet()\n" }
  ];
  const snapshot = createProviderSnapshot(project, sources, { status: "not_git" });
  const request = createExternalSnapshotRequest(snapshot, SERENA_PROVIDER);
  const raw = JSON.stringify({
    schemaVersion: 1,
    projectId: request.projectId,
    snapshotToken: request.snapshotToken,
    requestToken: request.requestToken,
    providerId: SERENA_PROVIDER.id,
    providerVersion: SERENA_PROVIDER.version,
    status: "available",
    nodes: [
      { id: "greet", label: "greet", file: "models.py", kind: "function", line: 1 },
      { id: "caller", label: "caller", file: "usage.py", kind: "function", line: 2 }
    ],
    edges: [{ from: "caller", to: "greet", relation: "references", location: { path: "usage.py", line: 3, column: 12 } }],
    definitions: [{ symbolId: "greet", target: { path: "models.py", line: 1, column: 5 } }],
    implementations: [],
    diagnostics: []
  });
  const normalized = readExternalSnapshotResponse(snapshot, SERENA_PROVIDER, raw);
  assert.equal(SERENA_PROVIDER.capabilities.references, "semantic");
  assert.equal(SERENA_PROVIDER.capabilities.dependencies, "unsupported");
  assert.equal(SERENA_PROVIDER.capabilities.implementations, "unsupported");
  assert.equal(SERENA_PROVIDER.capabilities.diagnostics, "unsupported");
  assert.deepEqual(normalized.edges.map((edge) => edge.relation), ["references"]);
  assert.notEqual(normalized.edges[0].from, "caller");
  assert.notEqual(normalized.edges[0].to, "greet");
  assert.equal(normalized.definitions[0].target.path, "models.py");
});

test("mixed-language snapshots select one provider and leave uncovered languages explicit", () => {
  const result = analyzeContextSources({ name: "mixed", projectId: "Prj_Mixed" }, [
    { path: "one.ts", text: "export class One {}\n" },
    { path: "two.py", text: "class Two: pass\n" }
  ]);
  assert.equal(result.provider.id, "native.typescript");
  assert.equal(result.status, "partial");
  assert.deepEqual(result.coverage, { observed: ["python", "typescript"], covered: ["typescript"], uncovered: ["python"] });
  assert.ok(result.nodes.some((node) => node.label === "One"));
  assert.equal(result.nodes.some((node) => node.label === "Two"), false);
});
