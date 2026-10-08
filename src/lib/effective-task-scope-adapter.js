import { composeEffectiveTaskScope } from "./effective-task-scope.js";
import {
  materializeBoundedJsonData,
  checkInputBudget,
  checkCreateAbsenceInputBudget,
  MAX_COMPACT_INPUT,
  effectiveTaskScopeError
} from "./effective-task-scope-policy.js";

const WITNESS_ENVELOPE_KEY = "symbolTargetCompletenessWitness";
const CREATE_ABSENCE_WITNESS_ENVELOPE_KEY = "createDestinationAbsenceWitness";
const OPTIONAL_ENVELOPE_KEYS = [WITNESS_ENVELOPE_KEY, CREATE_ABSENCE_WITNESS_ENVELOPE_KEY];

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
 * Exact allow-list: pack+impact required; optional symbolTargetCompletenessWitness and/or
 * createDestinationAbsenceWitness. Exactly 2, 3 or 4 keys matching the keys present; any other key refuses.
 */
function assertAllowedEnvelopeKeys(envelopes) {
  if (!isRecord(envelopes)) throw invalidEnvelope();
  if (!Object.hasOwn(envelopes, "pack") || !Object.hasOwn(envelopes, "impact")) {
    throw invalidEnvelope();
  }
  const keys = Object.keys(envelopes);
  const optionalPresent = OPTIONAL_ENVELOPE_KEYS.filter(key => Object.hasOwn(envelopes, key)).length;
  if (keys.length !== 2 + optionalPresent) throw invalidEnvelope();
  for (const key of keys) {
    if (key !== "pack" && key !== "impact" && !OPTIONAL_ENVELOPE_KEYS.includes(key)) {
      throw invalidEnvelope();
    }
  }
}

/**
 * Internal data-only seam for already-decoded Node success envelopes.
 * Envelope success is neither evidence completeness nor authenticity/permission.
 * Request, binding, version and classification rules remain in the composer.
 * Optional already-produced symbolTargetCompletenessWitness envelope is forwarded
 * unchanged into composeEffectiveTaskScope (no producer/A1/IO here).
 * Optional already-produced createDestinationAbsenceWitness envelope is forwarded unchanged
 * as well; only its envelope is checked here, never the witness content (no producer/IO here).
 */
export function composeEffectiveTaskScopeFromEnvelopes(request, envelopes) {
  let safe;
  let witnessData;
  let absenceWitnessData;
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
    if (Object.hasOwn(safe.envelopes, CREATE_ABSENCE_WITNESS_ENVELOPE_KEY)) {
      validateEnvelope(safe.envelopes[CREATE_ABSENCE_WITNESS_ENVELOPE_KEY]);
      absenceWitnessData = safe.envelopes[CREATE_ABSENCE_WITNESS_ENVELOPE_KEY].data;
    }
    // Wrapper overhead never enlarges either inner domain budget.
    // N-9: with the absence witness present, one 327680 total covers request, pack, impact and both witnesses.
    if (absenceWitnessData !== undefined) {
      checkCreateAbsenceInputBudget(
        safe.request,
        safe.envelopes.pack.data,
        safe.envelopes.impact.data,
        witnessData,
        absenceWitnessData
      );
    // Fix 2 / C1: include witness in total compact budget when present.
    } else if (witnessData !== undefined) {
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
    if (absenceWitnessData !== undefined) {
      evidence.createDestinationAbsenceWitness = absenceWitnessData;
    }
    return composeEffectiveTaskScope(safe.request, evidence);
  } catch {
    throw effectiveTaskScopeError("effective_task_scope_adapter_failed", "effective_task_scope_adapter_failed");
  }
}
