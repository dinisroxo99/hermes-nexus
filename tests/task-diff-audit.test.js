import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { taskContextFixture } from "./helpers/task-context-fixture.js";
import { auditTaskDiff, captureDiffBaseline } from "../src/lib/task-diff-audit.js";

const script = fileURLToPath(new URL("../scripts/audit-task-diff.mjs", import.meta.url));
const digest = (text) => createHash("sha256").update(text).digest("hex");

function project(t) {
  const f = taskContextFixture(t);
  const linked = f.worktree();
  const options = { dataDir: f.root, roots: f.options.registry.roots };
  const location = (relativePath) => ({ projectId: f.request.projectId, worktree: { rootId: "test", relativePath } });
  const capture = (task = f.request.task, locator = "linked") => {
    const receipt = captureDiffBaseline(location(locator), task, options);
    return { receipt, pin: digest(receipt) };
  };
  const compare = ({ receipt, pin }, taskId = "task-1", locator = "linked") =>
    auditTaskDiff(location(locator), taskId, Buffer.from(receipt), pin, options);
  return { ...f, linked, capture, compare };
}

test("CLI capture + compare reports staged, unstaged, untracked, deleted and renamed paths", (t) => {
  const f = project(t);
  const env = { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify(f.options.registry.roots) };
  const cli = (mode, input, ...args) => {
    const result = spawnSync(process.execPath, [script, mode, "PrJ_Context", "test", "linked", ...args], {
      input, env, cwd: f.root, encoding: "utf8", timeout: 90000
    });
    assert.ifError(result.error);
    return result;
  };
  const capture = cli("capture", JSON.stringify(f.request.task));
  assert.equal(capture.status, 0, capture.stderr);
  assert.equal(capture.stderr.trim(), digest(capture.stdout));
  const baseline = { receipt: capture.stdout, pin: capture.stderr.trim() };
  assert.deepEqual(f.compare(baseline).changes, []);
  f.write("src/one.ts", "export class Edited {}\n", f.linked);
  assert.deepEqual(f.compare(baseline).changes, [{ path: "src/one.ts", classification: "in_write" }]);
  f.git(["mv", "src/unrelated.ts", "src/renamed.ts"], f.linked);
  f.write("new file.ts", "new file\n", f.linked);
  fs.unlinkSync(path.join(f.linked, "tests/one.test.ts"));
  f.write("staged.ts", "staged\n", f.linked);
  f.git(["add", "staged.ts"], f.linked);
  const result = cli("compare", baseline.receipt, "task-1", baseline.pin);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.finding, "outside_write_observed");
  assert.deepEqual(report.changes.map((change) => [change.path, change.classification]), [
    ["new file.ts", "outside_write"], ["src/one.ts", "in_write"], ["src/renamed.ts", "outside_write"],
    ["src/unrelated.ts", "outside_write"], ["staged.ts", "outside_write"], ["tests/one.test.ts", "outside_write"]
  ]);
  assert.throws(() => f.capture(), { code: "diff_base_not_clean" });
});

test("capture refuses unbound tasks or a main checkout; compare rejects a stale HEAD, task or sibling checkout", (t) => {
  const f = project(t);
  assert.throws(() => f.capture(f.request.task, "main"), { code: "worktree_parent_mismatch" });
  assert.throws(() => f.capture({ ...f.request.task, paths: ["missing.ts"] }));
  const b = f.capture();
  assert.throws(() => f.compare(b, "other-task"), { code: "diff_baseline_binding_mismatch" });
  f.worktree("sibling");
  assert.throws(() => f.compare(b, "task-1", "sibling"), { code: "diff_baseline_binding_mismatch" });
  f.write("src/one.ts", "export class Changed {}\n", f.linked);
  f.commit("advance HEAD", f.linked);
  assert.throws(() => f.compare(b), { code: "diff_baseline_binding_mismatch" });
});

test("altered inputs and extra approval fields do not become audit evidence", (t) => {
  const f = project(t);
  const b = f.capture();
  const forged = JSON.stringify({ ...JSON.parse(b.receipt), approved: true });
  assert.throws(() => f.compare({ receipt: forged, pin: b.pin }), { code: "diff_baseline_pin_mismatch" });
  assert.throws(() => f.compare({ receipt: forged, pin: digest(forged) }), { code: "diff_invalid_baseline" });
  const broadened = JSON.stringify({ ...JSON.parse(b.receipt), writePaths: ["src/one.ts", "src/unrelated.ts"] });
  assert.throws(() => f.compare({ receipt: broadened, pin: digest(broadened) }), { code: "diff_invalid_baseline" });
});

test("excessive diff cardinality yields no partial success report", (t) => {
  const f = project(t);
  const b = f.capture();
  for (let i = 0; i < 257; i++) f.write(`new-${i}.txt`, "", f.linked);
  assert.throws(() => f.compare(b), { code: "diff_path_limit" });
});

test("hidden index entries make the audit unavailable", (t) => {
  const f = project(t);
  const b = f.capture();
  for (const flag of ["assume-unchanged", "skip-worktree"]) {
    f.git(["update-index", "--" + flag, "src/unrelated.ts"], f.linked);
    assert.throws(() => f.compare(b), { code: "diff_index_coverage_unavailable" });
    f.git(["update-index", "--no-" + flag, "src/unrelated.ts"], f.linked);
  }
});


