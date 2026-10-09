import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { gitFixture } from "./helpers/git-fixture.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

// N1 tsconfig (user option A, snapshot mode only). C-* pin:
// - ONE parse of the snapshot tsconfig with TypeScript's JSONC config parser, used by the alias resolver AND the D6a
//   checker: comments, `*/` and `/**/` inside strings (include globs), trailing commas (C-1..C-3, C-15);
// - `extends` followed only through configs admitted to the snapshot; an unresolved extends, an extends cycle or an
//   invalid config is counted (partial) and never collapses into an empty config (C-4..C-7, C-14 spy);
// - an alias that matches a `paths` pattern but resolves to no snapshot file is counted even when the name fallback
//   draws an edge (C-8);
// - TypeScript pattern precedence pins: equal-prefix ties in tsconfig order, exact before an equal-length wildcard,
//   prefix length rather than pattern length (C-9..C-11); legacy keeps first-match (C-12); anchors and the counter
//   use the same selection (C-13).
const LIMITS = { nodeLimit: 2000, edgeLimit: 4000 };
function project(t, files, { tests = true } = {}) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{\"type\":\"module\"}\n");
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  if (tests) f.write("tests/consumer.test.js", "import test from \"node:test\";\nimport { use } from \"../src/consumer.js\";\ntest(\"use\", () => use());\n");
  f.commit();
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_N1T" }]));
  const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "d.json") } };
  return { repo: f.repo, impact: (origin) => buildProjectImpact("PrJ_N1T", { paths: [origin], includeTests: true }, options) };
}
function snapshotGraph(files, root = "/__project_context__") {
  const all = { "package.json": "{\"type\":\"module\"}\n", ...files };
  const r = analyzeTypeScriptProject({ name: "snapshot", absolutePath: root }, { ...LIMITS, sourceFiles: Object.entries(all).map(([file, text]) => ({ path: file, text })) });
  const byId = new Map(r.nodes.map((n) => [n.id, n]));
  const name = (id) => `${byId.get(id).file}:${byId.get(id).label}`;
  return { result: r, edges: r.edges.map((e) => `${name(e.from)} -> ${name(e.to)} [${e.label}]`).sort(), unrep: r.unrepresentedImports };
}
const affected = (i) => i.affectedFiles.map((a) => a.path).sort();
const testsOf = (i) => i.affectedTests.candidates.map((c) => c.path).sort();
const reasons = (i) => Object.values(i.completeness).flat().sort();
const A = (n) => `export function a() { return ${n}; }\n`;
const STAR = "export * from \"./x.js\";\n";
const CONSUMER = (specifier) => `import { a } from "${specifier}";\nexport function use() { return a(); }\n`;
const tsconfig = (paths, extra = {}) => JSON.stringify({ compilerOptions: { baseUrl: ".", paths: Object.fromEntries(paths) }, ...extra }) + "\n";
const consumerEdgesTo = (g) => g.edges.filter((edge) => edge.startsWith("src/consumer.js:use ->")).map((edge) => edge.split(" -> ")[1]);
function assertFound(i, label, { test: withTest = true } = {}) {
  assert.ok(affected(i).includes("src/consumer.js"), `${label}: ${JSON.stringify(affected(i))}`);
  if (withTest) assert.deepEqual(testsOf(i), ["tests/consumer.test.js"], label);
  assert.equal(i.status, "available", `${label}: ${JSON.stringify(reasons(i))}`);
  assert.equal(i.observation.incomplete, false, label);
}
function assertPartial(i, label) {
  assert.equal(i.status, "partial", `${label}: ${JSON.stringify(reasons(i))}`);
  assert.ok(reasons(i).includes("provider_partial"), `${label}: ${JSON.stringify(reasons(i))}`);
}

