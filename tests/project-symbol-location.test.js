import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { locateProjectSymbol } from "../src/lib/project-symbol-location.js";
import { gitFixture } from "./helpers/git-fixture.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

const locate = (f, symbol, extra = {}) => locateProjectSymbol({ projectId: "PrJ_Context", symbol, ...extra }, f.options);

test("retrieval cites every observed exact-name match, with source hashes and current checkout identity", (t) => {
  const f = taskContextFixture(t);
  const text = "export class One {}\n";
  f.write("src/also.ts", text);
  const committed = f.commit();
  const result = locate(f, "One");
  assert.equal(result.outcome, "located");
  assert.deepEqual(result.evidence.map((item) => item.path), ["src/also.ts", "src/one.ts"]);
  for (const item of result.evidence) {
    assert.equal(item.name, "One");
    assert.equal(item.line, null);
    assert.equal(item.provenance.source.path, item.path);
    assert.equal(item.provenance.source.sha256, createHash("sha256").update(text).digest("hex"));
    assert.equal(item.provenance.provider.id, "native.typescript");
    assert.equal(item.provenance.trust, "derived_analysis");
  }
  assert.equal(result.revision.commitSha, committed);
  assert.equal(result.revision.dirty, false);
  assert.equal(result.observation.basis, "working_tree");
  assert.equal(result.observation.incomplete, false);
  assert.match(result.snapshotToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(result, locate(f, "One"));
  assert.equal(locate(f, "one").outcome, "unknown");
  assert.equal(f.git(["status", "--porcelain"]), "");

  f.write("src/also.ts", "export class Renamed {}\n");
  const dirty = locate(f, "One");
  assert.deepEqual(dirty.evidence.map((item) => item.path), ["src/one.ts"]);
  assert.equal(dirty.revision.commitSha, committed);
  assert.equal(dirty.revision.dirty, true);
  assert.notEqual(dirty.snapshotToken, result.snapshotToken);
  assert.equal(locate(f, "Renamed").evidence[0].path, "src/also.ts");
  const nextCommit = f.commit();
  assert.equal(locate(f, "Renamed").revision.commitSha, nextCommit);
});

test("two registered Git projects with homonyms return only their own evidence", (t) => {
  const f = taskContextFixture(t);
  const other = gitFixture(t, { committed: false });
  other.write("private/elsewhere.ts", "export class One {}\n");
  other.commit();
  f.options.registry.roots.push({ id: "second", path: other.root });
  fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([...f.entries,
    { name: "another", rootId: "second", relativePath: "main", projectId: "PrJ_Second" }
  ]));
  const first = locate(f, "One");
  const second = locate(f, "One", { projectId: "PrJ_Second" });
  assert.deepEqual(first.evidence.map((item) => item.path), ["src/one.ts"]);
  assert.deepEqual(second.evidence.map((item) => item.path), ["private/elsewhere.ts"]);
  assert.notEqual(first.snapshotToken, second.snapshotToken);
  assert.throws(() => locate(f, "One", { projectId: "PrJ_Missing" }), { code: "project_not_found" });
});

test("linked-worktree results bind the selected checkout, and unrelated locators are refused", (t) => {
  const f = taskContextFixture(t);
  const tree = f.worktree("linked");
  f.write("src/only-linked.ts", "export class LinkedOnly {}\n", tree);
  const result = locate(f, "LinkedOnly", { worktree: { rootId: "test", relativePath: "linked" } });
  assert.equal(result.project.relativePath, "linked");
  assert.equal(result.revision.isLinkedWorktree, true);
  assert.equal(result.evidence[0].path, "src/only-linked.ts");
  assert.equal(locate(f, "LinkedOnly").outcome, "unknown");
  const unrelated = gitFixture(t);
  f.options.registry.roots.push({ id: "other", path: unrelated.root });
  assert.throws(() => locate(f, "One", { worktree: { rootId: "other", relativePath: "main" } }),
    { code: "worktree_parent_mismatch" });
});

test("an incomplete provider preserves both positive evidence and explicit unknowns", (t) => {
  const f = taskContextFixture(t);
  f.write("extra.py", "class PythonOnly: pass\n");
  f.commit();
  const found = locate(f, "One");
  assert.equal(found.outcome, "located");
  assert.equal(found.observation.incomplete, true);
  assert.equal(found.coverage.providerStatus, "partial");
  assert.deepEqual(found.coverage.languages.uncovered, ["python"]);
  const unknown = locate(f, "PythonOnly");
  assert.equal(unknown.outcome, "unknown");
  assert.deepEqual(unknown.evidence, []);
  assert.equal(unknown.observation.incomplete, true);
});

test("the symbol output cap is reported even when every retained hit matches", (t) => {
  const f = taskContextFixture(t);
  for (let i = 0; i < 65; i++) f.write(`src/matches/${i}.ts`, "export class Repeated {}\n");
  f.commit();
  const result = locate(f, "Repeated");
  assert.equal(result.outcome, "located");
  assert.equal(result.evidence.length, result.coverage.symbolLimit);
  assert.equal(result.coverage.symbolsTruncated, true);
  assert.equal(result.observation.incomplete, true);
});

test("the CLI uses the service registry and returns a clean error for invalid input", (t) => {
  const f = taskContextFixture(t);
  const script = fileURLToPath(new URL("../scripts/ask-project.mjs", import.meta.url));
  const env = { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify(f.options.registry.roots), SERENA_PYTHON_IMAGE: "" };
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: path.dirname(path.dirname(script)), env, encoding: "utf8" });
  const ok = run("--project-id", "PrJ_Context", "--symbol", "One");
  assert.equal(ok.status, 0, ok.stderr);
  const { question, answer, ...found } = JSON.parse(ok.stdout);
  assert.equal(question, "symbol");
  assert.match(answer, /exact symbol observation/);
  assert.deepEqual(found, locate(f, "One"));
  const bad = run("--project-id", "PrJ_Context", "--symbol", "../secret");
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.deepEqual(JSON.parse(bad.stderr), { error: "invalid_symbol" });
});
