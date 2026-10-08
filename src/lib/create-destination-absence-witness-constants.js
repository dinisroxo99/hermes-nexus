/**
 * Pure constants (and the canonical-JSON helper) of the create-destination absence witness v1
 * (absence-witness evidence contract r3.4, §2.1, §2.4, §2.6 P-7, P-9, §3.1 G12). No IO.
 *
 * Imported by the read-only producer (`create-destination-absence-witness.js`, D1) and, in a later
 * slice, by the composer's evaluator (D3), so the composer never imports the fs-using producer.
 */
// Same order as `compareContextStrings` (`project-context-files.js:10`), inlined so this module imports nothing.
const compareCodeUnits = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Copy of the #56 completeness producer's module-private `HARD_FLAGS`
 * (`symbol-target-completeness-witness.js:43–50` @ 55f606c) plus `httpExposed: false` (§2.6 P-9).
 * Parity with the #56 values is pinned by test PA-26b; the #56 file is not edited.
 */
export const CREATE_ABSENCE_WITNESS_HARD_FLAGS = Object.freeze({
  IMPLEMENTATION_AUTHORIZED: "NO",
  SLICE4: "NOT_STARTED",
  STEP4_SLICE4_READY_TO_IMPLEMENT: "NO",
  confinementFlipped: false,
  pr53ReservedUntouched: true,
  trackBUntouched: true,
  httpExposed: false
});

export const CREATE_ABSENCE_WITNESS_KIND = "create-destination-absence-witness";
export const CREATE_ABSENCE_WITNESS_PRODUCER_IDENTITY = "hermes-nexus-in-repo-create-destination-absence-witness";
export const CREATE_ABSENCE_WITNESS_VERSION = "create-destination-absence-witness-v1";
export const CREATE_ABSENCE_WITNESS_METHOD = "parent_directory_full_enumeration";
/** The admitted secret-name option (A2 = S2a). */
export const CREATE_ABSENCE_WITNESS_SECRET_NAME_POLICY = "S2a";
export const CREATE_ABSENCE_WITNESS_SYMLINK_POLICY = "no_follow_any_component";
export const CREATE_ABSENCE_WITNESS_FS_POLICY_ID = "hn-fs-allowlist-v1";

export const CREATE_ABSENCE_WITNESS_LIMITS = Object.freeze({
  maxEntriesPerParent: 1024,
  maxNameBytes: 255,
  maxSegments: 64,
  maxWitnessBytes: 49152
});

/** G12 allow-list, canonical form `"0x" + (f_type >>> 0).toString(16)`: ext2/3/4, xfs, btrfs, tmpfs. */
export const CREATE_ABSENCE_WITNESS_FS_ALLOWLIST = Object.freeze(["0xef53", "0x58465342", "0x9123683e", "0x1021994"]);

export const CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX = Object.freeze({
  truncatedImpliesUnknown: true,
  filteredImpliesInvalid: true,
  symlinkImpliesBoundary: true,
  listingChangedImpliesUnknown: true,
  tokenMismatchImpliesUnknown: true,
  unsupportedFilesystemImpliesUnknown: true,
  unicodeMismatchImpliesUnknown: true
});

export const CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION = Object.freeze([
  "WRITE is classification, not permission",
  "no filesystem create",
  "no directory creation",
  "no HTTP or plugin exposure",
  "no write-time guarantee"
]);

/** §2.4 `incompleteReason` vocabulary (r3.4 adds `ancestor_scope_out`). */
export const CREATE_ABSENCE_INCOMPLETE_REASONS = Object.freeze([
  "entry_cap", "witness_byte_cap", "segment_cap", "unreadable", "non_utf8_name", "name_too_long", "listing_changed",
  "revision_changed", "token_mismatch", "descriptor_verification_unavailable", "secret_policy_unknown",
  "filesystem_unsupported", "unicode_version_mismatch", "native_lookup_error", "ancestor_scope_out"
]);

/**
 * §2.4 reason priority (r3.4, PIN-2) for reasons found during the walk; the first one present wins.
 * The pre-FS reasons (`unicode_version_mismatch` P-3, `segment_cap` P-2, path-level `non_utf8_name`
 * P-5) are decided before any FS read and precede this list; `witness_byte_cap` is a post-walk
 * replacement; `secret_policy_unknown` is S3-only and not implemented.
 */
export const CREATE_ABSENCE_REASON_PRIORITY = Object.freeze([
  "descriptor_verification_unavailable", "listing_changed", "revision_changed", "token_mismatch",
  "filesystem_unsupported", "unreadable", "ancestor_scope_out", "entry_cap", "non_utf8_name", "name_too_long",
  "native_lookup_error"
]);

/** Ancestor states that make a record a scope-out boundary (R8 (a)). */
export const CREATE_ABSENCE_BOUNDARY_STATES = Object.freeze(["symlink", "not_directory", "repository_boundary", "nested_project", "device_boundary"]);

/** §2.6 P-7: recursive key sort by UTF-16 code unit; arrays keep their order. */
export function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort(compareCodeUnits)) out[key] = canonicalValue(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) { return JSON.stringify(canonicalValue(value)); }

export function canonicalByteLength(value) { return Buffer.byteLength(canonicalJson(value), "utf8"); }
