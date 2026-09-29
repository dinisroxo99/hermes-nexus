import {
  EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
  EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  ETS_STATUSES,
  ETS_CATEGORY_STATUSES,
  CHANGE_SEMANTICS_CATEGORIES,
  effectiveTaskScopeError,
  normalizeEffectiveTaskScopeRequest,
  resolveChangeSemantics,
  normalizeEffectiveTaskScopeEvidence,
  checkInputBudget,
  buildEmptyCategory,
  MAX_CLASSIFIED_TARGETS,
  MAX_ORIGIN_WITNESS_REFS,
  MAX_RESOLVER_REASONS,
  MAX_COMPACT_OUTPUT,
  compareStrings
} from "./effective-task-scope-policy.js";

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function countCompactBytes(obj) {
  return Buffer.byteLength(JSON.stringify(obj), "utf8");
}

function makeReason(stage, code) {
  return { stage, code };
}

function canonicalItemOrder(items) {
  return [...items].sort((a, b) => {
    const pa = a.target?.path || "";
    const pb = b.target?.path || "";
    const c = compareStrings(pa, pb);
    if (c !== 0) return c;
    return compareStrings(a.target?.kind || "file", b.target?.kind || "file");
  });
}

function makeFileTarget(path) {
  return { kind: "file", path };
}

function makeEvidenceRef(origin) {
  const w = origin.witness || {};
  return {
    originPath: origin.originPath,
    minimumDistance: origin.minimumDistance,
    witness: {
      id: w.id || null,
      relationshipKind: w.relationshipKind || null,
      trust: w.trust || null,
      basis: w.basis || null
    }
  };
}

function classifyFromImpact(affectedItem, semantics, includeTests, isWrite) {
  const dist = affectedItem.minimumDistance ?? 999;
  const isTrunc = !! (affectedItem.attributionTruncated || (affectedItem.originSummary && affectedItem.originSummary.attributionTruncated));
  let category = "impact";
  let roles = ["affected_file"];
  if (dist <= 2 && !isTrunc) {
    category = "watch";
  } else if (dist > 2) {
    category = "impact";
  }
  if (includeTests && affectedItem.roles && affectedItem.roles.includes("affected_test_candidate")) {
    roles.push("affected_test_candidate");
  }
  if (semantics === "public_signature" || semantics === "interface_contract" || semantics === "schema_migration" || semantics === "unknown") {
    category = "watch";
  }
  if (isWrite) category = "write";
  return { category, roles: [...new Set(roles)].sort(compareStrings) };
}

/**
 * Pure composer: composeEffectiveTaskScope(request, evidence)
 * Receives validated request + {pack, impact} evidence. No IO.
 */
