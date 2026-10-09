import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryFileSystemHost } from "ts-morph";
import { gitFixture } from "./helpers/git-fixture.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { analyzeProviderSnapshot } from "../src/analyzers/common/analyzer-providers.js";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

// N1 boundaries (acceptance criteria 1, 3, 4, 5):
// P-*   the pure-barrel definition: a PURE barrel is a file whose every top-level statement is an `export … from`
//       re-export (at least one). Having no recognised graph symbols is NOT sufficient; every negative case below has
//       an anchor-free or anchored file that is not a pure barrel and must receive no anchor edge.
// D11-* the amended anchor contract: no name match to an anchor, no symbol resolution to an anchor, no incoming edge
//       to the anchor of a non-pure-barrel file, and an exact set of edges into anchors.
// D3a-* ambiguous star names: conservative candidates are linked but the result is partial, also when caps are hit.
// D6a-* tsconfig paths for the checker: resolution only over snapshot files, no host or out-of-snapshot reads.
const SNAPSHOT_PROJECT = { name: "snapshot", absolutePath: "/__project_context__" };
const LIMITS = { nodeLimit: 2000, edgeLimit: 4000 };
const LIB = "export function helper() { return 1; }\n";
const use = (names, from) => `import { ${names} } from "${from}";\nexport function Use() { return [${names.replace(/\S+ as /g, "")}]; }\n`;
const sources = (files) => Object.entries({ "package.json": "{\"type\":\"module\"}\n", ...files }).map(([file, text]) => ({ path: file, text }));

function graph(files, limits = LIMITS, project = SNAPSHOT_PROJECT) {
  const result = analyzeTypeScriptProject(project, { ...limits, sourceFiles: sources(files) });
  assert.equal(result.success, true, result.message);
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  const name = (id) => `${byId.get(id).file}:${byId.get(id).label}`;
  return {
    result,
    anchors: result.nodes.filter((node) => node.kind === "module").map((node) => node.file).sort(),
    into: result.edges.filter((edge) => byId.get(edge.to).kind === "module").map((edge) => `${name(edge.from)} -> ${byId.get(edge.to).file}`).sort(),
    from: (file) => result.edges.filter((edge) => byId.get(edge.from).file === file).map((edge) => `${name(edge.from)} -> ${name(edge.to)}`).sort(),
    unrep: result.unrepresentedImports
  };
}

// ---- P: pure-barrel definition (criterion 1) ----

test("P-1 positive: a file made only of `export … from` re-exports is a pure barrel; its importer gets the file-level anchor edge", () => {
  const g = graph({ "src/lib.js": LIB, "src/index.js": "export * from \"./lib.js\";\n", "src/consumer.js": use("helper", "./index.js") });
  assert.deepEqual(g.into, ["src/consumer.js:Use -> src/index.js"]);
  assert.equal(g.unrep, 0);
});

test("P-2 positive: a type-only re-export file (`export type { T } from`) is a pure barrel", () => {
  const g = graph({ "src/shapes.ts": "export interface Shape { id: string }\n", "src/index.ts": "export type { Shape } from \"./shapes\";\n",
    "src/consumer.ts": "import type { Shape } from \"./index\";\nexport function Use(s: Shape) { return s.id; }\n" });
  assert.deepEqual(g.into, ["src/consumer.ts:Use -> src/index.ts"]);
  assert.equal(g.unrep, 0);
});

test("P-3 negative: a symbol-less imports-only (non-barrel) file is not a pure barrel: no edge into its anchor; importer counted", () => {
  const g = graph({ "src/lib.js": LIB, "src/io.js": "import { helper } from \"./lib.js\";\nimport \"./lib.js\";\n", "src/consumer.js": use("helper", "./io.js") });
  assert.deepEqual(g.anchors, ["src/io.js"]);
  assert.deepEqual(g.into, []);
  assert.ok(g.unrep >= 1, String(g.unrep));
});

test("P-4 negative: side-effect-only files (with and without a local import) are not pure barrels: no anchor edges; importer counted", () => {
  const withImport = graph({ "src/lib.js": LIB, "src/side.js": "import \"./lib.js\";\nglobalThis.booted = true;\n", "src/consumer.js": "import \"./side.js\";\nexport function Use() { return 1; }\n" });
  assert.deepEqual(withImport.anchors, ["src/side.js"]);
  assert.deepEqual(withImport.into, []);
  assert.ok(withImport.unrep >= 1);
  const bare = graph({ "src/boot.js": "globalThis.booted = true;\n", "src/consumer.js": "import \"./boot.js\";\nexport function Use() { return 1; }\n" });
  assert.deepEqual(bare.anchors, []);
  assert.deepEqual(bare.into, []);
  assert.ok(bare.unrep >= 1);
});

