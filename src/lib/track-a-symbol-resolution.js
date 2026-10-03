import { createHash } from "node:crypto";
import { Project, SyntaxKind } from "ts-morph";
import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";

const QUALIFYING_DIRECT_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.EnumDeclaration
]);

const UNSUPPORTED_FORM_NOTE =
  "path is incomplete because of an unsupported declaration form";

const NOT_ACCEPTED_NOTE =
  "source-hash match is not full observation binding and is not accepted A1 evidence";

const PROVIDER_ID_NOT_COPIED_NOTE =
  "provider node id was not validated against the symbol, file, and snapshot and was not copied";

const SNAPSHOT_TOKEN_MISMATCH_NOTE = "snapshot token did not recompute";

const SNAPSHOT_TOKEN_MATCHED_NOTE =
  "snapshot token matched the supplied bytes but this is not accepted A1 evidence (declaration identity and completeness are not produced here)";

const HEX64 = /^[a-f0-9]{64}$/;

function notEvaluated(extra = {}, providerNode) {
  const result = { status: "not_evaluated", ...extra };
  // Ambiguity and insufficient evidence stay not_evaluated with no stable id.
  if (Object.hasOwn(result, "stableId")) delete result.stableId;
  if (providerNodeSuppliedId(providerNode)) {
    const notes = Array.isArray(result.notes) ? result.notes.slice() : [];
    if (!notes.includes(PROVIDER_ID_NOT_COPIED_NOTE)) notes.push(PROVIDER_ID_NOT_COPIED_NOTE);
    result.notes = notes;
  }
  return result;
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
      found = true;
      return;
    }
    if (kind !== SyntaxKind.VariableDeclaration) return;
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
  // repositoryIdentity is not a substitute for repositoryId and must not be projected.
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
    // The helper requires file text and recomputes sha256 from those bytes.
    // Pass repositoryId only so it cannot project repositoryIdentity.
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

/**
 * Track A1 symbol-resolution producer.
 *
 * Census only direct source-file declarations of `name` (identifier-named
 * function, class, interface, type alias, enum, or source-file variable).
 * Methods, parameters, members, nested declarations, and import/export aliases
 * are outside the domain and do not increase the census. A non-identifier
 * variable binding or a namespace/module declaration leaves the path incomplete
 * and a remaining top-level name match is not accepted evidence.
 * Fail closed unless the bytes, source sha256, UTF-8 roundtrip, syntactic
 * diagnostics, and declaration census are all usable. A census of 1 plus a
 * matching source sha256 is still not full observation binding and is not
 * accepted A1 evidence. Provider node ids are never copied. Extra binding
 * fields are ignored. Does not invent project, repository, worktree, snapshot,
 * or path identity, and does not consult composeEffectiveTaskScope / providers.
 */
export function resolveTrackA1(input = {}) {
  const { name, sourceBytes, binding, providerNode, snapshot } = input;

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

  let snapshotTokenMatched = false;
  if (snapshot !== undefined) {
    const checked = recomputeSnapshotToken(snapshot, bytes, binding, actualSha);
    if (!checked.ok) {
      return notEvaluated(checked.note ? { notes: [checked.note] } : {}, providerNode);
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
  // Coverage: the source file text must be exactly the supplied byte string.
  if (sourceFile.getFullText() !== text) {
    return notEvaluated({}, providerNode);
  }

  const program = project.getProgram().compilerObject;
  const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile.compilerNode);
  if (syntacticDiagnostics.length > 0) {
    return notEvaluated({
      census: censusDeclarations(sourceFile, name).length,
      coverage: {
        wholeByteString: true,
        syntacticDiagnosticCount: syntacticDiagnostics.length
      }
    }, providerNode);
  }

  const matches = censusDeclarations(sourceFile, name);
  const census = matches.length;
  const coverage = {
    wholeByteString: true,
    syntacticDiagnosticCount: 0
  };

  // Destructuring and namespace/module forms are not dropped silently.
  // Do not treat a remaining top-level name match as accepted evidence.
  if (fileHasUnsupportedDeclarationForm(sourceFile)) {
    const notes = [UNSUPPORTED_FORM_NOTE];
    if (snapshotTokenMatched) notes.push(SNAPSHOT_TOKEN_MATCHED_NOTE);
    return notEvaluated({
      census,
      coverage,
      notes
    }, providerNode);
  }

  if (census !== 1) {
    return notEvaluated({
      census,
      coverage
    }, providerNode);
  }

  // Matching sourceSha256 and census === 1 are not observation binding.
  // Do not copy providerNode.id or any other provider field. Ignore unknown
  // binding fields; they are not proof.
  return notEvaluated({
    census: 1,
    coverage,
    notes: snapshotTokenMatched ? [NOT_ACCEPTED_NOTE, SNAPSHOT_TOKEN_MATCHED_NOTE] : [NOT_ACCEPTED_NOTE]
  }, providerNode);
}
