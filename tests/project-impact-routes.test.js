import http from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";

import { createProjectImpactHandler } from "../src/routes/project-impact.routes.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";
import { analyzeContextSources } from "../src/lib/analyzer-service.js";
import { collectContextSources } from "../src/lib/project-context-files.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { createRouter } from "../src/utils/router.js";
import { taskContextFixture } from "./helpers/task-context-fixture.js";

const SUCCESS_LIMIT = 163840;
const FIXED_MESSAGE = "Project impact constructed.";
const ERROR_MESSAGE = "Project impact could not be constructed safely.";

function responseRecorder() {
  return {
    writes: [],
    headCalls: 0,
    writeCalls: 0,
    endCalls: 0,
    destroyCalls: 0,
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.headCalls += 1;
      this.writes.push({ type: "head", status, headers });
      this.status = status;
      this.headers = headers;
    },
    write() {
      this.writeCalls += 1;
      throw new Error("project impact responses must not stream");
    },
    end(body) {
      this.endCalls += 1;
      this.writes.push({ type: "end", body });
      this.body = body;
    },
    destroy() {
      this.destroyCalls += 1;
    }
  };
}

function requestFrom(chunks) {
  const req = Readable.from(Array.isArray(chunks) ? chunks : [chunks]);
  req.method = "POST";
  req.url = "/api/intelligence/projects/PrJ_Impact/impact";
  req.headers = { host: "localhost", "content-type": "application/json" };
  return req;
}

function dependencies(extra = {}) {
  return {
    getProjectConfig: () => ({ dataDir: "/registry" }),
    getConfiguredProjectRoots: () => [{ id: "default", path: "/projects" }],
    buildProjectImpact: (projectId, input) => ({ projectId, input }),
    ...extra
  };
}

async function invoke(body, extra = {}, id = "PrJ_Impact") {
  const req = requestFrom(typeof body === "string" || Buffer.isBuffer(body) || Array.isArray(body) ? body : JSON.stringify(body));
  const res = responseRecorder();
  await createProjectImpactHandler(dependencies(extra))(req, res, { projectId: id });
  return { req, res, payload: JSON.parse(Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.body) };
}

function successBody(data) {
  return JSON.stringify({ ok: true, data, message: FIXED_MESSAGE });
}

function syntheticDataAtEnvelopeBytes(bytes, fill = "x") {
  const emptyBytes = Buffer.byteLength(successBody(""), "utf8");
  const count = bytes - emptyBytes;
  assert.ok(count >= 0);
  const data = fill.repeat(count);
  assert.equal(Buffer.byteLength(successBody(data), "utf8"), bytes);
  return data;
}

function syntheticObjectAtEnvelopeBytes(bytes) {
  const base = { padding: "" };
  const count = bytes - Buffer.byteLength(successBody(base), "utf8");
  const data = Object.freeze({ padding: "x".repeat(count) });
  assert.equal(Buffer.byteLength(successBody(data), "utf8"), bytes);
  return data;
}

function escapedSyntheticObjectAtEnvelopeBytes(bytes) {
  const data = { marker: "café\"\\\n\u0000", padding: "" };
  const count = bytes - Buffer.byteLength(successBody(data), "utf8");
  assert.ok(count >= 0);
  data.padding = "x".repeat(count);
  assert.equal(Buffer.byteLength(successBody(data), "utf8"), bytes);
  return Object.freeze(data);
}

test("project impact handler validates route identity before consuming or configuring the request", async () => {
  let configCalls = 0;
  let buildCalls = 0;
  const req = requestFrom("{" + "x".repeat(70000));
  const res = responseRecorder();
  await createProjectImpactHandler(dependencies({
    getProjectConfig: () => { configCalls += 1; return { dataDir: "/registry" }; },
    buildProjectImpact: () => { buildCalls += 1; return {}; }
  }))(req, res, { projectId: "../bad" });
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.body).error, "invalid_project_identity");
  assert.equal(req.readableFlowing, null);
  assert.deepEqual({ configCalls, buildCalls }, { configCalls: 0, buildCalls: 0 });
});

test("project impact handler enforces exact raw request bytes before JSON parsing", async () => {
  const json = JSON.stringify({ paths: ["src/one.ts"] });
  const exact = json + " ".repeat(65536 - Buffer.byteLength(json));
  const accepted = await invoke(exact);
  assert.equal(accepted.res.status, 200);
  assert.deepEqual(accepted.payload.data.input.paths, ["src/one.ts"]);

  const overflow = await invoke(exact + "{");
  assert.equal(overflow.res.status, 413);
  assert.equal(overflow.payload.error, "request_body_too_large");

  const chunked = await invoke([Buffer.alloc(40000, 0x20), Buffer.alloc(25537, 0x20)]);
  assert.equal(chunked.res.status, 413);
  assert.equal(chunked.payload.error, "request_body_too_large");
});

