import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveAnalyzer } from "../src/analyzers/common/analyzer-registry.js";
import { analyzeProject, getImpact, getSymbolContext, getProjectInsights } from "../src/lib/analyzer-service.js";
import { getAnalysisCacheStats, invalidateAnalysisCache } from "../src/lib/analysis-cache.js";
import * as analyzerService from "../src/lib/analyzer-service.js";

test("context analyzers reuse extraction from supplied sources without filesystem or cache access", (t) => {
  assert.equal(typeof analyzerService.analyzeContextSources, "function");
  const before = getAnalysisCacheStats().size;
  t.mock.method(fs, "readFileSync", () => { throw new Error("Unexpected filesystem read"); });
  const project = { name: "isolated", absolutePath: "/not-a-project-on-disk" };
  const ts = analyzerService.analyzeContextSources(project, [
    { path: "tsconfig.json", text: '{"extends":"../../outside.json"}' },
    { path: "safe.ts", text: "import { Outside } from '../../outside'; export class Safe {}" }
  ]);
  assert.ok(ts.nodes.some((node) => node.label === "Safe"));
  assert.equal(ts.nodes.some((node) => node.label === "Outside"), false);
  const dotnet = analyzerService.analyzeContextSources(project, [
    { path: "Core.csproj", text: "<Project />" },
    { path: "Safe.cs", text: "namespace Core; public class Safe {}" }
  ]);
  assert.ok(dotnet.nodes.some((node) => node.label === "Safe"));
  assert.equal(getAnalysisCacheStats().size, before);
});

test("context analyzer graph limits are explicit and preserve local references", () => {
  const files = [
    { path: "one.ts", text: "export class One {}" },
    { path: "two.ts", text: "import { One } from './one'; export function Two() { return One; }" }
  ];
  const result = analyzerService.analyzeContextSources({ name: "fixture" }, files);
  assert.equal(result.nodes.length, 2);
  assert.ok(result.edges.length > 0);
  assert.deepEqual(analyzerService.analyzeContextSources({ name: "fixture" }, [...files].reverse()), result);
  const limited = analyzerService.analyzeContextSources({ name: "fixture" }, files, { nodeLimit: 1, edgeLimit: 1 });
  assert.equal(limited.nodes.length, 1);
  assert.equal(limited.limited, true);
});

test("snapshot TypeScript node cutoff is canonical before truncation", () => {
  const project = { name: "snapshot-order" };
  const first = analyzerService.analyzeContextSources(project, [
    { path: "one.ts", text: "export class Zebra {}\nexport class Alpha {}\n" }
  ], { nodeLimit: 1 });
  const second = analyzerService.analyzeContextSources(project, [
    { path: "one.ts", text: "export class Alpha {}\nexport class Zebra {}\n" }
  ], { nodeLimit: 1 });
  assert.deepEqual(first.nodes.map((node) => node.label), ["Alpha"]);
  assert.deepEqual(second.nodes.map((node) => node.label), ["Alpha"]);
  assert.deepEqual(first.nodes, second.nodes);
  assert.equal(first.limited, true);
});

test("snapshot cutoff uses ordinal tie-breaks independent of localeCompare", (t) => {
  const project = { name: "dotnet-order" };
  const files = [
    { path: "App.csproj", text: "<Project />" },
    { path: "Services.cs", text: "namespace Demo; public class ZebraService {} public class AlphaService {}" }
  ];
  const ordinary = analyzerService.analyzeContextSources(project, files, { nodeLimit: 1 });
  const original = String.prototype.localeCompare;
  t.after(() => { String.prototype.localeCompare = original; });
  String.prototype.localeCompare = function reverseLocaleCompare(other) { return -original.call(this, other); };
  const reversedLocale = analyzerService.analyzeContextSources(project, files, { nodeLimit: 1 });
  assert.deepEqual(ordinary.nodes, reversedLocale.nodes);
  assert.deepEqual(ordinary.nodes.map((node) => node.label), ["AlphaService"]);
});

