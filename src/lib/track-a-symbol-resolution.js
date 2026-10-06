import { createHash } from "node:crypto";
import { types } from "node:util";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Project, SyntaxKind } from "ts-morph";
import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";
import { contextDigest } from "./project-context-files.js";

const moduleRequire = createRequire(import.meta.url);
const CONTRACT_TYPESCRIPT_PARSER_VERSION = "6.0.3";
const PARSER_VERSION_NOT_CONTRACT_NOTE =
  "parser version is not the contract parser";

function readInstalledTypescriptVersion() {
  return JSON.parse(
    readFileSync(moduleRequire.resolve("typescript/package.json"), "utf8")
  ).version;
}

function nativeTypescriptDeclarationsProvider(version) {
  return {
    id: "native.typescript.declarations",
    version: "1",
    kind: "native",
    parser: "typescript/" + version
  };
}

function withParsedProvider(result) {
  const version = readInstalledTypescriptVersion();
  const provider = nativeTypescriptDeclarationsProvider(version);
  if (version !== CONTRACT_TYPESCRIPT_PARSER_VERSION) {
    const notes = Array.isArray(result.notes) ? result.notes.slice() : [];
    if (!notes.includes(PARSER_VERSION_NOT_CONTRACT_NOTE)) {
      notes.push(PARSER_VERSION_NOT_CONTRACT_NOTE);
    }
    const unsupported = {
      status: "unsupported",
      provider,
      notes
    };
    if (Object.hasOwn(result, "census")) unsupported.census = result.census;
    if (Object.hasOwn(result, "coverage")) unsupported.coverage = result.coverage;
    if (Object.hasOwn(result, "completeness")) {
      const completeness = { ...result.completeness };
      if (completeness.enumeration === "complete") {
        completeness.enumeration = "not_evaluated";
      }
      unsupported.completeness = completeness;
    }
    if (Object.hasOwn(result, "pathRecords")) unsupported.pathRecords = result.pathRecords;
    stripIdentityFields(unsupported);
    return unsupported;
  }
  result.provider = provider;
  return result;
}

const QUALIFYING_DIRECT_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.EnumDeclaration
]);

const UNSUPPORTED_FORM_NOTE =
  "path is incomplete because of an unsupported declaration form";

const AMBIGUOUS_DIRECT_NOTE = "name has more than one direct declaration";

const NOT_ACCEPTED_NOTE =
  "source-hash match is not full observation binding and is not accepted A1 evidence";

const PROVIDER_ID_NOT_COPIED_NOTE =
  "provider node id was not validated against the symbol, file, and snapshot and was not copied";

const SNAPSHOT_TOKEN_MISMATCH_NOTE = "snapshot token did not recompute";
const NAME_WAS_REJECTED_NOTE = "name was rejected";
const SOURCE_BYTES_WERE_REJECTED_NOTE = "source bytes were rejected";
const SOURCE_HASH_BINDING_WAS_REJECTED_NOTE = "source hash binding was rejected";
const TASK_PATHS_WERE_REJECTED_NOTE = "task paths were rejected";
const SNAPSHOT_WAS_REJECTED_NOTE = "snapshot was rejected";
const SOURCE_DID_NOT_ROUND_TRIP_NOTE = "source did not round-trip through the parser";

const SNAPSHOT_TOKEN_MATCHED_NOTE =
  "snapshot token matched the supplied bytes but this is not accepted A1 evidence (declaration identity and completeness are not produced here)";

const SYMBOL_ID_SNAPSHOT_NOTE =
  "symbol id is the declaration id for this snapshot only and is not stable across snapshots";

const SINGLE_PATH_ONLY_NOTE =
  "only a single explicit path is implemented";
const TASK_PATH_COUNT_EXCEEDS_32_NOTE = "task path count exceeds 32";
const FILES_WERE_REJECTED_NOTE = "files were rejected";

const OUTPUT_COVERAGE_INCOMPLETE_NOTE =
  "output coverage is not complete, so this is neither not_found nor resolved_unique";

const MAX_TRACK_A1_FILE_UTF8_BYTES = 131072;
const MAX_TRACK_A1_TOTAL_SOURCE_BYTES = 4194304;
const SOURCE_BYTE_CEILING_NOTE = "source byte ceiling was exceeded";

function exceedsSourceByteCeiling(byteLengths) {
  let total = 0;
  for (const byteLength of byteLengths) {
    if (byteLength > MAX_TRACK_A1_FILE_UTF8_BYTES) return true;
    total += byteLength;
    if (total > MAX_TRACK_A1_TOTAL_SOURCE_BYTES) return true;
  }
  return false;
}

function sourceByteCeilingResult(providerNode) {
  return notEvaluated(
    withCompleteness(
      { notes: [SOURCE_BYTE_CEILING_NOTE] },
      buildCompleteness()
    ),
    providerNode
  );
}

const HEX64 = /^[a-f0-9]{64}$/;

function stripIdentityFields(result) {
  for (const key of ["stableId", "symbolId", "declarationId"]) {
    if (Object.hasOwn(result, key)) delete result[key];
  }
  return result;
}

function attachProviderIdNote(result, providerNode) {
  if (providerNodeSuppliedId(providerNode)) {
    const notes = Array.isArray(result.notes) ? result.notes.slice() : [];
    if (!notes.includes(PROVIDER_ID_NOT_COPIED_NOTE)) notes.push(PROVIDER_ID_NOT_COPIED_NOTE);
    result.notes = notes;
  }
  return result;
}

function notEvaluated(extra = {}, providerNode) {
  const result = { status: "not_evaluated", ...extra };
  stripIdentityFields(result);
  delete result.counts;
  return attachProviderIdNote(result, providerNode);
}

function ambiguous(extra = {}, providerNode) {
  const result = { status: "ambiguous", ...extra };
  stripIdentityFields(result);
  return attachProviderIdNote(result, providerNode);
}

