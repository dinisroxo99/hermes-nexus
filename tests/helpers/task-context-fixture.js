import fs from "node:fs";
import path from "node:path";
import { gitFixture } from "./git-fixture.js";

export function taskContextFixture(t) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{}\n");
  f.write("tsconfig.json", "{}\n");
  f.write("src/one.ts", "export class One {}\n");
  f.write("src/unrelated.ts", "export class Unrelated {}\n");
  f.write("tests/one.test.ts", "import { One } from '../src/one'; export function OneTest() { return One; }\n");
  f.write("PROJECT.md", "# Fixture project\nCanonical project description.\n");
  f.write("AGENT.md", "---\nschemaVersion: 1\nworkspace:\n  id: root\n  project: fixture\nexecutor:\n  required: do-not-select\npermissions:\n  read: true\npreconditions:\n  - tests_green\nscope:\n  include:\n    - src/**\n---\nDO_NOT_PROMOTE_INSTRUCTIONS\n");
  f.commit();
  const manualProjectsFile = path.join(f.root, "projects.json");
  const entries = [{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_Context" }];
  fs.writeFileSync(manualProjectsFile, JSON.stringify(entries));
  return { ...f, entries, options: { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "discovered-projects.json") } }, request: { projectId: "PrJ_Context", task: { id: "task-1", title: "Fix One", paths: ["src/one.ts"] } } };
}
