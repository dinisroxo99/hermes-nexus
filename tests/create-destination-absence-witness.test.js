// Producer tests PA-1…PA-38 (incl. sub-lettered ids) of the absence-witness evidence contract r3.4
// (§5.1). Only S2a is implemented (A2; §5.1 PIN-1): S1 fixtures run under S2a with no secret-pattern
// name present; the S1/S2b/S3/S4 rows of PA-18/PA-19 are N/A; PA-37 and PA-38 run under S2a (N34-2).
// Real-FS tests run on an allow-listed filesystem (tmpfs /dev/shm when available).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as producer from "../src/lib/create-destination-absence-witness.js";
const { buildCreateDestinationAbsenceWitness } = producer;
import {
  CREATE_ABSENCE_INCOMPLETE_REASONS, CREATE_ABSENCE_WITNESS_HARD_FLAGS, canonicalByteLength, canonicalJson
} from "../src/lib/create-destination-absence-witness-constants.js";
import { isContextSecretSegment } from "../src/lib/context-path-secret-policy.js";
import { produceSymbolTargetCompletenessWitness } from "../src/lib/symbol-target-completeness-witness.js";
import { readProjectRevision } from "../src/lib/project-revision.js";
import { collectContextSources } from "../src/lib/project-context-files.js";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCER_SOURCE = path.join(ROOT, "src/lib/create-destination-absence-witness.js");
const GATE = process.versions.unicode === "17.0" ? false : 'requires a runtime reporting Unicode 17.0 (process.versions.unicode === "17.0")';
const ALLOW = ["0xef53", "0x58465342", "0x9123683e", "0x1021994"];
const SEAM_KEYS = ["openSync", "readlinkSync", "fstatSync", "statfsSync", "lstatSync", "opendirSync", "closeSync"];
const fsTypeOf = (p) => `0x${(fs.statfsSync(p).type >>> 0).toString(16)}`;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function allowListedBase() {
  for (const candidate of ["/dev/shm", os.tmpdir()]) {
    try { if (ALLOW.includes(fsTypeOf(candidate))) return fs.realpathSync(candidate); } catch { /* try next */ }
  }
  return null;
}
const BASE = allowListedBase();

const EXPECTED = Object.freeze({
  projectId: "prj_absence",
  repositoryId: "repo_absence",
  worktreeId: "wt_absence",
  locator: { rootId: "default", relativePath: "projects/absence" },
  revision: { status: "available", commitSha: "a".repeat(40), branch: "main", dirty: false, isLinkedWorktree: false },
  snapshotToken: "token-expected"
});
const liveOk = () => ({ revision: { ...EXPECTED.revision }, snapshotToken: EXPECTED.snapshotToken });

function project(t, layout = {}) {
  assert.ok(BASE, "an allow-listed filesystem (ext4/xfs/btrfs/tmpfs) is required for real-FS producer tests");
  const root = fs.mkdtempSync(path.join(BASE, "hn-absence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, value] of Object.entries(layout)) {
    const abs = path.join(root, rel);
    if (value === "dir") fs.mkdirSync(abs, { recursive: true });
    else { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, value); }
  }
  return root;
}

