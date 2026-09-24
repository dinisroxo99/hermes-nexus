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

test("provider snapshots accept canonical repository identity and project it to wire revision", async () => {
  const { createProviderSnapshot } = await api();
  const project = { projectId: "PrJ_A" };
  const files = [{ path: "one.py", text: "class One: pass\n" }];
  const canonical = createProviderSnapshot(project, files, { status: "available", repositoryIdentity: "Repo_One", commitSha: "a".repeat(40) });
  const alias = createProviderSnapshot(project, files, { status: "available", repositoryId: "Repo_One", commitSha: "a".repeat(40) });
  const dual = createProviderSnapshot(project, files, { status: "available", repositoryIdentity: "Repo_One", repositoryId: "Repo_One", commitSha: "a".repeat(40) });
  assert.deepEqual(canonical.revision, alias.revision);
  assert.deepEqual(dual.revision, alias.revision);
  assert.equal(canonical.revision.repositoryId, "Repo_One");
  assert.equal(Object.hasOwn(canonical.revision, "repositoryIdentity"), false);
});

test("provider snapshots reject contradictory or malformed repository identity aliases", async () => {
  const { createProviderSnapshot } = await api();
  const project = { projectId: "PrJ_A" };
  const files = [{ path: "one.py", text: "class One: pass\n" }];
  for (const revision of [
    { repositoryIdentity: "Repo_One", repositoryId: "Repo_Two" },
    { repositoryIdentity: null, repositoryId: "Repo_One" },
    { repositoryIdentity: "Repo_One", repositoryId: null },
    { repositoryIdentity: "/private/.git" },
    { repositoryIdentity: "../repo" },
    { repositoryIdentity: "" },
    { repositoryIdentity: " repo" }
  ]) {
    assert.throws(() => createProviderSnapshot(project, files, { status: "available", ...revision }), { code: "invalid_analyzer_snapshot" });
  }
});

test("provider snapshot tokens change with canonical repository identity but not not_git null identity", async () => {
  const { createProviderSnapshot } = await api();
  const project = { projectId: "PrJ_A" };
  const files = [{ path: "one.py", text: "class One: pass\n" }];
  const repoOne = createProviderSnapshot(project, files, { status: "available", repositoryIdentity: "Repo_One", commitSha: "a".repeat(40) });
  const repoTwo = createProviderSnapshot(project, files, { status: "available", repositoryIdentity: "Repo_Two", commitSha: "a".repeat(40) });
  assert.notEqual(repoOne.token, repoTwo.token);
  const notGit = createProviderSnapshot(project, files, { status: "not_git" });
  assert.equal(notGit.revision.repositoryId, null);
  assert.deepEqual(notGit.revision, createProviderSnapshot(project, files, { status: "not_git", repositoryIdentity: undefined }).revision);
});

test("provider revision projection rejects internal metadata paths", async () => {
  const { createProviderSnapshot } = await api();
  for (const revision of [{ repositoryId: "/private/.git" }, { worktreeId: "C:\\private\\.git" }, { branch: "/private/.git/refs" }]) {
    assert.throws(() => createProviderSnapshot({ projectId: "PrJ_A" }, [], revision), { code: "invalid_analyzer_snapshot" });
  }
});

test("polyglot symbol labels are bounded data without path or control forms", async () => {
  const { isAnalyzerSymbolLabel } = await api();
  for (const label of ["Get-Thing", "C::Thing", "operator+", "Thing.method(int)"]) assert.equal(isAnalyzerSymbolLabel(label), true);
  for (const label of ["", "a".repeat(129), "x\ncommand", "/private/.git", "file:///private", "C:relative", "../outside"]) assert.equal(isAnalyzerSymbolLabel(label), false);
});
