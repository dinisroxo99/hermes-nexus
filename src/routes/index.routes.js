/**
 * Index routes — POST /api/index/:project
 *
 * Triggers scip-dotnet indexing for a project.
 */

import { getProjectByName } from "../lib/projects.js";
import { runScipIndex } from "../lib/indexer.js";
import { invalidateAnalysisCache } from "../lib/analysis-cache.js";
import { sendOk, sendError } from "../utils/response.js";
import { validateProjectName } from "../utils/validation.js";

/**
 * POST /api/index/:project
 */
export async function handleIndexProject(req, res, params) {
  const v = validateProjectName(params.project);
  if (!v.valid) {
    sendError(res, 400, "invalid_project", v.error);
    return;
  }

  let project;
  try {
    project = getProjectByName(params.project);
  } catch (err) {
    const msg = err.message || `Projeto "${params.project}" não disponível.`;

    if (msg.includes("não encontrado")) {
      sendError(res, 404, "not_found", msg);
    } else {
      sendError(res, 502, "project_unavailable", msg);
    }

    return;
  }

  const result = await runScipIndex(project);
  invalidateAnalysisCache(project.name);

  if (result.ok) {
    sendOk(res, 200, result, `Indexação de "${params.project}" concluída.`);
  } else {
    sendError(res, 500, "index_failed", "Indexação falhou. Verifique o stderr.");
  }
}
