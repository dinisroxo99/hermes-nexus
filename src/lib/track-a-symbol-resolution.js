import { createHash } from "node:crypto";
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

const SNAPSHOT_TOKEN_MATCHED_NOTE =
  "snapshot token matched the supplied bytes but this is not accepted A1 evidence (declaration identity and completeness are not produced here)";

const SYMBOL_ID_SNAPSHOT_NOTE =
  "symbol id is the declaration id for this snapshot only and is not stable across snapshots";

const SINGLE_PATH_ONLY_NOTE =
  "only a single explicit path is implemented";

const OUTPUT_COVERAGE_INCOMPLETE_NOTE =
  "output coverage is not complete, so this is neither not_found nor resolved_unique";

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

function providerNodeSuppliedId(providerNode) {
  return isPlainObject(providerNode) && Object.hasOwn(providerNode, "id") && providerNode.id != null && providerNode.id !== "";
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function toBuffer(sourceBytes) {
  if (Buffer.isBuffer(sourceBytes)) return sourceBytes;
  if (sourceBytes instanceof Uint8Array) return Buffer.from(sourceBytes);
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

function censusDeclarations(sourceFile, name) {
  const matches = [];
  for (const statement of sourceFile.getStatements()) {
    const kind = statement.getKind();
    if (QUALIFYING_DIRECT_KINDS.has(kind)) {
      if (identifierName(statement) === name) matches.push(statement);
      continue;
    }
    if (kind !== SyntaxKind.VariableStatement) continue;
    const declarationList = statement.getDeclarationList();
    for (const declaration of declarationList.getDeclarations()) {
      if (!isSourceFileVariableDeclaration(declaration)) continue;
      if (identifierName(declaration) === name) matches.push(declaration);
    }
  }
  return matches;
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
    const declarationId = contextDigest(JSON.stringify([
      "tsjs-direct-declarations-1",
      "native.typescript.declarations",
      "1",
      parserString,
      snapshotToken,
      occurrence.path,
      sourceSha256,
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
  return note ? { ok: false, note } : { ok: false };
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
  if (task.paths.length !== 1) {
    return { kind: "unsupported_count" };
  }
  const path = task.paths[0];
  if (typeof path !== "string" || path.length === 0) {
    return { kind: "invalid" };
  }
  if (isAbsolutePath(path) || path.includes("..")) {
    return { kind: "invalid" };
  }
  return { kind: "single", path };
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
 * resolved_unique. Parse diagnostics contribute no occurrence records. A census of 0 or 1,
 * including a matching source sha256, stays not_evaluated and is still not
 * full observation binding and is not accepted A1 evidence. When task.paths
 * supplies exactly one relative path, incomplete parse or unsupported forms
 * with census < 2 become partial with an explicit completeness record; a clean
 * single or zero match stays not_evaluated because output coverage is not
 * complete. Provider node ids are never copied. Extra binding fields are
 * ignored. Does not invent project, repository, worktree, snapshot, or path
 * identity, and does not consult composeEffectiveTaskScope / providers.
 */
export function resolveTrackA1(input = {}) {
  const { name, sourceBytes, binding, providerNode, snapshot, task } = input;

  if (typeof name !== "string" || name.length === 0) {
    return notEvaluated({}, providerNode);
  }

  const bytes = toBuffer(sourceBytes);
  if (!bytes) {
    return notEvaluated({}, providerNode);
  }

  if (!isPlainObject(binding) || typeof binding.sourceSha256 !== "string" || binding.sourceSha256.length === 0) {
    return notEvaluated({}, providerNode);
  }

  const actualSha = sha256Bytes(bytes);
  if (actualSha !== binding.sourceSha256) {
    return notEvaluated({}, providerNode);
  }

  const pathScope = resolveTaskPathScope(task);
  const pathScoped = pathScope.kind === "single";

  if (pathScope.kind === "unsupported_count") {
    return notEvaluated(
      withCompleteness(
        { notes: [SINGLE_PATH_ONLY_NOTE] },
        buildCompleteness()
      ),
      providerNode
    );
  }

  if (pathScope.kind === "invalid") {
    return notEvaluated(
      withCompleteness({}, buildCompleteness()),
      providerNode
    );
  }

  let snapshotTokenMatched = false;
  if (snapshot !== undefined) {
    const checked = recomputeSnapshotToken(snapshot, bytes, binding, actualSha);
    if (!checked.ok) {
      const extra = checked.note ? { notes: [checked.note] } : {};
      if (pathScoped) {
        return notEvaluated(withCompleteness(extra, buildCompleteness()), providerNode);
      }
      return notEvaluated(extra, providerNode);
    }
    snapshotTokenMatched = true;
  }

  const text = bytes.toString("utf8");
  const project = new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: {
      allowJs: true,
      noLib: true,
      target: 99
    }
  });

  const sourceFile = project.createSourceFile("synthetic-fixture.ts", text);
  if (sourceFile.getFullText() !== text) {
    if (pathScoped) {
      return withParsedProvider(notEvaluated(withCompleteness({}, buildCompleteness()), providerNode));
    }
    return withParsedProvider(notEvaluated({}, providerNode));
  }

  const program = project.getProgram().compilerObject;
  const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile.compilerNode);
  const syntacticDiagnosticCount = syntacticDiagnostics.length;
  const censusEarly = censusDeclarations(sourceFile, name).length;
  const coverageWithDiagnostics = {
    wholeByteString: true,
    syntacticDiagnosticCount
  };

  if (syntacticDiagnosticCount > 0) {
    if (pathScoped && censusEarly < 2) {
      return withParsedProvider(partial(
        withCompleteness(
          {
            census: censusEarly,
            coverage: coverageWithDiagnostics
          },
          buildCompleteness({
            snapshotTokenMatched,
            parsed: true,
            syntacticDiagnosticCount,
            unsupportedForm: false
          })
        ),
        providerNode
      ));
    }
    if (pathScoped) {
      return withParsedProvider(ambiguous(
        withCompleteness(
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
          })
        ),
        providerNode
      ));
    }
    return withParsedProvider(notEvaluated({
      census: censusEarly,
      coverage: coverageWithDiagnostics
    }, providerNode));
  }

  const matches = censusDeclarations(sourceFile, name);
  const census = matches.length;
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
      const extra = { census, coverage, notes, occurrences };
      return withParsedProvider(ambiguous(
        completeness ? withCompleteness(extra, completeness) : extra,
        providerNode
      ));
    }
    withSymbolIdSnapshotNote(notes, occurrences);
    if (pathScoped) {
      return withParsedProvider(partial(
        withCompleteness({ census, coverage, notes, occurrences }, completeness),
        providerNode
      ));
    }
    return withParsedProvider(notEvaluated({
      census,
      coverage,
      notes,
      occurrences
    }, providerNode));
  }

  if (census >= 2) {
    const notes = withSymbolIdSnapshotNote([AMBIGUOUS_DIRECT_NOTE], occurrences);
    const extra = {
      census,
      coverage,
      notes,
      occurrences
    };
    return withParsedProvider(ambiguous(
      completeness ? withCompleteness(extra, completeness) : extra,
      providerNode
    ));
  }

  if (census !== 1) {
    const notes = [];
    if (pathScoped) notes.push(OUTPUT_COVERAGE_INCOMPLETE_NOTE);
    withSymbolIdSnapshotNote(notes, occurrences);
    const extra = notes.length > 0 ? { census, coverage, notes, occurrences } : { census, coverage, occurrences };
    return withParsedProvider(notEvaluated(
      completeness ? withCompleteness(extra, completeness) : extra,
      providerNode
    ));
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
  return withParsedProvider(notEvaluated(
    completeness ? withCompleteness(extra, completeness) : extra,
    providerNode
  ));
}