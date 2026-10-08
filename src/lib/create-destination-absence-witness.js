/**
 * Create-destination absence witness producer, v1 (absence-witness evidence contract r3.4, D1).
 *
 * Read-only enumeration of directory NAMES for the parents of declared create targets:
 *   - directory opens only, `O_RDONLY | O_DIRECTORY | O_NOFOLLOW`, every component after the root
 *     opened through `/proc/self/fd/<parentFd>/<segment>` and descriptor-verified by `readlink`;
 *   - `fstat` (bigint) for `dev:ino`, `statfs` for the G12 filesystem allow-list, `lstat` for the
 *     native lookup, the `.git` probe and the ELOOP/ENOTDIR follow-up, `opendir`/`readdir` (buffer
 *     names) for one parent listing per target, `close`;
 *   - no file contents are read by this module, nothing is created, written, renamed or deleted;
 *   - confined to the realpath of the project root; deterministic; every way of not seeing a name is
 *     `complete:false` with an `incompleteReason`; two full passes (before/after re-walk) bracketed by
 *     the live revision/token recomputed with the existing collectors.
 * Secret-pattern names follow the admitted option S2a (counted, never listed).
 * Not wired into the route, the adapter or the composer. Production callers never pass `testSeam`.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { createProviderSnapshot } from "../analyzers/common/analyzer-provider-contract.js";
import { normalizeImpactPaths } from "./impact-policy.js";
import { isContextSecretSegment } from "./context-path-secret-policy.js";
import { collectContextSources, compareContextStrings } from "./project-context-files.js";
import { readProjectRevision } from "./project-revision.js";
import { CREATE_NAME_KEY_ID, KERNEL_MODEL_KEY_DESCRIPTOR, UNICODE_VERSION, kernelModelNameKey, nameKey, namesCollide } from "./create-name-key.js";
import {
  CREATE_ABSENCE_BOUNDARY_STATES, CREATE_ABSENCE_REASON_PRIORITY, CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX,
  CREATE_ABSENCE_WITNESS_FS_ALLOWLIST, CREATE_ABSENCE_WITNESS_FS_POLICY_ID, CREATE_ABSENCE_WITNESS_HARD_FLAGS,
  CREATE_ABSENCE_WITNESS_KIND, CREATE_ABSENCE_WITNESS_LIMITS, CREATE_ABSENCE_WITNESS_METHOD,
  CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION, CREATE_ABSENCE_WITNESS_PRODUCER_IDENTITY,
  CREATE_ABSENCE_WITNESS_SECRET_NAME_POLICY, CREATE_ABSENCE_WITNESS_SYMLINK_POLICY, CREATE_ABSENCE_WITNESS_VERSION,
  canonicalByteLength, canonicalJson
} from "./create-destination-absence-witness-constants.js";

const LIMITS = CREATE_ABSENCE_WITNESS_LIMITS;
const SEAM_FS_KEYS = ["openSync", "readlinkSync", "fstatSync", "statfsSync", "lstatSync", "opendirSync", "closeSync"];
const BOUNDARY = new Set(CREATE_ABSENCE_BOUNDARY_STATES);
const ALLOWED_FS = new Set(CREATE_ABSENCE_WITNESS_FS_ALLOWLIST);
// Fatal and BOM-preserving (B-1): with the WHATWG default ignoreBOM:false a leading U+FEFF would be
// stripped, making a name decode lossy (§1.5, §2.1 case (d), §2.4). Every name decode uses this decoder.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const DEFAULT_KEYS = Object.freeze({ nameKey, kernelModelNameKey });

function requestError() {
  return Object.assign(new Error("Invalid create-destination absence witness request."), { code: "invalid_create_absence_witness_request" });
}
function byteCapError() {
  return Object.assign(new Error("Create-destination absence witness exceeds maxWitnessBytes even in its smallest form."), { code: "create_absence_witness_byte_cap_exceeded" });
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const hasExactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const hasKeysWithin = (value, keys) => isPlainObject(value) && Object.keys(value).every((key) => keys.includes(key));
const nonEmptyString = (value) => typeof value === "string" && value.length > 0;
const stringOrNull = (value) => value === null || typeof value === "string";
const booleanOrNull = (value) => value === null || typeof value === "boolean";
const REVISION_KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree"];

function isRevision(value) {
  return hasExactKeys(value, REVISION_KEYS) && typeof value.status === "string" && stringOrNull(value.commitSha)
    && stringOrNull(value.branch) && booleanOrNull(value.dirty) && booleanOrNull(value.isLinkedWorktree);
}
const sameRevision = (a, b) => REVISION_KEYS.every((key) => a[key] === b[key]);
const pickRevision = (value) => ({ status: value.status, commitSha: value.commitSha, branch: value.branch, dirty: value.dirty, isLinkedWorktree: value.isLinkedWorktree });

function isNormalizedPath(value) {
  if (typeof value !== "string") return false;
  try { return normalizeImpactPaths([value])[0] === value; } catch { return false; }
}

/** §2.6 P-8: exact input; any violation throws before any FS read. */
function validateInput(input) {
  const fail = () => { throw requestError(); };
  if (!isPlainObject(input)) fail();
  const required = ["projectRoot", "request", "expected", "nestedProjectPaths"];
  if (!required.every((key) => Object.hasOwn(input, key)) || !hasKeysWithin(input, [...required, "options"])) fail();
  if (typeof input.projectRoot !== "string" || !input.projectRoot.startsWith("/") || input.projectRoot.includes("\0")) fail();
  const { request, expected, nestedProjectPaths, options } = input;
  if (!hasExactKeys(request, ["paths"]) || !Array.isArray(request.paths) || request.paths.length < 1 || request.paths.length > 32) fail();
  for (let i = 0; i < request.paths.length; i++) {
    if (!isNormalizedPath(request.paths[i])) fail();
    if (i > 0 && !(compareContextStrings(request.paths[i - 1], request.paths[i]) < 0)) fail();
  }
  if (!hasExactKeys(expected, ["projectId", "repositoryId", "worktreeId", "locator", "revision", "snapshotToken"])) fail();
  if (![expected.projectId, expected.repositoryId, expected.worktreeId, expected.snapshotToken].every(nonEmptyString)) fail();
  if (!hasExactKeys(expected.locator, ["rootId", "relativePath"]) || typeof expected.locator.rootId !== "string"
    || typeof expected.locator.relativePath !== "string") fail();
  if (!isRevision(expected.revision)) fail();
  if (!Array.isArray(nestedProjectPaths) || nestedProjectPaths.some((p) => typeof p !== "string")) fail();
  if (options !== undefined) {
    if (!hasKeysWithin(options, ["runtimeUnicodeVersion", "testSeam"])) fail();
    if (Object.hasOwn(options, "testSeam") && options.testSeam !== undefined) {
      const seam = options.testSeam;
      if (!hasKeysWithin(seam, ["fs", "liveObservation", "afterFirstPass"])) fail();
      if (seam.fs !== undefined && (!hasKeysWithin(seam.fs, SEAM_FS_KEYS) || Object.values(seam.fs).some((f) => typeof f !== "function"))) fail();
      if (seam.liveObservation !== undefined && typeof seam.liveObservation !== "function") fail();
      if (seam.afterFirstPass !== undefined && typeof seam.afterFirstPass !== "function") fail();
    }
  }
}