test("P-5 negative: a mixed barrel with its own symbol has no anchor and gets no anchor edge; importer of a re-exported name counted", () => {
  const g = graph({ "src/lib.js": LIB, "src/index.js": "export function own() { return 0; }\nexport * from \"./lib.js\";\n", "src/consumer.js": use("helper", "./index.js") });
  assert.deepEqual(g.anchors, []);
  assert.deepEqual(g.into, []);
  assert.ok(g.unrep >= 1);
});

// "No recognised symbols" is not enough: each of these files is symbol-less (so it HAS an anchor) and re-exports,
// but it also contains something that is not a re-export, so it is a mixed barrel and never an anchor target.
for (const [name, text] of [
  ["lowercase export const", "export const version = 1;\nexport * from \"./lib.js\";\n"],
  ["import statement", "import { helper } from \"./lib.js\";\nexport * from \"./lib.js\";\nhelper();\n"],
  ["local export clause", "import { helper as h } from \"./lib.js\";\nexport { h };\nexport * from \"./lib.js\";\n"],
  ["side-effect statement", "export * from \"./lib.js\";\nconsole.log(\"loaded\");\n"]
]) {
  test(`P-6 negative: symbol-less mixed barrel (${name}) is not a pure barrel: anchored but receives no edge; importer counted`, () => {
    const g = graph({ "src/lib.js": LIB, "src/index.js": text, "src/consumer.js": use("helper", "./index.js") });
    assert.deepEqual(g.anchors, ["src/index.js"]);
    assert.deepEqual(g.into, []);
    assert.ok(g.unrep >= 1, String(g.unrep));
  });
}

test("P-7 negative: type-only files that are not `export … from` re-exports (local `export type {}`, type declarations) get no anchor edge", () => {
  const local = graph({ "src/shapes.ts": "export interface Shape { id: string }\n", "src/types.ts": "import type { Shape } from \"./shapes\";\nexport type { Shape };\n",
    "src/consumer.ts": "import type { Shape } from \"./types\";\nexport function Use(s: Shape) { return s.id; }\n" });
  assert.deepEqual(local.anchors, ["src/types.ts"]);
  assert.deepEqual(local.into, []);
  assert.ok(local.unrep >= 1);
  const declarations = graph({ "src/types.ts": "export type Id = string;\nexport interface Shape { id: Id }\n",
    "src/consumer.ts": "import type { Shape } from \"./types\";\nexport function Use(s: Shape) { return s.id; }\n" });
  assert.deepEqual(declarations.anchors, []);
  assert.deepEqual(declarations.into, []);
  assert.deepEqual(declarations.from("src/consumer.ts"), ["src/consumer.ts:Use -> src/types.ts:Shape"]);
});

test("P-8 a symbol-less mixed barrel as Impact target is never silently complete (partial, provider_partial)", (t) => {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{\"type\":\"module\"}\n");
  for (const [file, text] of Object.entries({ "src/lib.js": LIB, "src/index.js": "export const version = 1;\nexport * from \"./lib.js\";\n",
    "src/consumer.js": use("helper", "./index.js") })) f.write(file, text);
  f.commit();
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_N1P" }]));
  const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "d.json") } };
  const i = buildProjectImpact("PrJ_N1P", { paths: ["src/index.js"], includeTests: true }, options);
  assert.equal(i.status, "partial");
  assert.ok(Object.values(i.completeness).flat().includes("provider_partial"));
});

// ---- D11: anchor boundary (criterion 5) ----

