import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { askProject } from "../src/lib/project-question.js";
import { synthesizeProjectAnswer } from "../src/lib/local-project-synthesis.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

async function localServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: server.address().port, model: "test-model" };
}

function modelResponse(res, content) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ model: "test-model", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }));
}

test("local synthesis exposes a cited, source-bound claim and sends no unrelated file contents", async (t) => {
  const f = taskContextFixture(t);
  f.write("src/private.ts", "export const hidden = 'PRIVATE_CONTENT_SENTINEL';");
  f.commit();
  let request;
  const localModel = await localServer(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    request = JSON.parse(body);
    assert.equal(req.url, "/v1/chat/completions");
    modelResponse(res, { citations: ["C1"] });
  });
  const input = { projectId: f.request.projectId, question: "tests", subject: "src/one.ts" };
  const result = await askProject(input, { ...f.options, synthesize: true, localModel });
  assert.equal(request.model, "test-model");
  const prompt = JSON.stringify(request);
  assert.ok(!prompt.includes("PRIVATE_CONTENT_SENTINEL") && !prompt.includes("private.ts"));
  assert.ok(!prompt.includes(f.repo));
  assert.equal(result.synthesis.status, "synthesized");
  const citation = result.synthesis.citations[0];
  assert.equal(citation.id, "C1");
  assert.equal(result.evidence[citation.evidenceIndex].path, "tests/one.test.ts");
  assert.ok(result.synthesis.answer.includes("[C1]"));
  assert.equal(result.revision.commitSha, f.git(["rev-parse", "HEAD"]));
  assert.equal(result.question, "tests");
});

test("unlisted citations, repeated IDs, uncited prose and redirects cannot become project facts", async (t) => {
  const f = taskContextFixture(t);
  const result = await askProject({ projectId: f.request.projectId, question: "symbol", subject: "One" }, f.options);
  const malformed = [{ citations: ["C999"] }, { citations: ["C1", "C1"] }, { citations: ["C1"], answer: "fabrication" }];
  let count = 0;
  const localModel = await localServer(t, (_req, res) => {
    if (count < malformed.length) { modelResponse(res, malformed[count++]); return; }
    res.writeHead(307, { location: "http://192.0.2.1/private" }); res.end();
  });
  for (let i = 0; i < malformed.length; i++) {
    const synthesis = await synthesizeProjectAnswer(result, null, localModel);
    assert.equal(synthesis.status, "invalid_citations");
    assert.equal(synthesis.answer, null);
    assert.deepEqual(synthesis.citations, []);
  }
  assert.equal((await synthesizeProjectAnswer(result, null, localModel)).status, "unavailable");
});

const seedHistory = `
import sys
from scripts.nexus_run_history.source import digest
from scripts.nexus_run_history.store import ingest
filename, project, task, revision = sys.argv[1:]
row = dict(evidenceId='kanban_'+digest([project,task,1,3,revision]),projectId=project,revision=revision,
           taskId=task,runId=1,originSessionId='PRIVATE_SESSION',outcome='completed',runStatus='done',
           repository='example/fixture',pullRequest=7,source='hermes.kanban.pr_acceptance',status='active',
           qualityReason='terminal_checks_passed',requiredCheckCount=1,acceptanceEventId=3,completedEventId=4)
ingest(filename, dict(project=project,task=task,watermark=4,prefixes={4:'fixture'},rows=[row]))
`;

