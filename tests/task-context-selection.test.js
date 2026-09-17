import test from "node:test";
import assert from "node:assert/strict";

async function api() {
  const policy = await import("../src/lib/task-context-policy.js").catch(() => ({}));
  const selector = await import("../src/lib/task-context-selection.js").catch(() => ({}));
  assert.equal(typeof policy.normalizeTaskContextRequest, "function");
  assert.equal(typeof selector.selectTaskContext, "function");
  return { ...policy, ...selector };
}

test("task context request bounds reuse path safety and never accept policy overrides", async () => {
  const { normalizeTaskContextRequest: normalize } = await api();
  const request = normalize({ projectId: "PrJ_A", task: { title: " Fix source ", paths: ["src\\one.ts", "src/one.ts"] } });
  assert.deepEqual(request.task.paths, ["src/one.ts"]);
  assert.equal(request.task.title, "Fix source");
  for (const paths of [["../other.ts"], ["C:other.ts"], [".git/config"], [".env"], Array(33).fill("a.ts")]) {
    assert.throws(() => normalize({ projectId: "PrJ_A", task: { title: "task", paths } }));
  }
  assert.throws(() => normalize({ projectId: "PrJ_A", task: { title: "task" }, trustedPolicy: ["allow_all"] }), { code: "invalid_task_context_request" });
});

test("task selection is bounded, deterministic, project-local and provenance-labelled", async () => {
  const { normalizeTaskContextRequest, selectTaskContext } = await api();
  const request = normalizeTaskContextRequest({ projectId: "PrJ_A", task: { title: "Fix One", paths: ["src/one.ts"] }, limits: { symbols: 1 } });
  const sources = [
    { path: "src/one.ts", text: "export class One {}" },
    { path: "src/two.ts", text: "export class Two {}" },
    { path: "src/unrelated.ts", text: "export class Unrelated {}" },
    { path: "tests/one.test.ts", text: "test one" },
    { path: "PROJECT.md", text: "# Canonical project" },
    { path: "AGENT.md", text: "front matter fixture" }
  ];
  const graph = { nodes: [
    { id: "/private/one", label: "One", kind: "class", file: "src/one.ts" },
    { id: "/private/two", label: "Two", kind: "class", file: "src/two.ts" },
    { id: "other", label: "Unrelated", kind: "class", file: "src/unrelated.ts" },
    { id: "outside", label: "Outside", kind: "class", file: "../outside.ts" }
  ], edges: [{ from: "/private/one", to: "/private/two", relation: "uses" }] };
  const icm = { valid: true, workspaces: [{ id: "root", manifestPath: "AGENT.md", workspacePath: ".", scope: { include: [], exclude: [] }, permissions: { read: true }, executor: { required: "DO_NOT_SELECT" }, routing: { success: "DO_NOT_ROUTE" } }], documents: [{ path: "PROJECT.md", kind: "project", title: "Canonical project" }] };
  const first = selectTaskContext(request, { sourceFiles: sources, graph, icm });
  assert.equal(first.symbols.items.length, 1);
  assert.equal(first.symbols.truncated, true);
  assert.equal(first.references.items.length, 1);
  assert.equal(first.tests.items[0].path, "tests/one.test.ts");
  for (const section of Object.values(first)) assert.ok(section.provenance.trust);
  const serialized = JSON.stringify(first);
  for (const forbidden of ["/private/", "Outside", "Unrelated", "DO_NOT_SELECT", "DO_NOT_ROUTE"]) assert.equal(serialized.includes(forbidden), false);
  assert.deepEqual(selectTaskContext(request, { sourceFiles: [...sources].reverse(), graph: { nodes: [...graph.nodes].reverse(), edges: [...graph.edges].reverse() }, icm }), first);
});

test("excerpts are opt-in, UTF-8 bounded and redact common secret assignments", async () => {
  const { normalizeTaskContextRequest: normalize, selectTaskContext: select } = await api();
  const sourceFiles = [{ path: "safe.ts", text: "const password = 'SECRET_SENTINEL';\n" + "é".repeat(1000) }];
  const input = { projectId: "PrJ_A", task: { title: "Inspect", paths: ["safe.ts"] } };
  const plain = select(normalize(input), { sourceFiles });
  assert.equal(Object.hasOwn(plain.files.items[0], "excerpt"), false);
  const expanded = select(normalize({ ...input, includeExcerpts: true }), { sourceFiles });
  assert.equal(JSON.stringify(expanded).includes("SECRET_SENTINEL"), false);
  assert.ok(Buffer.byteLength(expanded.files.items[0].excerpt.text) <= 512);
  assert.equal(expanded.files.items[0].excerpt.text.includes("\ufffd"), false);
});

test("section truncation distinguishes exact limit from actual omission", async () => {
  const { normalizeTaskContextRequest: normalize, selectTaskContext: select } = await api();
  const request = normalize({ projectId: "PrJ_A", task: { title: "Inspect", paths: ["src"] }, limits: { files: 1, symbols: 999 } });
  assert.equal(request.limits.symbols, 64);
  const sourceFiles = [{ path: "src/a.ts", text: "a" }];
  assert.equal(select(request, { sourceFiles }).files.truncated, false);
  assert.equal(select(request, { sourceFiles: [...sourceFiles, { path: "src/b.ts", text: "b" }] }).files.truncated, true);
});
