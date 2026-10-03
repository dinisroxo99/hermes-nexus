/**
 * Bounded RESERVED emission from one Track B strong-direct-coupling witness.
 * Missing or incomplete required parts yield no item (caller keeps not_evaluated).
 * Imports/uses/references/minimumDistance are not consulted.
 */

const PRODUCER_ID = "hermes-nexus.track-b.direct-coupling";
const PRODUCER_VERSION = "1";
const RULE_ID = "agent-manifest.machine-id-rule-source-equality";
const RULE_VERSION = "1";
const A_PATH = "src/lib/agent-manifest.js";
const B_PATH = "docs/project-icm.md";
const BINDING_PROJECT_ID = "prj_9b3567c4-a762-4079-92f9-ac837e45a289";
const BINDING_REPOSITORY_IDENTITY = "625548e238e137b783df17041ea7b0537446cb3fbf9f9aa31bcb05d18add68ec";
const B_SHA256 = "ae5841a11e450a16edffc621b256e2d95bfdb2cdca46d003f1b5acb65c60f96e";
const B_HEAD_BLOB = "692a0761df20458e69a78b55eea30b5ff24d4436";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function emptyStringArray(value) {
  return Array.isArray(value) && value.length === 0;
}

/**
 * Returns the single RESERVED item when the witness establishes the known
 * A→B machine-id obligation; otherwise null.
 */
export function reservedItemFromTrackBWitness(witness) {
  if (!isPlainObject(witness)) return null;

  const producer = witness.producer;
  const rule = witness.rule;
  const pair = witness.pair;
  const invariant = witness.invariant;
  const authority = witness.authority;
  const triggeringChange = witness.triggeringChange;
  const initialSatisfaction = witness.initialSatisfaction;
  const oneSidedViolation = witness.oneSidedViolation;
  const consistencyObligation = witness.consistencyObligation;
  const binding = witness.binding;
  const proposedSourceDelta = witness.proposedSourceDelta;
  const coverage = witness.coverage;

  if (!isPlainObject(producer) || producer.id !== PRODUCER_ID || producer.version !== PRODUCER_VERSION) return null;
  if (!isPlainObject(rule) || rule.id !== RULE_ID || rule.version !== RULE_VERSION) return null;
  if (!nonEmptyString(witness.analysisCapability)) return null;

  if (!isPlainObject(pair) || pair.direction !== "A_to_B") return null;
  if (!isPlainObject(pair.A) || pair.A.artifactPath !== A_PATH || !isPlainObject(pair.A.locus)) return null;
  if (!isPlainObject(pair.B) || pair.B.artifactPath !== B_PATH || !isPlainObject(pair.B.locus)) return null;

  if (!isPlainObject(invariant) || !nonEmptyString(invariant.statement) || !nonEmptyString(invariant.check)) return null;
  if (!isPlainObject(authority) || authority.artifactPath !== B_PATH || !isPlainObject(authority.locus)) return null;

  if (!isPlainObject(triggeringChange) || triggeringChange.on !== "A") return null;
  if (!nonEmptyString(triggeringChange.condition) || !nonEmptyString(triggeringChange.discriminatingId)) return null;

  if (!isPlainObject(initialSatisfaction) || initialSatisfaction.satisfied !== true) return null;
  if (initialSatisfaction.equal !== true) return null;

  if (!isPlainObject(oneSidedViolation) || oneSidedViolation.shown !== true) return null;
  if (oneSidedViolation.aOnly !== true || oneSidedViolation.bChanged !== false) return null;
  if (oneSidedViolation.equalAfter !== false) return null;

  if (!isPlainObject(consistencyObligation) || consistencyObligation.at !== "B") return null;
  if (!nonEmptyString(consistencyObligation.mustChange) || !nonEmptyString(consistencyObligation.requiredRegex)) return null;

  if (!isPlainObject(binding)) return null;
  if (binding.projectId !== BINDING_PROJECT_ID) return null;
  if (Object.hasOwn(binding, "repositoryId")) return null;
  if (binding.repositoryIdentity !== BINDING_REPOSITORY_IDENTITY) return null;
  if (!nonEmptyString(binding.worktreeId) || !nonEmptyString(binding.revision)) return null;

  const contentHashes = binding.contentHashes;
  if (!isPlainObject(contentHashes) || !isPlainObject(contentHashes.A) || !isPlainObject(contentHashes.B) || !isPlainObject(contentHashes.authority)) return null;
  if (contentHashes.B.artifactPath !== B_PATH) return null;
  if (contentHashes.B.sha256 !== B_SHA256) return null;
  if (contentHashes.B.headBlob !== B_HEAD_BLOB) return null;
  if (contentHashes.A.artifactPath !== A_PATH || !nonEmptyString(contentHashes.A.sha256)) return null;

  if (!isPlainObject(proposedSourceDelta) || proposedSourceDelta.boundToArtifact !== A_PATH) return null;
  if (!nonEmptyString(proposedSourceDelta.from) || !nonEmptyString(proposedSourceDelta.to)) return null;

  if (!isPlainObject(coverage) || !isPlainObject(coverage.unresolvedOrOmitted)) return null;
  const omitted = coverage.unresolvedOrOmitted;
  if (!emptyStringArray(omitted.requiredPartsUnresolved) || !emptyStringArray(omitted.requiredPartsOmitted)) return null;

  return {
    target: { kind: "file", path: B_PATH },
    roles: ["consistency_obligation"],
    ruleIds: [RULE_ID],
    evidenceRefs: [],
    origins: [],
    attribution: null
  };
}
