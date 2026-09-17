import test from "node:test";
import assert from "node:assert/strict";
async function api() { const m = await import("../src/analyzers/common/analyzer-provider-contract.js").catch(() => ({})); assert.equal(typeof m.normalizeProviderDescriptor, "function"); return m; }

test("provider descriptors explicitly bound and canonicalize every capability", async () => {
  const { normalizeProviderDescriptor } = await api();
  const input = { id: "external.lsp", version: "1", kind: "external", priority: 20, languages: ["python", "go", "python"], capabilities: { symbols: "semantic", boundedSourceAnalysis: "structural" } };
  const result = normalizeProviderDescriptor(input);
  assert.deepEqual(result.languages, ["go", "python"]);
  assert.equal(result.capabilities.definitions, "unsupported");
  assert.equal(result.capabilities.symbols, "semantic");
  assert.throws(() => normalizeProviderDescriptor({ ...input, capabilities: { symbols: true } }), { code: "invalid_analyzer_provider" });
  assert.throws(() => normalizeProviderDescriptor({ ...input, analyze: () => {} }), { code: "invalid_analyzer_provider" });
  assert.throws(() => normalizeProviderDescriptor({ ...input, priority: Infinity }), { code: "invalid_analyzer_provider" });
  assert.ok(Object.isFrozen(result.capabilities));
});

test("snapshot language discovery is deterministic and does not claim semantic support", async () => {
  const { detectSnapshotLanguages } = await api();
  const files = ["a.ts", "b.js", "c.cs", "d.py", "e.go", "f.rs", "g.java", "h.sh", "i.ps1", "PROJECT.md"].map((path) => ({ path, text: "" }));
  assert.deepEqual(detectSnapshotLanguages(files), ["bash", "csharp", "go", "java", "javascript", "powershell", "python", "rust", "typescript"]);
  assert.deepEqual(detectSnapshotLanguages(files), detectSnapshotLanguages([...files].reverse()));
});

test("provider snapshots bind identity, revision and content without leaking filesystem locations", async () => {
  const { createProviderSnapshot } = await api();
  const project = { name: "fixture", projectId: "PrJ_A", absolutePath: "/private/project" };
  const files = [{ path: "one.py", text: "class One: pass" }];
  const first = createProviderSnapshot(project, files, { status: "available", commitSha: "a".repeat(40), worktreeId: "wt_one" });
  assert.equal(JSON.stringify(first).includes("/private"), false);
  assert.notEqual(first.token, createProviderSnapshot({ ...project, projectId: "PrJ_B" }, files, first.revision).token);
  assert.notEqual(first.token, createProviderSnapshot(project, files, { ...first.revision, worktreeId: "wt_two" }).token);
  assert.notEqual(first.token, createProviderSnapshot(project, [{ path: "one.py", text: "changed" }], first.revision).token);
  assert.ok(Object.isFrozen(first.files));
});
