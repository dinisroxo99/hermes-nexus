import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveAnalyzer } from "../src/analyzers/common/analyzer-registry.js";
import { analyzeProject, getImpact, getSymbolContext, getProjectInsights } from "../src/lib/analyzer-service.js";
import { getAnalysisCacheStats, invalidateAnalysisCache } from "../src/lib/analysis-cache.js";

function makeTsProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-project-map-service-"));
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  fs.writeFileSync(path.join(root, "tsconfig.json"), '{"compilerOptions":{"jsx":"react-jsx"}}\n');
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "service.ts"), "export class InvoiceService {}\n");
  fs.writeFileSync(path.join(root, "src", "app.ts"), "import { InvoiceService } from './service';\nexport function App() { return InvoiceService; }\n");
  return {
    name: path.basename(root),
    absolutePath: root
  };
}

test("analyzer registry resolves TypeScript analyzer capabilities", () => {
  const project = makeTsProject();
  const resolved = resolveAnalyzer(project);

  assert.equal(resolved.projectType, "typescript");
  assert.equal(resolved.analyzer.capabilities.search, true);
  assert.equal(resolved.analyzer.capabilities.expand, true);
});

test("analysis cache reuses TypeScript analysis and invalidates per project", () => {
  const project = makeTsProject();
  invalidateAnalysisCache(project.name);

  const before = getAnalysisCacheStats();
  analyzeProject(project);
  analyzeProject(project);
  const after = getAnalysisCacheStats();

  assert.equal(after.size, before.size + 1);
  assert.ok(after.hits > before.hits);

  const invalidated = invalidateAnalysisCache(project.name);
  assert.equal(invalidated.removed, 1);
});

test("impact, context and insights produce bounded agent-friendly results", () => {
  const project = makeTsProject();
  const graph = analyzeProject(project);
  const service = graph.nodes.find((node) => node.label === "InvoiceService");

  const impact = getImpact(project, service.id, { depth: 2, limit: 10 });
  assert.equal(impact.success, true);
  assert.ok(impact.dependents.some((node) => node.label === "App"));
  assert.equal(impact.impact.level, "low");

  const context = getSymbolContext(project, { symbol: "InvoiceService", depth: 1, limit: 10 });
  assert.equal(context.success, true);
  assert.equal(context.symbol.label, "InvoiceService");
  assert.ok(context.graph.nodes.length <= 10);

  const insights = getProjectInsights(project, { limit: 5 });
  assert.equal(insights.success, true);
  assert.ok(insights.stats.nodeCount >= 2);
  assert.ok(insights.highlyConnected.length <= 5);
});
