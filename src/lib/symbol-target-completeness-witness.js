/**
 * In-repo symbol-target completeness witness producer (ArchW field set).
 * Calls only resolveTypeScriptDeclarationEvidence for uniqueness citations.
 * Does not consume ETS / composeEffectiveTaskScope / HTTP; does not flip hard flags.
 */

import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";
import { resolveTypeScriptDeclarationEvidence } from "./track-a-symbol-resolution.js";
import { contextDigest, CONTEXT_SOURCE_LIMITS } from "./project-context-files.js";

const KIND = "symbol-target-completeness-witness";
const PRODUCER_IDENTITY = "hermes-nexus-in-repo-symbol-target-completeness-witness";
const VERSION = "symbol-target-completeness-witness-v1";

const CLAIMED_DOMAIN =
  "typescript-javascript-direct-declarations-tsjs-direct-declarations-1";
const QUERY_DOMAIN = "tsjs_source_file_direct_declarations_v1";

const COMPLETENESS_DEFINITION_NOTE =
  "completeness = all required names evaluated under fail-closed rules — NOT all unique";
const COMPOSITION_RULE =
  "uniqueness_holds_for_domain_of_evaluated_names AND completeness_obligations_1_through_4_hold";

const ENTRY_POINT = "resolveTypeScriptDeclarationEvidence";
const SCHEMA_VERSION = 1;
const ANALYSIS_VERSION = "symbol-resolution-evidence-v1";
const POLICY_VERSION = "tsjs-direct-declarations-1";

const EFFECTIVE_OUTCOMES = new Set(["unique", "not_found", "ambiguous"]);
const EFFECTIVE_A1_STATUSES = new Set(["resolved_unique", "not_found", "ambiguous"]);

const TSJS_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts"
]);

const HARD_FLAGS = Object.freeze({
  IMPLEMENTATION_AUTHORIZED: "NO",
  SLICE4: "NOT_STARTED",
  STEP4_SLICE4_READY_TO_IMPLEMENT: "NO",
  confinementFlipped: false,
  pr53ReservedUntouched: true,
  trackBUntouched: true
});

const NON_SATISFIERS = Object.freeze([
  "Context Pack retained symbols/rows",
  "Impact imports",
  "Impact uses",
  "Impact references",
  "Impact minimumDistance",
  "Bare declaration-count / text search / export function greps",
  "Flat resolveTrackA1 outcomes alone"
]);

const NON_AUTHORIZATION = Object.freeze([
  "ETS / composeEffectiveTaskScope / HTTP consumption of A1 or completeness evidence",
  "Slice 4 selection",
  "A0/A2 naming as code tracks",
  "conflict (Step 5)",
  "guard (Step 6)",
  "hard-flag flips (IMPLEMENTATION_AUTHORIZED, SLICE4, STEP4_SLICE4_READY_TO_IMPLEMENT)",
  "confinement epic start",
  "PR #53 RESERVED / Track B incomplete-item rule changes",
  "writes outside this producer module/test under this admit"
]);

const FAIL_CLOSED_MATRIX = Object.freeze({
  partialImpliesCompletenessFalse: true,
  truncatedImpliesCompletenessFalse: true,
  uncoveredLanguageImpliesCompletenessFalse: true,
  bindingMismatchImpliesCompletenessFalse: true
});

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function extensionOf(relPath) {
  const base = String(relPath).split("/").pop() ?? "";
  const idx = base.lastIndexOf(".");
  if (idx < 0) return "";
  return base.slice(idx).toLowerCase();
}

function pathCoverageStatusFor(relPath, overrides) {
  if (isPlainObject(overrides) && typeof overrides[relPath] === "string") {
    return overrides[relPath];
  }
  return TSJS_EXTENSIONS.has(extensionOf(relPath)) ? "covered" : "uncovered_language";
}

