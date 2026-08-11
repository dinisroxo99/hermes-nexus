/**
 * Cache routes — inspect and clear symbol and analyzer caches.
 */

import {
  clearSymbolIndexCache,
  getSymbolIndexCacheStats
} from "../lib/symbol-index.js";
import {
  getAnalysisCacheStats,
  invalidateAnalysisCache
} from "../lib/analysis-cache.js";
import { sendOk, sendError } from "../utils/response.js";
import { validateProjectName } from "../utils/validation.js";

export async function handleSymbolCacheStats(req, res) {
  sendOk(res, 200, {
    symbols: getSymbolIndexCacheStats(),
    analysis: getAnalysisCacheStats()
  });
}

export async function handleClearSymbolCache(req, res, _params, query) {
  const project = query.get("project");

  if (project) {
    const v = validateProjectName(project);
    if (!v.valid) {
      sendError(res, 400, "invalid_project", v.error);
      return;
    }
  }

  const symbols = clearSymbolIndexCache(project || null);
  const analysis = invalidateAnalysisCache(project || null);
  sendOk(res, 200, { symbols, analysis }, project ? `Cache limpo para ${project}.` : "Caches limpos.");
}
