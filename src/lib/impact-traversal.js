import { contextDigest, compareContextStrings as compare, normalizeContextSources } from "./project-context-files.js";
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

export function analyzeSingleFileReverseImpact(input = {}) {
  const originPath = normalizeImpactPaths([input.originPath])[0];
  const limits = normalizeImpactLimits(input.limits);
  const graph = input.graph && typeof input.graph === "object" ? input.graph : null;
  const sourceFiles = normalizeSources(input.sourceFiles ?? []);
  const sourceByPath = new Map(sourceFiles.map((source) => [source.path, source]));
  const completeness = emptyCompleteness();

  if (input.sourceLimited) addReason(completeness, "source", "source_limit");
  if (input.sourceUnavailable || (sourceFiles.length === 0 && !sourceByPath.has(originPath))) addReason(completeness, "source", "source_unavailable");

  const base = {
    schemaVersion: 1,
    analysisVersion: IMPACT_ANALYSIS_VERSION,
    originPath,
    snapshotToken: graph?.snapshotToken ?? null,
    provider: graph?.provider ? providerSummary(graph.provider) : null,
    revision: graph?.revision ?? null,
    worktree: graph?.worktree ?? null,
    limits,
    affectedFiles: [],
    affectedTests: { status: "not_requested", candidates: [] },
    completeness
  };

  const providerState = classifyProvider(graph, completeness);
  if (providerState !== "evaluated") return finish({ ...base, status: providerState, findingState: "not_evaluated" });

  const nodes = normalizeNodes(graph.nodes);
  const edges = normalizeEdges(graph.edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
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

  const frontier = originNodes.map((node) => ({ id: node.id, distance: 0 })).sort(compareStates);
  const bestNodeDistance = new Map(frontier.map((state) => [state.id, state.distance]));
  const bestFile = new Map();
  let edgeExaminations = 0;
  let workLimited = false;
  let depthLimited = false;

  while (frontier.length > 0) {
    frontier.sort(compareStates);
    const state = frontier.shift();
    if (state.distance !== bestNodeDistance.get(state.id)) continue;
    const currentNode = nodeById.get(state.id);
    const candidates = incoming.get(state.id) ?? [];
    for (const edge of candidates) {
      if (edgeExaminations >= limits.traversalEdgeExaminations) {
        workLimited = true;
        break;
      }
      edgeExaminations += 1;
      const consumer = nodeById.get(edge.from);
      if (!consumer) continue;
      const nextDistance = state.distance + (consumer.file === currentNode.file ? 0 : 1);
      if (nextDistance > limits.depth) {
        depthLimited = true;
        continue;
      }
      const witness = makeWitness({ edge, graph, sourceByPath, consumer });
      if (consumer.file !== originPath || nextDistance === 0) {
        retainFile(bestFile, consumer.file, originPath, nextDistance, witness);
      }
      const known = bestNodeDistance.get(consumer.id);
      if (known === undefined || nextDistance < known) {
        if (bestNodeDistance.size >= limits.traversalVisitedStates && known === undefined) {
          workLimited = true;
          continue;
        }
        bestNodeDistance.set(consumer.id, nextDistance);
        frontier.push({ id: consumer.id, distance: nextDistance });
      }
    }
    if (workLimited) break;
  }

  if (depthLimited) addReason(completeness, "traversal", "depth_limit");
  if (workLimited) addReason(completeness, "traversal", "traversal_work_limit");

  let affectedFiles = [...bestFile.values()].sort(compareAffectedItems);
  const discoveredAffectedCount = affectedFiles.length;
  if (affectedFiles.length > limits.affectedFiles) {
    affectedFiles = affectedFiles.slice(0, limits.affectedFiles).map((item) => withOutputTruncation(item, discoveredAffectedCount));
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
  if (!Array.isArray(sources)) return [];
  if (sources.every((source) => typeof source?.text === "string")) return normalizeContextSources(sources);
  return sources.map((source) => ({ path: normalizeImpactPaths([source.path])[0], sha256: boundedHash(source.sha256 ?? source.hash) }))
    .sort((a, b) => compare(a.path, b.path));
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
  if (!["available", "partial"].includes(graph.status)) return "unavailable";
  if (graph.status === "partial" || graph.limited) addReason(completeness, "provider", "provider_partial");
  for (const uncovered of graph.coverage?.uncovered ?? []) {
    if (uncovered) addReason(completeness, "provider", "uncovered_language");
  }
  return "evaluated";
}

function normalizeNodes(nodes) {
  if (!Array.isArray(nodes)) return [];
  const seen = new Map();
  for (const node of nodes) {
    if (typeof node?.id !== "string" || typeof node.file !== "string") continue;
    const normalized = { id: node.id, file: normalizeImpactPaths([node.file])[0], line: Number.isInteger(node.line) && node.line > 0 ? node.line : null };
    if (!seen.has(normalized.id)) seen.set(normalized.id, normalized);
  }
  return [...seen.values()].sort(compareNodes);
}

function normalizeEdges(edges) {
  if (!Array.isArray(edges)) return [];
  const seen = new Map();
  for (const edge of edges) {
    if (typeof edge?.from !== "string" || typeof edge.to !== "string" || !EDGE_RELATIONS.includes(edge.relation)) continue;
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
  const source = sourceByPath.get(sourcePath) ?? sourceByPath.get(consumer.file);
  return {
    id: `impact_edge_${contextDigest(JSON.stringify([graph.snapshotToken ?? null, graph.provider.id, graph.provider.version, edge]))}`,
    provider: providerSummary(graph.provider),
    capability,
    relationshipKind: edge.relation,
    source: { path: source?.path ?? sourcePath, hash: source?.sha256 ?? "unknown" },
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

function withOutputTruncation(item, discoveredAffectedCount) {
  return {
    ...item,
    originSummary: {
      discoveredOriginCount: discoveredAffectedCount,
      retainedOriginWitnessCount: item.origins.length,
      attributionTruncated: true,
      reasons: ["origin_limit"]
    }
  };
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

function invalidImpactTraversal() {
  return Object.assign(new Error("Invalid Impact v2 traversal input."), { code: "invalid_impact_traversal" });
}
