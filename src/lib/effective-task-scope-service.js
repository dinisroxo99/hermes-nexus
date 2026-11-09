import path from "node:path";

import { composeEffectiveTaskScopeFromEnvelopes as composeEffectiveTaskScopeFromEnvelopesDefault } from "./effective-task-scope-adapter.js";
import { normalizeImpactRequest } from "./impact-policy.js";
import { buildProjectImpact as buildProjectImpactDefault } from "./project-impact-service.js";
import { resolveProjectConfig } from "./project-config.js";
import { getConfiguredProjectRoots } from "./project-roots.js";
import { getProjectByIdForIntelligence } from "./projects.js";
import { buildProjectTaskContext as buildProjectTaskContextDefault } from "./task-context.js";
import { canonicalImpactOriginForm } from "./impact-origin-form.js";
import { createScopeSymbolEvidence } from "./project-scope-symbol-evidence.js";

const TASK_CONTEXT_MESSAGE = "Task context constructed.";
const IMPACT_MESSAGE = "Project impact constructed.";

export function createEffectiveTaskScopeBuilder(dependencies = {}) {
  const buildTaskContext = dependencies.buildProjectTaskContext || buildProjectTaskContextDefault;
  const buildImpact = dependencies.buildProjectImpact || buildProjectImpactDefault;
  const compose = dependencies.composeEffectiveTaskScopeFromEnvelopes || composeEffectiveTaskScopeFromEnvelopesDefault;
  const getConfig = dependencies.getProjectConfig || resolveProjectConfig;
  const getRoots = dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots;
  const getProject = dependencies.getProjectByIdForIntelligence || getProjectByIdForIntelligence;

  return function buildEvidence(request) {
    const config = getConfig();
    const registry = {
      roots: getRoots(),
      manualProjectsFile: path.join(config.dataDir, "projects.json"),
      discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json")
    };
    const analyzer = config.serenaPythonImage ? { serena: { image: config.serenaPythonImage } } : undefined;
    const options = { registry, ...(analyzer ? { analyzer } : {}) };
    const locator = forwardedWorktreeLocator(request.projectId, request.worktree, registry, getProject);
    const impactRequest = impactEvidenceRequest(request, locator);
    if (locator) {
      // A forwarded locator must be inside BOTH builders' request contracts. The Context Pack normalizer runs first
      // inside its builder (before any FS access); check Impact's pure normalizer here, before the Pack is built,
      // so a locator only Impact rejects (glob metacharacters, URI-like prefixes) fails before any resolution.
      try {
        normalizeImpactRequest(impactRequest);
      } catch (error) {
        throw sourced(error, "impact");
      }
    }

    const symbolEvidence = request.task.symbols.length ? createScopeSymbolEvidence() : null;
    let pack;
    try {
      // The pack echoes the task it is built from, and the composer binds that echo to the request
      // task (id, title, paths, symbols), so forward exactly the normalized request task.
      pack = buildTaskContext({
        projectId: request.projectId,
        ...(locator ? { worktree: locator } : {}),
        task: { id: request.task.id, title: request.task.title, paths: request.task.paths, symbols: request.task.symbols }
      }, symbolEvidence ? { ...options, collectSources: symbolEvidence.collectSources } : options);
    } catch (error) {
      throw sourced(error, "task-context");
    }

    let impact;
    try {
      impact = buildImpact(request.projectId, impactRequest, options);
    } catch (error) {
      throw sourced(error, "impact");
    }

    let canonicalImpact;
    let scope;
    try {
      canonicalImpact = canonicalImpactOriginForm(request, impact);
      const envelopes = {
        pack: { ok: true, data: pack, message: TASK_CONTEXT_MESSAGE },
        impact: { ok: true, data: canonicalImpact, message: IMPACT_MESSAGE }
      };
      scope = compose(request, envelopes);
      if (symbolEvidence && scope.status === "not_evaluated" && scope.reasons.length === 1
          && scope.reasons[0].code === "symbol_target_evidence_missing") {
        const witness = symbolEvidence.buildWitness(request, pack, canonicalImpact);
        if (witness) {
          scope = compose(request, { ...envelopes, symbolTargetCompletenessWitness: { ok: true, data: witness } });
        }
      }
    } catch (error) {
      throw sourced(error, "compose");
    }
    return { scope, impact: canonicalImpact };
  };
}

// The Impact request carries only fields of Impact's public request contract (impact-policy.js REQUEST_FIELDS):
// `paths`, `includeTests` and, only when forwardedWorktreeLocator returned one, `worktree` (SB-2).
// D1: the body locator is forwarded, here and to the Context Pack builder, only when it differs from the project's
// registered location (rootId or relativePath); a self-located request sends `{ paths, includeTests }` exactly as before.
// D2: that decision uses the injectable dependencies.getProjectByIdForIntelligence lookup; if the lookup fails or returns
// no usable location, nothing is forwarded and the route behaves as before the fix.
// D3: when a locator is forwarded, this request is first checked with normalizeImpactRequest, so a locator outside
// Impact's contract is 400 invalid_impact_request before any builder runs. Identity is bound by the composer from both
// outputs, never copied here.
function impactEvidenceRequest(request, locator) {
  return { paths: request.task.paths, includeTests: request.includeTests, ...(locator ? { worktree: locator } : {}) };
}

// SB-2: the request worktree is forwarded to BOTH builders only when it names a location other than the registered
// project's own one (parent project + linked-worktree locator). Both builders then resolve it through the shared
// registry resolver (projects.js resolveProjectWorktree: registered root + same git common dir + `git worktree list`).
// A self-located request forwards nothing, exactly as before. If the read-only lookup fails, nothing is forwarded and
// the Context Pack builder repeats the same lookup and raises the same error as before; any wrong decision here is
// still caught fail-closed by the builders (worktree_parent_mismatch) or the composer (worktree_locator_mismatch).
function forwardedWorktreeLocator(projectId, worktree, registry, getProject) {
  let registered;
  try {
    registered = getProject(projectId, registry);
  } catch {
    return null;
  }
  if (typeof registered?.rootId !== "string" || typeof registered?.relativePath !== "string") return null;
  if (registered.rootId === worktree.rootId && registered.relativePath === worktree.relativePath) return null;
  return { rootId: worktree.rootId, relativePath: worktree.relativePath };
}

function sourced(error, source) {
  const tagged = new Error("Effective task scope could not be constructed safely.");
  tagged.code = error?.code;
  tagged.source = source;
  return tagged;
}
