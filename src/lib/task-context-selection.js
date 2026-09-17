import path from "node:path";
import { normalizeContextSources, compareContextStrings as compare, contextDigest, isContextPathAllowed } from "./project-context-files.js";
import { matchWorkspaceScopes } from "./workspace-scope.js";
import { boundedContextText as text, contextError } from "./task-context-policy.js";

const within = (file, directory) => directory === "." || file === directory || file.startsWith(`${directory}/`);
const isTest = (file) => /\.(?:tsx?|jsx?|cs|py|go|rs|java)$/i.test(file) && /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.|Tests?\.cs$|(?:^|\/)test_|_test\.go$/i.test(file);
const stem = (file) => path.posix.basename(file).replace(/\.[^.]+$/, "").replace(/(?:\.(?:test|spec)|_test|Tests?)$/i, "").replace(/^test_/i, "").toLowerCase();

export function selectTaskContext(request, { sourceFiles, graph = { nodes: [], edges: [] }, icm = {} }) {
  const files = normalizeContextSources(sourceFiles);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const { task, limits, projectId } = request;
  if (!graph || !icm || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 2000 || graph.edges.length > 4000) throw contextError("invalid_context_analysis");
  for (const [key, max] of [["workspaces", 500], ["documents", 1000], ["errors", 1000], ["warnings", 1000]]) {
    if (icm[key] !== undefined && (!Array.isArray(icm[key]) || icm[key].length > max)) throw contextError("invalid_context_analysis");
  }
  const selectionIssues = [];
  const uniqueRecords = (records, key, maxLength, code) => {
    const counts = new Map();
    for (const record of records) {
      const value = record?.[key];
      if (typeof value === "string" && value.length <= maxLength) counts.set(value, (counts.get(value) || 0) + 1);
    }
    if ([...counts.values()].some((count) => count > 1)) selectionIssues.push({ code });
    return records.filter((record) => counts.get(record?.[key]) === 1);
  };
  const workspaces = uniqueRecords(icm.workspaces || [], "id", 128, "ambiguous_context_workspace");
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const documents = uniqueRecords(icm.documents || [], "path", 1024, "ambiguous_context_document");
  const terms = [...new Set(`${task.title} ${task.description}`.toLowerCase().match(/[a-z0-9_]{3,}/g) || [])]
    .filter((term) => !["the", "and", "for", "with", "add", "update", "fix", "task"].includes(term)).slice(0, 32);
  const lexical = (value) => terms.some((term) => String(value).toLowerCase().includes(term));
  const explicit = (file) => task.paths.some((target) => within(file, target));
  const targets = new Set(files.filter((file) => explicit(file.path)).map((file) => file.path));
  const source = (file, trust, reason) => ({ trust, reason, source: { path: file.path, sha256: file.sha256 } });
  const section = (name, items, trust, producer) => ({
    items: items.slice(0, limits[name]), limit: limits[name], truncated: items.length > limits[name],
    status: items.length ? "available" : "empty",
    provenance: { projectId, revisionRef: "revision", trust, producer }
  });
  const excerpt = (file) => {
    if (!request.includeExcerpts) return {};
    const lines = file.text.split(/\r?\n/);
    const value = text(lines.slice(0, 12).join("\n"));
    return { excerpt: { text: value, startLine: 1, endLine: Math.min(12, value.split("\n").length), truncated: lines.length > 12 || Buffer.byteLength(value) < Buffer.byteLength(file.text) } };
  };
  const nodeCounts = new Map();
  for (const node of graph.nodes) nodeCounts.set(node?.id, (nodeCounts.get(node?.id) || 0) + 1);
  const nodes = graph.nodes.filter((node) => typeof node?.id === "string" && node.id.length <= 4096 && nodeCounts.get(node.id) === 1
    && byPath.has(node.file) && typeof node.label === "string" && node.label.length <= 128 && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(node.label))
    .map((node) => ({ rawId: node.id, id: `symbol_${contextDigest(JSON.stringify([projectId, node.id]))}`,
      name: node.label, kind: ["class", "function", "hook", "interface", "type", "record", "struct", "enum", "component"].includes(node.kind) ? node.kind : "symbol", path: node.file }));
  const byId = new Map(nodes.map((node) => [node.rawId, node]));
  const seeds = new Set(nodes.filter((node) => explicit(node.path) || task.symbols.includes(node.name)
    || (!task.paths.length && !task.symbols.length && lexical(node.name))).map((node) => node.rawId));
  const relevant = new Set(seeds);
  const referenceMap = new Map();
  for (const edge of graph.edges) {
    if (!byId.has(edge?.from) || !byId.has(edge?.to) || (!seeds.has(edge.from) && !seeds.has(edge.to))) continue;
    relevant.add(edge.from); relevant.add(edge.to);
    const from = byId.get(edge.from); const to = byId.get(edge.to);
    const relation = ["uses", "imports", "references"].includes(edge.relation) ? edge.relation : "references";
    const key = JSON.stringify([from.id, to.id, relation]);
    referenceMap.set(key, { from: { id: from.id, name: from.name, path: from.path }, to: { id: to.id, name: to.name, path: to.path }, relation,
      provenance: source(byPath.get(from.path), "derived_analysis", "direct_reference") });
  }
  const selectedNodes = nodes.filter((node) => relevant.has(node.rawId)).sort((a, b) => Number(!seeds.has(a.rawId)) - Number(!seeds.has(b.rawId)) || compare(a.path, b.path) || compare(a.name, b.name) || compare(a.id, b.id));
  for (const node of selectedNodes) targets.add(node.path);
  if (!task.paths.length && !task.symbols.length) {
    for (const file of files) if (lexical(path.posix.basename(file.path))) targets.add(file.path);
  }
  const fileItems = files.filter((file) => targets.has(file.path)).map((file) => ({ path: file.path, byteSize: file.byteSize, ...excerpt(file),
    provenance: source(file, request.includeExcerpts ? "untrusted_repository_text" : "canonical_fact", explicit(file.path) ? "task_path" : "related_symbol_or_name") }));
  const testItems = files.filter((file) => isTest(file.path) && (targets.has(file.path) || [...targets].some((target) => stem(target) === stem(file.path))))
    .map((file) => ({ path: file.path, confidence: "heuristic", provenance: source(file, "derived_analysis", targets.has(file.path) ? "task_path_or_reference" : "basename_convention") }));
  const matched = matchWorkspaceScopes(workspaces, task.paths, { maxMatches: 500, maxReasonsPerWorkspace: 1 });
  const workspaceItems = matched.matches.filter((match) => byPath.has(match.manifestPath)).map((match) => ({
    id: match.workspaceId, path: match.manifestPath, workspacePath: match.workspacePath,
    matchedPaths: match.matchedPaths.slice(0, 8), truncated: match.matchedPaths.length > 8,
    provenance: source(byPath.get(match.manifestPath), "derived_analysis", "workspace_scope_match")
  }));
  const constraintItems = workspaceItems.map((match) => {
    const workspace = workspaceById.get(match.id);
    const declaredPermissions = Object.fromEntries(["read", "write", "executeCommands", "createAgents"].filter((key) => typeof workspace.permissions?.[key] === "boolean").map((key) => [key, workspace.permissions[key]]));
    if (Array.isArray(workspace.preconditions) && workspace.preconditions.length > 100) throw contextError("invalid_context_analysis");
    const preconditions = Array.isArray(workspace.preconditions) ? [...new Set(workspace.preconditions.filter((v) => typeof v === "string" && v.length <= 100 && /^[a-z0-9][a-z0-9._:-]{0,99}$/.test(v)))].sort() : [];
    return { workspaceId: match.id, declaredOnly: true, declaredPermissions, preconditions: preconditions.slice(0, 8), truncated: preconditions.length > 8,
      provenance: source(byPath.get(match.path), "canonical_fact", "validated_manifest_declaration") };
  });
  const documentItems = documents.filter((doc) => {
    if (!byPath.has(doc.path) || typeof doc.title !== "string" || doc.title.length > 1024) return false;
    if (["PROJECT.md", "AGENTS.md", "CONTEXT.md"].includes(doc.path)) return true;
    if (explicit(doc.path)) return true;
    if (doc.kind === "adr") return lexical(`${doc.path} ${doc.title}`);
    const directory = path.posix.dirname(doc.path);
    return task.paths.some((p) => within(p, directory)) || workspaceItems.some((w) => within(w.workspacePath, directory));
  }).sort((a, b) => compare(a.path, b.path)).map((doc) => ({
    path: doc.path, kind: ["project", "agents", "context", "adr"].includes(doc.kind) ? doc.kind : "context",
    title: text(doc.title, 256), ...excerpt(byPath.get(doc.path)),
    provenance: source(byPath.get(doc.path), "untrusted_repository_text", "canonical_document_relevance")
  }));
  const diagnostics = [...(icm.errors || []), ...(icm.warnings || []), ...matched.warnings, ...selectionIssues]
    .map((issue) => ({ code: typeof issue?.code === "string" && issue.code.length <= 80 && /^[a-z_]{1,80}$/.test(issue.code) ? issue.code : "icm_issue",
      ...(isContextPathAllowed(issue?.path) ? { path: issue.path } : {}),
      provenance: { trust: "derived_analysis", source: { kind: "icm_validation" }, reason: "validation_diagnostic" } }))
    .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  return {
    workspaces: section("workspaces", workspaceItems, "derived_analysis", "workspace-scope"),
    documents: section("documents", documentItems, "untrusted_repository_text", "icm-index"),
    constraints: section("constraints", constraintItems, "canonical_fact", "agent-manifest"),
    files: section("files", fileItems, "untrusted_repository_text", "context-source-observation"),
    symbols: section("symbols", selectedNodes.map(({ rawId, ...node }) => ({ ...node, line: null, provenance: source(byPath.get(node.path), "derived_analysis", seeds.has(rawId) ? "task_target" : "direct_reference") })), "derived_analysis", "analyzer-service"),
    references: section("references", [...referenceMap.entries()].sort(([a], [b]) => compare(a, b)).map(([, value]) => value), "derived_analysis", "analyzer-service"),
    tests: section("tests", testItems, "derived_analysis", "context-test-candidates"),
    diagnostics: section("diagnostics", diagnostics, "derived_analysis", "icm-validation")
  };
}
