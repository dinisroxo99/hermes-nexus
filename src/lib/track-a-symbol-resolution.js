import { createHash } from "node:crypto";
import { Project, SyntaxKind } from "ts-morph";

const DECLARATION_KINDS = new Set([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.ClassDeclaration,
  SyntaxKind.InterfaceDeclaration,
  SyntaxKind.TypeAliasDeclaration,
  SyntaxKind.EnumDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.VariableDeclaration
]);

const NOT_ACCEPTED_NOTE =
  "source-hash match is not full observation binding and is not accepted A1 evidence";

const PROVIDER_ID_NOT_COPIED_NOTE =
  "provider node id was not validated against the symbol, file, and snapshot and was not copied";

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

function censusDeclarations(sourceFile, name) {
  const matches = [];
  sourceFile.forEachDescendant((node) => {
    if (!DECLARATION_KINDS.has(node.getKind())) return;
    const getName = node.getName?.bind(node);
    if (typeof getName !== "function") return;
    let declaredName;
    try {
      declaredName = getName();
    } catch {
      return;
    }
    if (declaredName === name) matches.push(node);
  });
  return matches;
}

/**
 * Track A1 symbol-resolution producer.
 *
 * Census declarations of `name` in the supplied bytes (including nested).
 * Fail closed unless the bytes, source sha256, UTF-8 roundtrip, syntactic
 * diagnostics, and declaration census are all usable. A census of 1 plus a
 * matching source sha256 is still not full observation binding and is not
 * accepted A1 evidence. Provider node ids are never copied. Extra binding
 * fields are ignored. Does not invent project, repository, worktree, snapshot,
 * or path identity, and does not consult composeEffectiveTaskScope / providers.
 */
export function resolveTrackA1(input = {}) {
  const { name, sourceBytes, binding, providerNode } = input;

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

  if (census !== 1) {
    return notEvaluated({
      census,
      coverage: {
        wholeByteString: true,
        syntacticDiagnosticCount: 0
      }
    }, providerNode);
  }

  // Matching sourceSha256 and census === 1 are not observation binding.
  // Do not copy providerNode.id or any other provider field. Ignore unknown
  // binding fields; they are not proof.
  return notEvaluated({
    census: 1,
    coverage: {
      wholeByteString: true,
      syntacticDiagnosticCount: 0
    },
    notes: [NOT_ACCEPTED_NOTE]
  }, providerNode);
}
