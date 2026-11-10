import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { CREATE_ABSENCE_WITNESS_FS_ALLOWLIST } from "../src/lib/create-destination-absence-witness-constants.js";
import { observeProjectOperation } from "../src/lib/project-operation-observation.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

const cli = fileURLToPath(new URL("../scripts/observe-project-operation.mjs", import.meta.url));
const expand = (directory = "src") => ({ kind: "expand_directory", path: directory });
const move = (oldPath = "src/one.ts", newPath = "tests/moved.ts") => ({ kind: "move", oldPath, newPath });
const rename = () => ({ kind: "rename", oldPath: "src/one.ts", newPath: "src/new.ts" });
const request = (f, operation, extras = {}) => ({ projectId: f.request.projectId,
  worktree: { rootId: "test", relativePath: "linked" },
  task: { id: "ops-1", title: "Observe proposed work" }, operation, ...extras });
const run = (f, op, extra) => observeProjectOperation(request(f, op, extra), f.options.registry);
const hostOK = (dir) => process.platform === "linux" && process.versions.unicode === "17.0"
  && CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes("0x" + (Number(fs.statfsSync(dir).type) >>> 0).toString(16));
const positiveTest = (t, f) => {
  if (hostOK(f.repo)) return true;
  t.skip("positive observation requires descriptor checks, Unicode 17 and an admitted filesystem");
  return false;
};

test("operator CLI seals the live directory against its exact Git tree and the provider snapshot", (t) => {
  const f = taskContextFixture(t);
  f.write("src/sub/z.ts", "export const hello = 42;\n");
  f.commit("add nested file");
  const linked = f.worktree("linked");
  if (!hostOK(linked)) {
    assert.throws(() => run(f, expand()), (e) => ["operation_unicode_unsupported", "operation_filesystem_unsupported",
      "operation_descriptor_unavailable", "operation_tree_unobservable"].includes(e.code));
    return;
  }
  const payload = request(f, expand());
  const env = { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify(f.options.registry.roots) };
  const cliOutput = execFileSync(process.execPath, [cli], {
    cwd: f.root, env, input: JSON.stringify(payload), encoding: "utf8"
  });
  const report = JSON.parse(cliOutput);
  assert.deepEqual(report, run(f, expand(), { expectedEvidenceDigest: report.evidenceDigest }));
  assert.throws(() => run(f, expand(), { expectedEvidenceDigest: "f".repeat(64) }), { code: "operation_evidence_changed" });
  assert.equal(report.complete, true);
  assert.deepEqual(report.directories, ["src", "src/sub"]);
  assert.deepEqual(report.files.map((x) => x.path), ["src/one.ts", "src/sub/z.ts", "src/unrelated.ts"]);
  const { evidenceDigest, ...body } = report;
  assert.equal(evidenceDigest, createHash("sha256").update(JSON.stringify(body)).digest("hex"));
  for (const file of report.files) {
    assert.equal(file.gitBlob, f.git(["rev-parse", "HEAD:" + file.path], linked));
    assert.equal(file.sha256, createHash("sha256").update(fs.readFileSync(path.join(linked, file.path))).digest("hex"));
  }
  assert.equal(f.git(["status", "--porcelain"], linked), "");
});

test("file move and rename bind the existing regular blob and positively absent destination on one snapshot", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  const linked = f.worktree("linked");
  const sha = f.git(["rev-parse", "HEAD"], linked);
  const directory = run(f, expand());
  for (const op of [move(), rename()]) {
    const report = run(f, op, { expectedCommitSha: sha });
    assert.deepEqual(report.operation, op);
    assert.deepEqual(report.files, directory.files.filter((f) => f.path === op.oldPath));
    assert.deepEqual(report.destination, { path: op.newPath, verdict: "absent", complete: true });
    assert.equal(report.snapshotToken, directory.snapshotToken);
    assert.equal(report.revision.commitSha, sha);
    assert.equal(fs.existsSync(path.join(linked, op.newPath)), false);
  }
  assert.equal(f.git(["status", "--porcelain"], linked), "");
});

test("same path, case and Unicode-equivalent renames, traversal and unsafe request fields are refused", (t) => {
  const f = taskContextFixture(t);
  for (const [oldPath, newPath] of [
    ["src/One.ts", "src/One.ts"], ["src/One.ts", "SRC/oNe.ts"], ["src/é.ts", "src/e\u0301.ts"]
  ]) assert.throws(() => run(f, move(oldPath, newPath)), { code: "operation_name_collision" });
  assert.throws(() => run(f, move("src/one.ts", "../other.ts")));
  assert.throws(() => run(f, { ...rename(), witness: {} }), { code: "invalid_project_operation_request" });
  assert.throws(() => run(f, expand(), { registry: {} }), { code: "invalid_project_operation_request" });
});

