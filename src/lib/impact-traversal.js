import { CONTEXT_SOURCE_LIMITS, contextDigest, compareContextStrings as compare, normalizeContextSources } from "./project-context-files.js";
import { createProviderSnapshot, detectSnapshotLanguages, isValidSnapshotSourcePosition, normalizeProviderDescriptor } from "../analyzers/common/analyzer-provider-contract.js";
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
  const sourceFiles = snapshot.files;
  const sourceByPath = new Map(sourceFiles.map((source) => [source.path, source]));
  validateSnapshotBinding({ graph, snapshot, sourceByPath, sourceFiles: input.sourceFiles });
  const completeness = emptyCompleteness();

  if (input.sourceLimited) addReason(completeness, "source", "source_limit");
  if (input.sourceUnavailable || (sourceFiles.length === 0 && !sourceByPath.has(originPath))) addReason(completeness, "source", "source_unavailable");

  const { state: providerState, provider } = classifyProvider(graph, completeness);
  const base = {
    schemaVersion: 1,
    analysisVersion: IMPACT_ANALYSIS_VERSION,
    originPath,
    snapshotToken: snapshot.token,
    provider: provider ? providerSummary(provider) : null,
    revision: snapshot.revision,
    worktree: snapshot.worktree,
    limits,
    affectedFiles: [],
    affectedTests: { status: "not_requested", candidates: [] },
    completeness
  };

  if (providerState !== "evaluated") return finish({ ...base, status: providerState, findingState: "not_evaluated" });

  if (!isRelevantOperationSupported(provider)) {
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

  const { nodes, nodeById, incoming } = prepareTraversalGraph(graph, provider, sourceByPath);
  const originNodes = nodes.filter((node) => node.file === originPath);
  if (originNodes.length === 0) return finish({ ...base, status: statusFromCompleteness(completeness), findingState: "no_evidence_found" });
  if (limits.depth === 0) return finish({ ...base, status: statusFromCompleteness(completeness), findingState: "no_evidence_found" });

  const discovery = traverseOrigin({
    originPath,
    originNodes: originNodes.sort(compareNodes),
    nodeById,
    incoming,
    graph,
    provider,
    sourceByPath,
    limits,
    work: { visitedStates: 0, edgeExaminations: 0 }
  });
  if (discovery.depthLimited) addReason(completeness, "traversal", "depth_limit");
  if (discovery.workLimited) addReason(completeness, "traversal", "traversal_work_limit");

  let affectedFiles = [...discovery.bestFile.values()].sort(compareAffectedItems);
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

export function analyzeMultiFileReverseImpact(input = {}) {
  const originPaths = normalizeImpactPaths(input.originPaths);
  const limits = normalizeImpactLimits(input.limits);
  const graph = input.graph && typeof input.graph === "object" ? input.graph : null;
  const snapshot = normalizeBoundSnapshot(input.snapshot ?? graph?.snapshot);
  const sourceFiles = snapshot.files;
  const sourceByPath = new Map(sourceFiles.map((source) => [source.path, source]));
  validateSnapshotBinding({ graph, snapshot, sourceByPath, sourceFiles: input.sourceFiles });

  const commonCompleteness = emptyCompleteness();
  if (input.sourceLimited) addReason(commonCompleteness, "source", "source_limit");
  if (input.sourceUnavailable || sourceFiles.length === 0) addReason(commonCompleteness, "source", "source_unavailable");
  const { state: providerState, provider } = classifyProvider(graph, commonCompleteness);
  const targetState = new Map(originPaths.map((originPath) => [originPath, {
    originPath,
    status: providerState,
    findingState: "not_evaluated",
    completeness: cloneCompleteness(commonCompleteness),
    discovered: false
  }]));
  const base = {
    schemaVersion: 1,
    analysisVersion: IMPACT_ANALYSIS_VERSION,
    targets: [],
    snapshotToken: snapshot.token,
    provider: provider ? providerSummary(provider) : null,
    revision: snapshot.revision,
    worktree: snapshot.worktree,
    limits,
    affectedFiles: [],
    affectedTests: { status: "not_requested", candidates: [] },
    completeness: commonCompleteness
  };

  if (providerState !== "evaluated") return finishMulti(base, targetState, providerState);
  if (!isRelevantOperationSupported(provider)) {
    addReason(commonCompleteness, "provider", "provider_unsupported");
    for (const target of targetState.values()) {
      target.completeness = cloneCompleteness(commonCompleteness);
      target.status = statusFromCompleteness(target.completeness);
    }
    return finishMulti(base, targetState);
  }

  const eligible = [];
  for (const originPath of originPaths) {
    const target = targetState.get(originPath);
    target.completeness = cloneCompleteness(commonCompleteness);
    if (!sourceByPath.has(originPath)) {
      addReason(target.completeness, "source", "source_unavailable");
    } else if (!isOriginLanguageCovered(graph, originPath, sourceByPath)) {
      addReason(target.completeness, "provider", "uncovered_language");
    } else {
      eligible.push(originPath);
    }
    target.status = statusFromCompleteness(target.completeness);
  }
  if (eligible.length === 0) return finishMulti(base, targetState);

  const { nodes, nodeById, incoming } = prepareTraversalGraph(graph, provider, sourceByPath);
  const work = { visitedStates: 0, edgeExaminations: 0 };
  const merged = new Map();

  for (const originPath of eligible) {
    const target = targetState.get(originPath);
    const originNodes = nodes.filter((node) => node.file === originPath).sort(compareNodes);
    if (originNodes.length === 0 || limits.depth === 0) {
      target.findingState = "no_evidence_found";
      continue;
    }
    const discovery = traverseOrigin({ originPath, originNodes, nodeById, incoming, graph, provider, sourceByPath, limits, work });
    if (discovery.depthLimited) addReason(target.completeness, "traversal", "depth_limit");
    if (discovery.workLimited) addReason(target.completeness, "traversal", "traversal_work_limit");
    target.status = statusFromCompleteness(target.completeness);
    target.discovered = discovery.bestFile.size > 0;
    target.findingState = target.discovered ? "evidence_found" : discovery.unstarted ? "not_evaluated" : "no_evidence_found";
    mergeOriginDiscoveries(merged, discovery.bestFile);
  }

  const mergedOutput = buildMergedAffectedFiles(merged, limits, targetState);
  let affectedFiles = mergedOutput.affectedFiles;
  if (mergedOutput.originLimited) addReason(commonCompleteness, "output", "origin_limit");
  if (affectedFiles.length > limits.affectedFiles) {
    for (const item of affectedFiles.slice(limits.affectedFiles)) {
      for (const origin of item.origins) addReason(targetState.get(origin.originPath).completeness, "output", "origin_limit");
    }
    affectedFiles = affectedFiles.slice(0, limits.affectedFiles);
    addReason(commonCompleteness, "output", "origin_limit");
  }
  const retainedOrigins = new Set(affectedFiles.flatMap((item) => item.origins.map((origin) => origin.originPath)));
  for (const target of targetState.values()) {
    target.status = statusFromCompleteness(target.completeness);
    if (retainedOrigins.has(target.originPath)) target.findingState = "evidence_found";
    else if (target.discovered) target.findingState = "not_evaluated";
  }
  base.affectedFiles = affectedFiles.map((item) => validateCompletedAffectedItem(item));
  return finishMulti(base, targetState);
}

function normalizeSources(sources, sourceByPath) {
  try {
    if (!Array.isArray(sources) || sources.length > CONTEXT_SOURCE_LIMITS.maxFiles) throw invalidImpactTraversal();
    const exactSources = sources.map((source) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) throw invalidImpactTraversal();
      const path = requireExactSnapshotPath(source.path, sourceByPath);
      if (Object.hasOwn(source, "text") && typeof source.text !== "string") throw invalidImpactTraversal();
      return { source, path };
    });
    const textSources = exactSources.filter(({ source }) => Object.hasOwn(source, "text")).map(({ source, path }) => ({ path, text: source.text }));
    const normalizedText = new Map(normalizeContextSources(textSources).map((source) => [source.path, source]));
    const seen = new Set();
    return exactSources.map(({ source, path }) => {
      if (seen.has(path)) throw invalidImpactTraversal();
      seen.add(path);
      const hashes = [];
      if (Object.hasOwn(source, "sha256")) hashes.push(canonicalSourceHash(source.sha256));
      if (Object.hasOwn(source, "hash")) hashes.push(canonicalSourceHash(source.hash));
      if (hashes.length === 2 && hashes[0] !== hashes[1]) throw invalidImpactTraversal();
      const withText = normalizedText.get(path);
      if (withText) {
        if (hashes.some((hash) => hash !== withText.sha256)) throw invalidImpactTraversal();
        return { path, sha256: withText.sha256 };
      }
      if (hashes.length === 0) throw invalidImpactTraversal();
      return { path, sha256: hashes[0] };
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

function validateSnapshotBinding({ graph, snapshot, sourceByPath, sourceFiles }) {
  if (!graph || typeof graph !== "object" || Array.isArray(graph)) return;
  if (graph.snapshotToken !== snapshot.token) throw invalidImpactTraversal();
  if (sourceFiles !== undefined && canonicalJson(normalizeSources(sourceFiles, sourceByPath).map(sourceIdentity)) !== canonicalJson(snapshot.files.map(sourceIdentity))) {
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

function canonicalSourceHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw invalidImpactTraversal();
  return value;
}

function requireExactSnapshotPath(value, sourceByPath) {
  try {
    if (typeof value !== "string" || !sourceByPath.has(value)) throw invalidImpactTraversal();
    if (normalizeImpactPaths([value])[0] !== value) throw invalidImpactTraversal();
    return value;
  } catch (error) {
    if (error?.code === "invalid_impact_traversal") throw error;
    throw invalidImpactTraversal();
  }
}

function classifyProvider(graph, completeness) {
  if (!graph || typeof graph !== "object") {
    addReason(completeness, "provider", "provider_unsupported");
    return { state: "unsupported", provider: null };
  }
  const provider = graph.provider ? normalizeTraversalProvider(graph.provider) : null;
  if (graph.status === "unavailable") {
    addReason(completeness, "provider", "provider_partial");
    return { state: "unavailable", provider };
  }
  if (graph.status === "unsupported" || graph.success === false || !provider) {
    addReason(completeness, "provider", "provider_unsupported");
    return { state: "unsupported", provider };
  }
  if (!["available", "partial"].includes(graph.status)) return { state: "unavailable", provider };
  if (graph.status === "partial" || graph.limited) addReason(completeness, "provider", "provider_partial");
  validateCoverage(graph.coverage);
  for (const uncovered of graph.coverage.uncovered) {
    if (uncovered) addReason(completeness, "provider", "uncovered_language");
  }
  return { state: "evaluated", provider };
}

function normalizeTraversalProvider(provider) {
  try { return normalizeProviderDescriptor(provider); }
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

function normalizeNodes(nodes, sourceByPath) {
  if (!Array.isArray(nodes)) throw invalidImpactTraversal();
  const seen = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof node.id !== "string" || typeof node.file !== "string") throw invalidImpactTraversal();
    const file = requireExactSnapshotPath(node.file, sourceByPath);
    const source = sourceByPath.get(file);
    if (!source) throw invalidImpactTraversal();
    const line = node.line === undefined || node.line === null ? null : positiveInteger(node.line);
    if (line !== null && !isValidSnapshotSourcePosition(source, line, 1)) throw invalidImpactTraversal();
    const normalized = { id: node.id, file, line };
    const current = seen.get(normalized.id);
    if (current && canonicalJson(current) !== canonicalJson(normalized)) throw invalidImpactTraversal();
    if (!current) seen.set(normalized.id, normalized);
  }
  return [...seen.values()].sort(compareNodes);
}

function normalizeEdges(edges, provider, sourceByPath) {
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
      location: normalizeOptionalLocation(edge.location, sourceByPath)
    };
    seen.set(edgeKey(normalized), normalized);
  }
  return [...seen.values()].sort(compareEdges);
}

function capabilityForRelation(relation) {
  return relation === "imports" ? "dependencies" : "references";
}

function normalizeOptionalLocation(location, sourceByPath) {
  if (location === undefined || location === null) return null;
  if (!location || typeof location !== "object" || Array.isArray(location)) throw invalidImpactTraversal();
  const normalized = { path: requireExactSnapshotPath(location.path, sourceByPath), line: positiveInteger(location.line), column: positiveInteger(location.column) };
  const source = sourceByPath.get(normalized.path);
  if (!source || !isValidSnapshotSourcePosition(source, normalized.line, normalized.column)) throw invalidImpactTraversal();
  return normalized;
}

function positiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidImpactTraversal();
  return value;
}