test("D11-1 no name match to an anchor: importing the name \"<module>\" (unresolved package, plain module, pure barrel) links no anchor by name", () => {
  const g = graph({ "src/lib.js": LIB, "src/index.js": "export * from \"./lib.js\";\n", "src/outer.js": "export * from \"./index.js\";\n",
    "src/symbolless.js": "import { helper } from \"./lib.js\";\nhelper();\n", "src/consumer.js": use("helper", "./outer.js"),
    "src/caller.js": "import { \"<module>\" as m1 } from \"missing-pkg\";\nimport { \"<module>\" as m2 } from \"./lib.js\";\nexport function Caller() { return [m1, m2]; }\n",
    "src/caller2.js": "import { \"<module>\" as m3 } from \"./index.js\";\nexport function Caller2() { return m3; }\n" });
  assert.deepEqual(g.anchors, ["src/index.js", "src/outer.js", "src/symbolless.js"]);
  assert.deepEqual(g.from("src/caller.js"), []);
  // caller2's only edge is the file-level dependency on the pure barrel it imports; the name resolves to nothing.
  assert.deepEqual(g.from("src/caller2.js"), ["src/caller2.js:Caller2 -> src/index.js:<module>"]);
  assert.deepEqual(g.into, ["src/caller2.js:Caller2 -> src/index.js", "src/consumer.js:Use -> src/outer.js", "src/outer.js:<module> -> src/index.js"]);
  assert.ok(g.unrep >= 1);
});

test("D11-2 no symbol resolution to an anchor: names re-exported from symbol-less files (`* as ns`, lowercase const) never resolve to their anchors", () => {
  const g = graph({ "src/lib.js": LIB, "src/symbolless.js": "import { helper } from \"./lib.js\";\nhelper();\n",
    "src/lower.js": "import { helper } from \"./lib.js\";\nexport const a = helper;\n",
    "src/index.js": "export * as ns from \"./symbolless.js\";\nexport { a } from \"./lower.js\";\n", "src/consumer.js": use("ns, a", "./index.js") });
  assert.deepEqual(g.anchors, ["src/index.js", "src/lower.js", "src/symbolless.js"]);
  assert.deepEqual(g.from("src/consumer.js"), ["src/consumer.js:Use -> src/index.js:<module>"]);
  assert.deepEqual(g.from("src/index.js"), []);
  assert.deepEqual(g.into, ["src/consumer.js:Use -> src/index.js"]);
  assert.ok(g.unrep >= 2, String(g.unrep));
});

test("D11-3 no incoming edge to the anchor of a non-pure-barrel file (symbol-less, side-effect, mixed barrel), also via a pure barrel re-export", () => {
  const g = graph({ "src/lib.js": LIB, "src/symbolless.js": "import { helper } from \"./lib.js\";\nhelper();\n",
    "src/side.js": "import \"./lib.js\";\nglobalThis.booted = true;\n", "src/mixed.js": "export const v = 1;\nexport * from \"./lib.js\";\n",
    "src/reexp.js": "export * from \"./symbolless.js\";\nexport * from \"./mixed.js\";\n",
    "src/consumer.js": "import { thing } from \"./symbolless.js\";\nimport \"./side.js\";\nimport { helper } from \"./mixed.js\";\nimport { helper as h2 } from \"./reexp.js\";\nexport function Use() { return [thing, helper, h2]; }\n" });
  assert.deepEqual(g.anchors, ["src/mixed.js", "src/reexp.js", "src/side.js", "src/symbolless.js"]);
  assert.deepEqual(g.into, ["src/consumer.js:Use -> src/reexp.js"]);
  assert.ok(g.unrep >= 1);
});

test("D11-4 exact set of edges into anchors: importers (symbol and anchor sources, side-effect import) and outer barrels (pure and mixed) only", () => {
  const g = graph({ "src/lib.js": LIB, "src/index.js": "export * from \"./lib.js\";\n",
    "src/outer.js": "export * from \"./index.js\";\nexport { helper as aliasHelper } from \"./lib.js\";\n",
    "tests/a.test.js": "import { helper } from \"../src/index.js\";\nhelper();\n", "src/consumer.js": use("aliasHelper", "./outer.js"),
    "src/mixed.js": "export function own() { return 0; }\nexport * from \"./index.js\";\n", "src/side.js": "import \"./index.js\";\n" });
  assert.deepEqual(g.into, [
    "src/consumer.js:Use -> src/outer.js",
    "src/mixed.js:own -> src/index.js",
    "src/outer.js:<module> -> src/index.js",
    "src/side.js:<module> -> src/index.js",
    "tests/a.test.js:<module> -> src/index.js"
  ]);
  assert.equal(g.unrep, 0);
});

// ---- D3a: ambiguous star names (criterion 3) ----

const COLLISION = { "src/x.js": "export function a() { return 1; }\n", "src/y.js": "export function a() { return 2; }\n",
  "src/index.js": "export * from \"./x.js\";\nexport * from \"./y.js\";\n", "src/consumer.js": use("a", "./index.js") };

