import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
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

function makeOverviewTypeScriptProject(parent, name) {
  const project = path.join(parent, name);
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  writeJson(path.join(project, "package.json"), {
    name,
    type: "module",
    scripts: {
      start: "node src/server.js",
      test: "node --test",
      check: "node --check src/server.js"
    },
    dependencies: {
      express: "^5.0.0"
    }
  });
  fs.writeFileSync(path.join(project, "package-lock.json"), "{}\n");
  writeJson(path.join(project, "tsconfig.json"), { compilerOptions: {} });
  fs.writeFileSync(path.join(project, "src", "server.ts"), "export function start() {}\n");
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

async function dispatchRegister({
  roots,
  registryDir,
  body,
  url = "/api/intelligence/discover/register",
  writesEnabled = true,
  now = "2026-09-12T00:00:00.000Z",
  extraDependencies = {}
} = {}) {
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getConfiguredProjectRoots: () => roots,
    getProjectConfig: () => ({
      dataDir: registryDir,
      intelligenceRegistryWritesEnabled: writesEnabled
    }),
    now: () => now,
    ...extraDependencies
  });

  const req = createJsonRequest("POST", url, body);
  const res = createFakeResponse();
  const matched = await router.dispatch(req, res);

  assert.equal(matched, true);
  return {
    status: res.status,
    headers: res.headers,
    payload: JSON.parse(res.body)
  };
}

function createJsonRequest(method, url, body) {
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from([serialized]);
  req.method = method;
  req.url = url;
  req.headers = {
    host: "localhost",
    "content-type": "application/json"
  };
  return req;
}

