import { assertProviderFields, normalizeProviderDescriptor, PROVIDER_LIMITS, providerError, detectSnapshotLanguages, isAnalyzerSymbolLabel, isValidSnapshotSourcePosition } from "../common/analyzer-provider-contract.js";
import { contextDigest, compareContextStrings as compare } from "../../lib/project-context-files.js";

const invalid = () => providerError("invalid_external_evidence");
const fields = (value, keys) => assertProviderFields(value, keys, "invalid_external_evidence");
const key = (value) => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value);
const sortRecords = (rows) => rows.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));

// Data-only adapter: no process, network, filesystem or arbitrary provider code.
export function createExternalSnapshotRequest(snapshot, inputProvider) {
  const provider = normalizeProviderDescriptor(inputProvider);
  if (!snapshot.projectId || provider.kind !== "external") throw invalid();
  const files = snapshot.files.filter((file) => detectSnapshotLanguages([file]).some((language) => provider.languages.includes(language)));
  return { schemaVersion: 1, projectId: snapshot.projectId, snapshotToken: snapshot.token,
    requestToken: contextDigest(JSON.stringify([snapshot.token, provider])), providerId: provider.id, providerVersion: provider.version,
    observedSourceToken: contextDigest(JSON.stringify(files.map(({ path, sha256 }) => [path, sha256]))),
    revision: snapshot.revision, operations: Object.keys(provider.capabilities).filter((operation) => provider.capabilities[operation] !== "unsupported"),
    limits: PROVIDER_LIMITS, files: files.map(({ path, text, sha256 }) => ({ path, text, sha256 })) };
}

export function readExternalSnapshotResponse(snapshot, inputProvider, response, limits = {}) {
  const provider = normalizeProviderDescriptor(inputProvider);
  const request = createExternalSnapshotRequest(snapshot, provider);
  if (typeof response !== "string" || Buffer.byteLength(response) > PROVIDER_LIMITS.responseBytes) throw invalid();
  let raw;
  try { raw = JSON.parse(response); } catch { throw invalid(); }
  fields(raw, ["schemaVersion", "projectId", "snapshotToken", "requestToken", "providerId", "providerVersion", "observedSourceToken", "status", "nodes", "edges", "definitions", "implementations", "diagnostics"]);
  if ((limits.requireObservedSource || Object.hasOwn(raw, "observedSourceToken")) && raw.observedSourceToken !== request.observedSourceToken) throw invalid();
  if (raw.schemaVersion !== 1 || raw.projectId !== request.projectId || raw.snapshotToken !== request.snapshotToken
    || raw.requestToken !== request.requestToken || raw.providerId !== request.providerId || raw.providerVersion !== request.providerVersion
    || !["available", "partial", "unavailable", "unsupported"].includes(raw.status)) throw invalid();
  if (["unavailable", "unsupported"].includes(raw.status)) return { status: raw.status };
  for (const [name, max] of [["nodes", PROVIDER_LIMITS.nodes], ["edges", PROVIDER_LIMITS.edges], ["definitions", PROVIDER_LIMITS.locations], ["implementations", PROVIDER_LIMITS.locations], ["diagnostics", PROVIDER_LIMITS.diagnostics]]) {
    if (!Array.isArray(raw[name]) || raw[name].length > max) throw invalid();
  }
  const files = new Map(request.files.map((file) => [file.path, file]));
  const supports = (operation, rows) => { if (rows.length && provider.capabilities[operation] === "unsupported") throw invalid(); };
  supports("symbols", raw.nodes); supports("definitions", raw.definitions); supports("implementations", raw.implementations); supports("diagnostics", raw.diagnostics);
  const location = (value) => {
    fields(value, ["path", "line", "column"]);
    if (!files.has(value.path) || !isValidSnapshotSourcePosition(files.get(value.path), value.line, value.column)) throw invalid();
    return { path: value.path, line: value.line, column: value.column };
  };
  const ids = new Map();
  const nodes = raw.nodes.map((node) => {
    fields(node, ["id", "label", "file", "kind", "line"]);
    if (!key(node.id) || ids.has(node.id) || !files.has(node.file) || !isAnalyzerSymbolLabel(node.label)) throw invalid();
    if (node.line != null) location({ path: node.file, line: node.line, column: 1 });
    const id = `symbol_${contextDigest(JSON.stringify([snapshot.projectId, provider.id, node.id]))}`;
    ids.set(node.id, id);
    return { id, label: node.label, file: node.file, kind: ["class", "function", "hook", "interface", "type", "record", "struct", "enum", "component"].includes(node.kind) ? node.kind : "symbol", line: node.line ?? null };
  }).sort((a, b) => compare(a.file, b.file) || compare(a.id, b.id));
  const edges = sortRecords(raw.edges.map((edge) => {
    fields(edge, ["from", "to", "relation", "location"]);
    if (!ids.has(edge.from) || !ids.has(edge.to) || !["uses", "imports", "references"].includes(edge.relation)) throw invalid();
    supports(edge.relation === "imports" ? "dependencies" : "references", [edge]);
    return { from: ids.get(edge.from), to: ids.get(edge.to), relation: edge.relation, ...(edge.location ? { location: location(edge.location) } : {}) };
  }));
  const locations = (rows) => sortRecords(rows.map((row) => {
    fields(row, ["symbolId", "target"]);
    if (!ids.has(row.symbolId)) throw invalid();
    return { symbolId: ids.get(row.symbolId), target: location(row.target) };
  }));
  const definitions = locations(raw.definitions); const implementations = locations(raw.implementations);
  const diagnostics = sortRecords(raw.diagnostics.map((row) => {
    fields(row, ["code", "severity", "location"]);
    if (!key(row.code) || !["error", "warning", "information", "hint"].includes(row.severity)) throw invalid();
    return { code: row.code, severity: row.severity, ...(row.location ? { location: location(row.location) } : {}) };
  }));
  const bound = (value, max) => Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : max;
  const selected = nodes.slice(0, bound(limits.nodeLimit, PROVIDER_LIMITS.nodes));
  const retained = new Set(selected.map((node) => node.id));
  const selectedEdges = edges.filter((edge) => retained.has(edge.from) && retained.has(edge.to)).slice(0, bound(limits.edgeLimit, PROVIDER_LIMITS.edges));
  return { projectType: "external", nodes: selected, edges: selectedEdges, definitions: definitions.filter((row) => retained.has(row.symbolId)), implementations: implementations.filter((row) => retained.has(row.symbolId)), diagnostics,
    limited: raw.status === "partial" || selected.length < nodes.length || selectedEdges.length < edges.length };
}
