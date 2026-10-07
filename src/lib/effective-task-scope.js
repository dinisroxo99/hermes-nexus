import {
  EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
  EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
  ETS_STATUSES,
  ETS_CATEGORY_STATUSES,
  CHANGE_SEMANTICS_CATEGORIES,
  effectiveTaskScopeError,
  normalizeEffectiveTaskScopeRequest,
  bindDeleteIntent,
  resolveChangeSemantics,
  normalizeEffectiveTaskScopeEvidence,
  normalizeSymbolTargetCompletenessWitness,
  evaluateSymbolTargetCompletenessWitness,
  materializeBoundedJsonData,
  checkInputBudget,
  buildEmptyCategory,
  MAX_CLASSIFIED_TARGETS,
  MAX_ORIGIN_WITNESS_REFS,
  MAX_RESOLVER_REASONS,
  MAX_COMPACT_OUTPUT,
  compareStrings
} from "./effective-task-scope-policy.js";
import { reservedItemFromTrackBWitness } from "./reserved-from-track-b-witness.js";

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

function compareOrigin(a, b) {
  const c1 = compareStrings(a && a.originPath || "", b && b.originPath || "");
  if (c1 !== 0) return c1;
  const da = (a && typeof a.minimumDistance === "number") ? a.minimumDistance : 999;
  const db = (b && typeof b.minimumDistance === "number") ? b.minimumDistance : 999;
  if (da !== db) return da - db;
  const wa = (a && a.witness && a.witness.id) || "";
  const wb = (b && b.witness && b.witness.id) || "";
  return compareStrings(wa, wb);
}

function makeFileTarget(path) {
  return { kind: "file", path };
}

function makeEvidenceRef(origin) {
  const w = origin.witness || {};
  // retain complete Impact witness fields
  return {
    originPath: origin.originPath,
    minimumDistance: origin.minimumDistance,
    witness: (w && typeof w === "object") ? { ...w } : null
  };
}

function getMinDistance(item) {
  if (!item || !Array.isArray(item.origins) || item.origins.length === 0) return 999;
  return Math.min(...item.origins.map(o => (o && typeof o.minimumDistance === "number" ? o.minimumDistance : 999)));
}

function classifyFromImpact(affectedItem, semantics, includeTests, isWrite, isDelete = false) {
  const dist = getMinDistance(affectedItem);
  const os = affectedItem.originSummary || {};
  const isTrunc = !!(affectedItem.attributionTruncated || os.attributionTruncated);
  let category = "impact";
  let roles = ["affected_file"];
  let ruleId = "transitive_impact";
  if (isTrunc) {
    category = "watch";
    ruleId = "truncated_attribution";
  } else if (dist <= 2) {
    category = "watch";
    ruleId = "distance_1_2_awareness";
  } else if (dist > 2) {
    category = "impact";
    ruleId = "transitive_impact";
  }
  if (dist === 0) {
    // distance-0 non-origin will be rejected upstream
  }
  if (includeTests && affectedItem.roles && affectedItem.roles.includes("affected_test_candidate")) {
    roles.push("affected_test_candidate");
  }
  if (semantics === "public_signature" || semantics === "interface_contract" || semantics === "schema_migration" || semantics === "unknown") {
    category = "watch";
    ruleId = isTrunc ? "truncated_attribution" : "distance_1_2_awareness";
  }
  if (isDelete && !isWrite) {
    category = "watch";
    ruleId = "delete_intent_awareness";
  }
  if (isWrite) category = "write";
  return { category, roles: [...new Set(roles)].sort(compareStrings), ruleId };
}

/**
 * Pure composer: composeEffectiveTaskScope(request, evidence)
 * Receives validated request + {pack, impact, optional symbolTargetCompletenessWitness} evidence. No IO.
 */
