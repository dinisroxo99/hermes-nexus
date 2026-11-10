import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { CREATE_ABSENCE_WITNESS_FS_ALLOWLIST } from "../src/lib/create-destination-absence-witness-constants.js";
import { observeProjectOperation } from "../src/lib/project-operation-observation.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

const cli = fileURLToPath(new URL("../scripts/observe-project-operation.mjs", import.meta.url));
const operation = (oldPath, newPath, kind = "move_directory") => ({ kind, oldPath, newPath });
const input = (f, op, pins = {}) => ({ projectId: f.request.projectId, task: { id: "dir-1", title: "Move subtree" },
  worktree: { rootId: "test", relativePath: "linked" }, operation: op, ...pins });
const run = (f, op, pins) => observeProjectOperation(input(f, op, pins), f.options.registry);
const supported = (f) => process.platform === "linux" && process.versions.unicode === "17.0"
  && CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes("0x" + (Number(fs.statfsSync(f.repo).type) >>> 0).toString(16));

function fixture(t) {
  const f = taskContextFixture(t);
  f.write("src/nested/z.ts", "export class Nested {}\n");
  f.write(".gitignore", "tests/extra.bin\nsrc/ignored.bin\n");
  f.commit("add subtree fixture");
  return { ...f, linked: f.worktree("linked") };
}

test("real operator CLI maps the sealed subtree without touching its absent destination", (t) => {
  const f = fixture(t);
  const ops = [operation("src", "tests/module"), operation("src", "renamed", "rename_directory")];
  if (!supported(f)) {
    assert.throws(() => run(f, ops[0]), (e) => ["operation_descriptor_unavailable", "operation_tree_unobservable",
      "operation_filesystem_unsupported", "operation_unicode_unsupported"].includes(e.code));
    return;
  }
  const env = { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify(f.options.registry.roots) };
  const sha = f.git(["rev-parse", "HEAD"], f.linked);
  for (const op of ops) {
    const out = JSON.parse(execFileSync(process.execPath, [cli], {
      env, cwd: f.root, encoding: "utf8", input: JSON.stringify(input(f, op, { expectedCommitSha: sha }))
    }));
    assert.deepEqual(out, run(f, op, { expectedCommitSha: sha, expectedEvidenceDigest: out.evidenceDigest }));
    assert.equal(out.complete, true);
    assert.match(out.destination.witnessDigest, /^[0-9a-f]{64}$/);
    assert.equal(out.destination.verdict, "absent");
    assert.deepEqual(out.mapping.directories, [
      { oldPath: "src", newPath: op.newPath }, { oldPath: "src/nested", newPath: op.newPath + "/nested" }
    ]);
    assert.deepEqual(out.mapping.files.map((r) => r.oldPath), ["src/nested/z.ts", "src/one.ts", "src/unrelated.ts"]);
    for (const member of out.mapping.files) {
      const bytes = fs.readFileSync(path.join(f.linked, member.oldPath));
      assert.equal(member.newPath, op.newPath + member.oldPath.slice(op.oldPath.length));
      assert.equal(member.bytes, bytes.length);
      assert.equal(member.contentSha256, createHash("sha256").update(bytes).digest("hex"));
      assert.equal(out.files.find((row) => row.path === member.oldPath).gitBlob,
        f.git(["rev-parse", "HEAD:" + member.oldPath], f.linked));
    }
    assert.equal(fs.existsSync(path.join(f.linked, op.newPath)), false);
    assert.throws(() => run(f, op, { expectedEvidenceDigest: "f".repeat(64) }), { code: "operation_evidence_changed" });
  }
  assert.equal(f.git(["status", "--porcelain"], f.linked), "");
});

test("directory roots may not overlap in either direction, including portable case and Unicode aliases", (t) => {
  const f = fixture(t);
  for (const [a, b] of [["src", "src/nested/new"], ["src/nested", "SRC"], ["É", "e\u0301/next"]]) {
    assert.throws(() => run(f, operation(a, b)), { code: "operation_directory_overlap" });
  }
  assert.throws(() => run(f, operation("src", "SrC")), { code: "operation_name_collision" });
});