function partial(extra = {}, providerNode) {
  const result = { status: "partial", ...extra };
  stripIdentityFields(result);
  return attachProviderIdNote(result, providerNode);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pathCount(task) {
  return isPlainObject(task) && Array.isArray(task.paths) ? task.paths.length : 0;
}

function withMatchCounts(extra, requested, processed) {
  const retained = extra.census;
  const enumeration = extra.completeness && extra.completeness.enumeration;
  return {
    ...extra,
    counts: {
      requested,
      processed,
      retained,
      matchedLowerBound: retained,
      exactMatchCount: enumeration === "complete" ? retained : null
    }
  };
}


function providerNodeSuppliedId(providerNode) {
  if (!isPlainObject(providerNode)) return false;
  const idOwn = ownDataProperty(providerNode, "id");
  if (idOwn.kind !== "data") return false;
  const id = idOwn.value;
  return id != null && id !== "";
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const typedArrayLengthGet = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "length"
).get;
const typedArraySet = Object.getPrototypeOf(Uint8Array.prototype).set;

function uint8ArrayLengthWithoutOwnGet(value) {
  return Reflect.apply(typedArrayLengthGet, value, []);
}

function copyByteLeafToBuffer(leaf) {
  const len = uint8ArrayLengthWithoutOwnGet(leaf);
  const copy = Buffer.alloc(len);
  if (len === 0) return copy;
  Reflect.apply(typedArraySet, copy, [leaf]);
  return copy;
}

function toBuffer(sourceBytes) {
  // Byte leaves are copied through intrinsics. Callers must enforce the
  // per-file ceiling on the raw leaf before calling this for isAllowedByteLeaf.
  if (isAllowedByteLeaf(sourceBytes)) {
    return copyByteLeafToBuffer(sourceBytes);
  }
  if (typeof sourceBytes === "string") return Buffer.from(sourceBytes, "utf8");
  return null;
}

function identifierName(node) {
  if (typeof node.getNameNode !== "function") return undefined;
  let nameNode;
  try {
    nameNode = node.getNameNode();
  } catch {
    return undefined;
  }
  if (!nameNode || nameNode.getKind() !== SyntaxKind.Identifier) return undefined;
  return nameNode.getText();
}

function isSourceFileVariableDeclaration(node) {
  const declarationList = node.getParent();
  if (!declarationList || declarationList.getKind() !== SyntaxKind.VariableDeclarationList) return false;
  const statement = declarationList.getParent();
  if (!statement || statement.getKind() !== SyntaxKind.VariableStatement) return false;
  const parent = statement.getParent();
  return !!parent && parent.getKind() === SyntaxKind.SourceFile;
}

function fileHasUnsupportedDeclarationForm(sourceFile) {
  let found = false;
  sourceFile.forEachDescendant((node) => {
    if (found) return;
    const kind = node.getKind();
    if (kind === SyntaxKind.ModuleDeclaration) {
      const parent = node.getParent();
      if (parent && parent.getKind() === SyntaxKind.SourceFile) found = true;
      return;
    }
    if (kind !== SyntaxKind.VariableDeclaration) return;
    if (!isSourceFileVariableDeclaration(node)) return;
    let nameNode;
    try {
      nameNode = typeof node.getNameNode === "function" ? node.getNameNode() : undefined;
    } catch {
      found = true;
      return;
    }
    if (!nameNode || nameNode.getKind() !== SyntaxKind.Identifier) found = true;
  });
  return found;
}

const RETAINED_MATCH_CEILING = 256;
const RETAINED_MATCH_NOTE = "retained match ceiling was reached";
const INSPECTED_ENTRY_CEILING = 20000;
const INSPECTED_ENTRY_NOTE = "inspected entry ceiling was reached";

function censusDeclarations(sourceFile, name, budget = RETAINED_MATCH_CEILING, inspectionBudget = INSPECTED_ENTRY_CEILING) {
  const matches = [];
  let exhausted = false;
  let inspected = 0;
  let inspectionExhausted = false;
  const take = (declaration) => {
    if (identifierName(declaration) !== name) return false;
    if (matches.length >= budget) {
      exhausted = true;
      return true;
    }
    matches.push(declaration);
    return false;
  };

  for (const statement of sourceFile.getStatements()) {
    if (inspected >= inspectionBudget) {
      inspectionExhausted = true;
      break;
    }
    if (exhausted) break;
    inspected += 1;
    const kind = statement.getKind();
    if (QUALIFYING_DIRECT_KINDS.has(kind)) {
      take(statement);
      continue;
    }
    if (kind !== SyntaxKind.VariableStatement) continue;
    const declarationList = statement.getDeclarationList();
    for (const declaration of declarationList.getDeclarations()) {
      if (inspected >= inspectionBudget) {
        inspectionExhausted = true;
        break;
      }
      if (exhausted) break;
      inspected += 1;
      if (!isSourceFileVariableDeclaration(declaration)) continue;
      if (take(declaration)) break;
    }
    if (inspectionExhausted || exhausted) break;
  }
  return { matches, exhausted, inspectionExhausted, inspected };
}

function retainParsedMatches(parsedFiles, name) {
  let remaining = RETAINED_MATCH_CEILING;
  let inspectionRemaining = INSPECTED_ENTRY_CEILING;
  let exhausted = false;
  let inspectionExhausted = false;
  const files = [];
  for (const file of parsedFiles) {
    if (exhausted || inspectionRemaining === 0) {
      files.push({ file, matches: [], enumerationPartial: true });
      if (inspectionRemaining === 0) inspectionExhausted = true;
      continue;
    }
    const collected = censusDeclarations(file.sourceFile, name, remaining, inspectionRemaining);
    files.push({
      file,
      matches: collected.matches,
      enumerationPartial: collected.exhausted || collected.inspectionExhausted
    });
    remaining -= collected.matches.length;
    inspectionRemaining -= collected.inspected;
    if (collected.exhausted) exhausted = true;
    if (collected.inspectionExhausted) inspectionExhausted = true;
  }
  return { files, exhausted, inspectionExhausted };
}

function applyMatchCeiling(extra, completeness, exhausted) {
  if (!exhausted) return { extra, completeness };
  const notes = Array.isArray(extra.notes) ? extra.notes.slice() : [];
  if (!notes.includes(RETAINED_MATCH_NOTE)) notes.push(RETAINED_MATCH_NOTE);
  const nextExtra = {
    ...extra,
    notes,
    counts: {
      retained: RETAINED_MATCH_CEILING,
      matchedLowerBound: RETAINED_MATCH_CEILING,
      exactMatchCount: null
    }
  };
  if (!completeness) return { extra: nextExtra, completeness };
  const output = completeness.output === "complete" ? "not_evaluated" : completeness.output;
  return {
    extra: nextExtra,
    completeness: {
      ...completeness,
      enumeration: "partial",
      output
    }
  };
}

function applyInspectionCeiling(extra, completeness, exhausted) {
  if (!exhausted) return { extra, completeness };
  const notes = Array.isArray(extra.notes) ? extra.notes.slice() : [];
  if (!notes.includes(INSPECTED_ENTRY_NOTE)) notes.push(INSPECTED_ENTRY_NOTE);
  const nextExtra = {
    ...extra,
    notes
  };
  if (!completeness) return { extra: nextExtra, completeness };
  const output = completeness.output === "complete" ? "not_evaluated" : completeness.output;
  return {
    extra: nextExtra,
    completeness: {
      ...completeness,
      enumeration: "partial",
      output
    }
  };
}



const DECLARATION_KIND = new Map([
  [SyntaxKind.FunctionDeclaration, "function"],
  [SyntaxKind.ClassDeclaration, "class"],
  [SyntaxKind.InterfaceDeclaration, "interface"],
  [SyntaxKind.TypeAliasDeclaration, "type"],
  [SyntaxKind.EnumDeclaration, "enum"],
  [SyntaxKind.VariableDeclaration, "variable"]
]);

function occurrencePoint(sourceFile, offset) {
  const point = sourceFile.getLineAndColumnAtPos(offset);
  return { line: point.line, column: point.column };
}

function occurrenceFromDeclaration(node, sourceFile, path) {
  const nameNode = node.getNameNode();
  const start = node.getStart();
  const end = node.getEnd();
  const nameStart = nameNode.getStart();
  const nameEnd = nameNode.getEnd();
  return {
    name: nameNode.getText(),
    kind: DECLARATION_KIND.get(node.getKind()),
    path,
    range: { start, end },
    nameRange: { start: nameStart, end: nameEnd },
    location: {
      start: occurrencePoint(sourceFile, start),
      end: occurrencePoint(sourceFile, end)
    }
  };
}

function qualifyingOccurrences(matches, sourceFile, path) {
  return matches.map((node) => occurrenceFromDeclaration(node, sourceFile, path));
}

function occurrencesHaveDeclarationId(occurrences) {
  return occurrences.some((occurrence) => Object.hasOwn(occurrence, "declarationId"));
}

function withSymbolIdSnapshotNote(notes, occurrences) {
  if (occurrencesHaveDeclarationId(occurrences) && !notes.includes(SYMBOL_ID_SNAPSHOT_NOTE)) {
    notes.push(SYMBOL_ID_SNAPSHOT_NOTE);
  }
  return notes;
}

function attachDeclarationIds(occurrences, snapshotTokenMatched, snapshot, sourceSha256) {
  if (!snapshotTokenMatched) return occurrences;
  const version = readInstalledTypescriptVersion();
  if (version !== CONTRACT_TYPESCRIPT_PARSER_VERSION) return occurrences;
  const parserString = "typescript/" + version;
  const snapshotToken = snapshot.token;
  return occurrences.map((occurrence) => {
    if (occurrence.path == null) return occurrence;
    const fileSha = sourceSha256 instanceof Map ? sourceSha256.get(occurrence.path) : sourceSha256;
    if (typeof fileSha !== "string" || fileSha.length === 0) return occurrence;
    const declarationId = contextDigest(JSON.stringify([
      "tsjs-direct-declarations-1",
      "native.typescript.declarations",
      "1",
      parserString,
      snapshotToken,
      occurrence.path,
      fileSha,
      occurrence.kind,
      occurrence.range.start,
      occurrence.range.end,
      occurrence.nameRange.start,
      occurrence.nameRange.end,
      occurrence.name
    ]));
    return {
      ...occurrence,
      declarationId,
      symbolId: "symbol_" + declarationId
    };
  });
}

function snapshotRejection(note) {
  return { ok: false, note: note || SNAPSHOT_WAS_REJECTED_NOTE };
}

function recomputeSnapshotToken(snapshot, bytes, binding, actualSha) {
  if (!isPlainObject(snapshot)) return snapshotRejection();
  if (typeof snapshot.projectId !== "string" || snapshot.projectId.length === 0) return snapshotRejection();
  if (typeof snapshot.path !== "string" || snapshot.path.length === 0) return snapshotRejection();
  if (typeof snapshot.sourceSha256 !== "string" || snapshot.sourceSha256.length === 0) return snapshotRejection();
  if (snapshot.sourceSha256 !== actualSha || snapshot.sourceSha256 !== binding.sourceSha256) return snapshotRejection();
  if (typeof snapshot.byteSize !== "number" || !Number.isFinite(snapshot.byteSize) || snapshot.byteSize !== bytes.length) {
    return snapshotRejection();
  }
  if (typeof snapshot.token !== "string" || snapshot.token.length === 0) return snapshotRejection();

  const revision = snapshot.revision;
  if (!isPlainObject(revision)) return snapshotRejection();
  if (Object.hasOwn(revision, "repositoryIdentity")) return snapshotRejection();
  if (typeof revision.repositoryId !== "string" || !HEX64.test(revision.repositoryId)) return snapshotRejection();
  if (typeof revision.worktreeId !== "string" || !HEX64.test(revision.worktreeId)) return snapshotRejection();
  if (typeof revision.status !== "string" || revision.status.length === 0) return snapshotRejection();
  if (typeof revision.commitSha !== "string" || revision.commitSha.length === 0) return snapshotRejection();
  if (!(revision.branch === null || typeof revision.branch === "string")) return snapshotRejection();
  if (typeof revision.dirty !== "boolean") return snapshotRejection();
  if (typeof revision.isLinkedWorktree !== "boolean") return snapshotRejection();

  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return snapshotRejection();

  let recomputed;
  try {
    recomputed = createProviderSnapshot(
      { projectId: snapshot.projectId },
      [{ path: snapshot.path, text }],
      {
        status: revision.status,
        commitSha: revision.commitSha,
        branch: revision.branch,
        repositoryId: revision.repositoryId,
        worktreeId: revision.worktreeId,
        dirty: revision.dirty,
        isLinkedWorktree: revision.isLinkedWorktree
      }
    );
  } catch {
    return snapshotRejection();
  }

  if (!recomputed || recomputed.token !== snapshot.token) {
    return snapshotRejection(SNAPSHOT_TOKEN_MISMATCH_NOTE);
  }
  return { ok: true };
}

function isAbsolutePath(path) {
  return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path);
}

