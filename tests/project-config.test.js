import test from "node:test";
import assert from "node:assert/strict";

import {
  parseProjectRootsJson,
  resolveProjectConfig
} from "../src/lib/project-config.js";

test("preserves PROJECTS_ROOT_CONTAINER compatibility", () => {
  const config = resolveProjectConfig({
    env: {
      DATA_DIR: "/tmp/project-map-data",
      PROJECTS_ROOT_CONTAINER: "/tmp/projects"
    },
    envFileValues: {}
  });

  assert.equal(config.dataDir, "/tmp/project-map-data");
  assert.equal(config.legacyProjectsRootContainer, "/tmp/projects");
});

test("preserves PROJECTS_ROOT compatibility", () => {
  const config = resolveProjectConfig({
    env: {
      PROJECTS_ROOT: "C:\\Users\\Example\\projects"
    },
    envFileValues: {}
  });

  assert.equal(config.legacyProjectsRoot, "C:\\Users\\Example\\projects");
});

test("preserves process env precedence over env file values", () => {
  const config = resolveProjectConfig({
    env: {
      DATA_DIR: "/tmp/from-env",
      PROJECTS_ROOT_CONTAINER: "/tmp/projects-from-env",
      PROJECTS_ROOTS: JSON.stringify([{ id: "env", path: "/tmp/env-root" }])
    },
    envFileValues: {
      DATA_DIR: "/tmp/from-env-file",
      PROJECTS_ROOT_CONTAINER: "/tmp/projects-from-env-file",
      PROJECTS_ROOTS: JSON.stringify([{ id: "env-file", path: "/tmp/env-file-root" }])
    }
  });

  assert.equal(config.dataDir, "/tmp/from-env");
  assert.equal(config.legacyProjectsRootContainer, "/tmp/projects-from-env");
  assert.deepEqual(config.projectRoots, [
    { id: "env", path: "/tmp/env-root", writableRegistry: true }
  ]);
});

test("PROJECTS_ROOTS accepts canonical JSON array", () => {
  const roots = parseProjectRootsJson(JSON.stringify([
    { id: "personal", path: "/tmp/personal-projects" },
    { id: "work", path: "/tmp/work-projects", writableRegistry: false }
  ]));

  assert.deepEqual(roots, [
    { id: "personal", path: "/tmp/personal-projects", writableRegistry: true },
    { id: "work", path: "/tmp/work-projects", writableRegistry: false }
  ]);
});

test("PROJECTS_ROOTS rejects delimiter strings", () => {
  assert.throws(
    () => parseProjectRootsJson("/one:/two"),
    /JSON array/
  );
});

test("PROJECTS_ROOTS rejects duplicate ids", () => {
  assert.throws(
    () => parseProjectRootsJson(JSON.stringify([
      { id: "same", path: "/tmp/one" },
      { id: "same", path: "/tmp/two" }
    ])),
    /duplicate/i
  );
});

test("INTELLIGENCE_REGISTRY_WRITES_ENABLED defaults off and accepts explicit true values", () => {
  assert.equal(resolveProjectConfig({ env: {}, envFileValues: {} }).intelligenceRegistryWritesEnabled, false);
  assert.equal(resolveProjectConfig({
    env: { INTELLIGENCE_REGISTRY_WRITES_ENABLED: "true" },
    envFileValues: {}
  }).intelligenceRegistryWritesEnabled, true);
  assert.equal(resolveProjectConfig({
    env: { INTELLIGENCE_REGISTRY_WRITES_ENABLED: "1" },
    envFileValues: {}
  }).intelligenceRegistryWritesEnabled, true);
  assert.equal(resolveProjectConfig({
    env: { INTELLIGENCE_REGISTRY_WRITES_ENABLED: "yes" },
    envFileValues: {}
  }).intelligenceRegistryWritesEnabled, true);
  assert.equal(resolveProjectConfig({
    env: { INTELLIGENCE_REGISTRY_WRITES_ENABLED: "false" },
    envFileValues: { INTELLIGENCE_REGISTRY_WRITES_ENABLED: "true" }
  }).intelligenceRegistryWritesEnabled, false);
});
