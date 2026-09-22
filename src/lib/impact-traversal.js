import { contextDigest, compareContextStrings as compare, normalizeContextSources } from "./project-context-files.js";
import { createProviderSnapshot, detectSnapshotLanguages, normalizeProviderDescriptor } from "../analyzers/common/analyzer-provider-contract.js";
import {
  IMPACT_ANALYSIS_VERSION,
  IMPACT_LIMITS,
  normalizeImpactCompleteness,
  normalizeImpactFindingState,
  normalizeImpactLimits,
  normalizeImpactPaths,
  normalizeImpactStatus,
  validateCompletedAffectedItem
} from "./impact-policy.js";

const EDGE_RELATIONS = Object.freeze(["imports", "uses", "references"]);
const RELEVANT_CAPABILITIES = Object.freeze(["dependencies", "references"]);
const LANGUAGE_ID = /^[a-z][a-z0-9-]{0,31}$/;

export function analyzeSingleFileReverseImpact(input = {}) {
  const originPath = normalizeImpactPaths([input.originPath])[0];
  const limits = normalizeImpactLimits(input.limits);
  const graph = input.graph && typeof input.graph === "object" ? input.graph : null;
  const snapshot = normalizeBoundSnapshot(input.snapshot ?? graph?.snapshot);
  validateSnapshotBinding({ graph, snapshot, sourceFiles: input.sourceFiles });
  const sourceFiles = snapshot.files;
  const sourceByPath = new Map(sourceFiles.map((source) => [source.path, source]));
  const completeness = emptyCompleteness();

  if (input.sourceLimited) addReason(completeness, "source", "source_limit");
  if (input.sourceUnavailable || (sourceFiles.length === 0 && !sourceByPath.has(originPath))) addReason(completeness, "source", "source_unavailable");

  const base = {
    schemaVersion: 1,
    analysisVersion: IMPACT_ANALYSIS_VERSION,
    originPath,
    snapshotToken: snapshot.token,
    provider: graph?.provider ? providerSummary(graph.provider) : null,
    revision: snapshot.revision,
    worktree: snapshot.worktree,
    limits,
    affectedFiles: [],
    affectedTests: { status: "not_requested", candidates: [] },
    completeness
  };

  const providerState = classifyProvider(graph, completeness);
  if (providerState !== "evaluated") return finish({ ...base, status: providerState, findingState: "not_evaluated" });

  if (!isRelevantOperationSupported(graph.provider)) {
    addReason(completeness, "provider", "provider_unsupported");
    return finish({ ...base, status: statusFromCompleteness(completeness), findingState: "not_evaluated" });
  }
  if (!sourceByPath.has(originPath)) {
    addReason(completeness, "source", "source_unavailable");
    return finish({ ...base, status: statusFromCompleteness(completeness), findingState: "not_evaluated" });
  }
  if (!isOriginLanguageCovered(graph, originPath, sourceByPath)) {
    addReason(completeness, "provider", "uncovered_language");
    return finish({ ...base, status: statusFromCompleteness(completeness), findingState: "not_evaluated" });
  }

  const nodes = normalizeNodes(graph.nodes);
  const edges = normalizeEdges(graph.edges, graph.provider);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) throw invalidImpactTraversal();
  }
  const originNodes = nodes.filter((node) => node.file === originPath);
  if (originNodes.length === 0) return finish({ ...base, status: statusFromCompleteness(completeness), findingState: "no_evidence_found" });
  if (limits.depth === 0) return finish({ ...base, status: statusFromCompleteness(completeness), findingState: "no_evidence_found" });

  const incoming = new Map();
  for (const edge of edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }
  for (const list of incoming.values()) list.sort(compareEdges);

  const frontier = [];
  let workLimited = false;
  for (const node of originNodes.sort(compareNodes)) {
    if (frontier.length >= limits.traversalVisitedStates) {
      workLimited = true;
      continue;
    }
    frontier.push({ id: node.id, distance: 0 });
  }
  const bestNodeDistance = new Map(frontier.map((state) => [state.id, state.distance]));
  const bestObservedInBoundDistance = new Map(bestNodeDistance);
  const bestFile = new Map();
  const overDepthCandidates = new Map();
  let edgeExaminations = 0;
  let stopTraversal = false;

  while (frontier.length > 0) {
    frontier.sort(compareStates);
    const state = frontier.shift();
    if (state.distance !== bestNodeDistance.get(state.id)) continue;
    const currentNode = nodeById.get(state.id);
    const candidates = incoming.get(state.id) ?? [];
    for (const edge of candidates) {
      if (edgeExaminations >= limits.traversalEdgeExaminations) {
        workLimited = true;
        stopTraversal = true;
        break;
      }
      edgeExaminations += 1;
      const consumer = nodeById.get(edge.from);
      if (!consumer) continue;
      const nextDistance = state.distance + (consumer.file === currentNode.file ? 0 : 1);
      const known = bestNodeDistance.get(consumer.id);
      if (nextDistance > limits.depth) {
        if (known === undefined || nextDistance < known) {
          const currentOverDepth = overDepthCandidates.get(consumer.id);
          if (currentOverDepth === undefined || nextDistance < currentOverDepth) overDepthCandidates.set(consumer.id, nextDistance);
        }
        continue;
      }
      const observed = bestObservedInBoundDistance.get(consumer.id);
      if (observed === undefined || nextDistance < observed) bestObservedInBoundDistance.set(consumer.id, nextDistance);
      const witness = makeWitness({ edge, graph, sourceByPath, consumer });
      if (consumer.file !== originPath || nextDistance === 0) {
        retainFile(bestFile, consumer.file, originPath, nextDistance, witness);
      }
      if (known === undefined || nextDistance < known) {
        if (bestNodeDistance.size >= limits.traversalVisitedStates && known === undefined) {
          workLimited = true;
          continue;
        }
        bestNodeDistance.set(consumer.id, nextDistance);
        frontier.push({ id: consumer.id, distance: nextDistance });
      }
    }
    if (stopTraversal) break;
  }

  if ([...overDepthCandidates.keys()].some((id) => {
    const best = bestObservedInBoundDistance.get(id);
    return best === undefined || best > limits.depth;
  })) addReason(completeness, "traversal", "depth_limit");
  if (workLimited) addReason(completeness, "traversal", "traversal_work_limit");

  let affectedFiles = [...bestFile.values()].sort(compareAffectedItems);
  if (affectedFiles.length > limits.affectedFiles) {
    affectedFiles = affectedFiles.slice(0, limits.affectedFiles);
    addReason(completeness, "output", "origin_limit");
  }
  affectedFiles = affectedFiles.map((item) => validateCompletedAffectedItem(item));

  return finish({
    ...base,
    status: statusFromCompleteness(completeness),
    findingState: affectedFiles.length > 0 ? "evidence_found" : "no_evidence_found",
    affectedFiles
  });
}

