import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluateProjectQuestions } from "../scripts/evaluate-project-questions.mjs";
import { answerProjectQuestion } from "../src/lib/project-question.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const script = "scripts/evaluate-project-questions.mjs";

test("the frozen CLI reports stable evidence counts across disposable workspaces", () => {
  const first = spawnSync(process.execPath, [script], { cwd: repo, encoding: "utf8" });
  assert.equal(first.status, 0, first.stderr);
  const report = JSON.parse(first.stdout);
  assert.deepEqual(evaluateProjectQuestions(), report);
  assert.equal(report.goldenVersion, 1);
  assert.equal(report.passed, true);
  for (const [kind, count, hits] of [["symbol", 3, 2], ["tests", 2, 1], ["impact", 2, 2], ["history", 2, 3]]) {
    assert.deepEqual(report.byQuestion[kind], { cases: count, passedCases: count, hits, missing: 0, unexpected: 0,
      precision: 1, recall: 1 });
  }
  assert.equal(report.cases.find((item) => item.id === "symbol-unsupported").incomplete.observed, true);
});

test("incorrect binding, duplicates, reversed history, unavailable producer and false completeness fail separately", () => {
  const report = evaluateProjectQuestions((question, options) => {
    if (question.subject === "PythonOnly") throw new Error("sensitive exception details");
    const answer = answerProjectQuestion(question, options);
    if (question.question === "symbol") {
      answer.projectId = "PrJ_Wrong";
      if (question.projectId === "PrJ_GoldenBeta") answer.observation.incomplete = false;
    }
    if (question.question === "tests" && answer.evidence.length) answer.evidence.push(answer.evidence[0]);
    if (question.question === "impact") answer.evidence = [];
    if (question.question === "history") answer.evidence.reverse();
    return answer;
  });
  const get = (id) => report.cases.find((item) => item.id === id);
  assert.equal(report.passed, false);
  assert.deepEqual(get("symbol-beta").failedChecks, ["project", "incomplete"]);
  assert.equal(get("symbol-unsupported").error, "question_failed");
  assert.equal(report.byQuestion.tests.unexpected, 1);
  assert.equal(report.byQuestion.tests.precision, 0.5);
  assert.equal(report.byQuestion.impact.missing, 2);
  assert.equal(report.byQuestion.impact.precision, null);
  assert.equal(report.byQuestion.impact.recall, 0);
  assert.deepEqual(get("history-deleted").failedChecks, ["historyOrder"]);
});

test("the CLI exits nonzero on an incorrect frozen expectation", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-golden-negative-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts/fixtures"), { recursive: true });
  fs.symlinkSync(path.join(repo, "src"), path.join(root, "src"), "dir");
  for (const file of [script, "scripts/fixtures/project-question-projects.mjs"]) {
    fs.copyFileSync(path.join(repo, file), path.join(root, file));
  }
  const file = "scripts/fixtures/project-question-golden.json";
  const altered = JSON.parse(fs.readFileSync(path.join(repo, file)));
  altered.cases[0].evidence = ["alt/namesake.ts"];
  fs.writeFileSync(path.join(root, file), JSON.stringify(altered));
  const run = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.passed, false);
  assert.deepEqual(report.cases[0].missing, ["alt/namesake.ts"]);
  assert.deepEqual(report.cases[0].unexpected, ["src/shared.ts"]);
});
