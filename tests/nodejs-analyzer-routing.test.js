import fs from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

import { detectProjectType, isSupportedProjectType } from "../src/analyzers/common/analyzer-detection.js";
import { getAnalyzer, resolveAnalyzer, listAnalyzerCapabilities } from "../src/analyzers/common/analyzer-registry.js";
import { typeScriptAnalyzer } from "../src/analyzers/typescript/typescript-analyzer.js";
import { analyzeProject, getFullGraph, searchSymbols, expandNode, getSymbolContext, analyzeContextSources, getAnalyzerProviderCapabilities } from "../src/lib/analyzer-service.js";
import { invalidateAnalysisCache } from "../src/lib/analysis-cache.js";
import { buildProjectOverview } from "../src/lib/project-overview.js";
import { dotNetAnalyzer } from "../src/analyzers/dotnet/dotnet-analyzer.js";
import { SERENA_PROVIDER } from "../src/analyzers/external/serena-provider.js";
import { gitFixture } from "./helpers/git-fixture.js";

const javascriptSources = [
  { path: "src/service.js", text: "export class InvoiceService {}\n" },
  { path: "src/app.jsx", text: "import { InvoiceService } from './service.js';\nexport function App() { return <div>{new InvoiceService()}</div>; }\n" }
];

function nodeFixture(t) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", '{"name":"fixture","type":"module"}\n');
  for (const file of javascriptSources) f.write(file.path, file.text);
  f.commit();
  t.after(() => invalidateAnalysisCache(f.project.name));
  return f;
}

test("Node.js detection resolves the existing TypeScript/JavaScript analyzer without duplicate registration", (t) => {
  const f = nodeFixture(t);
  assert.equal(detectProjectType(f.repo), "nodejs");
  assert.deepEqual(resolveAnalyzer(f.project), { projectType: "nodejs", analyzer: typeScriptAnalyzer });
  assert.equal(getAnalyzer("nodejs"), getAnalyzer("typescript"));
  assert.deepEqual(listAnalyzerCapabilities().map((analyzer) => analyzer.projectType), ["dotnet", "typescript"]);
  assert.equal(fs.existsSync(`${f.repo}/tsconfig.json`), false);
});

test("Node.js full graph, search, expand and context reuse JavaScript/JSX symbols", (t) => {
  const { project } = nodeFixture(t);
  const graph = getFullGraph(project);
  assert.equal(graph.success, true);
  const service = graph.nodes.find((node) => node.label === "InvoiceService" && node.file === "src/service.js");
  const app = graph.nodes.find((node) => node.label === "App" && node.file === "src/app.jsx");
  assert.ok(service);
  assert.ok(app);
  assert.ok(graph.edges.some((edge) => edge.from === app.id && edge.to === service.id));
  const search = searchSymbols(project, "InvoiceService");
  assert.equal(search.success, true);
  assert.deepEqual(search.nodes.map((node) => node.id), [service.id]);
  const expanded = expandNode(project, service.id, "in");
  assert.equal(expanded.success, true);
  assert.ok(expanded.nodes.some((node) => node.id === app.id));
  const context = getSymbolContext(project, { symbol: "InvoiceService" });
  assert.equal(context.success, true);
  assert.equal(context.symbol.id, service.id);
  assert.ok(context.graph.nodes.some((node) => node.id === app.id));
  assert.deepEqual(analyzeProject(project).nodes, graph.nodes);
});

test("JavaScript provider resolution and capabilities stay native, deterministic and structural", (t) => {
  const { project } = nodeFixture(t);
  const providers = getAnalyzerProviderCapabilities();
  assert.deepEqual(providers.map((provider) => provider.id), ["native.dotnet", "native.typescript"]);
  const result = analyzeContextSources(project, javascriptSources);
  assert.equal(result.status, "available");
  assert.deepEqual(result.provider, providers[1]);
  assert.deepEqual(result.provider.languages, ["javascript", "typescript"]);
  assert.equal(result.provider.capabilities.symbols, "structural");
  assert.equal(result.provider.capabilities.definitions, "unsupported");
  assert.deepEqual(result.coverage, { observed: ["javascript"], covered: ["javascript"], uncovered: [] });
  assert.ok(result.nodes.some((node) => node.label === "InvoiceService"));
  assert.deepEqual(analyzeContextSources(project, [...javascriptSources].reverse()), result);
});