/** Resolve "/proc/self/fd/N[/rest]" to the real path, for targeted injection in seam overrides. */
function resolveProc(p) {
  const m = /^\/proc\/self\/fd\/(\d+)(\/.*)?$/.exec(String(p));
  if (!m) return String(p);
  let base;
  try { base = fs.readlinkSync(`/proc/self/fd/${m[1]}`); } catch { return String(p); }
  return m[2] ? base + m[2] : base;
}
const resolveFd = (fd) => { try { return fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { return null; } };

function spyFs(overrides = {}) {
  const calls = [];
  const seam = {};
  for (const key of SEAM_KEYS) {
    seam[key] = (...args) => {
      const call = [key, ...args];
      // Resolve descriptor paths at call time (the descriptor is still open).
      call.resolved = typeof args[0] === "number" ? resolveFd(args[0]) : resolveProc(args[0]);
      calls.push(call);
      return overrides[key] ? overrides[key]((...a) => fs[key](...a), ...args) : fs[key](...args);
    };
  }
  return { fs: seam, calls };
}

function build(root, paths, extra = {}) {
  const testSeam = { liveObservation: extra.live ?? liveOk };
  if (extra.fs) testSeam.fs = extra.fs;
  if (extra.afterFirstPass) testSeam.afterFirstPass = extra.afterFirstPass;
  const options = extra.options ?? { testSeam };
  return buildCreateDestinationAbsenceWitness({
    projectRoot: root, request: { paths }, expected: extra.expected ?? EXPECTED, nestedProjectPaths: extra.nested ?? [], options
  });
}

const TOP_KEYS = ["kind", "producerIdentity", "version", "method", "secretNamePolicy", "projectId", "repositoryId", "worktreeId", "project",
  "revision", "snapshotToken", "generatedAt", "requiresReobservation", "observation", "nameComparison", "filesystem", "symlinkPolicy",
  "filtersApplied", "limits", "targets", "failClosedMatrix", "hardFlags", "nonAuthorization", "provenance"].sort();
const RECORD_KEYS = ["newPath", "parentPath", "basename", "ancestors", "nativeLookup", "enumeration", "complete", "incompleteReason", "verdict"].sort();

/** Structural invariants every produced witness must satisfy (§2.1, §2.4, R4/R5 mirror). */
function assertWitness(w) {
  assert.deepEqual(Object.keys(w).sort(), TOP_KEYS);
  assert.equal(w.kind, "create-destination-absence-witness");
  assert.equal(w.producerIdentity, "hermes-nexus-in-repo-create-destination-absence-witness");
  assert.equal(w.version, "create-destination-absence-witness-v1");
  assert.equal(w.method, "parent_directory_full_enumeration");
  assert.equal(w.secretNamePolicy, "S2a");
  assert.equal(w.generatedAt, null);
  assert.equal(w.requiresReobservation, true);
  assert.deepEqual(w.filtersApplied, []);
  assert.deepEqual(w.limits, { maxEntriesPerParent: 1024, maxNameBytes: 255, maxSegments: 64, maxWitnessBytes: 49152 });
  assert.deepEqual(w.nameComparison, { keyId: "hn-create-name-key-v3", unicodeVersion: "17.0", caseFolding: "full_CF", turkicPostFold: true,
    stripDefaultIgnorable: true, trimTrailingDotSpace: true, collisionRule: "K_or_Kk", kernelModelKey: { modelId: "linux-fs-unicode-utf8-nfdicf",
      kernelRef: "v6.17", kernelUcdVersion: "12.1.0", defaultIgnorableAsEmptyStopper: true, cccSource: "folded_character", postSteps: "P4-P7" } });
  assert.deepEqual(Object.keys(w.observation).sort(), ["basis", "bracket", "revisionStable", "tokenStable"]);
  assert.deepEqual(Object.keys(w.filesystem).sort(), ["policyId", "rootFsType"]);
  assert.equal(w.filesystem.policyId, "hn-fs-allowlist-v1");
  assert.equal(w.symlinkPolicy, "no_follow_any_component");
  assert.deepEqual(w.hardFlags, { ...CREATE_ABSENCE_WITNESS_HARD_FLAGS });
  assert.deepEqual(w.nonAuthorization, ["WRITE is classification, not permission", "no filesystem create", "no directory creation",
    "no HTTP or plugin exposure", "no write-time guarantee"]);
  assert.ok(Object.values(w.failClosedMatrix).every((v) => v === true) && Object.keys(w.failClosedMatrix).length === 7);
  assert.ok(w.provenance === null || (Object.keys(w.provenance).sort().join() === "bindingMismatchReason,liveRevision,liveSnapshotToken"));
  const size = canonicalByteLength(w);
  assert.ok(size <= 49152, `size ${size}`);
  assert.equal(size, Buffer.byteLength(JSON.stringify(w), "utf8"));
  const anyComplete = w.targets.some((r) => r.complete);
  if (anyComplete) {
    assert.equal(w.provenance, null);
    assert.equal(w.observation.revisionStable, true);
    assert.equal(w.observation.tokenStable, true);
    assert.ok(ALLOW.includes(w.filesystem.rootFsType));
  }
  const sorted = [...w.targets.map((r) => r.newPath)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  assert.deepEqual(w.targets.map((r) => r.newPath), sorted);
  for (const r of w.targets) {
    assert.deepEqual(Object.keys(r).sort(), RECORD_KEYS);
    const segs = r.newPath.split("/");
    assert.equal(r.basename, segs[segs.length - 1]);
    assert.equal(r.parentPath, segs.slice(0, -1).join("/"));
    assert.equal(r.complete, r.incompleteReason === null);
    if (!r.complete) assert.ok(CREATE_ABSENCE_INCOMPLETE_REASONS.includes(r.incompleteReason), r.incompleteReason);
    if (r.complete) { assert.notEqual(r.enumeration, null); assert.ok(["ENOENT", "present"].includes(r.nativeLookup)); }
    if (r.incompleteReason === "witness_byte_cap") {
      assert.deepEqual(r, { newPath: r.newPath, parentPath: r.parentPath, basename: r.basename, ancestors: [], nativeLookup: null,
        enumeration: null, complete: false, incompleteReason: "witness_byte_cap", verdict: "unknown" });
    }
    if (r.ancestors.length === 0) {
      assert.ok(["segment_cap", "unicode_version_mismatch", "non_utf8_name", "descriptor_verification_unavailable", "witness_byte_cap"].includes(r.incompleteReason));
      assert.equal(r.nativeLookup, null); assert.equal(r.enumeration, null); assert.equal(r.verdict, "unknown");
    } else {
      assert.equal(r.ancestors[0].path, "");
      assert.ok(["directory", "unreadable"].includes(r.ancestors[0].state));
      r.ancestors.forEach((el, i) => {
        assert.deepEqual(Object.keys(el).sort(), ["devIno", "fsType", "path", "state"]);
        assert.equal(el.path, segs.slice(0, i).join("/"));
        assert.equal(el.fsType !== null, el.state === "directory");
        assert.equal(el.devIno !== null, el.state === "directory");
        if (i < r.ancestors.length - 1) assert.equal(el.state, "directory");
      });
      const reached = r.ancestors.length === segs.length && r.ancestors[r.ancestors.length - 1].state === "directory";
      if (!reached) { assert.equal(r.nativeLookup, null); assert.equal(r.enumeration, null); }
      else assert.notEqual(r.nativeLookup, null);
    }
    if (r.enumeration !== null) {
      const e = r.enumeration;
      assert.deepEqual(Object.keys(e).sort(), ["entries", "entryCount", "listingDigest", "redactedSecretEntryCount"]);
      assert.equal(e.entryCount, e.entries.length + e.redactedSecretEntryCount);
      assert.ok(e.entryCount <= 1024);
      assert.deepEqual([...e.entries].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), e.entries);
      assert.equal(new Set(e.entries).size, e.entries.length);
      for (const name of e.entries) {
        assert.equal(isContextSecretSegment(name), false);
        assert.ok(Buffer.byteLength(name) <= 255 && !name.includes("/") && !name.includes("\0"));
      }
      const { listingDigest, ...body } = e;
      assert.equal(listingDigest, sha256(canonicalJson(body)));
      if (r.nativeLookup === "ENOENT") assert.equal(e.entries.includes(r.basename), false);
    }
  }
  return w;
}
const rec = (w, p) => w.targets.find((r) => r.newPath === p);

// ---------------------------------------------------------------------------------------------- static

test("PA-1: static scan: the producer module uses no mutating fs API and no child_process", () => {
  // Code only: comments are stripped so the module documentation may name what it never does.
  const source = fs.readFileSync(PRODUCER_SOURCE, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of [/writeFile/, /mkdir/, /rename/, /unlink/, /\brm(?:Sync|dir)?\s*\(/, /copyFile/, /child_process/, /O_WRONLY/, /O_RDWR/,
    /O_CREAT/, /O_TRUNC/, /O_APPEND/, /appendFile/, /symlinkSync/, /chmod/, /truncate/, /utimes/, /createWriteStream/]) {
    assert.equal(forbidden.test(source), false, String(forbidden));
  }
  assert.match(source, /O_RDONLY/);
  assert.match(source, /O_DIRECTORY/);
  assert.match(source, /O_NOFOLLOW/);
});

test("PA-23: the producer is not imported by the route or the adapter (nor the composer/policy)", () => {
  for (const file of ["src/routes/effective-task-scope.routes.js", "src/lib/effective-task-scope-adapter.js", "src/lib/effective-task-scope.js",
    "src/lib/effective-task-scope-policy.js"]) {
    assert.equal(fs.readFileSync(path.join(ROOT, file), "utf8").includes("create-destination-absence-witness"), false, file);
  }
});

test("PA-26 (producer side): the producer imports the shared D0 secret predicate", () => {
  const source = fs.readFileSync(PRODUCER_SOURCE, "utf8");
  assert.match(source, /import \{ isContextSecretSegment \} from "\.\/context-path-secret-policy\.js";/);
  assert.equal(/credentials\?|id_ed25519/.test(source), false);
});

test("PA-26b: CREATE_ABSENCE_WITNESS_HARD_FLAGS is the #56 HARD_FLAGS copy plus httpExposed:false; #56 file unchanged", () => {
  const parity = produceSymbolTargetCompletenessWitness({}).hardFlags;
  const { httpExposed, ...rest } = CREATE_ABSENCE_WITNESS_HARD_FLAGS;
  assert.equal(httpExposed, false);
  assert.deepEqual(rest, parity);
  assert.equal(Object.keys(CREATE_ABSENCE_WITNESS_HARD_FLAGS).length, 7);
  assert.ok(Object.isFrozen(CREATE_ABSENCE_WITNESS_HARD_FLAGS));
  // The #56 producer file is byte-identical to 55f606c (git blob sha256 of that file at 55f606c).
  const blob = fs.readFileSync(path.join(ROOT, "src/lib/symbol-target-completeness-witness.js"));
  assert.equal(sha256(blob), SYMBOL_WITNESS_SHA256_AT_55F606C);
});
const SYMBOL_WITNESS_SHA256_AT_55F606C = "ee20624d62cbac5c83c64540dda4e10c6e34463d2344b9c8716f4bc3ab94d7e7";

test("PA-12b: canonical JSON vectors (§2.6 P-7), keys inserted in reverse order", () => {
  const s1 = { entries: ["README.md", "é.js"], entryCount: 2 };
  const s1r = {}; for (const k of Object.keys(s1).reverse()) s1r[k] = s1[k];
  assert.equal(canonicalJson(s1r), '{"entries":["README.md","é.js"],"entryCount":2}');
  assert.equal(Buffer.byteLength(canonicalJson(s1r)), 48);
  assert.equal(sha256(canonicalJson(s1r)), "3bd289e3c782ebd24f35f6a175db76a5cfb73d2b3143b55659531c20df41bb7d");
  const s2 = { redactedSecretEntryCount: 1, entryCount: 3, entries: ["README.md", "é.js"] };
  const s2r = {}; for (const k of Object.keys(s2).reverse()) s2r[k] = s2[k];
  assert.equal(canonicalJson(s2r), '{"entries":["README.md","é.js"],"entryCount":3,"redactedSecretEntryCount":1}');
  assert.equal(Buffer.byteLength(canonicalJson(s2r)), 77);
  assert.equal(sha256(canonicalJson(s2r)), "e370fc990fedceb1006cebb82fe392280d147d8247052497d0d2ae7a636286fd");
  assert.equal(canonicalJson({ b: "\uD800", a: [{ d: 1, c: null }] }), '{"a":[{"c":null,"d":1}],"b":"\\ud800"}');
});

// ------------------------------------------------------------------------------------- input (P-8)

function validInput(root = "/nonexistent-root", overrides = {}) {
  return { projectRoot: root, request: { paths: ["src/a.js"] }, expected: structuredClone(EXPECTED), nestedProjectPaths: [], ...overrides };
}

function assertRejectedWithoutIo(t, input) {
  const spy = spyFs();
  let liveCalls = 0;
  const realpath = t.mock.method(fs, "realpathSync");
  if (input && typeof input === "object" && input.options && typeof input.options === "object" && input.options.testSeam && typeof input.options.testSeam === "object") {
    // keep caller-provided seam shape (it is what is being validated)
  } else if (input && typeof input === "object" && !Array.isArray(input) && !("options" in input)) {
    input.options = { testSeam: { fs: spy.fs, liveObservation: () => { liveCalls++; return liveOk(); } } };
  }
  assert.throws(() => buildCreateDestinationAbsenceWitness(input), { code: "invalid_create_absence_witness_request" });
  assert.equal(spy.calls.length, 0);
  assert.equal(liveCalls, 0);
  assert.equal(realpath.mock.callCount(), 0);
  realpath.mock.restore();
}

test("PA-17: 33 targets throw invalid_create_absence_witness_request with zero fs calls", (t) => {
  const paths = Array.from({ length: 33 }, (_, i) => `src/f${String(i).padStart(2, "0")}.js`);
  assertRejectedWithoutIo(t, validInput(undefined, { request: { paths } }));
});

test("PA-17b: every input violation throws before any fs, git or collector call", (t) => {
  const cases = [];
  cases.push(null, "x", [], 42);
  { const i = validInput(); delete i.expected; cases.push(i); }
  cases.push(validInput(undefined, { extra: 1 }));
  cases.push(validInput(undefined, { request: { paths: ["src/a.js"], extra: 1 } }));
  { const i = validInput(); i.expected.extra = 1; cases.push(i); }
  { const i = validInput(); i.expected.locator.extra = 1; cases.push(i); }
  { const i = validInput(); i.expected.revision.extra = 1; cases.push(i); }
  cases.push(validInput(undefined, { options: { extra: 1 } }));
  cases.push(validInput(undefined, { options: { testSeam: { extra: () => {} } } }));
  cases.push(validInput(undefined, { options: { testSeam: { fs: { writeFileSync: () => {} } } } }));
  cases.push(validInput(undefined, { request: { paths: [] } }));
  cases.push(validInput(undefined, { request: { paths: ["src/b.js", "src/a.js"] } }));
  cases.push(validInput(undefined, { request: { paths: ["src/a.js", "src/a.js"] } }));
  cases.push(validInput(undefined, { request: { paths: ["src//a.js"] } }));
  cases.push(validInput(undefined, { request: { paths: ["./a.js"] } }));
  cases.push(validInput(undefined, { request: { paths: ["../a.js"] } }));
  cases.push(validInput(undefined, { request: { paths: [42] } }));
  { const i = validInput(); i.expected.snapshotToken = ""; cases.push(i); }
  { const i = validInput(); i.expected.projectId = 7; cases.push(i); }
  { const i = validInput(); i.expected.revision.dirty = "no"; cases.push(i); }
  { const i = validInput(); i.expected.revision.commitSha = 1; cases.push(i); }
  cases.push(validInput(undefined, { nestedProjectPaths: "src" }));
  cases.push(validInput(undefined, { nestedProjectPaths: [1] }));
  cases.push(validInput("relative/root"));
  cases.push(validInput(undefined, { projectRoot: undefined }));
  for (const input of cases) assertRejectedWithoutIo(t, input);
});

// ------------------------------------------------------------------------------- Unicode gate (P-3)

test("PA-34: a producer Unicode mismatch makes no fs/git/collector/snapshot call and still returns a witness", (t) => {
  for (const runtimeOptions of [{ runtimeUnicodeVersion: "16.0" }, { runtimeUnicodeVersion: undefined }, { runtimeUnicodeVersion: "18.0" }]) {
    const spy = spyFs();
    let liveCalls = 0;
    const mocks = ["realpathSync", "openSync", "lstatSync", "readlinkSync", "opendirSync", "statfsSync", "fstatSync", "readdirSync"]
      .map((name) => t.mock.method(fs, name));
    const versionsBefore = JSON.stringify(process.versions);
    const w = buildCreateDestinationAbsenceWitness({
      projectRoot: "/nonexistent-root", request: { paths: ["src/a.js", "src/b.js"] }, expected: structuredClone(EXPECTED), nestedProjectPaths: [],
      options: { ...runtimeOptions, testSeam: { fs: spy.fs, liveObservation: () => { liveCalls++; return liveOk(); } } }
    });
    for (const m of mocks) { assert.equal(m.mock.callCount(), 0, m.mock.name); m.mock.restore(); }
    assert.equal(spy.calls.length, 0);
    assert.equal(liveCalls, 0);
    assert.equal(JSON.stringify(process.versions), versionsBefore);
    assertWitness(w);
    for (const r of w.targets) {
      assert.deepEqual(r, { newPath: r.newPath, parentPath: "src", basename: r.basename, ancestors: [], nativeLookup: null, enumeration: null,
        complete: false, incompleteReason: "unicode_version_mismatch", verdict: "unknown" });
    }
    assert.equal(w.projectId, EXPECTED.projectId); assert.equal(w.repositoryId, EXPECTED.repositoryId); assert.equal(w.worktreeId, EXPECTED.worktreeId);
    assert.deepEqual(w.project, EXPECTED.locator); assert.deepEqual(w.revision, EXPECTED.revision); assert.equal(w.snapshotToken, EXPECTED.snapshotToken);
    assert.equal(w.provenance, null);
    assert.equal(w.observation.revisionStable, false); assert.equal(w.observation.tokenStable, false);
    assert.equal(w.filesystem.rootFsType, null);
  }
  // Without the property the runtime value is used (no fallback for an explicit undefined, checked above).
  const w = buildCreateDestinationAbsenceWitness({ projectRoot: "/nonexistent-root", request: { paths: ["a.js"] }, expected: structuredClone(EXPECTED),
    nestedProjectPaths: [], options: { testSeam: { liveObservation: liveOk } } });
  assert.equal(w.targets[0].incompleteReason === "unicode_version_mismatch", process.versions.unicode !== "17.0");
});

// --------------------------------------------------------------------------------- real-FS outcomes

test("PA-4 / PA-31 / PA-3: absent target in a 3-entry parent on tmpfs; only directories are opened", { skip: GATE }, (t) => {
  assert.equal(fsTypeOf("/dev/shm"), "0x1021994", "PA-31 needs a tmpfs /dev/shm");
  const root = fs.mkdtempSync(path.join(fs.realpathSync("/dev/shm"), "hn-absence-pa31-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  for (const n of ["c.js", "a.js", "b.md"]) fs.writeFileSync(path.join(root, "src", n), "x");
  const spy = spyFs();
  const w = assertWitness(build(root, ["src/new.js"], { fs: spy.fs }));
  const r = rec(w, "src/new.js");
  assert.equal(r.complete, true); assert.equal(r.incompleteReason, null); assert.equal(r.verdict, "absent");
  assert.equal(r.nativeLookup, "ENOENT");
  assert.deepEqual(r.enumeration.entries, ["a.js", "b.md", "c.js"]);
  assert.equal(r.enumeration.entryCount, 3); assert.equal(r.enumeration.redactedSecretEntryCount, 0);
  assert.deepEqual(r.ancestors.map((a) => [a.path, a.state, a.fsType]), [["", "directory", "0x1021994"], ["src", "directory", "0x1021994"]]);
  assert.match(r.ancestors[1].devIno, /^\d+:\d+$/);
  assert.equal(w.filesystem.rootFsType, "0x1021994");
  assert.equal(w.provenance, null);
  // PA-3: every open is a directory open (O_DIRECTORY | O_NOFOLLOW, read-only).
  const opens = spy.calls.filter((c) => c[0] === "openSync");
  assert.ok(opens.length >= 4);
  for (const [, , flags] of opens) {
    assert.equal(flags & fs.constants.O_DIRECTORY, fs.constants.O_DIRECTORY);
    assert.equal(flags & fs.constants.O_NOFOLLOW, fs.constants.O_NOFOLLOW);
    assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND), 0);
  }
  // every descriptor opened is closed
  const closed = spy.calls.filter((c) => c[0] === "closeSync").length;
  assert.equal(closed, opens.length);
});

function treeHash(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      out.push([path.relative(root, p), st.mode, st.size, st.mtimeMs, st.isFile() ? sha256(fs.readFileSync(p)) : st.isSymbolicLink() ? fs.readlinkSync(p) : ""]);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(root);
  return sha256(JSON.stringify(out));
}

test("PA-2: a full run with the real live observation makes zero mutating fs calls; tree hash unchanged", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n", "README.md": "# x\n" });
  const p = { projectId: EXPECTED.projectId, absolutePath: root };
  const { capturedAt, ...safe } = readProjectRevision(p);
  const token = createProviderSnapshot(p, collectContextSources(p, { excludedPaths: [] }).files, safe).token;
  const expected = { ...structuredClone(EXPECTED), revision: { status: safe.status, commitSha: safe.commitSha, branch: safe.branch, dirty: safe.dirty,
    isLinkedWorktree: safe.isLinkedWorktree }, snapshotToken: token };
  const before = treeHash(root);
  const mutating = ["writeFileSync", "writeSync", "mkdirSync", "mkdtempSync", "renameSync", "unlinkSync", "rmSync", "rmdirSync", "copyFileSync",
    "symlinkSync", "linkSync", "chmodSync", "chownSync", "truncateSync", "ftruncateSync", "appendFileSync", "utimesSync", "futimesSync", "cpSync"]
    .map((name) => t.mock.method(fs, name));
  const opens = t.mock.method(fs, "openSync");
  const w = buildCreateDestinationAbsenceWitness({ projectRoot: root, request: { paths: ["src/new.js", "src/other.js"] }, expected, nestedProjectPaths: [] });
  for (const m of mutating) { assert.equal(m.mock.callCount(), 0, m.mock.name); m.mock.restore(); }
  for (const call of opens.mock.calls) {
    const flags = call.arguments[1] ?? 0;
    assert.equal(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND), 0);
  }
  opens.mock.restore();
  assert.equal(treeHash(root), before);
  assertWitness(w);
  assert.equal(w.provenance, null);
  assert.equal(rec(w, "src/new.js").complete, true);
  assert.equal(rec(w, "src/new.js").verdict, "absent");
  assert.equal(w.observation.revisionStable, true);
  assert.equal(w.observation.tokenStable, true);
});