function normalizeSources(sources) {
  try {
    if (!Array.isArray(sources)) throw invalidImpactTraversal();
    if (sources.every((source) => typeof source?.text === "string")) return normalizeContextSources(sources);
    const seen = new Set();
    return sources.map((source) => {
      const normalized = { path: normalizeImpactPaths([source.path])[0], sha256: boundedHash(source.sha256 ?? source.hash) };
      if (seen.has(normalized.path)) throw invalidImpactTraversal();
      seen.add(normalized.path);
      return normalized;
    }).sort((a, b) => compare(a.path, b.path));
  } catch (error) {
    if (error?.code === "invalid_impact_traversal") throw error;
    throw invalidImpactTraversal();
  }
}

function normalizeBoundSnapshot(snapshot) {
  try {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw invalidImpactTraversal();
    const suppliedToken = boundedHash(snapshot.token ?? snapshot.snapshotToken);
    const derived = createProviderSnapshot({ projectId: snapshot.projectId ?? null }, snapshot.files, snapshot.revision ?? {});
    if (derived.files.length === 0 || suppliedToken !== derived.token) throw invalidImpactTraversal();
    return {
      token: derived.token,
      files: derived.files,
      projectId: derived.projectId,
      revision: derived.revision,
      worktree: derived.revision.worktreeId === null ? null : { worktreeId: derived.revision.worktreeId }
    };
  } catch (error) {
    if (error?.code === "invalid_impact_traversal") throw error;
    throw invalidImpactTraversal();
  }
}

