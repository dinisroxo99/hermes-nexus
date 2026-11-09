import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { answerProjectQuestion } from "../src/lib/project-question.js";
import { createQuestionProjects } from "./fixtures/project-question-projects.mjs";

const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/project-question-golden.json", import.meta.url)));
const kinds = ["symbol", "tests", "impact", "history"];

function citation(question, item) {
  return question === "history"
    ? { path: item?.path ?? null, commitSha: item?.commitSha ?? null, change: item?.change ?? null }
    : item?.path ?? null;
}

function scoreCase(example, answer, head, error) {
  const checks = {
    project: answer?.projectId === example.projectId,
    revision: answer?.revision?.commitSha === head && answer?.revision?.dirty === (example.question === "history" ? null : false),
    question: answer?.question === example.question,
    subject: (answer?.symbol ?? answer?.originPath ?? answer?.path) === example.subject,
    incomplete: answer?.observation?.incomplete === example.incomplete,
    finding: (answer?.outcome ?? answer?.findingState) === example.finding,
    evidenceArray: Array.isArray(answer?.evidence)
  };
  const observed = checks.evidenceArray ? answer.evidence.map((item) => citation(example.question, item)) : [];
  if (example.question === "symbol" && checks.evidenceArray) {
    checks.symbol = answer.evidence.every((item) => item?.name === example.subject && item.provenance?.source?.path === item.path);
  }
  const missing = [...example.evidence];
  const unexpected = [];
  for (const item of observed) {
    const position = missing.findIndex((expected) => JSON.stringify(expected) === JSON.stringify(item));
    if (position === -1) unexpected.push(item);
    else missing.splice(position, 1);
  }
  // History also promises newest-first order. Other citation lists are scored as multisets.
  if (example.question === "history") checks.historyOrder = JSON.stringify(observed) === JSON.stringify(example.evidence);
  const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
  return { id: example.id, question: example.question, projectId: example.projectId, subject: example.subject,
    passed: !error && !failedChecks.length && !missing.length && !unexpected.length, failedChecks, error,
    revision: { expected: head, observed: answer?.revision?.commitSha ?? null },
    incomplete: { expected: example.incomplete, observed: answer?.observation?.incomplete ?? null },
    hits: example.evidence.length - missing.length, expected: example.evidence, observed, missing, unexpected };
}

function summarize(cases) {
  const hits = cases.reduce((sum, item) => sum + item.hits, 0);
  const missing = cases.reduce((sum, item) => sum + item.missing.length, 0);
  const unexpected = cases.reduce((sum, item) => sum + item.unexpected.length, 0);
  return { cases: cases.length, passedCases: cases.filter((item) => item.passed).length, hits, missing, unexpected,
    precision: hits + unexpected ? hits / (hits + unexpected) : null,
    recall: hits + missing ? hits / (hits + missing) : null };
}

export function evaluateProjectQuestions(answer = answerProjectQuestion) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-project-question-golden-"));
  try {
    const options = createQuestionProjects(root);
    const cases = golden.cases.map((example) => {
      const { projectId, question, subject } = example;
      let response, error = null;
      try { response = answer({ projectId, question, subject }, options); }
      catch (cause) { error = /^[a-z_]{1,80}$/.test(cause?.code ?? "") ? cause.code : "question_failed"; }
      return scoreCase(example, response, golden.heads[projectId], error);
    });
    return { goldenVersion: golden.version, passed: cases.every((item) => item.passed),
      byQuestion: Object.fromEntries(kinds.map((kind) => [kind, summarize(cases.filter((item) => item.question === kind))])),
      cases };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = evaluateProjectQuestions();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.passed ? 0 : 1;
  } catch {
    console.error(JSON.stringify({ error: "golden_evaluation_failed" }));
    process.exitCode = 1;
  }
}