test("project impact handler decodes split UTF-8 once and rejects malformed UTF-8/JSON", async () => {
  const body = Buffer.from(JSON.stringify({ paths: ["src/café.ts"] }), "utf8");
  for (let split = 0; split <= body.length; split += 1) {
    const result = await invoke([body.subarray(0, split), body.subarray(split)]);
    assert.equal(result.res.status, 200, `split ${split}`);
    assert.deepEqual(result.payload.data.input.paths, ["src/café.ts"]);
  }
  for (const invalid of [Buffer.from([0xc3, 0x28]), "{bad", "   "]) {
    const result = await invoke(invalid);
    assert.equal(result.res.status, 400);
    assert.equal(result.payload.error, "invalid_json");
  }
});

test("project impact handler rejects body shape, project identity spoofing, unknown controls, and hostile requests before config/build", async () => {
  const invalidBodies = [
    "",
    null,
    [],
    {},
    { paths: ["src/one.ts"], projectId: "PrJ_Impact" },
    { paths: ["src/one.ts"], graph: {} },
    { paths: ["src/one.ts"], provider: "native" },
    { paths: ["src/one.ts"], analyzer: {} },
    { paths: ["src/one.ts"], image: "forbidden" },
    { paths: ["src/one.ts"], commands: ["run"] },
    { paths: ["src/one.ts"], credentials: "secret" },
    { paths: ["src/one.ts"], maxResponseBytes: 1 },
    { paths: Array(33).fill("src/one.ts") },
    { paths: ["../other.ts"] },
    { paths: ["src/one.ts"], includeTests: "true" },
    { paths: ["src/one.ts"], limits: { compactBytes: 0 } },
    { paths: ["src/one.ts"], worktree: { relativePath: "linked", extra: true } }
  ];
  for (const body of invalidBodies) {
    let configCalls = 0;
    let buildCalls = 0;
    const result = await invoke(body, {
      getProjectConfig: () => { configCalls += 1; return { dataDir: "/registry" }; },
      buildProjectImpact: () => { buildCalls += 1; return {}; }
    });
    assert.equal(result.res.status, 400, JSON.stringify(body));
    assert.equal(result.payload.error, "invalid_impact_request");
    assert.deepEqual({ configCalls, buildCalls }, { configCalls: 0, buildCalls: 0 });
  }
});

test("project impact handler forwards only trusted registry and optional Serena configuration", async () => {
  const image = `sha256:${"a".repeat(64)}`;
  let captured;
  const result = await invoke({ paths: ["src/one.ts"] }, {
    getProjectConfig: () => ({ dataDir: "/trusted/data", serenaPythonImage: image }),
    getConfiguredProjectRoots: () => [{ id: "trusted", path: "/trusted/root" }],
    buildProjectImpact(projectId, input, options) {
      captured = { projectId, input, options };
      return { projectId };
    }
  });
  assert.equal(result.res.status, 200);
  assert.deepEqual(captured, {
    projectId: "PrJ_Impact",
    input: {
      paths: ["src/one.ts"],
      includeTests: false,
      limits: {
        depth: 2,
        affectedFiles: 80,
        affectedTests: 16,
        diagnostics: 20,
        originWitnessesPerItem: 8,
        originWitnessRecords: 256,
        traversalVisitedStates: 2000,
        traversalEdgeExaminations: 16000,
        compactBytes: 65536
      }
    },
    options: {
      registry: {
        roots: [{ id: "trusted", path: "/trusted/root" }],
        manualProjectsFile: "/trusted/data/projects.json",
        discoveredProjectsFile: "/trusted/data/discovered-projects.json"
      },
      analyzer: { serena: { image } }
    }
  });

  let withoutAnalyzer;
  await invoke({ paths: ["src/one.ts"] }, {
    buildProjectImpact(_projectId, _input, options) { withoutAnalyzer = options; return {}; }
  });
  assert.equal(Object.hasOwn(withoutAnalyzer, "analyzer"), false);
});

