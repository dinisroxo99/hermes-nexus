import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeProjectRegistries,
  normalizeProjectEntryForRuntime,
  readDiscoveredProjectRegistry,
  readManualProjectRegistry,
  writeDiscoveredProjectRegistryAtomic
} from "../src/lib/project-registry.js";

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("readManualProjectRegistry accepts the current legacy array format", () => {
  const dir = makeTempRoot("project-map-manual-");
  const file = path.join(dir, "projects.json");

  fs.writeFileSync(file, JSON.stringify([
    {
      name: "manual-service",
      relativePath: "manual-service",
      addedAt: "2026-01-01T00:00:00"
    }
  ]));

  assert.deepEqual(readManualProjectRegistry(file), [{
    name: "manual-service",
    relativePath: "manual-service",
    addedAt: "2026-01-01T00:00:00",
    registrySource: "manual",
    rootId: "default"
  }]);
});

test("normalizeProjectEntryForRuntime does not mutate manual input objects", () => {
  const input = {
    name: "manual-service",
    relativePath: "manual-service"
  };

  const normalized = normalizeProjectEntryForRuntime(input, {
    registrySource: "manual"
  });

  assert.equal(normalized.registrySource, "manual");
  assert.deepEqual(input, {
    name: "manual-service",
    relativePath: "manual-service"
  });
  assert.equal(Object.hasOwn(input, "source"), false);
  assert.equal(Object.hasOwn(input, "registrySource"), false);
});

test("readDiscoveredProjectRegistry treats a missing registry as empty", () => {
  const dir = makeTempRoot("project-map-discovered-");
  const file = path.join(dir, "discovered-projects.json");

  assert.deepEqual(readDiscoveredProjectRegistry(file), []);
});

test("mergeProjectRegistries lets manual entries win over discovered path conflicts", () => {
  const result = mergeProjectRegistries(
    [{ name: "custom-service", relativePath: "service" }],
    [{ name: "auto-service", rootId: "default", relativePath: "service" }]
  );

  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].name, "custom-service");
  assert.equal(result.projects[0].registrySource, "manual");
});

test("mergeProjectRegistries lets manual entries win over project name conflicts", () => {
  const result = mergeProjectRegistries(
    [{ name: "sample-service", relativePath: "manual-service" }],
    [{
      name: "sample-service",
      rootId: "default",
      relativePath: "auto-service",
      source: "discovered",
      metadata: { detected: true }
    }]
  );

  assert.equal(result.projects.length, 1);
  assert.deepEqual(result.projects[0], {
    name: "sample-service",
    relativePath: "manual-service",
    registrySource: "manual",
    rootId: "default"
  });
});

test("mergeProjectRegistries includes non-conflicting discovered projects", () => {
  const result = mergeProjectRegistries(
    [{ name: "manual-service", relativePath: "manual-service" }],
    [{ name: "auto-service", rootId: "default", relativePath: "auto-service" }]
  );

  assert.deepEqual(
    result.projects.map((project) => project.name),
    ["manual-service", "auto-service"]
  );
  assert.deepEqual(
    result.projects.map((project) => project.registrySource),
    ["manual", "discovered"]
  );
});

test("mergeProjectRegistries returns deterministic manual-first ordering", () => {
  const result = mergeProjectRegistries(
    [
      { name: "manual-b", relativePath: "manual-b" },
      { name: "manual-a", relativePath: "manual-a" }
    ],
    [
      { name: "auto-b", rootId: "default", relativePath: "auto-b" },
      { name: "auto-a", rootId: "default", relativePath: "auto-a" }
    ]
  );

  assert.deepEqual(
    result.projects.map((project) => project.name),
    ["manual-b", "manual-a", "auto-b", "auto-a"]
  );
});

test("invalid discovered entries do not corrupt manual state", () => {
  const result = mergeProjectRegistries(
    [{ name: "manual-service", relativePath: "manual-service" }],
    [
      { name: "bad-discovered", relativePath: "../secret" },
      { name: "auto-service", rootId: "default", relativePath: "auto-service" }
    ]
  );

  assert.deepEqual(
    result.projects.map((project) => project.name),
    ["manual-service", "auto-service"]
  );
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /bad-discovered/);
});

test("writeDiscoveredProjectRegistryAtomic writes a valid discovered registry", () => {
  const dir = makeTempRoot("project-map-write-discovered-");
  const discoveredFile = path.join(dir, "discovered-projects.json");

  writeDiscoveredProjectRegistryAtomic(discoveredFile, [{
    name: "auto-service",
    rootId: "default",
    relativePath: "auto-service",
    registrySource: "discovered"
  }]);

  assert.equal(fs.existsSync(discoveredFile), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(discoveredFile, "utf8")), [{
    name: "auto-service",
    rootId: "default",
    relativePath: "auto-service",
    source: "discovered"
  }]);
});