function validateSnapshotBinding({ graph, snapshot, sourceFiles }) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return;
  if (graph.snapshotToken !== snapshot.token) throw invalidImpactTraversal();
  if (sourceFiles !== undefined && canonicalJson(normalizeSources(sourceFiles).map(sourceIdentity)) !== canonicalJson(snapshot.files.map(sourceIdentity))) {
    throw invalidImpactTraversal();
  }
  if (graph.projectId !== undefined && graph.projectId !== null && graph.projectId !== snapshot.projectId) throw invalidImpactTraversal();
  if (graph.revision !== undefined && canonicalJson(graph.revision) !== canonicalJson(snapshot.revision)) throw invalidImpactTraversal();
  if (graph.worktree !== undefined && canonicalJson(graph.worktree) !== canonicalJson(snapshot.worktree)) throw invalidImpactTraversal();
}

function sourceIdentity(source) {
  return [source.path, source.sha256];
}

function isRelevantOperationSupported(provider) {
  return RELEVANT_CAPABILITIES.some((capability) => provider.capabilities?.[capability] !== "unsupported");
}

function isOriginLanguageCovered(graph, originPath, sourceByPath) {
  const source = sourceByPath.get(originPath);
  const languages = source ? detectSnapshotLanguages([source]) : [];
  const language = languages[0] ?? null;
  if (!language) return false;
  const covered = graph.coverage?.covered;
  const uncovered = graph.coverage?.uncovered;
  if (!Array.isArray(covered) || !Array.isArray(uncovered)) throw invalidImpactTraversal();
  return covered.includes(language) && !uncovered.includes(language);
}

function boundedHash(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) throw invalidImpactTraversal();
  return value;
}

function classifyProvider(graph, completeness) {
  if (!graph || typeof graph !== "object") {
    addReason(completeness, "provider", "provider_unsupported");
    return "unsupported";
  }
  if (graph.status === "unavailable") {
    addReason(completeness, "provider", "provider_partial");
    return "unavailable";
  }
  if (graph.status === "unsupported" || graph.success === false || !graph.provider) {
    addReason(completeness, "provider", "provider_unsupported");
    return "unsupported";
  }
  validateProviderDescriptor(graph.provider);
  if (!["available", "partial"].includes(graph.status)) return "unavailable";
  if (graph.status === "partial" || graph.limited) addReason(completeness, "provider", "provider_partial");
  validateCoverage(graph.coverage);
  for (const uncovered of graph.coverage.uncovered) {
    if (uncovered) addReason(completeness, "provider", "uncovered_language");
  }
  return "evaluated";
}

function validateProviderDescriptor(provider) {
  try { normalizeProviderDescriptor(provider); }
  catch { throw invalidImpactTraversal(); }
}

function validateCoverage(coverage) {
  if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)) throw invalidImpactTraversal();
  for (const dimension of ["observed", "covered", "uncovered"]) {
    if (!Array.isArray(coverage[dimension])) throw invalidImpactTraversal();
    for (const language of coverage[dimension]) {
      if (typeof language !== "string" || !LANGUAGE_ID.test(language)) throw invalidImpactTraversal();
    }
  }
}

function normalizeNodes(nodes) {
  if (!Array.isArray(nodes)) throw invalidImpactTraversal();
  const seen = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof node.id !== "string" || typeof node.file !== "string") throw invalidImpactTraversal();
    const normalized = { id: node.id, file: normalizeImpactPaths([node.file])[0], line: Number.isInteger(node.line) && node.line > 0 ? node.line : null };
    const current = seen.get(normalized.id);
    if (current && canonicalJson(current) !== canonicalJson(normalized)) throw invalidImpactTraversal();
    if (!current) seen.set(normalized.id, normalized);
  }
  return [...seen.values()].sort(compareNodes);
}

