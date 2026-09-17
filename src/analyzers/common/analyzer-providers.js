import { getAnalyzer, listAnalyzerProviders } from "./analyzer-registry.js";
import { ANALYZER_OPERATIONS, PROVIDER_LIMITS, createProviderSnapshot, providerError } from "./analyzer-provider-contract.js";
import { contextDigest, compareContextStrings as compare } from "../../lib/project-context-files.js";
import { readExternalSnapshotResponse } from "../external/snapshot-provider.js";

function nativeEvidence(provider, snapshot, limits) {
  const projectType = provider.id === "native.dotnet" ? "dotnet" : "typescript";
  const analyzer = getAnalyzer(projectType);
  if (!analyzer) return null;
  const project = { name: "snapshot", absolutePath: "/__project_context__" };
  const opts = { ...limits, sourceFiles: snapshot.files };
  const raw = analyzer.fullGraph ? analyzer.fullGraph(project, opts) : analyzer.analyze(project, opts);
  if (raw.success === false) return null;
  const files = new Set(snapshot.files.map((file) => file.path));
  const counts = new Map();
  for (const node of raw.nodes || []) counts.set(node.id, (counts.get(node.id) || 0) + 1);
  const ids = new Map();
  const nodes = (raw.nodes || []).filter((node) => typeof node?.id === "string" && node.id.length <= 4096 && counts.get(node.id) === 1
    && files.has(node.file) && typeof node.label === "string" && node.label.length <= 128 && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(node.label))
    .map((node) => {
      const id = `symbol_${contextDigest(JSON.stringify([snapshot.projectId, provider.id, node.id]))}`;
      ids.set(node.id, id);
      return { id, label: node.label, file: node.file, kind: ["class", "function", "hook", "interface", "type", "record", "struct", "enum", "component"].includes(node.kind) ? node.kind : "symbol", line: null };
    }).sort((a, b) => compare(a.file, b.file) || compare(a.id, b.id));
  const edges = (raw.edges || []).filter((edge) => ids.has(edge.from) && ids.has(edge.to)).map((edge) => ({ from: ids.get(edge.from), to: ids.get(edge.to), relation: ["uses", "imports", "references"].includes(edge.relation) ? edge.relation : "references" }))
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  return { projectType, nodes, edges, definitions: [], implementations: [], diagnostics: [],
    limited: Boolean(raw.limited || raw.metadata?.totalSymbols > limits.nodeLimit || raw.metadata?.totalEdges > limits.edgeLimit || nodes.length < (raw.nodes || []).length) };
}

export function analyzeProviderSnapshot(project, sourceFiles, options = {}) {
  const snapshot = createProviderSnapshot(project, sourceFiles, options.revision);
  const providers = listAnalyzerProviders(options.externalProviders);
  const required = options.requiredCapabilities ?? ["symbols"];
  const minimumLevel = options.minimumLevel ?? "structural";
  const requiredLanguages = options.requiredLanguages ?? [];
  if (!Array.isArray(requiredLanguages) || requiredLanguages.length > 32 || requiredLanguages.some((language) => typeof language !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(language))) throw providerError("invalid_analyzer_request");
  if (!Array.isArray(required) || required.length > ANALYZER_OPERATIONS.length || required.some((operation) => !ANALYZER_OPERATIONS.includes(operation))
    || !["structural", "semantic"].includes(minimumLevel)) throw providerError("invalid_analyzer_request");
  const bound = (value, max) => Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : max;
  const limits = { nodeLimit: bound(options.nodeLimit, PROVIDER_LIMITS.nodes), edgeLimit: bound(options.edgeLimit, PROVIDER_LIMITS.edges) };
  const attempts = [];
  for (const provider of providers) {
    if (!provider.languages.some((language) => snapshot.languages.includes(language))) continue;
    if (requiredLanguages.some((language) => !provider.languages.includes(language) || !snapshot.languages.includes(language))) continue;
    if (provider.capabilities.boundedSourceAnalysis === "unsupported" || required.some((operation) => provider.capabilities[operation] === "unsupported" || (minimumLevel === "semantic" && provider.capabilities[operation] !== "semantic"))) {
      attempts.push({ providerId: provider.id, status: "unsupported" }); continue;
    }
    let evidence;
    try {
      evidence = provider.kind === "native" ? nativeEvidence(provider, snapshot, limits)
        : options.externalResponses?.[provider.id] === undefined ? null : readExternalSnapshotResponse(snapshot, provider, options.externalResponses[provider.id], limits);
    }
    catch { attempts.push({ providerId: provider.id, status: "invalid" }); continue; }
    if (!evidence) { attempts.push({ providerId: provider.id, status: "unavailable" }); continue; }
    if (["unavailable", "unsupported"].includes(evidence.status)) { attempts.push({ providerId: provider.id, status: evidence.status }); continue; }
    const uncovered = snapshot.languages.filter((language) => !provider.languages.includes(language));
    const status = evidence.limited || uncovered.length ? "partial" : "available";
    attempts.push({ providerId: provider.id, status });
    return { schemaVersion: 1, success: true, status, provider, snapshotToken: snapshot.token,
      coverage: { observed: snapshot.languages, covered: snapshot.languages.filter((language) => provider.languages.includes(language)), uncovered }, attempts, ...evidence };
  }
  return { schemaVersion: 1, success: false, status: attempts.some((attempt) => ["invalid", "unavailable"].includes(attempt.status)) ? "unavailable" : "unsupported",
    provider: null, snapshotToken: snapshot.token, projectType: "unknown", coverage: { observed: snapshot.languages, covered: [], uncovered: snapshot.languages },
    attempts, nodes: [], edges: [], definitions: [], implementations: [], diagnostics: [], limited: false };
}
