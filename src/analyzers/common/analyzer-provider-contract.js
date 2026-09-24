import path from "node:path";
import { normalizeContextSources, contextDigest } from "../../lib/project-context-files.js";
import { validateProjectId } from "../../lib/project-registry.js";

export const ANALYZER_OPERATIONS = Object.freeze(["boundedSourceAnalysis", "definitions", "dependencies", "detection", "diagnostics", "implementations", "references", "symbols"]);
export const PROVIDER_LIMITS = Object.freeze({ providers: 8, nodes: 2000, edges: 4000, locations: 256, diagnostics: 40, responseBytes: 256 * 1024 });
export const providerError = (code = "invalid_analyzer_provider") => Object.assign(new Error("Invalid or unavailable analyzer provider evidence."), { code });
export const providerRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function isAnalyzerSymbolLabel(value) {
  return typeof value === "string" && value.length <= 128 && value.trim().length > 0
    && !/[\u0000-\u001f\u007f]/.test(value)
    && !/^(?:[\\/]|\.\.[\\/]|[A-Za-z]:(?!:)|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/.test(value)
    && !/(?:^|[\\/])\.git(?:[\\/]|$)/.test(value);
}
const identifier = (value, max = 128) => typeof value === "string" && value.length <= max && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value);
export function assertProviderFields(value, keys, code = "invalid_analyzer_provider") {
  if (!providerRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) throw providerError(code);
}

export function normalizeProviderDescriptor(value) {
  assertProviderFields(value, ["id", "version", "kind", "priority", "languages", "capabilities"]);
  if (!identifier(value.id) || !identifier(value.version, 64) || !["native", "external"].includes(value.kind)
    || !Number.isInteger(value.priority) || value.priority < 0 || value.priority > (value.kind === "external" ? 100 : 1000)
    || !Array.isArray(value.languages) || !value.languages.length || value.languages.length > 32
    || value.languages.some((language) => typeof language !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(language))) throw providerError();
  assertProviderFields(value.capabilities, ANALYZER_OPERATIONS);
  const capabilities = {};
  for (const operation of ANALYZER_OPERATIONS) {
    const level = value.capabilities[operation] ?? "unsupported";
    if (!["unsupported", "structural", "semantic"].includes(level)) throw providerError();
    capabilities[operation] = level;
  }
  return Object.freeze({ id: value.id, version: value.version, kind: value.kind, priority: value.priority,
    languages: Object.freeze([...new Set(value.languages)].sort()), capabilities: Object.freeze(capabilities) });
}

const LANGUAGES = Object.freeze({ ".cs": "csharp", ".csproj": "csharp", ".ts": "typescript", ".tsx": "typescript", ".js": "javascript", ".jsx": "javascript", ".py": "python", ".go": "go", ".rs": "rust", ".java": "java", ".sh": "bash", ".bash": "bash", ".ps1": "powershell", ".psm1": "powershell", ".psd1": "powershell" });
export function detectSnapshotLanguages(sourceFiles) {
  return [...new Set(normalizeContextSources(sourceFiles).map((file) => LANGUAGES[path.posix.extname(file.path).toLowerCase()]).filter(Boolean))].sort();
}

export function isValidSnapshotSourcePosition(source, line, column) {
  if (!providerRecord(source) || typeof source.text !== "string"
    || !Number.isSafeInteger(line) || !Number.isSafeInteger(column)) return false;
  const lines = source.text.split(/\r?\n/);
  return line >= 1 && line <= lines.length && column >= 1 && column <= lines[line - 1].length + 1;
}

export function createProviderSnapshot(project, sourceFiles, revision = {}) {
  const projectId = project.projectId ?? null;
  if (projectId !== null) validateProjectId(projectId);
  if (!providerRecord(revision)) throw providerError("invalid_analyzer_snapshot");
  const safeRevision = {};
  const hasRepositoryIdentity = Object.hasOwn(revision, "repositoryIdentity") && revision.repositoryIdentity !== undefined;
  const hasRepositoryId = Object.hasOwn(revision, "repositoryId") && revision.repositoryId !== undefined;
  if (hasRepositoryIdentity && hasRepositoryId && revision.repositoryIdentity !== revision.repositoryId) throw providerError("invalid_analyzer_snapshot");
  const repositoryId = hasRepositoryIdentity ? revision.repositoryIdentity : hasRepositoryId ? revision.repositoryId : null;
  if (repositoryId !== null) {
    try { validateProjectId(repositoryId); }
    catch { throw providerError("invalid_analyzer_snapshot"); }
  }
  for (const key of ["status", "commitSha", "branch", "repositoryId", "worktreeId"]) {
    const value = key === "repositoryId" ? repositoryId : revision[key] ?? null;
    if (value !== null && (typeof value !== "string" || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))) throw providerError("invalid_analyzer_snapshot");
    if (value !== null && ((["repositoryId", "worktreeId"].includes(key) && !/^[A-Za-z0-9_-]{1,128}$/.test(value))
      || (key === "branch" && /^(?:[A-Za-z]:|[\\/])/.test(value))
      || (key === "commitSha" && !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value))
      || (key === "status" && !["available", "unborn", "not_git", "unavailable"].includes(value)))) throw providerError("invalid_analyzer_snapshot");
    safeRevision[key] = value;
  }
  for (const key of ["dirty", "isGit", "isLinkedWorktree"]) {
    const value = revision[key] ?? null;
    if (value !== null && typeof value !== "boolean") throw providerError("invalid_analyzer_snapshot");
    safeRevision[key] = value;
  }
  const files = normalizeContextSources(sourceFiles);
  const token = contextDigest(JSON.stringify([projectId, safeRevision, files.map((file) => [file.path, file.sha256])]));
  return Object.freeze({ schemaVersion: 1, projectId, token, revision: Object.freeze(safeRevision),
    languages: Object.freeze(detectSnapshotLanguages(files)), files: Object.freeze(files.map(Object.freeze)) });
}
