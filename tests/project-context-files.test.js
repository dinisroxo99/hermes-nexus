import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

async function api() {
  const module = await import("../src/lib/project-context-files.js").catch(() => ({}));
  assert.equal(typeof module.collectContextSources, "function");
  return module;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  return { root, write };
}

test("context source observation is deterministic and excludes secrets, symlinks and project boundaries", async (t) => {
  const { collectContextSources } = await api();
  const f = fixture(t);
  f.write("z.ts", "export class Z {}\n");
  f.write("a.ts", "export class A {}\n");
  f.write(".env", "DO_NOT_READ");
  f.write("credentials.json", "DO_NOT_READ");
  f.write("nested/.git", "gitdir: elsewhere");
  f.write("nested/other.ts", "OTHER_PROJECT");
  f.write("registered/other.ts", "OTHER_PROJECT");
  f.write("node_modules/module.ts", "DEPENDENCY");
  fs.symlinkSync(path.join(f.root, ".env"), path.join(f.root, "link.ts"));
  const options = { excludedPaths: ["registered"] };
  const first = collectContextSources({ absolutePath: f.root }, options);
  assert.deepEqual(first.files.map((file) => file.path), ["a.ts", "z.ts"]);
  assert.deepEqual(collectContextSources({ absolutePath: f.root }, options), first);
  assert.equal(JSON.stringify(first).includes("DO_NOT_READ"), false);
  assert.equal(JSON.stringify(first).includes("OTHER_PROJECT"), false);
  assert.ok(first.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
});

test("context source bounds report real omission and reject unsafe supplied snapshots", async (t) => {
  const { collectContextSources, normalizeContextSources } = await api();
  const f = fixture(t);
  f.write("a.ts", "one");
  assert.equal(collectContextSources({ absolutePath: f.root }, { maxFiles: 1 }).truncated, false);
  f.write("b.ts", "two");
  assert.equal(collectContextSources({ absolutePath: f.root }, { maxFiles: 1 }).truncated, true);
  assert.deepEqual(collectContextSources({ absolutePath: f.root }, { maxEntries: 1 }).files, []);
  assert.equal(collectContextSources({ absolutePath: f.root }, { maxFileBytes: 2 }).files.length, 0);
  for (const bad of ["../x.ts", "C:x.ts", "/x.ts", ".env", ".git/config", "x\u0000.ts"]) {
    assert.throws(() => normalizeContextSources([{ path: bad, text: "unsafe" }]), { code: "invalid_context_sources" });
  }
  assert.throws(() => normalizeContextSources([{ path: "a.ts", text: "a" }, { path: "a.ts", text: "b" }]), { code: "invalid_context_sources" });
});

test("a dangling nested Git marker remains a context boundary", async (t) => {
  const { collectContextSources } = await api();
  const f = fixture(t);
  f.write("nested/private.ts", "NESTED_PROJECT_SENTINEL");
  fs.symlinkSync(path.join(f.root, "missing-git-metadata"), path.join(f.root, "nested", ".git"));
  assert.equal(collectContextSources({ absolutePath: f.root }).files.length, 0);
});

test("opened files are verified before reading across an intermediate symlink swap", async (t) => {
  const { collectContextSources } = await api();
  const f = fixture(t); const outside = fixture(t);
  f.write("area/a.ts", "LOCAL"); outside.write("a.ts", "OUTSIDE_SENTINEL");
  const open = fs.openSync; const read = fs.readSync;
  const forbidden = new Set(); let outsideReads = 0;
  t.mock.method(fs, "openSync", (file, ...args) => {
    if (file !== path.join(f.root, "area/a.ts")) return open(file, ...args);
    fs.renameSync(path.join(f.root, "area"), path.join(f.root, "saved"));
    fs.symlinkSync(outside.root, path.join(f.root, "area"));
    try { const fd = open(file, ...args); forbidden.add(fd); return fd; }
    finally { fs.unlinkSync(path.join(f.root, "area")); fs.renameSync(path.join(f.root, "saved"), path.join(f.root, "area")); }
  });
  t.mock.method(fs, "readSync", (fd, ...args) => { if (forbidden.has(fd)) outsideReads++; return read(fd, ...args); });
  const result = collectContextSources({ absolutePath: f.root });
  assert.equal(outsideReads, 0);
  assert.equal(JSON.stringify(result).includes("OUTSIDE_SENTINEL"), false);
});

test("collection refuses a replaced resolved root and unavailable descriptor verification", async (t) => {
  const { collectContextSources } = await api();
  const f = fixture(t); const outside = fixture(t);
  outside.write("a.ts", "OUTSIDE_SENTINEL");
  fs.symlinkSync(outside.root, path.join(f.root, "replaced"));
  assert.throws(() => collectContextSources({ absolutePath: path.join(f.root, "replaced") }), { code: "invalid_context_sources" });
  f.write("a.ts", "LOCAL");
  t.mock.method(fs, "readlinkSync", () => { throw new Error("unsupported descriptor lookup"); });
  const result = collectContextSources({ absolutePath: f.root });
  assert.equal(result.files.length, 0);
  assert.equal(result.truncated, true);
});

test("rejected binary reads still consume the source I/O byte budget", async (t) => {
  const { collectContextSources } = await api(); const f = fixture(t);
  f.write("a.ts", "\0aa"); f.write("b.ts", "b");
  const result = collectContextSources({ absolutePath: f.root }, { maxTotalBytes: 3 });
  assert.equal(result.files.length, 0);
  assert.equal(result.truncated, true);
});

// PA-26 (absence-witness contract r3.4, D0): the collector's secret clause is moved verbatim into
// src/lib/context-path-secret-policy.js; isContextPathAllowed behaviour is byte-for-byte unchanged.
const SECRET_LITERAL_55F606C_SOURCE = String.raw`^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.pypirc|credentials?(?:\..*)?|secrets?(?:\..*)?|service[-_]account(?:\..*)?|id_rsa|id_ed25519)$`;

test("PA-26: D0 secret predicate is the 55f606c literal and isContextPathAllowed is unchanged", async () => {
  const policy = await import("../src/lib/context-path-secret-policy.js").catch(() => ({}));
  const { isContextPathAllowed } = await api();
  const { validateRelativeProjectPath } = await import("../src/lib/project-roots.js");
  const { isIgnoredProjectScanDir } = await import("../src/lib/project-scan-policy.js");
  assert.ok(policy.CONTEXT_SECRET_SEGMENT_PATTERN instanceof RegExp);
  assert.equal(policy.CONTEXT_SECRET_SEGMENT_PATTERN.source, SECRET_LITERAL_55F606C_SOURCE);
  assert.equal(policy.CONTEXT_SECRET_SEGMENT_PATTERN.flags, "i");
  assert.equal(typeof policy.isContextSecretSegment, "function");
  // Frozen copy of isContextPathAllowed exactly as at 55f606c (project-context-files.js:13–19).
  const frozen = (value) => {
    if (typeof value !== "string" || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value) || /^[A-Za-z]:/.test(value)) return false;
    const valid = validateRelativeProjectPath(value);
    if (!valid.valid || valid.relativePath !== value) return false;
    return value.split("/").every((part) => !isIgnoredProjectScanDir(part)
      && !/^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.pypirc|credentials?(?:\..*)?|secrets?(?:\..*)?|service[-_]account(?:\..*)?|id_rsa|id_ed25519)$/i.test(part));
  };
  const secret = ["credential.json", "Secrets.json", "secrets.json", "ID_RSA", ".ENV.local", "secrets. "];
  const notSecret = ["secretsfoo.js", "secretary.md", "credentialsHelper.ts", "service_accounts.json", "\u017Fecrets.json", "id_rsa."];
  for (const name of secret) assert.equal(policy.isContextSecretSegment(name), true, name);
  for (const name of notSecret) assert.equal(policy.isContextSecretSegment(name), false, name);
  // stateless (no g/y flag): repeated calls give the same answer
  for (let i = 0; i < 3; i++) assert.equal(policy.isContextSecretSegment("secrets.json"), true);
  const corpus = [...secret, ...notSecret, "src/a.js", "src/.env", "src/.env/x.js", "a/credentials/b.ts", "a/b/id_ed25519",
    "deep/nested/Secrets.json", "deep/service-account.json", "deep/service_account", ".ssh/config", "x/.aws", "x/.azure/y",
    ".npmrc", ".pypirc", "node_modules/x.js", ".git/config", "../x.js", "/abs.js", "C:x.js", "a//b.js", "./a.js", "a\u0000b",
    "", " ", "x".repeat(1025), "ok/\u017Fecrets.json", "src/id_rsa.", "src/secrets. ", null, 42, undefined];
  for (const value of corpus) assert.equal(isContextPathAllowed(value), frozen(value), JSON.stringify(value));
});
