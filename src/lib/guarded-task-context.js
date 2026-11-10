import path from "node:path";
import { compareObservedTaskEvidence } from "./compare-observed-tasks.js";
import { normalizeEffectiveTaskScopeRequest } from "./effective-task-scope-policy.js";
import { createEffectiveTaskScopeBuilder } from "./effective-task-scope-service.js";
import { isContextPathAllowed } from "./project-context-files.js";
import { resolveProjectConfig } from "./project-config.js";
import { getConfiguredProjectRoots } from "./project-roots.js";
import { resolveProjectWorktree } from "./projects.js";
import { captureDiffBaseline } from "./task-diff-audit.js";
import { buildProjectTaskContext } from "./task-context.js";

const sha256 = /^[a-f0-9]{64}$/;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function checkPeerTasks(location, scope, peers, dataDir, roots) {
  if (!Array.isArray(peers) || peers.length > 4) fail("invalid_guard_peers");
  if (!peers.length) return [];
  const requests = peers.map((peer) => {
    if (!peer || Object.hasOwn(peer, "projectId")) fail("invalid_guard_peers");
    return normalizeEffectiveTaskScopeRequest({ ...peer, projectId: location.projectId });
  });
  const ids = requests.map((r) => r.task.id);
  if (ids.includes(scope.task.id) || new Set(ids).size !== ids.length) fail("invalid_guard_peers");
  const build = createEffectiveTaskScopeBuilder({ getProjectConfig: () => ({ dataDir }), getConfiguredProjectRoots: () => roots });
  const primary = build(normalizeEffectiveTaskScopeRequest({ ...location, task: scope.task,
    expectedRevision: scope.revision, includeTests: true, changeSemantics: { category: "local_implementation" } }));
  return requests.map((r) => {
    const result = compareObservedTaskEvidence(primary, build(r));
    if (result.severity === "high") fail("guard_peer_conflict");
    if (result.status !== "available" || result.severity === "warning") fail("guard_peer_revalidation_required");
    return { taskId: r.task.id, findingState: result.findingState, severity: result.severity };
  });
}

export function prepareGuardedTask(location, task, revision, reads, writes, options = {}) {
  const files = [...reads, ...writes];
  if (!writes.length || files.length > 16 || new Set(files).size !== files.length
      || files.some((file) => !isContextPathAllowed(file))) fail("invalid_operator_grants");
  const { dataDir = resolveProjectConfig().dataDir, roots = getConfiguredProjectRoots() } = options;
  const registry = { roots, manualProjectsFile: path.join(dataDir, "projects.json"),
    discoveredProjectsFile: path.join(dataDir, "discovered-projects.json") };
  // Capturing verifies the Git-listed checkout, clean revision, ETS classifications and committed WRITE source bytes.
  const receipt = captureDiffBaseline(location, task, { dataDir, roots });
  const scope = JSON.parse(receipt);
  if (scope.revision.commitSha !== revision) fail("guard_revision_mismatch");
  if (writes.some((file) => !scope.writePaths.includes(file))) fail("guard_write_outside_scope");

  const project = resolveProjectWorktree(location.projectId, location.worktree, registry);
  const pack = buildProjectTaskContext({ ...location, task: { ...scope.task, paths: files },
    limits: { files: 32, symbols: 32, maxBytes: 65536 } }, { registry });
  if (pack.analysis.snapshotToken !== scope.snapshotToken || pack.revision.commitSha !== revision
      || pack.revision.worktreeId !== scope.revision.worktreeId) fail("guard_snapshot_changed");
  const sources = [...files].sort().map((file) => {
    const evidence = pack.sections.files.items.find((item) => item.path === file)?.provenance?.source;
    if (evidence?.path !== file || !sha256.test(evidence.sha256)) fail("guard_read_evidence_unavailable");
    return { path: file, sha256: evidence.sha256 };
  });
  const symbols = pack.sections.symbols.items.filter((item) => files.includes(item.path))
    .slice(0, 16).map(({ path: file, name }) => ({ path: file, name }));
  const peers = checkPeerTasks(location, scope, options.peers ?? [], dataDir, roots);
  return { directory: project.absolutePath, receipt, peers, context: { projectId: location.projectId, taskId: scope.task.id,
    revision, snapshotToken: scope.snapshotToken, relevantPaths: sources.map((item) => item.path), sources, symbols } };
}
