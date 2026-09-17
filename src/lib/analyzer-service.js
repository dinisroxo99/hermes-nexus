/**
 * Analyzer Service — registry-backed analyzer facade.
 *
 * Keeps routes independent from concrete project types and reuses cached
 * analysis graphs for search, expand, full graph and agent endpoints.
 */

import { resolveAnalyzer, listAnalyzerCapabilities, getAnalyzer } from "../analyzers/common/analyzer-registry.js";
import { normalizeContextSources } from "./project-context-files.js";
import { getCachedAnalysis } from "./analysis-cache.js";
import { analyzeImpact, buildContext, buildProjectInsights } from "./graph-intelligence.js";

export function getAnalyzerCapabilities() {
  return listAnalyzerCapabilities();
}

export function analyzeContextSources(project, sourceFiles, options = {}) {
  const sources = normalizeContextSources(sourceFiles);
  const projectType = sources.some((file) => /\.(cs|csproj)$/.test(file.path)) ? "dotnet"
    : sources.some((file) => /\.(ts|tsx|js|jsx)$/.test(file.path)) ? "typescript" : "unknown";
  const analyzer = getAnalyzer(projectType);
  if (!analyzer) return { success: false, projectType, nodes: [], edges: [], limited: false };
  const bound = (value, max) => Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : max;
  const limits = { nodeLimit: bound(options.nodeLimit, 2000), edgeLimit: bound(options.edgeLimit, 4000), sourceFiles: sources };
  const isolated = { name: project.name, absolutePath: "/__project_context__" };
  const graph = analyzer.fullGraph ? analyzer.fullGraph(isolated, limits) : analyzer.analyze(isolated, limits);
  return {
    success: graph.success !== false, projectType,
    nodes: graph.nodes || [], edges: graph.edges || [],
    limited: Boolean(graph.limited || graph.metadata?.totalSymbols > limits.nodeLimit || graph.metadata?.totalEdges > limits.edgeLimit)
  };
}

export function analyzeProject(project, options = {}) {
  const { analyzer, projectType } = resolveAnalyzer(project);

  if (!analyzer) {
    return unsupported(projectType, "analyze");
  }

  return getCachedAnalysis(project, analyzer, options, (cacheOptions) => analyzer.analyze(project, cacheOptions));
}

export function searchSymbols(project, query) {
  const { analyzer, projectType } = resolveAnalyzer(project);

  if (!analyzer?.search) {
    return unsupported(projectType, "search", { results: [] });
  }

  if (analyzer.searchUsesAnalysis) {
    return analyzer.search(analyzeProject(project), query);
  }

  return analyzer.search(project, query);
}

export function expandNode(project, nodeId, direction = "both") {
  const { analyzer, projectType } = resolveAnalyzer(project);

  if (!analyzer?.expand) {
    return unsupported(projectType, "expand", { node: null, dependencies: [] });
  }

  if (analyzer.expandUsesAnalysis) {
    return analyzer.expand(analyzeProject(project), nodeId, direction);
  }

  return analyzer.expand(project, nodeId, direction);
}

export function getFullGraph(project, options = {}) {
  const { analyzer, projectType } = resolveAnalyzer(project);

  if (!analyzer) {
    return unsupported(projectType, "fullGraph");
  }

  if (analyzer.fullGraph) {
    return analyzer.fullGraph(project, options);
  }

  return limitGraph(analyzeProject(project, options), options);
}

export function getAnalysisGraph(project, options = {}) {
  const analysis = analyzeProject(project, {
    ...options,
    cacheNodeLimit: options.cacheNodeLimit || 10000,
    cacheEdgeLimit: options.cacheEdgeLimit || 25000
  });

  if (typeof analysis.fullGraph === "function") {
    return analysis.fullGraph(options);
  }

  return analysis;
}

export function getImpact(project, nodeId, options = {}) {
  return analyzeImpact(getAnalysisGraph(project, options), nodeId, options);
}

export function getSymbolContext(project, options = {}) {
  return buildContext(getAnalysisGraph(project, options), options);
}

export function getProjectInsights(project, options = {}) {
  return buildProjectInsights(getAnalysisGraph(project, options), options);
}

function unsupported(projectType, capability, extra = {}) {
  return {
    success: false,
    projectType,
    message: `${capability} não suportado para tipo: ${projectType}`,
    nodes: [],
    edges: [],
    ...extra
  };
}

function limitGraph(result, options = {}) {
  const nodeLimit = options.nodeLimit || 500;
  const edgeLimit = options.edgeLimit || 1200;
  const layers = new Set((options.layers || []).filter(Boolean));
  const features = new Set((options.features || []).filter(Boolean));
  const filteredNodes = (result.nodes || []).filter((node) => {
    if (layers.size && !layers.has(node.layer)) return false;
    if (features.size && !features.has(node.feature)) return false;
    return true;
  });
  const limitedNodes = filteredNodes.slice(0, nodeLimit);
  const nodeIds = new Set(limitedNodes.map((node) => node.id));
  const limitedEdges = (result.edges || [])
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
    .slice(0, edgeLimit);

  return {
    ...result,
    nodes: limitedNodes,
    edges: limitedEdges,
    limited: limitedNodes.length < (result.nodes || []).length || limitedEdges.length < (result.edges || []).length,
    originalNodeCount: (result.nodes || []).length,
    originalEdgeCount: (result.edges || []).length
  };
}