function makeWitness({ edge, graph, provider, sourceByPath, consumer }) {
  const capability = edge.relation === "imports" ? "dependencies" : "references";
  const sourcePath = requireExactSnapshotPath(edge.location?.path ?? consumer.file, sourceByPath);
  const source = sourceByPath.get(sourcePath);
  if (!source) throw invalidImpactTraversal();
  return {
    id: `impact_edge_${contextDigest(JSON.stringify([graph.snapshotToken ?? null, provider.id, provider.version, edge]))}`,
    provider: providerSummary(provider),
    capability,
    relationshipKind: edge.relation,
    source: { path: source.path, hash: source.sha256 },
    location: edge.location,
    trust: provider.kind === "external" ? "untrusted_external_analysis" : "derived_analysis",
    basis: provider.capabilities[capability] === "semantic" ? "semantic" : "structural"
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

function buildIncoming(edges) {
  const incoming = new Map();
  for (const edge of edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }
  for (const list of incoming.values()) list.sort(compareEdges);
  return incoming;
}

function prepareTraversalGraph(graph, provider, sourceByPath) {
  try {
    const nodes = normalizeNodes(graph.nodes, sourceByPath);
    const edges = normalizeEdges(graph.edges, provider, sourceByPath);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges) {
      if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) throw invalidImpactTraversal();
    }
    return { nodes, nodeById, incoming: buildIncoming(edges) };
  } catch (error) {
    if (error?.code === "invalid_impact_traversal") throw error;
    throw invalidImpactTraversal();
  }
}