async function dispatchOverview({
  project,
  url,
  extraDependencies = {}
} = {}) {
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getProjectByName: (name) => {
      if (!project || name !== project.name) {
        throw new Error(`Projeto não encontrado: ${name}`);
      }

      return project;
    },
    ...extraDependencies
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

function registryFixture() {
  const registryDir = makeRoot();
  return {
    registryDir,
    manualProjectsFile: path.join(registryDir, "projects.json"),
    discoveredProjectsFile: path.join(registryDir, "discovered-projects.json")
  };
}

function discoveredTempFiles(registryDir) {
  return fs.readdirSync(registryDir)
    .filter((entry) => entry.startsWith(".discovered-projects.json.tmp-"))
    .sort();
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

test("registers discovery, explicit registration and bounded overview intelligence routes", () => {
  const router = createRouter();
  registerIntelligenceRoutes(router, {
    getConfiguredProjectRoots: () => [],
    getEffectiveProjectRegistry: () => []
  });

  assert.ok(router.match("GET", "/api/intelligence/discover"));
  assert.ok(router.match("POST", "/api/intelligence/discover/register"));
  assert.ok(router.match("GET", "/api/intelligence/projects/sample-service/overview"));
  assert.equal(router.match("POST", "/api/intelligence/discover"), null);
});

test("GET /api/intelligence/projects/:name/overview returns high-level overview without absolute paths", async () => {
  const root = makeRoot();
  const absolutePath = makeOverviewTypeScriptProject(root, "sample-service");
  const project = {
    name: "sample-service",
    rootId: "default",
    relativePath: "sample-service",
    registrySource: "manual",
    absolutePath
  };

  const { status, headers, payload } = await dispatchOverview({
    project,
    url: "/api/intelligence/projects/sample-service/overview"
  });

  assert.equal(status, 200);
  assert.equal(headers["content-type"], "application/json; charset=utf-8");
  assert.equal(payload.ok, true);
  assert.equal(payload.data.schemaVersion, 1);
  assert.equal(payload.data.bounded, true);
  assert.deepEqual(payload.data.project, {
    name: "sample-service",
    rootId: "default",
    relativePath: "sample-service",
    projectType: "typescript",
    typeLabel: "TypeScript",
    supported: true,
    registrySource: "manual"
  });
  assert.deepEqual(payload.data.stack.frameworks, ["express"]);
  assert.equal(payload.data.stack.packageManager, "npm");
  assert.deepEqual(payload.data.architecture.entryPoints, ["src/server.ts"]);
  assert.equal(payload.data.analysis.status, "not_analyzed");
  assert.equal(payload.data.statistics.nodeCount, null);
  assert.equal(payload.data.statistics.edgeCount, null);
  assert.equal(JSON.stringify(payload).includes(root), false);
  assert.equal(JSON.stringify(payload).includes(absolutePath), false);
});

test("GET overview returns 404 error envelope for unknown projects", async () => {
  const { status, payload } = await dispatchOverview({
    url: "/api/intelligence/projects/missing-service/overview"
  });

  assert.equal(status, 404);
  assert.deepEqual(payload, {
    ok: false,
    error: "project_not_found",
    message: "Projeto não encontrado: missing-service"
  });
});

test("GET overview validates project name and unavailable paths without absolute leaks", async () => {
  const invalid = await dispatchOverview({
    url: "/api/intelligence/projects/..bad/overview"
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.error, "invalid_project_name");

  const unavailable = await dispatchOverview({
    url: "/api/intelligence/projects/sample-service/overview",
    project: null,
    extraDependencies: {
      getProjectByName: () => {
        throw new Error("Pasta do projeto não encontrada no runtime: /tmp/secret-project");
      }
    }
  });

  assert.equal(unavailable.status, 404);
  assert.equal(unavailable.payload.error, "project_unavailable");
  assert.equal(JSON.stringify(unavailable.payload).includes("/tmp/secret-project"), false);
});

test("GET overview clamps graphLimit before calling the overview builder", async () => {
  const root = makeRoot();
  const absolutePath = makeOverviewTypeScriptProject(root, "sample-service");
  const project = {
    name: "sample-service",
    rootId: "default",
    relativePath: "sample-service",
    registrySource: "discovered",
    absolutePath
  };
  const seenOptions = [];

  const tooHigh = await dispatchOverview({
    project,
    url: "/api/intelligence/projects/sample-service/overview?graphLimit=500",
    extraDependencies: {
      buildProjectOverview: (resolvedProject, options) => {
        seenOptions.push({ resolvedProject, options });
        return {
          schemaVersion: 1,
          bounded: true,
          limits: { graphLimit: options.graphLimit },
          project: { name: resolvedProject.name },
          stack: {},
          architecture: {},
          statistics: {},
          analysis: {},
          analyzers: [],
          warnings: []
        };
      }
    }
  });
  assert.equal(tooHigh.status, 200);
  assert.equal(tooHigh.payload.data.limits.graphLimit, 100);

  await dispatchOverview({
    project,
    url: "/api/intelligence/projects/sample-service/overview?graphLimit=0",
    extraDependencies: {
      buildProjectOverview: (_resolvedProject, options) => {
        seenOptions.push({ options });
        return {
          schemaVersion: 1,
          bounded: true,
          limits: { graphLimit: options.graphLimit },
          project: { name: "sample-service" },
          stack: {},
          architecture: {},
          statistics: {},
          analysis: {},
          analyzers: [],
          warnings: []
        };
      }
    }
  });
  assert.equal(seenOptions[1].options.graphLimit, 20);
});

test("POST registration is disabled by default and does not write registries", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  const manualContents = '[{"name":"manual-service","relativePath":"manual-service"}]\n';
  fs.writeFileSync(fixture.manualProjectsFile, manualContents);
  makeTypeScriptProject(root, "sample-service");

  const { status, payload } = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    writesEnabled: false,
    body: { projects: [{ rootId: "default", relativePath: "sample-service" }] }
  });

  assert.equal(status, 403);
  assert.deepEqual(payload, {
    ok: false,
    error: "registry_writes_disabled",
    message: "Discovered project registry writes are disabled."
  });
  assert.equal(fs.readFileSync(fixture.manualProjectsFile, "utf8"), manualContents);
  assert.equal(fs.existsSync(fixture.discoveredProjectsFile), false);
});

