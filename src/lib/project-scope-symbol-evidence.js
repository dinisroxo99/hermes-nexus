import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";
import { collectContextSources } from "./project-context-files.js";
import { produceSymbolTargetCompletenessWitness } from "./symbol-target-completeness-witness.js";

// PR #56 merged the witness producer and Track A1 adapter used here. This is producer
// provenance, separate from the revision of the project whose declarations are examined.
const ADMITTED_PRODUCER_COMMIT = "4741b82ce4dcc46451a82a1f1100d83a7693ffb6";

/** Capture the pack builder's own bounded collection for one request. */
export function createScopeSymbolEvidence() {
  let collected;
  let locator;

  function collectSources(project, options) {
    collected = collectContextSources(project, options);
    const { projectId, rootId, relativePath } = project;
    locator = { projectId, rootId, relativePath };
    return collected;
  }

  function buildWitness(request, pack, impact) {
    if (!collected || collected.truncated || collected.diagnostics.length
        || locator.projectId !== request.projectId || locator.rootId !== request.worktree.rootId
        || locator.relativePath !== request.worktree.relativePath
        || pack.analysis?.status !== "available" || pack.observation?.incomplete !== false
        || impact.status !== "available" || impact.observation?.incomplete !== false
        || collected.digest !== pack.observation.sourceDigest) return null;

    const { files, ...collection } = collected;
    const snapshot = createProviderSnapshot(locator, files, pack.revision);
    if (snapshot.token !== pack.analysis.snapshotToken || snapshot.token !== impact.snapshotToken) return null;
    const sourceHashes = Object.fromEntries(snapshot.files.map(({ path, sha256 }) => [path, sha256]));
    if (!request.task.paths.every((p) => Object.hasOwn(sourceHashes, p))) return null;
    return produceSymbolTargetCompletenessWitness({
      taskId: request.task.id, taskPaths: request.task.paths, requiredNames: request.task.symbols,
      projectId: locator.projectId, repositoryId: snapshot.revision.repositoryId, worktreeId: snapshot.revision.worktreeId,
      snapshotToken: snapshot.token, sourceHashes, admittedCommit: ADMITTED_PRODUCER_COMMIT,
      observation: { project: locator, snapshot, collection }
    });
  }

  return { collectSources, buildWitness };
}