test("PA-5: a parent replaced by a symlink to outside the root is a boundary; the outside is never listed", { skip: GATE }, (t) => {
  const root = project(t, { "keep.txt": "x" });
  const outside = project(t, { "secret-outside.txt": "OUTSIDE" });
  fs.symlinkSync(outside, path.join(root, "src"));
  const spy = spyFs();
  const w = assertWitness(build(root, ["src/new.js"], { fs: spy.fs }));
  const r = rec(w, "src/new.js");
  assert.deepEqual(r.ancestors.map((a) => a.state), ["directory", "symlink"]);
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "ancestor_scope_out");
  assert.equal(r.enumeration, null); assert.equal(r.nativeLookup, null); assert.equal(r.verdict, "ancestor_boundary");
  for (const c of spy.calls) if (c[0] === "opendirSync") assert.notEqual(c.resolved, outside);
  assert.equal(JSON.stringify(w).includes("secret-outside"), false);
});

test("PA-6: a readlink mismatch on a component is descriptor_verification_unavailable", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const spy = spyFs({ readlinkSync: (real, p) => (resolveProc(p) === path.join(root, "src") ? "/elsewhere/src" : real(p)) });
  const r = rec(assertWitness(build(root, ["src/new.js"], { fs: spy.fs })), "src/new.js");
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "descriptor_verification_unavailable");
  assert.deepEqual(r.ancestors.map((a) => a.path), [""]);
  assert.equal(r.enumeration, null); assert.equal(r.verdict, "unknown");
});

