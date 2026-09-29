import { validateProjectId } from "./project-registry.js";
import { validateRelativeProjectPath } from "./project-roots.js";
import { normalizeImpactPaths } from "./impact-policy.js";

export const EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION = 2;
export const EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION = "effective-task-scope-v2";
export const EFFECTIVE_TASK_SCOPE_POLICY_VERSION = "step4-foundation-1";

export const ETS_STATUSES = Object.freeze([
  "available",
  "incomplete",
  "not_evaluated",
  "rejected",
  "stale"
]);

export const ETS_CATEGORY_STATUSES = Object.freeze(["available", "incomplete", "not_evaluated"]);

export const CHANGE_SEMANTICS_CATEGORIES = Object.freeze([
  "documentation",
  "test_only",
  "local_implementation",
  "public_signature",
  "interface_contract",
  "schema_migration",
  "unknown"
]);

export const ETS_COMPLETENESS_DIMENSIONS = Object.freeze(["source", "provider", "traversal", "output", "resolver"]);

export const DOCUMENTATION_EXTENSIONS = Object.freeze([".md", ".rst", ".txt"]);

const CONTROL = /[\u0000-\u001f\u007f]/;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const OPAQUE_ID_PATTERN = /^[a-f0-9]{64}$/;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const effectiveTaskScopeError = (code = "invalid_effective_task_scope_request", message = "Invalid effective task scope request.") =>
  Object.assign(new Error(message), { code });

function assertRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw effectiveTaskScopeError("invalid_record", "Expected record object.");
  }
}

function assertAllowedFields(obj, allowed) {
  const keys = Object.keys(obj);
  if (keys.some((k) => !allowed.includes(k))) {
    throw effectiveTaskScopeError("unexpected_field", "Unexpected field in record.");
  }
}

