import {
  MAX_COMPACT_OUTPUT, compareStrings, materializeBoundedJsonData, normalizeSymbolTargetCompletenessWitness,
  evaluateSymbolTargetCompletenessWitness
} from "./effective-task-scope-policy.js";

const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const REVISION_FIELDS = ["status", "branch", "commitSha", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];

export function matchesImpactBinding(impact, scope) {
  return impact?.schemaVersion === 1 && impact.analysisVersion === "impact-v2"
    && impact.projectId === scope.projectId && impact.project?.rootId === scope.project.rootId
    && impact.project.relativePath === scope.project.relativePath
    && impact.snapshotToken === scope.sourceBinding.impactSnapshotToken
    && REVISION_FIELDS.every((key) => impact.revision?.[key] === scope.revisionBinding[key]);
}

/** Admit one Impact envelope for the exact snapshot and origin set supplied by the service. */
export function boundImpact(raw, scope, expectedPaths = scope.task.paths) {
  let impact;
  try { impact = materializeBoundedJsonData(raw); } catch { return null; }
  if (Buffer.byteLength(JSON.stringify(impact), "utf8") > MAX_COMPACT_OUTPUT
      || !matchesImpactBinding(impact, scope)
      || !["available", "partial"].includes(impact.status)
      || !["evidence_found", "no_evidence_found"].includes(impact.findingState)
      || Object.hasOwn(impact, "originPath") || !Array.isArray(impact.targets)
      || expectedPaths.length !== impact.targets.length) return null;
  const requested = new Set(expectedPaths);
  const hashes = new Map();
  const evidenceOrigins = new Set();
  for (const target of impact.targets) {
    if (!requested.delete(target?.originPath)) return null;
    const source = target.targetSource;
    if (source?.path === target.originPath && isHash(source.hash) && ["available", "partial"].includes(target.status)
        && ["evidence_found", "no_evidence_found"].includes(target.findingState)) {
      hashes.set(source.path, source.hash);
      if (target.findingState === "evidence_found") evidenceOrigins.add(source.path);
    }
  }
  return { impact, hashes, evidenceOrigins };
}

function originsFor(bound, path) {
  if (!Array.isArray(bound?.impact.affectedFiles)) return [];
  const affected = bound.impact.affectedFiles.find((item) => item?.path === path);
  if (!Array.isArray(affected?.origins)) return [];
  return affected.origins.filter((origin) => typeof origin?.originPath === "string"
    && Number.isSafeInteger(origin.minimumDistance) && origin.minimumDistance >= 1 && origin.minimumDistance <= 5);
}

// Impact v2 retains the final edge witness of a reverse traversal. Distance one is direct;
// larger distances prove attributed reachability, without identifying intermediate edges.
function citation(bound, origin, path, sourceHash) {
  const w = origin?.witness;
  const provider = bound.impact.provider;
  if (bound.impact.findingState !== "evidence_found" || !bound.evidenceOrigins.has(origin?.originPath)
      || typeof provider?.id !== "string" || !provider.id || provider.id.length > 128
      || typeof provider.version !== "string" || !provider.version || provider.version.length > 64
      || w?.provider?.id !== provider.id || w.provider.version !== provider.version
      || !/^impact_edge_[a-f0-9]{64}$/.test(typeof w.id === "string" ? w.id : "")
      || !["imports", "references", "uses"].includes(w.relationshipKind)
      || w.capability !== (w.relationshipKind === "imports" ? "dependencies" : "references")
      || !["semantic", "structural"].includes(w.basis) || !["untrusted_external_analysis", "derived_analysis"].includes(w.trust)
      || w.source?.path !== path || w.source.hash !== sourceHash) return null;
  return {
    snapshotToken: bound.impact.snapshotToken, witnessId: w.id, provider: { id: provider.id, version: provider.version },
    relationshipKind: w.relationshipKind, basis: w.basis, trust: w.trust, minimumDistance: origin.minimumDistance
  };
}

/** Return one deterministic witnessed origin for a file. Distinct snapshots must each observe it. */
export function dependencyEvidence(path, writer, observer, peer, sameSnapshot) {
  const hash = writer?.hashes.get(path);
  if (!hash || !observer || (!sameSnapshot && !peer)) return null;
  const origins = originsFor(observer, path).sort((a, b) => a.minimumDistance - b.minimumDistance
    || compareStrings(a.originPath, b.originPath));
  for (const origin of origins) {
    const first = citation(observer, origin, path, hash);
    if (!first) continue;
    const originPath = origin.originPath;
    const originHash = observer.hashes.get(originPath);
    if (sameSnapshot) return { originPath, originHash, sourceHash: hash, citations: [first] };
    if (originHash !== peer.hashes.get(originPath)) continue;
    const other = originsFor(peer, path).find(item => item?.originPath === originPath);
    const second = citation(peer, other, path, hash);
    if (!second) continue;
    // Matching endpoint bytes and independent traversals establish an attributed relationship
    // on both sides. Each witness retains its own provider and distance.
    return { originPath, originHash, sourceHash: hash, citations: [first, second] };
  }
  return null;
}

export function declarationEvidence(raw, scope, bound) {
  if (!raw || !bound || !scope.task.symbols?.length) return [];
  let witness;
  try {
    const accepted = materializeBoundedJsonData(raw);
    if (accepted?.taskId !== scope.task.id || Buffer.byteLength(JSON.stringify(accepted), "utf8") > MAX_COMPACT_OUTPUT) return [];
    witness = normalizeSymbolTargetCompletenessWitness(accepted.witness);
  } catch { return []; }
  if (!witness) return [];
  const binding = {
    taskPaths: scope.task.paths, symbols: scope.task.symbols, projectId: scope.projectId,
    repositoryId: scope.revisionBinding.repositoryId, worktreeId: scope.revisionBinding.worktreeId,
    snapshotToken: scope.sourceBinding.contextSnapshotToken
  };
  if (!evaluateSymbolTargetCompletenessWitness(witness, binding, { impact: bound.impact }).ok) return [];
  return witness.evaluations.flatMap((evaluation) => {
    const c = evaluation.a1Citation;
    if (!c || !isHash(c.declarationId) || c.symbolId !== "symbol_" + c.declarationId
        || !bound.hashes.has(c.path) || witness.sourceHashes[c.path] !== bound.hashes.get(c.path)) return [];
    return [{ path: c.path, name: evaluation.name, hash: bound.hashes.get(c.path),
      citation: { taskId: scope.task.id, snapshotToken: binding.snapshotToken, declarationId: c.declarationId, symbolId: c.symbolId } }];
  });
}

export function sharedDeclarations(path, [left, right], sameSnapshot) {
  return left.filter((a) => a.path === path).flatMap((a) => {
    const b = right.find(item => item.path === path && item.name === a.name && item.hash === a.hash);
    if (!b || (sameSnapshot && a.citation.declarationId !== b.citation.declarationId)) return [];
    return [{ name: a.name, sourceHash: a.hash, citations: [a.citation, b.citation] }];
  }).sort((a, b) => compareStrings(a.name, b.name));
}