function resolveTaskPathScope(task) {
  if (!isPlainObject(task) || !Array.isArray(task.paths) || task.paths.length === 0) {
    return { kind: "absent" };
  }
  if (task.paths.length > 32) {
    return { kind: "unsupported_count" };
  }
  for (const path of task.paths) {
    if (typeof path !== "string" || path.length === 0) {
      return { kind: "invalid" };
    }
    if (isAbsolutePath(path) || path.includes("..")) {
      return { kind: "invalid" };
    }
  }
  if (new Set(task.paths).size !== task.paths.length) {
    return { kind: "invalid" };
  }
  if (task.paths.length === 1) {
    return { kind: "single", path: task.paths[0] };
  }
  return { kind: "multi", paths: task.paths.slice() };
}

function buildCompleteness({
  snapshotTokenMatched = false,
  parsed = false,
  syntacticDiagnosticCount = 0,
  unsupportedForm = false
} = {}) {
  return {
    source: snapshotTokenMatched ? "complete" : "not_evaluated",
    parse: !parsed
      ? "not_evaluated"
      : syntacticDiagnosticCount === 0
        ? "complete"
        : "partial",
    enumeration: !parsed
      ? "not_evaluated"
      : unsupportedForm
        ? "partial"
        : "complete",
    output: "not_evaluated"
  };
}

function buildPathRecord({
  path,
  sha256,
  byteSize,
  syntacticDiagnosticCount,
  unsupportedForm,
  matched,
  enumerationPartial = false
}) {
  return {
    path,
    sha256,
    byteSize,
    parse: syntacticDiagnosticCount === 0 ? "complete" : "partial",
    enumeration: unsupportedForm || enumerationPartial ? "partial" : "complete",
    matched
  };
}

function deliverParsed(result, pathRecords) {
  if (Array.isArray(pathRecords)) result.pathRecords = pathRecords;
  const produced = withParsedProvider(result);
  if (produced !== result && Array.isArray(pathRecords)) {
    produced.pathRecords = pathRecords;
  }
  return produced;
}

function withCompleteness(extra, completeness) {
  return { ...extra, completeness };
}

/**
 * Track A1 symbol-resolution producer.
 *
 * Census only direct source-file declarations of `name` (identifier-named
 * function, class, interface, type alias, enum, or source-file variable).
 * Methods, parameters, members, nested declarations, and import/export aliases
 * are outside the domain and do not increase the census. A direct source-file
 * variable whose name is not an identifier, or a namespace/module that is a
 * direct child statement of the source file, leaves the path incomplete.
 * Declarations nested in bodies, including destructuring and namespaces, do not.
 * A remaining top-level name match is not accepted evidence.
 * Fail closed unless the bytes, source sha256, UTF-8 roundtrip, syntactic
 * diagnostics, and declaration census are all usable. Two or more qualifying
 * direct declarations are ambiguous even when the snapshot is absent or an
 * unsupported form limits completeness; that result keeps census and coverage
 * and does not emit stable ids. A clean parse records
 * each qualifying direct declaration as an occurrence (name, kind, optional
 * single task path, declaration range, name range, and location). A declarationId
 * is added only after the supplied snapshot token recomputes, the occurrence path
 * is a non-null task path, and the installed parser version is the contract version.
 * That id is contextDigest of the fixed JSON field array. symbolId is symbol_ plus
 * that declarationId and is attached only when declarationId is attached. It names
 * this snapshot only, is not stable across snapshots, and does not make the result
 * resolved_unique. Parse diagnostics contribute no occurrence records. A census of 0
 * stays not_evaluated unless the same binding required for resolved_unique is complete,
 * syntactic diagnostics are 0, and there is no direct unsupported form. That case is
 * not_found: output, source, parse, and enumeration are complete, counts are exact,
 * occurrences are empty, and no symbolId or declarationId is emitted. A census of 1
 * whose single-path binding is incomplete stays not_evaluated. A matching snapshot
 * and a symbolId are not enough.
 * resolved_unique is emitted only when query.domain is
 * tsjs_source_file_direct_declarations_v1, query.name is that requested name,
 * task.id is a non-empty string of at most 128 characters, task.paths is
 * exactly the snapshot path, project.projectId, rootId, and relativePath are
 * non-empty and project.projectId equals the snapshot, the recomputed revision
 * is available, clean, and a linked worktree with no repositoryIdentity,
 * 64-hex repository and worktree ids, and a 40-hex commitSha, the installed
 * parser is 6.0.3, census is 1, syntactic diagnostics are 0, there is no
 * direct unsupported form, and symbolId is symbol_ plus declarationId.
 * resolved_unique and not_found set completeness.output to complete. Other domains stay
 * on their existing status and are not turned into unsupported. When task.paths
 * supplies exactly one relative path, incomplete parse or unsupported forms
 * with census < 2 become partial with an explicit completeness record; a clean
 * single match whose binding is incomplete, or a zero match whose binding is
 * incomplete, stays not_evaluated because output coverage is not complete.
 * A zero match does not become not_found when the binding is incomplete, when
 * parse diagnostics are present, or when a direct unsupported form is present.
 * Provider node ids are never copied. Extra binding fields are
 * ignored. Does not invent project, repository, worktree, snapshot, or path
 * identity, and does not consult composeEffectiveTaskScope / providers.
 * When every supplied task path is actually parsed, pathRecords lists one
 * record per path in task.paths order: path, sha256, byteSize, parse
 * (complete only with zero syntactic diagnostics on that path), enumeration
 * (partial only when that path has a direct unsupported form), and matched
 * (qualifying direct declarations of the requested name in that path).
 * A file over 131072 UTF-8 bytes, or more than 4194304 source bytes across
 * the requested files, is not_evaluated before UTF-8 decode and before
 * createSourceFile. That result has a bounded note and no pathRecords.
 * Paths rejected before parse are not given pathRecords.
 */

const COMMIT_SHA40 = /^[a-f0-9]{40}$/;
const SYMBOL_QUERY_DOMAIN = "tsjs_source_file_direct_declarations_v1";

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function revisionAllowsUnique(revision) {
  if (!isPlainObject(revision)) return false;
  if (Object.hasOwn(revision, "repositoryIdentity")) return false;
  if (typeof revision.repositoryId !== "string" || !HEX64.test(revision.repositoryId)) return false;
  if (typeof revision.worktreeId !== "string" || !HEX64.test(revision.worktreeId)) return false;
  if (revision.status !== "available") return false;
  if (typeof revision.commitSha !== "string" || !COMMIT_SHA40.test(revision.commitSha)) return false;
  if (!(revision.branch === null || typeof revision.branch === "string")) return false;
  if (revision.dirty !== false) return false;
  if (revision.isLinkedWorktree !== true) return false;
  return true;
}