// ---- JSONC parsing (resolver and checker) ----
test("C-1 (review R-a) `include` glob `src/**/*.ts` after `paths` is not a comment: the alias resolves, the consumer is found (available)", (t) => {
  const files = { "tsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\".\",\"paths\":{\"@/*\":[\"src/*\"]}},\"include\":[\"src/**/*.ts\"]}\n",
    "src/impl.ts": "export function q() { return 1; }\n", "src/index.ts": "export { q as r } from './impl';\n",
    "src/c.ts": "import { r } from '@/index';\nexport function Use() { return r(); }\n" };
  const g = snapshotGraph(files);
  assert.ok(g.edges.includes("src/c.ts:Use -> src/impl.ts:q [importa]"), JSON.stringify(g.edges));
  assert.ok(g.edges.includes("src/c.ts:Use -> src/index.ts:<module> [importa barrel]"), JSON.stringify(g.edges));
  assert.equal(g.unrep, 0);
  const p = project(t, files, { tests: false });
  for (const target of ["src/impl.ts", "src/index.ts"]) {
    const i = p.impact(target);
    assert.ok(affected(i).includes("src/c.ts"), `${target} ${JSON.stringify(affected(i))}`);
    assert.equal(i.status, "available", `${target} ${JSON.stringify(reasons(i))}`);
  }
});

test("C-2 a `paths` target containing `*/` and real comments around it: parsed as JSONC, the alias resolves", () => {
  const g = snapshotGraph({ "tsconfig.json": "// project config\n{\n  /* aliases */\n  \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@mod/*\": [\"src/modules/*/index.js\"] } } // end\n}\n",
    "src/modules/m/index.js": A(1), "src/consumer.js": CONSUMER("@mod/m") });
  assert.deepEqual(consumerEdgesTo(g), ["src/modules/m/index.js:a [importa]"]);
  assert.equal(g.unrep, 0);
});

test("C-3 trailing commas (valid JSONC for tsc): `paths` are honoured with TypeScript precedence; Impact on the real lib finds consumer and test", (t) => {
  const files = { "tsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\".\",\"paths\":{\"@lib/*\":[\"shadow/*\",],\"@lib/index.js\":[\"src/index.js\",],},},}\n",
    "src/x.js": A(1), "src/index.js": STAR, "shadow/x.js": A(2), "shadow/index.js": STAR, "src/consumer.js": CONSUMER("@lib/index.js") };
  const g = snapshotGraph(files);
  assert.deepEqual(consumerEdgesTo(g), ["src/index.js:<module> [importa barrel]", "src/x.js:a [importa]"]);
  assert.equal(g.unrep, 0);
  const p = project(t, files);
  assertFound(p.impact("src/x.js"), "src/x.js");
  assert.equal(affected(p.impact("shadow/x.js")).includes("src/consumer.js"), false);
});

// ---- extends ----
test("C-4 `extends` resolved inside the snapshot: `paths` from the base config (relative to the base config's directory) are used by resolver and checker", (t) => {
  const files = { "tsconfig.json": "{ \"extends\": \"./config/base.json\" }\n", "config/base.json": "{ \"compilerOptions\": { \"paths\": { \"@lib/*\": [\"../src/*\"] } } }\n",
    "src/x.js": A(1), "src/index.js": STAR, "src/consumer.js": CONSUMER("@lib/index.js") };
  const g = snapshotGraph(files);
  assert.deepEqual(consumerEdgesTo(g), ["src/index.js:<module> [importa barrel]", "src/x.js:a [importa]"]);
  assert.equal(g.unrep, 0);
  const p = project(t, files);
  assertFound(p.impact("src/x.js"), "src/x.js");
  assertFound(p.impact("src/index.js"), "src/index.js");
});

