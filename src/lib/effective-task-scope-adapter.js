import { composeEffectiveTaskScope } from "./effective-task-scope.js";
import {
  materializeBoundedJsonData,
  checkInputBudget,
  MAX_COMPACT_INPUT,
  effectiveTaskScopeError
} from "./effective-task-scope-policy.js";

const WITNESS_ENVELOPE_KEY = "symbolTargetCompletenessWitness";

const invalidEnvelope = () => effectiveTaskScopeError(
  "invalid_effective_task_scope_envelope", "invalid_effective_task_scope_envelope"
);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateEnvelope(envelope) {
  if (!isRecord(envelope) ||
      Object.keys(envelope).some(key => !["ok", "data", "message"].includes(key)) ||
      !Object.hasOwn(envelope, "ok") || envelope.ok !== true ||
      !Object.hasOwn(envelope, "data") || !isRecord(envelope.data) ||
      (Object.hasOwn(envelope, "message") && typeof envelope.message !== "string") ||
      // Wrapper markers in data are nesting, not another implicit unwrapping step.
      Object.hasOwn(envelope.data, "ok") || Object.hasOwn(envelope.data, "data")) {
    throw invalidEnvelope();
  }
}

/** Exact allow-list: pack+impact required; optional symbolTargetCompletenessWitness only. */
function assertAllowedEnvelopeKeys(envelopes) {
  if (!isRecord(envelopes)) throw invalidEnvelope();
  if (!Object.hasOwn(envelopes, "pack") || !Object.hasOwn(envelopes, "impact")) {
    throw invalidEnvelope();
  }
  const keys = Object.keys(envelopes);
  const hasWitness = Object.hasOwn(envelopes, WITNESS_ENVELOPE_KEY);
  if (hasWitness) {
    if (keys.length !== 3) throw invalidEnvelope();
    for (const key of keys) {
      if (key !== "pack" && key !== "impact" && key !== WITNESS_ENVELOPE_KEY) {
        throw invalidEnvelope();
      }
    }
  } else if (keys.length !== 2) {
    throw invalidEnvelope();
  } else {
    for (const key of keys) {
      if (key !== "pack" && key !== "impact") throw invalidEnvelope();
    }
  }
}

/**
 * Internal data-only seam for already-decoded Node success envelopes.
 * Envelope success is neither evidence completeness nor authenticity/permission.
 * Request, binding, version and classification rules remain in the composer.
 * Optional already-produced symbolTargetCompletenessWitness envelope is forwarded
 * unchanged into composeEffectiveTaskScope (no producer/A1/IO here).
 */
export function composeEffectiveTaskScopeFromEnvelopes(request, envelopes) {
  let safe;
  let witnessData;
  try {
    // Materialize both complete arguments before reading any supplied member.
    safe = materializeBoundedJsonData({ request, envelopes });
    if (Buffer.byteLength(JSON.stringify(safe), "utf8") > MAX_COMPACT_INPUT) {
      throw effectiveTaskScopeError("scope_budget_exceeded");
    }
    assertAllowedEnvelopeKeys(safe.envelopes);
    validateEnvelope(safe.envelopes.pack);
    validateEnvelope(safe.envelopes.impact);
    if (Object.hasOwn(safe.envelopes, WITNESS_ENVELOPE_KEY)) {
      validateEnvelope(safe.envelopes[WITNESS_ENVELOPE_KEY]);
      witnessData = safe.envelopes[WITNESS_ENVELOPE_KEY].data;
    }
    // Wrapper overhead never enlarges either inner domain budget.
    // Fix 2 / C1: include witness in total compact budget when present.
    if (witnessData !== undefined) {
      checkInputBudget(
        safe.request,
        safe.envelopes.pack.data,
        safe.envelopes.impact.data,
        witnessData
      );
    } else {
      checkInputBudget(safe.request, safe.envelopes.pack.data, safe.envelopes.impact.data);
    }
  } catch (error) {
    if (error.code === "scope_budget_exceeded") {
      throw effectiveTaskScopeError("scope_budget_exceeded", "scope_budget_exceeded");
    }
    throw invalidEnvelope();
  }

  try {
    const evidence = {
      pack: safe.envelopes.pack.data,
      impact: safe.envelopes.impact.data
    };
    if (witnessData !== undefined) {
      evidence.symbolTargetCompletenessWitness = witnessData;
    }
    return composeEffectiveTaskScope(safe.request, evidence);
  } catch {
    throw effectiveTaskScopeError("effective_task_scope_adapter_failed", "effective_task_scope_adapter_failed");
  }
}
