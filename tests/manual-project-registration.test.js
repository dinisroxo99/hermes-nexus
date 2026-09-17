import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const executable = ["pwsh", process.platform === "win32" ? "powershell" : "powershell.exe"]
  .find((command) => spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { timeout: 10000 }).status === 0);
const options = { skip: !executable && "PowerShell is required for the manual registration integration tests" };

function fixture(t) {
  const toHost = (file) => executable === "powershell.exe" && process.platform !== "win32"
    ? execFileSync("wslpath", ["-w", file], { encoding: "utf8" }).trim()
    : file;
  const tempRoot = executable === "powershell.exe" && process.platform !== "win32"
    ? execFileSync("wslpath", ["-u", execFileSync(executable, ["-NoProfile", "-Command", "[IO.Path]::GetTempPath()"], { encoding: "utf8" }).trim()], { encoding: "utf8" }).trim()
    : os.tmpdir();
  const root = fs.mkdtempSync(path.join(tempRoot, "project-map-manual-script-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const dir of ["scripts", "data", "repos/first", "repos/moved", "repos/other"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  const script = path.join(root, "scripts", "add-hermes-project.ps1");
  fs.copyFileSync(new URL("../scripts/add-hermes-project.ps1", import.meta.url), script);
  fs.writeFileSync(path.join(root, ".env"), `PROJECTS_ROOT=${toHost(path.join(root, "repos"))}\n`);
  const registry = path.join(root, "data", "projects.json");
  return {
    registry,
    read: () => JSON.parse(fs.readFileSync(registry, "utf8")),
    write: (entries) => fs.writeFileSync(registry, JSON.stringify(entries)),
    add: (name, location) => spawnSync(executable, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", toHost(script), "-Name", name, "-Path", toHost(path.join(root, "repos", location))], { encoding: "utf8", timeout: 20000 })
  };
}

function succeeds(result) {
  assert.equal(result.status, 0, result.error?.message || result.stderr);
}

test("manual registration assigns an ID and retains it through relocation and rename", options, (t) => {
  const f = fixture(t);
  succeeds(f.add("service", "first"));
  const id = f.read()[0].projectId;
  assert.match(id || "", /^prj_[0-9a-f-]{36}$/);
  succeeds(f.add("service", "moved"));
  assert.equal(f.read()[0].projectId, id);
  succeeds(f.add("renamed", "moved"));
  assert.equal(f.read().length, 1);
  assert.equal(f.read()[0].projectId, id);
});

test("manual registration upgrades only the selected legacy entry", options, (t) => {
  const f = fixture(t);
  const untouched = { name: "other", relativePath: "other", projectId: "PrJ_Keep" };
  f.write([{ name: "service", relativePath: "first" }, untouched]);
  succeeds(f.add("service", "first"));
  assert.match(f.read().find((p) => p.name === "service").projectId || "", /^prj_/);
  assert.deepEqual(f.read().find((p) => p.name === "other"), untouched);
});

test("manual registration refuses conflicting name/path identity and malformed IDs without writing", options, (t) => {
  const f = fixture(t);
  for (const entries of [
    [{ name: "service", relativePath: "first", projectId: "PrJ_A" }, { name: "other", relativePath: "other", projectId: "PrJ_B" }],
    [{ name: "service", relativePath: "other", projectId: null }],
    [{ name: "service", relativePath: "other", projectId: "PrJ_bad\n" }]
  ]) {
    f.write(entries);
    const before = fs.readFileSync(f.registry, "utf8");
    const result = f.add("service", "other");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Ambiguous project registration|Invalid projectId/);
    assert.equal(fs.readFileSync(f.registry, "utf8"), before);
  }
});
