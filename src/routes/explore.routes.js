/**
 * Explore routes — search, expand, full graph and agent-oriented graph intelligence.
 */

import { getProjectByName } from "../lib/projects.js";
import {
  searchSymbols,
  expandNode,
  getFullGraph,
  getImpact,
  getSymbolContext,
  getProjectInsights
} from "../lib/analyzer-service.js";
import { sendOk, sendError } from "../utils/response.js";
import {
  validateProjectName,
  validateNodeId,
  validateSearchQuery,
  parseLimit
} from "../utils/validation.js";

function resolveProject(res, projectName) {
  const v = validateProjectName(projectName);
  if (!v.valid) {
    sendError(res, 400, "invalid_project", v.error);
    return { project: null };
  }

  try {
    return { project: getProjectByName(projectName) };
  } catch (err) {
    const msg = err.message || `Projeto "${projectName}" não disponível.`;
    sendError(res, msg.includes("não encontrado") ? 404 : 502, msg.includes("não encontrado") ? "not_found" : "project_unavailable", msg);
    return { project: null };
  }
}

export async function handleSearch(req, res, params, query) {
  const { project } = resolveProject(res, params.project);
  if (!project) return;

  const q = query.get("q") || "";
  const vq = validateSearchQuery(q);
  if (!vq.valid) {
    sendError(res, 400, "invalid_query", vq.error);
    return;
  }

  const result = searchSymbols(project, q);
  sendOk(res, 200, result, result.message || "Busca concluída");
}

export async function handleExpand(req, res, params, query) {
  const { project } = resolveProject(res, params.project);
  if (!project) return;

  const nodeId = query.get("nodeId") || "";
  const vn = validateNodeId(nodeId);
  if (!vn.valid) {
    sendError(res, 400, "invalid_node", vn.error);
    return;
  }

  const direction = query.get("direction") || "both";
  if (!["both", "in", "out"].includes(direction)) {
    sendError(res, 400, "invalid_direction", "Direction deve ser 'both', 'in' ou 'out'.");
    return;
  }

  const result = expandNode(project, nodeId, direction);
  sendOk(res, 200, result, result.message || "Expansão concluída");
}

export async function handleFullGraph(req, res, params, query) {
  const { project } = resolveProject(res, params.project);
  if (!project) return;

  const options = parseGraphOptions(query, { nodeLimit: 500, edgeLimit: 1200 });
  const result = getFullGraph(project, options);
  sendOk(res, 200, result, result.message || "Grafo completo carregado");
}

export async function handleImpact(req, res, params, query) {
  const { project } = resolveProject(res, params.project);
  if (!project) return;

  const nodeId = query.get("nodeId") || "";
  const vn = validateNodeId(nodeId);
  if (!vn.valid) {
    sendError(res, 400, "invalid_node", vn.error);
    return;
  }

  const result = getImpact(project, nodeId, {
    depth: parseLimit(query.get("depth"), 2, 0, 5),
    limit: parseLimit(query.get("limit"), 80, 1, 250)
  });
  sendOk(res, result.success ? 200 : 404, result, result.message || "Impacto calculado");
}

export async function handleContext(req, res, params, query) {
  const { project } = resolveProject(res, params.project);
  if (!project) return;

  const symbol = query.get("symbol") || "";
  const nodeId = query.get("nodeId") || "";

  if (!symbol && !nodeId) {
    sendError(res, 400, "invalid_query", "Indique symbol ou nodeId.");
    return;
  }

  if (nodeId) {
    const vn = validateNodeId(nodeId);
    if (!vn.valid) {
      sendError(res, 400, "invalid_node", vn.error);
      return;
    }
  }

  if (symbol && symbol.length > 500) {
    sendError(res, 400, "invalid_query", "Símbolo demasiado longo.");
    return;
  }

  const result = getSymbolContext(project, {
    symbol,
    nodeId,
    depth: parseLimit(query.get("depth"), 1, 0, 3),
    limit: parseLimit(query.get("limit"), 40, 1, 120)
  });
  sendOk(res, result.success ? 200 : 404, result, result.message || "Contexto carregado");
}

export async function handleInsights(req, res, params, query) {
  const { project } = resolveProject(res, params.project);
  if (!project) return;

  const result = getProjectInsights(project, {
    limit: parseLimit(query.get("limit"), 20, 1, 100)
  });
  sendOk(res, 200, result, result.message || "Insights carregados");
}

function parseGraphOptions(query, defaults) {
  return {
    nodeLimit: parseLimit(query.get("nodeLimit"), defaults.nodeLimit, 1, 5000),
    edgeLimit: parseLimit(query.get("edgeLimit"), defaults.edgeLimit, 1, 10000),
    layers: parseCsv(query.get("layers")),
    features: parseCsv(query.get("features"))
  };
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
