import { matchesImpactBinding } from "./task-conflict-impact.js";
import { compareTaskScopes } from "./task-conflict-comparison.js";

export function compareObservedTaskEvidence(first, second) {
  return compareTaskScopes(first.scope, second.scope, {
    leftImpact: first.impact, rightImpact: second.impact,
    leftSymbolWitness: first.acceptedSymbolWitness, rightSymbolWitness: second.acceptedSymbolWitness,
    leftPeerImpact: observePeerOrigins(first, second), rightPeerImpact: observePeerOrigins(second, first)
  });
}

// Recheck both sibling observations after the primary scopes have been built. A task
// writing the other's dependant uses this same check to corroborate the origin on its own checkout.
function observePeerOrigins(writer, observer) {
  const a = writer.scope;
  const b = observer.scope;
  if (!["available", "incomplete"].includes(a.status) || !["available", "incomplete"].includes(b.status)
      || a.projectId !== b.projectId || a.revisionBinding.repositoryId !== b.revisionBinding.repositoryId
      || a.revisionBinding.worktreeId === b.revisionBinding.worktreeId) return null;
  const written = new Set(a.write.items.map((item) => item.target.path));
  const needsDependency = [...b.watch.items, ...b.impact.items].some((item) => written.has(item.target.path));
  const observation = writer.impactForPaths(needsDependency ? b.task.paths : a.task.paths);
  if (!matchesImpactBinding(observation, a)) {
    throw Object.assign(new Error("Task comparison observation changed."), { code: "impact_sources_changed", source: "impact" });
  }
  return needsDependency ? observation : null;
}