for (const [id, label, root, extra] of [
  ["C-5a", "unresolved `extends` (file missing from the snapshot)", "{ \"extends\": \"./missing.json\", \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"src/*\"] } } }\n", {}],
  ["C-5b", "unresolved package `extends` (no node_modules in the snapshot)", "{ \"extends\": \"@tsconfig/node20/tsconfig.json\", \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"src/*\"] } } }\n", {}],
  ["C-6", "`extends` cycle", "{ \"extends\": \"./b.json\", \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"src/*\"] } } }\n", { "b.json": "{ \"extends\": \"./tsconfig.json\" }\n" }],
  ["C-7a", "invalid tsconfig (missing closing brace)", "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"src/*\"] } }\n", {}],
  ["C-7b", "invalid base config reached through `extends`", "{ \"extends\": \"./b.json\", \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"src/*\"] } } }\n", { "b.json": "{ \"compilerOptions\": { \n" }]
]) {
  test(`${id} ${label}: counted, partial, and the readable part of the config is still used (no collapse into an empty config)`, (t) => {
    const files = { "tsconfig.json": root, ...extra, "src/x.js": A(1), "src/index.js": STAR, "src/consumer.js": CONSUMER("@lib/index.js") };
    const g = snapshotGraph(files);
    assert.deepEqual(consumerEdgesTo(g), ["src/index.js:<module> [importa barrel]", "src/x.js:a [importa]"], JSON.stringify(g.edges));
    assert.equal(g.unrep, 1);
    const p = project(t, files);
    for (const target of ["src/x.js", "src/index.js"]) {
      const i = p.impact(target);
      assert.ok(affected(i).includes("src/consumer.js"), `${target} ${JSON.stringify(affected(i))}`);
      assertPartial(i, target);
    }
  });
}

test("C-14 snapshot confinement with `extends`: config reads go to snapshot entries only; a config on disk but not admitted is never read (0 host fs calls)", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "n1-tsc-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "hidden.json"), "{ \"compilerOptions\": { \"paths\": { \"@h/*\": [\"src/*\"] } } }\n");
  fs.writeFileSync(path.join(root, "tsconfig.json"), "{ \"compilerOptions\": { \"paths\": { \"@disk/*\": [\"src/*\"] } } }\n");
  const files = { "tsconfig.json": "{ \"extends\": [\"./config/base.json\", \"./hidden.json\"] }\n", "config/base.json": "{ \"compilerOptions\": { \"paths\": { \"@lib/*\": [\"../src/*\"] } } }\n",
    "src/x.js": A(1), "src/consumer.js": "import { a } from \"@lib/x.js\";\nimport { a as b } from \"@h/x.js\";\nexport function use() { return [a(), b()]; }\n" };
  const calls = [];
  const methods = ["readFileSync", "existsSync", "statSync", "lstatSync", "readdirSync", "realpathSync", "openSync", "accessSync", "readFile", "stat", "readdir"];
  const originals = methods.map((m) => [m, fs[m]]);
  for (const [m, original] of originals) fs[m] = function spy(...args) { calls.push(`${m} ${String(args[0])}`); return original.apply(this, args); };
  let g;
  try { g = snapshotGraph(files, root); } finally { for (const [m, original] of originals) fs[m] = original; }
  assert.deepEqual(calls, [], "no host file-system access during snapshot analysis");
  assert.ok(g.edges.includes("src/consumer.js:use -> src/x.js:a [importa]"), JSON.stringify(g.edges));
  // hidden.json is not admitted: that `extends` entry is unresolved and counted; `@h/*` is unknown (not an alias).
  assert.equal(g.unrep, 1);
});

test("C-15 coherent config for the D6a checker: a barrel re-export through an alias defined only in an `extends` base resolves (available)", (t) => {
  const files = { "tsconfig.json": "{ \"extends\": \"./tsconfig.base.json\" }\n", "tsconfig.base.json": "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"src/*\"] } }, \"include\": [\"src/**/*.js\"] }\n",
    "src/lib.js": A(1), "src/index.js": "export { a as b } from \"@lib/lib.js\";\n", "src/consumer.js": "import { b } from \"./index.js\";\nexport function use() { return b(); }\n" };
  const g = snapshotGraph(files);
  assert.ok(g.edges.includes("src/consumer.js:use -> src/lib.js:a [importa]"), JSON.stringify(g.edges));
  assert.equal(g.unrep, 0);
  assertFound(project(t, files).impact("src/lib.js"), "src/lib.js");
});

// ---- unresolved aliases ----
test("C-8 (review R-b) an alias that matches `paths` but resolves to no snapshot file is counted, even when the name fallback draws an edge", (t) => {
  const base = { "tsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\".\",\"paths\":{\"@gen/*\":[\"gen/*\"]}}}\n", "src/x.ts": "export function a() { return 1; }\n" };
  const plain = snapshotGraph({ ...base, "src/c.ts": "import { b } from '@gen/index';\nexport function Use() { return b(); }\n" });
  assert.deepEqual(plain.edges, []);
  assert.equal(plain.unrep, 1);
  const files = { ...base, "src/c.ts": "import { a } from '@gen/index';\nexport function Use() { return a(); }\n" };
  const fallback = snapshotGraph(files);
  assert.deepEqual(fallback.edges, ["src/c.ts:Use -> src/x.ts:a [importa]"]);
  assert.equal(fallback.unrep, 1);
  assertPartial(project(t, files, { tests: false }).impact("src/x.ts"), "src/x.ts");
});

