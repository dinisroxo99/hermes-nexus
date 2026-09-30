import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import fs, { readFileSync, readdirSync } from "node:fs";
import childProcess from "node:child_process";
import { composeEffectiveTaskScope } from "../src/lib/effective-task-scope.js";
import {
  MAX_COMPACT_INPUT, MAX_NESTING, MAX_VISITED_VALUES, checkInputBudget
} from "../src/lib/effective-task-scope-policy.js";
import { composeEffectiveTaskScopeFromEnvelopes as compose } from "../src/lib/effective-task-scope-adapter.js";

// Labelled synthetic data, not acquired observations or authenticated evidence.
function fixture() {
  const revision = {
    status: "available", commitSha: "a".repeat(40), branch: "fixture",
    dirty: false, isLinkedWorktree: true,
    repositoryId: "b".repeat(64), worktreeId: "c".repeat(64)
  };
  const task = { id: "fixture", title: "Adapter fixture", paths: ["src/a.js"], symbols: [] };
  const project = { rootId: "fixture", relativePath: "fixture" };
  const provider = { id: "native.typescript", version: "1" };
  const request = {
    task, projectId: "prj_fixture", worktree: project,
    expectedRevision: { ...revision }, includeTests: true,
    changeSemantics: { category: "local_implementation" }
  };
  const pack = {
    schemaVersion: 1, analysisVersion: "task-context-v1", contextPackId: "fixture",
    projectId: request.projectId, project,
    revision: { ...revision, repositoryIdentity: revision.repositoryId },
    analysis: { snapshotToken: "fixture", provider },
    observation: { incomplete: false, sourceDigest: "fixture", digestCoverage: "bounded_collected_sources" },
    sections: { task: { items: [task] } }
  };
  const witness = {
    id: "fixture-edge", provider, capability: "dependencies", relationshipKind: "imports",
    source: { path: "src/b.js", hash: "d".repeat(64) },
    location: null, trust: "derived_analysis", basis: "structural"
  };
  const impact = {
    schemaVersion: 1, analysisVersion: "impact-v2", projectId: request.projectId,
    project, revision: { ...revision }, snapshotToken: "fixture", provider,
    targets: [{ originPath: "src/a.js", targetSource: { path: "src/a.js", hash: "e".repeat(64) } }],
    status: "available", findingState: "evidence_found", observation: { incomplete: false },
    affectedFiles: [{ path: "src/b.js", origins: [{ originPath: "src/a.js", minimumDistance: 1, witness }] }],
    affectedTests: { status: "available", findingState: "no_evidence_found", candidates: [] },
    completeness: { source: [], provider: [], traversal: [], output: [] }
  };
  return structuredClone({ request, envelopes: { pack: { ok: true, data: pack }, impact: { ok: true, data: impact } } });
}