test("snapshot exact limit is complete while actual omission is partial", () => {
  const project = { name: "limit-state" };
  const files = [{ path: "one.ts", text: "export class Alpha {}\nexport class Zebra {}\n" }];
  const exact = analyzerService.analyzeContextSources(project, files, { nodeLimit: 2 });
  assert.equal(exact.status, "available");
  assert.equal(exact.limited, false);
  const omitted = analyzerService.analyzeContextSources(project, files, { nodeLimit: 1 });
  assert.equal(omitted.status, "partial");
  assert.equal(omitted.limited, true);
});

test("snapshot TypeScript hard-cap node selection is invariant under reversed declaration order", () => {
  const ascending = Array.from({ length: 2001 }, (_, index) => `export class Node${String(index).padStart(4, "0")} {}`).join("\n");
  const descending = ascending.split("\n").reverse().join("\n");
  const project = { name: "ts-hard-node-order" };

  const first = analyzerService.analyzeContextSources(project, [{ path: "nodes.ts", text: ascending }]);
  const second = analyzerService.analyzeContextSources(project, [{ path: "nodes.ts", text: descending }]);

  assert.equal(first.nodes.length, 2000);
  assert.equal(second.nodes.length, 2000);
  assert.equal(first.limited, true);
  assert.deepEqual(first.nodes, second.nodes);
  assert.deepEqual(first.nodes.map((node) => node.label).slice(0, 3), ["Node0000", "Node0001", "Node0002"]);
  assert.equal(first.nodes.some((node) => node.label === "Node2000"), false);
});

test("snapshot TypeScript hard-cap edge selection is invariant under reversed import extraction order", () => {
  const targets = Array.from({ length: 100 }, (_, index) => `Target${String(index).padStart(3, "0")}`);
  const sources = Array.from({ length: 41 }, (_, index) => `Source${String(index).padStart(3, "0")}`);
  const targetText = targets.map((name) => `export class ${name} {}`).join("\n");
  const sourceText = [
    `import { ${targets.join(", ")} } from './targets';`,
    ...sources.map((source) => `export class ${source} { value = [${targets.join(", ")}]; }`)
  ].join("\n");
  const reversedSourceText = [
    `import { ${[...targets].reverse().join(", ")} } from './targets';`,
    ...[...sources].reverse().map((source) => `export class ${source} { value = [${[...targets].reverse().join(", ")}]; }`)
  ].join("\n");
  const project = { name: "ts-hard-edge-order" };

  const first = analyzerService.analyzeContextSources(project, [
    { path: "sources.ts", text: sourceText },
    { path: "targets.ts", text: targetText }
  ]);
  const second = analyzerService.analyzeContextSources(project, [
    { path: "sources.ts", text: reversedSourceText },
    { path: "targets.ts", text: targetText }
  ]);

  assert.equal(first.edges.length, 4000);
  assert.equal(second.edges.length, 4000);
  assert.equal(first.limited, true);
  assert.deepEqual(first.edges, second.edges);
});

test("snapshot .NET hard-cap equal-score edge selection is invariant under reversed declaration order", () => {
  const targets = Array.from({ length: 65 }, (_, index) => `Target${String(index).padStart(3, "0")}`);
  const sources = Array.from({ length: 65 }, (_, index) => `Source${String(index).padStart(3, "0")}`);
  const declarations = [
    ...targets.map((name) => `public class ${name} { }`),
    ...sources.map((name) => `public class ${name} { public void Use() { ${targets.map((target) => `typeof(${target})`).join("; ")}; } }`)
  ];
  const project = { name: "dotnet-hard-edge-order" };

  const first = analyzerService.analyzeContextSources(project, [
    { path: "App.csproj", text: "<Project />" },
    { path: "Graph.cs", text: `namespace Demo;\n${declarations.join("\n")}` }
  ]);
  const second = analyzerService.analyzeContextSources(project, [
    { path: "App.csproj", text: "<Project />" },
    { path: "Graph.cs", text: `namespace Demo;\n${[...declarations].reverse().join("\n")}` }
  ]);

  assert.equal(first.edges.length, 4000);
  assert.equal(second.edges.length, 4000);
  assert.equal(first.limited, true);
  assert.deepEqual(first.edges, second.edges);
});

