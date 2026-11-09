import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readProjectRevision } from "./project-revision.js";
import { getProjectByIdForIntelligence, resolveProjectWorktree } from "./projects.js";

const SHA = /^[a-f0-9]{40}$/;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const LIMIT = 12;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const error = (code) => Object.assign(new Error(code), { code });

const METADATA_ONLY = Object.freeze({ metadataOnly: true });

function githubOrigin(directory) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" });
  const read = spawnSync("git", ["-C", directory, "config", "--no-includes", "--null", "--get-all", "remote.origin.url"],
    { env, encoding: "utf8", timeout: 2000, maxBuffer: 4096, stdio: ["ignore", "pipe", "pipe"] });
  if (read.status !== 0) return null;
  const urls = read.stdout.split("\0");
  if (urls.length !== 2 || urls[1] !== "") return null;
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([a-z0-9][a-z0-9-]{0,99})\/([a-z0-9_.-]{1,104})\/?$/i.exec(urls[0]);
  if (!match) return null;
  const repository = match[2].replace(/\.git$/i, "");
  return repository && repository !== "." && repository !== ".." ? (match[1] + "/" + repository).toLowerCase() : null;
}

function projectView(projectId, worktree, options) {
  const parent = getProjectByIdForIntelligence(projectId, options.registry);
  const forward = worktree && (parent.rootId !== worktree.rootId || parent.relativePath !== worktree.relativePath);
  const project = forward ? resolveProjectWorktree(projectId, worktree, options.registry, METADATA_ONLY) : parent;
  const { capturedAt, ...revision } = readProjectRevision(project, METADATA_ONLY);
  return { project: { name: project.name, rootId: project.rootId, relativePath: project.relativePath }, revision,
    repository: githubOrigin(project.absolutePath) };
}

// Read only active conclusions promoted by the offline history store. No event payload is retrieved from Hermes.
export function queryValidatedHistory({ projectId, worktree, taskId, historyRevision }, options = {}) {
  if (historyRevision !== undefined && (typeof historyRevision !== "string" || !SHA.test(historyRevision))) {
    throw error("invalid_history_revision");
  }
  if (taskId !== undefined && (typeof taskId !== "string" || !TASK_ID.test(taskId))) throw error("invalid_history_task");
  const view = projectView(projectId, worktree, options);
  const revision = historyRevision ?? view.revision.commitSha;
  const base = { schemaVersion: 1, question: "validated-history", projectId, ...view, historyRevision: revision,
    historicalEvidence: [], truncated: false, status: "unavailable", relation: "unknown", warnings: [] };
  if (!options.historyStore) return { ...base, warnings: ["history_store_not_configured"] };
  if (!revision || !SHA.test(revision)) return { ...base, warnings: ["history_revision_unavailable"] };
  if (!view.repository) return { ...base, warnings: ["history_repository_unverified"] };
  const result = spawnSync("python3", ["-B", "-m", "scripts.nexus_run_history", "query", "--store", options.historyStore,
    "--project-id", projectId, "--revision", revision, "--limit", String(LIMIT), ...(taskId ? ["--task-id", taskId] : [])], {
    cwd: ROOT, encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONNOUSERSITE: "1", PYTHONPATH: "" }
  });
  if (result.status !== 0) return { ...base, warnings: ["history_store_unavailable"] };
  let data;
  try { data = JSON.parse(result.stdout); } catch { return { ...base, warnings: ["invalid_history_evidence"] }; }
  if (data?.schemaVersion !== 1 || data.projectId !== projectId || data.revision !== revision || !Array.isArray(data.evidence)
      || data.evidence.length > LIMIT || typeof data.truncated !== "boolean") {
    return { ...base, warnings: ["invalid_history_evidence"] };
  }
  if (data.repository !== view.repository) {
    const reason = data.repository == null ? "history_repository_unverified" : "history_repository_mismatch";
    return { ...base, warnings: [reason] };
  }
  const receiptIds = new Set();
  const historicalEvidence = [];
  const validId = (value) => Number.isSafeInteger(value) && value > 0;
  for (const row of data.evidence) {
    if (row?.projectId !== projectId || row.revision !== revision || row.status !== "active"
        || row.source !== "hermes.kanban.pr_acceptance" || typeof row.taskId !== "string" || !TASK_ID.test(row.taskId)
        || (taskId && row.taskId !== taskId) || !validId(row.runId) || row.outcome !== "completed" || row.runStatus !== "done"
        || !validId(row.acceptanceEventId) || !validId(row.completedEventId) || row.completedEventId <= row.acceptanceEventId
        || !validId(row.pullRequest) || !validId(row.requiredCheckCount) || typeof row.repository !== "string"
        || row.repository.toLowerCase() !== view.repository) {
      return { ...base, warnings: ["invalid_history_evidence"] };
    }
    const seed = JSON.stringify([projectId, row.taskId, row.runId, row.acceptanceEventId, revision]);
    const expectedId = "kanban_" + createHash("sha256").update(seed).digest("hex");
    if (row.evidenceId !== expectedId || receiptIds.has(expectedId)) return { ...base, warnings: ["invalid_history_evidence"] };
    receiptIds.add(expectedId);
    historicalEvidence.push({ evidenceId: expectedId, projectId, revision, taskId: row.taskId, runId: row.runId,
      outcome: row.outcome, source: row.source, status: row.status, acceptanceEventId: row.acceptanceEventId,
      completedEventId: row.completedEventId, repository: row.repository, pullRequest: row.pullRequest,
      requiredCheckCount: row.requiredCheckCount });
  }
  if (!isDeepStrictEqual(view, projectView(projectId, worktree, options))) {
    return { ...base, warnings: ["history_observation_changed"] };
  }
  const current = revision === view.revision.commitSha;
  const relation = current ? "head_commit" : "other_revision";
  const warnings = [];
  if (current) warnings.push("working_tree_cleanliness_unobserved");
  else warnings.push("historical_revision_differs_from_working_tree");
  if (data.truncated) warnings.push("history_results_truncated");
  return { ...base, relation, historicalEvidence, truncated: data.truncated, warnings,
    status: historicalEvidence.length ? "observed" : "unknown" };
}
