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

function notEvaluated(extra = {}) {
  const result = { status: "not_evaluated", ...extra };
  // Ambiguity and insufficient evidence stay not_evaluated with no stable id.
  if (Object.hasOwn(result, "stableId")) delete result.stableId;
  return result;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
 * Positive only when census === 1, the whole byte string has no syntactic
 * parse diagnostics, and the caller-supplied binding matches the source sha256.
 * Does not invent provider identities; does not copy repositoryIdentity into
 * repositoryId; does not consult composeEffectiveTaskScope / providers.
 */
export function resolveTrackA1(input = {}) {
  const { name, sourceBytes, binding, providerNode } = input;

  if (typeof name !== "string" || name.length === 0) {
    return notEvaluated();
  }

  const bytes = toBuffer(sourceBytes);
  if (!bytes) {
    return notEvaluated();
  }

  if (!isPlainObject(binding) || typeof binding.sourceSha256 !== "string" || binding.sourceSha256.length === 0) {
    return notEvaluated();
  }

  const actualSha = sha256Bytes(bytes);
  if (actualSha !== binding.sourceSha256) {
    return notEvaluated();
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
    return notEvaluated();
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
    });
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
    });
  }

  const result = {
    status: "positive",
    census: 1,
    coverage: {
      wholeByteString: true,
      syntacticDiagnosticCount: 0
    },
    binding: { sourceSha256: binding.sourceSha256 }
  };

  // Stable id may be copied from one provider node only AFTER census === 1.
  // If we cannot obtain one without inventing identity, omit it and say so.
  if (isPlainObject(providerNode) && typeof providerNode.id === "string" && providerNode.id.length > 0) {
    result.stableId = providerNode.id;
  } else {
    result.notes = ["stable id omitted: no provider node id supplied; refusing to invent identity"];
  }

  return result;
}
