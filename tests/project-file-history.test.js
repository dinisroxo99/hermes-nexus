import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { readProjectFileHistory } from "../src/lib/project-file-history.js";
import { readProjectRevision } from "../src/lib/project-revision.js";
import { getNestedProjectPaths, getProjectByIdForIntelligence, resolveProjectWorktree } from "../src/lib/projects.js";
import { gitFixture } from "./helpers/git-fixture.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

const history = (fixture, file, extra = {}) =>
  readProjectFileHistory({ projectId: "PrJ_Context", path: file, ...extra }, fixture.options);
const items = (result) => result.evidence.map(({ commitSha, change }) => [commitSha, change]);

test("history cites committed modifications, mode changes, additions and deletions while the worktree differs", t => {
  const f = taskContextFixture(t);
  const initial = f.git(["rev-parse", "HEAD"]);
  f.write("src/one.ts", "private content never returned\n");
  const edited = f.commit("private message never returned");
  fs.chmodSync(path.join(f.repo, "src/one.ts"), 0o755);
  const mode = f.commit();
  fs.rmSync(path.join(f.repo, "src/one.ts"));
  const deletion = f.commit();
  f.write("src/one.ts", "uncommitted resurrection\n");
  const found = history(f, "src/one.ts");
  assert.equal(found.status, "available");
  assert.equal(found.findingState, "evidence_found");
  assert.equal(found.revision.commitSha, deletion);
  assert.equal(found.revision.dirty, null);
  assert.equal(found.observation.basis, "first_parent_commit_history");
  assert.deepEqual(items(found), [[deletion, "deleted"], [mode, "modified"], [edited, "modified"], [initial, "added"]]);
  assert.doesNotMatch(JSON.stringify(found), /private (content|message)|resurrection|fixture@example/);
  assert.deepEqual(found, history(f, "src/one.ts"));
  assert.equal(history(f, "unknown.ts").status, "unknown");
});

test("pathspec metacharacters and homonyms stay literal; directory queries cannot collect descendants", t => {
  const f = taskContextFixture(t);
  f.write("src/a[0]*.ts", "literal"); const literal = f.commit();
  f.write("src/a0match.ts", "other"); f.commit();
  assert.deepEqual(items(history(f, "src/a[0]*.ts")), [[literal, "added"]]);
  assert.deepEqual(history(f, "src").evidence, []);

  const other = gitFixture(t, { committed: false });
  other.write("src/a[0]*.ts", "independent\n");
  const remote = other.commit();
  f.options.registry.roots.push({ id: "second", path: other.root });
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries,
    { projectId: "PrJ_Second", name: "other", rootId: "second", relativePath: "main" }]));
  assert.deepEqual(items(history(f, "src/a[0]*.ts", { projectId: "PrJ_Second" })), [[remote, "added"]]);
  assert.deepEqual(items(history(f, "src/a[0]*.ts")), [[literal, "added"]]);
});

test("a selected subdirectory uses project-relative names and cannot read sibling names in the same Git repository", t => {
  const f = taskContextFixture(t);
  f.write("app/unit.js", "ours"); const ours = f.commit();
  f.write("unit.js", "other"); f.commit();
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
    { name: "app", rootId: "test", relativePath: "main/app", projectId: "PrJ_App" }]));
  assert.deepEqual(items(history(f, "unit.js", { projectId: "PrJ_App" })), [[ours, "added"]]);
});

test("before/after revalidation suppresses stale evidence if the commit or registry binding changed", t => {
  for (const mutation of ["commit", "registry"]) {
    const f = taskContextFixture(t);
    let calls = 0;
    f.options.readRevision = (project, options) => {
      assert.deepEqual(options, { metadataOnly: true });
      const revision = readProjectRevision(project, options);
      if (++calls === 1) {
        if (mutation === "commit") { f.write("new.ts", "changed"); f.commit(); }
        else fs.writeFileSync(f.options.registry.manualProjectsFile, "[]");
      }
      return revision;
    };
    assert.throws(() => history(f, "src/one.ts"), { code: "history_observation_changed" });
  }
});

test("a dirty linked checkout binds its own commit and never runs a configured clean filter", t => {
  const f = taskContextFixture(t);
  f.write(".gitattributes", "*.ts filter=history-probe\n"); f.commit();
  const linked = f.worktree("sibling");
  f.write("src/one.ts", "linked change"); // Dirty parent; still read only the requested sibling's commit.
  f.write("src/one.ts", "committed in sibling", linked);
  const committed = f.commit("linked commit", linked);
  f.write("src/one.ts", "dirty sibling", linked);

  const marker = path.join(f.root, "filter-ran");
  const filter = path.join(f.root, "filter.sh");
  fs.writeFileSync(filter, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o700 });
  f.git(["config", "filter.history-probe.clean", filter]);
  f.git(["hash-object", "--path=src/one.ts", "src/one.ts"], linked);
  assert.equal(fs.existsSync(marker), true, "control verifies the configured helper can run");
  fs.rmSync(marker);

  const result = history(f, "src/one.ts", { worktree: { rootId: "test", relativePath: "sibling" } });
  assert.equal(result.revision.commitSha, committed);
  assert.equal(result.revision.isLinkedWorktree, true);
  assert.equal(result.revision.dirty, null);
  assert.equal(result.evidence[0].commitSha, committed);
  assert.equal(fs.existsSync(marker), false);
  assert.notEqual(history(f, "src/one.ts").revision.worktreeId, result.revision.worktreeId);
  const other = gitFixture(t);
  f.options.registry.roots.push({ id: "unrelated", path: other.root });
  assert.throws(() => history(f, "src/one.ts", { worktree: { rootId: "unrelated", relativePath: "main" } }),
    { code: "worktree_parent_mismatch" });
});