test("D3a-1 an ambiguous star name links both candidates with identical, unmarked edges and is counted once (partial, not a resolution)", () => {
  const g = graph(COLLISION);
  assert.deepEqual(g.from("src/consumer.js"), ["src/consumer.js:Use -> src/index.js:<module>", "src/consumer.js:Use -> src/x.js:a", "src/consumer.js:Use -> src/y.js:a"]);
  const candidates = g.result.edges.filter((edge) => g.result.nodes.find((node) => node.id === edge.to)?.label === "a" && g.result.nodes.find((node) => node.id === edge.from)?.label === "Use");
  assert.equal(candidates.length, 2);
  assert.deepEqual(new Set(candidates.map((edge) => `${edge.relation}|${edge.label}`)).size, 1);
  assert.equal(g.unrep, 1);
  const provider = analyzeProviderSnapshot({ projectId: "Prj_Barrel" }, sources(COLLISION), { revision: { status: "not_git" } });
  assert.equal(provider.status, "partial");
  assert.equal(provider.limited, false);
  for (const edge of provider.edges) assert.deepEqual(Object.keys(edge).sort(), ["from", "relation", "to"]);
});

test("D3a-2 caps hit: with node/edge caps the ambiguity is still counted (before the cap) and the provider stays partial; a capped unambiguous graph is partial too", () => {
  const capped = graph(COLLISION, { nodeLimit: 2000, edgeLimit: 1 });
  assert.equal(capped.result.limited, true);
  assert.equal(capped.unrep, 1);
  const nodeCapped = graph(COLLISION, { nodeLimit: 1, edgeLimit: 4000 });
  assert.equal(nodeCapped.result.limited, true);
  assert.equal(nodeCapped.unrep, 1);
  for (const limits of [{ edgeLimit: 1 }, { nodeLimit: 1 }]) {
    const provider = analyzeProviderSnapshot({ projectId: "Prj_Barrel" }, sources(COLLISION), { revision: { status: "not_git" }, ...limits });
    assert.equal(provider.status, "partial", JSON.stringify(limits));
    assert.equal(provider.limited, true, JSON.stringify(limits));
  }
  const single = { "src/x.js": "export function a() { return 1; }\n", "src/index.js": "export * from \"./x.js\";\n", "src/consumer.js": use("a", "./index.js") };
  assert.equal(analyzeProviderSnapshot({ projectId: "Prj_Barrel" }, sources(single), { revision: { status: "not_git" } }).status, "available");
  assert.equal(analyzeProviderSnapshot({ projectId: "Prj_Barrel" }, sources(single), { revision: { status: "not_git" }, edgeLimit: 1 }).status, "partial");
});

test("D3a-3 nested ambiguity across two-star barrels (index: x + mid; mid: y + z) links all three candidates and stays partial", () => {
  const g = graph({ "src/x.js": "export function a() { return 1; }\n", "src/y.js": "export function a() { return 2; }\n", "src/z.js": "export function a() { return 3; }\n",
    "src/mid.js": "export * from \"./y.js\";\nexport * from \"./z.js\";\n", "src/index.js": "export * from \"./x.js\";\nexport * from \"./mid.js\";\n",
    "src/consumer.js": use("a", "./index.js") });
  assert.deepEqual(g.from("src/consumer.js"), ["src/consumer.js:Use -> src/index.js:<module>", "src/consumer.js:Use -> src/x.js:a", "src/consumer.js:Use -> src/y.js:a", "src/consumer.js:Use -> src/z.js:a"]);
  assert.ok(g.unrep >= 1);
});

// ---- D6a: tsconfig paths over snapshot files only (criterion 4) ----