function adapterCollection(files, { truncated = false } = {}) {
  const list = Array.isArray(files) ? files : [];
  return {
    limits: {
      maxDepth: CONTEXT_SOURCE_LIMITS.maxDepth,
      maxEntries: CONTEXT_SOURCE_LIMITS.maxEntries,
      maxFiles: CONTEXT_SOURCE_LIMITS.maxFiles,
      maxFileBytes: CONTEXT_SOURCE_LIMITS.maxFileBytes,
      maxTotalBytes: CONTEXT_SOURCE_LIMITS.maxTotalBytes
    },
    truncated: truncated === true,
    diagnostics: [],
    digest: contextDigest(JSON.stringify(list.map((f) => [f.path, f.sha256])))
  };
}

function sevenRevisionKeys(revision) {
  return {
    status: revision.status,
    commitSha: revision.commitSha,
    branch: revision.branch ?? null,
    repositoryId: revision.repositoryId,
    worktreeId: revision.worktreeId,
    dirty: revision.dirty,
    isLinkedWorktree: revision.isLinkedWorktree
  };
}

function mapAdapterStatusToOutcome(status) {
  if (status === "resolved_unique") return "unique";
  if (status === "not_found") return "not_found";
  if (status === "ambiguous") return "ambiguous";
  return "unevaluated";
}

function a1EvidenceComplete(result, collectionTruncated) {
  if (collectionTruncated === true) return false;
  if (!isPlainObject(result)) return false;
  if (!EFFECTIVE_A1_STATUSES.has(result.status)) return false;
  const completeness = result.completeness;
  if (isPlainObject(completeness)) {
    if (
      completeness.source !== "complete"
      || completeness.parse !== "complete"
      || completeness.enumeration !== "complete"
    ) {
      return false;
    }
  }
  const notes = Array.isArray(result.notes) ? result.notes : [];
  for (const note of notes) {
    if (typeof note !== "string") continue;
    if (note.includes("source collection was truncated")) return false;
    if (note.includes("did not round-trip")) return false;
    if (note.includes("incomplete because")) return false;
  }
  return true;
}

function effectivelyEvaluated(evaluation) {
  if (!isPlainObject(evaluation)) return false;
  if (!EFFECTIVE_OUTCOMES.has(evaluation.outcome)) return false;
  return evaluation.a1Citation?.evidenceComplete === true;
}

function stampCitation(extra = {}) {
  return {
    entryPoint: ENTRY_POINT,
    schemaVersion: SCHEMA_VERSION,
    analysisVersion: ANALYSIS_VERSION,
    policyVersion: POLICY_VERSION,
    ...extra
  };
}

function missingBindingReasons(request) {
  const reasons = [];
  if (!isPlainObject(request)) {
    reasons.push("request_not_plain_object");
    return reasons;
  }
  if (!isStringArray(request.taskPaths) || request.taskPaths.length === 0) {
    reasons.push("taskPaths_missing_or_invalid");
  }
  if (!isStringArray(request.requiredNames)) {
    reasons.push("requiredNames_missing_or_invalid");
  }
  for (const key of [
    "projectId",
    "repositoryId",
    "worktreeId",
    "snapshotToken",
    "admittedCommit"
  ]) {
    if (!isNonEmptyString(request[key])) reasons.push(`${key}_missing`);
  }
  if (!isPlainObject(request.sourceHashes)) {
    reasons.push("sourceHashes_missing_or_invalid");
  }
  return reasons;
}

function sourceHashesMatch(expected, files) {
  if (!isPlainObject(expected)) return false;
  for (const file of files) {
    if (expected[file.path] !== file.sha256) return false;
  }
  for (const path of Object.keys(expected)) {
    if (!files.some((f) => f.path === path)) return false;
  }
  return true;
}

function revisionHasRequiredFields(revision) {
  return (
    isPlainObject(revision)
    && isNonEmptyString(revision.status)
    && isNonEmptyString(revision.commitSha)
    && isNonEmptyString(revision.repositoryId)
    && isNonEmptyString(revision.worktreeId)
    && typeof revision.dirty === "boolean"
    && typeof revision.isLinkedWorktree === "boolean"
  );
}

