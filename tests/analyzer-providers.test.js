import test from "node:test";
import assert from "node:assert/strict";
import * as registry from "../src/analyzers/common/analyzer-registry.js";
async function api() { const m = await import("../src/analyzers/common/analyzer-providers.js").catch(() => ({})); assert.equal(typeof m.analyzeProviderSnapshot, "function"); return m; }
const project = { name: "fixture", projectId: "PrJ_Test" };

test("native provider discovery is stable and precise capabilities are not overstated", async () => {
  await api();
  const providers = registry.listAnalyzerProviders();
  assert.deepEqual(providers.map((p) => p.id), ["native.dotnet", "native.typescript"]);
  for (const p of providers) {
    assert.equal(p.capabilities.symbols, "structural");
    assert.equal(p.capabilities.definitions, "unsupported");
    assert.equal(p.capabilities.implementations, "unsupported");
    assert.equal(p.capabilities.diagnostics, "unsupported");
  }
});

test("native C#, TypeScript and JavaScript graphs survive normalized provider adaptation", async () => {
  const { analyzeProviderSnapshot } = await api();
  for (const [file, text, id] of [["a.cs", "public class One {}", "native.dotnet"], ["a.ts", "export class One {}", "native.typescript"], ["a.js", "export function One() {}", "native.typescript"]]) {
    const result = analyzeProviderSnapshot(project, [{ path: file, text }]);
    assert.equal(result.status, "available");
    assert.equal(result.provider.id, id);
    assert.ok(result.nodes.some((node) => node.label === "One"));
    assert.equal(result.definitions.length, 0);
  }
});

test("observed unsupported languages are explicit and never silently become a native empty graph", async () => {
  const { analyzeProviderSnapshot } = await api();
  for (const extension of ["py", "go", "rs", "java", "sh", "ps1"]) {
    const result = analyzeProviderSnapshot(project, [{ path: `a.${extension}`, text: "source" }]);
    assert.equal(result.status, "unsupported");
    assert.equal(result.success, false);
    assert.equal(result.provider, null);
    assert.equal(result.coverage.uncovered.length, 1);
  }
});

test("mixed snapshots select a single native provider with explicit partial coverage", async () => {
  const { analyzeProviderSnapshot } = await api();
  const files = [{ path: "a.cs", text: "public class Sharp {}" }, { path: "b.ts", text: "export class Script {}" }];
  const first = analyzeProviderSnapshot(project, files);
  assert.equal(first.provider.id, "native.dotnet");
  assert.equal(first.status, "partial");
  assert.deepEqual(first.coverage.uncovered, ["typescript"]);
  assert.equal(first.nodes.some((n) => n.label === "Script"), false);
  assert.deepEqual(first, analyzeProviderSnapshot(project, [...files].reverse()));
  const precise = analyzeProviderSnapshot(project, files, { requiredCapabilities: ["definitions"] });
  assert.equal(precise.status, "unsupported");
});