// ---- precedence pins ----
const pairOrders = (entries) => [["as listed", entries], ["reversed", [...entries].reverse()]];
for (const [id, label, entries, files, spec, winner, loser] of [
  ["C-9", "equal-prefix tie `@lib/*` vs `@lib/*.js` (first declared wins; kills Q4/P1-M4, Q11)", [["@lib/*", ["shadow/*"]], ["@lib/*.js", ["src/*.js"]]],
    { "src/x.js": A(1), "shadow/x.js": A(2) }, "@lib/x.js", null, null],
  ["C-10", "exact `@lib/x` vs equal-length-prefix wildcard `@lib/x*` (exact wins; kills P1-M3)", [["@lib/x*", ["shadow/x*.js"]], ["@lib/x", ["src/x.js"]]],
    { "src/x.js": A(1), "shadow/x.js": A(2) }, "@lib/x", "src/x.js", "shadow/x.js"],
  ["C-11", "longest prefix, not longest pattern: `@lib/x/*` beats `@lib/*.js` (kills P1-M5)", [["@lib/*.js", ["shadow/*.js"]], ["@lib/x/*", ["src/*"]]],
    { "src/a.js": A(1), "shadow/x/a.js": A(2) }, "@lib/x/a.js", "src/a.js", "shadow/x/a.js"]
]) {
  for (const [order, list] of pairOrders(entries)) {
    test(`${id} ${label}, ${order}`, (t) => {
      const real = winner || (list[0][0] === "@lib/*" ? "shadow/x.js" : "src/x.js");
      const other = loser || (real === "src/x.js" ? "shadow/x.js" : "src/x.js");
      const all = { "tsconfig.json": tsconfig(list), ...files, "src/consumer.js": CONSUMER(spec) };
      const g = snapshotGraph(all);
      assert.deepEqual(consumerEdgesTo(g), [`${real}:a [importa]`]);
      assert.equal(g.unrep, 0);
      const p = project(t, all);
      assertFound(p.impact(real), real);
      assert.equal(affected(p.impact(other)).includes("src/consumer.js"), false, other);
    });
  }
}

test("C-12 legacy (non-snapshot) analysis keeps first-match alias selection, byte-for-byte as before N1 (kills Q12/P1-M6)", (t) => {
  const p = project(t, { "tsconfig.json": tsconfig([["@lib/*", ["shadow/*"]], ["@lib/x.js", ["src/x.js"]]]), "src/x.js": A(1), "shadow/x.js": A(2), "src/consumer.js": CONSUMER("@lib/x.js") }, { tests: false });
  const legacy = analyzeTypeScriptProject({ name: "fixture", absolutePath: p.repo }, LIMITS);
  const fileOf = new Map(legacy.nodes.map((n) => [n.id, n.file]));
  assert.deepEqual([...new Set(legacy.edges.map((e) => `${fileOf.get(e.from)}->${fileOf.get(e.to)}`))].sort(), ["src/consumer.js->shadow/x.js"]);
  assert.equal(legacy.unrepresentedImports, 0);
});

test("C-13 anchors and the counter use the same alias selection (Q8a pin): re-export through an alias whose selected target is missing", () => {
  for (const entries of [[["@lib/*", ["shadow/*"]], ["@lib/deep/*", ["missing/*"]]], [["@lib/deep/*", ["missing/*"]], ["@lib/*", ["shadow/*"]]]]) {
    const g = snapshotGraph({ "tsconfig.json": tsconfig(entries), "shadow/deep/x.js": A(2), "shadow/deep/index.js": STAR,
      "src/outer.js": "export { a } from \"@lib/deep/index.js\";\n", "src/consumer.js": CONSUMER("./outer.js") });
    assert.equal(g.result.nodes.some((n) => n.file === "src/outer.js"), false, JSON.stringify(g.result.nodes.map((n) => n.file)));
    // TypeScript selects `@lib/deep/*` (longest prefix), whose target is missing: outer.js resolves no local module,
    // so it gets no anchor and the consumer no edge into it. Counted: 3 (2 as at a852d0b, plus the alias that matched
    // but did not resolve). Selecting `@lib/*` for anchors only (Q8a) adds an outer.js anchor and drops the count.
    assert.deepEqual(g.edges, ["shadow/deep/index.js:<module> -> shadow/deep/x.js:a [re-exporta]"]);
    assert.equal(g.unrep, 3);
  }
});