function boundedText(value, max, required = false) {
  if (value === undefined || value === null) {
    if (required) throw effectiveTaskScopeError("missing_required_text");
    return "";
  }
  if (typeof value !== "string") throw effectiveTaskScopeError("invalid_text_type");
  if (value.length > max || CONTROL.test(value)) throw effectiveTaskScopeError("text_bounds_exceeded");
  if (required && value.trim().length === 0) throw effectiveTaskScopeError("empty_required_text");
  return value;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeEffectiveTaskScopeRequest(input) {
  const invalid = () => effectiveTaskScopeError("invalid_effective_task_scope_request", "Invalid bounded effective task scope request.");
  assertRecord(input);

  const allowed = ["task", "projectId", "worktree", "expectedRevision", "includeTests", "changeSemantics", "limits"];
  assertAllowedFields(input, allowed);

  if (!Object.hasOwn(input, "task") || !Object.hasOwn(input, "projectId") ||
      !Object.hasOwn(input, "worktree") || !Object.hasOwn(input, "expectedRevision") ||
      !Object.hasOwn(input, "includeTests")) {
    throw invalid();
  }

  validateProjectId(input.projectId);

  // task
  assertRecord(input.task);
  const taskAllowed = ["id", "title", "paths", "symbols"];
  assertAllowedFields(input.task, taskAllowed);
  const taskId = input.task.id !== undefined ? boundedText(input.task.id, 128) : null;
  if (taskId === null || taskId.trim().length === 0) throw invalid();
  const title = boundedText(input.task.title, 200, true);
  if (!Array.isArray(input.task.paths) || input.task.paths.length < 1 || input.task.paths.length > 32) throw invalid();
  // validate via normalizeImpactPaths + reject spelling change (no repair)
  const rawPaths = input.task.paths;
  for (const p of rawPaths) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 1024 || CONTROL.test(p) ||
        p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p) || /^\s/.test(p)) {
      throw invalid();
    }
    let n;
    try { n = normalizeImpactPaths([p])[0]; } catch { throw invalid(); }
    if (n !== p) throw invalid();
  }
  const paths = normalizeImpactPaths(rawPaths); // canonical sorted deduped; spelling already equal
  if (paths.length === 0 || paths.length > 32) throw invalid();
  let symbols = [];
  if (input.task.symbols !== undefined) {
    if (!Array.isArray(input.task.symbols) || input.task.symbols.length > 8) throw invalid();
    symbols = [...new Set(input.task.symbols.map((s) => boundedText(s, 128, true)))].sort(compareStrings);
  }

  // worktree
  assertRecord(input.worktree);
  assertAllowedFields(input.worktree, ["rootId", "relativePath"]);
  const rootId = boundedText(input.worktree.rootId, 128, true);
  const relative = validateRelativeProjectPath(input.worktree.relativePath);
  if (!relative.valid || relative.relativePath !== input.worktree.relativePath) throw invalid();
  const worktree = { rootId, relativePath: relative.relativePath };

  // expectedRevision - accept terminal statuses for not_evaluated paths
  assertRecord(input.expectedRevision);
  const revAllowed = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
  assertAllowedFields(input.expectedRevision, revAllowed);
  const revStatus = boundedText(input.expectedRevision.status, 32, true);
  if (!["available", "unavailable", "unborn", "not_git"].includes(revStatus)) throw invalid();
  // accept explicit null for commitSha/dirty/isLinked on terminal observations (truthful unknown)
  let commitSha;
  const rawSha = input.expectedRevision.commitSha;
  if (rawSha === null || rawSha === undefined) {
    if (revStatus === "available") throw invalid();
    commitSha = null;
  } else {
    commitSha = boundedText(rawSha, 64, true);
    if (!SHA_PATTERN.test(commitSha)) throw invalid();
  }
  let branch = input.expectedRevision.branch;
  if (branch !== null && branch !== undefined) branch = boundedText(branch, 512, true);
  let dirty = input.expectedRevision.dirty;
  if (dirty === null || dirty === undefined) {
    if (revStatus === "available") throw invalid();
    dirty = null;
  } else if (typeof dirty !== "boolean") {
    throw invalid();
  }
  let isLinkedWorktree = input.expectedRevision.isLinkedWorktree;
  if (isLinkedWorktree === null || isLinkedWorktree === undefined) {
    if (revStatus === "available") throw invalid();
    isLinkedWorktree = null;
  } else if (typeof isLinkedWorktree !== "boolean") {
    throw invalid();
  }
  let repositoryId = null;
  let worktreeId = null;
  if (Object.hasOwn(input.expectedRevision, "repositoryId") || Object.hasOwn(input.expectedRevision, "worktreeId")) {
    if (!Object.hasOwn(input.expectedRevision, "repositoryId") || !Object.hasOwn(input.expectedRevision, "worktreeId")) throw invalid();
    repositoryId = boundedText(input.expectedRevision.repositoryId, 64, true);
    worktreeId = boundedText(input.expectedRevision.worktreeId, 64, true);
    if (!OPAQUE_ID_PATTERN.test(repositoryId) || !OPAQUE_ID_PATTERN.test(worktreeId)) throw invalid();
  }
  const expectedRevision = {
    status: revStatus,
    commitSha,
    branch,
    dirty,
    isLinkedWorktree,
    ...(repositoryId ? { repositoryId, worktreeId } : {})
  };

  // includeTests
  if (typeof input.includeTests !== "boolean") throw invalid();

  // changeSemantics optional
  let changeSemantics = undefined;
  if (Object.hasOwn(input, "changeSemantics")) {
    if (input.changeSemantics === null || input.changeSemantics === undefined) {
      // omission
    } else {
      assertRecord(input.changeSemantics);
      assertAllowedFields(input.changeSemantics, ["category"]);
      const cat = input.changeSemantics.category;
      if (typeof cat !== "string" || !CHANGE_SEMANTICS_CATEGORIES.includes(cat)) throw invalid();
      changeSemantics = { category: cat };
    }
  }

  // limits optional
  let limits = undefined;
  if (Object.hasOwn(input, "limits")) {
    assertRecord(input.limits);
    assertAllowedFields(input.limits, ["compactBytes"]);
    if (Object.hasOwn(input.limits, "compactBytes")) {
      const cb = input.limits.compactBytes;
      if (typeof cb !== "number" || !Number.isFinite(cb) || !Number.isSafeInteger(cb) || cb < 1 || cb > 131072) throw invalid();
      limits = { compactBytes: cb };
    }
  }

  return {
    task: { id: taskId, title, paths, symbols },
    projectId: input.projectId,
    worktree,
    expectedRevision,
    includeTests: input.includeTests,
    ...(changeSemantics ? { changeSemantics } : {}),
    ...(limits ? { limits } : {})
  };
}

