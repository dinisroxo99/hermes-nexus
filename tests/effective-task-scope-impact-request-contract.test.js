import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { normalizeImpactRequest } from "../src/lib/impact-policy.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

// S-1: the ETS route's Impact request must be built from Impact's public request contract only (paths,
// worktree?, includeTests?, limits?), through the REAL builders and the REAL Impact normalizer (no stub hides an
// unknown field). Design: Architect note hermes-nexus-arch-s1-impact-request-contract.md (sha256 0bd0146b…9990), section 5.
const KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
const IMPACT_REQUEST_FIELDS = ["paths", "worktree", "includeTests", "limits"];
const codes = (d) => (d?.reasons || []).map((r) => r.code);
function mainFx(t) { const f = taskContextFixture(t); return { ...f, projectId: f.request.projectId, rel: "main" }; }
function linkedFx(t) {
  const f = taskContextFixture(t);
  f.worktree("linked");
  const manual = path.join(f.root, "projects.json");
  fs.writeFileSync(manual, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "linked", projectId: "PrJ_Linked" }]));
  const roots = [{ id: "test", path: f.root }];
  return { root: f.root, projectId: "PrJ_Linked", rel: "linked", options: { registry: { roots, manualProjectsFile: manual, discoveredProjectsFile: path.join(f.root, "d.json") } } };
}
function body(f, paths, extra = {}) {
  const o = buildProjectTaskContext({ projectId: f.projectId, task: { title: "T" } }, f.options).revision;
  const s = { ...o, repositoryId: o.repositoryIdentity };
  const expectedRevision = Object.fromEntries(KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
  return { task: { id: "s1", title: "T", paths }, worktree: { rootId: "test", relativePath: f.rel }, expectedRevision, includeTests: true, changeSemantics: { category: "local_implementation" }, ...extra };
}
async function dispatch(f, b, deps = {}) {
  const router = createRouter();
  registerIntelligenceRoutes(router, { getProjectConfig: () => ({ dataDir: f.root }), getConfiguredProjectRoots: () => f.options.registry.roots, ...deps });
  const req = Readable.from([JSON.stringify(b)]); req.method = "POST";
  req.url = `/api/intelligence/projects/${f.projectId}/effective-task-scope`; req.headers = { host: "localhost" };
  const res = { writeHead(s) { this.status = s; }, end(t) { this.body = t; } };
  assert.equal(await router.dispatch(req, res), true);
  return { status: res.status, payload: JSON.parse(res.body) };
}
// A real pack whose revision also carries the repositoryId alias. The composer accepts this alias when it equals
// repositoryIdentity (effective-task-scope.js:208-210), so it is a legal pack shape that arms the copy branch.
const aliasPack = (input, options) => {
  const pack = buildProjectTaskContext(input, options);
  return { ...pack, revision: { ...pack.revision, repositoryId: pack.revision.repositoryIdentity } };
};
const ONE = ["src/one.ts"]; const TWO = ["src/one.ts", "src/unrelated.ts"];

for (const [fx, mk] of [["main", mainFx], ["linked", linkedFx]]) for (const [n, paths] of [["1p", ONE], ["2p", TWO]]) {
  test(`R1 ${fx} ${n}: real pack + repositoryId alias -> same 200 result as the plain real pack (RED at 0f72: 400 invalid_impact_request)`, async (t) => {
    const f = mk(t);
    const b = body(f, paths);
    const plain = await dispatch(f, b);
    const alias = await dispatch(f, b, { buildProjectTaskContext: aliasPack });
    assert.equal(plain.status, 200);
    assert.equal(alias.status, 200, JSON.stringify(alias.payload));
    assert.deepEqual(alias.payload.data, plain.payload.data);
  });
}

test("R2 every Impact request the route sends passes the REAL Impact normalizer and uses only contract fields (RED at 0f72)", async (t) => {
  const f = linkedFx(t);
  for (const builder of [buildProjectTaskContext, aliasPack]) for (const it of [true, false]) {
    let input;
    await dispatch(f, body(f, ONE, { includeTests: it }), {
      buildProjectTaskContext: builder,
      buildProjectImpact: (id, req, o) => { input = req; return buildProjectImpact(id, req, o); }
    });
    assert.ok(Object.keys(input).every((k) => IMPACT_REQUEST_FIELDS.includes(k)), JSON.stringify(input));
    assert.doesNotThrow(() => normalizeImpactRequest(input));
    assert.deepEqual(input, { paths: ONE, includeTests: it });
  }
});

test("G1 the real Impact normalizer rejects identity fields (documents why the copy branch cannot be renamed)", () => {
  for (const extra of [{ repositoryId: "b".repeat(64) }, { worktreeId: "c".repeat(64) }, { repositoryIdentity: "b".repeat(64) }, { revision: {} }, { projectId: "PrJ_Context" }]) {
    assert.throws(() => normalizeImpactRequest({ paths: ONE, ...extra }), (e) => e.code === "invalid_impact_request", JSON.stringify(extra));
  }
});

// Identity binding stays in the composer: tamper the REAL pack/impact after the real build. All GREEN at 0f72 and after,
// except "pack.revision.repositoryId alias != identity": at 0f72 that alias arms the copy branch, so the route fails
// earlier with 400 invalid_impact_request (fail-closed, but the composer never sees it); after the fix it is RED->GREEN.
const tamperImpact = (fn) => ({ buildProjectImpact: (id, req, o) => { const i = JSON.parse(JSON.stringify(buildProjectImpact(id, req, o))); fn(i); return i; } });
const tamperPack = (fn) => ({ buildProjectTaskContext: (input, o) => { const p = JSON.parse(JSON.stringify(buildProjectTaskContext(input, o))); fn(p); return p; } });
for (const [name, deps, code] of [
  ["impact.projectId", tamperImpact((i) => { i.projectId = "PrJ_Other"; }), "project_identity_mismatch"],
  ["impact.project.relativePath", tamperImpact((i) => { i.project.relativePath = "other"; }), "worktree_locator_mismatch"],
  ["impact.revision.commitSha", tamperImpact((i) => { i.revision.commitSha = "f".repeat(40); }), "revision_binding_mismatch"],
  ["impact.revision.repositoryId", tamperImpact((i) => { i.revision.repositoryId = "e".repeat(64); }), "repository_identity_mismatch"],
  ["impact.revision.worktreeId", tamperImpact((i) => { i.revision.worktreeId = "e".repeat(64); }), "worktree_identity_mismatch"],
  ["impact.snapshotToken", tamperImpact((i) => { i.snapshotToken = "f".repeat(64); }), "snapshot_token_mismatch"],
  ["impact.provider.version", tamperImpact((i) => { i.provider.version = "999"; }), "provider_mismatch"],
  ["pack.revision.repositoryIdentity", tamperPack((p) => { p.revision.repositoryIdentity = "e".repeat(64); }), "repository_identity_mismatch"],
  ["pack.revision.repositoryId alias != identity (RED at 0f72: 400 invalid_impact_request)", tamperPack((p) => { p.revision.repositoryId = "e".repeat(64); }), "repository_identity_mismatch"],
  ["pack.revision.worktreeId", tamperPack((p) => { p.revision.worktreeId = "e".repeat(64); }), "worktree_identity_mismatch"]
]) {
  test(`T identity tamper ${name} -> rejected ${code}`, async (t) => {
    const f = linkedFx(t);
    const r = await dispatch(f, body(f, ONE), deps);
    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.deepEqual({ status: r.payload.data.status, codes: codes(r.payload.data) }, { status: "rejected", codes: [code] });
  });
}

test("H create and absence witness stay blocked over HTTP (GREEN at 0f72 and after)", async (t) => {
  const f = linkedFx(t);
  const b = body(f, ["src/new.ts"]);
  const create = await dispatch(f, { ...b, operationIntent: { kind: "create", targets: [{ oldPath: null, newPath: "src/new.ts" }] } });
  assert.equal(create.status, 400); assert.equal(create.payload.error, "invalid_delete_intent");
  const witness = await dispatch(f, { ...b, createDestinationAbsenceWitness: {} });
  assert.equal(witness.status, 400); assert.equal(witness.payload.error, "unexpected_field");
});