function worktreeHasRequiredFields(worktree) {
  return (
    isPlainObject(worktree)
    && isNonEmptyString(worktree.rootId)
    && isNonEmptyString(worktree.relativePath)
  );
}

function buildLiveObservation(request, orderedFiles, revision, worktree, collectionOptions = {}) {
  if (!worktreeHasRequiredFields(worktree)) {
    throw new Error("worktree_unavailable");
  }
  if (!revisionHasRequiredFields(revision)) {
    throw new Error("revision_unavailable");
  }
  const produced = createProviderSnapshot(
    { projectId: request.projectId },
    orderedFiles,
    sevenRevisionKeys(revision)
  );
  const files = produced.files.map((file) => ({
    path: file.path,
    text: file.text,
    byteSize: file.byteSize,
    sha256: file.sha256
  }));
  const observation = {
    project: {
      projectId: request.projectId,
      rootId: worktree.rootId,
      relativePath: worktree.relativePath
    },
    snapshot: {
      schemaVersion: produced.schemaVersion,
      projectId: produced.projectId,
      token: produced.token,
      revision: { ...produced.revision },
      languages: Array.isArray(produced.languages)
        ? produced.languages.slice()
        : produced.languages,
      files
    },
    collection: adapterCollection(files, collectionOptions)
  };
  return { produced, observation, worktree };
}

function buildAdapterRequest(request, name, taskPaths, revision, worktree) {
  return {
    projectId: request.projectId,
    worktree: {
      rootId: worktree.rootId,
      relativePath: worktree.relativePath
    },
    expectedRevision: sevenRevisionKeys(revision),
    task: {
      id: isNonEmptyString(request.taskId) ? request.taskId : "task_completeness_witness",
      paths: taskPaths.slice()
    },
    query: { name, domain: QUERY_DOMAIN }
  };
}

function evaluateName(name, adapterRequest, observation, taskPaths, collectionTruncated) {
  let result;
  try {
    result = resolveTypeScriptDeclarationEvidence(adapterRequest, observation);
  } catch (error) {
    return {
      name,
      outcome: "unevaluated",
      pathScope: taskPaths.slice(),
      reason: "adapter_threw",
      a1Citation: stampCitation({
        name,
        runStatus: "threw",
        evidenceComplete: false,
        errorName: error?.name ?? "Error"
      })
    };
  }

  const evidenceComplete = a1EvidenceComplete(result, collectionTruncated);
  const outcome = mapAdapterStatusToOutcome(result?.status);
  const citation = stampCitation({
    name,
    runStatus: result?.status ?? "unknown",
    path: taskPaths[0] ?? null,
    evidenceComplete
  });

  if (isPlainObject(result?.completeness)) {
    citation.completeness = {
      source: result.completeness.source,
      parse: result.completeness.parse,
      enumeration: result.completeness.enumeration,
      output: result.completeness.output
    };
  }

  if (result?.status === "resolved_unique" && Array.isArray(result.occurrences) && result.occurrences[0]) {
    const occ = result.occurrences[0];
    citation.declarationId = occ.declarationId;
    citation.symbolId = occ.symbolId;
    citation.path = occ.path ?? citation.path;
  }
  if (result?.snapshotBinding?.snapshotToken) {
    citation.snapshotToken = result.snapshotBinding.snapshotToken;
  }
  if (result?.snapshotBinding?.sourceDigest) {
    citation.sourceDigest = result.snapshotBinding.sourceDigest;
  }
  if (
    result?.schemaVersion !== SCHEMA_VERSION
    || result?.analysisVersion !== ANALYSIS_VERSION
    || result?.policyVersion !== POLICY_VERSION
  ) {
    citation.stampMismatch = true;
  }

  const evaluation = {
    name,
    outcome,
    pathScope: taskPaths.slice(),
    a1Citation: citation
  };
  if (outcome === "unevaluated" || !evidenceComplete) {
    const notes = Array.isArray(result?.notes) ? result.notes : [];
    if (outcome === "unevaluated") {
      evaluation.reason = notes[0] ?? `adapter_status_${result?.status ?? "unknown"}`;
    } else if (collectionTruncated) {
      evaluation.reason = "collection_truncated";
    } else if (isPlainObject(result?.completeness) && result.completeness.parse !== "complete") {
      evaluation.reason = "incomplete_parsing";
    } else if (isPlainObject(result?.completeness) && result.completeness.source !== "complete") {
      evaluation.reason = "incomplete_evidence";
    } else {
      evaluation.reason = notes[0] ?? "incomplete_evidence";
    }
  }
  return evaluation;
}

