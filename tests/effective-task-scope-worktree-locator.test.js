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

// SB-2: the ETS route must forward the request worktree locator to BOTH builders when it names a worktree other
// than the registered project location (parent + locator model), and must keep the self-located request unchanged.
// Real builders, real Impact normalizer, real composer; scratch parent repo + `git worktree add` linked worktree.
const KEYS = ["status", "commitSha", "branch", "dirty", "isLinkedWorktree", "repositoryId", "worktreeId"];
const codes = (d) => (d?.reasons || []).map((r) => r.code);
const ONE = ["src/one.ts"]; const TWO = ["src/one.ts", "src/unrelated.ts"];
const LINKED = { rootId: "test", relativePath: "linked" };

// Parent "main" registered as PrJ_Context (fixture default); linked worktree "linked" is NOT registered.
// The linked worktree carries an extra uncommitted test that only exists there (discriminates which tree was analysed).
function parentFx(t, { selfLinked = false } = {}) {
  const f = taskContextFixture(t);
  f.worktree("linked");
  f.write("tests/linked-only.test.ts", "import { One } from '../src/one'; export function LinkedOnly() { return One; }\n", path.join(f.root, "linked"));
  f.commit("linked-only", path.join(f.root, "linked"));
  if (selfLinked) {
    fs.writeFileSync(f.options.registry.manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "linked", projectId: "PrJ_Linked" }]));
    return { ...f, projectId: "PrJ_Linked", own: { rootId: "test", relativePath: "linked" } };
  }
  return { ...f, projectId: "PrJ_Context", own: { rootId: "test", relativePath: "main" } };
}
function revisionFor(f, worktree) {
  const own = worktree.rootId === f.own.rootId && worktree.relativePath === f.own.relativePath;
  const o = buildProjectTaskContext({ projectId: f.projectId, ...(own ? {} : { worktree }), task: { title: "T" } }, f.options).revision;
  const s = { ...o, repositoryId: o.repositoryIdentity };
  return Object.fromEntries(KEYS.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));
}
function body(f, paths, worktree, extra = {}) {
  return { task: { id: "sb2", title: "T", paths }, worktree, expectedRevision: revisionFor(f, worktree), includeTests: true,
    changeSemantics: { category: "local_implementation" }, ...extra };
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
function spy() {
  const seen = {};
  return { seen, deps: {
    buildProjectTaskContext: (input, o) => { seen.pack = input; return buildProjectTaskContext(input, o); },
    buildProjectImpact: (id, req, o) => { seen.impact = req; return buildProjectImpact(id, req, o); }
  } };
}
const watchPaths = (d) => (d?.watch?.items || []).map((i) => i.target?.path).sort();

// L: parent + locator (the documented model). RED at base: composer rejects worktree_locator_mismatch.
for (const [n, paths] of [["1p", ONE], ["2p", TWO]]) for (const it of [true, false]) {
  test(`L parent+locator ${n} includeTests=${it}: both builders get the locator; linked tree is analysed; not rejected`, async (t) => {
    const f = parentFx(t);
    const { seen, deps } = spy();
    const r = await dispatch(f, body(f, paths, LINKED, { includeTests: it }), deps);
    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.notEqual(r.payload.data.status, "rejected", JSON.stringify(codes(r.payload.data)));
    assert.deepEqual(seen.pack.worktree, LINKED);
    assert.deepEqual(Object.keys(seen.impact).sort(), ["includeTests", "paths", "worktree"]);
    assert.deepEqual(seen.impact, { paths, includeTests: it, worktree: LINKED });
    assert.doesNotThrow(() => normalizeImpactRequest(seen.impact));
    if (it) assert.ok(watchPaths(r.payload.data).includes("tests/linked-only.test.ts"), JSON.stringify(watchPaths(r.payload.data)));
  });
}

// A: self-located request (locator == registered location). GREEN at base and after; no locator forwarded.
for (const selfLinked of [false, true]) for (const [n, paths] of [["1p", ONE], ["2p", TWO]]) {
  test(`A self-located ${selfLinked ? "self-registered linked" : "main"} ${n}: Impact keys exactly [includeTests, paths]; pack gets no worktree`, async (t) => {
    const f = parentFx(t, { selfLinked });
    const { seen, deps } = spy();
    const r = await dispatch(f, body(f, paths, f.own), deps);
    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.notEqual(r.payload.data.status, "rejected", JSON.stringify(codes(r.payload.data)));
    assert.equal(Object.hasOwn(seen.pack, "worktree"), false);
    assert.deepEqual(Object.keys(seen.impact).sort(), ["includeTests", "paths"]);
  });
}

test("A0 worktree omitted entirely stays 400 invalid_effective_task_scope_request (GREEN at base)", async (t) => {
  const f = parentFx(t);
  const { worktree, ...rest } = body(f, ONE, f.own);
  const r = await dispatch(f, rest);
  assert.deepEqual([r.status, r.payload.error], [400, "invalid_effective_task_scope_request"]);
});

// S: a project registered as its own linked worktree that ALSO names another worktree. Existing resolver semantics.
test("S1 self-registered linked + locator to its main checkout -> 409 worktree_parent_mismatch (RED at base: 200 rejected)", async (t) => {
  const f = parentFx(t, { selfLinked: true });
  const b = { ...body(f, ONE, f.own), worktree: { rootId: "test", relativePath: "main" } };
  const r = await dispatch(f, b);
  assert.deepEqual([r.status, r.payload.error], [409, "worktree_parent_mismatch"]);
});
test("S2 self-registered linked + locator to a sibling linked worktree -> resolved once, bound to the sibling (RED at base)", async (t) => {
  const f = parentFx(t, { selfLinked: true });
  f.worktree("sibling");
  const sib = { rootId: "test", relativePath: "sibling" };
  const { seen, deps } = spy();
  const r = await dispatch(f, body(f, ONE, sib), deps);
  assert.equal(r.status, 200, JSON.stringify(r.payload));
  assert.notEqual(r.payload.data.status, "rejected", JSON.stringify(codes(r.payload.data)));
  assert.deepEqual([seen.pack.worktree, seen.impact.worktree], [sib, sib]);
});

// M: mismatched locators fail closed with existing service codes (first builder = Context Pack).
for (const [name, loc, setup, status, code] of [
  ["unregistered rootId", { rootId: "nope", relativePath: "linked" }, null, 404, "project_unavailable"],
  ["missing directory", { rootId: "test", relativePath: "missing" }, null, 404, "project_unavailable"],
  ["plain directory (not a worktree)", { rootId: "test", relativePath: "plain" }, (f) => fs.mkdirSync(path.join(f.root, "plain")), 409, "worktree_parent_mismatch"],
  ["subdirectory of the linked worktree", { rootId: "test", relativePath: "linked/src" }, null, 409, "worktree_parent_mismatch"],
  ["subdirectory of the parent", { rootId: "test", relativePath: "main/src" }, null, 409, "worktree_parent_mismatch"]
]) {
  test(`M mismatched locator ${name} -> ${status} ${code} (RED at base: 200 rejected worktree_locator_mismatch)`, async (t) => {
    const f = parentFx(t);
    if (setup) setup(f);
    const r = await dispatch(f, { ...body(f, ONE, f.own), worktree: loc });
    assert.deepEqual([r.status, r.payload.error], [status, code], JSON.stringify(r.payload));
  });
}

test("M request expectedRevision of the parent while naming the linked worktree -> rejected worktree_identity_mismatch (RED at base)", async (t) => {
  const f = parentFx(t);
  const r = await dispatch(f, { ...body(f, ONE, f.own), worktree: LINKED });
  assert.equal(r.status, 200);
  assert.deepEqual([r.payload.data.status, codes(r.payload.data)], ["rejected", ["worktree_identity_mismatch"]]);
});

// I: invalid locators are rejected by the ETS normalizer before any builder runs (GREEN at base and after).
for (const [name, loc, code] of [
  ["traversal", { rootId: "test", relativePath: "../linked" }, "invalid_effective_task_scope_request"],
  ["inner traversal", { rootId: "test", relativePath: "main/../linked" }, "invalid_effective_task_scope_request"],
  ["absolute", { rootId: "test", relativePath: "/tmp/linked" }, "invalid_effective_task_scope_request"],
  ["empty path", { rootId: "test", relativePath: "" }, "invalid_effective_task_scope_request"],
  ["dot path", { rootId: "test", relativePath: "." }, "invalid_effective_task_scope_request"],
  ["non-string path", { rootId: "test", relativePath: 5 }, "invalid_effective_task_scope_request"],
  ["extra key", { rootId: "test", relativePath: "linked", absolutePath: "/x" }, "unexpected_field"],
  ["rootId > 128", { rootId: "r".repeat(129), relativePath: "linked" }, "text_bounds_exceeded"],
  ["rootId missing", { relativePath: "linked" }, "missing_required_text"],
  ["rootId non-string", { rootId: 1, relativePath: "linked" }, "invalid_text_type"],
  ["worktree not an object", "linked", "invalid_record"]
]) {
  test(`I invalid locator ${name} -> 400 ${code}; no builder called`, async (t) => {
    const f = parentFx(t);
    const { seen, deps } = spy();
    const r = await dispatch(f, { ...body(f, ONE, f.own), worktree: loc }, deps);
    assert.deepEqual([r.status, r.payload.error], [400, code], JSON.stringify(r.payload));
    assert.deepEqual(seen, {});
  });
}

test("I2 over-long relativePath (5000) passes the ETS normalizer (no length bound) but the route's Impact contract check rejects it before any builder -> 400 invalid_impact_request (RED at base: 200 rejected)", async (t) => {
  const f = parentFx(t);
  const { seen, deps } = spy();
  const r = await dispatch(f, { ...body(f, ONE, f.own), worktree: { rootId: "test", relativePath: "a".repeat(5000) } }, deps);
  assert.deepEqual([r.status, r.payload.error], [400, "invalid_impact_request"], JSON.stringify(r.payload));
  assert.deepEqual(seen, {});
});

// I3: locators the ETS normalizer accepts but a builder contract does not. Impact's pure normalizer is checked by the
// route before the Pack is built; the Pack normalizer runs first inside its builder. Both before any FS resolution.
for (const [name, rel, code, packCalled] of [
  ["glob metacharacters", "wt[1]", "invalid_impact_request", false],
  ["URI-like prefix", "http:x", "invalid_impact_request", false],
  ["drive-like prefix", "c:x", "invalid_impact_request", false],
  [".git segment", ".git", "invalid_task_context_request", true],
  ["node_modules segment", "node_modules/x", "invalid_task_context_request", true]
]) {
  test(`I3 locator outside a builder contract (${name}) -> 400 ${code}; Impact never built (RED at base: 200 rejected)`, async (t) => {
    const f = parentFx(t);
    const { seen, deps } = spy();
    const r = await dispatch(f, { ...body(f, ONE, f.own), worktree: { rootId: "test", relativePath: rel } }, deps);
    assert.deepEqual([r.status, r.payload.error], [400, code], JSON.stringify(r.payload));
    assert.equal(seen.impact, undefined);
    assert.equal(seen.pack !== undefined, packCalled);
  });
}

// T: the composer's locator/identity binding stays enforced with a forwarded locator.
const tamperImpact = (fn) => ({ buildProjectImpact: (id, req, o) => { const i = JSON.parse(JSON.stringify(buildProjectImpact(id, req, o))); fn(i, req); return i; } });
const tamperPack = (fn) => ({ buildProjectTaskContext: (input, o) => { const p = JSON.parse(JSON.stringify(buildProjectTaskContext(input, o))); fn(p, input); return p; } });
const dropLocator = { buildProjectImpact: (id, { worktree, ...req }, o) => buildProjectImpact(id, req, o) };
const both = (fn) => ({ ...tamperPack(fn), ...tamperImpact(fn) });
for (const [name, deps, code] of [
  ["impact.project.relativePath = parent", tamperImpact((i) => { i.project.relativePath = "main"; }), "worktree_locator_mismatch"],
  ["pack.project.relativePath = parent", tamperPack((p) => { p.project.relativePath = "main"; }), "worktree_locator_mismatch"],
  ["pack and impact agree on parent, request names linked", both((x) => { x.project.relativePath = "main"; }), "worktree_locator_mismatch"],
  ["impact.project.rootId", tamperImpact((i) => { i.project.rootId = "other"; }), "worktree_locator_mismatch"],
  ["Impact builder ignores the locator (real parent build)", dropLocator, "worktree_locator_mismatch"],
  ["impact.revision.worktreeId", tamperImpact((i) => { i.revision.worktreeId = "e".repeat(64); }), "worktree_identity_mismatch"],
  ["pack.revision.worktreeId", tamperPack((p) => { p.revision.worktreeId = "e".repeat(64); }), "worktree_identity_mismatch"],
  ["impact.projectId", tamperImpact((i) => { i.projectId = "PrJ_Other"; }), "project_identity_mismatch"]
]) {
  test(`T tamper with forwarded locator: ${name} -> rejected ${code}`, async (t) => {
    const f = parentFx(t);
    const r = await dispatch(f, body(f, ONE, LINKED), deps);
    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.deepEqual({ status: r.payload.data.status, codes: codes(r.payload.data) }, { status: "rejected", codes: [code] });
  });
}

test("H create and absence witness stay blocked over HTTP with a forwarded locator", async (t) => {
  const f = parentFx(t);
  const b = body(f, ["src/new.ts"], LINKED);
  const create = await dispatch(f, { ...b, operationIntent: { kind: "create", targets: [{ oldPath: null, newPath: "src/new.ts" }] } });
  assert.deepEqual([create.status, create.payload.error], [400, "invalid_delete_intent"]);
  const witness = await dispatch(f, { ...b, createDestinationAbsenceWitness: {} });
  assert.deepEqual([witness.status, witness.payload.error], [400, "unexpected_field"]);
});

// D2: the forwarding decision uses the injectable dependencies.getProjectByIdForIntelligence; a failing lookup forwards
// nothing (today's path). Both stay fail-closed: an unforwarded linked locator is rejected by the composer.
for (const [name, getProjectByIdForIntelligence] of [
  ["injected lookup reports the request locator as the registered location", () => ({ rootId: "test", relativePath: "linked" })],
  ["injected lookup throws", () => { throw Object.assign(new Error("lookup failed"), { code: "project_unavailable" }); }]
]) {
  test(`D2 ${name} -> nothing forwarded; composer rejects worktree_locator_mismatch`, async (t) => {
    const f = parentFx(t);
    const { seen, deps } = spy();
    const r = await dispatch(f, body(f, ONE, LINKED), { ...deps, getProjectByIdForIntelligence });
    assert.equal(r.status, 200, JSON.stringify(r.payload));
    assert.equal(Object.hasOwn(seen.pack, "worktree"), false);
    assert.deepEqual(Object.keys(seen.impact).sort(), ["includeTests", "paths"]);
    assert.deepEqual([r.payload.data.status, codes(r.payload.data)], ["rejected", ["worktree_locator_mismatch"]]);
  });
}

// A-1: a locator that differs from the registered location ONLY in rootId (same relativePath "main") is not the
// registered location (D1 compares rootId AND relativePath). It is forwarded, and the Context Pack builder fails closed
// on the unregistered root before Impact is built. Kills "compare relativePath only, ignore rootId".
test("A-1 locator differing from the registered location only in rootId is forwarded -> 404 project_unavailable; Impact never built", async (t) => {
  const f = parentFx(t);
  const loc = { rootId: "nope", relativePath: f.own.relativePath };
  assert.notEqual(loc.rootId, f.own.rootId);
  const { seen, deps } = spy();
  const r = await dispatch(f, { ...body(f, ONE, f.own), worktree: loc }, deps);
  assert.deepEqual([r.status, r.payload.error], [404, "project_unavailable"], JSON.stringify(r.payload));
  assert.deepEqual(seen.pack.worktree, loc);
  assert.equal(seen.impact, undefined);
});
