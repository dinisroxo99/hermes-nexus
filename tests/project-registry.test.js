import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  mergeProjectRegistries,
  normalizeProjectEntryForRuntime,
  readDiscoveredProjectRegistry,
  readEffectiveProjectRegistry,
  readManualProjectRegistry,
  writeDiscoveredProjectRegistryAtomic
} from "../src/lib/project-registry.js";

function makeTempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const INVALID_PROJECT_ID_ERROR = {
  name: "Error",
  code: "invalid_project_identity",
  message: "Invalid projectId: expected 1-128 ASCII letters, digits, underscores or hyphens, starting with a letter or digit."
};

test("normalizeProjectEntryForRuntime keeps projectId optional without generating one", () => {
  const input = Object.freeze({ name: "legacy-service", relativePath: "legacy-service" });

  const normalized = normalizeProjectEntryForRuntime(input);

  assert.equal(Object.hasOwn(normalized, "projectId"), false);
  assert.deepEqual(normalizeProjectEntryForRuntime(input), normalized);
  assert.deepEqual(input, { name: "legacy-service", relativePath: "legacy-service" });
});

test("normalizeProjectEntryForRuntime preserves valid projectIds exactly without mutating input", () => {
  for (const projectId of ["A", "0", "PrJ_Mixed-Case_09", "a".repeat(128)]) {
    const input = Object.freeze({ name: "service", relativePath: "service", projectId });

    const normalized = normalizeProjectEntryForRuntime(input);

    assert.equal(normalized.projectId, projectId);
    assert.equal(input.projectId, projectId);
    assert.notEqual(normalized, input);
  }
});

test("normalizeProjectEntryForRuntime rejects explicitly present non-string projectIds", () => {
  for (const projectId of [null, undefined, false, true, 0, 42, [], {}, new String("prj_valid")]) {
    const input = Object.freeze({ name: "service", relativePath: "service", projectId });

    assert.throws(() => normalizeProjectEntryForRuntime(input), INVALID_PROJECT_ID_ERROR);
    assert.equal(input.projectId, projectId);
  }
});

test("normalizeProjectEntryForRuntime rejects malformed projectId strings without repairing them", () => {
  const invalidIds = [
    "", " ", " prj_valid", "prj_valid ", "prj valid", "prj\tvalid",
    "prj_valid\n", "prj_valid\r", "prj_valid\r\n", "prj\u0000valid",
    "prj_valid\u2028", "prj_valid\u2029", "prj_é", "prj_😀",
    "_prj", "-prj", "prj.value", "prj:value", "prj/value", "prj\\value",
    "a".repeat(129)
  ];

  for (const projectId of invalidIds) {
    const input = Object.freeze({ name: "service", relativePath: "service", projectId });

    assert.throws(() => normalizeProjectEntryForRuntime(input), INVALID_PROJECT_ID_ERROR);
    assert.equal(input.projectId, projectId);
  }
});

test("normalizeProjectEntryForRuntime rejects malformed projectIds before skipping invalid entries", () => {
  for (const entry of [
    { projectId: null },
    { name: "", relativePath: "service", projectId: "bad/id" },
    { name: "service", relativePath: "../outside", projectId: "bad/id" }
  ]) {
    assert.throws(() => normalizeProjectEntryForRuntime(entry), INVALID_PROJECT_ID_ERROR);
  }
});