function baseWitnessSkeleton(request, extras = {}) {
  const createdAt =
    isNonEmptyString(request?.createdAt) ? request.createdAt : new Date().toISOString();
  return {
    kind: KIND,
    producerIdentity: PRODUCER_IDENTITY,
    version: VERSION,
    createdAt,
    failClosedMatrix: { ...FAIL_CLOSED_MATRIX },
    completenessDefinitionNote: COMPLETENESS_DEFINITION_NOTE,
    compositionRule: COMPOSITION_RULE,
    a1AloneInsufficientForNogo2: true,
    a1AloneInsufficient: true,
    claimedDomains: [CLAIMED_DOMAIN],
    nonSatisfiers: [...NON_SATISFIERS],
    hardFlags: { ...HARD_FLAGS },
    nonAuthorization: [...NON_AUTHORIZATION],
    ...extras
  };
}

/**
 * Produce an ArchW-shaped symbol-target completeness witness.
 *
 * Golden path: supply real `fileContents` for admitted task paths; producer builds a
 * live createProviderSnapshot and calls resolveTypeScriptDeclarationEvidence per name.
 *
 * Negative fixtures may supply `observation` without live file bytes.
 * Missing required binding or binding mismatch => completenessHolds=false (no invention).
 *
 * @param {object} request
 * @returns {object} witness
 */
