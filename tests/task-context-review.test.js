import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskContextRequest } from "../src/lib/task-context-policy.js";
import { selectTaskContext } from "../src/lib/task-context-selection.js";
const request = normalizeTaskContextRequest({ projectId: "PrJ_Test", task: { title: "Inspect", paths: ["src/a.ts"] }, limits: { documents: 1 } });
const sourceFiles = [{ path: "AGENT.md", text: "" }, { path: "area/AGENT.md", text: "" }, { path: "PROJECT.md", text: "# Project" }, { path: "src/a.ts", text: "export class A {}" }];
const workspace = { id: "root", manifestPath: "AGENT.md", workspacePath: ".", scope: { include: [], exclude: [] }, permissions: { write: false } };

test("invalid workspace duplicates cannot shadow validated declaration metadata", () => {
  const rows = [{ ...workspace, scope: null, permissions: { write: true } }, workspace];
  const first = selectTaskContext(request, { sourceFiles, icm: { workspaces: rows } });
  const second = selectTaskContext(request, { sourceFiles, icm: { workspaces: [...rows].reverse() } });
  assert.deepEqual(first, second);
  assert.equal(first.constraints.items.length, 0);
});

test("normalized workspace paths retain the exact validated metadata binding", () => {
  const result = selectTaskContext(request, { sourceFiles, icm: { workspaces: [{ ...workspace, manifestPath: "area\\AGENT.md" }] } });
  assert.equal(result.constraints.items[0].declaredPermissions.write, false);
  assert.equal(result.constraints.items[0].provenance.source.path, "area/AGENT.md");
});

test("ambiguous contextual documents are rejected independent of order", () => {
  const documents = [{ path: "PROJECT.md", title: "Alpha", kind: "project" }, { path: "PROJECT.md", title: "Beta", kind: "project" }];
  const first = selectTaskContext(request, { sourceFiles, icm: { documents } });
  assert.deepEqual(first, selectTaskContext(request, { sourceFiles, icm: { documents: [...documents].reverse() } }));
  assert.equal(first.documents.items.length, 0);
});

test("distinct graph identities do not collapse into duplicate public symbol IDs", () => {
  const nodes = ["one", "two"].map((id) => ({ id, file: "src/a.ts", label: "A", kind: "class" }));
  const first = selectTaskContext(request, { sourceFiles, graph: { nodes, edges: [{ from: "one", to: "two" }] } });
  assert.equal(new Set(first.symbols.items.map((s) => s.id)).size, 2);
  assert.deepEqual(first, selectTaskContext(request, { sourceFiles, graph: { nodes: [...nodes].reverse(), edges: [{ from: "one", to: "two" }] } }));
});

test("ICM DTO collections are bounded and diagnostics sort before truncation", () => {
  for (const icm of [{ documents: {} }, { errors: new Array(1001).fill({ code: "issue" }) }]) {
    assert.throws(() => selectTaskContext(request, { sourceFiles, icm }), { code: "invalid_context_analysis" });
  }
  const errors = Array.from({ length: 250 }, (_, i) => ({ code: "issue", path: `src/${i}.ts` }));
  const first = selectTaskContext(request, { sourceFiles, icm: { errors } });
  assert.deepEqual(first, selectTaskContext(request, { sourceFiles, icm: { errors: [...errors].reverse() } }));
});
