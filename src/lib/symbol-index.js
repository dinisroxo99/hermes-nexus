import path from "node:path";
import { getProjectCacheIdentity } from "./project-revision.js";
import { normalizeContextSources } from "./project-context-files.js";
import { inferFeatureFromSymbol, inferLayerFromProjectName } from "./project-structure.js";
import { findFiles, normalizePath, readText, relative } from "../utils/fs-utils.js";

const INDEX_CACHE = new Map();
const CACHE_TTL_MS = Number(process.env.SYMBOL_CACHE_TTL_MS || 10 * 60 * 1000);

function getSymbolIndex(project) {
  const identity = getProjectCacheIdentity(project);
  const key = identity.key;
  const cached = INDEX_CACHE.get(key);
  const now = Date.now();

  if (identity.reusable && cached && now - cached.createdAt < CACHE_TTL_MS) {
    return cached.index;
  }

  for (const [oldKey, entry] of INDEX_CACHE) {
    if (entry.contextKey === identity.contextKey) INDEX_CACHE.delete(oldKey);
  }
  const index = createSymbolIndex(project);

  if (identity.reusable) INDEX_CACHE.set(key, {
    contextKey: identity.contextKey,
    projectName: project.name,
    projectId: project.projectId ?? null,
    createdAt: now,
    index
  });

  return index;
}

export function getSymbolIndexCacheStats() {
  const now = Date.now();

  return {
    ttlMs: CACHE_TTL_MS,
    size: INDEX_CACHE.size,
    entries: Array.from(INDEX_CACHE.entries()).map(([key, value]) => ({
      key,
      project: value.projectName,
      projectId: value.projectId,
      ageMs: now - value.createdAt,
      expiresInMs: Math.max(0, CACHE_TTL_MS - (now - value.createdAt)),
      expired: now - value.createdAt >= CACHE_TTL_MS,
      symbolCount: value.index.symbols.length,
      edgeCount: Array.from(value.index.outgoingById.values()).reduce((sum, edges) => sum + edges.length, 0)
    }))
  };
}

export function clearSymbolIndexCache(projectName = null) {
  let removed = 0;

  for (const [key, entry] of Array.from(INDEX_CACHE.entries())) {
    if (!projectName || entry.projectName === projectName) {
      INDEX_CACHE.delete(key);
      removed += 1;
    }
  }

  return {
    removed,
    remaining: INDEX_CACHE.size
  };
}

export function searchSymbolExplorer(project, query) {
  const index = getSymbolIndex(project);
  const q = query.trim().toLowerCase();

  if (!q) {
    return {
      nodes: [],
      edges: [],
      message: "Escreve um símbolo para pesquisar. Ex: InvoiceCreationService"
    };
  }

  const exact = index.symbols.filter((s) => s.name.toLowerCase() === q);
  const starts = index.symbols.filter((s) => s.name.toLowerCase().startsWith(q));
  const contains = index.symbols.filter((s) => s.name.toLowerCase().includes(q));

  const seeds = uniqueSymbols([
    ...exact,
    ...starts,
    ...contains
  ]).slice(0, 12);

  return {
    nodes: seeds.map(toGraphNode),
    edges: [],
    message: seeds.length
      ? "Clica num nó para ver detalhes. Duplo clique para expandir."
      : `Não encontrei símbolos com "${query}".`
  };
}