test("project impact handler emits the exact compact measured success bytes without mutating data", async () => {
  const data = Object.freeze({ path: "src/café\"\\\n.ts", nested: Object.freeze(["é", false]) });
  const before = JSON.stringify(data);
  const { res } = await invoke({ paths: ["src/one.ts"] }, { buildProjectImpact: () => data });
  const expected = Buffer.from(successBody(data), "utf8");
  assert.equal(res.status, 200);
  assert.equal(Buffer.isBuffer(res.body), true);
  assert.deepEqual(res.body, expected);
  assert.equal(res.headers["content-length"], expected.length);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(JSON.stringify(data), before);
  assert.equal(res.writes.length, 2);
});

test("project impact HTTP data equals live accepted single/multi domain results for omitted, false, and true test modes", async (t) => {
  const f = taskContextFixture(t);
  const base = {
    getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots,
    buildProjectImpact
  };
  const requests = [
    { paths: ["src/one.ts"] },
    { paths: ["src/one.ts"], includeTests: false },
    { paths: ["src/one.ts", "tests/one.test.ts"], includeTests: true }
  ];
  const bodies = [];
  for (const request of requests) {
    const result = await invoke(request, base, f.request.projectId);
    assert.equal(result.res.status, 200);
    assert.deepEqual(result.payload.data, buildProjectImpact(f.request.projectId, request, f.options));
    bodies.push(Buffer.from(result.res.body));
  }
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[2].equals(bodies[0]), false);
});

test("project impact HTTP preserves exact real domain bytes at tight and maximum budgets across equivalent requests", async (t) => {
  const f = taskContextFixture(t);
  const base = {
    getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots,
    buildProjectImpact
  };
  for (const compactBytes of [4096, 131072]) {
    const firstRequest = {
      paths: ["tests/one.test.ts", "src/one.ts"],
      includeTests: true,
      limits: { compactBytes }
    };
    const equivalentRequest = {
      limits: { compactBytes },
      includeTests: true,
      paths: ["src/one.ts", "tests/one.test.ts"]
    };
    const expected = buildProjectImpact(f.request.projectId, firstRequest, f.options);
    const domainBytes = Buffer.byteLength(JSON.stringify(expected), "utf8");
    assert.ok(domainBytes <= compactBytes);
    const expectedWire = Buffer.from(successBody(expected), "utf8");
    assert.equal(expectedWire.length, domainBytes + 59);

    const first = await invoke(firstRequest, base, f.request.projectId);
    const repeated = await invoke(firstRequest, base, f.request.projectId);
    const permuted = await invoke(equivalentRequest, base, f.request.projectId);
    for (const response of [first, repeated, permuted]) {
      assert.equal(response.res.status, 200);
      assert.deepEqual(response.res.body, expectedWire);
      assert.equal(response.res.headers["content-length"], expectedWire.length);
      assert.deepEqual({
        head: response.res.headCalls,
        write: response.res.writeCalls,
        end: response.res.endCalls,
        destroy: response.res.destroyCalls
      }, { head: 1, write: 0, end: 1, destroy: 0 });
    }
  }
});