test("PA-7 / PA-30: a symlink or a directory named like the target is EXISTS", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x", "src/new.js-dir/keep": "x" });
  fs.symlinkSync("/nonexistent-target", path.join(root, "src", "new.js"));
  fs.mkdirSync(path.join(root, "src", "dir.js"));
  const w = assertWitness(build(root, ["src/dir.js", "src/new.js"]));
  const link = rec(w, "src/new.js");
  assert.equal(link.nativeLookup, "present"); assert.equal(link.complete, true); assert.equal(link.verdict, "exists");
  const dir = rec(w, "src/dir.js");
  assert.equal(dir.nativeLookup, "present"); assert.equal(dir.verdict, "exists");
});

test("PA-8: an ancestor symlink to a sibling real directory is a boundary, never followed", { skip: GATE }, (t) => {
  const root = project(t, { "src/b/inner.js": "x" });
  fs.symlinkSync(path.join(root, "src", "b"), path.join(root, "src", "a"));
  const spy = spyFs();
  const r = rec(assertWitness(build(root, ["src/a/new.js"], { fs: spy.fs })), "src/a/new.js");
  assert.deepEqual(r.ancestors.map((a) => [a.path, a.state]), [["", "directory"], ["src", "directory"], ["src/a", "symlink"]]);
  assert.equal(r.incompleteReason, "ancestor_scope_out"); assert.equal(r.enumeration, null); assert.equal(r.verdict, "ancestor_boundary");
  for (const c of spy.calls) if (c[0] === "opendirSync") assert.notEqual(c.resolved, path.join(root, "src", "b"));
});

test("PA-9: a parent holding 1025 entries is entry_cap with a null enumeration", { skip: GATE }, (t) => {
  const root = project(t, { "src": "dir" });
  for (let i = 0; i < 1025; i++) fs.writeFileSync(path.join(root, "src", `f${i}`), "");
  const r = rec(assertWitness(build(root, ["src/new.js"])), "src/new.js");
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "entry_cap"); assert.equal(r.enumeration, null);
  assert.equal(r.nativeLookup, "ENOENT"); assert.equal(r.verdict, "unknown");
  fs.unlinkSync(path.join(root, "src", "f0"));
  const ok = rec(assertWitness(build(root, ["src/new.js"])), "src/new.js");
  assert.equal(ok.complete, true); assert.equal(ok.enumeration.entryCount, 1024);
});

test("PA-10: unrepresentable listings (non-UTF-8 name, 256-byte name, read error after open) give a null enumeration (case d)", { skip: GATE }, (t) => {
  // (1) a real non-UTF-8 sibling name
  const root = project(t, { "src/a.js": "x" });
  fs.writeFileSync(Buffer.concat([Buffer.from(path.join(root, "src") + "/"), Buffer.from([0xff, 0xfe, 0x2e, 0x6a, 0x73])]), "");
  const r1 = rec(assertWitness(build(root, ["src/new.js"])), "src/new.js");
  assert.equal(r1.complete, false); assert.equal(r1.incompleteReason, "non_utf8_name");
  assert.equal(r1.enumeration, null); assert.equal(r1.nativeLookup, "ENOENT"); assert.equal(r1.verdict, "unknown");
  assert.equal(r1.ancestors.length, 2); assert.equal(r1.ancestors[1].state, "directory");
  // (2) a 256-byte sibling name (injected; Linux filesystems cannot hold one)
  const root2 = project(t, { "src/a.js": "x" });
  const wrapDir = (real, p, o, inject) => {
    const d = real(p, o);
    if (resolveProc(p) !== path.join(root2, "src")) return d;
    let step = 0;
    return { readSync() { step++; const v = inject(step); return v === undefined ? d.readSync() : v; }, closeSync() { d.closeSync(); } };
  };
  const tooLong = spyFs({ opendirSync: (real, p, o) => wrapDir(real, p, o, (step) => (step === 1 ? { name: Buffer.alloc(256, 0x61) } : undefined)) });
  const r2 = rec(assertWitness(build(root2, ["src/new.js"], { fs: tooLong.fs })), "src/new.js");
  assert.equal(r2.incompleteReason, "name_too_long"); assert.equal(r2.enumeration, null); assert.equal(r2.verdict, "unknown");
  assert.equal(r2.nativeLookup, "ENOENT");
  // (3) EIO from readdir after a successful open of the parent
  const eio = spyFs({ opendirSync: (real, p, o) => wrapDir(real, p, o, (step) => {
    if (step === 2) throw Object.assign(new Error("EIO"), { code: "EIO" });
    return undefined;
  }) });
  const r3 = rec(assertWitness(build(root2, ["src/new.js"], { fs: eio.fs })), "src/new.js");
  assert.equal(r3.complete, false); assert.equal(r3.incompleteReason, "unreadable"); assert.equal(r3.enumeration, null);
  assert.equal(r3.ancestors[1].state, "directory"); assert.equal(r3.nativeLookup, "ENOENT"); assert.equal(r3.verdict, "unknown");
});

test("N34-1: a higher-priority reason on an unrepresentable listing still gives a null enumeration", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  fs.writeFileSync(Buffer.concat([Buffer.from(path.join(root, "src") + "/"), Buffer.from([0xff])]), "");
  const live = () => ({ revision: { ...EXPECTED.revision }, snapshotToken: "token-live-different" });
  const r = rec(assertWitness(build(root, ["src/new.js"], { live })), "src/new.js");
  assert.equal(r.incompleteReason, "token_mismatch");
  assert.equal(r.enumeration, null);
  assert.equal(r.nativeLookup, "ENOENT");
});