export function expandSymbolExplorer(project, nodeId, direction = "both") {
  const index = getSymbolIndex(project);
  const target = index.byId.get(nodeId);

  if (!target) {
    return {
      nodes: [],
      edges: [],
      message: "Nó não encontrado."
    };
  }

  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();

  function addNode(symbol) {
    if (!symbol || nodeIds.has(symbol.id)) return;

    nodeIds.add(symbol.id);
    nodes.push(toGraphNode(symbol));
  }

  function addEdge(edge) {
    if (!edge || edgeIds.has(edge.id)) return;

    edgeIds.add(edge.id);
    edges.push(edge);
  }

  addNode(target);

  if (direction === "both" || direction === "out") {
    const outgoing = index.outgoingById.get(nodeId) || [];

    for (const edge of outgoing.slice(0, 14)) {
      const dep = index.byId.get(edge.to);

      addNode(dep);
      addEdge(edge);
    }
  }

  if (direction === "both" || direction === "in") {
    const incoming = index.incomingById.get(nodeId) || [];

    for (const edge of incoming.slice(0, 22)) {
      const source = index.byId.get(edge.from);

      addNode(source);
      addEdge(edge);
    }
  }

  return {
    nodes,
    edges,
    message: `${target.name} expandido.`
  };
}

function createSymbolIndex(project, sourceFiles) {
  const snapshot = sourceFiles === undefined ? null : normalizeContextSources(sourceFiles);
  const files = snapshot ? snapshot.filter((file) => file.path.toLowerCase().endsWith(".cs")).map((file) => path.join(project.absolutePath, file.path)) : findFiles(project.absolutePath, ".cs");
  const csprojs = snapshot ? snapshot.filter((file) => file.path.toLowerCase().endsWith(".csproj")).map((file) => path.join(project.absolutePath, file.path)) : findFiles(project.absolutePath, ".csproj");

  const projectDirs = csprojs
    .map((file) => ({
      dir: path.dirname(file),
      name: path.basename(file, ".csproj")
    }))
    .sort((a, b) => b.dir.length - a.dir.length);

  const symbols = [];

  for (const file of files) {
    const content = snapshot ? snapshot.find((source) => path.join(project.absolutePath, source.path) === file).text : readText(file);
    const namespace = extractNamespace(content);
    const projectName = findNearestProjectName(file, projectDirs);

    const regex = /\b(public|internal|private|protected)?\s*(sealed|abstract|partial|static)?\s*(class|interface|record|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

    let match;

    while ((match = regex.exec(content)) !== null) {
      const kind = match[3];
      const name = match[4];
      const relativeFile = relative(project.absolutePath, file);
      const layer = inferLayerFromProjectName(projectName);
      const feature = inferFeatureFromSymbol({
        projectName,
        layer,
        relativeFile,
        namespace,
        name
      });

      symbols.push({
        id: `${normalizePath(file)}#${name}`,
        name,
        kind,
        namespace,
        projectName,
        layer,
        feature,
        file,
        relativeFile,
        content
      });
    }
  }

  const byId = new Map();
  const byName = new Map();

  for (const symbol of symbols) {
    byId.set(symbol.id, symbol);

    if (!byName.has(symbol.name)) {
      byName.set(symbol.name, []);
    }

    byName.get(symbol.name).push(symbol);
  }

  const outgoingById = new Map();
  const incomingById = new Map();

  for (const symbol of symbols) {
    outgoingById.set(symbol.id, []);
    incomingById.set(symbol.id, []);
  }

  buildDependencyMaps({
    symbols,
    byName,
    outgoingById,
    incomingById
  });

  return {
    symbols,
    byId,
    byName,
    outgoingById,
    incomingById
  };
}

function buildDependencyMaps(index) {
  const edgeKeys = new Set();

  for (const source of index.symbols) {
    const directDependencies = extractLikelyDependencies(source);

    for (const depName of directDependencies) {
      const targets = index.byName.get(depName) || [];

      for (const target of targets) {
        if (target.id === source.id) continue;

        addMappedEdge({
          source,
          target,
          relation: "uses",
          label: "usa",
          outgoingById: index.outgoingById,
          incomingById: index.incomingById,
          edgeKeys
        });
      }
    }
  }

  for (const source of index.symbols) {
    const identifiers = extractIdentifiers(source.content);

    for (const identifier of identifiers) {
      const targets = index.byName.get(identifier) || [];

      for (const target of targets) {
        if (target.id === source.id) continue;

        addMappedEdge({
          source,
          target,
          relation: "references",
          label: "referencia",
          outgoingById: index.outgoingById,
          incomingById: index.incomingById,
          edgeKeys
        });
      }
    }
  }

  for (const [id, edges] of index.incomingById.entries()) {
    index.incomingById.set(id, sortEdges(edges));
  }

  for (const [id, edges] of index.outgoingById.entries()) {
    index.outgoingById.set(id, sortEdges(edges));
  }
}

function addMappedEdge(options) {
  const {
    source,
    target,
    relation,
    label,
    outgoingById,
    incomingById,
    edgeKeys
  } = options;

  const edgeId = `${source.id}->${target.id}->${relation}`;

  if (edgeKeys.has(edgeId)) {
    return;
  }

  edgeKeys.add(edgeId);

  const edge = {
    id: edgeId,
    from: source.id,
    to: target.id,
    label,
    relation
  };

  outgoingById.get(source.id).push(edge);
  incomingById.get(target.id).push(edge);
}

function extractIdentifiers(content) {
  const ignored = new Set([
    "public",
    "private",
    "protected",
    "internal",
    "class",
    "interface",
    "record",
    "struct",
    "enum",
    "namespace",
    "using",
    "return",
    "new",
    "await",
    "async",
    "var",
    "this",
    "base",
    "null",
    "true",
    "false",
    "string",
    "int",
    "long",
    "decimal",
    "double",
    "float",
    "bool",
    "void",
    "object",
    "Task",
    "List",
    "IEnumerable",
    "Dictionary",
    "DateTime",
    "Guid",
    "CancellationToken"
  ]);

  const identifiers = new Set();
  const regex = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;

  let match;

  while ((match = regex.exec(content)) !== null) {
    const value = match[0];

    if (ignored.has(value)) continue;
    if (value.length < 3) continue;

    identifiers.add(value);
  }

  return identifiers;
}

function sortEdges(edges) {
  return [...edges].sort((a, b) => {
    const aScore = scoreEdge(a);
    const bScore = scoreEdge(b);

    return aScore - bScore;
  });
}

function scoreEdge(edge) {
  let score = 0;

  if (edge.relation === "uses") score -= 10;
  if (edge.relation === "references") score -= 3;

  if (edge.from.includes("Controller")) score -= 6;
  if (edge.from.includes("Service")) score -= 5;
  if (edge.from.includes("Handler")) score -= 4;
  if (edge.from.includes("Repository")) score -= 3;

  if (edge.from.includes(".Tests")) score += 20;
  if (edge.to.includes(".Tests")) score += 20;

  return score;
}

function toGraphNode(symbol) {
  const category = classifySymbol(symbol);

  return {
    id: symbol.id,
    label: symbol.name,
    kind: symbol.kind,
    category,
    namespace: symbol.namespace,
    projectName: symbol.projectName,
    layer: symbol.layer,
    feature: symbol.feature,
    file: symbol.relativeFile,
    subtitle: symbol.relativeFile
  };
}

function classifySymbol(symbol) {
  const name = symbol.name || "";
  const ns = symbol.namespace || "";
  const project = symbol.projectName || "";

  if (name.endsWith("Controller") || ns.includes(".Controllers")) return "controller";
  if (symbol.kind === "interface") return "interface";
  if (symbol.kind === "enum") return "enum";

  if (
    name.endsWith("Service") ||
    name.endsWith("Handler") ||
    name.endsWith("Validator") ||
    ns.includes(".Services") ||
    ns.includes(".Handlers") ||
    ns.includes(".Validators")
  ) {
    return "service";
  }

  if (
    name.endsWith("Repository") ||
    ns.includes(".Repositories")
  ) {
    return "repository";
  }

  if (
    name.endsWith("DbContext") ||
    ns.includes(".Persistence") ||
    ns.includes(".Database")
  ) {
    return "database";
  }

  if (
    name.endsWith("Dto") ||
    name.endsWith("Request") ||
    name.endsWith("Response") ||
    ns.includes(".Contracts") ||
    ns.includes(".Dtos")
  ) {
    return "contract";
  }

  if (
    ns.includes(".Entities") ||
    ns.includes(".Domain") ||
    project.includes("Domain")
  ) {
    return "domain";
  }

  if (
    ns.includes(".Infrastructure") ||
    project.includes("Infrastructure")
  ) {
    return "infrastructure";
  }

  if (
    ns.includes(".Middleware") ||
    name.endsWith("Middleware")
  ) {
    return "middleware";
  }

  if (
    ns.includes(".Extensions") ||
    name.endsWith("Extensions")
  ) {
    return "extension";
  }

  if (project.includes("Application")) return "application";
  if (project.includes("API") || project.includes("Api")) return "api";

  return "unknown";
}

function extractLikelyDependencies(symbol) {
  const deps = new Set();

  const constructorRegex = new RegExp(`${escapeRegex(symbol.name)}\\s*\\(([^)]*)\\)`, "g");
  let constructorMatch;

  while ((constructorMatch = constructorRegex.exec(symbol.content)) !== null) {
    const params = constructorMatch[1].split(",");

    for (const param of params) {
      const type = cleanType(param.trim().split(/\s+/)[0]);

      if (isUsefulType(type)) {
        deps.add(type);
      }
    }
  }

  const fieldRegex = /\b(private|protected|internal|public)\s+readonly\s+([A-Za-z_][A-Za-z0-9_<>,.?]*)\s+[A-Za-z_][A-Za-z0-9_]*/g;
  let fieldMatch;

  while ((fieldMatch = fieldRegex.exec(symbol.content)) !== null) {
    const type = cleanType(fieldMatch[2]);

    if (isUsefulType(type)) {
      deps.add(type);
    }
  }

  const newRegex = /\bnew\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let newMatch;

  while ((newMatch = newRegex.exec(symbol.content)) !== null) {
    const type = cleanType(newMatch[1]);

    if (isUsefulType(type)) {
      deps.add(type);
    }
  }

  return [...deps];
}

function isUsefulType(type) {
  if (!type) return false;

  const ignored = new Set([
    "string",
    "int",
    "long",
    "decimal",
    "double",
    "float",
    "bool",
    "DateTime",
    "DateOnly",
    "Guid",
    "Task",
    "IEnumerable",
    "ICollection",
    "List",
    "Dictionary",
    "CancellationToken",
    "object",
    "void"
  ]);

  return !ignored.has(type);
}

function cleanType(type) {
  return String(type || "")
    .replace(/[?<>,()[\]]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .pop();
}

function referencesSymbol(content, symbolName) {
  const regex = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
  return regex.test(content);
}

function scoreIncoming(candidate, target) {
  let score = 0;

  if (candidate.projectName === target.projectName) score -= 8;
  if (candidate.name.endsWith("Controller")) score -= 10;
  if (candidate.name.endsWith("Service")) score -= 8;
  if (candidate.name.endsWith("Handler")) score -= 6;
  if (candidate.name.endsWith("Repository")) score -= 4;
  if (candidate.namespace?.includes(".Tests")) score += 20;

  return score;
}

function extractNamespace(content) {
  const fileScoped = content.match(/\bnamespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/);
  if (fileScoped) return fileScoped[1];

  const blockScoped = content.match(/\bnamespace\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{/);
  if (blockScoped) return blockScoped[1];

  return "";
}

function findNearestProjectName(file, projectDirs) {
  for (const project of projectDirs) {
    if (file.startsWith(project.dir)) {
      return project.name;
    }
  }

  return "unknown";
}

function uniqueSymbols(symbols) {
  const seen = new Set();
  const result = [];

  for (const symbol of symbols) {
    if (seen.has(symbol.id)) continue;

    seen.add(symbol.id);
    result.push(symbol);
  }

  return result;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CATEGORY_PRIORITY = {
  controller: 0,
  api: 0,
  service: 1,
  handler: 1,
  application: 1,
  interface: 2,
  domain: 3,
  repository: 4,
  database: 4,
  infrastructure: 4,
  contract: 5,
  enum: 5,
  middleware: 6,
  extension: 6,
  unknown: 7
};

export function getFullGraphExplorer(project, options = {}) {
  const {
    nodeLimit = 500,
    edgeLimit = 1200,
    layers = [],
    features = []
  } = options;

  const index = options.sourceFiles === undefined ? getSymbolIndex(project) : createSymbolIndex(project, options.sourceFiles);
  const layerFilter = new Set(layers.filter(Boolean));
  const featureFilter = new Set(features.filter(Boolean));
  const allowedSymbols = index.symbols.filter((symbol) => {
    if (layerFilter.size && !layerFilter.has(symbol.layer)) return false;
    if (featureFilter.size && !featureFilter.has(symbol.feature)) return false;
    return true;
  });
  const allowedNodeIds = new Set(allowedSymbols.map((symbol) => symbol.id));

  const allNodes = allowedSymbols.map(toGraphNode);

  allNodes.sort((a, b) => {
    const aPriority = CATEGORY_PRIORITY[a.category] ?? 99;
    const bPriority = CATEGORY_PRIORITY[b.category] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.label.localeCompare(b.label);
  });

  const allEdges = [];
  const edgeKeys = new Set();

  for (const symbol of allowedSymbols) {
    const outgoing = index.outgoingById.get(symbol.id) || [];

    for (const edge of outgoing) {
      if (!index.byId.has(edge.to)) continue;
      if (!allowedNodeIds.has(edge.to)) continue;
      if (edgeKeys.has(edge.id)) continue;

      edgeKeys.add(edge.id);
      allEdges.push(edge);
    }
  }

  allEdges.sort((a, b) => {
    const aScore = scoreEdge(a);
    const bScore = scoreEdge(b);
    return aScore - bScore;
  });

  const includedNodeIds = new Set();
  const selectedEdges = [];

  for (const edge of allEdges) {
    if (selectedEdges.length >= edgeLimit) break;

    const neededNodes = [];

    if (!includedNodeIds.has(edge.from)) neededNodes.push(edge.from);
    if (!includedNodeIds.has(edge.to)) neededNodes.push(edge.to);

    if (includedNodeIds.size + neededNodes.length > nodeLimit) {
      continue;
    }

    for (const nodeId of neededNodes) {
      includedNodeIds.add(nodeId);
    }

    selectedEdges.push(edge);
  }

  // Fill remaining capacity with high-priority nodes, even if they have no selected edges.
  for (const node of allNodes) {
    if (includedNodeIds.size >= nodeLimit) break;
    includedNodeIds.add(node.id);
  }

  const includedNodes = allNodes.filter((node) => includedNodeIds.has(node.id));
  const selectedNodeIds = new Set(includedNodes.map((node) => node.id));
  const limitedEdges = selectedEdges.filter((edge) => {
    return selectedNodeIds.has(edge.from) && selectedNodeIds.has(edge.to);
  });

  const limited = includedNodes.length < allNodes.length || limitedEdges.length < allEdges.length;

  return {
    nodes: includedNodes,
    edges: limitedEdges,
    limited,
    originalNodeCount: allNodes.length,
    originalEdgeCount: allEdges.length,
    message: limited
      ? `Grafo limitado a ${includedNodes.length} nós e ${limitedEdges.length} arestas (original: ${allNodes.length} nós, ${allEdges.length} arestas). Aumente os limites se necessário.`
      : `Grafo completo: ${includedNodes.length} nós, ${limitedEdges.length} arestas.`
  };
}