test("snapshot .NET hard-cap node selection keeps category priority with ordinal tie-breaks", (t) => {
  const services = Array.from({ length: 2000 }, (_, index) => `public class Service${String(index).padStart(4, "0")} { }`);
  const content = `namespace Demo;\n${["public class MainController { }", ...services].join("\n")}`;
  const project = { name: "dotnet-hard-node-order" };
  const ordinary = analyzerService.analyzeContextSources(project, [
    { path: "App.csproj", text: "<Project />" },
    { path: "Graph.cs", text: content }
  ]);
  const original = String.prototype.localeCompare;
  t.after(() => { String.prototype.localeCompare = original; });
  String.prototype.localeCompare = function reverseLocaleCompare(other) { return -original.call(this, other); };
  const reversedLocale = analyzerService.analyzeContextSources(project, [
    { path: "App.csproj", text: "<Project />" },
    { path: "Graph.cs", text: content }
  ]);

  assert.equal(ordinary.nodes.length, 2000);
  assert.equal(ordinary.limited, true);
  assert.deepEqual(ordinary.nodes, reversedLocale.nodes);
  assert.equal(ordinary.nodes[0].label, "MainController");
});

test("snapshot .NET lower node limit preserves category priority over lexical order", () => {
  const result = analyzerService.analyzeContextSources({ name: "dotnet-node-priority" }, [
    { path: "App.csproj", text: "<Project />" },
    { path: "Graph.cs", text: "namespace Demo; public class AlphaUtility { } public class ZebraController { }" }
  ], { nodeLimit: 1 });

  assert.deepEqual(result.nodes.map((node) => node.label), ["ZebraController"]);
  assert.equal(result.limited, true);
});

test("snapshot .NET lower edge limit preserves edge score over lexical order", () => {
  const result = analyzerService.analyzeContextSources({ name: "dotnet-edge-priority" }, [
    { path: "App.csproj", text: "<Project />" },
    { path: "Graph.cs", text: `namespace Demo;
public class AlphaConsumer { public void Use() { typeof(Target); } }
public class ZebraController { public void Use() { typeof(Target); } }
public class Target { }` }
  ], { edgeLimit: 1 });
  const byId = new Map(result.nodes.map((node) => [node.id, node]));

  assert.equal(result.edges.length, 1);
  assert.equal(byId.get(result.edges[0].from).label, "ZebraController");
  assert.equal(result.limited, true);
});

test("snapshot duplicate TypeScript edges do not create false output truncation", () => {
  const files = [
    { path: "dep.ts", text: "export class Dep {}\n" },
    { path: "barrel.ts", text: "import { Dep } from './dep';\nexport { Dep } from './dep';\nexport class Barrel { value = Dep; }\n" }
  ];
  const unrestricted = analyzerService.analyzeContextSources({ name: "duplicate-edge" }, files);
  const limited = analyzerService.analyzeContextSources({ name: "duplicate-edge" }, files, { edgeLimit: 1 });

  assert.equal(unrestricted.edges.length, 1);
  assert.equal(unrestricted.limited, false);
  assert.deepEqual(limited.edges, unrestricted.edges);
  assert.equal(limited.limited, false);
  assert.equal(limited.status, "available");
});

test("snapshot exact edge limit is complete and one omitted unique edge is partial", () => {
  const files = [
    { path: "dep.ts", text: "export class DepA {}\nexport class DepB {}\n" },
    { path: "consumer.ts", text: "import { DepA, DepB } from './dep';\nexport class Consumer { value = [DepA, DepB]; }\n" }
  ];
  const exact = analyzerService.analyzeContextSources({ name: "exact-edges" }, files, { edgeLimit: 2 });
  const omitted = analyzerService.analyzeContextSources({ name: "exact-edges" }, files, { edgeLimit: 1 });

  assert.equal(exact.edges.length, 2);
  assert.equal(exact.limited, false);
  assert.equal(exact.status, "available");
  assert.equal(omitted.edges.length, 1);
  assert.equal(omitted.limited, true);
  assert.equal(omitted.status, "partial");
});

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
