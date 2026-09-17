import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { getCachedAnalysis, getAnalysisCacheStats, invalidateAnalysisCache } from "../src/lib/analysis-cache.js";
import { gitFixture } from "./helpers/git-fixture.js";

const analyzer = { projectType: "test", fileExtensions: [".ts"] };
function cache(t) {
  invalidateAnalysisCache();
  t.after(() => invalidateAnalysisCache());
  let builds = 0;
  return (project) => getCachedAnalysis(project, analyzer, {}, () => ({ builds: ++builds, nodes: [], edges: [] }));
}

test("analysis cache reuses only the exact clean project and revision", (t) => {
  const f = gitFixture(t);
  const read = cache(t);
  const first = read(f.project);
  assert.equal(read(f.project), first);
  f.git(["commit", "--allow-empty", "--no-gpg-sign", "-m", "new revision"]);
  assert.notEqual(read(f.project), first);
  assert.equal(read({ ...f.project, projectId: "PrJ_Other" }).builds, 3);
  assert.ok(getAnalysisCacheStats().entries.every((entry) => entry.projectId));
  assert.ok(invalidateAnalysisCache(f.project.name).removed > 0);
});

test("analysis cache separates worktrees sharing projectId and HEAD", (t) => {
  const f = gitFixture(t);
  const read = cache(t);
  const linked = { ...f.project, absolutePath: f.worktree() };
  assert.notEqual(read(linked), read(f.project));
  assert.equal(getAnalysisCacheStats().size, 2);
});

test("analysis cache bypasses successive dirty edits even with unchanged file timestamps", (t) => {
  const f = gitFixture(t);
  const read = cache(t);
  read(f.project);
  const file = path.join(f.repo, "src/source.ts");
  const stat = fs.statSync(file);
  f.write("src/source.ts", "export const dirtyOne = 1;\n");
  fs.utimesSync(file, stat.atime, stat.mtime);
  const firstDirty = read(f.project);
  assert.notEqual(read(f.project), firstDirty);
  f.write("src/source.ts", "export const dirtyTwo = 2;\n");
  fs.utimesSync(file, stat.atime, stat.mtime);
  assert.notEqual(read(f.project), firstDirty);
  assert.equal(getAnalysisCacheStats().size, 0);
  f.commit();
  const clean = read(f.project);
  assert.equal(read(f.project), clean);
});

test("analysis cache bypasses unborn and unavailable Git but preserves non-Git compatibility", (t) => {
  const f = gitFixture(t, { committed: false });
  const read = cache(t);
  assert.notEqual(read(f.project), read(f.project));
  const plain = path.join(f.root, "plain");
  fs.mkdirSync(plain);
  const project = { name: "legacy", absolutePath: plain };
  assert.equal(read(project), read(project));
  fs.writeFileSync(path.join(plain, ".git"), "invalid Git metadata\n");
  assert.notEqual(read(project), read(project));
});