export function produceSymbolTargetCompletenessWitness(request) {
  const bindingProblems = missingBindingReasons(request);
  const nameListTruncated = request?.nameListTruncated === true;

  if (bindingProblems.length > 0) {
    const taskPaths = isStringArray(request?.taskPaths) ? request.taskPaths.slice() : [];
    const requiredNames = isStringArray(request?.requiredNames)
      ? request.requiredNames.slice()
      : [];
    const evaluations = requiredNames.map((name) => ({
      name,
      outcome: "unevaluated",
      pathScope: taskPaths.slice(),
      reason: "binding_incomplete",
      a1Citation: stampCitation({ name, runStatus: "not_evaluated", evidenceComplete: false })
    }));
    const pathCoverage = taskPaths.map((path) => ({
      path,
      status: pathCoverageStatusFor(path, request?.pathStatusOverrides)
    }));
    const witness = baseWitnessSkeleton(request, {
      taskPaths,
      requiredNames,
      nameListTruncated,
      pathCoverage,
      evaluations,
      a1Citations: evaluations.map((e) => e.a1Citation),
      completenessHolds: false,
      uniquenessHolds: false,
      p1Notes:
        "fail-closed: missing required binding fields; values not invented"
    });
    if (isNonEmptyString(request?.admittedCommit)) {
      witness.admittedCommit = request.admittedCommit;
    }
    if (isNonEmptyString(request?.projectId)) witness.projectId = request.projectId;
    if (isNonEmptyString(request?.repositoryId)) {
      witness.repositoryId = request.repositoryId;
    }
    if (isNonEmptyString(request?.worktreeId)) witness.worktreeId = request.worktreeId;
    if (isNonEmptyString(request?.snapshotToken)) {
      witness.snapshotToken = request.snapshotToken;
    }
    if (isPlainObject(request?.sourceHashes)) {
      witness.sourceHashes = { ...request.sourceHashes };
    }
    return witness;
  }

  const taskPaths = request.taskPaths.slice();
  const requiredNames = request.requiredNames.slice();
  const pathCoverage = taskPaths.map((path) => ({
    path,
    status: pathCoverageStatusFor(path, request.pathStatusOverrides)
  }));
  const hasUncoveredLanguage = pathCoverage.some(
    (entry) => entry.status === "uncovered_language"
  );
  const hasUnevaluatedPath = pathCoverage.some(
    (entry) => entry.status === "unevaluated"
  );

  let bindingMismatch = false;
  let bindingMismatchReason = null;
  let observation = null;
  let liveToken = null;
  let liveHashes = null;
  let revision = null;
  let worktree = null;
  let collectionTruncated = false;

  const coveredPaths = pathCoverage
    .filter((entry) => entry.status === "covered")
    .map((entry) => entry.path);

  if (isPlainObject(request.observation) && request.fileContents === undefined) {
    observation = request.observation;
    liveToken = observation?.snapshot?.token ?? null;
    liveHashes = {};
    if (Array.isArray(observation?.snapshot?.files)) {
      for (const file of observation.snapshot.files) {
        liveHashes[file.path] = file.sha256;
      }
    }
    collectionTruncated = observation?.collection?.truncated === true;

    const snapRevision = isPlainObject(observation?.snapshot?.revision)
      ? observation.snapshot.revision
      : null;
    const obsProjectId =
      observation?.project?.projectId ?? observation?.snapshot?.projectId ?? null;

    if (obsProjectId !== request.projectId) {
      bindingMismatch = true;
      bindingMismatchReason = "project_mismatch";
    } else if (
      snapRevision
      && (
        (isNonEmptyString(snapRevision.repositoryId)
          && snapRevision.repositoryId !== request.repositoryId)
        || (isNonEmptyString(snapRevision.worktreeId)
          && snapRevision.worktreeId !== request.worktreeId)
      )
    ) {
      bindingMismatch = true;
      bindingMismatchReason = "repository_or_worktree_mismatch";
    }

    if (isPlainObject(request.revision)) {
      revision = request.revision;
      if (
        revision.repositoryId !== request.repositoryId
        || revision.worktreeId !== request.worktreeId
      ) {
        bindingMismatch = true;
        bindingMismatchReason = bindingMismatchReason ?? "repository_or_worktree_mismatch";
      } else if (
        snapRevision
        && (
          (isNonEmptyString(revision.commitSha)
            && isNonEmptyString(snapRevision.commitSha)
            && revision.commitSha !== snapRevision.commitSha)
          || (isNonEmptyString(revision.repositoryId)
            && isNonEmptyString(snapRevision.repositoryId)
            && revision.repositoryId !== snapRevision.repositoryId)
          || (isNonEmptyString(revision.worktreeId)
            && isNonEmptyString(snapRevision.worktreeId)
            && revision.worktreeId !== snapRevision.worktreeId)
        )
      ) {
        bindingMismatch = true;
        bindingMismatchReason = bindingMismatchReason ?? "revision_incoherent_with_observation";
      }
    } else {
      revision = snapRevision;
    }

    if (isPlainObject(request.worktree)) {
      worktree = request.worktree;
    } else {
      worktree = {
        rootId: observation?.project?.rootId,
        relativePath: observation?.project?.relativePath
      };
    }

    if (!revisionHasRequiredFields(revision) || !worktreeHasRequiredFields(worktree)) {
      bindingMismatch = true;
      bindingMismatchReason = bindingMismatchReason ?? "revision_or_location_unavailable";
    }

    if (!bindingMismatch && liveToken !== request.snapshotToken) {
      bindingMismatch = true;
      bindingMismatchReason = "snapshotToken_mismatch";
    } else if (
      !bindingMismatch
      && !sourceHashesMatch(
        request.sourceHashes,
        Object.entries(liveHashes).map(([path, sha256]) => ({ path, sha256 }))
      )
    ) {
      bindingMismatch = true;
      bindingMismatchReason = "sourceHashes_mismatch";
    }
  } else if (isPlainObject(request.fileContents)) {
    if (!isPlainObject(request.revision) || !worktreeHasRequiredFields(request.worktree)) {
      bindingMismatch = true;
      bindingMismatchReason = "revision_or_location_unavailable";
    } else {
      revision = request.revision;
      worktree = request.worktree;
      if (
        revision.repositoryId !== request.repositoryId
        || revision.worktreeId !== request.worktreeId
      ) {
        bindingMismatch = true;
        bindingMismatchReason = "repository_or_worktree_mismatch";
      } else if (!revisionHasRequiredFields(revision)) {
        bindingMismatch = true;
        bindingMismatchReason = "revision_or_location_unavailable";
      }
    }

    const orderedFiles = [];
    if (!bindingMismatch) {
      for (const path of taskPaths) {
        if (!Object.hasOwn(request.fileContents, path)) {
          bindingMismatch = true;
          bindingMismatchReason = `fileContents_missing_${path}`;
          break;
        }
        const text = request.fileContents[path];
        if (typeof text !== "string") {
          bindingMismatch = true;
          bindingMismatchReason = `fileContents_invalid_${path}`;
          break;
        }
        orderedFiles.push({ path, text });
      }
    }

    if (!bindingMismatch) {
      try {
        const built = buildLiveObservation(
          request,
          orderedFiles,
          revision,
          worktree
        );
        observation = built.observation;
        worktree = built.worktree;
        liveToken = built.produced.token;
        liveHashes = Object.fromEntries(
          built.produced.files.map((f) => [f.path, f.sha256])
        );
        collectionTruncated = observation.collection.truncated === true;
        if (liveToken !== request.snapshotToken) {
          bindingMismatch = true;
          bindingMismatchReason = "snapshotToken_mismatch";
        } else if (
          !sourceHashesMatch(
            request.sourceHashes,
            built.produced.files.map((f) => ({ path: f.path, sha256: f.sha256 }))
          )
        ) {
          bindingMismatch = true;
          bindingMismatchReason = "sourceHashes_mismatch";
        } else if (
          built.produced.revision.repositoryId !== request.repositoryId
          || built.produced.revision.worktreeId !== request.worktreeId
        ) {
          bindingMismatch = true;
          bindingMismatchReason = "repository_or_worktree_mismatch";
        }
      } catch (error) {
        bindingMismatch = true;
        bindingMismatchReason = `snapshot_build_failed:${error?.message ?? "error"}`;
      }
    }
  } else {
    bindingMismatch = true;
    bindingMismatchReason = "no_fileContents_or_observation";
  }

  const evaluations = [];
  const a1Citations = [];

  // Fail-closed short-circuit: still emit explicit evaluations for every required name.
  // Collection truncation is NOT short-circuited here so live A1 still runs and
  // fail-closes via effectivelyEvaluated / collectionTruncated.
  const failClosedNow =
    bindingMismatch || hasUncoveredLanguage || hasUnevaluatedPath || nameListTruncated;

  if (failClosedNow) {
    for (const name of requiredNames) {
      let reason = "fail_closed";
      if (bindingMismatch) reason = bindingMismatchReason ?? "binding_mismatch";
      else if (nameListTruncated) reason = "name_list_truncated";
      else if (hasUncoveredLanguage) reason = "uncovered_language";
      else if (hasUnevaluatedPath) reason = "path_unevaluated";
      const evaluation = {
        name,
        outcome: "unevaluated",
        pathScope: taskPaths.slice(),
        reason,
        a1Citation: stampCitation({ name, runStatus: "not_evaluated", evidenceComplete: false })
      };
      evaluations.push(evaluation);
      a1Citations.push(evaluation.a1Citation);
    }
  } else {
    const evalPaths = coveredPaths.length > 0 ? coveredPaths : taskPaths;
    for (const name of requiredNames) {
      const adapterRequest = buildAdapterRequest(
        request,
        name,
        evalPaths,
        revision,
        worktree
      );
      const evaluation = evaluateName(
        name,
        adapterRequest,
        observation,
        evalPaths,
        collectionTruncated
      );
      evaluations.push(evaluation);
      a1Citations.push({
        entryPoint: ENTRY_POINT,
        schemaVersion: SCHEMA_VERSION,
        analysisVersion: ANALYSIS_VERSION,
        policyVersion: POLICY_VERSION,
        name: evaluation.name,
        path: evaluation.a1Citation.path ?? evalPaths[0] ?? null,
        runStatus: evaluation.a1Citation.runStatus,
        evidenceComplete: evaluation.a1Citation.evidenceComplete === true,
        ...(evaluation.a1Citation.declarationId
          ? { declarationId: evaluation.a1Citation.declarationId }
          : {}),
        ...(evaluation.a1Citation.symbolId
          ? { symbolId: evaluation.a1Citation.symbolId }
          : {})
      });
    }
  }

  const evaluatedNames = new Set(evaluations.map((e) => e.name));
  const coveragePartial =
    requiredNames.some((name) => !evaluatedNames.has(name))
    || evaluations.length !== requiredNames.length;
  const hasNonEffectiveEvaluation = evaluations.some((e) => !effectivelyEvaluated(e));
  const partial = coveragePartial || hasNonEffectiveEvaluation;

  const attemptedUpgrade =
    request.forceCompletenessHolds === true
    || request.claimCompletenessDespiteFailClosed === true;

  let completenessHolds =
    !nameListTruncated
    && !bindingMismatch
    && !hasUncoveredLanguage
    && !hasUnevaluatedPath
    && !collectionTruncated
    && !coveragePartial
    && !hasNonEffectiveEvaluation
    && !attemptedUpgrade
    && requiredNames.every((name) => {
      const ev = evaluations.find((e) => e.name === name);
      return ev && effectivelyEvaluated(ev);
    });

  if (nameListTruncated && FAIL_CLOSED_MATRIX.truncatedImpliesCompletenessFalse) {
    completenessHolds = false;
  }
  if (collectionTruncated && FAIL_CLOSED_MATRIX.truncatedImpliesCompletenessFalse) {
    completenessHolds = false;
  }
  if (bindingMismatch && FAIL_CLOSED_MATRIX.bindingMismatchImpliesCompletenessFalse) {
    completenessHolds = false;
  }
  if (hasUncoveredLanguage && FAIL_CLOSED_MATRIX.uncoveredLanguageImpliesCompletenessFalse) {
    completenessHolds = false;
  }
  if (partial && FAIL_CLOSED_MATRIX.partialImpliesCompletenessFalse) {
    completenessHolds = false;
  }

  const uniquenessHolds =
    !bindingMismatch
    && !collectionTruncated
    && evaluations.length > 0
    && evaluations.every((e) => e.outcome === "unique" && effectivelyEvaluated(e));

  const witness = baseWitnessSkeleton(request, {
    admittedCommit: request.admittedCommit,
    projectId: request.projectId,
    repositoryId: request.repositoryId,
    worktreeId: request.worktreeId,
    snapshotToken: request.snapshotToken,
    sourceHashes: { ...request.sourceHashes },
    taskPaths,
    pathCoverage,
    requiredNames,
    nameListTruncated,
    evaluations,
    a1Citations,
    completenessHolds,
    uniquenessHolds,
    p1Notes:
      "Tw scores Accept 1-26 / Reject 1-14 against this in-repo producer witness."
  });

  if (bindingMismatchReason) {
    witness.provenance = {
      bindingMismatchReason,
      liveSnapshotToken: liveToken,
      liveSourceHashes: liveHashes
    };
  }

  return witness;
}