test("stale, dirty, existing destinations and nested registered boundaries cannot produce a manifest", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  const linked = f.worktree("linked");
  assert.throws(() => run(f, expand(), { expectedCommitSha: "f".repeat(40) }), { code: "operation_stale" });
  assert.throws(() => run(f, move("src/one.ts", "src/unrelated.ts")), { code: "operation_destination_not_proven_absent" });
  assert.throws(() => run(f, move("src/nothing.ts", "src/new.ts")), { code: "operation_source_untracked" });
  const child = { name: "child", rootId: "test", relativePath: "main/src/removed", projectId: "PrJ_Child" };
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries, child]));
  assert.throws(() => run(f, expand()), { code: "operation_directory_boundary" });
  assert.throws(() => run(f, move("src/one.ts", "SRC/REMOVED")), { code: "operation_nested_project_target" });
  f.write("pending.ts", "untracked", linked);
  assert.throws(() => run(f, move()), { code: "operation_clean_linked_worktree_required" });
});

test("expansion rejects an untracked ignored member and an empty untracked directory", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  f.write(".gitignore", "src/ignored.ts\n");
  f.commit("ignore file");
  const linked = f.worktree("linked");
  f.write("src/ignored.ts", "export {}", linked);
  assert.equal(f.git(["status", "--porcelain"], linked), "");
  assert.throws(() => run(f, expand()), { code: "operation_source_not_bound" });
  fs.unlinkSync(path.join(linked, "src/ignored.ts"));
  fs.mkdirSync(path.join(linked, "src/empty"));
  assert.throws(() => run(f, expand()), { code: "operation_empty_directory" });
});

test("a symlink, unsupported source, or child project inside a requested directory prevents expansion", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  const linked = f.worktree("linked");
  fs.symlinkSync("../PROJECT.md", path.join(linked, "src/link.ts"));
  f.commit("link", linked);
  assert.throws(() => run(f, expand()), { code: "operation_git_tree_unsupported" });
  assert.throws(() => run(f, move("src/link.ts", "src/new.ts")), { code: "operation_git_tree_unsupported" });
  assert.throws(() => run(f, move("src/one.ts", "src/link.ts")), { code: "operation_destination_not_proven_absent" });
  fs.unlinkSync(path.join(linked, "src/link.ts"));
  f.write("src/media.png", "opaque", linked);
  f.commit("unrepresented extension", linked);
  assert.throws(() => run(f, expand()), { code: "operation_source_not_bound" });
});

test("directory expansion refuses oversize and case-colliding manifests as a whole", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  const linked = f.worktree("linked");
  f.write("src/ONE.ts", "export class Shadow {}", linked);
  f.commit("case collision", linked);
  assert.throws(() => run(f, expand()), { code: "operation_name_collision" });
  assert.throws(() => run(f, rename()), { code: "operation_name_collision" });
  for (let n = 0; n < 33; n++) f.write(`many/f${n}.ts`, "export {}", linked);
  f.commit("many files", linked);
  assert.throws(() => run(f, expand("many")), { code: "operation_tree_limit" });
});

test("Git preflight refuses a configured clean helper before any revision or status can run it", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  f.write(".gitattributes", "src/one.ts filter=operation_test\n");
  f.commit("declare attribute");
  const linked = f.worktree("linked");
  f.git(["config", "filter.operation_test.clean", "touch operation-helper-ran && cat"]);
  f.write("src/one.ts", "export class Changed {}\n", linked);
  assert.throws(() => run(f, expand()), { code: "operation_git_preflight_unsupported" });
  for (const dir of [f.repo, linked]) assert.equal(fs.existsSync(path.join(dir, "operation-helper-ran")), false);
});

test("an ignored unsupported member appearing after the first listing prevents a sealed expansion", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  f.write(".gitignore", "src/late.bin\n");
  f.commit("ignore late member");
  const linked = f.worktree("linked");
  const late = path.join(linked, "src/late.bin");
  const original = fs.statfsSync;
  let inserted = false;
  t.mock.method(fs, "statfsSync", function (name, ...args) {
    const value = original.call(this, name, ...args);
    if (!inserted && typeof name === "string" && name.startsWith("/proc/self/fd/")
        && fs.readlinkSync(name) === path.join(linked, "src/one.ts")) {
      inserted = true;
      fs.writeFileSync(late, "new untracked data");
    }
    return value;
  });
  assert.throws(() => run(f, expand()), { code: "operation_source_not_bound" });
  assert.equal(inserted, true);
  assert.equal(f.git(["status", "--porcelain"], linked), "");
});


test("a destination directory with a portable sibling alias refuses the move", (t) => {
  const f = taskContextFixture(t);
  if (!positiveTest(t, f)) return;
  const linked = f.worktree("linked");
  f.write("dest/first.ts", "export class First {}", linked);
  f.write("DEST/second.ts", "export class Second {}", linked);
  f.commit("ambiguous destination directories", linked);
  assert.throws(() => run(f, move("src/one.ts", "DEST/new.ts")), { code: "operation_name_collision" });
  assert.equal(fs.existsSync(path.join(linked, "DEST/new.ts")), false);
});