test("PA-10b: a lone-surrogate path is non_utf8_name with no fs call for it; the other target is processed", { skip: GATE }, (t) => {
  const root = project(t, { "src/x.js": "x" });
  const spy = spyFs();
  const w = assertWitness(build(root, ["src/a\uD800.js", "src/b.js"], { fs: spy.fs }));
  assert.deepEqual(rec(w, "src/a\uD800.js"), { newPath: "src/a\uD800.js", parentPath: "src", basename: "a\uD800.js", ancestors: [], nativeLookup: null,
    enumeration: null, complete: false, incompleteReason: "non_utf8_name", verdict: "unknown" });
  for (const c of spy.calls) for (const arg of c.slice(1)) {
    if (typeof arg !== "string") continue;
    assert.equal(arg.includes("\uFFFD"), false); assert.equal(arg.includes("\uD800"), false); assert.equal(arg.includes("a\uD800"), false);
  }
  const b = rec(w, "src/b.js");
  assert.equal(b.complete, true); assert.equal(b.verdict, "absent");
});

test("PA-11: a listing change between the passes is listing_changed", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const r = rec(assertWitness(build(root, ["src/new.js"], { afterFirstPass: () => fs.writeFileSync(path.join(root, "src", "z.js"), "") })), "src/new.js");
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "listing_changed"); assert.equal(r.verdict, "unknown");
  assert.deepEqual(r.enumeration.entries, ["a.js", "z.js"]);
});

test("PA-11b: the native lookup runs in both passes and is compared by class", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const target = path.join(root, "src", "new.js");
  const scenario = (p1, p2) => {
    let pass = 1;
    const result = (cls) => {
      if (cls === "present") return fs.lstatSync(path.join(root, "src", "a.js"));
      throw Object.assign(new Error(cls), { code: cls });
    };
    const spy = spyFs({ lstatSync: (real, p) => (resolveProc(p) === target ? result(pass === 1 ? p1 : p2) : real(p)) });
    const w = assertWitness(build(root, ["src/new.js"], { fs: spy.fs, afterFirstPass: () => { pass = 2; } }));
    return { r: rec(w, "src/new.js"), lookups: spy.calls.filter((c) => c[0] === "lstatSync" && c.resolved === target).length };
  };
  const a = scenario("ENOENT", "present");
  assert.equal(a.r.incompleteReason, "listing_changed"); assert.equal(a.r.nativeLookup, "present");
  const b = scenario("present", "ENOENT");
  assert.equal(b.r.incompleteReason, "listing_changed"); assert.equal(b.r.nativeLookup, "ENOENT");
  const c = scenario("EIO", "EIO");
  assert.equal(c.r.incompleteReason, "native_lookup_error"); assert.equal(c.r.nativeLookup, "error"); assert.equal(c.r.verdict, "unknown");
  const d = scenario("ENOENT", "ENOENT");
  assert.equal(d.r.nativeLookup, "ENOENT"); assert.equal(d.r.complete, true); assert.equal(d.lookups, 2);
});

test("PA-12: two runs on an unchanged tree are byte-identical", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x", "src/.env": "SECRET", "lib/b.js": "y" });
  const one = canonicalJson(build(root, ["lib/new.js", "src/new.js"]));
  const two = canonicalJson(build(root, ["lib/new.js", "src/new.js"]));
  assert.equal(one, two);
  assert.equal(JSON.parse(one).generatedAt, null);
  assert.equal(one.includes("SECRET"), false);
});

test("PA-12b (witness): canonical size equals JSON.stringify size and digests match", { skip: GATE }, (t) => {
  const root = project(t, { "src/é.js": "x", "src/README.md": "y" });
  const w = assertWitness(build(root, ["src/new.js"]));
  assert.equal(Buffer.byteLength(canonicalJson(w)), Buffer.byteLength(JSON.stringify(w)));
  assert.ok(Buffer.byteLength(canonicalJson(w)) <= 49152);
});

test("PA-13: an ancestor holding .git (directory or file) is a repository boundary", { skip: GATE }, (t) => {
  for (const kind of ["dir", "gitdir: elsewhere\n"]) {
    const root = project(t, { "src/a.js": "x", "src/.git": kind });
    const r = rec(assertWitness(build(root, ["src/new.js"])), "src/new.js");
    assert.deepEqual(r.ancestors.map((a) => a.state), ["directory", "repository_boundary"]);
    assert.equal(r.complete, false); assert.equal(r.incompleteReason, "ancestor_scope_out"); assert.equal(r.enumeration, null);
    assert.equal(r.verdict, "ancestor_boundary");
  }
});

test("PA-14: an ancestor that is a registered nested project is a boundary", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const r = rec(assertWitness(build(root, ["src/new.js"], { nested: ["src"] })), "src/new.js");
  assert.deepEqual(r.ancestors.map((a) => a.state), ["directory", "nested_project"]);
  assert.equal(r.incompleteReason, "ancestor_scope_out"); assert.equal(r.enumeration, null); assert.equal(r.verdict, "ancestor_boundary");
});

test("PA-15: an st_dev change is a device boundary", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const spy = spyFs({ fstatSync: (real, fd, o) => {
    const st = real(fd, o);
    return resolveFd(fd) === path.join(root, "src") ? { dev: st.dev + 1n, ino: st.ino } : st;
  } });
  const r = rec(assertWitness(build(root, ["src/new.js"], { fs: spy.fs })), "src/new.js");
  assert.deepEqual(r.ancestors.map((a) => a.state), ["directory", "device_boundary"]);
  assert.equal(r.incompleteReason, "ancestor_scope_out"); assert.equal(r.enumeration, null); assert.equal(r.verdict, "ancestor_boundary");
});

test("PA-16: no /proc/self/fd: one lstat before pass 1, no directory open, every target DVU with an empty chain", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const spy = spyFs({ lstatSync: (real, p) => {
    if (p === "/proc/self/fd") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return real(p);
  } });
  let liveCalls = 0;
  const deep = `${Array(65).fill("d").join("/")}.js`;
  const w = assertWitness(build(root, [deep, "lib/x.js", "src/new.js"], { fs: spy.fs, live: () => { liveCalls++; return liveOk(); } }));
  assert.equal(liveCalls, 2);
  assert.equal(rec(w, deep).incompleteReason, "segment_cap");
  for (const p of ["lib/x.js", "src/new.js"]) {
    const r = rec(w, p);
    assert.equal(r.complete, false); assert.equal(r.incompleteReason, "descriptor_verification_unavailable");
    assert.deepEqual(r.ancestors, []); assert.equal(r.verdict, "unknown");
  }
  assert.equal(spy.calls.filter((c) => c[0] === "lstatSync" && c[1] === "/proc/self/fd").length, 1);
  assert.deepEqual(spy.calls.map((c) => c[0]), ["lstatSync"]);
  assert.equal(spy.calls.filter((c) => c[0] === "openSync" || c[0] === "opendirSync").length, 0);
  assert.equal(w.filesystem.rootFsType, null);
});

// ------------------------------------------------------------------------------------- byte cap

function namesDir(dir, count, bytes) {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    const stem = `f${String(i).padStart(6, "0")}`;
    fs.writeFileSync(path.join(dir, stem + "x".repeat(bytes - stem.length - 4) + ".txt"), "");
  }
}

test("PA-18: three targets in one 800-name parent: the third is capped deterministically (S2a, with and without .env)", { skip: GATE }, (t) => {
  for (const withEnv of [false, true]) {
    const root = project(t);
    namesDir(path.join(root, "src"), 800, 20);
    if (withEnv) fs.writeFileSync(path.join(root, "src", ".env"), "TOP_SECRET");
    const paths = ["src/a.js", "src/b.js", "src/c.js"];
    const w = assertWitness(build(root, paths));
    for (const p of ["src/a.js", "src/b.js"]) {
      const r = rec(w, p);
      assert.equal(r.complete, true, p);
      assert.equal(r.enumeration.entries.length, 800);
      assert.equal(r.enumeration.redactedSecretEntryCount, withEnv ? 1 : 0);
      assert.equal(r.enumeration.entryCount, withEnv ? 801 : 800);
      const full = canonicalByteLength(r);
      assert.ok(full > 18000 && full < 20000, String(full));
    }
    assert.deepEqual(rec(w, "src/c.js"), { newPath: "src/c.js", parentPath: "src", basename: "c.js", ancestors: [], nativeLookup: null, enumeration: null,
      complete: false, incompleteReason: "witness_byte_cap", verdict: "unknown" });
    assert.ok(canonicalByteLength(w) <= 49152);
    assert.equal(canonicalJson(build(root, paths)), canonicalJson(w));
    assert.equal(canonicalJson(w).includes("TOP_SECRET") || canonicalJson(w).includes('".env"'), false);
  }
});