test("writeDiscoveredProjectRegistryAtomic leaves the manual registry untouched", () => {
  const dir = makeTempRoot("project-map-write-manual-safe-");
  const manualFile = path.join(dir, "projects.json");
  const discoveredFile = path.join(dir, "discovered-projects.json");
  const manualContents = '[{"name":"manual-service","relativePath":"manual-service"}]\n';

  fs.writeFileSync(manualFile, manualContents);

  writeDiscoveredProjectRegistryAtomic(discoveredFile, [{
    name: "auto-service",
    rootId: "default",
    relativePath: "auto-service"
  }]);

  assert.equal(fs.readFileSync(manualFile, "utf8"), manualContents);
});

test("writeDiscoveredProjectRegistryAtomic atomically replaces existing discovered state", () => {
  const dir = makeTempRoot("project-map-write-replace-");
  const discoveredFile = path.join(dir, "discovered-projects.json");

  fs.writeFileSync(discoveredFile, JSON.stringify([
    { name: "old-service", rootId: "default", relativePath: "old-service", source: "discovered" }
  ]));

  writeDiscoveredProjectRegistryAtomic(discoveredFile, [{
    name: "new-service",
    rootId: "default",
    relativePath: "new-service"
  }]);

  const contents = fs.readFileSync(discoveredFile, "utf8");
  assert.deepEqual(JSON.parse(contents), [{
    name: "new-service",
    rootId: "default",
    relativePath: "new-service",
    source: "discovered"
  }]);
  assert.equal(contents.includes("old-service"), false);
});

test("writeDiscoveredProjectRegistryAtomic removes temporary sibling files after success", () => {
  const dir = makeTempRoot("project-map-write-temp-cleanup-");
  const discoveredFile = path.join(dir, "discovered-projects.json");

  writeDiscoveredProjectRegistryAtomic(discoveredFile, [{
    name: "auto-service",
    rootId: "default",
    relativePath: "auto-service"
  }]);

  assert.deepEqual(findDiscoveredTempFiles(dir), []);
});

test("writeDiscoveredProjectRegistryAtomic supports repeated deterministic replacement writes", () => {
  const dir = makeTempRoot("project-map-write-repeat-");
  const discoveredFile = path.join(dir, "discovered-projects.json");

  writeDiscoveredProjectRegistryAtomic(discoveredFile, [{
    name: "first-service",
    rootId: "default",
    relativePath: "first-service"
  }]);
  assert.equal(JSON.parse(fs.readFileSync(discoveredFile, "utf8"))[0].name, "first-service");

  writeDiscoveredProjectRegistryAtomic(discoveredFile, [{
    name: "second-service",
    rootId: "default",
    relativePath: "second-service"
  }]);

  const parsed = JSON.parse(fs.readFileSync(discoveredFile, "utf8"));
  assert.deepEqual(parsed, [{
    name: "second-service",
    rootId: "default",
    relativePath: "second-service",
    source: "discovered"
  }]);
});

test("writeDiscoveredProjectRegistryAtomic writes an empty discovered registry", () => {
  const dir = makeTempRoot("project-map-write-empty-");
  const manualFile = path.join(dir, "projects.json");
  const discoveredFile = path.join(dir, "discovered-projects.json");
  const manualContents = '[{"name":"manual-service","relativePath":"manual-service"}]\n';

  fs.writeFileSync(manualFile, manualContents);
  writeDiscoveredProjectRegistryAtomic(discoveredFile, []);

  assert.deepEqual(JSON.parse(fs.readFileSync(discoveredFile, "utf8")), []);
  assert.equal(fs.readFileSync(manualFile, "utf8"), manualContents);
});

test("writeDiscoveredProjectRegistryAtomic does not mutate caller input objects", () => {
  const dir = makeTempRoot("project-map-write-input-safe-");
  const discoveredFile = path.join(dir, "discovered-projects.json");
  const input = [{
    name: "auto-service",
    rootId: "default",
    relativePath: "auto-service",
    registrySource: "discovered"
  }];

  writeDiscoveredProjectRegistryAtomic(discoveredFile, input);

  assert.deepEqual(input, [{
    name: "auto-service",
    rootId: "default",
    relativePath: "auto-service",
    registrySource: "discovered"
  }]);
});

test("writeDiscoveredProjectRegistryAtomic refuses manual registry targets", () => {
  const dir = makeTempRoot("project-map-write-refuse-manual-");
  const manualFile = path.join(dir, "projects.json");
  const manualContents = '[{"name":"manual-service","relativePath":"manual-service"}]\n';

  fs.writeFileSync(manualFile, manualContents);

  assert.throws(
    () => writeDiscoveredProjectRegistryAtomic(manualFile, []),
    /discovered-projects\.json/
  );
  assert.equal(fs.readFileSync(manualFile, "utf8"), manualContents);
});

function findDiscoveredTempFiles(dir) {
  return fs.readdirSync(dir)
    .filter((entry) => entry.startsWith(".discovered-projects.json.tmp-"))
    .sort();
}