function normalizeEdges(edges, provider) {
  if (!Array.isArray(edges)) throw invalidImpactTraversal();
  const seen = new Map();
  for (const edge of edges) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge) || typeof edge.from !== "string" || typeof edge.to !== "string" || !EDGE_RELATIONS.includes(edge.relation)) {
      throw invalidImpactTraversal();
    }
    const capability = capabilityForRelation(edge.relation);
    if (provider.capabilities?.[capability] === "unsupported") throw invalidImpactTraversal();
    const normalized = {
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      location: normalizeOptionalLocation(edge.location)
    };
    seen.set(edgeKey(normalized), normalized);
  }
  return [...seen.values()].sort(compareEdges);
}

function capabilityForRelation(relation) {
  return relation === "imports" ? "dependencies" : "references";
}

function normalizeOptionalLocation(location) {
  if (location === undefined || location === null) return null;
  return {
    path: normalizeImpactPaths([location.path])[0],
    line: positiveInteger(location.line),
    column: positiveInteger(location.column)
  };
}

function positiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidImpactTraversal();
  return value;
}

function makeWitness({ edge, graph, sourceByPath, consumer }) {
  const capability = edge.relation === "imports" ? "dependencies" : "references";
  const sourcePath = edge.location?.path ?? consumer.file;
  const source = sourceByPath.get(sourcePath);
  if (!source) throw invalidImpactTraversal();
  return {
    id: `impact_edge_${contextDigest(JSON.stringify([graph.snapshotToken ?? null, graph.provider.id, graph.provider.version, edge]))}`,
    provider: providerSummary(graph.provider),
    capability,
    relationshipKind: edge.relation,
    source: { path: source.path, hash: source.sha256 },
    location: edge.location,
    trust: graph.provider.kind === "external" ? "untrusted_external_analysis" : "derived_analysis",
    basis: graph.provider.capabilities?.[capability] === "semantic" ? "semantic" : "structural"
  };
}

function retainFile(bestFile, path, originPath, minimumDistance, witness) {
  const candidate = {
    path,
    origins: [{ originPath, minimumDistance, witness }],
    originSummary: { discoveredOriginCount: 1, retainedOriginWitnessCount: 1, attributionTruncated: false, reasons: [] }
  };
  const current = bestFile.get(path);
  if (!current || compareAffectedItems(candidate, current) < 0) bestFile.set(path, candidate);
}

function finish(result) {
  return {
    ...result,
    status: normalizeImpactStatus(result.status),
    findingState: normalizeImpactFindingState(result.findingState),
    completeness: normalizeImpactCompleteness(result.completeness)
  };
}

function statusFromCompleteness(completeness) {
  return Object.values(completeness).some((reasons) => reasons.length > 0) ? "partial" : "available";
}

function emptyCompleteness() {
  return { source: [], provider: [], traversal: [], output: [] };
}

function addReason(completeness, dimension, reason) {
  if (!completeness[dimension].includes(reason)) completeness[dimension].push(reason);
  completeness[dimension].sort(compare);
}

function providerSummary(provider) {
  return { id: provider.id, version: provider.version };
}

function compareStates(left, right) {
  return left.distance - right.distance || compare(left.id, right.id);
}

function compareNodes(left, right) {
  return compare(left.file, right.file) || compare(left.id, right.id);
}

function compareEdges(left, right) {
  return compare(edgeKey(left), edgeKey(right));
}

function compareAffectedItems(left, right) {
  const leftOrigin = left.origins[0];
  const rightOrigin = right.origins[0];
  return leftOrigin.minimumDistance - rightOrigin.minimumDistance
    || compare(left.path, right.path)
    || compare(leftOrigin.witness.id, rightOrigin.witness.id);
}

function edgeKey(edge) {
  return JSON.stringify([edge.from, edge.to, edge.relation, edge.location ?? null]);
}

function canonicalJson(value) {
  try { return JSON.stringify(canonicalValue(value)); }
  catch { throw invalidImpactTraversal(); }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compare).map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function invalidImpactTraversal() {
  return Object.assign(new Error("Invalid Impact v2 traversal input."), { code: "invalid_impact_traversal" });
}