test("Node.js support reporting agrees with the analyzer registry", () => {
  for (const type of ["nodejs", "typescript", "dotnet", "python", "unknown"]) {
    assert.equal(isSupportedProjectType(type), getAnalyzer(type) !== null, type);
  }
});

test("Node.js overview advertises the existing native analyzer without forcing analysis", (t) => {
  const { project, repo } = nodeFixture(t);
  const overview = buildProjectOverview(project);
  assert.equal(overview.project.projectType, "nodejs");
  assert.equal(overview.project.supported, true);
  assert.deepEqual(overview.analyzers, listAnalyzerCapabilities().filter((analyzer) => analyzer.projectType === "typescript"));
  assert.equal(overview.analyzers[0].capabilities.fullGraph, true);
  assert.equal(overview.analysis.status, "not_analyzed");
  assert.equal(overview.statistics.nodeCount, null);
  assert.equal(overview.warnings.some((warning) => warning.code === "unsupported_project_type"), false);
  assert.equal(JSON.stringify(overview).includes(repo), false);
});

test("Node.js overview reads the resolved analyzer cache without changing revision isolation", (t) => {
  const f = nodeFixture(t);
  const graph = analyzeProject(f.project);
  const overview = buildProjectOverview(f.project);
  assert.equal(overview.analysis.status, "fresh");
  assert.equal(overview.statistics.nodeCount, graph.nodes.length);
  assert.equal(overview.statistics.edgeCount, graph.edges.length);
  assert.equal(overview.project.projectType, "nodejs");
  assert.equal(overview.project.projectId, f.project.projectId);
  assert.equal(overview.revision.commitSha, f.git(["rev-parse", "HEAD"]));
  assert.equal(buildProjectOverview({ ...f.project, projectId: "PrJ_Other" }).analysis.status, "not_analyzed");
  f.write("src/dirty.js", "export class Dirty {}\n");
  const dirty = buildProjectOverview(f.project);
  assert.equal(dirty.revision.dirty, true);
  assert.equal(dirty.analysis.status, "not_analyzed");
  assert.equal(dirty.statistics.nodeCount, null);
});

for (const [type, marker, source, analyzer, providerId] of [
  ["typescript", "tsconfig.json", { path: "one.ts", text: "export class One {}" }, typeScriptAnalyzer, "native.typescript"],
  ["dotnet", "Fixture.csproj", { path: "One.cs", text: "public class One {}" }, dotNetAnalyzer, "native.dotnet"]
]) {
  test(`${type} detection, analyzer, overview and provider behavior remain unchanged`, (t) => {
    const f = gitFixture(t, { committed: false });
    f.write("package.json", "{}\n");
    f.write(marker, type === "dotnet" ? "<Project />" : "{}");
    f.write(source.path, source.text);
    f.commit();
    t.after(() => invalidateAnalysisCache(f.project.name));
    assert.equal(detectProjectType(f.repo), type);
    assert.deepEqual(resolveAnalyzer(f.project), { projectType: type, analyzer });
    assert.equal(isSupportedProjectType(type), true);
    const overview = buildProjectOverview(f.project);
    assert.equal(overview.project.supported, true);
    assert.deepEqual(overview.analyzers, [{ projectType: type, name: analyzer.name, capabilities: analyzer.capabilities }]);
    const graph = getFullGraph(f.project);
    if (type === "typescript") assert.equal(graph.success, true);
    else assert.deepEqual(graph, dotNetAnalyzer.fullGraph(f.project));
    assert.ok(graph.nodes.some((node) => node.label === "One"));
    assert.equal(analyzeContextSources(f.project, [source]).provider.id, providerId);
  });
}