test("PA-18b: a parent whose full record alone exceeds the cap is capped; the walk continues", { skip: GATE }, (t) => {
  const root = project(t, { "small/a": "", "small/b": "", "small/c": "" });
  namesDir(path.join(root, "big"), 1000, 50);
  const w = assertWitness(build(root, ["big/x.js", "small/y.js"]));
  assert.equal(rec(w, "big/x.js").incompleteReason, "witness_byte_cap");
  assert.deepEqual(rec(w, "big/x.js").ancestors, []);
  assert.equal(rec(w, "small/y.js").complete, true);
  assert.equal(rec(w, "small/y.js").verdict, "absent");
});

test("PA-18c: 32 ~1000-character targets whose smallest witness exceeds 49152 bytes throw (any runtime)", (t) => {
  const root = BASE ? project(t) : "/nonexistent-root";
  const paths = Array.from({ length: 32 }, (_, i) => {
    const segs = [`p${String(i).padStart(2, "0")}`];
    while (segs.join("/").length < 990) segs.push("s".repeat(19));
    return `${segs.join("/")}/x.js`;
  });
  for (const p of paths) assert.ok(p.length > 990 && p.length <= 1024 && p.split("/").length <= 64);
  assert.throws(() => build(root, paths), { code: "create_absence_witness_byte_cap_exceeded" });
});

function segmentCapPaths(segmentLength) {
  // 32 distinct, sorted 65-segment paths (segment_cap); every segment has `segmentLength` characters.
  return Array.from({ length: 32 }, (_, i) => {
    const first = `t${String(i).padStart(2, "0")}`.padEnd(segmentLength, "a");
    const rest = Array.from({ length: 64 }, () => "b".repeat(segmentLength));
    return [first, ...rest].join("/");
  });
}

test("PA-18d / PA-18e: the exact 49152-byte boundary with all-full segment_cap records (tuned from the produced witness)", { skip: GATE }, (t) => {
  const root = project(t);
  const paths = segmentCapPaths(9);
  for (const p of paths) assert.ok(p.length <= 1024 && p.split("/").length === 65, String(p.length));
  const spy = spyFs();
  const probe = { ...structuredClone(EXPECTED), projectId: "p" };
  const probeSize = canonicalByteLength(build(root, paths, { fs: spy.fs, expected: probe }));
  const pad = 49152 - probeSize;
  assert.ok(pad >= 0 && pad < 2000, `probe ${probeSize}`);
  const exact = { ...probe, projectId: "p" + "x".repeat(pad) };
  const w = assertWitness(build(root, paths, { fs: spy.fs, expected: exact }));
  assert.equal(canonicalByteLength(w), 49152);
  assert.equal(w.provenance, null);
  for (const r of w.targets) {
    assert.deepEqual(r, { newPath: r.newPath, parentPath: r.parentPath, basename: r.basename, ancestors: [], nativeLookup: null, enumeration: null,
      complete: false, incompleteReason: "segment_cap", verdict: "unknown" });
  }
  // r3.2's all-minimal S0 would have been 32 × 5 bytes larger and would have thrown.
  const allMinimal = { ...w, targets: w.targets.map((r) => ({ ...r, incompleteReason: "witness_byte_cap" })) };
  assert.equal(canonicalByteLength(allMinimal), 49312);
  assert.equal(canonicalJson(build(root, paths, { fs: spy.fs, expected: exact })), canonicalJson(w));
  // PA-18e: one more byte → S0 = 49153 > 49152 → throw; no record is converted to make room.
  const over = { ...probe, projectId: "p" + "x".repeat(pad + 1) };
  assert.throws(() => build(root, paths, { fs: spy.fs, expected: over }), { code: "create_absence_witness_byte_cap_exceeded" });
  t.diagnostic(`PA-18d tuned: segment length 9, probe size ${probeSize}, projectId length ${exact.projectId.length}, path length ${paths[0].length}`);
});

test("PA-18f: Δ = 0 records (segment_cap, path non_utf8_name) are never capped; big parent capped; small full", { skip: GATE }, (t) => {
  const root = project(t, { "small/a": "", "small/b": "", "small/c": "", "src/keep": "" });
  namesDir(path.join(root, "big"), 1000, 50);
  const deep = `${Array(64).fill("a").join("/")}/x.js`;
  const paths = [deep, "big/x.js", "small/y.js", "src/a\uD800.js"];
  const w = assertWitness(build(root, paths));
  assert.equal(rec(w, deep).incompleteReason, "segment_cap");
  assert.equal(rec(w, "src/a\uD800.js").incompleteReason, "non_utf8_name");
  assert.equal(rec(w, "big/x.js").incompleteReason, "witness_byte_cap");
  assert.equal(rec(w, "small/y.js").complete, true);
  assert.equal(canonicalJson(build(root, paths)), canonicalJson(w));
});

// ------------------------------------------------------------------------------------- secrets (S2a)

test("PA-19 (S2a row): a parent holding .env reports redactedSecretEntryCount:1 and never lists it", { skip: GATE }, (t) => {
  const root = project(t, { "src/.env": "TOP_SECRET", "src/a.js": "x" });
  const r = rec(assertWitness(build(root, ["src/new.js"])), "src/new.js");
  assert.equal(r.enumeration.redactedSecretEntryCount, 1); assert.equal(r.enumeration.entryCount, 2);
  assert.deepEqual(r.enumeration.entries, ["a.js"]);
  assert.equal(r.verdict, "absent");
});

test("PA-20: S2a rule: hidden secrets.json and target ſecrets.json is unknown", { skip: GATE }, (t) => {
  const root = project(t, { "src/secrets.json": "{}", "src/a.js": "x" });
  const r = rec(assertWitness(build(root, ["src/\u017Fecrets.json"])), "src/\u017Fecrets.json");
  assert.equal(r.nativeLookup, "ENOENT"); assert.equal(r.complete, true); assert.equal(r.enumeration.redactedSecretEntryCount, 1);
  assert.equal(r.verdict, "unknown");
});

// ------------------------------------------------------------------------------------- chain pins

test("PA-21: an absent ancestor is parent_absent with ancestor_scope_out", { skip: GATE }, (t) => {
  const root = project(t, { "src/x.js": "x" });
  const r = rec(assertWitness(build(root, ["src/a/b.js"])), "src/a/b.js");
  assert.deepEqual(r.ancestors.map((a) => [a.path, a.state]), [["", "directory"], ["src", "directory"], ["src/a", "absent"]]);
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "ancestor_scope_out"); assert.equal(r.enumeration, null);
  assert.equal(r.verdict, "parent_absent");
});

test("PA-21b: the root element is recorded and the root's own .git is never probed", { skip: GATE }, (t) => {
  const root = project(t, { ".git/HEAD": "ref: refs/heads/main\n", "README.md": "x", "src/a.js": "x" });
  const spyA = spyFs();
  const a = rec(assertWitness(build(root, ["new.js"], { fs: spyA.fs })), "new.js");
  assert.equal(a.ancestors.length, 1);
  assert.deepEqual({ ...a.ancestors[0], devIno: "x" }, { path: "", state: "directory", fsType: a.ancestors[0].fsType, devIno: "x" });
  assert.equal(a.complete, true); assert.equal(a.verdict, "absent");
  const gitProbes = (spy) => spy.calls.filter((c) => c[0] === "lstatSync" && String(c[1]).endsWith("/.git")).map((c) => c.resolved);
  assert.deepEqual(gitProbes(spyA), []);
  const spyB = spyFs();
  const wb = assertWitness(build(root, ["src/new.js"], { fs: spyB.fs }));
  const b = rec(wb, "src/new.js");
  assert.deepEqual(b.ancestors.map((x) => x.path), ["", "src"]);
  assert.deepEqual([...new Set(gitProbes(spyB))], [path.join(root, "src", ".git")]);
  assert.equal(wb.filesystem.rootFsType, b.ancestors[0].fsType);
});

