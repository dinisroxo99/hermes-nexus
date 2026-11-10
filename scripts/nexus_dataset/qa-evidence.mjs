import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ts } from "ts-morph";
import { answerProjectQuestion } from "../../src/lib/project-question.js";
import { resolveProjectConfig } from "../../src/lib/project-config.js";
import { getConfiguredProjectRoots } from "../../src/lib/project-roots.js";
import { isContextPathAllowed } from "../../src/lib/project-context-files.js";
import { getNestedProjectPaths, getProjectByIdForIntelligence } from "../../src/lib/projects.js";
import { readProjectRevision } from "../../src/lib/project-revision.js";

const frozen = JSON.parse(fs.readFileSync(new URL("../fixtures/project-question-golden.json", import.meta.url)));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const refuse = (code) => { throw Object.assign(new Error(code), { code }); };
const heldPath = (file) => /^(scripts\/(?:fixtures|benchmarks)\/|scripts\/evaluate-project-questions\.mjs$|tests\/project-question-evaluation\.test\.js$|docs\/development\/(?:paired-hermes-|project-question-evaluation\.md$))/.test(file);
const pathAllowed = (file, excluded) => typeof file === "string" && isContextPathAllowed(file)
  && !excluded.some((p) => file === p || file.startsWith(p + "/"));

function gitReader(project) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" });
  const deadline = Date.now() + 12000;
  return (args, maxBuffer = 256 * 1024) => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) refuse("oracle_budget");
    return execFileSync("git", ["--no-pager", "--no-replace-objects", "--literal-pathspecs", ...args],
      { cwd: project.absolutePath, env, stdio: ["ignore", "pipe", "pipe"], timeout, maxBuffer });
  };
}

function treeEntry(raw) {
  const m = /^(100644|100755) blob ([a-f0-9]{40,64})\t([^\0]+)$/.exec(raw);
  return m && { oid: m[2], path: m[3] };
}

// Inventory all eligible committed TS/JS sources; TypeScript syntax trees here do not use the Nexus provider or index.
function symbolIndex(git, revision, excluded) {
  const lines = git(["ls-tree", "-rz", revision]).toString("utf8").split("\0").filter(Boolean);
  if (lines.length > 1000) refuse("oracle_budget");
  const index = new Map();
  let bytes = 0;
  for (const line of lines) {
    const entry = treeEntry(line);
    if (!entry || !pathAllowed(entry.path, excluded) || !/\.[jt]sx?$/i.test(entry.path)) continue;
    const contents = git(["cat-file", "blob", entry.oid], 128 * 1024);
    bytes += contents.length;
    if (bytes > 2 * 1024 * 1024) refuse("oracle_budget");
    const ast = ts.createSourceFile(entry.path, contents.toString("utf8"), ts.ScriptTarget.Latest, false);
    if (ast.parseDiagnostics.length) refuse("oracle_incomplete");
    const blobSha256 = hash(contents);
    function record(name, supported) {
      if (!index.has(name)) index.set(name, []);
      index.get(name).push(supported ? { path: entry.path, blobSha256 } : null);
    }
    function markBinding(name) {
      if (ts.isIdentifier(name)) record(name.text, false);
      else for (const element of name.elements) if (element.name) markBinding(element.name);
    }
    for (const declaration of ast.statements) {
      if (ts.isVariableStatement(declaration)) {
        for (const variable of declaration.declarationList.declarations) markBinding(variable.name);
      } else if (declaration.name && ts.isIdentifier(declaration.name)) {
        record(declaration.name.text, ts.isClassDeclaration(declaration) || ts.isFunctionDeclaration(declaration)
          || ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration));
      }
    }
  }
  return index;
}

function pathHistory(git, revision, file) {
  if (git(["rev-parse", "--is-shallow-repository"]).toString().trim() !== "false") refuse("oracle_incomplete");
  const commits = git(["rev-list", "--first-parent", "--max-count=65", revision]).toString().trim().split("\n");
  if (commits.length > 64) refuse("oracle_budget");
  const result = [];
  for (const [i, commit] of commits.entries()) {
    const parent = commits[i + 1];
    const delta = git(["diff-tree", "--no-commit-id", "--no-renames", "--no-ext-diff", "--no-textconv", "--name-status", "-r", "-z",
      ...(parent ? [parent, commit] : ["--root", commit]), "--", file]).toString("utf8").split("\0");
    if (!delta[0]) continue;
    const change = { A: "added", M: "modified", D: "deleted" }[delta[0]];
    if (!change || delta.length !== 3 || delta[1] !== file) refuse("oracle_incomplete");
    const entry = treeEntry(git(["ls-tree", "-z", change === "deleted" ? parent : commit, "--", file]).toString().slice(0, -1));
    if (!entry || entry.path !== file || result.length >= 16) refuse("oracle_incomplete");
    result.push({ path: file, commitSha: commit, change, blobSha256: hash(git(["cat-file", "blob", entry.oid], 128 * 1024)) });
  }
  return result;
}

