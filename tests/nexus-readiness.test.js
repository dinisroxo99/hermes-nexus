import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { checkNexusReadiness } from "../src/routes/readiness.routes.js";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-ready-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  return { root, config: { projectRoots: [{ id: "dev", path: root }], dataDir } };
}

test("readiness accepts empty registries and accessible roots without writing a registry", (t) => {
  const { config } = fixture(t);
  assert.deepEqual(checkNexusReadiness(config), {
    ready: true, checks: { configuration: "ready", roots: "ready", registry: "ready", nativeProviders: "ready" }
  });
  assert.deepEqual(fs.readdirSync(config.dataDir), []);
  const missing = checkNexusReadiness({ ...config, projectRoots: [{ path: path.join(config.dataDir, "missing") }] });
  assert.equal(missing.ready, false);
  assert.equal(missing.checks.roots, "unavailable");
});

test("readiness refuses corrupt, oversized, symlink and contradictory project registries", (t) => {
  const { config } = fixture(t);
  const file = path.join(config.dataDir, "projects.json");
  const failures = ["{}", '[{"relativePath":"child"}]', "[", "x".repeat(4 * 1024 * 1024 + 1)];
  for (const raw of failures) {
    fs.writeFileSync(file, raw);
    assert.equal(checkNexusReadiness(config).checks.registry, "unavailable");
  }
  fs.writeFileSync(file, JSON.stringify([{ name: "one", relativePath: "one", projectId: "PrJ_One" }]));
  fs.writeFileSync(path.join(config.dataDir, "discovered-projects.json"),
    JSON.stringify([{ name: "two", relativePath: "two", projectId: "PrJ_One" }]));
  assert.equal(checkNexusReadiness(config).ready, false);
  fs.unlinkSync(file);
  fs.symlinkSync("discovered-projects.json", file);
  assert.equal(checkNexusReadiness(config).checks.registry, "unavailable");
});