test("PA-21c: a 65-segment target is segment_cap with no fs call for it", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const spy = spyFs();
  const deep = `${Array(65).fill("deep").join("/")}.js`;
  const w = assertWitness(build(root, [deep, "src/b.js"], { fs: spy.fs }));
  assert.deepEqual(rec(w, deep), { newPath: deep, parentPath: deep.slice(0, deep.lastIndexOf("/")), basename: "deep.js", ancestors: [], nativeLookup: null,
    enumeration: null, complete: false, incompleteReason: "segment_cap", verdict: "unknown" });
  for (const c of spy.calls) assert.equal(String(c[1]).includes("deep"), false);
  assert.equal(rec(w, "src/b.js").complete, true);
});

test("PA-22: live token/revision mismatch: expected values stay top-level, live values only in provenance", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const otherRevision = { ...EXPECTED.revision, commitSha: "b".repeat(40) };
  const cases = [
    [() => ({ revision: { ...EXPECTED.revision }, snapshotToken: "token-live" }), "token_mismatch", "snapshot_token_mismatch", "token-live", EXPECTED.revision],
    [() => ({ revision: otherRevision, snapshotToken: EXPECTED.snapshotToken }), "revision_changed", "revision_mismatch", EXPECTED.snapshotToken, otherRevision],
    [() => { throw new Error("collector unavailable"); }, "token_mismatch", "live_observation_unavailable", null, null],
    [() => ({ revision: otherRevision, snapshotToken: "token-live" }), "revision_changed", "revision_mismatch", "token-live", otherRevision]
  ];
  for (const [live, targetReason, bindingReason, liveToken, liveRevision] of cases) {
    const w = assertWitness(build(root, ["src/new.js", "src/other.js"], { live }));
    for (const r of w.targets) { assert.equal(r.complete, false); assert.equal(r.incompleteReason, targetReason); }
    assert.equal(w.snapshotToken, EXPECTED.snapshotToken); assert.deepEqual(w.revision, EXPECTED.revision);
    assert.equal(w.projectId, EXPECTED.projectId); assert.equal(w.repositoryId, EXPECTED.repositoryId); assert.equal(w.worktreeId, EXPECTED.worktreeId);
    assert.deepEqual(w.project, EXPECTED.locator);
    assert.deepEqual(w.provenance, { bindingMismatchReason: bindingReason, liveSnapshotToken: liveToken, liveRevision });
    if (liveToken && liveToken !== EXPECTED.snapshotToken) assert.equal(JSON.stringify({ ...w, provenance: null }).includes(liveToken), false);
  }
  // Pass 2 supplies the live values when pass 1 matched.
  const w2 = assertWitness(build(root, ["src/new.js"], { live: ({ pass }) => ({ revision: { ...EXPECTED.revision }, snapshotToken: pass === 1 ? EXPECTED.snapshotToken : "token-pass2" }) }));
  assert.deepEqual(w2.provenance, { bindingMismatchReason: "snapshot_token_mismatch", liveSnapshotToken: "token-pass2", liveRevision: EXPECTED.revision });
  assert.equal(w2.observation.tokenStable, false); assert.equal(w2.observation.revisionStable, true);
});

const UNSUPPORTED = [0x1021997, 0x5346544e, 0x65735546, 0x4d44, 0x2011bab0, 0xff534d42, 0xfe534d42, 0x6969, 0x12345678];

test("PA-24 / PA-32: unsupported filesystem types are recorded; the walk continues and a witness is emitted", { skip: GATE }, (t) => {
  const root = project(t, { "src/sub/a.js": "x", "other/keep.txt": "x" });
  for (const position of ["src/sub", "src", ""]) {
    for (const type of [...UNSUPPORTED, 0x794c7630]) {
      const at = position === "" ? root : path.join(root, position);
      const spy = spyFs({ statfsSync: (real, p) => (resolveProc(p) === at ? { type } : real(p)) });
      const w = assertWitness(build(root, ["other/x.js", "src/sub/new.js"], { fs: spy.fs }));
      const r = rec(w, "src/sub/new.js");
      assert.equal(r.complete, false); assert.equal(r.incompleteReason, "filesystem_unsupported");
      assert.deepEqual(r.ancestors.map((a) => a.state), ["directory", "directory", "directory"]);
      assert.equal(r.ancestors.find((a) => a.path === position).fsType, `0x${type.toString(16)}`);
      assert.notEqual(r.enumeration, null); assert.equal(r.nativeLookup, "ENOENT"); assert.equal(r.verdict, "unknown");
      const other = rec(w, "other/x.js");
      if (position === "") { assert.equal(other.incompleteReason, "filesystem_unsupported"); assert.equal(w.filesystem.rootFsType, `0x${type.toString(16)}`); }
      else { assert.equal(other.complete, true); assert.equal(other.verdict, "absent"); }
    }
  }
});

test("PA-25: an 8.3-shaped basename is unknown on an allow-listed fs, filesystem_unsupported on NTFS", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const a = rec(assertWitness(build(root, ["src/LONGFI~1.JS"])), "src/LONGFI~1.JS");
  assert.equal(a.complete, true); assert.equal(a.nativeLookup, "ENOENT"); assert.equal(a.verdict, "unknown");
  const spy = spyFs({ statfsSync: (real, p) => (resolveProc(p) === path.join(root, "src") ? { type: 0x5346544e } : real(p)) });
  const b = rec(assertWitness(build(root, ["src/LONGFI~1.JS"], { fs: spy.fs })), "src/LONGFI~1.JS");
  assert.equal(b.complete, false); assert.equal(b.incompleteReason, "filesystem_unsupported");
});

test("PA-27: an ancestor swapped for a symlink between the passes is listing_changed, never absent", { skip: GATE }, (t) => {
  const root = project(t, { "src/a/x.js": "x" });
  const r = rec(assertWitness(build(root, ["src/a/new.js"], { afterFirstPass: () => {
    fs.renameSync(path.join(root, "src", "a"), path.join(root, "src", "a.saved"));
    fs.symlinkSync(path.join(root, "src", "a.saved"), path.join(root, "src", "a"));
  } })), "src/a/new.js");
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "listing_changed");
  assert.notEqual(r.verdict, "absent");
});

test("PA-28 / PA-29: EACCES opening an ancestor or on its .git probe is unreadable (never a boundary or absent)", { skip: GATE }, (t) => {
  const root = project(t, { "src/a/x.js": "x" });
  const eacces = () => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); };
  const openSpy = spyFs({ openSync: (real, p, f) => (resolveProc(p) === path.join(root, "src", "a") ? eacces() : real(p, f)) });
  const r1 = rec(assertWitness(build(root, ["src/a/new.js"], { fs: openSpy.fs })), "src/a/new.js");
  assert.equal(r1.ancestors[r1.ancestors.length - 1].state, "unreadable"); assert.equal(r1.incompleteReason, "unreadable"); assert.equal(r1.verdict, "unknown");
  const gitSpy = spyFs({ lstatSync: (real, p) => (resolveProc(p) === path.join(root, "src", ".git") ? eacces() : real(p)) });
  const r2 = rec(assertWitness(build(root, ["src/a/new.js"], { fs: gitSpy.fs })), "src/a/new.js");
  assert.deepEqual(r2.ancestors.map((a) => [a.path, a.state]), [["", "directory"], ["src", "unreadable"]]);
  assert.equal(r2.incompleteReason, "unreadable"); assert.equal(r2.verdict, "unknown");
});

test("PA-33: a casefold-style native lookup hit without a byte-equal entry is EXISTS", { skip: GATE }, (t) => {
  const root = project(t, { "src/New.js": "x" });
  const target = path.join(root, "src", "new.js");
  const spy = spyFs({ lstatSync: (real, p) => (resolveProc(p) === target ? fs.lstatSync(path.join(root, "src", "New.js")) : real(p)) });
  const r = rec(assertWitness(build(root, ["src/new.js"], { fs: spy.fs })), "src/new.js");
  assert.deepEqual(r.enumeration.entries, ["New.js"]);
  assert.equal(r.nativeLookup, "present"); assert.equal(r.verdict, "exists");
});