test("D6a-1 the checker resolves tsconfig paths only over snapshot files: no host file-system access, in-memory reads only of snapshot sources, out-of-snapshot targets stay unresolved (counted)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n1-d6a-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  // Real files that exist on disk but are NOT admitted to the snapshot: one outside the project, one inside it.
  for (const [file, text] of [["outside/x.js", "export function a() { return 9; }\n"], ["project/src/hidden.js", "export function h() { return 8; }\n"]]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const files = {
    "tsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\".\",\"paths\":{\"@lib/*\":[\"src/*\"],\"@ext/*\":[\"../outside/*\"]}}}\n",
    "src/x.js": "export function a() { return 1; }\n", "src/y.js": "export function c() { return 3; }\n",
    "src/index.js": "export { a as b } from \"@lib/x.js\";\nexport { a as e } from \"@ext/x.js\";\nexport { h } from \"./hidden.js\";\nexport * from \"./y.js\";\n",
    "src/consumer.js": use("b, c, e, h", "./index.js")
  };
  const snapshotPaths = new Set(sources(files).map((file) => path.join(projectRoot, file.path)));
  const hostCalls = [];
  const memoryCalls = [];
  const fsMethods = ["readFileSync", "existsSync", "statSync", "lstatSync", "readdirSync", "realpathSync", "openSync", "accessSync", "readFile", "stat", "readdir"];
  const memoryMethods = ["readFileSync", "readFile", "fileExistsSync", "fileExists", "directoryExistsSync", "readDirSync", "realpathSync"];
  const spied = (run) => {
    const restore = [];
    for (const method of fsMethods) {
      const original = fs[method];
      fs[method] = function spy(...args) { hostCalls.push(`${method} ${String(args[0])}`); return original.apply(this, args); };
      restore.push(() => { fs[method] = original; });
    }
    for (const method of memoryMethods) {
      const original = InMemoryFileSystemHost.prototype[method];
      InMemoryFileSystemHost.prototype[method] = function spy(...args) {
        const result = original.apply(this, args);
        memoryCalls.push({ method, file: String(args[0]), result });
        return result;
      };
      restore.push(() => { InMemoryFileSystemHost.prototype[method] = original; });
    }
    try { return run(); } finally { for (const undo of restore.reverse()) undo(); }
  };
  const g = spied(() => graph(files, LIMITS, { name: "snapshot", absolutePath: projectRoot }));
  // The compiler host is the in-memory host: it was asked about the out-of-snapshot targets (not vacuous) ...
  assert.ok(memoryCalls.some((call) => call.file.includes(`${path.sep}outside`)), "checker probed the out-of-project alias target");
  assert.ok(memoryCalls.some((call) => call.file.includes("hidden")), "checker probed the not-admitted file");
  // ... and answered from snapshot sources only: every positive file answer and every read is a snapshot path.
  const positives = memoryCalls.filter((call) => ["fileExistsSync", "fileExists", "readFileSync", "readFile"].includes(call.method) && call.result !== false);
  assert.deepEqual(positives.filter((call) => !snapshotPaths.has(call.file)), [], JSON.stringify(positives));
  assert.deepEqual(memoryCalls.filter((call) => /outside|hidden/.test(call.file) && call.result !== false), []);
  // No host file-system access at all during snapshot analysis (the spy itself is proven live by the legacy control).
  assert.deepEqual(hostCalls, [], "no host file-system access during snapshot analysis");
  spied(() => analyzeTypeScriptProject({ name: "legacy", absolutePath: path.join(root, "outside") }, LIMITS));
  assert.ok(hostCalls.length > 0, "spy control: legacy analysis reads the host file system");
  // The admitted alias target resolves (D6a) ...
  assert.ok(g.from("src/consumer.js").includes("src/consumer.js:Use -> src/x.js:a"), JSON.stringify(g.from("src/consumer.js")));
  // ... the out-of-project alias and the on-disk-but-not-admitted file do not: no node, no edge, counted (partial).
  assert.equal(g.result.nodes.some((node) => /outside|hidden/.test(node.file)), false);
  assert.ok(g.unrep >= 2, String(g.unrep));
});

test("D6a-2 an alias whose target is not in the snapshot (missing path, outside the project) stays partial in Impact", (t) => {
  for (const [name, paths, specifier] of [["missing", "{\"@gone/*\":[\"src/gone/*\"]}", "@gone/x.js"], ["outside", "{\"@ext/*\":[\"../outside/*\"]}", "@ext/x.js"]]) {
    const f = gitFixture(t, { committed: false });
    f.write("package.json", "{\"type\":\"module\"}\n");
    f.write("tsconfig.json", `{"compilerOptions":{"baseUrl":".","paths":${paths}}}\n`);
    f.write("../outside/x.js", "export function a() { return 9; }\n");
    for (const [file, text] of Object.entries({ "src/y.js": "export function c() { return 3; }\n",
      "src/index.js": `export { a as b } from "${specifier}";\nexport * from "./y.js";\n`, "src/consumer.js": use("b, c", "./index.js") })) f.write(file, text);
    f.commit();
    const manualProjectsFile = path.join(f.root, "projects.json");
    fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_N1A" }]));
    const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "d.json") } };
    const i = buildProjectImpact("PrJ_N1A", { paths: ["src/y.js"], includeTests: false }, options);
    assert.equal(i.status, "partial", name);
    assert.ok(Object.values(i.completeness).flat().includes("provider_partial"), name);
  }
});