const stateKey = Symbol.for("effective-task-scope-adapter.test.calls");
const state = globalThis[stateKey] = { calls: 0, mode: "real", result: null, args: null };
const canonicalUrl = new URL("../src/lib/effective-task-scope.js", import.meta.url).href;
// Instrument only this test's second adapter instance. Classification stays real.
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./effective-task-scope.js" && context.parentURL?.endsWith("?calls")) {
      const source = `import { composeEffectiveTaskScope as real } from ${JSON.stringify(canonicalUrl)};
        export function composeEffectiveTaskScope(...args) {
          const s = globalThis[Symbol.for("effective-task-scope-adapter.test.calls")];
          s.calls++; s.args = args;
          if (s.mode === "throw") throw new Error("PRIVATE upstream payload and identity");
          return s.mode === "sentinel" ? s.result : real(...args);
        }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
let countedCompose;
try {
  ({ composeEffectiveTaskScopeFromEnvelopes: countedCompose } = await import("../src/lib/effective-task-scope-adapter.js?calls"));
} finally {
  hook.deregister();
}

function parity(f, status) {
  const direct = composeEffectiveTaskScope(f.request, { pack: f.envelopes.pack.data, impact: f.envelopes.impact.data });
  const result = compose(f.request, f.envelopes);
  assert.equal(result.status, status);
  assert.equal(JSON.stringify(result), JSON.stringify(direct));
  return result;
}
function refused(request, envelopes, code = "invalid_effective_task_scope_envelope") {
  state.calls = 0;
  assert.throws(() => countedCompose(request, envelopes), error => {
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal(error.cause, undefined);
    assert.equal(Object.hasOwn(error, "data"), false);
    return true;
  });
  assert.equal(state.calls, 0);
}
function minimal() {
  return { request: {}, envelopes: { pack: { ok: true, data: {} }, impact: { ok: true, data: {} } } };
}
const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
const values = value => 1 + (value && typeof value === "object" ? Object.values(value).reduce((n, v) => n + values(v), 0) : 0);
function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test("adapter: real composer parity preserves incomplete, terminal results and witnesses", () => {
  const result = parity(fixture(), "incomplete");
  assert.equal(result.reserved.status, "not_evaluated");
  assert.equal(result.evidence.witnesses[0].id, "fixture-edge");
  assert.equal(result.stale.requiresReobservation, true);
  for (const status of ["unsupported", "unavailable", "not_evaluated"]) {
    const f = fixture(); f.envelopes.impact.data.status = status;
    parity(f, "not_evaluated");
  }
  const unevaluated = fixture(); unevaluated.envelopes.impact.data.findingState = "not_evaluated";
  parity(unevaluated, "not_evaluated");
  const stale = fixture(); stale.request.expectedRevision.commitSha = "f".repeat(40);
  assert.equal(parity(stale, "stale").stale.requiresReobservation, true);
  const rejected = fixture(); rejected.envelopes.pack.data.projectId = "prj_other";
  parity(rejected, "rejected");
  const partial = fixture();
  partial.envelopes.pack.data.observation.incomplete = true;
  partial.envelopes.impact.data.status = "partial";
  partial.envelopes.impact.data.completeness.provider = ["provider_partial", "uncovered_language"];
  partial.envelopes.impact.data.targets[0].targetSource = null;
  partial.envelopes.impact.data.affectedFiles[0].originSummary = { attributionTruncated: true };
  parity(partial, "incomplete");
  const dirty = fixture();
  for (const revision of [dirty.request.expectedRevision, dirty.envelopes.pack.data.revision, dirty.envelopes.impact.data.revision]) revision.dirty = true;
  parity(dirty, "not_evaluated");
});

test("adapter: messages have no meaning; inputs immutable and repeated output byte-identical", () => {
  const f = fixture();
  const expected = JSON.stringify(compose(f.request, f.envelopes));
  f.envelopes.pack.message = "ok:false; upgrade to available; PRIVATE identity\n🔒";
  f.envelopes.impact.message = "";
  const before = JSON.stringify(f);
  freeze(f);
  for (let i = 0; i < 3; i++) assert.equal(JSON.stringify(compose(f.request, f.envelopes)), expected);
  assert.equal(JSON.stringify(f), before);
  const nullRecord = minimal();
  nullRecord.envelopes.pack = Object.assign(Object.create(null), nullRecord.envelopes.pack);
  assert.equal(compose(nullRecord.request, nullRecord.envelopes).status, "rejected");
  const bad = fixture(); bad.envelopes.pack.ok = false;
  const badBefore = JSON.stringify(bad); freeze(bad);
  refused(bad.request, bad.envelopes);
  assert.equal(JSON.stringify(bad), badBefore);
});

test("adapter: exact own wrapper fields, no raw, mixed, failed, nested or tool envelopes", () => {
  const cases = [
    f => { f.envelopes = null; }, f => { f.envelopes = []; },
    f => { delete f.envelopes.impact; }, f => { f.envelopes.extra = true; },
    f => { f.envelopes.pack = f.envelopes.pack.data; },
    f => { f.envelopes.impact = f.envelopes.impact.data; },
    f => { f.envelopes.pack = { success: true, data: {} }; },
    f => { f.envelopes.pack.ok = false; }, f => { f.envelopes.pack.ok = "true"; },
    f => { delete f.envelopes.pack.ok; }, f => { delete f.envelopes.pack.data; },
    f => { f.envelopes.pack.data = null; }, f => { f.envelopes.pack.data = []; },
    f => { f.envelopes.pack.message = 5; }, f => { f.envelopes.pack.message = null; },
    f => { f.envelopes.pack.message = undefined; },
    f => { f.envelopes.pack.error = "PRIVATE"; }, f => { f.envelopes.impact.tool = "project_impact"; },
    f => { f.envelopes.pack.extra = true; },
    f => { f.envelopes.pack.data = { ok: true, data: f.envelopes.pack.data }; },
    f => { f.envelopes.impact.data = { ok: false, error: "PRIVATE" }; },
    f => { f.envelopes.pack = Object.create({ ok: true, data: {} }); }
  ];
  for (const change of cases) { const f = fixture(); change(f); refused(f.request, f.envelopes); }
});

test("adapter: inner versions, origins, request and includeTests stay exclusively canonical", () => {
  for (const change of [
    f => { f.envelopes.pack.data.schemaVersion = 2; },
    f => { f.envelopes.impact.data.analysisVersion = "effective-task-scope-v1"; },
    f => { f.envelopes.pack.data.analysisVersion = "wrong"; },
    f => { f.envelopes.impact.data.schemaVersion = 2; },
    f => { delete f.request.includeTests; },
    f => { f.envelopes.impact.data.originPath = "src/a.js"; delete f.envelopes.impact.data.targets; },
    f => { f.request.task.paths = ["../outside.js"]; },
    f => { f.request.limits = { compactBytes: 1 }; }
  ]) {
    const f = fixture(); change(f); parity(f, "rejected");
    state.calls = 0; countedCompose(f.request, f.envelopes); assert.equal(state.calls, 1);
  }
  const f = fixture(); f.request.includeTests = false;
  f.envelopes.impact.data.affectedTests = { status: "not_requested", candidates: [] };
  parity(f, "incomplete");
});

test("adapter: exactly one canonical call, unchanged result identity and static unexpected error", () => {
  const f = fixture(); state.calls = 0;
  const real = countedCompose(f.request, f.envelopes);
  assert.equal(state.calls, 1);
  assert.equal(JSON.stringify(real), JSON.stringify(compose(f.request, f.envelopes)));
  assert.equal(JSON.stringify(state.args[0]), JSON.stringify(f.request));
  assert.equal(JSON.stringify(state.args[1]), JSON.stringify({ pack: f.envelopes.pack.data, impact: f.envelopes.impact.data }));
  try {
    state.mode = "sentinel"; state.result = Object.freeze({ status: "stale" }); state.calls = 0;
    assert.equal(countedCompose(f.request, f.envelopes), state.result);
    assert.equal(state.calls, 1);
    state.mode = "throw"; state.calls = 0;
    assert.throws(() => countedCompose(f.request, f.envelopes), error => {
      assert.equal(error.code, "effective_task_scope_adapter_failed");
      assert.equal(error.message, "effective_task_scope_adapter_failed");
      assert.equal(error.cause, undefined); return true;
    });
    assert.equal(state.calls, 1);
  } finally { state.mode = "real"; }
});

test("adapter: complete compact UTF-8 budget counts wrappers and messages at equality and overflow", () => {
  const f = minimal(); f.envelopes.pack.message = "";
  const overhead = bytes(f);
  f.envelopes.pack.message = "🔒".repeat(Math.floor((MAX_COMPACT_INPUT - overhead) / 4));
  f.envelopes.pack.message += "x".repeat(MAX_COMPACT_INPUT - bytes(f));
  assert.equal(bytes(f), MAX_COMPACT_INPUT);
  state.calls = 0; countedCompose(f.request, f.envelopes); assert.equal(state.calls, 1);
  checkInputBudget(f.request, f.envelopes.pack.data, f.envelopes.impact.data);
  f.envelopes.pack.message += "x";
  refused(f.request, f.envelopes, "scope_budget_exceeded");
  for (const key of ["pack", "impact"]) {
    const inner = minimal(); inner.envelopes[key].data.padding = "";
    inner.envelopes[key].data.padding = "x".repeat(131072 - bytes(inner.envelopes[key].data));
    assert.equal(bytes(inner.envelopes[key].data), 131072);
    state.calls = 0; countedCompose(inner.request, inner.envelopes); assert.equal(state.calls, 1);
    inner.envelopes[key].data.padding += "x";
    refused(inner.request, inner.envelopes, "scope_budget_exceeded");
  }
});

test("adapter: wrappers count toward depth and visited-value equality/overflow", () => {
  const f = minimal(); f.envelopes.pack.data.padding = [];
  f.envelopes.pack.data.padding = Array(MAX_VISITED_VALUES - values(f)).fill(0);
  assert.equal(values(f), MAX_VISITED_VALUES);
  state.calls = 0; countedCompose(f.request, f.envelopes); assert.equal(state.calls, 1);
  f.envelopes.pack.data.padding.push(0);
  refused(f.request, f.envelopes, "scope_budget_exceeded");
  const deep = minimal(); let cursor = deep.envelopes.pack.data;
  // Complete adapter root=0, envelopes=1, pack wrapper=2, data=3.
  for (let depth = 4; depth <= MAX_NESTING; depth++) cursor = cursor.next = {};
  state.calls = 0; countedCompose(deep.request, deep.envelopes); assert.equal(state.calls, 1);
  cursor.next = {};
  refused(deep.request, deep.envelopes, "scope_budget_exceeded");
});

test("adapter: unsafe structures, accessors and callables reject without execution", () => {
  let hits = 0;
  const get = () => { hits++; throw new Error("PRIVATE"); };
  const changes = [
    f => Object.defineProperty(f.request, "includeTests", { get, enumerable: true }),
    f => Object.defineProperty(f.envelopes, "pack", { get, enumerable: true }),
    f => Object.defineProperty(f.envelopes.pack, "data", { get, enumerable: true }),
    f => Object.defineProperty(f.envelopes.impact.data, "schemaVersion", { get, enumerable: true }),
    f => Object.defineProperty(f.envelopes.pack, "message", { set: get, enumerable: true }),
    f => Object.defineProperty(f.envelopes.pack.data.sections.task.items, "0", { get, enumerable: true }),
    f => Object.defineProperty(f.envelopes.impact.data.targets, "0", { set: get, enumerable: true }),
    f => { f.envelopes.pack.data = Object.create({ get schemaVersion() { return get(); } }); },
    f => { f.envelopes.pack = Object.create({ get ok() { return get(); }, data: {} }); },
    f => { f.envelopes.pack = Object.assign(Object.create({ get data() { return get(); } }), { ok: true }); },
    f => { f.request = get; },
    f => { f.envelopes.toJSON = get; },
    f => { f.envelopes.pack.data.toJSON = get; },
    f => { f.envelopes.impact.data.targets[0].toJSON = get; },
    f => { f.envelopes.pack.data.callable = get; },
    f => { f.envelopes.pack.data.cycle = f.envelopes.pack.data; },
    f => { f.envelopes.pack.data.hidden = undefined; },
    f => { f.envelopes.pack.data[Symbol("private")] = true; },
    f => Object.defineProperty(f.envelopes.pack, "hidden", { value: true }),
    f => { f.envelopes.impact.data.targets = Array(1); }
  ];
  for (const change of changes) {
    const f = fixture(); change(f); refused(f.request, f.envelopes); assert.equal(hits, 0);
  }
});

test("adapter: forwarding, descriptor-substitution and revoked Proxies have zero trap hits", () => {
  let hits = 0;
  const trapNames = ["get", "set", "has", "ownKeys", "getPrototypeOf", "setPrototypeOf", "getOwnPropertyDescriptor", "defineProperty", "deleteProperty", "isExtensible", "preventExtensions", "apply", "construct"];
  const placements = [
    (f, wrap) => { f.request = wrap(f.request); },
    (f, wrap) => { f.envelopes = wrap(f.envelopes); },
    (f, wrap) => { f.envelopes.pack = wrap(f.envelopes.pack); },
    (f, wrap) => { f.envelopes.impact.data = wrap(f.envelopes.impact.data); },
    (f, wrap) => { f.envelopes.impact.data.targets = wrap(f.envelopes.impact.data.targets); },
    (f, wrap) => { f.envelopes.impact.data.targets[0] = wrap(f.envelopes.impact.data.targets[0]); },
    (f, wrap) => { f.envelopes.pack.data.callable = wrap(() => { hits++; }); }
  ];
  for (const mode of ["forward", "substitute", "revoked"]) {
    for (const place of placements) {
      const f = fixture();
      place(f, target => {
        const handler = Object.fromEntries(trapNames.map(name => [name, (...args) => {
          hits++;
          if (mode === "substitute" && name === "getOwnPropertyDescriptor") return { value: "PRIVATE", enumerable: true, configurable: true, writable: true };
          return Reflect[name](...args);
        }]));
        const { proxy, revoke } = Proxy.revocable(target, handler);
        if (mode === "revoked") revoke();
        return proxy;
      });
      refused(f.request, f.envelopes); assert.equal(hits, 0);
    }
  }
});

test("adapter: composition performs no network, filesystem, process, logging or clock calls", t => {
  const f = fixture();
  let hits = 0;
  const forbidden = () => { hits++; throw new Error("Unexpected IO"); };
  try {
    t.mock.method(globalThis, "fetch", forbidden);
    t.mock.method(Date, "now", forbidden);
    t.mock.method(console, "log", forbidden);
    t.mock.method(console, "error", forbidden);
    for (const name of ["readFileSync", "writeFileSync", "openSync", "statSync", "lstatSync", "realpathSync", "readdirSync"]) t.mock.method(fs, name, forbidden);
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) t.mock.method(childProcess, name, forbidden);
    const result = compose(f.request, f.envelopes);
    assert.equal(result.status, "incomplete");
    assert.equal(hits, 0);
  } finally { t.mock.restoreAll(); }
});

test("adapter: no runtime/provider/IO imports or production consumers", () => {
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("src/lib/effective-task-scope-adapter.js", root), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(imports, ["./effective-task-scope-policy.js", "./effective-task-scope.js"]);
  assert.doesNotMatch(source, /\b(?:fetch|Date|console|setTimeout|process|require|import\s*\()\b/);
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) inspect(url);
      else if (/\.(?:js|py|json|yaml)$/.test(entry.name) && entry.name !== "effective-task-scope-adapter.js") {
        assert.doesNotMatch(readFileSync(url, "utf8"), /effective-task-scope-adapter|composeEffectiveTaskScopeFromEnvelopes/);
      }
    }
  }
  for (const dir of ["src/", "integrations/", "scripts/"]) inspect(new URL(dir, root));
});

test("adapter: deletion intent byte parity and exactly one unchanged delegation", () => {
  function deletionFixture() {
    const f = fixture(); const pack = f.envelopes.pack.data; const impact = f.envelopes.impact.data;
    const provenance = { projectId: f.request.projectId, revisionRef: "revision", trust: "untrusted_repository_text", producer: "context-source-observation" };
    pack.sections.task = { ...pack.sections.task, status: "available", limit: 1, truncated: false, provenance };
    pack.sections.files = { status: "available", limit: 1, truncated: false, provenance, items: [{ path: "src/a.js",
      provenance: { trust: "canonical_fact", reason: "task_path", source: { path: "src/a.js", sha256: "e".repeat(64) } } }] };
    pack.analysis.status = "available";
    pack.analysis.coverage = impact.coverage = { observed: ["javascript"], covered: ["javascript"], uncovered: [] };
    impact.observation.digestCoverage = "bounded_collected_sources";
    impact.targets[0] = { ...impact.targets[0], status: "available", findingState: "evidence_found", completeness: { source: [], provider: [], traversal: [], output: [] } };
    f.request.operationIntent = { kind: "delete", targets: [{ oldPath: "src/a.js", newPath: null }] };
    return f;
  }
  for (const [change, status] of [
    [() => {}, "incomplete"],
    [f => { f.envelopes.pack.data.sections.files.items = []; }, "not_evaluated"],
    [f => { f.envelopes.impact.data.targets[0].findingState = "not_evaluated"; }, "not_evaluated"],
    [f => { f.request.operationIntent.targets[0].newPath = "destination"; }, "rejected"],
    [f => { f.request.expectedRevision.commitSha = "f".repeat(40); }, "stale"]
  ]) {
    const f = deletionFixture(); change(f); const expected = parity(f, status);
    state.calls = 0;
    assert.equal(JSON.stringify(countedCompose(f.request, f.envelopes)), JSON.stringify(expected));
    assert.equal(state.calls, 1);
    assert.equal(JSON.stringify(state.args[0]), JSON.stringify(f.request));
  }
});