test("capture declines an ignored source that has no committed blob", (t) => {
  const f = project(t);
  fs.appendFileSync(path.join(f.repo, ".git/info/exclude"), "\nsrc/untracked.ts\n");
  f.write("src/untracked.ts", "export class Untracked {}\n", f.linked);
  assert.equal(f.git(["status", "--porcelain"], f.linked), "");
  assert.throws(() => f.capture({ ...f.request.task, paths: ["src/untracked.ts"] }));
});

test("registered child changes never emit a child filename, including a missing canonical child", (t) => {
  const f = project(t);
  const b = f.capture();
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
    ...f.entries, { name: "private child", rootId: "test", relativePath: "main/private-child", projectId: "PrJ_Private" }
  ]));
  assert.throws(() => f.capture({ ...f.request.task, paths: ["private-child/customer-names.txt"] }),
    { code: "diff_nested_project_target", message: "diff_nested_project_target" });
  f.write("private-child/customer-names.txt", "private", f.linked);
  f.write("outside.txt", "visible", f.linked);
  for (const missing of [true, false]) {
    if (!missing) fs.mkdirSync(path.join(f.repo, "private-child"));
    assert.throws(() => f.compare(b), { code: "diff_nested_project_change", message: "diff_nested_project_change" });
  }
});

test("a registered child rename endpoint is never exposed", (t) => {
  const f = project(t);
  const b = f.capture();
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
    ...f.entries, { name: "child", rootId: "test", relativePath: "linked/private", projectId: "PrJ_Private" }
  ]));
  fs.mkdirSync(path.join(f.linked, "private"));
  f.git(["mv", "src/unrelated.ts", "private/customer-names.ts"], f.linked);
  assert.throws(() => f.compare(b), { code: "diff_nested_project_change", message: "diff_nested_project_change" });
});

test("a repository clean or process filter is refused before any status helper can execute it", (t) => {
  const f = project(t);
  const b = f.capture();
  const marker = path.join(f.root, "filter-ran");
  fs.appendFileSync(path.join(f.repo, ".git/info/attributes"), "*.ts filter=auditprobe\n");
  f.write("src/one.ts", "export class Dirty {}\n", f.linked);
  const command = `touch "${marker}" && cat`;
  f.git(["config", "filter.auditprobe.clean", command]);
  // Establish the real attack path with ordinary Git. The audit itself must never run this helper.
  f.git(["status", "--porcelain"], f.linked);
  assert.equal(fs.existsSync(marker), true);
  fs.unlinkSync(marker);
  for (const attr of ["clean", "process"]) {
    f.git(["config", "filter.auditprobe." + attr, command]);
    assert.throws(() => f.compare(b), { code: "diff_git_helpers_unsupported", message: "diff_git_helpers_unsupported" });
    assert.equal(fs.existsSync(marker), false);
    f.git(["config", "--unset", "filter.auditprobe." + attr]);
  }
});

test("installed filters that no indexed or working attributes select do not disable the audit", (t) => {
  const f = project(t);
  const marker = path.join(f.root, "unused-lfs-ran");
  const command = `touch "${marker}" && exit 1`;
  f.git(["config", "filter.lfs.clean", command]);
  f.git(["config", "filter.lfs.process", command]);
  fs.writeFileSync(path.join(f.repo, ".git/info/attributes"), "*.psd filter=lfs\n");
  const b = f.capture();
  f.write("src/one.ts", "export class Edited {}\n", f.linked);
  assert.equal(f.compare(b).finding, "no_outside_write_observed");
  assert.equal(fs.existsSync(marker), false);
});

test("an active filter in the staged attributes is rejected even with different working attributes", (t) => {
  const f = project(t);
  const b = f.capture();
  const marker = path.join(f.root, "staged-filter-ran");
  const attributes = path.join(f.linked, ".gitattributes");
  fs.writeFileSync(attributes, "src/one.ts filter=probe\n");
  f.git(["add", ".gitattributes"], f.linked);
  fs.writeFileSync(attributes, "");
  f.git(["config", "filter.probe.clean", `touch "${marker}" && cat`]);
  assert.throws(() => f.compare(b), { code: "diff_git_helpers_unsupported" });
  assert.equal(fs.existsSync(marker), false);
});


test("control and formatting characters in changed paths return only an unavailable marker", (t) => {
  const f = project(t);
  const b = f.capture();
  for (const prefix of ["line\n", "direction\u202e"]) {
    const name = prefix + "customer.ts";
    f.write(name, "", f.linked);
    assert.throws(() => f.compare(b), { code: "diff_path_unsupported", message: "diff_path_unsupported" });
    fs.unlinkSync(path.join(f.linked, name));
  }
});


test("gitlinks in either the index or HEAD stop the audit before status scans a submodule", (t) => {
  const f = project(t);
  const b = f.capture();
  const sha = f.git(["rev-parse", "HEAD"], f.linked);
  f.git(["update-index", "--add", "--cacheinfo", "160000", sha, "private-module"], f.linked);
  assert.throws(() => f.compare(b), { code: "diff_submodule_unsupported" });
  f.git(["commit", "-m", "add gitlink"], f.linked);
  f.git(["update-index", "--force-remove", "private-module"], f.linked);
  assert.throws(() => f.compare(b), { code: "diff_submodule_unsupported" });
});
