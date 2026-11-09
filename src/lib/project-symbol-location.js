import { isAnalyzerSymbolLabel } from "../analyzers/common/analyzer-provider-contract.js";
import { buildProjectTaskContext } from "./task-context.js";
import { TASK_CONTEXT_LIMITS } from "./task-context-policy.js";

/** Retrieve exact-name symbol observations from a fresh, project-bound Context Pack. */
export function locateProjectSymbol({ projectId, symbol, worktree }, options = {}) {
  if (!isAnalyzerSymbolLabel(symbol) || symbol !== symbol.trim()) {
    throw Object.assign(new Error("Expected one exact symbol name."), { code: "invalid_symbol" });
  }
  const pack = buildProjectTaskContext({
    projectId, ...(worktree ? { worktree } : {}),
    task: { title: "Locate symbol", symbols: [symbol] },
    limits: { symbols: TASK_CONTEXT_LIMITS.symbols[1], maxBytes: TASK_CONTEXT_LIMITS.maxBytes[1] }
  }, options);
  const symbols = pack.sections.symbols;
  const evidence = symbols.items.filter((item) => item.name === symbol);
  return {
    schemaVersion: 1,
    operation: "locate_project_symbol",
    projectId: pack.projectId,
    project: pack.project,
    symbol,
    outcome: evidence.length ? "located" : "unknown",
    revision: pack.revision,
    contextPackId: pack.contextPackId,
    snapshotToken: pack.analysis.snapshotToken,
    observation: pack.observation,
    coverage: {
      providerStatus: pack.analysis.status,
      languages: pack.analysis.coverage,
      symbolStatus: symbols.status,
      symbolLimit: symbols.limit,
      symbolsTruncated: symbols.truncated,
      symbolProvenance: symbols.provenance,
      diagnosticCodes: [...new Set(pack.sections.diagnostics.items.map((item) => item.code))],
      diagnosticsTruncated: pack.sections.diagnostics.truncated
    },
    evidence
  };
}