function traverseOrigin({ originPath, originNodes, nodeById, incoming, graph, provider, sourceByPath, limits, work }) {
  const frontier = [];
  let workLimited = false;
  for (const node of originNodes) {
    if (work.visitedStates >= limits.traversalVisitedStates) {
      workLimited = true;
      continue;
    }
    work.visitedStates += 1;
    frontier.push({ id: node.id, distance: 0 });
  }
  const admittedSeeds = frontier.length;
  const bestNodeDistance = new Map(frontier.map((state) => [state.id, state.distance]));
  const bestObservedInBoundDistance = new Map(bestNodeDistance);
  const bestFile = new Map();
  const overDepthCandidates = new Map();
  let stopTraversal = false;
  let examinedForOrigin = 0;

  while (frontier.length > 0) {
    frontier.sort(compareStates);
    const state = frontier.shift();
    if (state.distance !== bestNodeDistance.get(state.id)) continue;
    const currentNode = nodeById.get(state.id);
    const candidates = incoming.get(state.id) ?? [];
    for (const edge of candidates) {
      if (work.edgeExaminations >= limits.traversalEdgeExaminations) {
        workLimited = true;
        stopTraversal = true;
        break;
      }
      work.edgeExaminations += 1;
      examinedForOrigin += 1;
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
      const witness = makeWitness({ edge, graph, provider, sourceByPath, consumer });
      if (consumer.file !== originPath || nextDistance === 0) retainFile(bestFile, consumer.file, originPath, nextDistance, witness);
      if (known === undefined || nextDistance < known) {
        if (known === undefined && work.visitedStates >= limits.traversalVisitedStates) {
          workLimited = true;
          continue;
        }
        if (known === undefined) work.visitedStates += 1;
        bestNodeDistance.set(consumer.id, nextDistance);
        frontier.push({ id: consumer.id, distance: nextDistance });
      }
    }
    if (stopTraversal) break;
  }

  const depthLimited = [...overDepthCandidates.keys()].some((id) => {
    const best = bestObservedInBoundDistance.get(id);
    return best === undefined || best > limits.depth;
  });
  const hasRelevantIncoming = originNodes.some((node) => (incoming.get(node.id)?.length ?? 0) > 0);
  const unstarted = admittedSeeds === 0 || (examinedForOrigin === 0 && hasRelevantIncoming && work.edgeExaminations >= limits.traversalEdgeExaminations);
  return { bestFile, depthLimited, workLimited, unstarted };
}