for (const [source, readRegistry] of [
  ["manual", readManualProjectRegistry],
  ["discovered", readDiscoveredProjectRegistry]
]) {
  test(`${source} registry reads preserve explicit IDs and legacy entries without rewriting files`, (t) => {
    const dir = makeTempRoot("project-map-read-identity-");
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, source === "manual" ? "projects.json" : "discovered-projects.json");
    const entries = [
      { name: "identified", relativePath: "identified", projectId: "PrJ_Mixed-Case_09" },
      { name: "legacy", relativePath: "legacy" }
    ];
    const contents = `${JSON.stringify(entries)}\n`;
    fs.writeFileSync(file, contents);

    const projects = readRegistry(file);

    assert.deepEqual(projects, entries.map((entry) => ({ ...entry, rootId: "default", registrySource: source })));
    assert.equal(Object.hasOwn(projects[1], "projectId"), false);
    assert.deepEqual(readRegistry(file), projects);
    assert.equal(fs.readFileSync(file, "utf8"), contents);
    assert.deepEqual(fs.readdirSync(dir), [path.basename(file)]);
  });

  test(`${source} registry reads reject malformed explicit IDs without skipping or rewriting entries`, (t) => {
    const dir = makeTempRoot("project-map-read-invalid-identity-");
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, source === "manual" ? "projects.json" : "discovered-projects.json");

    for (const projectId of [null, false, 42, [], {}, "", " prj_valid", "prj_valid\n", "a".repeat(129)]) {
      const contents = JSON.stringify([
        { name: "legacy", relativePath: "legacy" },
        { name: "invalid", relativePath: "invalid", projectId }
      ]);
      fs.writeFileSync(file, contents);

      assert.throws(() => readRegistry(file), INVALID_PROJECT_ID_ERROR);
      assert.throws(() => readRegistry(file), INVALID_PROJECT_ID_ERROR);
      assert.equal(fs.readFileSync(file, "utf8"), contents);
    }

    assert.deepEqual(fs.readdirSync(dir), [path.basename(file)]);
  });
}

test("readEffectiveProjectRegistry preserves persisted IDs without assigning legacy identities", (t) => {
  const dir = makeTempRoot("project-map-effective-identity-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manualProjectsFile = path.join(dir, "projects.json");
  const discoveredProjectsFile = path.join(dir, "discovered-projects.json");
  const manualContents = JSON.stringify([
    { name: "manual", relativePath: "manual", projectId: "PrJ_Manual" },
    { name: "legacy", relativePath: "legacy" }
  ]);
  const discoveredContents = JSON.stringify([
    { name: "discovered", relativePath: "discovered", projectId: "PrJ_Discovered" }
  ]);
  fs.writeFileSync(manualProjectsFile, manualContents);
  fs.writeFileSync(discoveredProjectsFile, discoveredContents);

  const { projects, warnings } = readEffectiveProjectRegistry({ manualProjectsFile, discoveredProjectsFile });

  assert.deepEqual(projects.map((project) => project.projectId), ["PrJ_Manual", undefined, "PrJ_Discovered"]);
  assert.equal(Object.hasOwn(projects[1], "projectId"), false);
  assert.deepEqual(warnings, []);
  assert.equal(fs.readFileSync(manualProjectsFile, "utf8"), manualContents);
  assert.equal(fs.readFileSync(discoveredProjectsFile, "utf8"), discoveredContents);
});

test("writeDiscoveredProjectRegistryAtomic round-trips valid IDs without assigning legacy identities", (t) => {
  const dir = makeTempRoot("project-map-write-identity-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "discovered-projects.json");
  const projects = Object.freeze([
    Object.freeze({ name: "identified", relativePath: "identified", projectId: "PrJ_Mixed-Case_09" }),
    Object.freeze({ name: "legacy", relativePath: "legacy" })
  ]);

  writeDiscoveredProjectRegistryAtomic(file, projects);

  const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(persisted, projects.map((project) => ({ ...project, rootId: "default", source: "discovered" })));
  assert.equal(readDiscoveredProjectRegistry(file)[0].projectId, "PrJ_Mixed-Case_09");
  assert.equal(Object.hasOwn(persisted[1], "projectId"), false);
  assert.deepEqual(findDiscoveredTempFiles(dir), []);
});

test("writeDiscoveredProjectRegistryAtomic rejects invalid IDs before altering registry state", (t) => {
  const dir = makeTempRoot("project-map-write-invalid-identity-");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "discovered-projects.json");
  const contents = '[{"name":"existing","relativePath":"existing","projectId":"PrJ_Existing"}]\n';
  fs.writeFileSync(file, contents);

  assert.throws(() => writeDiscoveredProjectRegistryAtomic(file, [
    { name: "valid", relativePath: "valid", projectId: "PrJ_Valid" },
    { name: "invalid", relativePath: "invalid", projectId: "do-not-echo/invalid" }
  ]), INVALID_PROJECT_ID_ERROR);

  assert.equal(fs.readFileSync(file, "utf8"), contents);
  assert.deepEqual(fs.readdirSync(dir), ["discovered-projects.json"]);
});

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
