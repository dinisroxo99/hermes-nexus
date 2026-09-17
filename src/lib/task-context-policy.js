import { validateProjectId } from "./project-registry.js";
import { matchWorkspaceScopes } from "./workspace-scope.js";
import { isContextPathAllowed } from "./project-context-files.js";

export const TASK_CONTEXT_ANALYSIS_VERSION = "task-context-v1";
export const TASK_CONTEXT_LIMITS = Object.freeze({
  files: [16, 32], symbols: [24, 64], references: [32, 64], tests: [8, 16],
  workspaces: [8, 16], documents: [8, 16], constraints: [16, 32], diagnostics: [20, 40],
  maxBytes: [64 * 1024, 128 * 1024]
});
export const contextError = (code, message = "Task context request could not be processed.") => Object.assign(new Error(message), { code });
const record = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function normalizeTaskContextRequest(input) {
  const invalid = () => contextError("invalid_task_context_request", "Invalid bounded task context request.");
  const fields = (object, allowed) => {
    if (!record(object) || Object.keys(object).some((key) => !allowed.includes(key))) throw invalid();
  };
  fields(input, ["projectId", "task", "worktree", "limits", "includeExcerpts"]);
  validateProjectId(input.projectId);
  fields(input.task, ["id", "title", "description", "paths", "symbols"]);
  const text = (value, max, required = false) => {
    if (value === undefined && !required) return "";
    if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) throw invalid();
    return value.trim();
  };
  let paths;
  try { paths = matchWorkspaceScopes([], input.task.paths ?? [], { maxTaskPaths: 32 }).paths; } catch { throw invalid(); }
  if (paths.some((p) => !isContextPathAllowed(p))) throw invalid();
  const rawSymbols = input.task.symbols ?? [];
  if (!Array.isArray(rawSymbols) || rawSymbols.length > 8) throw invalid();
  const symbols = [...new Set(rawSymbols.map((s) => text(s, 128, true)))].sort();
  const limits = {};
  if (input.limits !== undefined) fields(input.limits, Object.keys(TASK_CONTEXT_LIMITS));
  for (const [key, [fallback, max]] of Object.entries(TASK_CONTEXT_LIMITS)) {
    const value = input.limits?.[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) throw invalid();
    limits[key] = value === undefined ? fallback : Math.max(key === "maxBytes" ? 16384 : 0, Math.min(max, Math.floor(value)));
  }
  if (input.includeExcerpts !== undefined && typeof input.includeExcerpts !== "boolean") throw invalid();
  let worktree;
  if (input.worktree !== undefined) {
    fields(input.worktree, ["rootId", "relativePath"]);
    let location;
    try { location = matchWorkspaceScopes([], [input.worktree.relativePath]).paths[0]; } catch { throw invalid(); }
    if (!isContextPathAllowed(location)) throw invalid();
    worktree = { rootId: input.worktree.rootId === undefined ? "default" : text(input.worktree.rootId, 128, true), relativePath: location };
  }
  return { projectId: input.projectId, task: { id: text(input.task.id, 128) || null, title: text(input.task.title, 200, true), description: text(input.task.description, 2000), paths, symbols }, ...(worktree ? { worktree } : {}), limits, includeExcerpts: input.includeExcerpts === true };
}

export function boundedContextText(value, maxBytes = 512) {
  const text = String(value ?? "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, "[REDACTED]")
    .replace(/^.*\b(?:api[_-]?key|secret|password|access[_-]?token|authorization)["']?\s*[:=].*$/gim, "[REDACTED]");
  const buffer = Buffer.from(text);
  if (buffer.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return buffer.subarray(0, end).toString("utf8");
}