function symbolBindingReady({
  name,
  query,
  task,
  project,
  snapshot,
  snapshotTokenMatched,
  completeness,
  pathScope
}) {
  if (!snapshotTokenMatched || !isPlainObject(snapshot)) return false;
  if (!isPlainObject(query)) return false;
  if (query.domain !== SYMBOL_QUERY_DOMAIN) return false;
  if (!nonEmptyString(query.name) || query.name !== name) return false;
  if (!isPlainObject(task)) return false;
  if (!nonEmptyString(task.id) || task.id.length > 128) return false;
  if (!Array.isArray(task.paths) || task.paths.length !== 1) return false;
  if (task.paths[0] !== snapshot.path) return false;
  if (pathScope.kind !== "single" || pathScope.path !== snapshot.path) return false;
  if (!isPlainObject(project)) return false;
  if (!nonEmptyString(project.projectId) || !nonEmptyString(project.rootId) || !nonEmptyString(project.relativePath)) {
    return false;
  }
  if (project.projectId !== snapshot.projectId) return false;
  if (!revisionAllowsUnique(snapshot.revision)) return false;
  if (readInstalledTypescriptVersion() !== CONTRACT_TYPESCRIPT_PARSER_VERSION) return false;
  if (!isPlainObject(completeness)) return false;
  if (completeness.source !== "complete" || completeness.parse !== "complete" || completeness.enumeration !== "complete") {
    return false;
  }
  return true;
}

function uniqueBindingReady({
  name,
  query,
  task,
  project,
  snapshot,
  snapshotTokenMatched,
  occurrences,
  completeness,
  pathScope
}) {
  if (!symbolBindingReady({
    name,
    query,
    task,
    project,
    snapshot,
    snapshotTokenMatched,
    completeness,
    pathScope
  })) return false;
  if (!Array.isArray(occurrences) || occurrences.length !== 1) return false;
  const occurrence = occurrences[0];
  if (!isPlainObject(occurrence)) return false;
  if (typeof occurrence.declarationId !== "string" || !HEX64.test(occurrence.declarationId)) return false;
  if (occurrence.symbolId !== "symbol_" + occurrence.declarationId) return false;
  return true;
}

function symbolRequestToken({ project, revision, snapshotToken, parserString, task, query }) {
  const fields = [
    "symbol-resolution-evidence-v1",
    "tsjs-direct-declarations-1",
    project.projectId,
    project.rootId,
    project.relativePath,
    revision.status,
    revision.commitSha,
    revision.branch,
    revision.repositoryId,
    revision.worktreeId,
    revision.dirty,
    revision.isLinkedWorktree,
    snapshotToken,
    "native.typescript.declarations",
    "1",
    parserString,
    task.id,
    task.paths[0]
  ];
  if (Array.isArray(task.paths) && task.paths.length > 1) {
    for (let index = 1; index < task.paths.length; index += 1) {
      fields.push(task.paths[index]);
    }
  }
  fields.push(query.name, query.domain);
  return contextDigest(JSON.stringify(fields));
}

function resolvedUniqueResult({
  occurrences,
  coverage,
  completeness,
  snapshot,
  project,
  task,
  query,
  actualSha
}) {
  const parserString = "typescript/" + readInstalledTypescriptVersion();
  const revision = snapshot.revision;
  const requestToken = symbolRequestToken({
    project,
    revision,
    snapshotToken: snapshot.token,
    parserString,
    task,
    query
  });
  const notes = withSymbolIdSnapshotNote([], occurrences);
  return {
    status: "resolved_unique",
    census: 1,
    coverage,
    notes,
    occurrences,
    completeness: {
      source: completeness.source,
      parse: completeness.parse,
      enumeration: completeness.enumeration,
      output: "complete"
    },
    revisionBinding: {
      status: revision.status,
      commitSha: revision.commitSha,
      branch: revision.branch,
      repositoryId: revision.repositoryId,
      worktreeId: revision.worktreeId,
      dirty: revision.dirty,
      isLinkedWorktree: revision.isLinkedWorktree
    },
    snapshotBinding: {
      snapshotToken: snapshot.token,
      sourceDigest: actualSha,
      requestToken
    },
    requestToken,
    counts: {
      requested: task.paths.length,
      processed: task.paths.length,
      retained: 1,
      matchedLowerBound: 1,
      exactMatchCount: 1
    },
    generatedAt: null
  };
}

function notFoundResult({
  coverage,
  completeness,
  snapshot,
  project,
  task,
  query,
  actualSha
}) {
  const parserString = "typescript/" + readInstalledTypescriptVersion();
  const revision = snapshot.revision;
  const requestToken = symbolRequestToken({
    project,
    revision,
    snapshotToken: snapshot.token,
    parserString,
    task,
    query
  });
  return {
    status: "not_found",
    census: 0,
    coverage,
    notes: [],
    occurrences: [],
    completeness: {
      source: completeness.source,
      parse: completeness.parse,
      enumeration: completeness.enumeration,
      output: "complete"
    },
    revisionBinding: {
      status: revision.status,
      commitSha: revision.commitSha,
      branch: revision.branch,
      repositoryId: revision.repositoryId,
      worktreeId: revision.worktreeId,
      dirty: revision.dirty,
      isLinkedWorktree: revision.isLinkedWorktree
    },
    snapshotBinding: {
      snapshotToken: snapshot.token,
      sourceDigest: actualSha,
      requestToken
    },
    requestToken,
    counts: {
      requested: task.paths.length,
      processed: task.paths.length,
      retained: 0,
      matchedLowerBound: 0,
      exactMatchCount: 0
    },
    generatedAt: null
  };
}


function collectRawOrderedFiles(paths, files) {
  if (!Array.isArray(files) || files.length !== paths.length) return { kind: "invalid" };
  const byPath = new Map();
  const lengths = [];
  for (const entry of files) {
    if (!isPlainObject(entry) || typeof entry.path !== "string") return { kind: "invalid" };
    if (byPath.has(entry.path)) return { kind: "invalid" };
    const source = entry.sourceBytes;
    if (isAllowedByteLeaf(source)) {
      lengths.push(uint8ArrayLengthWithoutOwnGet(source));
      byPath.set(entry.path, { kind: "leaf", source });
    } else if (typeof source === "string") {
      lengths.push(Buffer.byteLength(source, "utf8"));
      byPath.set(entry.path, { kind: "string", source });
    } else {
      return { kind: "invalid" };
    }
  }
  if (byPath.size !== paths.length) return { kind: "invalid" };
  for (const path of paths) {
    if (!byPath.has(path)) return { kind: "invalid" };
  }
  // Ceiling against raw intrinsic lengths before any Buffer.from / copy.
  if (exceedsSourceByteCeiling(lengths)) return { kind: "oversized" };
  const ordered = [];
  for (const path of paths) {
    const item = byPath.get(path);
    const bytes = item.kind === "leaf"
      ? copyByteLeafToBuffer(item.source)
      : Buffer.from(item.source, "utf8");
    ordered.push({ path, bytes });
  }
  return { kind: "ok", files: ordered };
}

function decodeOrderedFiles(rawFiles) {
  const ordered = [];
  for (const file of rawFiles) {
    const text = file.bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(file.bytes)) return null;
    ordered.push({
      path: file.path,
      bytes: file.bytes,
      text,
      sha256: sha256Bytes(file.bytes)
    });
  }
  return ordered;
}

function recomputeMultiSnapshotToken(snapshot, orderedFiles) {
  if (!isPlainObject(snapshot)) return snapshotRejection();
  if (typeof snapshot.projectId !== "string" || snapshot.projectId.length === 0) return snapshotRejection();
  if (typeof snapshot.token !== "string" || snapshot.token.length === 0) return snapshotRejection();

  const revision = snapshot.revision;
  if (!isPlainObject(revision)) return snapshotRejection();
  if (Object.hasOwn(revision, "repositoryIdentity")) return snapshotRejection();
  if (typeof revision.repositoryId !== "string" || !HEX64.test(revision.repositoryId)) return snapshotRejection();
  if (typeof revision.worktreeId !== "string" || !HEX64.test(revision.worktreeId)) return snapshotRejection();
  if (typeof revision.status !== "string" || revision.status.length === 0) return snapshotRejection();
  if (typeof revision.commitSha !== "string" || revision.commitSha.length === 0) return snapshotRejection();
  if (!(revision.branch === null || typeof revision.branch === "string")) return snapshotRejection();
  if (typeof revision.dirty !== "boolean") return snapshotRejection();
  if (typeof revision.isLinkedWorktree !== "boolean") return snapshotRejection();

  let recomputed;
  try {
    recomputed = createProviderSnapshot(
      { projectId: snapshot.projectId },
      orderedFiles.map((file) => ({ path: file.path, text: file.text })),
      {
        status: revision.status,
        commitSha: revision.commitSha,
        branch: revision.branch,
        repositoryId: revision.repositoryId,
        worktreeId: revision.worktreeId,
        dirty: revision.dirty,
        isLinkedWorktree: revision.isLinkedWorktree
      }
    );
  } catch {
    return snapshotRejection();
  }

  if (!recomputed || recomputed.token !== snapshot.token) {
    return snapshotRejection(SNAPSHOT_TOKEN_MISMATCH_NOTE);
  }
  return { ok: true };
}