test("POST registration persists server-discovered candidates through the discovered registry only", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  const manualContents = '[{"name":"manual-service","relativePath":"manual-service"}]\n';
  fs.writeFileSync(fixture.manualProjectsFile, manualContents);
  makeTypeScriptProject(root, "sample-service");

  const { status, payload } = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: [{ rootId: "default", relativePath: "sample-service" }] }
  });

  assert.equal(status, 200);
  assert.deepEqual(payload.data, {
    schemaVersion: 1,
    bounded: true,
    requestedCount: 1,
    registeredCount: 1,
    updatedCount: 0,
    skippedCount: 0,
    results: [{ rootId: "default", relativePath: "sample-service", status: "registered" }],
    warnings: []
  });
  assert.equal(fs.readFileSync(fixture.manualProjectsFile, "utf8"), manualContents);
  assert.deepEqual(discoveredTempFiles(fixture.registryDir), []);

  const discovered = JSON.parse(fs.readFileSync(fixture.discoveredProjectsFile, "utf8"));
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].name, "sample-service");
  assert.equal(discovered[0].rootId, "default");
  assert.equal(discovered[0].relativePath, "sample-service");
  assert.equal(discovered[0].projectType, "typescript");
  assert.equal(discovered[0].boundaryKind, "repository");
  assert.deepEqual(discovered[0].signals, ["package.json", "tsconfig.json"]);
  assert.deepEqual(discovered[0].modules, []);
  assert.equal(discovered[0].source, "discovered");
  assert.equal(discovered[0].discoveredAt, "2026-09-12T00:00:00.000Z");
  assert.equal(discovered[0].lastSeenAt, "2026-09-12T00:00:00.000Z");
  assert.equal(Object.hasOwn(discovered[0], "registrySource"), false);
});

test("POST registration ignores arbitrary client metadata and rejects unsafe identities", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  makeTypeScriptProject(root, "sample-service");

  const unsafe = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: [{ name: "evil", rootId: "default", relativePath: "../secret", projectType: "dotnet" }] }
  });

  assert.equal(unsafe.status, 400);
  assert.equal(unsafe.payload.error, "invalid_registration_request");
  assert.equal(fs.existsSync(fixture.discoveredProjectsFile), false);

  const accepted = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: [{ name: "evil", rootId: "default", relativePath: "sample-service", projectType: "dotnet" }] }
  });

  assert.equal(accepted.status, 200);
  const discovered = JSON.parse(fs.readFileSync(fixture.discoveredProjectsFile, "utf8"));
  assert.equal(discovered[0].name, "sample-service");
  assert.equal(discovered[0].projectType, "typescript");
});

test("POST registration rejects unknown stale candidates without persisting", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  makeTypeScriptProject(root, "sample-service");

  const { status, payload } = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: [{ rootId: "default", relativePath: "missing-service" }] }
  });

  assert.equal(status, 400);
  assert.equal(payload.error, "unknown_discovery_candidate");
  assert.equal(fs.existsSync(fixture.discoveredProjectsFile), false);
});

test("POST registration skips manual conflicts without creating discovered duplicates", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  const manualContents = '[{"name":"sample-service","relativePath":"sample-service"}]\n';
  fs.writeFileSync(fixture.manualProjectsFile, manualContents);
  makeTypeScriptProject(root, "sample-service");

  const { status, payload } = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: [{ rootId: "default", relativePath: "sample-service" }] }
  });

  assert.equal(status, 200);
  assert.equal(payload.data.registeredCount, 0);
  assert.equal(payload.data.skippedCount, 1);
  assert.deepEqual(payload.data.results, [
    { rootId: "default", relativePath: "sample-service", status: "already_registered" }
  ]);
  assert.equal(fs.readFileSync(fixture.manualProjectsFile, "utf8"), manualContents);
  assert.equal(fs.existsSync(fixture.discoveredProjectsFile), false);
});