test("project impact loopback serves an actual live-service result byte-for-byte", async (t) => {
  const f = taskContextFixture(t);
  const request = { paths: ["src/one.ts"], includeTests: true, limits: { compactBytes: 4096 } };
  const expected = buildProjectImpact(f.request.projectId, request, f.options);
  const router = createRouter();
  registerIntelligenceRoutes(router, dependencies({
    getProjectConfig: () => ({ dataDir: f.root }),
    getConfiguredProjectRoots: () => f.options.registry.roots,
    buildProjectImpact
  }));
  const server = http.createServer((req, res) => {
    router.dispatch(req, res).then((matched) => {
      if (!matched) { res.writeHead(404); res.end(); }
    }).catch((error) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "internal_error", message: error.message }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/projects/${f.request.projectId}/impact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const expectedWire = Buffer.from(successBody(expected), "utf8");
  assert.equal(response.status, 200);
  assert.deepEqual(bytes, expectedWire);
  assert.equal(Number(response.headers.get("content-length")), expectedWire.length);
  assert.equal(expectedWire.length, Buffer.byteLength(JSON.stringify(expected), "utf8") + 59);
});

test("project impact HTTP maps composed binding, budget, and source-race precedence", async (t) => {
  {
    const f = taskContextFixture(t);
    let collections = 0;
    const result = await invoke({ paths: ["src/one.ts"], limits: { compactBytes: 1 } }, {
      buildProjectImpact(projectId, input) {
        return buildProjectImpact(projectId, input, {
          ...f.options,
          collectSources(project, options) { collections += 1; return collectContextSources(project, options); },
          analyzeSources(project, files, options) {
            return { ...analyzeContextSources(project, files, options), snapshotToken: "wrong-binding" };
          }
        });
      }
    }, f.request.projectId);
    assert.equal(result.res.status, 500);
    assert.equal(result.payload.error, "impact_failed");
    assert.equal(collections, 1);
  }

  {
    const f = taskContextFixture(t);
    const result = await invoke({ paths: ["src/one.ts"], limits: { compactBytes: 1 } }, {
      buildProjectImpact: (projectId, input) => buildProjectImpact(projectId, input, f.options)
    }, f.request.projectId);
    assert.equal(result.res.status, 400);
    assert.equal(result.payload.error, "impact_budget_exceeded");
  }

  {
    const f = taskContextFixture(t);
    let builds = 0;
    const result = await invoke({ paths: ["src/one.ts"] }, {
      buildProjectImpact(projectId, input) {
        builds += 1;
        return buildProjectImpact(projectId, input, {
          ...f.options,
          analyzeSources(project, files, options) {
            const graph = analyzeContextSources(project, files, options);
            f.write("src/one.ts", "export class One { raced = true; }\n");
            return graph;
          }
        });
      }
    }, f.request.projectId);
    assert.equal(result.res.status, 409);
    assert.equal(result.payload.error, "impact_sources_changed");
    assert.equal(builds, 1);
    assert.deepEqual({ head: result.res.headCalls, write: result.res.writeCalls, end: result.res.endCalls, destroy: result.res.destroyCalls },
      { head: 1, write: 0, end: 1, destroy: 0 });
  }
});

test("project impact transport measures repeated Unicode and JSON-escaped exact/overflow bytes deterministically", async () => {
  let builderCalls = 0;
  const bodies = new Map();
  for (const bytes of [SUCCESS_LIMIT, SUCCESS_LIMIT + 1]) {
    const data = escapedSyntheticObjectAtEnvelopeBytes(bytes);
    for (let repeat = 0; repeat < 2; repeat += 1) {
      const result = await invoke({ paths: ["src/café.ts"] }, {
        buildProjectImpact() { builderCalls += 1; return data; }
      });
      const wire = Buffer.isBuffer(result.res.body) ? result.res.body : Buffer.from(result.res.body, "utf8");
      assert.deepEqual({ head: result.res.headCalls, write: result.res.writeCalls, end: result.res.endCalls, destroy: result.res.destroyCalls },
        { head: 1, write: 0, end: 1, destroy: 0 });
      if (bytes === SUCCESS_LIMIT) {
        assert.equal(result.res.status, 200);
        assert.equal(wire.length, SUCCESS_LIMIT);
        assert.deepEqual(wire, Buffer.from(successBody(data), "utf8"));
      } else {
        assert.equal(result.res.status, 500);
        assert.equal(result.payload.error, "impact_response_too_large");
        assert.equal(wire.length, 121);
      }
      assert.equal(result.res.headers["content-length"], wire.length);
      if (bodies.has(bytes)) assert.deepEqual(wire, bodies.get(bytes));
      else bodies.set(bytes, wire);
    }
  }
  assert.equal(builderCalls, 4);
});

test("project impact transport accepts exactly 163840 bytes and rejects one byte over before success writes", async () => {
  const exactData = syntheticDataAtEnvelopeBytes(SUCCESS_LIMIT);
  const exact = await invoke({ paths: ["src/one.ts"] }, { buildProjectImpact: () => exactData });
  assert.equal(exact.res.status, 200);
  assert.equal(exact.res.body.length, SUCCESS_LIMIT);
  assert.equal(exact.res.headers["content-length"], SUCCESS_LIMIT);

  const oversizedData = syntheticObjectAtEnvelopeBytes(SUCCESS_LIMIT + 1);
  const before = JSON.stringify(oversizedData);
  const oversized = await invoke({ paths: ["src/one.ts"] }, { buildProjectImpact: () => oversizedData });
  assert.equal(oversized.res.status, 500);
  assert.equal(oversized.payload.error, "impact_response_too_large");
  assert.equal(oversized.payload.message, ERROR_MESSAGE);
  assert.equal(JSON.stringify(oversizedData), before);
  assert.equal(oversized.res.writes.filter((write) => write.status === 200).length, 0);
  assert.equal(Buffer.byteLength(oversized.res.body, "utf8"), 121);
  assert.equal(oversized.res.headers["content-length"], 121);
  assert.equal(JSON.stringify(oversized.payload).includes("x".repeat(20)), false);
});

test("project impact handler keeps domain, request, race, identity, and internal errors distinct", async () => {
  const cases = [
    ["invalid_project_identity", 400, "invalid_project_identity"],
    ["project_identity_required", 400, "project_identity_required"],
    ["invalid_impact_request", 400, "invalid_impact_request"],
    ["impact_budget_exceeded", 400, "impact_budget_exceeded"],
    ["project_not_found", 404, "project_not_found"],
    ["project_unavailable", 404, "project_unavailable"],
    ["ambiguous_project", 409, "ambiguous_project"],
    ["project_identity_conflict", 409, "project_identity_conflict"],
    ["worktree_parent_mismatch", 409, "worktree_parent_mismatch"],
    ["impact_sources_changed", 409, "impact_sources_changed"],
    ["impact_revision_changed", 409, "impact_revision_changed"],
    ["impact_project_changed", 409, "impact_project_changed"],
    ["invalid_impact_observation", 500, "impact_failed"],
    ["invalid_context_sources", 500, "impact_failed"],
    ["invalid_analyzer_snapshot", 500, "impact_failed"],
    ["impact_response_too_large", 500, "impact_failed"],
    [undefined, 500, "impact_failed"]
  ];
  for (const [code, status, exposed] of cases) {
    const result = await invoke({ paths: ["src/one.ts"] }, {
      buildProjectImpact: () => { throw Object.assign(new Error("/private/provider/details"), { code }); }
    });
    assert.equal(result.res.status, status, String(code));
    assert.equal(result.payload.error, exposed, String(code));
    assert.equal(result.payload.message, ERROR_MESSAGE);
    assert.equal(JSON.stringify(result.payload).includes("/private"), false);
    assert.equal(result.res.headers["cache-control"], "no-store");
  }
});

test("project impact handler maps serialization failures to generic impact_failed", async () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const result = await invoke({ paths: ["src/one.ts"] }, { buildProjectImpact: () => cyclic });
  assert.equal(result.res.status, 500);
  assert.equal(result.payload.error, "impact_failed");
  assert.equal(result.res.writes.filter((write) => write.status === 200).length, 0);
});

for (const fault of ["success", "error"]) {
  test(`project impact dispatch contains ${fault}-write failure before the production-equivalent fallback`, async () => {
    const req = requestFrom(JSON.stringify({ paths: ["src/one.ts"] }));
    const counters = { build: 0, head: 0, end: 0, destroy: 0, outerCatch: 0, fallback: 0 };
    const res = {
      headersSent: false,
      destroyed: false,
      writeHead() {
        counters.head += 1;
        this.headersSent = true;
      },
      end() {
        counters.end += 1;
        throw new Error("socket closed after headers");
      },
      destroy() {
        counters.destroy += 1;
        this.destroyed = true;
      }
    };
    const router = createRouter();
    router.add("POST", "/api/intelligence/projects/:projectId/impact", createProjectImpactHandler(dependencies({
      buildProjectImpact: () => {
        counters.build += 1;
        return fault === "error" ? syntheticObjectAtEnvelopeBytes(SUCCESS_LIMIT + 1) : { bounded: true };
      }
    })));

    try {
      await router.dispatch(req, res);
    } catch (error) {
      counters.outerCatch += 1;
      counters.fallback += 1;
      res.writeHead(500);
      res.end(JSON.stringify({ ok: false, error: "internal_error", message: error.message }));
    }

    assert.deepEqual(counters, {
      build: 1,
      head: 1,
      end: 1,
      destroy: 1,
      outerCatch: 0,
      fallback: 0
    });
    assert.equal(res.destroyed, true);
  });
}

test("intelligence router registers project impact and serves exact bytes over loopback HTTP", async (t) => {
  const data = syntheticDataAtEnvelopeBytes(SUCCESS_LIMIT);
  const router = createRouter();
  registerIntelligenceRoutes(router, dependencies({ buildProjectImpact: () => data }));
  const server = http.createServer((req, res) => {
    router.dispatch(req, res).then((matched) => {
      if (!matched) { res.writeHead(404); res.end(); }
    }).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/projects/PrJ_Impact/impact?provider=forbidden`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths: ["src/one.ts"] })
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(bytes.length, SUCCESS_LIMIT);
  assert.equal(Number(response.headers.get("content-length")), bytes.length);
  assert.deepEqual(bytes, Buffer.from(successBody(data), "utf8"));
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("HTTP wrapper overhead is 59 bytes and accepted domain maxima remain below transport ceiling", () => {
  assert.equal(Buffer.byteLength(successBody(null), "utf8") - Buffer.byteLength("null"), 59);
  assert.equal(131072 + 59, 131131);
  assert.ok(131131 < SUCCESS_LIMIT);
});