function parseTrackSource(text) {
  const morphProject = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      noLib: true,
      target: 99
    }
  });
  const sourceFile = morphProject.createSourceFile("synthetic-fixture.ts", text);
  if (sourceFile.getFullText() !== text) return { ok: false };
  const program = morphProject.getProgram().compilerObject;
  const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile.compilerNode);
  return {
    ok: true,
    sourceFile,
    syntacticDiagnosticCount: syntacticDiagnostics.length
  };
}

function multiSymbolBindingReady({
  name,
  query,
  task,
  project,
  snapshot,
  snapshotTokenMatched,
  completeness,
  paths
}) {
  if (!snapshotTokenMatched || !isPlainObject(snapshot)) return false;
  if (!isPlainObject(query)) return false;
  if (query.domain !== SYMBOL_QUERY_DOMAIN) return false;
  if (!nonEmptyString(query.name) || query.name !== name) return false;
  if (!isPlainObject(task)) return false;
  if (!nonEmptyString(task.id) || task.id.length > 128) return false;
  if (!Array.isArray(task.paths) || task.paths.length !== paths.length) return false;
  if (paths.length < 2 || paths.length > 32) return false;
  for (let index = 0; index < paths.length; index += 1) {
    if (task.paths[index] !== paths[index]) return false;
  }
  if (!isPlainObject(project)) return false;
  if (!nonEmptyString(project.projectId) || !nonEmptyString(project.rootId) || !nonEmptyString(project.relativePath)) {
    return false;
  }
  if (project.projectId !== snapshot.projectId) return false;
  if (!revisionAllowsUnique(snapshot.revision)) return false;
  if (readInstalledTypescriptVersion() !== CONTRACT_TYPESCRIPT_PARSER_VERSION) return false;
  if (!isPlainObject(completeness)) return false;
  if (completeness.source !== "complete" || completeness.parse !== "complete" || completeness.enumeration !== "complete") {
    return false;
  }
  return true;
}

function multiUniqueBindingReady(args) {
  if (!multiSymbolBindingReady(args)) return false;
  const { occurrences } = args;
  if (!Array.isArray(occurrences) || occurrences.length !== 1) return false;
  const occurrence = occurrences[0];
  if (!isPlainObject(occurrence)) return false;
  if (typeof occurrence.declarationId !== "string" || !HEX64.test(occurrence.declarationId)) return false;
  if (occurrence.symbolId !== "symbol_" + occurrence.declarationId) return false;
  return true;
}

function resolveMulti(input, paths) {
  const { name, files, binding, providerNode, snapshot, task, query, project } = input;
  const collected = collectRawOrderedFiles(paths, files);
  if (!collected || collected.kind === "invalid") {
    return notEvaluated(
      withCompleteness(
        { notes: [FILES_WERE_REJECTED_NOTE] },
        buildCompleteness()
      ),
      providerNode
    );
  }
  if (collected.kind === "oversized") {
    return sourceByteCeilingResult(providerNode);
  }
  const rawFiles = collected.files;
  const ordered = decodeOrderedFiles(rawFiles);
  if (!ordered) {
    return notEvaluated(
      withCompleteness(
        { notes: [FILES_WERE_REJECTED_NOTE] },
        buildCompleteness()
      ),
      providerNode
    );
  }

  const combinedSha = sha256Bytes(Buffer.concat(ordered.map((file) => file.bytes)));
  if (!isPlainObject(binding) || typeof binding.sourceSha256 !== "string" || binding.sourceSha256.length === 0) {
    return notEvaluated(
      withCompleteness(
        { notes: [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE] },
        buildCompleteness()
      ),
      providerNode
    );
  }
  if (binding.sourceSha256 !== combinedSha) {
    return notEvaluated(
      withCompleteness(
        { notes: [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE] },
        buildCompleteness()
      ),
      providerNode
    );
  }

  let snapshotTokenMatched = false;
  if (snapshot !== undefined) {
    const checked = recomputeMultiSnapshotToken(snapshot, ordered);
    if (!checked.ok) {
      const extra = { notes: [checked.note] };
      return notEvaluated(withCompleteness(extra, buildCompleteness()), providerNode);
    }
    snapshotTokenMatched = true;
  }

  const parsedFiles = [];
  for (const file of ordered) {
    const parsed = parseTrackSource(file.text);
    if (!parsed.ok) {
      return withParsedProvider(notEvaluated(
        withCompleteness(
          { notes: [SOURCE_DID_NOT_ROUND_TRIP_NOTE] },
          buildCompleteness()
        ),
        providerNode
      ));
    }
    parsedFiles.push({ ...file, ...parsed });
  }

  const retained = retainParsedMatches(parsedFiles, name);
  const pathRecords = retained.files.map((entry) => buildPathRecord({
    path: entry.file.path,
    sha256: entry.file.sha256,
    byteSize: entry.file.bytes.length,
    syntacticDiagnosticCount: entry.file.syntacticDiagnosticCount,
    unsupportedForm: fileHasUnsupportedDeclarationForm(entry.file.sourceFile),
    matched: entry.matches.length,
    enumerationPartial: entry.enumerationPartial
  }));

  let syntacticDiagnosticCount = 0;
  let census = 0;
  const rawOccurrences = [];
  for (const entry of retained.files) {
    syntacticDiagnosticCount += entry.file.syntacticDiagnosticCount;
    census += entry.matches.length;
    rawOccurrences.push(...qualifyingOccurrences(entry.matches, entry.file.sourceFile, entry.file.path));
  }

  const coverageWithDiagnostics = {
    wholeByteString: true,
    syntacticDiagnosticCount
  };
  if (syntacticDiagnosticCount > 0) {
    const completeness = buildCompleteness({
      snapshotTokenMatched,
      parsed: true,
      syntacticDiagnosticCount,
      unsupportedForm: false
    });
    const base = { census, coverage: coverageWithDiagnostics };
    if (census >= 2) {
      const matched = applyMatchCeiling(
        { ...base, notes: [AMBIGUOUS_DIRECT_NOTE] },
        completeness,
        retained.exhausted
      );
      const applied = applyInspectionCeiling(matched.extra, matched.completeness, retained.inspectionExhausted);
      return deliverParsed(ambiguous(
        withMatchCounts(withCompleteness(applied.extra, applied.completeness), task.paths.length, task.paths.length),
        providerNode
      ), pathRecords);
    }
    const applied = applyInspectionCeiling(base, completeness, retained.inspectionExhausted);
    return deliverParsed(partial(withMatchCounts(withCompleteness(applied.extra, applied.completeness), task.paths.length, task.paths.length), providerNode), pathRecords);
  }

  let unsupportedForm = false;
  for (const file of parsedFiles) {
    if (fileHasUnsupportedDeclarationForm(file.sourceFile)) unsupportedForm = true;
  }

  const shaByPath = new Map(ordered.map((file) => [file.path, file.sha256]));
  const occurrences = attachDeclarationIds(rawOccurrences, snapshotTokenMatched, snapshot, shaByPath);
  const coverage = {
    wholeByteString: true,
    syntacticDiagnosticCount: 0
  };
  const completeness = buildCompleteness({
    snapshotTokenMatched,
    parsed: true,
    syntacticDiagnosticCount: 0,
    unsupportedForm
  });

  if (unsupportedForm) {
    const notes = [UNSUPPORTED_FORM_NOTE];
    if (snapshotTokenMatched && !occurrencesHaveDeclarationId(occurrences)) {
      notes.push(SNAPSHOT_TOKEN_MATCHED_NOTE);
    }
    if (census >= 2) {
      notes.push(AMBIGUOUS_DIRECT_NOTE);
      withSymbolIdSnapshotNote(notes, occurrences);
      const matched = applyMatchCeiling(
        { census, coverage, notes, occurrences },
        completeness,
        retained.exhausted
      );
      const applied = applyInspectionCeiling(matched.extra, matched.completeness, retained.inspectionExhausted);
      return deliverParsed(ambiguous(
        withMatchCounts(withCompleteness(applied.extra, applied.completeness), task.paths.length, task.paths.length),
        providerNode
      ), pathRecords);
    }
    withSymbolIdSnapshotNote(notes, occurrences);
    const inspectedPartial = applyInspectionCeiling(
      { census, coverage, notes, occurrences },
      completeness,
      retained.inspectionExhausted
    );
    return deliverParsed(partial(
      withMatchCounts(withCompleteness(inspectedPartial.extra, inspectedPartial.completeness), task.paths.length, task.paths.length),
      providerNode
    ), pathRecords);
  }

  if (census >= 2) {
    const notes = withSymbolIdSnapshotNote([AMBIGUOUS_DIRECT_NOTE], occurrences);
    const matched = applyMatchCeiling(
      { census, coverage, notes, occurrences },
      completeness,
      retained.exhausted
    );
    const applied = applyInspectionCeiling(matched.extra, matched.completeness, retained.inspectionExhausted);
    return deliverParsed(ambiguous(
      withMatchCounts(withCompleteness(applied.extra, applied.completeness), task.paths.length, task.paths.length),
      providerNode
    ), pathRecords);
  }

  if (census === 0) {
    if (retained.inspectionExhausted) {
      const stopped = applyInspectionCeiling(
        { census, coverage, notes: withSymbolIdSnapshotNote([], occurrences), occurrences },
        completeness,
        true
      );
      return deliverParsed(partial(
        withMatchCounts(withCompleteness(stopped.extra, stopped.completeness), task.paths.length, task.paths.length),
        providerNode
      ), pathRecords);
    }
    if (multiSymbolBindingReady({
      name,
      query,
      task,
      project,
      snapshot,
      snapshotTokenMatched,
      completeness,
      paths
    })) {
      return deliverParsed(attachProviderIdNote(notFoundResult({
        coverage,
        completeness,
        snapshot,
        project,
        task,
        query,
        actualSha: combinedSha
      }), providerNode), pathRecords);
    }
    const notes = [OUTPUT_COVERAGE_INCOMPLETE_NOTE];
    withSymbolIdSnapshotNote(notes, occurrences);
    return deliverParsed(notEvaluated(
      withCompleteness({ census, coverage, notes, occurrences }, completeness),
      providerNode
    ), pathRecords);
  }

  if (retained.inspectionExhausted) {
    const stopped = applyInspectionCeiling(
      { census: 1, coverage, notes: withSymbolIdSnapshotNote([], occurrences), occurrences },
      completeness,
      true
    );
    return deliverParsed(partial(
      withMatchCounts(withCompleteness(stopped.extra, stopped.completeness), task.paths.length, task.paths.length),
      providerNode
    ), pathRecords);
  }
  const notes = [NOT_ACCEPTED_NOTE];
  if (snapshotTokenMatched && !occurrencesHaveDeclarationId(occurrences)) {
    notes.push(SNAPSHOT_TOKEN_MATCHED_NOTE);
  }
  notes.push(OUTPUT_COVERAGE_INCOMPLETE_NOTE);
  withSymbolIdSnapshotNote(notes, occurrences);
  const evaluated = withCompleteness({
    census: 1,
    coverage,
    notes,
    occurrences
  }, completeness);
  if (multiUniqueBindingReady({
    name,
    query,
    task,
    project,
    snapshot,
    snapshotTokenMatched,
    occurrences,
    completeness,
    paths
  })) {
    return deliverParsed(attachProviderIdNote(resolvedUniqueResult({
      occurrences,
      coverage,
      completeness,
      snapshot,
      project,
      task,
      query,
      actualSha: combinedSha
    }), providerNode), pathRecords);
  }
  return deliverParsed(notEvaluated(evaluated, providerNode), pathRecords);
}

