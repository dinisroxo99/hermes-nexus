import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import fs, { readFileSync, readdirSync } from "node:fs";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { composeEffectiveTaskScope } from "../src/lib/effective-task-scope.js";
import {
  MAX_COMPACT_INPUT, MAX_NESTING, MAX_VISITED_VALUES, checkInputBudget,
  EFFECTIVE_TASK_SCOPE_POLICY_VERSION
} from "../src/lib/effective-task-scope-policy.js";
import { composeEffectiveTaskScopeFromEnvelopes as compose } from "../src/lib/effective-task-scope-adapter.js";
import { produceSymbolTargetCompletenessWitness } from "../src/lib/symbol-target-completeness-witness.js";
import { contextDigest, CONTEXT_SOURCE_LIMITS } from "../src/lib/project-context-files.js";

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
    f => { f.envelopes.symbolTargetCompletenessWitness = { ok: true, data: {} }; f.envelopes.extra = true; },
    f => { f.envelopes.witness = { ok: true, data: {} }; },
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
    f => { f.envelopes.pack = Object.create({ ok: true, data: {} }); },
    // D2 AD-3: unknown or near-miss keys stay refused next to the absence witness (guard).
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: true, data: {} }; f.envelopes.extra = true; },
    f => {
      f.envelopes.symbolTargetCompletenessWitness = { ok: true, data: {} };
      f.envelopes.createDestinationAbsenceWitness = { ok: true, data: {} }; f.envelopes.extra = true;
    },
    f => { f.envelopes.CreateDestinationAbsenceWitness = { ok: true, data: {} }; },
    f => { f.envelopes.createDestinationAbsenceWitnesses = { ok: true, data: {} }; },
    // D2 AD-4: malformed absence-witness envelopes refuse (guard; positive control D2 AD-1).
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: false, data: {} }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { data: {} }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: true }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: true, data: null }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: true, data: [] }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { kind: "labelled-synthetic" }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: true, data: {}, message: 5 }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: true, data: {}, extra: true }; },
    f => { f.envelopes.createDestinationAbsenceWitness = { ok: true, data: { ok: true, data: {} } }; }
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
        const allowedConsumer = new URL("src/routes/effective-task-scope.routes.js", root);
        if (url.href !== allowedConsumer.href) {
          assert.doesNotMatch(readFileSync(url, "utf8"), /effective-task-scope-adapter|composeEffectiveTaskScopeFromEnvelopes/);
        }
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


// --- C1: optional symbolTargetCompletenessWitness envelope pass-through ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ETS_PATH = "src/lib/effective-task-scope.js";
const PROJECT_ID = "prj_ea78bb13-81d1-4918-89c6-ab7818f59dcd";
const REPOSITORY_ID = "1e344d31e3e4df63e4c358825c9219919b1555af994e7059781283fe22a46529";
const WORKTREE_ID = "09e9e2a478a8fe66f26800de93399d31d0277ff3660486ef5261c2b4cd5a0b9d";
const COMMIT_SHA = "618718247352fa6ae5e2a530c209845ef43e7378";
const BRANCH = "feat/step4-slice1-ets-v2";
const ROOT_ID = "local";
const RELATIVE_PATH = "hermes-nexus-step4-slice1-write";
const ADMITTED_COMMIT = "4741b82ce4dcc46451a82a1f1100d83a7693ffb6";

function adapterCollection(files, { truncated = false } = {}) {
  const list = Array.isArray(files) ? files : [];
  return {
    limits: {
      maxDepth: CONTEXT_SOURCE_LIMITS.maxDepth,
      maxEntries: CONTEXT_SOURCE_LIMITS.maxEntries,
      maxFiles: CONTEXT_SOURCE_LIMITS.maxFiles,
      maxFileBytes: CONTEXT_SOURCE_LIMITS.maxFileBytes,
      maxTotalBytes: CONTEXT_SOURCE_LIMITS.maxTotalBytes
    },
    truncated: truncated === true,
    diagnostics: [],
    digest: contextDigest(JSON.stringify(list.map((f) => [f.path, f.sha256])))
  };
}

function buildLiveBinding(fileContents, taskPaths) {
  const revision = {
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    status: "available",
    commitSha: COMMIT_SHA,
    branch: BRANCH,
    dirty: false,
    isLinkedWorktree: true
  };
  const ordered = taskPaths.map((path) => ({ path, text: fileContents[path] }));
  const produced = createProviderSnapshot({ projectId: PROJECT_ID }, ordered, revision);
  const files = produced.files.map((f) => ({
    path: f.path,
    text: f.text,
    byteSize: f.byteSize,
    sha256: f.sha256
  }));
  return {
    revision,
    sourceHashes: Object.fromEntries(files.map((f) => [f.path, f.sha256])),
    snapshotToken: produced.token
  };
}

