import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { taskContextFixture } from "./helpers/task-context-fixture.js";
import { collectContextSources } from "../src/lib/project-context-files.js";

async function builder() {
  const module = await import("../src/lib/task-context.js").catch(() => ({}));
  assert.equal(typeof module.buildProjectTaskContext, "function");
  return module.buildProjectTaskContext;
}

test("task pack composes identified revision, matched ICM and bounded evidence deterministically", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  const before = fs.readFileSync(f.options.registry.manualProjectsFile, "utf8");
  const pack = build(f.request, f.options);
  assert.equal(pack.projectId, "PrJ_Context");
  assert.equal(pack.schemaVersion, 1);
  assert.equal(pack.analysisVersion, "task-context-v1");
  assert.equal(pack.revision.commitSha, f.git(["rev-parse", "HEAD"]));
  assert.equal(pack.revision.dirty, false);
  assert.ok(pack.sections.workspaces.items.length);
  assert.ok(pack.sections.constraints.items.length);
  assert.ok(pack.sections.symbols.items.some((symbol) => symbol.name === "One"));
  assert.ok(pack.sections.tests.items.some((file) => file.path === "tests/one.test.ts"));
  assert.equal(JSON.stringify(build(f.request, f.options)), JSON.stringify(pack));
  const serialized = JSON.stringify(pack);
  for (const forbidden of [f.root, "Unrelated", "do-not-select", "DO_NOT_PROMOTE_INSTRUCTIONS"]) assert.equal(serialized.includes(forbidden), false);
  assert.equal(fs.readFileSync(f.options.registry.manualProjectsFile, "utf8"), before);
  assert.equal(fs.existsSync(f.options.registry.discoveredProjectsFile), false);
  assert.ok(Buffer.byteLength(serialized) <= pack.limits.maxBytes);
  for (const section of Object.values(pack.sections)) assert.ok(section.provenance.trust);
});

test("pack source boundaries exclude nested registered projects and secret files", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  f.write("nested/other.ts", "export class OTHER_PROJECT_SENTINEL {}\n");
  f.write(".env", "SECRET_SENTINEL\n");
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries, { name: "child", relativePath: "main/nested", rootId: "test", projectId: "PrJ_Child" }]));
  const pack = build({ ...f.request, task: { title: "Inspect nested", paths: ["nested"] }, includeExcerpts: true }, f.options);
  assert.equal(pack.revision.dirty, true);
  assert.equal(pack.observation.cacheReuse, "disabled");
  assert.equal(pack.sections.files.items.length, 0);
  assert.equal(JSON.stringify(pack).includes("OTHER_PROJECT_SENTINEL"), false);
  assert.equal(JSON.stringify(pack).includes("SECRET_SENTINEL"), false);
});

test("packs bind linked worktrees to the parent ID and use their own current sources", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  const linked = f.worktree();
  f.write("src/one.ts", "export class ChildOne {}\n", linked);
  const parent = build(f.request, f.options);
  const child = build({ ...f.request, worktree: { rootId: "test", relativePath: "linked" } }, f.options);
  assert.equal(child.projectId, parent.projectId);
  assert.notEqual(child.revision.worktreeId, parent.revision.worktreeId);
  assert.equal(child.revision.dirty, true);
  assert.ok(child.sections.symbols.items.some((symbol) => symbol.name === "ChildOne"));
});

test("pack rejects changing dirty sources rather than presenting a mixed observation as current", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  f.write("src/one.ts", "export class DirtyOne {}\n");
  let calls = 0;
  assert.throws(() => build(f.request, { ...f.options, collectSources: (project, options) => {
    const result = collectContextSources(project, options);
    if (++calls === 1) f.write("src/one.ts", "export class ChangedAgain {}\n");
    return result;
  } }), { code: "context_sources_changed" });
});

test("pack requires an existing persisted ID without enrolling a legacy record", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  const manual = JSON.stringify([{ name: "legacy", rootId: "test", relativePath: "main" }]);
  fs.writeFileSync(f.options.registry.manualProjectsFile, manual);
  assert.throws(() => build({ ...f.request, projectId: "legacy" }, f.options), { code: "project_not_found" });
  assert.equal(fs.readFileSync(f.options.registry.manualProjectsFile, "utf8"), manual);
});

test("pack labels unborn, non-Git and unavailable evidence without reusing a clean commit", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  f.git(["checkout", "--orphan", "unborn"]);
  assert.equal(build(f.request, f.options).revision.status, "unborn");
  fs.rmSync(path.join(f.repo, ".git"), { recursive: true, force: true });
  assert.equal(build(f.request, f.options).revision.status, "not_git");
  fs.writeFileSync(path.join(f.repo, ".git"), "invalid metadata");
  const unavailable = build(f.request, f.options);
  assert.equal(unavailable.revision.status, "unavailable");
  assert.equal(unavailable.revision.commitSha, null);
  assert.equal(unavailable.observation.incomplete, true);
  assert.equal(unavailable.observation.cacheReuse, "disabled");
});

test("pack enforces a serialized byte budget and reports omitted evidence", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  for (let i = 0; i < 32; i++) f.write(`src/${"long".repeat(20)}${i}.ts`, `export class Feature${i} {}\n`);
  const pack = build({ ...f.request, task: { title: "Inspect sources", paths: ["src"] }, limits: { files: 32, symbols: 64, maxBytes: 16384 } }, f.options);
  assert.ok(Buffer.byteLength(JSON.stringify(pack)) <= 16384);
  assert.ok(Object.values(pack.sections).some((section) => section.truncated));
  assert.equal(pack.observation.incomplete, true);
});

test("per-section omissions mark the pack incomplete even when the byte budget fits", async (t) => {
  const build = await builder();
  const f = taskContextFixture(t);
  const pack = build({ ...f.request, limits: { files: 0, symbols: 0 } }, f.options);
  assert.equal(pack.sections.files.truncated, true);
  assert.equal(pack.observation.incomplete, true);
});