test("validated receipts are project/revision scoped, and older history cannot displace current observations", async (t) => {
  const f = taskContextFixture(t);
  f.git(["remote", "add", "origin", "https://github.com/example/fixture.git"]);
  const historyStore = path.join(f.root, "history.sqlite");
  const projectId = f.request.projectId;
  const sha = f.git(["rev-parse", "HEAD"]);
  for (const [id, task] of [[projectId, "local_task"], ["PrJ_Other", "other_task"]]) {
    const proc = spawnSync("python3", ["-B", "-c", seedHistory, historyStore, id, task, sha], { encoding: "utf8" });
    assert.equal(proc.status, 0, proc.stderr);
  }
  const options = { ...f.options, historyStore };
  const stored = await askProject({ projectId, question: "validated-history", taskId: "local_task" }, options);
  assert.equal(stored.validatedHistory.status, "observed", JSON.stringify(stored.validatedHistory));
  assert.equal(stored.validatedHistory.relation, "head_commit");
  assert.equal(stored.revision.dirty, null);
  assert.deepEqual(stored.validatedHistory.historicalEvidence.map((r) => r.taskId), ["local_task"]);
  assert.ok(!JSON.stringify(stored).includes("PRIVATE_SESSION"));
  f.write("src/one.ts", "export class Renamed {}\n");
  const dirty = await askProject({ projectId, question: "symbol", subject: "Renamed" }, { ...options, includeHistory: true });
  assert.equal(dirty.validatedHistory.relation, "base_of_dirty_working_tree");
  f.commit();
  const found = await askProject({ projectId, question: "symbol", subject: "Renamed", historyRevision: sha },
    { ...options, includeHistory: true });
  assert.equal(found.outcome, "located");
  assert.equal(found.validatedHistory.relation, "other_revision");
  assert.ok(found.validatedHistory.warnings.includes("historical_revision_differs_from_working_tree"));
  let invalid = true;
  const localModel = await localServer(t, (_req, res) => modelResponse(res, { citations: invalid ? ["H1"] : ["C1", "H1"] }));
  assert.equal((await synthesizeProjectAnswer(found, found.validatedHistory, localModel)).status, "invalid_citations");
  invalid = false;
  const synthesis = await synthesizeProjectAnswer(found, found.validatedHistory, localModel);
  assert.equal(synthesis.status, "synthesized");
  assert.deepEqual(synthesis.citations.map((c) => c.layer), ["project", "validated_history"]);
  const missing = await askProject({ projectId, question: "symbol", subject: "One", historyRevision: sha },
    { ...options, includeHistory: true, localModel, synthesize: true });
  assert.equal(missing.outcome, "unknown");
  assert.equal(missing.validatedHistory.status, "observed");
  assert.equal(missing.synthesis.status, "no_evidence");
  const current = await askProject({ projectId, question: "validated-history" }, options);
  assert.equal(current.validatedHistory.status, "unknown");
  f.git(["remote", "set-url", "origin", "git@github.com:wrong/registration.git"]);
  for (const revision of [sha, undefined]) {
    const mismatch = await askProject({ projectId, question: "validated-history", historyRevision: revision }, options);
    assert.equal(mismatch.validatedHistory.status, "unavailable");
    assert.deepEqual(mismatch.validatedHistory.historicalEvidence, []);
    assert.ok(mismatch.validatedHistory.warnings.includes("history_repository_mismatch"));
  }
  f.git(["remote", "set-url", "origin", "https://token@example.invalid/example/fixture"]);
  const unknown = await askProject({ projectId, question: "validated-history", historyRevision: sha }, options);
  assert.ok(unknown.validatedHistory.warnings.includes("history_repository_unverified"));
  assert.ok(!JSON.stringify(unknown).includes("token@"));
});

test("unavailable stores and models leave a usable deterministic answer with explicit status", async (t) => {
  const f = taskContextFixture(t);
  const result = await askProject({ projectId: f.request.projectId, question: "symbol", subject: "One" },
    { ...f.options, synthesize: true, includeHistory: true });
  assert.equal(result.outcome, "located");
  assert.equal(result.synthesis.status, "not_configured");
  assert.equal(result.validatedHistory.status, "unavailable");
  assert.ok(result.validatedHistory.warnings.includes("history_store_not_configured"));
});

test("validated history resolves self and linked worktrees using metadata only", async (t) => {
  const f = taskContextFixture(t);
  const projectId = f.request.projectId;
  const historyStore = path.join(f.root, "history.sqlite");
  f.git(["remote", "add", "origin", "ssh://git@github.com/Example/Fixture.git"]);
  const sha = f.git(["rev-parse", "HEAD"]);
  const seed = spawnSync("python3", ["-B", "-c", seedHistory, historyStore, projectId, "scoped_task", sha], { encoding: "utf8" });
  assert.equal(seed.status, 0, seed.stderr);
  const linked = f.worktree();
  const marker = path.join(f.root, "external-filter-called");
  f.git(["config", "filter.tripwire.clean", `touch "${marker}"; cat`]);
  for (const directory of [f.repo, linked]) {
    fs.writeFileSync(path.join(directory, ".gitattributes"), "src/one.ts filter=tripwire\n");
    fs.appendFileSync(path.join(directory, "src/one.ts"), "// dirty\n");
  }
  for (const relativePath of ["main", "linked"]) {
    const result = await askProject({ projectId, question: "validated-history", worktree: { rootId: "test", relativePath } },
      { ...f.options, historyStore });
    assert.equal(result.project.relativePath, relativePath);
    assert.equal(result.validatedHistory.repository, "example/fixture");
    assert.equal(result.validatedHistory.status, "observed", JSON.stringify(result.validatedHistory));
    assert.equal(result.validatedHistory.relation, "head_commit");
    assert.equal(result.revision.dirty, null);
    assert.ok(!fs.existsSync(marker));
  }
  // A competing per-worktree origin cannot silently inherit the registered parent's repository binding.
  f.git(["config", "extensions.worktreeConfig", "true"]);
  f.git(["config", "--worktree", "remote.origin.url", "git@github.com:unrelated/fixture.git"], linked);
  const conflicting = await askProject({ projectId, question: "validated-history", worktree: { rootId: "test", relativePath: "linked" } },
    { ...f.options, historyStore });
  assert.equal(conflicting.validatedHistory.status, "unavailable");
  assert.deepEqual(conflicting.validatedHistory.historicalEvidence, []);
  assert.ok(conflicting.validatedHistory.warnings.includes("history_repository_unverified"));
});