function mergeOriginDiscoveries(merged, bestFile) {
  for (const item of bestFile.values()) {
    const origin = item.origins[0];
    const byOrigin = merged.get(item.path) ?? new Map();
    const current = byOrigin.get(origin.originPath);
    if (!current || compareOrigins(origin, current) < 0) byOrigin.set(origin.originPath, origin);
    merged.set(item.path, byOrigin);
  }
}

function buildMergedAffectedFiles(merged, limits, targetState) {
  let originLimited = false;
  const affectedFiles = [];
  for (const [path, byOrigin] of merged) {
    const discovered = [...byOrigin.values()].sort(compareOrigins);
    const origins = discovered.slice(0, limits.originWitnessesPerItem);
    const omitted = discovered.slice(origins.length);
    if (omitted.length > 0) {
      originLimited = true;
      for (const origin of omitted) addReason(targetState.get(origin.originPath).completeness, "output", "origin_limit");
    }
    affectedFiles.push({
      path,
      origins,
      originSummary: {
        discoveredOriginCount: discovered.length,
        retainedOriginWitnessCount: origins.length,
        attributionTruncated: omitted.length > 0,
        reasons: omitted.length > 0 ? ["origin_limit"] : []
      }
    });
  }
  affectedFiles.sort(compareAffectedItems);
  return { affectedFiles, originLimited };
}

