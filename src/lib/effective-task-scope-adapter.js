import { composeEffectiveTaskScope } from "./effective-task-scope.js";
import {
  materializeBoundedJsonData,
  checkInputBudget,
  MAX_COMPACT_INPUT,
  effectiveTaskScopeError
} from "./effective-task-scope-policy.js";

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

/**
 * Internal data-only seam for already-decoded Node success envelopes.
 * Envelope success is neither evidence completeness nor authenticity/permission.
 * Request, binding, version and classification rules remain in the composer.
 */
export function composeEffectiveTaskScopeFromEnvelopes(request, envelopes) {
  let safe;
  try {
    // Materialize both complete arguments before reading any supplied member.
    safe = materializeBoundedJsonData({ request, envelopes });
    if (Buffer.byteLength(JSON.stringify(safe), "utf8") > MAX_COMPACT_INPUT) {
      throw effectiveTaskScopeError("scope_budget_exceeded");
    }
    if (!isRecord(safe.envelopes) || Object.keys(safe.envelopes).length !== 2 ||
        !Object.hasOwn(safe.envelopes, "pack") || !Object.hasOwn(safe.envelopes, "impact")) {
      throw invalidEnvelope();
    }
    validateEnvelope(safe.envelopes.pack);
    validateEnvelope(safe.envelopes.impact);
    // Wrapper overhead never enlarges either inner domain budget.
    checkInputBudget(safe.request, safe.envelopes.pack.data, safe.envelopes.impact.data);
  } catch (error) {
    if (error.code === "scope_budget_exceeded") {
      throw effectiveTaskScopeError("scope_budget_exceeded", "scope_budget_exceeded");
    }
    throw invalidEnvelope();
  }

  try {
    return composeEffectiveTaskScope(safe.request, {
      pack: safe.envelopes.pack.data,
      impact: safe.envelopes.impact.data
    });
  } catch {
    throw effectiveTaskScopeError("effective_task_scope_adapter_failed", "effective_task_scope_adapter_failed");
  }
}
