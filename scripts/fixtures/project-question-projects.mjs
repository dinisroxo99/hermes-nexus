import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The source histories are authored separately from the answer key. Only this module writes fixture files.
const PROJECTS = [
  { name: "alpha", projectId: "PrJ_GoldenAlpha", history: [
    { message: "Add alpha sources", files: {
      "package.json": '{"type":"module"}\n',
      "tsconfig.json": "{}\n",
      "src/shared.ts": "export class Shared {}\n",
      "src/use.ts": "import { Shared } from './shared'; export function Use() { return Shared; }\n",
      "tests/shared.test.ts": "import { Shared } from '../src/shared'; export function TestShared() { return Shared; }\n",
      "src/old.ts": "export class Old {}\n",
      "src/independent.ts": "export class Independent {}\n"
    } },
    { message: "Revise old source", files: { "src/old.ts": "export class Old { version = 2; }\n" } },
    { message: "Delete old source", files: { "src/old.ts": null } }
  ] },
  { name: "beta", projectId: "PrJ_GoldenBeta", history: [
    { message: "Add beta sources", files: {
      "package.json": '{"type":"module"}\n',
      "tsconfig.json": "{}\n",
      "alt/namesake.ts": "export class Shared {}\n",
      "analysis/unsupported.py": "class PythonOnly:\n    pass\n"
    } }
  ] }
];

export function createQuestionProjects(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C",
    GIT_AUTHOR_NAME: "Nexus Golden", GIT_COMMITTER_NAME: "Nexus Golden",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z"
  });
  const entries = [];
  for (const { name, projectId, history } of PROJECTS) {
    const cwd = path.join(root, name);
    fs.mkdirSync(cwd);
    const git = (args) => execFileSync("git", ["-c", "core.autocrlf=false", ...args],
      { cwd, env, timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
    git(["init", "--template=", "--object-format=sha1", "--initial-branch=main"]);
    for (const { message, files } of history) {
      for (const [file, content] of Object.entries(files)) {
        const location = path.join(cwd, file);
        if (content === null) fs.unlinkSync(location);
        else {
          fs.mkdirSync(path.dirname(location), { recursive: true });
          fs.writeFileSync(location, content, { mode: 0o644 });
        }
      }
      git(["add", "."]);
      git(["commit", "--no-gpg-sign", "-m", message]);
    }
    entries.push({ name, relativePath: name, rootId: "golden", projectId });
  }
  const manualProjectsFile = path.join(root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify(entries));
  return { registry: { roots: [{ id: "golden", path: root }], manualProjectsFile,
    discoveredProjectsFile: path.join(root, "discovered-projects.json") } };
}
