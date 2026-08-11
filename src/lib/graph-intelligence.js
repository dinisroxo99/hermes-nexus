export function analyzeImpact(graph, nodeId, options = {}) {
  const depth = clampNumber(options.depth, 2, 0, 5);
  const limit = clampNumber(options.limit, 80, 1, 250);
  const target = findNode(graph, nodeId);

  if (!target) {
    return {
      success: false,
      message: "Nó não encontrado.",
      node: null,
      dependencies: [],
      dependents: [],
      transitiveDependents: [],
      affectedFiles: [],
      impact: { level: "unknown", score: 0, reason: "node_not_found" }
    };
  }

  const outgoing = graph.edges.filter((edge) => edge.from === nodeId).slice(0, limit);
  const incoming = graph.edges.filter((edge) => edge.to === nodeId).slice(0, limit);
  const dependencies = outgoing.map((edge) => edge.to).map((id) => findNode(graph, id)).filter(Boolean);
  const dependents = incoming.map((edge) => edge.from).map((id) => findNode(graph, id)).filter(Boolean);
  const transitive = collectTransitiveDependents(graph, nodeId, depth, limit);
  const affected = uniqueBy([target, ...dependents, ...transitive], (node) => node.file || node.subtitle || node.id)
    .map((node) => node.file || node.subtitle || node.id)
    .filter(Boolean);
  const impactScore = dependents.length + transitive.length + Math.min(affected.length, 20);

  return {
    success: true,
    message: `${target.label}: ${dependencies.length} dependências, ${dependents.length} dependentes diretos, ${transitive.length} dependentes transitivos.`,
    node: target,
    dependencies,
    dependents,
    transitiveDependents: transitive,
    affectedFiles: affected.slice(0, limit),
    impact: {
      level: impactLevel(impactScore),
      score: impactScore,
      directDependencyCount: dependencies.length,
      directDependentCount: dependents.length,
      transitiveDependentCount: transitive.length,
      affectedFileCount: affected.length
    }
  };
}

export function buildContext(graph, options = {}) {
  const depth = clampNumber(options.depth, 1, 0, 3);
  const limit = clampNumber(options.limit, 40, 1, 120);
  const symbol = String(options.symbol || "").trim().toLowerCase();
  const nodeId = options.nodeId;
  const target = nodeId ? findNode(graph, nodeId) : graph.nodes.find((node) => {
    return String(node.label || "").toLowerCase() === symbol
      || String(node.label || "").toLowerCase().includes(symbol)
      || String(node.id || "").toLowerCase() === symbol;
  });

  if (!target) {
    return {
      success: false,
      message: "Símbolo não encontrado.",
      symbol: null
    };
  }

  const impact = analyzeImpact(graph, target.id, { depth, limit });
  const nearbyIds = new Set([
    target.id,
    ...impact.dependencies.map((node) => node.id),
    ...impact.dependents.map((node) => node.id)
  ]);
  const nearbySymbols = graph.nodes
    .filter((node) => node.file && node.file === target.file && node.id !== target.id)
    .slice(0, Math.max(0, limit - nearbyIds.size));

  for (const node of nearbySymbols) {
    nearbyIds.add(node.id);
  }

  return {
    success: true,
    message: `Contexto compacto para ${target.label}.`,
    symbol: pickNode(target),
    dependencies: impact.dependencies.slice(0, limit).map(pickNode),
    dependents: impact.dependents.slice(0, limit).map(pickNode),
    nearbySymbols: nearbySymbols.map(pickNode),
    impact: impact.impact,
    graph: {
      nodes: graph.nodes.filter((node) => nearbyIds.has(node.id)).slice(0, limit).map(pickNode),
      edges: graph.edges.filter((edge) => nearbyIds.has(edge.from) && nearbyIds.has(edge.to)).slice(0, limit)
    }
  };
}

export function buildProjectInsights(graph, options = {}) {
  const limit = clampNumber(options.limit, 20, 1, 100);
  const degreeById = new Map(graph.nodes.map((node) => [node.id, { node, in: 0, out: 0 }]));

  for (const edge of graph.edges) {
    const from = degreeById.get(edge.from);
    const to = degreeById.get(edge.to);
    if (from) from.out += 1;
    if (to) to.in += 1;
  }

  const hubs = Array.from(degreeById.values())
    .map((entry) => ({ ...pickNode(entry.node), dependencyCount: entry.out, dependentCount: entry.in, totalDegree: entry.in + entry.out }))
    .sort((a, b) => b.totalDegree - a.totalDegree)
    .slice(0, limit);

  const modules = countBy(graph.nodes, (node) => node.feature || node.layer || node.file || "unknown")
    .slice(0, limit);
  const orphanSymbols = Array.from(degreeById.values())
    .filter((entry) => entry.in === 0 && entry.out === 0)
    .map((entry) => pickNode(entry.node))
    .slice(0, limit);

  return {
    success: true,
    message: `Insights: ${graph.nodes.length} nós, ${graph.edges.length} arestas.`,
    stats: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      fileCount: new Set(graph.nodes.map((node) => node.file).filter(Boolean)).size,
      featureCount: new Set(graph.nodes.map((node) => node.feature).filter(Boolean)).size
    },
    highlyConnected: hubs,
    potentialCycles: findSimpleCycles(graph, limit),
    orphanSymbols,
    largestModules: modules
  };
}

function collectTransitiveDependents(graph, nodeId, depth, limit) {
  const visited = new Set([nodeId]);
  const result = [];
  let frontier = [nodeId];

  for (let level = 0; level < depth && frontier.length && result.length < limit; level += 1) {
    const next = [];

    for (const currentId of frontier) {
      for (const edge of graph.edges) {
        if (edge.to !== currentId || visited.has(edge.from)) continue;
        visited.add(edge.from);
        next.push(edge.from);
        const node = findNode(graph, edge.from);
        if (node) result.push(node);
        if (result.length >= limit) break;
      }
    }

    frontier = next;
  }

  return result;
}

function findSimpleCycles(graph, limit) {
  const edgeSet = new Set(graph.edges.map((edge) => `${edge.from}->${edge.to}`));
  const cycles = [];

  for (const edge of graph.edges) {
    if (cycles.length >= limit) break;
    if (edgeSet.has(`${edge.to}->${edge.from}`)) {
      const from = findNode(graph, edge.from);
      const to = findNode(graph, edge.to);
      if (from && to) {
        cycles.push({ nodes: [pickNode(from), pickNode(to)], edgeCount: 2 });
      }
    }
  }

  return cycles;
}

function findNode(graph, nodeId) {
  return graph.nodes.find((node) => node.id === nodeId) || null;
}

function pickNode(node) {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    category: node.category,
    layer: node.layer,
    feature: node.feature,
    file: node.file,
    namespace: node.namespace,
    projectName: node.projectName
  };
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function countBy(items, keyFn) {
  const counts = new Map();

  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function impactLevel(score) {
  if (score >= 30) return "high";
  if (score >= 10) return "medium";
  if (score > 0) return "low";
  return "isolated";
}

function clampNumber(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