function pathExceedsCharacterCeiling(task, project) {
  if (isPlainObject(task) && Array.isArray(task.paths)) {
    for (const path of task.paths) {
      if (typeof path === "string" && path.length > 1024) return true;
    }
  }
  if (isPlainObject(project) && typeof project.relativePath === "string" && project.relativePath.length > 1024) {
    return true;
  }
  return false;
}

function branchExceedsCharacterCeiling(snapshot) {
  if (!isPlainObject(snapshot) || !isPlainObject(snapshot.revision)) return false;
  const branch = snapshot.revision.branch;
  return typeof branch === "string" && branch.length > 512;
}

function identifierCeilingNotes(project, snapshot) {
  const notes = [];
  const projectId = isPlainObject(project) ? project.projectId : undefined;
  const snapshotProjectId = isPlainObject(snapshot) ? snapshot.projectId : undefined;
  const rootId = isPlainObject(project) ? project.rootId : undefined;
  if (
    (typeof projectId === "string" && projectId.length > 128) ||
    (typeof snapshotProjectId === "string" && snapshotProjectId.length > 128)
  ) {
    notes.push("projectId exceeds 128 characters");
  }
  if (typeof rootId === "string" && rootId.length > 128) {
    notes.push("rootId exceeds 128 characters");
  }
  return notes;
}