test("absent registered descendants of source and destination remain boundaries even outside the mapping", (t) => {
  const f = fixture(t);
  if (!supported(f)) return t.skip("requires admitted filesystem and Unicode runtime");
  for (const child of ["main/SRC/not-in-this-tree", "main/tests/MODULE/private/unrelated"]) {
    fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries,
      { name: "reserved", rootId: "test", relativePath: child, projectId: "PrJ_Reserved" }]));
    assert.throws(() => run(f, operation("src", "tests/module")), { code: "operation_directory_boundary" });
  }
  assert.equal(fs.existsSync(path.join(f.linked, "tests/module")), false);
});

test("existing directories, symlinks, opaque or ignored members and stale revisions cannot yield a partial mapping", (t) => {
  const f = fixture(t);
  if (!supported(f)) return t.skip("requires admitted filesystem and Unicode runtime");
  assert.throws(() => run(f, operation("src", "tests")), { code: "operation_destination_not_proven_absent" });
  assert.throws(() => run(f, operation("src", "tests/module"), { expectedCommitSha: "f".repeat(40) }),
    { code: "operation_stale" });
  fs.symlinkSync("missing-target", path.join(f.linked, "tests/dangling"));
  f.commit("occupied destination", f.linked);
  assert.throws(() => run(f, operation("src", "tests/dangling")), { code: "operation_destination_not_proven_absent" });
  f.write("src/ignored.bin", "ignored data", f.linked);
  assert.throws(() => run(f, operation("src", "tests/module")), { code: "operation_source_not_bound" });
  fs.unlinkSync(path.join(f.linked, "src/ignored.bin"));
  fs.mkdirSync(path.join(f.linked, "src/empty"));
  assert.throws(() => run(f, operation("src", "tests/module")), { code: "operation_empty_directory" });
  fs.rmdirSync(path.join(f.linked, "src/empty"));
  fs.symlinkSync("../../PROJECT.md", path.join(f.linked, "src/nested/link.ts"));
  f.commit("symlink in source", f.linked);
  assert.throws(() => run(f, operation("src", "tests/module")), { code: "operation_git_tree_unsupported" });
});

for (const mutation of ["parent listing changed", "destination appeared"]) {
  test(`directory transfer refuses when ${mutation} between its two independent checks`, (t) => {
    const f = fixture(t);
    if (!supported(f)) return t.skip("requires admitted filesystem and Unicode runtime");
    const destination = path.join(f.linked, "tests/module");
    const original = fs.statfsSync;
    let passes = 0;
    t.mock.method(fs, "statfsSync", function (name, ...args) {
      const result = original.call(this, name, ...args);
      if (typeof name === "string" && name.startsWith("/proc/self/fd/")
          && fs.readlinkSync(name) === path.join(f.linked, "src/one.ts") && ++passes === 2) {
        if (mutation === "parent listing changed") fs.writeFileSync(path.join(f.linked, "tests/extra.bin"), "ignored");
        else fs.mkdirSync(destination);
      }
      return result;
    });
    const code = mutation === "parent listing changed"
      ? "operation_destination_changed" : "operation_destination_not_proven_absent";
    assert.throws(() => run(f, operation("src", "tests/module")), { code });
    assert.equal(fs.existsSync(destination), mutation === "destination appeared");
    assert.equal(f.git(["status", "--porcelain"], f.linked), "");
  });
}

test("mapped member paths must remain portable and within input path bounds", (t) => {
  const f = fixture(t);
  if (!supported(f)) return t.skip("requires admitted filesystem and Unicode runtime");
  const parent = Array(5).fill("p".repeat(198)).join("/");
  f.write(parent + "/seed.ts", "export {}", f.linked);
  f.write("src/" + "s".repeat(45) + ".ts", "export {}", f.linked);
  f.commit("long mapped path", f.linked);
  assert.throws(() => run(f, operation("src", parent + "/new")), { code: "operation_mapped_path_unsupported" });
  // The basename folds to a secret name under the witness name policy, even though its spelling differs.
  assert.throws(() => run(f, operation("src", "tests/.e\u200bnv")), { code: "operation_mapped_path_unsupported" });
});