export function composeEffectiveTaskScope(request, evidence) {
  let normalizedRequest;
  try {
    normalizedRequest = normalizeEffectiveTaskScopeRequest(request);
  } catch (e) {
    return {
      schemaVersion: EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
      analysisVersion: EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
      policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
      status: "rejected",
      reasons: [{ stage: "request", code: e.code || "invalid_effective_task_scope_request" }],
      generatedAt: null
    };
  }

  let ev;
  try {
    ev = normalizeEffectiveTaskScopeEvidence(evidence.pack, evidence.impact);
  } catch (e) {
    return {
      schemaVersion: EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
      analysisVersion: EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
      policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
      status: "rejected",
      reasons: [{ stage: "evidence", code: e.code || "invalid_evidence" }],
      generatedAt: null
    };
  }

  const { pack, impact } = ev;

  const er = normalizedRequest.expectedRevision;
  const declared = normalizedRequest.changeSemantics;
  const sem = resolveChangeSemantics(declared, normalizedRequest.task.paths);
  const effectiveSem = sem.effective;

  // binding checks - task echo
  let echo;
  try {
    const titems = pack.sections && pack.sections.task && pack.sections.task.items;
    if (!titems || titems.length !== 1) throw effectiveTaskScopeError("task_echo_missing");
    echo = titems[0];
  } catch {
    return buildRejected("task_echo_missing");
  }
  if (echo.id !== normalizedRequest.task.id ||
      echo.title !== normalizedRequest.task.title ||
      JSON.stringify(echo.paths || []) !== JSON.stringify(normalizedRequest.task.paths) ||
      JSON.stringify(echo.symbols || []) !== JSON.stringify(normalizedRequest.task.symbols)) {
    return buildRejected("task_echo_mismatch");
  }

  // project / locator match
  if (pack.projectId !== normalizedRequest.projectId ||
      pack.projectId !== impact.projectId) {
    return buildRejected("project_identity_mismatch");
  }
  const pproj = pack.project || {};
  const iproj = impact.project || {};
  if (pproj.rootId !== normalizedRequest.worktree.rootId || pproj.rootId !== iproj.rootId ||
      pproj.relativePath !== normalizedRequest.worktree.relativePath || pproj.relativePath !== iproj.relativePath) {
    return buildRejected("worktree_locator_mismatch");
  }

  // revision binding
  const pr = pack.revision || {};
  const ir = impact.revision || {};
  for (const k of ["status", "commitSha", "dirty", "isLinkedWorktree"]) {
    if (pr[k] !== er[k] || ir[k] !== er[k]) return buildRejected("revision_binding_mismatch");
  }
  if (pr.branch !== er.branch || ir.branch !== er.branch) return buildRejected("revision_binding_mismatch");
  if (er.repositoryId) {
    const pRid = pr.repositoryIdentity || pr.repositoryId;
    const iRid = ir.repositoryId || ir.repositoryIdentity;
    if (pRid !== er.repositoryId || iRid !== er.repositoryId || pRid !== iRid) {
      return buildRejected("repository_identity_mismatch");
    }
    if ((pr.worktreeId || ir.worktreeId) !== er.worktreeId) return buildRejected("worktree_identity_mismatch");
  }

  // snapshot token coherence
  if (pack.analysis && impact.snapshotToken && pack.analysis.snapshotToken !== impact.snapshotToken) {
    return buildRejected("snapshot_token_mismatch");
  }

  // dirty / linked gate
  if (er.dirty !== false || er.isLinkedWorktree !== true) {
    return buildNotEvaluated("working_tree_observation_only", "dirty or not linked");
  }

  // symbols nonempty unsupported
  if (normalizedRequest.task.symbols && normalizedRequest.task.symbols.length > 0) {
    const res = buildNotEvaluated("symbol_targets_not_supported");
    res.task = { id: normalizedRequest.task.id, title: normalizedRequest.task.title, paths: normalizedRequest.task.paths, symbols: normalizedRequest.task.symbols };
    return res;
  }

  // budget check
  try {
    checkInputBudget(normalizedRequest, pack, impact);
  } catch (e) {
    return buildRejected("scope_budget_exceeded");
  }

  // build write items (explicit only)
  const writePaths = normalizedRequest.task.paths;
  const writeItems = writePaths.map((p) => ({
    target: makeFileTarget(p),
    roles: ["explicit_task_path"],
    ruleIds: ["explicit_task_path"],
    evidenceRefs: [],
    origins: [],
    attribution: null
  }));

  // now map from impact: since our targets may have no evidence, use targets or affected
  let affected = impact.affectedFiles || [];
  if (!Array.isArray(affected)) affected = [];
  // also targets for origin if present
  const targetOrigins = (impact.targets || []).filter(t => t && t.originPath).map(t => ({ originPath: t.originPath, minimumDistance: 0, witness: null }));

  const classified = new Map();
  for (const wp of writePaths) {
    classified.set(wp, { write: true, item: writeItems.find(w => w.target.path === wp) });
  }

  let hasAnyEvidence = false;
  for (const item of affected) {
    if (!item || !item.path) continue;
    hasAnyEvidence = true;
    if (writePaths.includes(item.path)) continue; // write wins
    const cls = classifyFromImpact(item, effectiveSem, normalizedRequest.includeTests, false);
    if (!classified.has(item.path)) {
      classified.set(item.path, { category: cls.category, item: {
        target: makeFileTarget(item.path),
        roles: cls.roles,
        ruleIds: [cls.category === "watch" ? "distance_1_2_awareness" : "transitive_impact"],
        evidenceRefs: (item.origins || []).map(makeEvidenceRef),
        origins: (item.origins || []).map(o => ({
          originPath: o.originPath,
          minimumDistance: o.minimumDistance,
          witness: o.witness ? { relationshipKind: o.witness.relationshipKind } : null,
          originSummary: item.originSummary || null
        })),
        attribution: null
      }});
    }
  }

  // build categories
  const writeCat = {
    status: "available",
    items: writeItems,
    reasons: [],
    truncated: false
  };
  const reservedCat = buildEmptyCategory("not_evaluated", ["coupling_evidence_not_supported"]);

  let watchItems = [];
  let impactItems = [];
  for (const [p, c] of classified) {
    if (c.write) continue;
    if (c.category === "watch") watchItems.push(c.item);
    else impactItems.push(c.item);
  }
  watchItems = canonicalItemOrder(watchItems);
  impactItems = canonicalItemOrder(impactItems);

  const watchCat = { status: watchItems.length ? "available" : "empty", items: watchItems, reasons: [], truncated: false };
  const impactCat = { status: impactItems.length ? "available" : "empty", items: impactItems, reasons: [], truncated: false };

  // determine top status
  const packObs = pack.observation || {};
  const impactObs = impact.observation || {};
  const impactComp = impact.completeness || {};
  const packIncomplete = packObs.incomplete !== false;
  const impactIncomplete = impactObs.incomplete !== false || impact.status !== "available" || impact.findingState === "not_evaluated";
  const hasMissingTarget = writePaths.some(p => {
    const t = (impact.targets || []).find(tt => tt.originPath === p);
    return !t || !t.targetSource;
  });

  let topStatus = "incomplete";
  let topReasons = [];
  if (packIncomplete || impactIncomplete || hasMissingTarget) {
    topStatus = "incomplete";
    if (packIncomplete) topReasons.push("pack_observation_incomplete");
    if (impactIncomplete) topReasons.push("impact_observation_incomplete");
    if (hasMissingTarget) topReasons.push("target_source_unavailable");
  } else if (impact.findingState === "not_evaluated") {
    topStatus = "not_evaluated";
  } else {
    topStatus = "incomplete"; // because RESERVED not_evaluated makes full unavailable
  }

  // RESERVED forces incomplete in this slice
  const resultStatus = (topStatus === "available" && reservedCat.status === "not_evaluated") ? "incomplete" : topStatus;

  const completeness = {
    source: [...(impactComp.source || []), ...(packObs.incomplete ? ["pack_incomplete"] : []) ].sort(compareStrings),
    provider: [...(impactComp.provider || [])].sort(compareStrings),
    traversal: [...(impactComp.traversal || [])].sort(compareStrings),
    output: [...(impactComp.output || [])].sort(compareStrings),
    resolver: (hasMissingTarget ? ["target_source_unavailable"] : []).sort(compareStrings)
  };

  const output = {
    schemaVersion: EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
    analysisVersion: EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
    policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
    status: resultStatus,
    task: {
      id: normalizedRequest.task.id,
      title: normalizedRequest.task.title,
      paths: normalizedRequest.task.paths,
      symbols: normalizedRequest.task.symbols
    },
    projectId: normalizedRequest.projectId,
    project: { rootId: normalizedRequest.worktree.rootId, relativePath: normalizedRequest.worktree.relativePath },
    revisionBinding: {
      status: er.status,
      commitSha: er.commitSha,
      branch: er.branch,
      dirty: er.dirty,
      isLinkedWorktree: er.isLinkedWorktree,
      repositoryId: er.repositoryId || pr.repositoryIdentity || ir.repositoryId,
      worktreeId: er.worktreeId || pr.worktreeId || ir.worktreeId
    },
    sourceBinding: {
      contextPackId: pack.contextPackId,
      contextSnapshotToken: pack.analysis ? pack.analysis.snapshotToken : null,
      impactSnapshotToken: impact.snapshotToken,
      contextSourceDigest: pack.observation ? pack.observation.sourceDigest : null,
      digestCoverage: pack.observation ? pack.observation.digestCoverage : null
    },
    changeSemantics: {
      declared: sem.declared,
      inferred: sem.inferred,
      effective: sem.effective,
      provenance: sem.provenance,
      reasons: sem.reasons
    },
    write: writeCat,
    reserved: reservedCat,
    watch: watchCat,
    impact: impactCat,
    evidence: {
      // minimal retained for slice
      origins: targetOrigins.length ? targetOrigins : [],
      witnesses: []
    },
    completeness,
    limits: {
      compactBytes: normalizedRequest.limits ? normalizedRequest.limits.compactBytes : 65536,
      classifiedTargets: classified.size,
      originWitnessRefs: 0,
      resolverReasons: topReasons.length
    },
    stale: {
      state: "bound",
      checkedAgainst: "supplied_expected_revision",
      requiresReobservation: true,
      reasons: []
    },
    generatedAt: null,
    reasons: topReasons.length ? topReasons.map(r => makeReason("composition", r)) : []
  };

  // budget output
  const outBytes = countCompactBytes(output);
  if (outBytes > MAX_COMPACT_OUTPUT) {
    return buildRejected("scope_budget_exceeded");
  }

  // for this foundation slice, full available is unreachable because reserved=not_evaluated
  if (output.status === "available") {
    output.status = "incomplete";
  }

  // preserve origins/witnesses from impact if any
  // ...

  return output;

  function buildRejected(code) {
    return {
      schemaVersion: EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
      analysisVersion: EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
      policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
      status: "rejected",
      reasons: [{ stage: "binding", code }],
      generatedAt: null
    };
  }

  function buildNotEvaluated(reasonCode, detail) {
    const r = {
      schemaVersion: EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
      analysisVersion: EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
      policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
      status: "not_evaluated",
      task: {
        id: normalizedRequest.task.id,
        title: normalizedRequest.task.title,
        paths: normalizedRequest.task.paths,
        symbols: normalizedRequest.task.symbols
      },
      projectId: normalizedRequest.projectId,
      project: { rootId: normalizedRequest.worktree.rootId, relativePath: normalizedRequest.worktree.relativePath },
      revisionBinding: { ...er },
      changeSemantics: { declared: sem.declared, inferred: sem.inferred, effective: sem.effective, provenance: sem.provenance, reasons: sem.reasons },
      write: buildEmptyCategory("not_evaluated"),
      reserved: buildEmptyCategory("not_evaluated", [reasonCode]),
      watch: buildEmptyCategory("not_evaluated"),
      impact: buildEmptyCategory("not_evaluated"),
      completeness: { source: [], provider: [], traversal: [], output: [], resolver: [reasonCode] },
      limits: { compactBytes: 65536, classifiedTargets: 0, originWitnessRefs: 0, resolverReasons: 1 },
      stale: { state: "bound", checkedAgainst: "supplied_expected_revision", requiresReobservation: true, reasons: [] },
      generatedAt: null,
      reasons: [{ stage: "evaluation", code: reasonCode }]
    };
    if (detail) r.reasons[0].detail = detail;
    return r;
  }
}