// ---- B8: TypeScript config-merge semantics (pins; kill the Tester's N4, N5, N6) ----
test("C-16 an `extends` array: later entries override earlier ones, so the LAST entry's `paths` win (kills N4)", (t) => {
  const files = { "tsconfig.json": "{ \"extends\": [\"./a.json\", \"./b.json\"] }\n",
    "a.json": "{ \"compilerOptions\": { \"paths\": { \"@lib/*\": [\"first/*\"] } } }\n", "b.json": "{ \"compilerOptions\": { \"paths\": { \"@lib/*\": [\"last/*\"] } } }\n",
    "first/x.js": A(1), "last/x.js": A(2), "src/consumer.js": CONSUMER("@lib/x.js") };
  const g = snapshotGraph(files);
  assert.deepEqual(consumerEdgesTo(g), ["last/x.js:a [importa]"]);
  assert.equal(g.unrep, 0);
  const p = project(t, files);
  assertFound(p.impact("last/x.js"), "last/x.js");
  assert.equal(affected(p.impact("first/x.js")).includes("src/consumer.js"), false);
});

test("C-17 a child's `paths` REPLACE the parent's (no merge): a parent-only pattern is not used (kills N5)", (t) => {
  // TypeScript keeps only the child's `paths`, so `@p/x.js` matches the child's `@*` pattern -> src/p/x.js. Merging the
  // parent's longer `@p/*` pattern in would select shadow/x.js instead.
  const files = { "tsconfig.json": "{ \"extends\": \"./base.json\", \"compilerOptions\": { \"paths\": { \"@*\": [\"src/*\"] } } }\n",
    "base.json": "{ \"compilerOptions\": { \"paths\": { \"@p/*\": [\"shadow/*\"] } } }\n",
    "src/p/x.js": A(1), "shadow/x.js": A(2), "src/consumer.js": CONSUMER("@p/x.js") };
  const g = snapshotGraph(files);
  assert.deepEqual(consumerEdgesTo(g), ["src/p/x.js:a [importa]"]);
  assert.equal(g.unrep, 0);
  const p = project(t, files);
  assertFound(p.impact("src/p/x.js"), "src/p/x.js");
  assert.equal(affected(p.impact("shadow/x.js")).includes("src/consumer.js"), false);
});

for (const [id, label, files, real, other] of [
  ["C-18a", "`baseUrl` inherited from a base config in `cfg/`, `paths` declared in the root config",
    { "tsconfig.json": "{ \"extends\": \"./cfg/base.json\", \"compilerOptions\": { \"paths\": { \"@lib/*\": [\"x/*\"] } } }\n", "cfg/base.json": "{ \"compilerOptions\": { \"baseUrl\": \".\" } }\n" },
    "cfg/x/m.js", "x/m.js"],
  ["C-18b", "`baseUrl` and `paths` in the same root config",
    { "tsconfig.json": "{ \"compilerOptions\": { \"baseUrl\": \"src\", \"paths\": { \"@lib/*\": [\"x/*\"] } } }\n" },
    "src/x/m.js", "x/m.js"]
]) {
  test(`${id} with \`baseUrl\` set, \`paths\` targets resolve from baseUrl, not from the declaring config (kills N6): ${label}`, (t) => {
    const all = { ...files, [real]: A(1), [other]: A(2), "src/consumer.js": CONSUMER("@lib/m.js") };
    const g = snapshotGraph(all);
    assert.deepEqual(consumerEdgesTo(g), [`${real}:a [importa]`]);
    assert.equal(g.unrep, 0);
    const p = project(t, all);
    assertFound(p.impact(real), real);
    assert.equal(affected(p.impact(other)).includes("src/consumer.js"), false);
  });
}