const fsTypeHex = (type) => `0x${(Number(type) >>> 0).toString(16)}`;
const element = (path, state, fsType = null, devIno = null) => ({ path, state, fsType, devIno });
const procPath = (fd, name) => (name === undefined ? `/proc/self/fd/${fd}` : `/proc/self/fd/${fd}/${name}`);
const joinAbsolute = (root, relative) => (root === "/" ? `/${relative}` : `${root}/${relative}`);
/** R-N2: compare a readlink result with the expected absolute path as raw bytes, never as a lossy string. */
const sameLinkBytes = (link, expectedPath) =>
  Buffer.compare(Buffer.isBuffer(link) ? link : Buffer.from(String(link), "utf8"), Buffer.from(expectedPath, "utf8")) === 0;
/** R-N2: the root realpath(3) as raw bytes (native; the JS realpath decodes components lossily), decoded with the fatal BOM-preserving decoder; null when not representable. */
function rootRealpathOf(projectRoot) {
  try {
    const bytes = fs.realpathSync.native(projectRoot, { encoding: "buffer" });
    return utf8.decode(Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Open and verify the root once per pass (G2, §2.6 P-1). Returns `{ dvu }`, `{ unreadable }` or the
 * verified root `{ fd, element, dev, unsupported }`.
 */
function openRoot(io, rootRealpath, flags) {
  let fd;
  try { fd = io.openSync(rootRealpath, flags); } catch { return { unreadable: true }; }
  try {
    let link;
    try { link = io.readlinkSync(procPath(fd), { encoding: "buffer" }); } catch { return close(io, fd, { unreadable: true }); }
    if (!sameLinkBytes(link, rootRealpath)) return close(io, fd, { dvu: true });
    let stat; let statfs;
    try { stat = io.fstatSync(fd, { bigint: true }); statfs = io.statfsSync(procPath(fd)); } catch { return close(io, fd, { unreadable: true }); }
    const fsType = fsTypeHex(statfs.type);
    return { fd, dev: stat.dev, element: element("", "directory", fsType, `${stat.dev}:${stat.ino}`), unsupported: !ALLOWED_FS.has(fsType) };
  } catch {
    return close(io, fd, { unreadable: true });
  }
}

function close(io, fd, result) {
  try { io.closeSync(fd); } catch { /* closing a read-only descriptor; nothing to report */ }
  return result;
}

/** Read one parent listing to end-of-directory (G3). Names are raw bytes; nothing is truncated. */
function readListing(io, parentFd) {
  let dir;
  const raw = [];
  let tooLong = false;
  let nonUtf8 = false;
  try {
    dir = io.opendirSync(procPath(parentFd), { encoding: "buffer" });
    let entry;
    while ((entry = dir.readSync())) {
      const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(String(entry.name), "utf8");
      if ((name.length === 1 && name[0] === 0x2e) || (name.length === 2 && name[0] === 0x2e && name[1] === 0x2e)) continue;
      raw.push(name);
      if (raw.length > LIMITS.maxEntriesPerParent) return { kind: "entry_cap", signature: "entry_cap" };
      if (name.length > LIMITS.maxNameBytes) tooLong = true;
      try { utf8.decode(name); } catch { nonUtf8 = true; }
    }
  } catch {
    return { kind: "unreadable", signature: "unreadable" };
  } finally {
    try { dir?.closeSync(); } catch { /* read-only handle */ }
  }
  const signatureNames = raw.map((name) => name.toString("hex")).sort();
  if (nonUtf8 || tooLong) {
    const kind = nonUtf8 ? "non_utf8_name" : "name_too_long";
    return { kind, signature: `${kind}:${signatureNames.join(",")}` };
  }
  const names = raw.map((name) => utf8.decode(name));
  return { kind: "ok", names, signature: `ok:${signatureNames.join(",")}` };
}

/** One pass for one target: walk root → parent, then (if reached) listing and native lookup. */
function observeTarget(io, root, target, nested, flags) {
  const obs = { chain: [], reasons: new Set(), reached: false, listing: null, lookup: null };
  if (root.dvu) { obs.reasons.add("descriptor_verification_unavailable"); return obs; }
  if (root.unreadable) { obs.chain.push(element("", "unreadable")); obs.reasons.add("unreadable"); return obs; }
  obs.chain.push(root.element);
  if (root.unsupported) obs.reasons.add("filesystem_unsupported");
  const opened = [];
  let parentFd = root.fd;
  let stopped = false;
  try {
    for (let j = 1; j < target.segments.length; j++) {
      const segment = target.segments[j - 1];
      const relative = target.segments.slice(0, j).join("/");
      let childFd;
      try {
        childFd = io.openSync(procPath(parentFd, segment), flags);
      } catch (error) {
        stopped = true;
        if (error?.code === "ENOENT") { obs.chain.push(element(relative, "absent")); obs.reasons.add("ancestor_scope_out"); break; }
        if (error?.code === "ELOOP" || error?.code === "ENOTDIR") {
          let stat;
          try { stat = io.lstatSync(procPath(parentFd, segment)); } catch { obs.chain.push(element(relative, "unreadable")); obs.reasons.add("unreadable"); break; }
          if (stat.isSymbolicLink()) { obs.chain.push(element(relative, "symlink")); obs.reasons.add("ancestor_scope_out"); }
          else if (stat.isDirectory()) { obs.chain.push(element(relative, "unreadable")); obs.reasons.add("unreadable"); obs.reasons.add("listing_changed"); }
          else { obs.chain.push(element(relative, "not_directory")); obs.reasons.add("ancestor_scope_out"); }
          break;
        }
        obs.chain.push(element(relative, "unreadable")); obs.reasons.add("unreadable");
        break;
      }
      opened.push(childFd);
      const unreadable = () => { obs.chain.push(element(relative, "unreadable")); obs.reasons.add("unreadable"); stopped = true; };
      let link;
      try { link = io.readlinkSync(procPath(childFd), { encoding: "buffer" }); } catch { unreadable(); break; }
      if (!sameLinkBytes(link, joinAbsolute(root.realpath, relative))) { obs.reasons.add("descriptor_verification_unavailable"); stopped = true; break; }
      let stat; let statfs;
      try { stat = io.fstatSync(childFd, { bigint: true }); statfs = io.statfsSync(procPath(childFd)); } catch { unreadable(); break; }
      let gitFound = false;
      try { io.lstatSync(procPath(childFd, ".git")); gitFound = true; } catch (error) {
        if (error?.code !== "ENOENT") { unreadable(); break; }
      }
      if (gitFound) { obs.chain.push(element(relative, "repository_boundary")); obs.reasons.add("ancestor_scope_out"); stopped = true; break; }
      if (nested.has(relative)) { obs.chain.push(element(relative, "nested_project")); obs.reasons.add("ancestor_scope_out"); stopped = true; break; }
      if (stat.dev !== root.dev) { obs.chain.push(element(relative, "device_boundary")); obs.reasons.add("ancestor_scope_out"); stopped = true; break; }
      const fsType = fsTypeHex(statfs.type);
      obs.chain.push(element(relative, "directory", fsType, `${stat.dev}:${stat.ino}`));
      if (!ALLOWED_FS.has(fsType)) obs.reasons.add("filesystem_unsupported");
      parentFd = childFd;
    }
    if (!stopped && obs.chain.length === target.segments.length) {
      obs.reached = true;
      obs.listing = readListing(io, parentFd);
      try { io.lstatSync(procPath(parentFd, target.basename)); obs.lookup = "present"; } catch (error) {
        obs.lookup = error?.code === "ENOENT" ? "ENOENT" : "error";
      }
    }
  } catch {
    // Unexpected failure inside the walk: never escapes, never absent.
    obs.reasons.add("unreadable");
    obs.reached = false; obs.listing = null; obs.lookup = null;
  } finally {
    for (const fd of opened.reverse()) close(io, fd);
  }
  return obs;
}

function runPass(io, rootRealpath, targets, nested, flags) {
  const root = openRoot(io, rootRealpath, flags);
  root.realpath = rootRealpath;
  try {
    return { root, observations: new Map(targets.map((target) => [target.newPath, observeTarget(io, root, target, nested, flags)])) };
  } finally {
    if (root.fd !== undefined) close(io, root.fd);
  }
}

function observationSignature(obs) {
  return JSON.stringify([obs.chain, obs.reached, obs.listing ? obs.listing.signature : null]);
}

/** Live revision + snapshot token with the existing collectors (§2.2); never throws. */
function liveObservation(seam, rootRealpath, expected, nestedProjectPaths, pass) {
  if (seam?.liveObservation) {
    try {
      const value = seam.liveObservation({ pass });
      const revision = isPlainObject(value) && isRevision(value.revision) ? pickRevision(value.revision) : null;
      const snapshotToken = isPlainObject(value) && nonEmptyString(value.snapshotToken) ? value.snapshotToken : null;
      return { revision, snapshotToken, unavailable: revision === null || snapshotToken === null };
    } catch {
      return { revision: null, snapshotToken: null, unavailable: true };
    }
  }
  if (rootRealpath === null) return { revision: null, snapshotToken: null, unavailable: true };
  let revision = null;
  try {
    const project = { projectId: expected.projectId, absolutePath: rootRealpath };
    const { capturedAt, ...safe } = readProjectRevision(project);
    revision = pickRevision(safe);
    const observed = collectContextSources(project, { excludedPaths: nestedProjectPaths });
    const snapshotToken = createProviderSnapshot(project, observed.files, safe).token;
    return { revision, snapshotToken, unavailable: false };
  } catch {
    return { revision, snapshotToken: null, unavailable: true };
  }
}

function passMismatch(live, expected) {
  if (live.unavailable) return "live_observation_unavailable";
  if (!sameRevision(live.revision, expected.revision)) return "revision_mismatch";
  if (live.snapshotToken !== expected.snapshotToken) return "snapshot_token_mismatch";
  return null;
}

function s2aEnumeration(names) {
  const entries = names.filter((name) => !isContextSecretSegment(name)).sort(compareContextStrings);
  const body = { entryCount: names.length, entries, redactedSecretEntryCount: names.length - entries.length };
  return { ...body, listingDigest: createHash("sha256").update(canonicalJson(body), "utf8").digest("hex") };
}

/**
 * §3.3 S2a rule (pure): with n > 0 redacted secret-pattern names, a basename whose K or Kk is itself a
 * secret-pattern name is unknown. `keys` is injectable only so a test can exercise each branch alone (N-2).
 */
export function s2aSecretRuleRequiresUnknown(redactedSecretEntryCount, basename, keys = DEFAULT_KEYS) {
  if (!(redactedSecretEntryCount > 0)) return false;
  return isContextSecretSegment(keys.nameKey(basename)) || isContextSecretSegment(keys.kernelModelNameKey(basename));
}

/** Producer-side mirror of the composer's R8 recomputation (§2.5), S2a rule and shape rule included. */
function recomputeVerdict(record) {
  const chain = record.ancestors;
  if (chain.some((el) => BOUNDARY.has(el.state))) return "ancestor_boundary";
  if (chain.length > 0 && chain[chain.length - 1].state === "absent") return "parent_absent";
  if (chain.some((el) => el.state === "unreadable")) return "unknown";
  if (!record.complete) return "unknown";
  const enumeration = record.enumeration;
  if (enumeration.entryCount === 0) return "unknown";
  if (record.nativeLookup === "present") return "exists";
  if (enumeration.entries.includes(record.basename)) return "exists";
  if (enumeration.entries.some((entry) => namesCollide(entry, record.basename))) return "unknown";
  const k = nameKey(record.basename);
  const kk = kernelModelNameKey(record.basename);
  if (s2aSecretRuleRequiresUnknown(enumeration.redactedSecretEntryCount, record.basename)) return "unknown";
  if (k === "" || kk === "" || /~[0-9]/.test(record.basename)) return "unknown";
  return "absent";
}

function emptyChainRecord(target, reason) {
  return { newPath: target.newPath, parentPath: target.parentPath, basename: target.basename, ancestors: [], nativeLookup: null,
    enumeration: null, complete: false, incompleteReason: reason, verdict: "unknown" };
}

function describeTarget(newPath) {
  const segments = newPath.split("/");
  return { newPath, segments, parentPath: segments.slice(0, -1).join("/"), basename: segments[segments.length - 1] };
}

/**
 * Build a create-destination absence witness (contract r3.4 §2). Input and throws: §2.6 P-8.
 * @returns {object} the witness (canonical JSON ≤ maxWitnessBytes)
 */
export function buildCreateDestinationAbsenceWitness(input) {
  validateInput(input);
  const { projectRoot, request, expected, nestedProjectPaths } = input;
  const options = input.options ?? {};
  const seam = options.testSeam ?? {};
  const io = { ...Object.fromEntries(SEAM_FS_KEYS.map((key) => [key, fs[key]])), ...(seam.fs ?? {}) };
  const runtimeUnicodeVersion = Object.hasOwn(options, "runtimeUnicodeVersion") ? options.runtimeUnicodeVersion : process.versions.unicode;
  const targets = request.paths.map(describeTarget);
  const records = new Map();
  let rootFsType = null;
  let provenance = null;
  let revisionStable = false;
  let tokenStable = false;

  if (runtimeUnicodeVersion !== UNICODE_VERSION) {
    // P-3: no filesystem, git, collector or snapshot access at all.
    for (const target of targets) records.set(target.newPath, emptyChainRecord(target, "unicode_version_mismatch"));
  } else {
    const fsTargets = [];
    for (const target of targets) {
      if (target.segments.length > LIMITS.maxSegments) records.set(target.newPath, emptyChainRecord(target, "segment_cap"));
      else if (!target.newPath.isWellFormed()) records.set(target.newPath, emptyChainRecord(target, "non_utf8_name"));
      else fsTargets.push(target);
    }
    const flags = (fs.constants.O_RDONLY ?? 0) | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0);
    // G8 (r3.4, PIN-4): platform check once, before pass 1, never mid-walk.
    let platformOk = Boolean(fs.constants.O_DIRECTORY) && Boolean(fs.constants.O_NOFOLLOW) && typeof io.statfsSync === "function";
    if (platformOk) {
      try { platformOk = io.lstatSync("/proc/self/fd").isDirectory() === true; } catch { platformOk = false; }
    }
    const rootRealpath = rootRealpathOf(projectRoot);
    const live1 = liveObservation(seam, rootRealpath, expected, nestedProjectPaths, 1);
    let pass1 = null;
    let pass2 = null;
    if (platformOk && rootRealpath !== null) {
      const nested = new Set(nestedProjectPaths);
      pass1 = runPass(io, rootRealpath, fsTargets, nested, flags);
      if (seam.afterFirstPass) seam.afterFirstPass();
      pass2 = runPass(io, rootRealpath, fsTargets, nested, flags);
      rootFsType = pass2.root.element ? pass2.root.element.fsType : null;
    }
    const live2 = liveObservation(seam, rootRealpath, expected, nestedProjectPaths, 2);
    revisionStable = live1.revision !== null && live2.revision !== null && sameRevision(live1.revision, live2.revision);
    tokenStable = live1.snapshotToken !== null && live2.snapshotToken !== null && live1.snapshotToken === live2.snapshotToken;
    const m1 = passMismatch(live1, expected);
    const m2 = m1 ? null : passMismatch(live2, expected);
    const mismatch = m1 ?? m2;
    if (mismatch) {
      const live = m1 ? live1 : live2;
      provenance = { bindingMismatchReason: mismatch, liveSnapshotToken: live.snapshotToken, liveRevision: live.revision };
    }
    const bindingReason = mismatch === null ? null : mismatch === "revision_mismatch" ? "revision_changed" : "token_mismatch";

    for (const target of fsTargets) {
      const reasons = new Set();
      if (bindingReason) reasons.add(bindingReason);
      let record;
      if (!pass1) {
        // G8 failed (or the root could not be resolved): no directory is opened.
        if (rootRealpath === null && platformOk) {
          record = { ...emptyChainRecord(target, null), ancestors: [element("", "unreadable")] };
          reasons.add("unreadable");
        } else {
          record = emptyChainRecord(target, null);
          reasons.add("descriptor_verification_unavailable");
        }
      } else {
        const o1 = pass1.observations.get(target.newPath);
        const o2 = pass2.observations.get(target.newPath);
        for (const reason of [...o1.reasons, ...o2.reasons]) reasons.add(reason);
        if (observationSignature(o1) !== observationSignature(o2)) reasons.add("listing_changed");
        if (o1.reached && o2.reached) {
          const c1 = o1.lookup === "error" ? "error" : o1.lookup;
          if (c1 !== o2.lookup) reasons.add("listing_changed");
          else if (o2.lookup === "error") reasons.add("native_lookup_error");
        }
        if (o2.reached && o2.listing.kind !== "ok") reasons.add(o2.listing.kind);
        record = {
          newPath: target.newPath, parentPath: target.parentPath, basename: target.basename,
          ancestors: o2.chain,
          nativeLookup: o2.reached ? o2.lookup : null,
          enumeration: o2.reached && o2.listing.kind === "ok" ? s2aEnumeration(o2.listing.names) : null,
          complete: false, incompleteReason: null, verdict: "unknown"
        };
      }
      const reason = CREATE_ABSENCE_REASON_PRIORITY.find((candidate) => reasons.has(candidate)) ?? null;
      record.complete = reason === null;
      record.incompleteReason = reason;
      records.set(target.newPath, record);
    }
  }

  const witnessTargets = targets.map((target) => {
    const record = records.get(target.newPath);
    return { ...record, verdict: recomputeVerdict(record) };
  });
  const witness = {
    kind: CREATE_ABSENCE_WITNESS_KIND,
    producerIdentity: CREATE_ABSENCE_WITNESS_PRODUCER_IDENTITY,
    version: CREATE_ABSENCE_WITNESS_VERSION,
    method: CREATE_ABSENCE_WITNESS_METHOD,
    secretNamePolicy: CREATE_ABSENCE_WITNESS_SECRET_NAME_POLICY,
    projectId: expected.projectId,
    repositoryId: expected.repositoryId,
    worktreeId: expected.worktreeId,
    project: { rootId: expected.locator.rootId, relativePath: expected.locator.relativePath },
    revision: pickRevision(expected.revision),
    snapshotToken: expected.snapshotToken,
    generatedAt: null,
    requiresReobservation: true,
    observation: { basis: "working_tree", bracket: "before_after_rewalk", revisionStable, tokenStable },
    nameComparison: {
      keyId: CREATE_NAME_KEY_ID, unicodeVersion: UNICODE_VERSION, caseFolding: "full_CF", turkicPostFold: true,
      stripDefaultIgnorable: true, trimTrailingDotSpace: true, collisionRule: "K_or_Kk", kernelModelKey: { ...KERNEL_MODEL_KEY_DESCRIPTOR }
    },
    filesystem: { policyId: CREATE_ABSENCE_WITNESS_FS_POLICY_ID, rootFsType },
    symlinkPolicy: CREATE_ABSENCE_WITNESS_SYMLINK_POLICY,
    filtersApplied: [],
    limits: { ...LIMITS },
    targets: [],
    failClosedMatrix: { ...CREATE_ABSENCE_WITNESS_FAIL_CLOSED_MATRIX },
    hardFlags: { ...CREATE_ABSENCE_WITNESS_HARD_FLAGS },
    nonAuthorization: [...CREATE_ABSENCE_WITNESS_NON_AUTHORIZATION],
    provenance
  };
  witness.targets = applyByteCap(witness, witnessTargets);
  return witness;
}

/** §2.4 byte cap (option A, r3.3 `S0`): deterministic, in `targets[]` order; never truncates a record. */
function applyByteCap(witness, fullRecords) {
  const minimal = (record) => ({ newPath: record.newPath, parentPath: record.parentPath, basename: record.basename, ancestors: [],
    nativeLookup: null, enumeration: null, complete: false, incompleteReason: "witness_byte_cap", verdict: "unknown" });
  const sizes = fullRecords.map((record) => {
    const full = canonicalByteLength(record);
    const min = canonicalByteLength(minimal(record));
    return { full, smaller: Math.min(full, min), delta: full - Math.min(full, min) };
  });
  const base = canonicalByteLength({ ...witness, targets: [] });
  const s0 = base + sizes.reduce((sum, size) => sum + size.smaller, 0) + Math.max(0, fullRecords.length - 1);
  if (s0 > LIMITS.maxWitnessBytes) throw byteCapError();
  let kept = 0;
  const out = fullRecords.map((record, i) => {
    if (s0 + kept + sizes[i].delta <= LIMITS.maxWitnessBytes) { kept += sizes[i].delta; return record; }
    return minimal(record);
  });
  if (canonicalByteLength({ ...witness, targets: out }) > LIMITS.maxWitnessBytes) throw byteCapError();
  return out;
}