test("invalid and protected paths, unregistered nested repositories and symlinked ancestors never enter history", t => {
  const f = taskContextFixture(t);
  for (const p of ["../private.ts", "/etc/passwd", ".git/config", ".env.prod", "node_modules/one/file.ts", "a\nfile", "a//b"]) {
    assert.throws(() => history(f, p), { code: "invalid_history_path" });
  }
  assert.throws(() => history(f, "src/one.ts", { worktree: { rootId: "test", relativePath: "../" } }), { code: "invalid_history_worktree" });
  assert.throws(() => history(f, "src/one.ts", { projectId: "missing" }), { code: "project_not_found" });
  fs.symlinkSync(f.root, path.join(f.repo, "link"), "dir");
  assert.throws(() => history(f, "link/another.ts"), { code: "history_boundary_excluded" });
  fs.mkdirSync(path.join(f.repo, "nested"));
  f.git(["init", "nested"]);
  assert.throws(() => history(f, "nested/private.ts"), { code: "history_boundary_excluded" });
});

test("deleted or dangling canonical children under an overlapping root stay excluded on a divergent linked checkout", t => {
  const f = taskContextFixture(t);
  f.write("children/private/one.ts", "formerly nested");
  f.commit();
  const linked = f.worktree("sibling");
  fs.rmSync(path.join(f.repo, "children/private"), { recursive: true });
  const aliasRoot = path.join(f.root, "alias");
  fs.symlinkSync(path.join(f.repo, "children"), aliasRoot, "dir");
  f.options.registry.roots.push({ id: "nestedRoot", path: aliasRoot });
  const unrelated = gitFixture(t);
  fs.mkdirSync(path.join(unrelated.repo, "private"));
  f.options.registry.roots.push({ id: "other", path: unrelated.repo });
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries,
    { name: "child", rootId: "nestedRoot", relativePath: "private", projectId: "PrJ_Child" },
    { name: "unrelated", rootId: "other", relativePath: "private", projectId: "PrJ_Other" }]));
  const locator = { rootId: "test", relativePath: "sibling" };
  const project = resolveProjectWorktree("PrJ_Context", locator, f.options.registry, { metadataOnly: true });
  for (const state of ["missing", "dangling"]) {
    if (state === "dangling") fs.symlinkSync(path.join(f.root, "missing"), path.join(f.repo, "children/private"), "dir");
    assert.deepEqual(getNestedProjectPaths(project, f.options.registry), ["children/private"]);
    assert.throws(() => history(f, "children/private/one.ts", { worktree: locator }), { code: "history_boundary_excluded" });
    assert.throws(() => history(f, "children/private/one.ts"), { code: "history_boundary_excluded" });
    assert.equal(fs.existsSync(path.join(linked, "children/private/one.ts")), true);
  }
});

test("rename has separate old and new path histories; only first-parent changes are reported at merges", t => {
  const f = taskContextFixture(t);
  f.git(["switch", "-c", "feature"]);
  f.git(["mv", "src/one.ts", "src/renamed.ts"]); f.commit();
  f.git(["switch", "main"]);
  f.git(["merge", "--no-gpg-sign", "--no-ff", "feature", "-m", "merge"]);
  const merge = f.git(["rev-parse", "HEAD"]);
  assert.deepEqual(items(history(f, "src/renamed.ts")), [[merge, "added"]]);
  assert.equal(items(history(f, "src/one.ts"))[0][1], "deleted");
});

test("entry and traversal limits return partial observations and deterministic ordering", t => {
  const f = taskContextFixture(t);
  const recent = [];
  for (let i = 0; i < 65; i++) {
    f.write("series.ts", String(i)); recent.unshift(f.commit());
  }
  const entries = history(f, "series.ts");
  assert.equal(entries.status, "partial");
  assert.equal(entries.evidence.length, 16);
  assert.deepEqual(entries.evidence.map(item => item.commitSha), recent.slice(0, 16));
  assert.ok(entries.observation.reasons.includes("history_entry_limit"));
  assert.ok(entries.observation.reasons.includes("history_commit_limit"));
  const old = history(f, "src/one.ts");
  assert.equal(old.status, "partial");
  assert.equal(old.findingState, "no_evidence_found");
  assert.equal(old.observation.commitsExamined, 64);
  assert.deepEqual(old.evidence, []);
});

test("a shallow boundary never fabricates an addition at the oldest visible commit", t => {
  const f = taskContextFixture(t);
  f.write("src/one.ts", "second state"); f.commit();
  const dest = path.join(f.root, "shallow");
  f.git(["clone", "--depth=1", pathToFileURL(f.repo).href, dest], f.root);
  f.write("src/one.ts", "third state", dest); const change = f.commit("third", dest);
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([
    { rootId: "test", projectId: "PrJ_Shallow", name: "shallow", relativePath: "shallow" }]));
  const result = history(f, "src/one.ts", { projectId: "PrJ_Shallow" });
  assert.equal(result.status, "partial");
  assert.ok(result.observation.reasons.includes("shallow_repository"));
  assert.deepEqual(items(result), [[change, "modified"]]);
});