async function main() {
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 512 * 1024) refuse("invalid_labels");
    chunks.push(chunk);
  }
  const { projectId, revision, manifest, manifestDigest } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (manifest.schemaVersion !== 1 || manifest.purpose !== "project_qa_labels" || !Array.isArray(manifest.labels)
      || manifest.labels.length > 32 || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(revision)) refuse("invalid_labels");
  const counts = {}, rows = [];
  const omit = (reason) => { counts[reason] = (counts[reason] ?? 0) + 1; };
  const report = () => ({ rows, summary: { considered: manifest.labels.length, emitted: rows.length, excluded: counts } });
  const omitAll = (reason) => { counts[reason] = manifest.labels.length; return report(); };
  if (manifest.projectId !== projectId || manifest.revision !== revision) return omitAll("label_binding_mismatch");
  if (Object.hasOwn(frozen.heads, projectId) || Object.values(frozen.heads).includes(revision)
      || projectId === "PrJ_Bench" || revision === "0894ac84d787d907bec32f1d76e0797fdd233b7a") return omitAll("held_out");
  const config = resolveProjectConfig();
  const registry = { roots: getConfiguredProjectRoots(), manualProjectsFile: path.join(config.dataDir, "projects.json"),
    discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json") };
  const project = getProjectByIdForIntelligence(projectId, registry);
  const clean = () => { const view = readProjectRevision(project); return view.dirty === false && view.commitSha === revision; };
  if (!clean()) return omitAll("stale_or_dirty_project");
  const git = gitReader(project);
  if (fs.realpathSync(git(["rev-parse", "--show-toplevel"]).toString().trim()) !== fs.realpathSync(project.absolutePath)) {
    return omitAll("project_root_not_exact");
  }
  const excluded = getNestedProjectPaths(project, registry);
  const seen = new Set();
  let symbols;
  for (const label of manifest.labels) {
    if (!label || typeof label.subject !== "string" || label.subject.length > 256 || !["symbol", "history"].includes(label.question)
        || !["accepted", "rejected", "ambiguous"].includes(label.decision)) refuse("invalid_labels");
    const key = JSON.stringify([label.question, label.subject]);
    if (seen.has(key)) refuse("duplicate_label");
    seen.add(key);
    if (label.decision !== "accepted") { omit("not_accepted"); continue; }
    if (!Array.isArray(label.citations) || !label.citations.length || label.citations.length > 16
        || !/^[0-9a-f]{64}$/.test(label.answerSha256)) refuse("invalid_accepted_label");
    if (heldPath(label.subject) || frozen.cases.some((c) => c.question === label.question && c.subject === label.subject)
        || label.citations.some((c) => !c || !pathAllowed(c.path, excluded) || heldPath(c.path))) { omit("held_or_ineligible"); continue; }
    try {
      let verified;
      if (label.question === "symbol") {
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]{0,79}$/.test(label.subject)) { omit("unsupported_subject"); continue; }
        symbols ??= symbolIndex(git, revision, excluded);
        verified = symbols.get(label.subject) ?? [];
        if (verified.length !== 1 || !verified[0]) { omit("absent_or_ambiguous_symbol"); continue; }
      } else {
        if (!pathAllowed(label.subject, excluded)) { omit("unsupported_subject"); continue; }
        verified = pathHistory(git, revision, label.subject);
      }
      if (!isDeepStrictEqual(label.citations, verified)) { omit("oracle_mismatch"); continue; }
      const answer = answerProjectQuestion({ projectId, question: label.question, subject: label.subject }, { registry });
      if (answer.projectId !== projectId || answer.revision.commitSha !== revision || answer.observation.incomplete
          || hash(answer.answer) !== label.answerSha256) { omit("answer_mismatch"); continue; }
      const actual = label.question === "symbol" ? answer.evidence.map((e) => ({ path: e.path, blobSha256: e.provenance?.source?.sha256 }))
        : answer.evidence.map(({ path, commitSha, change }) => ({ path, commitSha, change }));
      const expected = label.question === "symbol" ? verified : verified.map(({ path, commitSha, change }) => ({ path, commitSha, change }));
      if (!isDeepStrictEqual(actual, expected)) { omit("citation_mismatch"); continue; }
      rows.push({ schemaVersion: 1, exampleType: "validated_project_qa", projectId, revision, question: label.question,
        subject: label.subject, answer: answer.answer, citations: verified, labelManifestSha256: manifestDigest,
        validation: label.question === "symbol" ? "committed_declaration_inventory" : "first_parent_git_diff" });
    } catch { omit("unverified_evidence"); }
  }
  if (!clean()) refuse("project_changed");
  return report();
}

try { console.log(JSON.stringify(await main())); }
catch { console.error(JSON.stringify({ error: "qa_export_unavailable" })); process.exitCode = 1; }