export function resolveChangeSemantics(declared, paths) {
  const inferred = inferFromPaths(paths);
  if (!declared) {
    return { declared: null, inferred, effective: inferred, provenance: "path_inference", reasons: [] };
  }
  const dec = declared.category;
  if (dec === "public_signature" || dec === "interface_contract" || dec === "schema_migration" || dec === "unknown") {
    return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
  }
  if (dec === "local_implementation") {
    if (inferred === "unknown") {
      return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
    }
    if (inferred === "documentation" || inferred === "test_only") {
      return { declared: dec, inferred, effective: "unknown", provenance: "task_declaration", reasons: ["declaration_path_disagreement"] };
    }
    return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
  }
  // declared doc or test_only
  if ((dec === "documentation" && inferred === "documentation") || (dec === "test_only" && inferred === "test_only")) {
    return { declared: dec, inferred, effective: dec, provenance: "task_declaration", reasons: [] };
  }
  return { declared: dec, inferred, effective: "unknown", provenance: "task_declaration", reasons: ["declaration_path_disagreement"] };
}

function inferFromPaths(paths) {
  if (paths.length === 0) return "unknown";
  // docs: case-sensitive, only exact lowercase extensions
  const allDocs = paths.every((p) => DOCUMENTATION_EXTENSIONS.some((ext) => p.endsWith(ext)));
  if (allDocs) return "documentation";
  // reuse existing Impact/Context test path predicate (no extra escape)
  const isTestPred = (p) => /\.(?:tsx?|jsx?|cs|py|go|rs|java)$/i.test(p)
    && /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)|\.(?:test|spec)\.|Tests?\.cs$|(?:^|\/)test_|_test\.go$/i.test(p);
  const allTest = paths.every(isTestPred);
  if (allTest) return "test_only";
  return "unknown";
}

export function normalizeEffectiveTaskScopeEvidence(pack, impact) {
  // basic shape checks; full binding later in composer
  if (!pack || typeof pack !== "object" || pack.schemaVersion !== 1 || pack.analysisVersion !== "task-context-v1") {
    throw effectiveTaskScopeError("invalid_pack", "Pack must be accepted task-context-v1");
  }
  if (!impact || typeof impact !== "object" || impact.schemaVersion !== 1 || impact.analysisVersion !== "impact-v2") {
    throw effectiveTaskScopeError("invalid_impact", "Impact must be accepted impact-v2");
  }
  return { pack: deepClone(pack), impact: deepClone(impact) };
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

export const MAX_RAW_PATHS_BEFORE_DEDUPE = 32;
export const MAX_SYMBOLS = 8;
export const MAX_CLASSIFIED_TARGETS = 320;
export const MAX_ORIGIN_WITNESS_REFS = 1024;
export const MAX_RESOLVER_REASONS = 128;
export const MAX_NESTING = 32;
export const MAX_VISITED_VALUES = 20000;
export const MAX_COMPACT_INPUT = 327680;
export const MAX_COMPACT_OUTPUT = 131072;

export function checkInputBudget(request, pack, impact) {
  // pack and impact each <=131072
  const packBytes = Buffer.byteLength(JSON.stringify(pack), "utf8");
  const impactBytes = Buffer.byteLength(JSON.stringify(impact), "utf8");
  if (packBytes > 131072 || impactBytes > 131072) {
    throw effectiveTaskScopeError("scope_budget_exceeded", "Pack or Impact exceeds 131072 compact bytes.");
  }
  const inputObj = { request, pack, impact };
  const reqStr = JSON.stringify(inputObj);
  if (Buffer.byteLength(reqStr, "utf8") > MAX_COMPACT_INPUT) {
    throw effectiveTaskScopeError("scope_budget_exceeded", "Input exceeds compactBytes budget.");
  }
  // bounded walk (nesting 32, 20000 vals) + reject accessor-backed before any recursive norm
  checkBoundedStructure(inputObj);
}

function checkBoundedStructure(root, maxDepth = MAX_NESTING, maxCount = MAX_VISITED_VALUES) {
  let count = 0;
  function walk(node, depth) {
    if (depth > maxDepth) throw effectiveTaskScopeError("scope_budget_exceeded");
    if (++count > maxCount) throw effectiveTaskScopeError("scope_budget_exceeded");
    if (node == null || typeof node !== "object") return;
    // reject accessor-backed (getter) without full invoke
    if (!Array.isArray(node)) {
      const names = Object.getOwnPropertyNames(node);
      for (const k of names) {
        const desc = Object.getOwnPropertyDescriptor(node, k);
        if (desc && (desc.get || desc.set)) {
          throw effectiveTaskScopeError("invalid_record");
        }
      }
    }
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], depth + 1);
    } else {
      for (const k of Object.keys(node)) walk(node[k], depth + 1);
    }
  }
  walk(root, 0);
}

export function buildEmptyCategory(status = "not_evaluated", reasons = []) {
  return { status, items: [], reasons: reasons.length ? [...reasons].sort(compareStrings) : [], truncated: false };
}

export { compareStrings };