function resolveTrackA1Body(input = {}) {
  const { name, sourceBytes, binding, providerNode, snapshot, task, query, project } = input;

  if (typeof name !== "string" || name.length === 0) {
    return notEvaluated({ notes: [NAME_WAS_REJECTED_NOTE] }, providerNode);
  }

  const queryName = isPlainObject(query) ? query.name : undefined;
  if (name.length > 128 || (typeof queryName === "string" && queryName.length > 128)) {
    return notEvaluated({ notes: ["name exceeds 128 characters"] }, providerNode);
  }

  if (pathExceedsCharacterCeiling(task, project)) {
    return notEvaluated({ notes: ["path exceeds 1024 characters"] }, providerNode);
  }

  const idNotes = identifierCeilingNotes(project, snapshot);
  if (idNotes.length > 0) {
    return notEvaluated({ notes: idNotes }, providerNode);
  }

  if (branchExceedsCharacterCeiling(snapshot)) {
    return notEvaluated({ notes: ["branch exceeds 512 characters"] }, providerNode);
  }

  const earlyScope = resolveTaskPathScope(task);
  if (earlyScope.kind === "multi") {
    return resolveMulti(input, earlyScope.paths);
  }

  let bytes;
  if (isAllowedByteLeaf(sourceBytes)) {
    // Ceiling on the raw leaf before any copy or Buffer.from.
    if (exceedsSourceByteCeiling([uint8ArrayLengthWithoutOwnGet(sourceBytes)])) {
      return sourceByteCeilingResult(providerNode);
    }
    bytes = copyByteLeafToBuffer(sourceBytes);
  } else {
    bytes = toBuffer(sourceBytes);
    if (!bytes) {
      return notEvaluated({ notes: [SOURCE_BYTES_WERE_REJECTED_NOTE] }, providerNode);
    }
    if (exceedsSourceByteCeiling([bytes.byteLength])) {
      return sourceByteCeilingResult(providerNode);
    }
  }

  if (!isPlainObject(binding) || typeof binding.sourceSha256 !== "string" || binding.sourceSha256.length === 0) {
    return notEvaluated({ notes: [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE] }, providerNode);
  }

  const actualSha = sha256Bytes(bytes);
  if (actualSha !== binding.sourceSha256) {
    return notEvaluated({ notes: [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE] }, providerNode);
  }

  const pathScope = resolveTaskPathScope(task);
  const pathScoped = pathScope.kind === "single";

  if (pathScope.kind === "unsupported_count") {
    return notEvaluated(
      withCompleteness(
        { notes: [TASK_PATH_COUNT_EXCEEDS_32_NOTE] },
        buildCompleteness()
      ),
      providerNode
    );
  }

  if (pathScope.kind === "invalid") {
    return notEvaluated(
      withCompleteness(
        { notes: [TASK_PATHS_WERE_REJECTED_NOTE] },
        buildCompleteness()
      ),
      providerNode
    );
  }

  let snapshotTokenMatched = false;
  if (snapshot !== undefined) {
    const checked = recomputeSnapshotToken(snapshot, bytes, binding, actualSha);
    if (!checked.ok) {
      const extra = { notes: [checked.note] };
      if (pathScoped) {
        return notEvaluated(withCompleteness(extra, buildCompleteness()), providerNode);
      }
      return notEvaluated(extra, providerNode);
    }
    snapshotTokenMatched = true;
  }

  const text = bytes.toString("utf8");
  const morphProject = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      noLib: true,
      target: 99
    }
  });

  const sourceFile = morphProject.createSourceFile("synthetic-fixture.ts", text);
  if (sourceFile.getFullText() !== text) {
    if (pathScoped) {
      return withParsedProvider(notEvaluated(
        withCompleteness(
          { notes: [SOURCE_DID_NOT_ROUND_TRIP_NOTE] },
          buildCompleteness()
        ),
        providerNode
      ));
    }
    return withParsedProvider(notEvaluated({ notes: [SOURCE_DID_NOT_ROUND_TRIP_NOTE] }, providerNode));
  }

  const program = morphProject.getProgram().compilerObject;
  const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile.compilerNode);
  const syntacticDiagnosticCount = syntacticDiagnostics.length;
  const collectedMatches = censusDeclarations(sourceFile, name);
  const censusEarly = collectedMatches.matches.length;
  const pathRecords = pathScoped
    ? [buildPathRecord({
        path: pathScope.path,
        sha256: actualSha,
        byteSize: bytes.length,
        syntacticDiagnosticCount,
        unsupportedForm: fileHasUnsupportedDeclarationForm(sourceFile),
        matched: censusEarly,
        enumerationPartial: collectedMatches.exhausted || collectedMatches.inspectionExhausted
      })]
    : null;
  const coverageWithDiagnostics = {
    wholeByteString: true,
    syntacticDiagnosticCount
  };

  if (syntacticDiagnosticCount > 0) {
    if (pathScoped && censusEarly < 2) {
      const stopped = applyInspectionCeiling(
        {
          census: censusEarly,
          coverage: coverageWithDiagnostics
        },
        buildCompleteness({
          snapshotTokenMatched,
          parsed: true,
          syntacticDiagnosticCount,
          unsupportedForm: false
        }),
        collectedMatches.inspectionExhausted
      );
      return deliverParsed(partial(
        withMatchCounts(withCompleteness(stopped.extra, stopped.completeness), pathCount(task), pathCount(task)),
        providerNode
      ), pathRecords);
    }
    if (pathScoped) {
      const matched = applyMatchCeiling(
        {
          census: censusEarly,
          coverage: coverageWithDiagnostics,
          notes: [AMBIGUOUS_DIRECT_NOTE]
        },
        buildCompleteness({
          snapshotTokenMatched,
          parsed: true,
          syntacticDiagnosticCount,
          unsupportedForm: false
        }),
        collectedMatches.exhausted
      );
      const applied = applyInspectionCeiling(matched.extra, matched.completeness, collectedMatches.inspectionExhausted);
      return deliverParsed(ambiguous(
        withMatchCounts(withCompleteness(applied.extra, applied.completeness), task.paths.length, task.paths.length),
        providerNode
      ), pathRecords);
    }
    const matched = applyMatchCeiling(
      {
        census: censusEarly,
        coverage: coverageWithDiagnostics
      },
      null,
      collectedMatches.exhausted
    );
    const unevaluated = applyInspectionCeiling(matched.extra, matched.completeness, collectedMatches.inspectionExhausted);
    return deliverParsed(notEvaluated(unevaluated.extra, providerNode), pathRecords);
  }

  const matches = collectedMatches.matches;
  const census = matches.length;
  const matchExhausted = collectedMatches.exhausted;
  const inspectionExhausted = collectedMatches.inspectionExhausted;
  const occurrencePath = pathScoped ? pathScope.path : null;
  const occurrences = attachDeclarationIds(
    qualifyingOccurrences(matches, sourceFile, occurrencePath),
    snapshotTokenMatched,
    snapshot,
    actualSha
  );
  const coverage = {
    wholeByteString: true,
    syntacticDiagnosticCount: 0
  };
  const unsupportedForm = fileHasUnsupportedDeclarationForm(sourceFile);
  const completeness = pathScoped
    ? buildCompleteness({
      snapshotTokenMatched,
      parsed: true,
      syntacticDiagnosticCount: 0,
      unsupportedForm
    })
    : null;

  if (unsupportedForm) {
    const notes = [UNSUPPORTED_FORM_NOTE];
    if (snapshotTokenMatched && !occurrencesHaveDeclarationId(occurrences)) {
      notes.push(SNAPSHOT_TOKEN_MATCHED_NOTE);
    }
    if (census >= 2) {
      notes.push(AMBIGUOUS_DIRECT_NOTE);
      withSymbolIdSnapshotNote(notes, occurrences);
      const matched = applyMatchCeiling(
        { census, coverage, notes, occurrences },
        completeness,
        matchExhausted
      );
      const applied = applyInspectionCeiling(matched.extra, matched.completeness, inspectionExhausted);
      return deliverParsed(ambiguous(
        withMatchCounts(applied.completeness ? withCompleteness(applied.extra, applied.completeness) : applied.extra, pathCount(task), pathScoped ? 1 : 0),
        providerNode
      ), pathRecords);
    }
    withSymbolIdSnapshotNote(notes, occurrences);
    const inspectedPartial = applyInspectionCeiling(
      { census, coverage, notes, occurrences },
      completeness,
      inspectionExhausted
    );
    if (pathScoped) {
      return deliverParsed(partial(
        withMatchCounts(withCompleteness(inspectedPartial.extra, inspectedPartial.completeness), pathCount(task), pathCount(task)),
        providerNode
      ), pathRecords);
    }
    return deliverParsed(notEvaluated(inspectedPartial.extra, providerNode), pathRecords);
  }

  if (census >= 2) {
    const notes = withSymbolIdSnapshotNote([AMBIGUOUS_DIRECT_NOTE], occurrences);
    const matched = applyMatchCeiling(
      { census, coverage, notes, occurrences },
      completeness,
      matchExhausted
    );
    const applied = applyInspectionCeiling(matched.extra, matched.completeness, inspectionExhausted);
    return deliverParsed(ambiguous(
      withMatchCounts(applied.completeness ? withCompleteness(applied.extra, applied.completeness) : applied.extra, pathCount(task), pathScoped ? 1 : 0),
      providerNode
    ), pathRecords);
  }

  if (census !== 1) {
    if (census === 0 && inspectionExhausted) {
      const stopped = applyInspectionCeiling(
        { census, coverage, notes: withSymbolIdSnapshotNote([], occurrences), occurrences },
        completeness,
        true
      );
      const stoppedExtra = completeness ? withCompleteness(stopped.extra, stopped.completeness) : stopped.extra;
      return deliverParsed(partial(
        withMatchCounts(stoppedExtra, pathCount(task), pathScoped ? 1 : 0),
        providerNode
      ), pathRecords);
    }
    if (census === 0 && symbolBindingReady({
      name,
      query,
      task,
      project,
      snapshot,
      snapshotTokenMatched,
      completeness,
      pathScope
    })) {
      return deliverParsed(attachProviderIdNote(notFoundResult({
        coverage,
        completeness,
        snapshot,
        project,
        task,
        query,
        actualSha
      }), providerNode), pathRecords);
    }
    const notes = [];
    if (pathScoped) notes.push(OUTPUT_COVERAGE_INCOMPLETE_NOTE);
    withSymbolIdSnapshotNote(notes, occurrences);
    const extra = notes.length > 0 ? { census, coverage, notes, occurrences } : { census, coverage, occurrences };
    return deliverParsed(notEvaluated(
      completeness ? withCompleteness(extra, completeness) : extra,
      providerNode
    ), pathRecords);
  }

  const notes = [NOT_ACCEPTED_NOTE];
  if (snapshotTokenMatched && !occurrencesHaveDeclarationId(occurrences)) {
    notes.push(SNAPSHOT_TOKEN_MATCHED_NOTE);
  }
  if (pathScoped) notes.push(OUTPUT_COVERAGE_INCOMPLETE_NOTE);
  withSymbolIdSnapshotNote(notes, occurrences);
  const extra = {
    census: 1,
    coverage,
    notes,
    occurrences
  };
  const evaluated = completeness ? withCompleteness(extra, completeness) : extra;
  if (inspectionExhausted) {
    const stopped = applyInspectionCeiling(
      { census: 1, coverage, notes: withSymbolIdSnapshotNote([], occurrences), occurrences },
      completeness,
      true
    );
    const stoppedExtra = completeness ? withCompleteness(stopped.extra, stopped.completeness) : stopped.extra;
    return deliverParsed(partial(
      withMatchCounts(stoppedExtra, pathCount(task), pathScoped ? 1 : 0),
      providerNode
    ), pathRecords);
  }
  if (uniqueBindingReady({
    name,
    query,
    task,
    project,
    snapshot,
    snapshotTokenMatched,
    occurrences,
    completeness,
    pathScope
  })) {
    return deliverParsed(attachProviderIdNote(resolvedUniqueResult({
      occurrences,
      coverage,
      completeness,
      snapshot,
      project,
      task,
      query,
      actualSha
    }), providerNode), pathRecords);
  }
  return deliverParsed(notEvaluated(
    evaluated,
    providerNode
  ), pathRecords);
}

function stampContractIdentity(result) {
  result.schemaVersion = 1;
  result.analysisVersion = "symbol-resolution-evidence-v1";
  result.policyVersion = "tsjs-direct-declarations-1";
  result.generatedAt = null;
  return result;
}

const COMPACT_BYTES_DEFAULT = 65536;
const COMPACT_BYTES_MAX = 131072;
const COMPACT_BYTES_REJECTED_NOTE = "compactBytes override was rejected";

function descriptorHasAccessor(desc) {
  return Object.hasOwn(desc, "get") || Object.hasOwn(desc, "set");
}

function ownDataProperty(object, key) {
  if (object === null || typeof object !== "object") {
    return { kind: "missing" };
  }
  const desc = Object.getOwnPropertyDescriptor(object, key);
  if (!desc) return { kind: "missing" };
  if (descriptorHasAccessor(desc)) return { kind: "accessor" };
  if (!Object.hasOwn(desc, "value")) return { kind: "missing" };
  return { kind: "data", value: desc.value };
}

