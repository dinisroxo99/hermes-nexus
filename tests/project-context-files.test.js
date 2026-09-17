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
