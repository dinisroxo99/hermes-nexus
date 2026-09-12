import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { createRouter } from "../src/utils/router.js";
import { registerIntelligenceRoutes } from "../src/routes/intelligence.routes.js";

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "project-map-route-"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function makeTypeScriptProject(parent, name) {
  const project = path.join(parent, name);
  fs.mkdirSync(project, { recursive: true });
  writeJson(path.join(project, "package.json"), { name });
  writeJson(path.join(project, "tsconfig.json"), { compilerOptions: {} });
  return project;
}

function createFakeResponse() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    }
  };
}

async function dispatchDiscover({ roots, registeredProjects = [], url = "/api/intelligence/discover", discoverProjects } = {}) {
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getConfiguredProjectRoots: () => roots,
    getEffectiveProjectRegistry: () => registeredProjects,
    discoverProjects
  });

  const req = {
    method: "GET",
    url,
    headers: { host: "localhost" }
  };
  const res = createFakeResponse();
  const matched = await router.dispatch(req, res);

  assert.equal(matched, true);
  return {
    status: res.status,
    headers: res.headers,
    payload: JSON.parse(res.body)
  };
}

test("GET /api/intelligence/discover returns the discovery envelope without root paths", async () => {
  const root = makeRoot();
  makeTypeScriptProject(root, "b-service");
  makeTypeScriptProject(root, "a-service");

  const { status, headers, payload } = await dispatchDiscover({
    roots: [{ id: "default", path: root }]
  });

  assert.equal(status, 200);
  assert.equal(headers["content-type"], "application/json; charset=utf-8");
  assert.equal(headers["cache-control"], "no-store");
  assert.equal(payload.ok, true);
  assert.equal(payload.message, "Descoberta de projetos concluída");
  assert.equal(payload.data.schemaVersion, 1);
  assert.equal(payload.data.bounded, true);
  assert.deepEqual(payload.data.limits, { maxDepth: 3, limit: 100 });
  assert.deepEqual(payload.data.roots, [{ id: "default" }]);
  assert.deepEqual(payload.data.candidates.map((candidate) => candidate.name), ["a-service", "b-service"]);
  assert.equal(payload.data.candidates[0].registered, false);
  assert.equal(payload.data.truncated, false);
  assert.deepEqual(payload.data.warnings, []);
  assert.equal(JSON.stringify(payload).includes(root), false);
});

test("GET /api/intelligence/discover forwards limit and maxDepth query bounds", async () => {
  const root = makeRoot();
  makeTypeScriptProject(root, "a-service");
  makeTypeScriptProject(root, "b-service");

  const { payload } = await dispatchDiscover({
    roots: [{ id: "default", path: root }],
    url: "/api/intelligence/discover?maxDepth=2&limit=1"
  });

  assert.deepEqual(payload.data.limits, { maxDepth: 2, limit: 1 });
  assert.deepEqual(payload.data.candidates.map((candidate) => candidate.name), ["a-service"]);
  assert.equal(payload.data.truncated, true);
});

test("includeRegistered=true includes effective-registry matches and other values do not", async () => {
  const root = makeRoot();
  makeTypeScriptProject(root, "a-service");
  makeTypeScriptProject(root, "b-service");
  const registeredProjects = [{ name: "a-service", rootId: "default", relativePath: "a-service" }];

  const included = await dispatchDiscover({
    roots: [{ id: "default", path: root }],
    registeredProjects,
    url: "/api/intelligence/discover?includeRegistered=true"
  });
  assert.deepEqual(
    included.payload.data.candidates.map((candidate) => [candidate.name, candidate.registered]),
    [["a-service", true], ["b-service", false]]
  );

  const excluded = await dispatchDiscover({
    roots: [{ id: "default", path: root }],
    registeredProjects,
    url: "/api/intelligence/discover?includeRegistered=1"
  });
  assert.deepEqual(excluded.payload.data.candidates.map((candidate) => candidate.name), ["b-service"]);
});

test("missing and non-directory roots return HTTP 200 warnings without absolute paths", async () => {
  const root = makeRoot();
  const fileRoot = path.join(root, "not-a-directory");
  fs.writeFileSync(fileRoot, "not a directory\n");

  const { status, payload } = await dispatchDiscover({
    roots: [
      { id: "missing", path: path.join(root, "missing") },
      { id: "file", path: fileRoot }
    ]
  });

  assert.equal(status, 200);
  assert.deepEqual(payload.data.warnings, [
    { code: "root_missing", rootId: "missing" },
    { code: "root_not_directory", rootId: "file" }
  ]);
  assert.equal(JSON.stringify(payload).includes(root), false);
});

test("route uses injected effective registry without mutating registry files", async () => {
  const root = makeRoot();
  const registryDir = makeRoot();
  const registryFile = path.join(registryDir, "projects.json");
  const originalRegistry = "[{\"name\":\"a-service\",\"relativePath\":\"a-service\"}]\n";
  fs.writeFileSync(registryFile, originalRegistry);
  makeTypeScriptProject(root, "a-service");

  const { payload } = await dispatchDiscover({
    roots: [{ id: "default", path: root }],
    registeredProjects: [{ name: "a-service", rootId: "default", relativePath: "a-service" }],
    url: "/api/intelligence/discover?includeRegistered=true"
  });

  assert.equal(payload.data.candidates[0].registered, true);
  assert.equal(fs.readFileSync(registryFile, "utf8"), originalRegistry);
  assert.equal(fs.existsSync(path.join(registryDir, "discovered-projects.json")), false);
});

test("unexpected discovery errors use the existing error envelope", async () => {
  const { status, payload } = await dispatchDiscover({
    roots: [{ id: "default", path: makeRoot() }],
    discoverProjects: () => {
      throw new Error("boom");
    }
  });

  assert.equal(status, 500);
  assert.deepEqual(payload, {
    ok: false,
    error: "discovery_failed",
    message: "boom"
  });
});

test("only registers GET /api/intelligence/discover", () => {
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getConfiguredProjectRoots: () => [],
    getEffectiveProjectRegistry: () => []
  });

  assert.ok(router.match("GET", "/api/intelligence/discover"));
  assert.equal(router.match("POST", "/api/intelligence/discover/register"), null);
});