function compareOrigins(left, right) {
  return left.minimumDistance - right.minimumDistance
    || compare(left.originPath, right.originPath)
    || compare(left.witness.id, right.witness.id);
}

function finishMulti(base, targetState, terminalStatus = null) {
  const targets = [...targetState.values()].map((target) => ({
    originPath: target.originPath,
    status: normalizeImpactStatus(target.status),
    findingState: normalizeImpactFindingState(target.findingState),
    completeness: normalizeImpactCompleteness(target.completeness)
  }));
  const completeness = cloneCompleteness(base.completeness);
  for (const target of targets) {
    for (const [dimension, reasons] of Object.entries(target.completeness)) {
      for (const reason of reasons) addReason(completeness, dimension, reason);
    }
  }
  const status = terminalStatus === "unsupported" || terminalStatus === "unavailable"
    ? terminalStatus
    : statusFromCompleteness(completeness);
  const findingState = base.affectedFiles.length > 0
    ? "evidence_found"
    : targets.every((target) => target.findingState === "no_evidence_found") ? "no_evidence_found" : "not_evaluated";
  return finish({ ...base, targets, status, findingState, completeness });
}

function cloneCompleteness(completeness) {
  const normalized = normalizeImpactCompleteness(completeness);
  return Object.fromEntries(Object.entries(normalized).map(([dimension, reasons]) => [dimension, [...reasons]]));
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