/** Produce witness OUTSIDE adapter (producer+A1); adapter only forwards data. */
function produceBoundWitnessOutsideAdapter() {
  const etsText = readFileSync(join(ROOT, ETS_PATH), "utf8");
  const fileContents = { [ETS_PATH]: etsText };
  const taskPaths = [ETS_PATH];
  const live = buildLiveBinding(fileContents, taskPaths);
  const witness = produceSymbolTargetCompletenessWitness({
    taskPaths,
    requiredNames: ["composeEffectiveTaskScope"],
    projectId: PROJECT_ID,
    repositoryId: REPOSITORY_ID,
    worktreeId: WORKTREE_ID,
    snapshotToken: live.snapshotToken,
    sourceHashes: live.sourceHashes,
    admittedCommit: ADMITTED_COMMIT,
    fileContents,
    revision: live.revision,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    taskId: "task_ets_adapter_witness_passthrough"
  });
  return { witness, snapshotToken: live.snapshotToken, sourceHashes: live.sourceHashes };
}

function buildSymbolPackImpact({ symbols, snapshotToken, sourceHashes }) {
  const sortedPaths = [ETS_PATH];
  const sortedSymbols = [...new Set(symbols)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const request = {
    task: {
      id: "t_adapter_witness",
      title: "Adapter witness passthrough",
      paths: sortedPaths,
      symbols: sortedSymbols
    },
    projectId: PROJECT_ID,
    worktree: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    expectedRevision: {
      status: "available",
      commitSha: COMMIT_SHA,
      branch: BRANCH,
      dirty: false,
      isLinkedWorktree: true,
      repositoryId: REPOSITORY_ID,
      worktreeId: WORKTREE_ID
    },
    includeTests: false
  };
  const fileItems = sourceHashes
    ? sortedPaths.map((p) => ({
      path: p,
      provenance: {
        trust: "canonical_fact",
        reason: "task_path",
        source: { path: p, sha256: sourceHashes[p] }
      }
    }))
    : [];
  const pack = {
    schemaVersion: 1,
    analysisVersion: "task-context-v1",
    contextPackId: "context_adapter_witness_pack_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    projectId: PROJECT_ID,
    project: { name: "hermes-project-map", rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    revision: {
      status: "available",
      commitSha: COMMIT_SHA,
      branch: BRANCH,
      dirty: false,
      repositoryIdentity: REPOSITORY_ID,
      worktreeId: WORKTREE_ID,
      isLinkedWorktree: true
    },
    analysis: {
      schemaVersion: 1,
      status: "partial",
      snapshotToken,
      provider: { id: "native.typescript", version: "1" }
    },
    observation: {
      basis: "working_tree",
      incomplete: true,
      sourceDigest: "fd20451a9bd4547d01377c4afe1d75127659212703e2a903f75f839250cb8850"
    },
    sections: {
      task: {
        items: [{
          id: request.task.id,
          title: request.task.title,
          paths: sortedPaths,
          symbols: sortedSymbols
        }],
        status: "available"
      },
      workspaces: { items: [], status: "empty" },
      documents: { items: [], status: "empty" },
      constraints: { items: [], status: "empty" },
      files: sourceHashes
        ? { items: fileItems, status: "available" }
        : { items: [], status: "empty" },
      symbols: { items: [], status: "partial" },
      references: { items: [], status: "partial" },
      tests: { items: [], status: "empty" },
      diagnostics: { items: [], status: "available" },
      policy: { items: [], status: "available" }
    },
    limits: { maxBytes: 65536 }
  };
  const impact = {
    schemaVersion: 1,
    analysisVersion: "impact-v2",
    projectId: PROJECT_ID,
    project: { rootId: ROOT_ID, relativePath: RELATIVE_PATH },
    targets: sortedPaths.map((p) => ({
      originPath: p,
      targetSource: { path: p, hash: sourceHashes[p] },
      status: "partial",
      findingState: "evidence_found",
      completeness: { source: ["source_limit"], provider: ["provider_partial"] }
    })),
    revision: {
      status: "available",
      commitSha: COMMIT_SHA,
      branch: BRANCH,
      repositoryId: REPOSITORY_ID,
      worktreeId: WORKTREE_ID,
      dirty: false,
      isLinkedWorktree: true
    },
    snapshotToken,
    provider: { id: "native.typescript", version: "1" },
    coverage: { observed: ["javascript"], covered: ["javascript"], uncovered: [] },
    observation: { basis: "working_tree", incomplete: true },
    limits: { depth: 2, affectedFiles: 80, compactBytes: 65536 },
    status: "partial",
    findingState: "evidence_found",
    affectedFiles: [],
    affectedTests: {
      status: "not_requested",
      findingState: "not_requested",
      candidates: []
    },
    completeness: { source: ["source_limit"], provider: ["provider_partial"], traversal: [], output: [] }
  };
  return { request, pack, impact };
}

test("adapter C1: witness envelope parity with direct compose lift path", () => {
  const { witness, snapshotToken, sourceHashes } = produceBoundWitnessOutsideAdapter();
  assert.equal(witness.completenessHolds, true);
  assert.equal(witness.uniquenessHolds, true);
  const { request, pack, impact } = buildSymbolPackImpact({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes
  });
  const envelopes = {
    pack: { ok: true, data: pack },
    impact: { ok: true, data: impact },
    symbolTargetCompletenessWitness: { ok: true, data: witness }
  };
  const direct = composeEffectiveTaskScope(request, {
    pack,
    impact,
    symbolTargetCompletenessWitness: witness
  });
  const viaAdapter = compose(request, envelopes);
  assert.equal(JSON.stringify(viaAdapter), JSON.stringify(direct));
  assert.ok(viaAdapter.status === "incomplete" || viaAdapter.status === "available");
  assert.ok(viaAdapter.write);
  assert.ok(!viaAdapter.reasons.some((r) => String(r.code || "").startsWith("symbol_target_")));
  assert.equal(viaAdapter.policyVersion, "step4-foundation-4");
  assert.equal(EFFECTIVE_TASK_SCOPE_POLICY_VERSION, "step4-foundation-4");

  state.calls = 0;
  const counted = countedCompose(request, envelopes);
  assert.equal(state.calls, 1);
  assert.equal(JSON.stringify(counted), JSON.stringify(direct));
  assert.equal(
    JSON.stringify(state.args[1]),
    JSON.stringify({ pack, impact, symbolTargetCompletenessWitness: witness })
  );
});

test("adapter C1: missing witness + symbols nonempty matches direct compose refuse", () => {
  const { witness, snapshotToken, sourceHashes } = produceBoundWitnessOutsideAdapter();
  const { request, pack, impact } = buildSymbolPackImpact({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes
  });
  const envelopes = {
    pack: { ok: true, data: pack },
    impact: { ok: true, data: impact }
  };
  const direct = composeEffectiveTaskScope(request, { pack, impact });
  const viaAdapter = compose(request, envelopes);
  assert.equal(JSON.stringify(viaAdapter), JSON.stringify(direct));
  assert.equal(viaAdapter.status, "not_evaluated");
  assert.ok(viaAdapter.reasons.some((r) => r.code === "symbol_target_evidence_missing"));
  assert.ok(!("write" in viaAdapter));
  // witness unused — ensure we did not invent it
  assert.equal(witness.completenessHolds, true);
});

test("adapter C1: malformed witness envelope refuses invalid_effective_task_scope_envelope", () => {
  const { witness, snapshotToken, sourceHashes } = produceBoundWitnessOutsideAdapter();
  const { request, pack, impact } = buildSymbolPackImpact({
    symbols: ["composeEffectiveTaskScope"],
    snapshotToken,
    sourceHashes
  });
  const base = () => ({
    pack: { ok: true, data: pack },
    impact: { ok: true, data: impact },
    symbolTargetCompletenessWitness: { ok: true, data: witness }
  });
  const cases = [
    env => { env.symbolTargetCompletenessWitness.ok = false; },
    env => { delete env.symbolTargetCompletenessWitness.ok; },
    env => { delete env.symbolTargetCompletenessWitness.data; },
    env => { env.symbolTargetCompletenessWitness.data = null; },
    env => { env.symbolTargetCompletenessWitness.data = []; },
    env => { env.symbolTargetCompletenessWitness = witness; },
    env => { env.symbolTargetCompletenessWitness.message = 5; },
    env => { env.symbolTargetCompletenessWitness.extra = true; },
    env => { env.symbolTargetCompletenessWitness.data = { ok: true, data: witness }; }
  ];
  for (const change of cases) {
    const envelopes = base();
    change(envelopes);
    refused(request, envelopes);
  }
});

test("adapter C1: empty symbols regression unchanged with and without witness key", () => {
  const f = fixture();
  assert.deepEqual(f.request.task.symbols, []);
  const without = parity(f, "incomplete");
  assert.ok(without.write);
  assert.ok(!without.reasons.some((r) => String(r.code || "").includes("symbol_target")));

  // Optional witness present with empty symbols must not break empty-symbols path
  const { witness } = produceBoundWitnessOutsideAdapter();
  const withWitness = structuredClone(f);
  withWitness.envelopes.symbolTargetCompletenessWitness = { ok: true, data: witness };
  const direct = composeEffectiveTaskScope(withWitness.request, {
    pack: withWitness.envelopes.pack.data,
    impact: withWitness.envelopes.impact.data,
    symbolTargetCompletenessWitness: witness
  });
  const viaAdapter = compose(withWitness.request, withWitness.envelopes);
  assert.equal(JSON.stringify(viaAdapter), JSON.stringify(direct));
  assert.ok(viaAdapter.status === "incomplete" || viaAdapter.status === "available");
  assert.deepEqual(viaAdapter.task.symbols, []);
});

test("adapter C1: module stays free of producer/A1/FS/HTTP imports", () => {
  const source = readFileSync(new URL("../src/lib/effective-task-scope-adapter.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /produceSymbolTargetCompletenessWitness|symbol-target-completeness-witness/);
  assert.doesNotMatch(source, /resolveTypeScriptDeclarationEvidence|resolveTrackA1|track-a-symbol/);
  assert.doesNotMatch(source, /\b(?:fetch|readFileSync|writeFileSync|axios|http)\b/);
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(imports, ["./effective-task-scope-policy.js", "./effective-task-scope.js"]);
});


// --- D2: optional createDestinationAbsenceWitness envelope (contract r3.4 D2 / A5; Architect D2 pins) ---
// Labelled synthetic absence-witness data only: the adapter validates the envelope, never the witness
// content. No D0/D1 module is imported (Pin D2-T1). Version checks compare with the imported
// EFFECTIVE_TASK_SCOPE_POLICY_VERSION (Pin D2-V1).
import * as policyModule from "../src/lib/effective-task-scope-policy.js";
import { createHash } from "node:crypto";

const ABSENCE_KEY = "createDestinationAbsenceWitness";
const SYMBOL_KEY = "symbolTargetCompletenessWitness";
const syntheticAbsence = (extra = {}) => ({ kind: "labelled-synthetic-absence-witness", note: "not produced, not authenticated", targets: [], ...extra });
const sibling = (...args) => policyModule.checkCreateAbsenceInputBudget(...args);
const assertSiblingExported = () => assert.equal(typeof policyModule.checkCreateAbsenceInputBudget, "function", "checkCreateAbsenceInputBudget is exported");
const throwsBudget = fn => assert.throws(fn, error => { assert.equal(error.code, "scope_budget_exceeded"); return true; });

// A second instrumented adapter instance whose policy import records both budget functions (AD-6, AD-7).
const budget = globalThis[Symbol.for("effective-task-scope-adapter.test.budget")] = { inputBudget: [], sibling: [] };
const canonicalPolicyUrl = new URL("../src/lib/effective-task-scope-policy.js", import.meta.url).href;
const budgetHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./effective-task-scope-policy.js" && context.parentURL?.endsWith("?budget")) {
      const source = `import * as real from ${JSON.stringify(canonicalPolicyUrl)};
        export * from ${JSON.stringify(canonicalPolicyUrl)};
        const s = () => globalThis[Symbol.for("effective-task-scope-adapter.test.budget")];
        export function checkInputBudget(...args) { s().inputBudget.push(args); return real.checkInputBudget(...args); }
        export function checkCreateAbsenceInputBudget(...args) { s().sibling.push(args); return real.checkCreateAbsenceInputBudget(...args); }`;
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
let budgetCompose;
try {
  ({ composeEffectiveTaskScopeFromEnvelopes: budgetCompose } = await import("../src/lib/effective-task-scope-adapter.js?budget"));
} finally {
  budgetHook.deregister();
}
function budgetRoute(request, envelopes) {
  budget.inputBudget = []; budget.sibling = [];
  const result = budgetCompose(request, envelopes);
  assert.equal(JSON.stringify(result), JSON.stringify(compose(request, envelopes)));
  return { inputBudget: budget.inputBudget, sibling: budget.sibling };
}

test("D2 AD-1: pack + impact + absence witness is forwarded unchanged (one call, direct-compose parity)", () => {
  const f = fixture(); const data = syntheticAbsence();
  f.envelopes[ABSENCE_KEY] = { ok: true, data };
  state.calls = 0;
  const result = countedCompose(f.request, f.envelopes);
  assert.equal(state.calls, 1);
  const evidence = { pack: f.envelopes.pack.data, impact: f.envelopes.impact.data, createDestinationAbsenceWitness: data };
  assert.equal(JSON.stringify(state.args[1]), JSON.stringify(evidence));
  assert.equal(JSON.stringify(result), JSON.stringify(composeEffectiveTaskScope(f.request, evidence)));
  assert.equal(result.policyVersion, EFFECTIVE_TASK_SCOPE_POLICY_VERSION);
});

test("D2 AD-2: pack + impact + both witnesses are forwarded in key order; the symbol lift is unchanged", () => {
  const { witness, snapshotToken, sourceHashes } = produceBoundWitnessOutsideAdapter();
  const { request, pack, impact } = buildSymbolPackImpact({ symbols: ["composeEffectiveTaskScope"], snapshotToken, sourceHashes });
  const absence = syntheticAbsence();
  const envelopes = { pack: { ok: true, data: pack }, impact: { ok: true, data: impact },
    [SYMBOL_KEY]: { ok: true, data: witness }, [ABSENCE_KEY]: { ok: true, data: absence } };
  state.calls = 0;
  const viaAdapter = countedCompose(request, envelopes);
  assert.equal(state.calls, 1);
  assert.deepEqual(Object.keys(state.args[1]), ["pack", "impact", SYMBOL_KEY, ABSENCE_KEY]);
  const evidence = { pack, impact, symbolTargetCompletenessWitness: witness, createDestinationAbsenceWitness: absence };
  assert.equal(JSON.stringify(state.args[1]), JSON.stringify(evidence));
  assert.equal(JSON.stringify(viaAdapter), JSON.stringify(composeEffectiveTaskScope(request, evidence)));
  assert.ok(viaAdapter.write);
  assert.ok(!viaAdapter.reasons.some((r) => String(r.code || "").startsWith("symbol_target_")));
  assert.equal(viaAdapter.policyVersion, EFFECTIVE_TASK_SCOPE_POLICY_VERSION);
});

test("D2 AD-5: an absence witness that takes the total over 327680 is scope_budget_exceeded (adapter and sibling)", () => {
  const f = minimal(); const pack = f.envelopes.pack.data; const impact = f.envelopes.impact.data;
  pack.padding = "p".repeat(120000); impact.padding = "i".repeat(120000);
  const absence = { padding: "a".repeat(100000) };
  assert.ok(bytes(pack) <= 131072 && bytes(impact) <= 131072);
  assert.ok(bytes({ request: f.request, pack, impact, createDestinationAbsenceWitness: absence }) > MAX_COMPACT_INPUT);
  checkInputBudget(f.request, pack, impact);
  f.envelopes[ABSENCE_KEY] = { ok: true, data: absence };
  refused(f.request, f.envelopes, "scope_budget_exceeded");
  assertSiblingExported();
  throwsBudget(() => sibling(f.request, pack, impact, undefined, absence));
});

test("D2 AD-5b: symbol and absence witnesses that each fit alone but together exceed 327680 are refused", () => {
  const { request, envelopes: { pack: { data: pack }, impact: { data: impact } } } = minimal();
  const symbol = { padding: "s".repeat(200000) }; const absence = { padding: "a".repeat(200000) };
  checkInputBudget(request, pack, impact, symbol);
  assertSiblingExported();
  sibling(request, pack, impact, undefined, absence);
  const wrap = data => ({ ok: true, data });
  state.calls = 0; countedCompose(request, { pack: wrap(pack), impact: wrap(impact), [SYMBOL_KEY]: wrap(symbol) }); assert.equal(state.calls, 1);
  state.calls = 0; countedCompose(request, { pack: wrap(pack), impact: wrap(impact), [ABSENCE_KEY]: wrap(absence) }); assert.equal(state.calls, 1);
  refused(request, { pack: wrap(pack), impact: wrap(impact), [SYMBOL_KEY]: wrap(symbol), [ABSENCE_KEY]: wrap(absence) }, "scope_budget_exceeded");
  throwsBudget(() => sibling(request, pack, impact, symbol, absence));
});

test("D2 AD-6: without the absence key checkInputBudget runs once (3 args) and the sibling never; with it, only the sibling", () => {
  assertSiblingExported();
  const f = fixture();
  const plain = budgetRoute(f.request, f.envelopes);
  assert.deepEqual(plain.inputBudget.map(args => args.length), [3]);
  assert.equal(plain.sibling.length, 0);
  const absence = syntheticAbsence(); f.envelopes[ABSENCE_KEY] = { ok: true, data: absence };
  const routed = budgetRoute(f.request, f.envelopes);
  assert.equal(routed.inputBudget.length, 0);
  assert.deepEqual(routed.sibling.map(args => args.length), [5]);
  assert.equal(routed.sibling[0][3], undefined);
  assert.equal(JSON.stringify(routed.sibling[0][4]), JSON.stringify(absence));
});

test("D2 AD-7: symbol witness only keeps checkInputBudget (4 args); symbol + absence routes both to the sibling", () => {
  assertSiblingExported();
  const { witness } = produceBoundWitnessOutsideAdapter();
  const f = fixture(); f.envelopes[SYMBOL_KEY] = { ok: true, data: witness };
  const symbolOnly = budgetRoute(f.request, f.envelopes);
  assert.deepEqual(symbolOnly.inputBudget.map(args => args.length), [4]);
  assert.equal(JSON.stringify(symbolOnly.inputBudget[0][3]), JSON.stringify(witness));
  assert.equal(symbolOnly.sibling.length, 0);
  const absence = syntheticAbsence(); f.envelopes[ABSENCE_KEY] = { ok: true, data: absence };
  const both = budgetRoute(f.request, f.envelopes);
  assert.equal(both.inputBudget.length, 0);
  assert.deepEqual(both.sibling.map(args => args.length), [5]);
  assert.equal(JSON.stringify(both.sibling[0][3]), JSON.stringify(witness));
  assert.equal(JSON.stringify(both.sibling[0][4]), JSON.stringify(absence));
});

// Synthetic create fixture (copy of tests/effective-task-scope-create.test.js fixture(), envelope form).
function createFixture(paths = ["src/a.js", "src/z.js"]) {
  const revision = { status: "available", commitSha: "a".repeat(40), branch: "fixture",
    dirty: false, isLinkedWorktree: true, repositoryId: "b".repeat(64), worktreeId: "c".repeat(64) };
  const provider = { id: "native.typescript", version: "1" };
  const coverage = { observed: ["javascript", "python"], covered: ["javascript"], uncovered: ["python"] };
  const completeness = { source: ["source_limit"], provider: ["provider_partial", "uncovered_language"], traversal: ["depth_limit"], output: ["origin_limit"] };
  const task = { id: "create-fixture", title: "Create fixture", paths, symbols: [] };
  const project = { rootId: "fixture", relativePath: "fixture" };
  const provenance = { projectId: "prj_fixture", revisionRef: "revision", trust: "untrusted_repository_text", producer: "context-source-observation" };
  const section = (items, limit, status = "available") => ({ items, limit, status, truncated: false, provenance });
  const request = { task, projectId: "prj_fixture", worktree: project, expectedRevision: revision,
    includeTests: true, changeSemantics: { category: "local_implementation" },
    operationIntent: { kind: "create", targets: paths.map(newPath => ({ oldPath: null, newPath })) } };
  const pack = { schemaVersion: 1, analysisVersion: "task-context-v1", contextPackId: "fixture", projectId: "prj_fixture", project,
    revision: { ...revision, repositoryIdentity: revision.repositoryId },
    analysis: { status: "partial", snapshotToken: "snapshot", provider, coverage },
    observation: { incomplete: true, digestCoverage: "bounded_collected_sources", sourceDigest: "d".repeat(64) },
    sections: { task: section([task], 1), files: section(paths.map(path => ({ path,
      provenance: { trust: "canonical_fact", reason: "task_path", source: { path, sha256: "e".repeat(64) } } })), 32),
    symbols: section([], 0, "not_analyzed") } };
  const witness = { id: "edge", provider, capability: "dependencies", relationshipKind: "imports",
    source: { path: "src/far.js", hash: "f".repeat(64) }, location: null, trust: "derived_analysis", basis: "structural" };
  const affected = { path: "src/far.js", origins: [{ originPath: paths[0], minimumDistance: 5, witness }],
    originSummary: { discoveredOriginCount: 1, retainedOriginWitnessCount: 1, attributionTruncated: false, reasons: [] } };
  const impact = { schemaVersion: 1, analysisVersion: "impact-v2", projectId: "prj_fixture", project, revision,
    snapshotToken: "snapshot", provider, coverage, observation: { incomplete: true, digestCoverage: "bounded_collected_sources" },
    targets: paths.map(originPath => ({ originPath, targetSource: { path: originPath, hash: "e".repeat(64) },
      status: "partial", findingState: "no_evidence_found", completeness })),
    status: "partial", findingState: "evidence_found", affectedFiles: [affected],
    affectedTests: { status: "partial", findingState: "no_evidence_found", candidates: [], completeness }, completeness };
  return JSON.parse(JSON.stringify({ request, envelopes: { pack: { ok: true, data: pack }, impact: { ok: true, data: impact } } }));
}
function createUnobserve(f, path) {
  const pack = f.envelopes.pack.data; const impact = f.envelopes.impact.data;
  pack.sections.files.items = pack.sections.files.items.filter(item => item.path !== path);
  for (const target of impact.targets) if (target.originPath === path) target.targetSource = null;
  return f;
}
function createCleanFlags(f) {
  const clean = { source: [], provider: [], traversal: [], output: [] };
  const pack = f.envelopes.pack.data; const impact = f.envelopes.impact.data;
  pack.observation.incomplete = false; pack.analysis.status = "available";
  pack.analysis.coverage = impact.coverage = { observed: ["javascript"], covered: ["javascript"], uncovered: [] };
  impact.observation.incomplete = false; impact.status = "available"; impact.completeness = clean;
  impact.affectedTests = { status: "available", findingState: "no_evidence_found", candidates: [], completeness: clean };
  for (const target of impact.targets) { target.status = "available"; target.completeness = clean; }
  return f;
}
// Copy of the deletion fixture of "adapter: deletion intent byte parity …" above.
function d2DeletionFixture() {
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

test("D2 N1 (foundation-4 interim; replaced by C-4/C-5 in D3): the absence witness is neutral; create stays refused", () => {
  const cases = [
    ["create: destination observed", createFixture, "create_destination_exists"],
    ["create: unobserved", () => createUnobserve(createFixture(["src/new.js"]), "src/new.js"), "create_destination_absence_not_proven"],
    ["create: unobserved + clean flags", () => createUnobserve(createCleanFlags(createFixture(["src/new.js"])), "src/new.js"), "create_destination_absence_not_proven"],
    ["create: unobserved + Impact not_evaluated", () => {
      const f = createUnobserve(createFixture(["src/new.js"]), "src/new.js"); f.envelopes.impact.data.findingState = "not_evaluated"; return f;
    }, "impact_not_evaluated"],
    ["read", fixture, null],
    ["delete", d2DeletionFixture, null]
  ];
  for (const [name, build, code] of cases) {
    const without = build(); const withAbsence = build();
    withAbsence.envelopes[ABSENCE_KEY] = { ok: true, data: syntheticAbsence({ verdicts: "all absent, complete (synthetic)" }) };
    const expected = compose(without.request, without.envelopes);
    state.calls = 0;
    const actual = countedCompose(withAbsence.request, withAbsence.envelopes);
    assert.equal(state.calls, 1, name);
    assert.equal(JSON.stringify(actual), JSON.stringify(expected), name);
    if (code) {
      assert.equal(actual.status, "not_evaluated", name);
      assert.ok(actual.reasons.some(reason => reason.code === code), `${name}: ${JSON.stringify(actual.reasons)}`);
      assert.equal(Object.hasOwn(actual, "write"), false, name);
      assert.equal(Object.hasOwn(actual, "operationIntent"), false, name);
    }
  }
});

test("D2 N2: with the absence key the 131072 pack/impact caps fire first through the adapter", () => {
  for (const key of ["pack", "impact"]) {
    const f = minimal(); f.envelopes[ABSENCE_KEY] = { ok: true, data: syntheticAbsence() };
    f.envelopes[key].data.padding = "";
    f.envelopes[key].data.padding = "x".repeat(131072 - bytes(f.envelopes[key].data));
    assert.equal(bytes(f.envelopes[key].data), 131072);
    state.calls = 0; countedCompose(f.request, f.envelopes); assert.equal(state.calls, 1);
    f.envelopes[key].data.padding += "x";
    assert.ok(bytes(f) < MAX_COMPACT_INPUT);
    refused(f.request, f.envelopes, "scope_budget_exceeded");
  }
});

test("D2 N3: no 49152 witness sub-cap is re-checked (N32-1): 49153-byte and 200000-byte absence data reach compose", () => {
  for (const size of [49153, 200000]) {
    const f = fixture(); const absence = syntheticAbsence({ padding: "" });
    absence.padding = "a".repeat(size - bytes(absence));
    assert.equal(bytes(absence), size);
    f.envelopes[ABSENCE_KEY] = { ok: true, data: absence };
    state.calls = 0;
    const result = countedCompose(f.request, f.envelopes);
    assert.equal(state.calls, 1);
    const evidence = { pack: f.envelopes.pack.data, impact: f.envelopes.impact.data, createDestinationAbsenceWitness: absence };
    assert.equal(JSON.stringify(result), JSON.stringify(composeEffectiveTaskScope(f.request, evidence)));
    assertSiblingExported();
    sibling(f.request, evidence.pack, evidence.impact, undefined, absence);
  }
});

test("D2 N4: direct sibling boundaries: total, pack/impact caps, values, nesting, symbol key only when defined", () => {
  assertSiblingExported();
  const request = {}; const pack = {}; const impact = {};
  const absence = { padding: "" };
  absence.padding = "a".repeat(MAX_COMPACT_INPUT - bytes({ request, pack, impact, createDestinationAbsenceWitness: absence }));
  assert.equal(bytes({ request, pack, impact, createDestinationAbsenceWitness: absence }), MAX_COMPACT_INPUT);
  sibling(request, pack, impact, undefined, absence);
  throwsBudget(() => sibling(request, pack, impact, {}, absence));
  absence.padding += "a";
  throwsBudget(() => sibling(request, pack, impact, undefined, absence));
  const symbol = {}; const withSymbol = { padding: "" };
  withSymbol.padding = "a".repeat(MAX_COMPACT_INPUT - bytes({ request, pack, impact, symbolTargetCompletenessWitness: symbol, createDestinationAbsenceWitness: withSymbol }));
  sibling(request, pack, impact, symbol, withSymbol);
  withSymbol.padding += "a";
  throwsBudget(() => sibling(request, pack, impact, symbol, withSymbol));
  for (const which of ["pack", "impact"]) {
    const data = { padding: "" }; data.padding = "x".repeat(131072 - bytes(data));
    const args = () => (which === "pack" ? [request, data, impact, undefined, {}] : [request, pack, data, undefined, {}]);
    sibling(...args());
    data.padding += "x";
    throwsBudget(() => sibling(...args()));
  }
  const many = { padding: [] };
  many.padding = Array(MAX_VISITED_VALUES - values({ request, pack, impact, createDestinationAbsenceWitness: many })).fill(0);
  assert.equal(values({ request, pack, impact, createDestinationAbsenceWitness: many }), MAX_VISITED_VALUES);
  sibling(request, pack, impact, undefined, many);
  many.padding.push(0);
  throwsBudget(() => sibling(request, pack, impact, undefined, many));
  // Root object = depth 0, absence witness = depth 1.
  const deep = {}; let cursor = deep;
  for (let depth = 2; depth <= MAX_NESTING; depth++) cursor = cursor.next = {};
  sibling(request, pack, impact, undefined, deep);
  cursor.next = {};
  throwsBudget(() => sibling(request, pack, impact, undefined, deep));
  // S-7: an undefined fifth argument fails closed through materialize, never a silent checkInputBudget fallback.
  assert.throws(() => sibling(request, pack, impact, undefined, undefined), error => error.code === "invalid_record");
});

test("D2 N5 (guard): adapter imports and D0/D1 independence; checkInputBudget source byte-identical (S-4)", () => {
  const source = readFileSync(new URL("../src/lib/effective-task-scope-adapter.js", import.meta.url), "utf8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]).sort();
  assert.deepEqual(imports, ["./effective-task-scope-policy.js", "./effective-task-scope.js"]);
  assert.doesNotMatch(source, /create-destination-absence-witness|buildCreateDestinationAbsenceWitness|create-name-key|context-path-secret-policy/);
  assert.equal(createHash("sha256").update(checkInputBudget.toString()).digest("hex"),
    "420c4498425bd384bfec0aa3ee8cf0d1435865b455133e85918565f0b8165285");
});

test("D2 N5(c): the sibling has no witness sub-cap (no 49152, no maxWitnessBytes) and does not call checkInputBudget", () => {
  assertSiblingExported();
  const source = policyModule.checkCreateAbsenceInputBudget.toString();
  assert.doesNotMatch(source, /49152|maxWitnessBytes/);
  assert.doesNotMatch(source, /checkInputBudget\s*\(/);
});

test("D2 N6: 32-subset key matrix: accepted iff pack and impact are present and no extra key", () => {
  const names = ["pack", "impact", SYMBOL_KEY, ABSENCE_KEY, "extra"];
  const mismatches = [];
  for (let mask = 0; mask < 32; mask++) {
    const envelopes = {};
    names.forEach((name, i) => { if (mask & (1 << i)) envelopes[name] = { ok: true, data: {} }; });
    const expected = Object.hasOwn(envelopes, "pack") && Object.hasOwn(envelopes, "impact") && !Object.hasOwn(envelopes, "extra");
    state.calls = 0;
    let code = null;
    try { countedCompose({}, envelopes); } catch (error) { code = error.code; }
    const accepted = state.calls === 1 && code === null;
    const refusedCleanly = state.calls === 0 && code === "invalid_effective_task_scope_envelope";
    if (expected ? !accepted : !refusedCleanly) mismatches.push(Object.keys(envelopes).join("+") || "(none)");
  }
  assert.deepEqual(mismatches, []);
});
