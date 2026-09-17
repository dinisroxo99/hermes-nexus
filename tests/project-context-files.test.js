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
