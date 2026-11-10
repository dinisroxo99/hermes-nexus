import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import { CREATE_ABSENCE_WITNESS_FS_ALLOWLIST } from "../src/lib/create-destination-absence-witness-constants.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

test("operation-observation HTTP binds the URL project, returns sealed files and refuses stale or injected data", async (t) => {
  const f = taskContextFixture(t);
  const linked = f.worktree("linked");
  const router = createRouter();
  registerIntelligenceRoutes(router, { getProjectConfig: () => ({ dataDir: f.root }), getConfiguredProjectRoots: () => f.options.registry.roots });
  const server = http.createServer((req, res) => router.dispatch(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/intelligence/projects/${f.request.projectId}/operation-observation`;
  const base = { task: { id: "op", title: "Inspect src" }, worktree: { rootId: "test", relativePath: "linked" },
    operation: { kind: "expand_directory", path: "src" }, expectedCommitSha: f.git(["rev-parse", "HEAD"], linked) };
  const post = async (body) => {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify(body) });
    return [response.status, await response.json()];
  };
  const [status, payload] = await post(base);
  const fsType = "0x" + (fs.statfsSync(linked).type >>> 0).toString(16);
  if (CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes(fsType)) {
    assert.equal(status, 200, JSON.stringify(payload));
    assert.deepEqual(payload.data.files.map((f) => f.path), ["src/one.ts", "src/unrelated.ts"]);
    assert.deepEqual((await post({ ...base, expectedEvidenceDigest: payload.data.evidenceDigest }))[1].data, payload.data);
  } else {
    assert.equal(status, 422);
    assert.equal(payload.data, undefined);
  }
  assert.equal((await post({ ...base, expectedCommitSha: "f".repeat(40) }))[0], 409);
  for (const extra of [{ projectId: "Other" }, { witness: {} }]) {
    assert.equal((await post({ ...base, ...extra }))[0], 400);
  }
  assert.equal(f.git(["status", "--porcelain"], linked), "");
});