export function composeEffectiveTaskScope(request, evidence) {
  // Cross the structural ingress boundary before reading either raw argument.
  try {
    ({ request, evidence } = materializeBoundedJsonData({ request, evidence }));
  } catch (e) {
    return buildRejected(e.code || "invalid_record");
  }
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

  // binding checks - task echo (require equal canonical sorted)
  let echo;
  try {
    const titems = pack.sections && pack.sections.task && pack.sections.task.items;
    if (!titems || titems.length !== 1) throw effectiveTaskScopeError("task_echo_missing");
    echo = titems[0];
  } catch {
    return buildRejected("task_echo_missing");
  }
  const echoPaths = (echo.paths || []).slice().sort(compareStrings);
  const reqPaths = (normalizedRequest.task.paths || []).slice().sort(compareStrings);
  if (echo.id !== normalizedRequest.task.id ||
      echo.title !== normalizedRequest.task.title ||
      JSON.stringify(echoPaths) !== JSON.stringify(reqPaths) ||
      JSON.stringify(echo.symbols || []) !== JSON.stringify(normalizedRequest.task.symbols || [])) {
    return buildRejected("task_echo_mismatch");
  }

  // project / locator match strict
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

  // revision binding: require present equal canonical IDs (no null==null, no copy missing)
  const pr = pack.revision || {};
  const ir = impact.revision || {};
  // internal coherence of evidence first
  const revKeys = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree"];
  for (const k of revKeys) {
    if (pr[k] !== ir[k]) return buildRejected("revision_binding_mismatch");
  }
  // require IDs present equal across, alias==canonical; any alias disagreement rejects (no fail-open)
  if (!er.repositoryId || !er.worktreeId || !pr.repositoryIdentity || !ir.repositoryId) {
    return buildRejected("repository_identity_mismatch");
  }
  // intra-producer alias disagreement check (repositoryId vs repositoryIdentity, worktreeId vs worktreeIdentity)
  if (pr.repositoryId !== undefined && pr.repositoryId !== pr.repositoryIdentity) {
    return buildRejected("repository_identity_mismatch");
  }
  if (ir.repositoryIdentity !== undefined && ir.repositoryIdentity !== ir.repositoryId) {
    return buildRejected("repository_identity_mismatch");
  }
  if (pr.worktreeIdentity !== undefined && pr.worktreeIdentity !== pr.worktreeId) {
    return buildRejected("worktree_identity_mismatch");
  }
  if (ir.worktreeIdentity !== undefined && ir.worktreeIdentity !== ir.worktreeId) {
    return buildRejected("worktree_identity_mismatch");
  }
  if (er.repositoryId !== undefined && er.worktreeId !== undefined) {
    // er uses canonical v2 names only
  }
  const pRid = pr.repositoryIdentity;
  const iRid = ir.repositoryId;
  if (pRid !== er.repositoryId || iRid !== er.repositoryId || pRid !== iRid) {
    return buildRejected("repository_identity_mismatch");
  }
  if (pr.worktreeId !== er.worktreeId || ir.worktreeId !== er.worktreeId) {
    return buildRejected("worktree_identity_mismatch");
  }

  // snapshot token coherence + provider id/version equal required
  if (!pack.analysis || !pack.analysis.snapshotToken || !impact.snapshotToken ||
      pack.analysis.snapshotToken !== impact.snapshotToken) {
    return buildRejected("snapshot_token_mismatch");
  }
  const pprov = (pack.analysis && pack.analysis.provider) || {};
  const iprov = impact.provider || {};
  if (pprov.id !== iprov.id || pprov.version !== iprov.version) {
    return buildRejected("provider_mismatch");
  }

  // BINDING: canonical sorted req paths == echo (already) AND exactly one Impact origin form
  // originPath form (single-target legacy without targets) is malformed; reject even on name match
  // targets[] form (multi or single) is the exclusive allowed
  const hasTopLevelOriginPath = Object.prototype.hasOwnProperty.call(impact, "originPath") && impact.originPath != null;
  const hasTargetsArray = Array.isArray(impact.targets);
  if (hasTopLevelOriginPath || !hasTargetsArray) {
    return buildRejected("origin_form_mismatch");
  }
  const impactOriginPaths = new Set();
  for (const t of (impact.targets || [])) {
    if (t && typeof t.originPath === "string") impactOriginPaths.add(t.originPath);
  }
  const reqSet = new Set(normalizedRequest.task.paths);
  if (reqSet.size !== impactOriginPaths.size || ![...reqSet].every((p) => impactOriginPaths.has(p))) {
    return buildRejected("origin_set_mismatch");
  }

  // truthful terminal status/nulls -> not_evaluated (even vs clean evidence); dirty-true claim mismatch -> stale
  const erTerminal = ["unavailable", "unborn", "not_git"].includes(er.status) || er.dirty === null || er.commitSha === null || er.isLinkedWorktree === null;
  if (erTerminal) {
    return buildNotEvaluatedNoContainers("working_tree_observation_only");
  }
  let isStale = false;
  for (const k of revKeys) {
    if (pr[k] !== er[k]) { isStale = true; break; }
  }
  if (pr.branch !== er.branch) isStale = true;
  if (isStale) {
    return buildStaleNoContainers();
  }

  // now matched clean observation
  if (er.status !== "available" || er.dirty !== false || er.isLinkedWorktree !== true) {
    return buildNotEvaluatedNoContainers("working_tree_observation_only");
  }

  // symbols nonempty: lift gate only when already-produced completeness witness binds + holds
  let passedSymbolWitness;
  if (normalizedRequest.task.symbols && normalizedRequest.task.symbols.length > 0) {
    let symbolWitness;
    try {
      symbolWitness = normalizeSymbolTargetCompletenessWitness(
        evidence && evidence.symbolTargetCompletenessWitness
      );
    } catch (e) {
      return buildNotEvaluatedNoContainers(e.code || "symbol_target_evidence_missing");
    }
    const symbolEval = evaluateSymbolTargetCompletenessWitness(symbolWitness, {
      taskPaths: normalizedRequest.task.paths,
      symbols: normalizedRequest.task.symbols,
      projectId: normalizedRequest.projectId,
      repositoryId: er.repositoryId,
      worktreeId: er.worktreeId,
      snapshotToken: pack.analysis.snapshotToken
    }, { pack, impact });
    if (!symbolEval.ok) {
      return buildNotEvaluatedNoContainers(symbolEval.code);
    }
    // bound holds established — continue existing pack/impact classification (no WRITE widen)
    // Fix 2: carry witness into total input budget so oversized witness cannot bypass
    passedSymbolWitness = symbolEval.witness;
  }

  // global unevaluated Impact -> not_evaluated with no classification containers
  // per 38 G/I: unsupported / unavailable / not_evaluated global status or finding -> no write containers
  if (impact.findingState === "not_evaluated" ||
      impact.status === "not_evaluated" ||
      impact.status === "unsupported" ||
      impact.status === "unavailable" ||
      (impact.observation && impact.observation.incomplete && !impact.affectedFiles) ) {
    return buildNotEvaluatedNoContainers("impact_not_evaluated");
  }

  // budget check (now enforces pack/impact <=131072 too; Fix 2 includes witness when present)
  try {
    checkInputBudget(
      normalizedRequest.operationIntent ? request : normalizedRequest,
      pack,
      impact,
      passedSymbolWitness
    );
  } catch (e) {
    return buildRejected("scope_budget_exceeded");
  }

  // Activate deletion only after the existing binding/staleness gates and whole proof validation.
  let deletion;
  if (normalizedRequest.operationIntent) {
    try {
      deletion = bindDeleteIntent(normalizedRequest.operationIntent, normalizedRequest.task.paths, pack, impact);
    } catch (error) {
      return buildRejected(error.code);
    }
    if (deletion.notEvaluated) return buildNotEvaluatedNoContainers(deletion.notEvaluated);
  }

  // build write items (explicit only)
  const writePaths = normalizedRequest.task.paths;
  const writeItems = writePaths.map((p) => ({
    target: makeFileTarget(p),
    roles: ["explicit_task_path"],
    ruleIds: deletion ? ["explicit_delete_intent", "explicit_task_path"] : ["explicit_task_path"],
    evidenceRefs: [],
    origins: [],
    attribution: null
  }));

  // map from impact using origins[].minDistance ; reject dist0 non-origin
  let affected = impact.affectedFiles || [];
  if (!Array.isArray(affected)) affected = [];
  const targetOrigins = (impact.targets || []).filter(t => t && t.originPath).map(t => ({ originPath: t.originPath, minimumDistance: 0, witness: null }));
  if (deletion) targetOrigins.sort(compareOrigin);

  // reject dist-0 that is not explicit origin
  for (const ao of (impact.affectedFiles || [])) {
    const d = getMinDistance(ao);
    if (d === 0 && !writePaths.includes(ao.path)) {
      return buildRejected("distance_zero_non_origin");
    }
  }

  const classified = new Map();
  for (const wp of writePaths) {
    classified.set(wp, { write: true, item: writeItems.find(w => w.target.path === wp) });
  }

  let hasAnyEvidence = false;
  for (const item of affected) {
    if (!item || !item.path || typeof item.path !== "string") {
      return buildRejected("malformed_affected_record");
    }
    for (const o of (item.origins || [])) {
      if (o && typeof o.minimumDistance !== "number") {
        return buildRejected("malformed_distance");
      }
    }
    hasAnyEvidence = true;
    const isWritePath = writePaths.includes(item.path);
    const cls = classifyFromImpact(item, effectiveSem, normalizedRequest.includeTests, isWritePath, !!deletion);
    if (isWritePath) {
      // keep lower-classif evidence (origins, affected_file role) on WRITE winner
      const wentry = classified.get(item.path);
      if (wentry && wentry.item) {
        if (!wentry.item.roles.includes("affected_file")) {
          wentry.item.roles = [...new Set([...wentry.item.roles, "affected_file"])].sort(compareStrings);
        }
        const addO = (item.origins || []).map(o => ({
          originPath: o.originPath,
          minimumDistance: o.minimumDistance,
          witness: o.witness ? { ...o.witness } : null,
          originSummary: item.originSummary || null
        }));
        const exist = new Set((wentry.item.origins || []).map(o => o.originPath));
        for (const ao of addO) {
          if (ao.originPath && !exist.has(ao.originPath)) {
            wentry.item.origins = wentry.item.origins || [];
            wentry.item.origins.push(ao);
          }
        }
        // union evidenceRefs too
        const addRefs = (item.origins || []).map(makeEvidenceRef);
        const erExist = new Set((wentry.item.evidenceRefs || []).map(r => JSON.stringify(r)));
        for (const r of addRefs) {
          const s = JSON.stringify(r);
          if (!erExist.has(s)) {
            wentry.item.evidenceRefs = wentry.item.evidenceRefs || [];
            wentry.item.evidenceRefs.push(r);
            erExist.add(s);
          }
        }
      }
      continue;
    }
    if (!classified.has(item.path)) {
      const itemOrigins = (item.origins || []).map(o => ({
        originPath: o.originPath,
        minimumDistance: o.minimumDistance,
        witness: o.witness ? { ...o.witness } : null,
        originSummary: item.originSummary || null
      }));
      classified.set(item.path, { category: cls.category, item: {
        target: makeFileTarget(item.path),
        roles: cls.roles,
        ruleIds: [cls.ruleId],
        evidenceRefs: (item.origins || []).map(makeEvidenceRef),
        origins: itemOrigins,
        attribution: null
      }});
    }
  }

  // union test candidates when includeTests; match origins; require consistent if requested
  const incTests = !!normalizedRequest.includeTests;
  const at = impact.affectedTests || {};
  if (incTests) {
    if (at.status === "not_requested" || at.findingState === "not_requested") {
      return buildRejected("includeTests_true_not_requested_mismatch");
    }
    const cands = Array.isArray(at.candidates) ? at.candidates : [];
    for (const cand of cands) {
      if (!cand || !cand.path) {
        return buildRejected("malformed_affected_record");
      }
      if (writePaths.includes(cand.path)) continue;
      // reject if cand projection disagrees with retained affected file origins
      const matchingAf = affected.find(a => a && a.path === cand.path);
      if (matchingAf && Array.isArray(cand.origins) && Array.isArray(matchingAf.origins)) {
        const cset = new Set(cand.origins.map(o => o && o.originPath).filter(Boolean));
        const mset = new Set(matchingAf.origins.map(o => o && o.originPath).filter(Boolean));
        if (cset.size !== mset.size || ![...cset].every(p => mset.has(p))) {
          return buildRejected("candidate_projection_mismatch");
        }
      }
      let entry = classified.get(cand.path);
      const addRole = "affected_test_candidate";
      if (entry && entry.item) {
        if (!entry.item.roles.includes(addRole)) entry.item.roles = [...new Set([...entry.item.roles, addRole])].sort(compareStrings);
        entry.category = "watch"; // force test cand to watch
        // union origins if present
        if (Array.isArray(cand.origins)) {
          // simple union by path
          const exist = new Set((entry.item.origins || []).map(o=>o.originPath));
          for (const o of cand.origins) {
            if (o && o.originPath && !exist.has(o.originPath)) {
              entry.item.origins.push({ originPath: o.originPath, minimumDistance: o.minimumDistance, witness: o.witness ? { ...o.witness } : null , originSummary: cand.originSummary || null });
            }
          }
        }
      } else {
        const cls = classifyFromImpact({origins: cand.origins || [], originSummary: cand.originSummary,
          ...(deletion ? { roles: ["affected_test_candidate"] } : {})}, effectiveSem, true, false, !!deletion);
        cls.category = "watch"; // force requested non-WRITE test candidates to WATCH (even far)
        const itemOrigins = Array.isArray(cand.origins) ? cand.origins.map(o => ({
          originPath: o.originPath, minimumDistance: o.minimumDistance,
          witness: o.witness ? { ...o.witness } : null, originSummary: cand.originSummary || null
        })) : [];
        classified.set(cand.path, { category: cls.category, item: {
          target: makeFileTarget(cand.path),
          roles: cls.roles.sort(compareStrings),
          ruleIds: [cls.ruleId || "distance_1_2_awareness"],
          evidenceRefs: (cand.origins || []).map(makeEvidenceRef),
          origins: itemOrigins,
          attribution: null
        }});
      }
    }
  } else {
    // includeTests false requires not_requested and no candidates
    if (at.candidates && at.candidates.length > 0) {
      return buildRejected("includeTests_false_has_candidates_mismatch");
    }
    const atStatus = at.status || at.findingState;
    if (atStatus && atStatus !== "not_requested") {
      return buildRejected("includeTests_false_not_not_requested_mismatch");
    }
    // omission treated as not_requested for false; partial status when false -> reject (no write avail on mismatch)
  }

  // collect witnesses with full fields for evidence; reject on duplicate id with diff payload
  const witnesses = [];
  const wseen = new Map();
  let evidenceConflict = false;
  function addWitness(w) {
    if (!w || !w.id) return;
    const id = w.id;
    const ser = JSON.stringify(w);
    if (wseen.has(id)) {
      if (wseen.get(id) !== ser) {
        evidenceConflict = true;
      }
      return;
    }
    wseen.set(id, ser);
    witnesses.push({ ...w });
  }
  for (const af of (impact.affectedFiles || [])) {
    for (const o of ((af && af.origins) || [])) if (o && o.witness) addWitness(o.witness);
  }
  const atCands = ((impact.affectedTests && impact.affectedTests.candidates) || []);
  for (const c of atCands) {
    for (const o of ((c && c.origins) || [])) if (o && o.witness) addWitness(o.witness);
  }
  if (evidenceConflict) {
    return buildRejected("conflicting_evidence");
  }

  // sort origins per item (by originPath, minDist, witness) per contract
  for (const [, entry] of classified) {
    if (entry && entry.item && Array.isArray(entry.item.origins)) {
      entry.item.origins.sort(compareOrigin);
      if (deletion) entry.item.evidenceRefs.sort(compareOrigin);
    }
  }
  if (deletion) witnesses.sort((a, b) => compareStrings(a.id, b.id));

  // build categories - no "empty", use available for bounded no-evidence when classification bearing
  const writeCat = {
    status: "available",
    items: writeItems,
    reasons: [],
    truncated: false
  };
  const trackBReservedItem = reservedItemFromTrackBWitness(evidence && evidence.directCouplingWitness);
  const reservedCat = trackBReservedItem
    ? { status: "incomplete", items: [trackBReservedItem], reasons: [], truncated: false }
    : buildEmptyCategory("not_evaluated", ["coupling_evidence_not_supported"]);

  let watchItems = [];
  let impactItems = [];
  for (const [p, c] of classified) {
    if (c.write) continue;
    if (c.category === "watch") watchItems.push(c.item);
    else impactItems.push(c.item);
  }
  watchItems = canonicalItemOrder(watchItems);
  impactItems = canonicalItemOrder(impactItems);

  // truncated attribution stays WATCH
  // (already handled in classify)

  const watchCat = { status: "available", items: watchItems, reasons: [], truncated: false };
  const impactCat = { status: "available", items: impactItems, reasons: [], truncated: false };

  // determine top status; use only closed statuses
  const packObs = pack.observation || {};
  const impactObs = impact.observation || {};
  const impactComp = impact.completeness || {};
  const packIncomplete = packObs.incomplete !== false;
  const impactIncomplete = impactObs.incomplete !== false || impact.status !== "available" || impact.findingState === "not_evaluated";
  const hasMissingTarget = writePaths.some(p => {
    const t = (impact.targets || []).find(tt => tt.originPath === p);
    return !t || !t.targetSource;
  });
  const unevalTargetPaths = (impact.targets || []).filter(t => t && (t.findingState === "not_evaluated" || t.status === "not_evaluated")).map(t => t.originPath);

  let topStatus = "incomplete";
  let topReasons = [];
  if (isStale) {
    topStatus = "stale";
  } else if (packIncomplete || impactIncomplete || hasMissingTarget || unevalTargetPaths.length > 0) {
   topStatus = "incomplete";
   if (packIncomplete) topReasons.push("pack_observation_incomplete");
   if (impactIncomplete) topReasons.push("impact_observation_incomplete");
   if (hasMissingTarget) topReasons.push("target_source_unavailable");
   if (unevalTargetPaths.length > 0) topReasons.push("target_not_evaluated");
 } else if (impact.findingState === "not_evaluated") {
   topStatus = "not_evaluated";
 } else {
   topStatus = "incomplete";
 }

  // RESERVED forces incomplete in this slice
  let resultStatus = (topStatus === "available" && reservedCat.status === "not_evaluated") ? "incomplete" : topStatus;

  // for not_evaluated / stale / rejected : NO classification containers
  const emitCategories = (resultStatus === "available" || resultStatus === "incomplete");

  const completeness = {
    source: [...(impactComp.source || []), ...(packObs.incomplete ? ["pack_incomplete"] : []) ].sort(compareStrings),
    provider: [...(impactComp.provider || [])].sort(compareStrings),
    traversal: [...(impactComp.traversal || [])].sort(compareStrings),
    output: [...(impactComp.output || [])].sort(compareStrings),
    resolver: [
      ...(hasMissingTarget ? ["target_source_unavailable"] : []),
      ...(unevalTargetPaths.length > 0 ? ["target_not_evaluated"] : [])
    ].sort(compareStrings)
  };
  if (effectiveSem === "unknown") {
    completeness.resolver = [...completeness.resolver, "semantics_unknown"].sort(compareStrings);
  }

  if (deletion) completeness.resolver = [...new Set([...completeness.resolver, ...deletion.reasons])].sort(compareStrings);

  // count caps
  const classifiedCount = classified.size;
  if (classifiedCount > MAX_CLASSIFIED_TARGETS) {
    return buildRejected("scope_budget_exceeded");
  }
  let originWitnessRefCount = 0;
  for (const [p, c] of classified) {
    if (c.item && Array.isArray(c.item.origins)) {
      originWitnessRefCount += c.item.origins.length;
    }
  }
  if (originWitnessRefCount > MAX_ORIGIN_WITNESS_REFS) {
    return buildRejected("scope_budget_exceeded");
  }
  const resolverReasonCount = topReasons.length + (deletion ? completeness.resolver.length : 0);
  if (resolverReasonCount > MAX_RESOLVER_REASONS) {
    return buildRejected("scope_budget_exceeded");
  }

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
      repositoryId: er.repositoryId,
      worktreeId: er.worktreeId
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
    ...(deletion && emitCategories ? { operationIntent: deletion.operationIntent } : {}),
    ...(emitCategories ? { write: writeCat } : {}),
    ...(emitCategories ? { reserved: reservedCat } : {}),
    ...(emitCategories ? { watch: watchCat } : {}),
    ...(emitCategories ? { impact: impactCat } : {}),
    evidence: {
      origins: targetOrigins.length ? targetOrigins : [],
      witnesses: witnesses
    },
    completeness,
    limits: {
      compactBytes: normalizedRequest.limits ? normalizedRequest.limits.compactBytes : 65536,
      classifiedTargets: classifiedCount,
      originWitnessRefs: originWitnessRefCount,
      resolverReasons: resolverReasonCount
    },
    stale: {
      state: isStale ? "stale" : "bound",
      checkedAgainst: "supplied_expected_revision",
      requiresReobservation: true,
      reasons: isStale ? ["revision_observation_differs"] : []
    },
    generatedAt: null,
    reasons: topReasons.length ? topReasons.map(r => makeReason("composition", r)) : []
  };

  // budget output - requested compactBytes (default 65536 per contract) must not be exceeded; reject
  const outBytes = countCompactBytes(output);
  const requestedBudget = (normalizedRequest.limits && typeof normalizedRequest.limits.compactBytes === "number")
    ? normalizedRequest.limits.compactBytes : 65536;
  if (outBytes > requestedBudget || outBytes > MAX_COMPACT_OUTPUT) {
    return buildRejected("scope_budget_exceeded");
  }

  // for this foundation slice, full available is unreachable because reserved=not_evaluated
  if (output.status === "available") {
    output.status = "incomplete";
  }

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

  function buildNotEvaluatedNoContainers(reasonCode) {
    return {
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
      revisionBinding: { status: er.status, commitSha: er.commitSha, branch: er.branch, dirty: er.dirty, isLinkedWorktree: er.isLinkedWorktree, repositoryId: er.repositoryId, worktreeId: er.worktreeId },
      changeSemantics: { declared: sem.declared, inferred: sem.inferred, effective: sem.effective, provenance: sem.provenance, reasons: sem.reasons },
      completeness: { source: [], provider: [], traversal: [], output: [], resolver: [reasonCode] },
      limits: { compactBytes: 65536, classifiedTargets: 0, originWitnessRefs: 0, resolverReasons: 1 },
      stale: { state: "bound", checkedAgainst: "supplied_expected_revision", requiresReobservation: true, reasons: [] },
      generatedAt: null,
      reasons: [{ stage: "evaluation", code: reasonCode }]
    };
  }

  function buildStaleNoContainers(reasonCode = "revision_observation_differs") {
    return {
      schemaVersion: EFFECTIVE_TASK_SCOPE_SCHEMA_VERSION,
      analysisVersion: EFFECTIVE_TASK_SCOPE_ANALYSIS_VERSION,
      policyVersion: EFFECTIVE_TASK_SCOPE_POLICY_VERSION,
      status: "stale",
      task: {
        id: normalizedRequest.task.id,
        title: normalizedRequest.task.title,
        paths: normalizedRequest.task.paths,
        symbols: normalizedRequest.task.symbols
      },
      projectId: normalizedRequest.projectId,
      project: { rootId: normalizedRequest.worktree.rootId, relativePath: normalizedRequest.worktree.relativePath },
      revisionBinding: { status: er.status, commitSha: er.commitSha, branch: er.branch, dirty: er.dirty, isLinkedWorktree: er.isLinkedWorktree, repositoryId: er.repositoryId, worktreeId: er.worktreeId },
      changeSemantics: { declared: sem.declared, inferred: sem.inferred, effective: sem.effective, provenance: sem.provenance, reasons: sem.reasons },
      completeness: { source: [], provider: [], traversal: [], output: [], resolver: [reasonCode] },
      limits: { compactBytes: 65536, classifiedTargets: 0, originWitnessRefs: 0, resolverReasons: 1 },
      stale: { state: "stale", checkedAgainst: "supplied_expected_revision", requiresReobservation: true, reasons: [reasonCode] },
      generatedAt: null,
      reasons: [{ stage: "evaluation", code: reasonCode }]
    };
  }
}