test("Python legacy routing stays unsupported and Serena remains opt-in with unchanged capabilities", (t) => {
  const f = gitFixture(t, { committed: false });
  f.write("pyproject.toml", "[project]\nname = 'fixture'\n");
  const source = { path: "one.py", text: "class One: pass\n" };
  f.write(source.path, source.text);
  f.commit();
  assert.equal(detectProjectType(f.repo), "python");
  assert.deepEqual(resolveAnalyzer(f.project), { projectType: "python", analyzer: null });
  assert.equal(isSupportedProjectType("python"), false);
  const overview = buildProjectOverview(f.project);
  assert.equal(overview.project.supported, false);
  assert.deepEqual(overview.analyzers, []);
  assert.equal(getFullGraph(f.project).success, false);
  const result = analyzeContextSources(f.project, [source]);
  assert.equal(result.status, "unsupported");
  assert.equal(result.provider, null);
  assert.equal(getAnalyzerProviderCapabilities().some((provider) => provider.id === SERENA_PROVIDER.id), false);
  const configured = getAnalyzerProviderCapabilities([], { serena: { image: `sha256:${"a".repeat(64)}` } });
  assert.deepEqual(configured.map((provider) => provider.id), ["native.dotnet", "native.typescript", SERENA_PROVIDER.id]);
  assert.deepEqual(configured[2], SERENA_PROVIDER);
});

test("Node.js overview, full graph, search, context and expand work over real HTTP routes", (t) => {
  const f = nodeFixture(t);
  const registry = JSON.stringify([{ name: "fixture", relativePath: "main", projectId: f.project.projectId }]);
  fs.writeFileSync(`${f.root}/projects.json`, registry);
  // A child isolates import-time registry configuration from the user's runtime.
  const moduleUrl = (file) => JSON.stringify(new URL(file, import.meta.url).href);
  execFileSync(process.execPath, ["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { createRouter } from ${moduleUrl("../src/utils/router.js")};
    import { registerIntelligenceRoutes } from ${moduleUrl("../src/routes/intelligence.routes.js")};
    import { handleFullGraph, handleSearch, handleContext, handleExpand } from ${moduleUrl("../src/routes/explore.routes.js")};
    const router = createRouter();
    registerIntelligenceRoutes(router);
    for (const [route, handler] of [['full', handleFullGraph], ['search', handleSearch], ['context', handleContext], ['expand', handleExpand]]) {
      router.add('GET', '/api/explore/:project/' + route, handler);
    }
    const server = http.createServer((req, res) => router.dispatch(req, res).catch(() => { res.writeHead(500); res.end(); }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const get = async (path) => {
        const response = await fetch('http://127.0.0.1:' + server.address().port + path);
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.ok, true);
        return payload.data;
      };
      const overview = await get('/api/intelligence/projects/fixture/overview');
      assert.equal(overview.project.projectType, 'nodejs');
      assert.equal(overview.project.supported, true);
      assert.equal(overview.analyzers[0].projectType, 'typescript');
      assert.equal(overview.analysis.status, 'not_analyzed');
      const graph = await get('/api/explore/fixture/full');
      assert.equal(graph.success, true);
      const service = graph.nodes.find((node) => node.label === 'InvoiceService');
      const app = graph.nodes.find((node) => node.label === 'App');
      assert.ok(service);
      assert.ok(app);
      const search = await get('/api/explore/fixture/search?q=InvoiceService');
      assert.equal(search.success, true);
      assert.ok(search.nodes.some((node) => node.id === service.id));
      const context = await get('/api/explore/fixture/context?symbol=InvoiceService');
      assert.equal(context.success, true);
      assert.equal(context.symbol.id, service.id);
      const expanded = await get('/api/explore/fixture/expand?nodeId=' + service.id + '&direction=in');
      assert.equal(expanded.success, true);
      assert.ok(expanded.nodes.some((node) => node.id === app.id));
      assert.equal((await get('/api/intelligence/projects/fixture/overview')).analysis.status, 'fresh');
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  `], {
    cwd: f.root,
    env: { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify([{ id: "default", path: f.root }]), SERENA_PYTHON_IMAGE: "" },
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  assert.equal(fs.readFileSync(`${f.root}/projects.json`, "utf8"), registry);
  assert.equal(fs.existsSync(`${f.root}/discovered-projects.json`), false);
});
