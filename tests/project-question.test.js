import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { answerProjectQuestion } from "../src/lib/project-question.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

test("candidate tests and file impact cite the observed revision and preserve producer evidence", (t) => {
  const f = taskContextFixture(t);
  const input = { projectId: f.request.projectId, subject: "src/one.ts" };
  for (const question of ["tests", "impact"]) {
    const result = answerProjectQuestion({ ...input, question }, f.options);
    assert.equal(result.revision.commitSha, f.git(["rev-parse", "HEAD"]));
    assert.match(result.observation.targetSource.hash, /^[a-f0-9]{64}$/);
    assert.ok(result.evidence.some((item) => item.path === "tests/one.test.ts"));
    assert.ok(result.evidence.every((item) => item.origins?.[0]?.witness || item.witness));
  }
  const empty = answerProjectQuestion({ ...input, subject: "src/missing.ts", question: "tests" }, f.options);
  assert.equal(empty.observation.targetSource, null);
  assert.equal(empty.observation.incomplete, true);
  assert.equal(empty.evidence.length, 0);
});

test("ask-project accepts one question and rejects a path outside the project", (t) => {
  const f = taskContextFixture(t);
  const script = fileURLToPath(new URL("../scripts/ask-project.mjs", import.meta.url));
  const env = { ...process.env, DATA_DIR: f.root, PROJECTS_ROOTS: JSON.stringify(f.options.registry.roots), SERENA_PYTHON_IMAGE: "" };
  const run = (...args) => spawnSync(process.execPath, [script, "--project-id", f.request.projectId, ...args],
    { cwd: path.dirname(path.dirname(script)), env, encoding: "utf8" });
  const found = run("--tests-for", "src/one.ts");
  assert.equal(found.status, 0, found.stderr);
  assert.ok(JSON.parse(found.stdout).evidence.some((item) => item.path === "tests/one.test.ts"));
  const history = run("--history-of", "src/one.ts");
  assert.equal(history.status, 0, history.stderr);
  const result = JSON.parse(history.stdout);
  assert.equal(result.question, "history");
  assert.ok(result.evidence.some((item) => item.commitSha === f.git(["rev-parse", "HEAD"])));
  for (const args of [["--history-of", ".env"], ["--impact-of", "../private.ts"], ["--tests-for", "x", "--symbol", "One"]]) {
    assert.equal(run(...args).status, 1);
  }
});