test("PA-35: ELOOP then a follow-up lstat reporting a directory is unreadable + listing_changed", { skip: GATE }, (t) => {
  const root = project(t, { "src/a/x.js": "x" });
  const spy = spyFs({ openSync: (real, p, f) => {
    if (resolveProc(p) === path.join(root, "src", "a")) throw Object.assign(new Error("ELOOP"), { code: "ELOOP" });
    return real(p, f);
  } });
  const r = rec(assertWitness(build(root, ["src/a/new.js"], { fs: spy.fs })), "src/a/new.js");
  assert.equal(r.ancestors[r.ancestors.length - 1].state, "unreadable");
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "listing_changed"); assert.equal(r.verdict, "unknown");
});

test("PA-36: BigInt inodes above 2^53 are exact and a pass-2 difference below Number precision is listing_changed", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const run = (ino1, ino2) => {
    let pass = 1;
    const spy = spyFs({ fstatSync: (real, fd, o) => {
      const st = real(fd, o);
      return resolveFd(fd) === path.join(root, "src") ? { dev: st.dev, ino: pass === 1 ? ino1 : ino2 } : st;
    } });
    return rec(assertWitness(build(root, ["src/new.js"], { fs: spy.fs, afterFirstPass: () => { pass = 2; } })), "src/new.js");
  };
  assert.equal(Number(18446744073709551557n), Number(18446744073709551556n));
  const same = run(18446744073709551557n, 18446744073709551557n);
  assert.match(same.ancestors[1].devIno, /:18446744073709551557$/); assert.equal(same.complete, true);
  const diff = run(18446744073709551557n, 18446744073709551556n);
  assert.equal(diff.complete, false); assert.equal(diff.incompleteReason, "listing_changed");
  assert.match(diff.ancestors[1].devIno, /:18446744073709551556$/);
});

test("PA-37 (S2a, N34-2): an empty parent is complete with entryCount 0 and verdict unknown", { skip: GATE }, (t) => {
  const root = project(t, { "src": "dir" });
  const r = rec(assertWitness(build(root, ["src/new.js"])), "src/new.js");
  assert.equal(r.complete, true); assert.equal(r.enumeration.entryCount, 0); assert.equal(r.enumeration.redactedSecretEntryCount, 0);
  assert.deepEqual(r.enumeration.entries, []); assert.equal(r.verdict, "unknown");
});

test("PA-38 (S2a, N34-2): a kernel-key (Kk) collision with a listed sibling is unknown", { skip: GATE }, (t) => {
  const root = project(t, { "src/\u03B1\u03AF.txt": "x", "src/other.js": "y" });
  const r = rec(assertWitness(build(root, ["src/\u1FB3\u0301.txt"])), "src/\u1FB3\u0301.txt");
  assert.equal(r.nativeLookup, "ENOENT"); assert.equal(r.complete, true); assert.equal(r.enumeration.redactedSecretEntryCount, 0);
  assert.equal(r.verdict, "unknown");
});

test("reason priority (PIN-2): listing_changed outranks a token mismatch; DVU outranks everything", { skip: GATE }, (t) => {
  const root = project(t, { "src/a.js": "x" });
  const live = () => ({ revision: { ...EXPECTED.revision }, snapshotToken: "token-live" });
  const r = rec(assertWitness(build(root, ["src/new.js"], { live, afterFirstPass: () => fs.writeFileSync(path.join(root, "src", "b.js"), "") })), "src/new.js");
  assert.equal(r.incompleteReason, "listing_changed");
  const spy = spyFs({ readlinkSync: (real, p) => (resolveProc(p) === path.join(root, "src") ? "/x" : real(p)) });
  const r2 = rec(assertWitness(build(root, ["src/new.js"], { fs: spy.fs, live })), "src/new.js");
  assert.equal(r2.incompleteReason, "descriptor_verification_unavailable");
});

// ------------------------------------------------------------------------- fix round (B-1, G-a, N-2, R-N2)

test("B-1 / G-a(a): a BOM-prefixed sibling is listed faithfully and uniquely (dup/y.js)", { skip: GATE }, (t) => {
  const root = project(t, { "dup/\uFEFFx.js": "bom", "dup/x.js": "plain", "dup/b.js": "b" });
  assert.deepEqual(fs.readdirSync(path.join(root, "dup"), { encoding: "buffer" }).map((b) => b.toString("hex")).sort(),
    ["622e6a73", "782e6a73", "efbbbf782e6a73"]);
  const r = rec(assertWitness(build(root, ["dup/y.js"])), "dup/y.js");
  assert.equal(r.complete, true); assert.equal(r.incompleteReason, null); assert.equal(r.nativeLookup, "ENOENT");
  assert.deepEqual(r.enumeration.entries, ["b.js", "x.js", "\uFEFFx.js"]);
  assert.equal(r.enumeration.entryCount, 3); assert.equal(r.enumeration.redactedSecretEntryCount, 0);
  assert.equal(new Set(r.enumeration.entries).size, 3);
  assert.equal(r.verdict, "absent");
});

test("B-1 / G-a(b): a target colliding with a BOM-prefixed sibling is unknown (collision), not exists (src/x.js)", { skip: GATE }, (t) => {
  const root = project(t, { "src/\uFEFFx.js": "bom", "src/a.js": "a" });
  const r = rec(assertWitness(build(root, ["src/x.js"])), "src/x.js");
  assert.equal(r.nativeLookup, "ENOENT"); assert.equal(r.complete, true); assert.equal(r.incompleteReason, null);
  assert.deepEqual(r.enumeration.entries, ["a.js", "\uFEFFx.js"]);
  assert.equal(r.enumeration.entries.includes("x.js"), false);
  assert.equal(r.verdict, "unknown");
});

test("N-2 (white-box): the S2a rule fires on SECRET(Kk) alone and on SECRET(K) alone; the producer uses it", () => {
  const rule = producer.s2aSecretRuleRequiresUnknown;
  assert.equal(typeof rule, "function");
  const keys = (k, kk) => ({ nameKey: () => k, kernelModelNameKey: () => kk });
  assert.equal(rule(1, "anything", keys("plain.js", ".env")), true, "SECRET(Kk) alone must give unknown");
  assert.equal(rule(1, "anything", keys(".env", "plain.js")), true, "SECRET(K) alone must give unknown");
  assert.equal(rule(1, "anything", keys("plain.js", "plain.js")), false);
  assert.equal(rule(0, "anything", keys(".env", ".env")), false, "n = 0: the rule does not apply");
  assert.equal(rule(2, ".ENV"), true); assert.equal(rule(2, "readme.md"), false);
  const source = fs.readFileSync(PRODUCER_SOURCE, "utf8");
  assert.match(source, /s2aSecretRuleRequiresUnknown\(enumeration\.redactedSecretEntryCount, record\.basename\)/);
});

test("R-N2 / G-b: a project root whose realpath is not valid UTF-8 is unreadable; a U+FFFD look-alike is never walked", { skip: GATE }, (t) => {
  const root = project(t, { "\uFFFD/src/a.js": "decoy" });
  const rawDir = Buffer.concat([Buffer.from(`${root}/`, "utf8"), Buffer.from([0xff])]);
  fs.mkdirSync(rawDir);
  fs.mkdirSync(Buffer.concat([rawDir, Buffer.from("/src", "utf8")]));
  fs.writeFileSync(Buffer.concat([rawDir, Buffer.from("/src/new.js", "utf8")]), "real");
  fs.symlinkSync(Buffer.from([0xff]), path.join(root, "link"));
  assert.equal(fs.realpathSync(path.join(root, "link")), `${root}/\uFFFD`);
  const r = rec(assertWitness(build(path.join(root, "link"), ["src/new.js"])), "src/new.js");
  assert.deepEqual(r.ancestors, [{ path: "", state: "unreadable", fsType: null, devIno: null }]);
  assert.equal(r.complete, false); assert.equal(r.incompleteReason, "unreadable"); assert.equal(r.enumeration, null);
  assert.equal(r.verdict, "unknown");
});

test("R-N2 / P-3: the native root realpath is never called on a Unicode mismatch", (t) => {
  const native = t.mock.method(fs.realpathSync, "native");
  const w = buildCreateDestinationAbsenceWitness({
    projectRoot: "/nonexistent-root", request: { paths: ["src/a.js"] }, expected: structuredClone(EXPECTED), nestedProjectPaths: [],
    options: { runtimeUnicodeVersion: "16.0", testSeam: { liveObservation: liveOk } }
  });
  assert.equal(native.mock.callCount(), 0);
  assert.equal(rec(w, "src/a.js").incompleteReason, "unicode_version_mismatch");
});