function readCompactBytesCeiling(input) {
  const limitsOwn = ownDataProperty(input, "limits");
  if (limitsOwn.kind === "accessor") return { kind: "accessor" };
  const limits = limitsOwn.kind === "data" ? limitsOwn.value : undefined;
  if (!isPlainObject(limits)) {
    return { kind: "ok", ceiling: COMPACT_BYTES_DEFAULT };
  }
  const compactOwn = ownDataProperty(limits, "compactBytes");
  if (compactOwn.kind === "accessor") return { kind: "accessor" };
  if (compactOwn.kind === "missing") {
    return { kind: "ok", ceiling: COMPACT_BYTES_DEFAULT };
  }
  const value = compactOwn.value;
  if (!Number.isSafeInteger(value) || value <= 0 || value > COMPACT_BYTES_MAX) {
    return { kind: "rejected" };
  }
  return { kind: "ok", ceiling: value };
}

function rejectCompactBytesOverride(providerNode) {
  return notEvaluated({ notes: [COMPACT_BYTES_REJECTED_NOTE] }, providerNode);
}

function throwIfCompactBytesExceeded(result, ceiling) {
  const size = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (size > ceiling) {
    const error = new Error("symbol_resolution_budget_exceeded");
    error.code = "symbol_resolution_budget_exceeded";
    throw error;
  }
  return result;
}

const NESTING_DEPTH_LIMIT = 32;
const NESTING_EXCEEDED_NOTE = "nesting exceeds 32";
const CYCLIC_INPUT_NOTE = "cyclic input was rejected";
const ACCESSOR_INPUT_NOTE = "accessor input was rejected";
const NON_PLAIN_INPUT_NOTE = "non-plain input was rejected";

function isExactArray(value) {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function isAllowedByteLeaf(value) {
  if (!types.isUint8Array(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Buffer.prototype || proto === Uint8Array.prototype;
}

function inspectByteLeafOwnAccessors(value) {
  // Length is read via the %TypedArray% intrinsic getter (Reflect.apply),
  // never via a normal Get of value.length / value.byteLength.
  // Own-key scan runs only when intrinsic length <= MAX_TRACK_A1_FILE_UTF8_BYTES.
  // Oversized leaves are not scanned here and are rejected later by the body's
  // source-byte ceiling without invoking accessors.
  // Index keys come first in getOwnPropertyNames order; start at `length`.
  const length = uint8ArrayLengthWithoutOwnGet(value);
  if (length > MAX_TRACK_A1_FILE_UTF8_BYTES) return null;
  const names = Object.getOwnPropertyNames(value);
  for (let i = length; i < names.length; i += 1) {
    const desc = Object.getOwnPropertyDescriptor(value, names[i]);
    if (!desc) continue;
    if (Object.hasOwn(desc, "get") || Object.hasOwn(desc, "set")) {
      return ACCESSOR_INPUT_NOTE;
    }
  }
  // Symbol-key accessors stay ignored. Non-index data values on the leaf are
  // not classified as non-plain; byte leaves remain leaves for that purpose.
  return null;
}

function isAllowedTrackA1Value(value) {
  const type = typeof value;
  if (value === null || type === "string" || type === "number" || type === "boolean" || type === "undefined") {
    return true;
  }
  if (type === "bigint" || type === "symbol" || type === "function") {
    return false;
  }
  if (type !== "object") return false;
  if (Array.isArray(value)) {
    return Object.getPrototypeOf(value) === Array.prototype;
  }
  if (isAllowedByteLeaf(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNestingContainer(value) {
  if (isExactArray(value)) return true;
  if (value === null || typeof value !== "object") return false;
  if (ArrayBuffer.isView(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function nestingChildContainers(node) {
  const children = [];
  const names = Object.getOwnPropertyNames(node);
  for (let i = 0; i < names.length; i += 1) {
    const desc = Object.getOwnPropertyDescriptor(node, names[i]);
    if (!desc) continue;
    if (Object.hasOwn(desc, "get") || Object.hasOwn(desc, "set")) {
      return { note: ACCESSOR_INPUT_NOTE, children: null };
    }
    if (!Object.hasOwn(desc, "value")) continue;
    if (!isAllowedTrackA1Value(desc.value)) {
      return { note: NON_PLAIN_INPUT_NOTE, children: null };
    }
    // Byte leaves join the child-visit list; own accessors are scanned when
    // visited, in the same order as object/array children. They are not
    // nesting containers for depth.
    if (isAllowedByteLeaf(desc.value)) {
      children.push(desc.value);
      continue;
    }
    if (isNestingContainer(desc.value)) children.push(desc.value);
  }
  const symbols = Object.getOwnPropertySymbols(node);
  for (let i = 0; i < symbols.length; i += 1) {
    const desc = Object.getOwnPropertyDescriptor(node, symbols[i]);
    if (!desc || !Object.hasOwn(desc, "value")) continue;
    if (!isAllowedTrackA1Value(desc.value)) {
      return { note: NON_PLAIN_INPUT_NOTE, children: null };
    }
    if (isAllowedByteLeaf(desc.value)) {
      children.push(desc.value);
      continue;
    }
    if (isNestingContainer(desc.value)) children.push(desc.value);
  }
  return { note: null, children };
}

function isPlainObjectRoot(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function inspectNesting(root) {
  if (!isPlainObjectRoot(root)) return NON_PLAIN_INPUT_NOTE;
  if (!isNestingContainer(root)) return null;
  const path = [];
  const scannedLeaves = new Set();
  const stack = [{ node: root, depth: 1, children: null, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.children === null) {
      path.push(frame.node);
      const scanned = nestingChildContainers(frame.node);
      if (scanned.note !== null) return scanned.note;
      frame.children = scanned.children;
    }
    if (frame.index >= frame.children.length) {
      path.pop();
      stack.pop();
      continue;
    }
    const child = frame.children[frame.index];
    frame.index += 1;
    if (isAllowedByteLeaf(child)) {
      if (!scannedLeaves.has(child)) {
        scannedLeaves.add(child);
        const leafNote = inspectByteLeafOwnAccessors(child);
        if (leafNote !== null) return leafNote;
      }
      continue;
    }
    if (path.includes(child)) return CYCLIC_INPUT_NOTE;
    const depth = frame.depth + 1;
    if (depth > NESTING_DEPTH_LIMIT) return NESTING_EXCEEDED_NOTE;
    stack.push({ node: child, depth, children: null, index: 0 });
  }
  return null;
}

const VISITED_JSON_VALUE_LIMIT = 20000;
const VISITED_JSON_VALUES_EXCEEDED_NOTE = "visited JSON values exceed 20000";

function isVisitedJsonContainer(value) {
  return isNestingContainer(value);
}

function visitedJsonValuesExceedLimit(root) {
  let count = 0;
  const seen = new Set();
  const stack = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value !== null && typeof value === "object") {
      if (seen.has(value)) continue;
      seen.add(value);
    }
    count += 1;
    if (count > VISITED_JSON_VALUE_LIMIT) return true;
    if (!isVisitedJsonContainer(value)) continue;
    const names = Object.getOwnPropertyNames(value);
    const isArray = Array.isArray(value);
    for (let i = 0; i < names.length; i += 1) {
      const key = names[i];
      if (isArray && key === "length") continue;
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (!desc || !Object.hasOwn(desc, "value")) continue;
      stack.push(desc.value);
    }
  }
  return false;
}

function providerNodeArg(input) {
  const providerOwn = ownDataProperty(input, "providerNode");
  if (providerOwn.kind === "data") return providerOwn.value;
  return undefined;
}

export function resolveTrackA1(input) {
  const compact = readCompactBytesCeiling(input);
  if (compact.kind === "accessor") {
    return stampContractIdentity(notEvaluated({ notes: [ACCESSOR_INPUT_NOTE] }));
  }
  if (compact.kind === "rejected") {
    const providerOwn = ownDataProperty(input, "providerNode");
    if (providerOwn.kind === "accessor") {
      return stampContractIdentity(notEvaluated({ notes: [ACCESSOR_INPUT_NOTE] }));
    }
    const providerNode = providerOwn.kind === "data" ? providerOwn.value : undefined;
    return stampContractIdentity(rejectCompactBytesOverride(providerNode));
  }
  const ceiling = compact.ceiling;
  const nestingNote = inspectNesting(input);
  if (nestingNote !== null) {
    return stampContractIdentity(notEvaluated({ notes: [nestingNote] }, providerNodeArg(input)));
  }
  if (visitedJsonValuesExceedLimit(input)) {
    return stampContractIdentity(notEvaluated({ notes: [VISITED_JSON_VALUES_EXCEEDED_NOTE] }, providerNodeArg(input)));
  }
  const result = stampContractIdentity(resolveTrackA1Body(input));
  return throwIfCompactBytesExceeded(result, ceiling);
}