test("POST registration treats same-root manual name conflicts as already registered", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  const manualContents = '[{"name":"sample-service","relativePath":"custom-path"}]\n';
  fs.writeFileSync(fixture.manualProjectsFile, manualContents);
  makeTypeScriptProject(root, "sample-service");

  const { payload } = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: [{ rootId: "default", relativePath: "sample-service" }] }
  });

  assert.deepEqual(payload.data.results, [
    { rootId: "default", relativePath: "sample-service", status: "already_registered" }
  ]);
  assert.equal(fs.readFileSync(fixture.manualProjectsFile, "utf8"), manualContents);
  assert.equal(fs.existsSync(fixture.discoveredProjectsFile), false);
});

test("POST registration is idempotent for already discovered entries and preserves discoveredAt", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  makeTypeScriptProject(root, "sample-service");
  fs.writeFileSync(fixture.discoveredProjectsFile, JSON.stringify([
    {
      name: "sample-service",
      rootId: "default",
      relativePath: "sample-service",
      source: "discovered",
      discoveredAt: "2026-09-01T00:00:00.000Z",
      lastSeenAt: "2026-09-01T00:00:00.000Z",
      projectType: "unknown"
    }
  ], null, 2));

  const { payload } = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    now: "2026-09-12T12:00:00.000Z",
    body: { projects: [{ rootId: "default", relativePath: "sample-service" }] }
  });

  assert.equal(payload.data.registeredCount, 0);
  assert.equal(payload.data.updatedCount, 1);
  assert.deepEqual(payload.data.results, [
    { rootId: "default", relativePath: "sample-service", status: "updated" }
  ]);

  const discovered = JSON.parse(fs.readFileSync(fixture.discoveredProjectsFile, "utf8"));
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].discoveredAt, "2026-09-01T00:00:00.000Z");
  assert.equal(discovered[0].lastSeenAt, "2026-09-12T12:00:00.000Z");
  assert.equal(discovered[0].projectType, "typescript");
});

test("POST registration supports bounded multiple-project requests", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  makeTypeScriptProject(root, "a-service");
  makeTypeScriptProject(root, "b-service");

  const success = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: {
      projects: [
        { rootId: "default", relativePath: "a-service" },
        { rootId: "default", relativePath: "b-service" }
      ]
    }
  });

  assert.equal(success.payload.data.requestedCount, 2);
  assert.equal(success.payload.data.registeredCount, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(fixture.discoveredProjectsFile, "utf8")).map((project) => project.relativePath), [
    "a-service",
    "b-service"
  ]);

  const tooMany = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: Array.from({ length: 101 }, () => ({ rootId: "default", relativePath: "a-service" })) }
  });

  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.payload.error, "invalid_registration_request");
});

test("POST registration validates JSON body shape and size", async () => {
  const root = makeRoot();
  const fixture = registryFixture();

  const invalidJson = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: "{not-json"
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.payload.error, "invalid_json");

  const nonObject = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: []
  });
  assert.equal(nonObject.status, 400);
  assert.equal(nonObject.payload.error, "invalid_registration_request");

  const oversized = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    extraDependencies: { bodyLimitBytes: 20 },
    body: { projects: [{ rootId: "default", relativePath: "sample-service" }] }
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.payload.error, "request_body_too_large");
});

test("POST registration reports persistence failures without false success", async () => {
  const root = makeRoot();
  const fixture = registryFixture();
  const manualContents = '[{"name":"manual-service","relativePath":"manual-service"}]\n';
  fs.writeFileSync(fixture.manualProjectsFile, manualContents);
  makeTypeScriptProject(root, "sample-service");

  const { status, payload } = await dispatchRegister({
    roots: [{ id: "default", path: root }],
    registryDir: fixture.registryDir,
    body: { projects: [{ rootId: "default", relativePath: "sample-service" }] },
    extraDependencies: {
      writeDiscoveredProjectRegistryAtomic: () => {
        throw new Error("write failed");
      }
    }
  });

  assert.equal(status, 500);
  assert.deepEqual(payload, {
    ok: false,
    error: "registration_failed",
    message: "write failed"
  });
  assert.equal(fs.readFileSync(fixture.manualProjectsFile, "utf8"), manualContents);
  assert.equal(fs.existsSync(fixture.discoveredProjectsFile), false);
});
