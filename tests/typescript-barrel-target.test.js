import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { gitFixture } from "./helpers/git-fixture.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

// N1 addendum 1: a PURE barrel as the Impact TARGET (D10), with src/lib.js as the control target, plus chains,
// cycles, mixed barrels (D10 guard), namespace imports (D5 revised), tsconfig-path re-exports (D6a), ambiguous
// star names (D3a) and the amended anchor contract (D11 / A-1'). Real git fixture + real analyzer + real Impact.
function project(t, files) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{\"type\":\"module\"}\n");
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  f.write("tests/consumer.test.js", "import test from \"node:test\";\nimport { use } from \"../src/consumer.js\";\ntest(\"use\", () => use());\n");
  f.commit();
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_N1B" }]));
  const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "d.json") } };
  return { impact: (origin) => buildProjectImpact("PrJ_N1B", { paths: [origin], includeTests: true }, options) };
}
const affected = (i) => i.affectedFiles.map((a) => a.path).sort();
const testsOf = (i) => i.affectedTests.candidates.map((c) => c.path).sort();
const reasons = (i) => Object.values(i.completeness).flat().sort();
const LIB = "export function a() { return 1; }\n";
const use = (names, from = "./index.js") => `import { ${names} } from "${from}";\nexport function use() { return [${names.replace(/\w+ as /g, "")}]; }\n`;
const neverSilent = (i, file) => assert.ok(affected(i).includes(file) || i.status === "partial", `silently complete: ${i.status} ${JSON.stringify(affected(i))}`);
const CONSUMER = ["src/consumer.js", "tests/consumer.test.js"];

// N1-21..24 (+ N1-31 default-as): each re-export form; the pure barrel as target finds the consumer and its test,
// and the control target src/lib.js finds consumer, barrel and test. Both available.
for (const [k, name, index, names, lib] of [
  ["21", "star", "export * from \"./lib.js\";\n", "a", LIB],
  ["22", "named", "export { a } from \"./lib.js\";\n", "a", LIB],
  ["23", "alias", "export { a as b } from \"./lib.js\";\n", "b", LIB],
  ["24", "namespace re-export", "export * as ns from \"./lib.js\";\n", "ns", LIB],
  ["31", "default-as", "export { default as b } from \"./lib.js\";\n", "b", "export default function A() { return 1; }\n"]
]) {
  test(`N1-${k} ${name}: pure barrel src/index.js as Impact target finds consumer and test (available); control target src/lib.js`, (t) => {
    const p = project(t, { "src/lib.js": lib, "src/index.js": index, "src/consumer.js": use(names) });
    const i = p.impact("src/index.js");
    assert.deepEqual(affected(i), CONSUMER);
    assert.deepEqual(testsOf(i), ["tests/consumer.test.js"]);
    assert.equal(i.status, "available", JSON.stringify(reasons(i)));
    const c = p.impact("src/lib.js");
    assert.deepEqual(affected(c), ["src/consumer.js", "src/index.js", "tests/consumer.test.js"]);
    assert.deepEqual(testsOf(c), ["tests/consumer.test.js"]);
    assert.equal(c.status, "available", JSON.stringify(reasons(c)));
  });
}

// N1-25 / N1-32: barrel -> barrel -> lib chains (star and alias). Every target finds the consumer; never silent.
for (const [k, name, index, outer, names] of [
  ["25", "star chain", "export * from \"./lib.js\";\n", "export * from \"./index.js\";\n", "a"],
  ["32", "alias chain", "export { a as b } from \"./lib.js\";\n", "export { b as d } from \"./index.js\";\n", "d"]
]) {
  test(`N1-${k} ${name} (outer -> index -> lib): outer, inner barrel and control lib as target all find the consumer`, (t) => {
    const p = project(t, { "src/lib.js": LIB, "src/index.js": index, "src/outer.js": outer, "src/consumer.js": use(names, "./outer.js") });
    const o = p.impact("src/outer.js");
    assert.deepEqual(affected(o), CONSUMER);
    assert.equal(o.status, "available", JSON.stringify(reasons(o)));
    const inner = p.impact("src/index.js");
    // The test is three hops from the inner barrel: Impact reports the bounded traversal honestly (depth_limit).
    assert.deepEqual(affected(inner), ["src/consumer.js", "src/outer.js"]);
    assert.equal(inner.status, "partial");
    assert.ok(reasons(inner).includes("depth_limit"), JSON.stringify(reasons(inner)));
    const c = p.impact("src/lib.js");
    assert.deepEqual(affected(c), ["src/consumer.js", "src/index.js", "src/outer.js", "tests/consumer.test.js"]);
    assert.equal(c.status, "available", JSON.stringify(reasons(c)));
  });
}

test("N1-33 pure-barrel export-star cycle (a <-> b, a -> lib): both barrels and control lib as target find the consumer; terminates", (t) => {
  const p = project(t, { "src/lib.js": LIB, "src/a.js": "export * from \"./b.js\";\nexport * from \"./lib.js\";\n", "src/b.js": "export * from \"./a.js\";\n",
    "src/consumer.js": use("a", "./b.js") });
  const b = p.impact("src/b.js");
  assert.deepEqual(affected(b), ["src/a.js", "src/consumer.js", "tests/consumer.test.js"]);
  assert.equal(b.status, "available", JSON.stringify(reasons(b)));
  const a = p.impact("src/a.js");
  assert.ok(affected(a).includes("src/consumer.js"), JSON.stringify(affected(a)));
  neverSilent(a, "src/consumer.js");
  const c = p.impact("src/lib.js");
  assert.deepEqual(affected(c), ["src/a.js", "src/b.js", "src/consumer.js", "tests/consumer.test.js"]);
  assert.equal(c.status, "available", JSON.stringify(reasons(c)));
});

test("N1-26 mixed barrel (own symbol, consumer imports only a re-exported name) as target: never silently complete (partial)", (t) => {
  const i = project(t, { "src/lib.js": LIB, "src/index.js": "export function helper() { return 0; }\nexport { a } from \"./lib.js\";\n", "src/consumer.js": use("a") }).impact("src/index.js");
  neverSilent(i, "src/consumer.js");
  assert.equal(i.status, "partial");
  assert.ok(reasons(i).includes("provider_partial"));
});

test("N1-27 D5 namespace import from a barrel next to a named import of the same barrel: never silently complete", (t) => {
  const p = project(t, { "src/lib.js": LIB, "src/y.js": "export function c() { return 3; }\n", "src/index.js": "export * from \"./lib.js\";\nexport * from \"./y.js\";\n",
    "src/consumer.js": "import * as m from \"./index.js\";\nimport { c } from \"./index.js\";\nexport function use() { return [m.a(), c()]; }\n" });
  neverSilent(p.impact("src/lib.js"), "src/consumer.js");
  assert.ok(affected(p.impact("src/index.js")).includes("src/consumer.js"));
});

test("N1-28 D6a tsconfig-path re-exports resolve through the checker over snapshot files: dependant found, available", (t) => {
  const i = project(t, { "tsconfig.json": "{\"compilerOptions\":{\"baseUrl\":\".\",\"paths\":{\"@lib/*\":[\"src/*\"]}}}\n", "src/lib.js": LIB, "src/y.js": "export function c() { return 3; }\n",
    "src/index.js": "export { a as b } from \"@lib/lib.js\";\nexport * from \"./y.js\";\n", "src/consumer.js": use("b, c") }).impact("src/lib.js");
  assert.ok(affected(i).includes("src/consumer.js"), JSON.stringify(affected(i)));
  assert.equal(i.status, "available", JSON.stringify(reasons(i)));
});

test("N1-29 D3a ambiguous star name: every candidate and the barrel find the consumer AND every result is partial (conservative union, not a resolution)", (t) => {
  const p = project(t, { "src/x.js": LIB, "src/y.js": "export function a() { return 2; }\n", "src/index.js": "export * from \"./x.js\";\nexport * from \"./y.js\";\n", "src/consumer.js": use("a") });
  for (const origin of ["src/x.js", "src/y.js", "src/index.js"]) {
    const i = p.impact(origin);
    assert.ok(affected(i).includes("src/consumer.js"), origin);
    assert.equal(i.status, "partial", origin);
    assert.ok(reasons(i).includes("provider_partial"), origin);
  }
});

test("N1-30 amended anchor contract A-1' (D11): only barrel importers/re-exporters point into an anchor, and only into a PURE BARREL's anchor", () => {
  const sourceFiles = Object.entries({
    "package.json": "{\"type\":\"module\"}\n", "src/lib.js": "export function helper() { return 1; }\n",
    "src/symbolless.js": "import { helper } from \"./lib.js\";\nhelper();\n",
    "src/index.js": "export * from \"./lib.js\";\n", "src/outer.js": "export * from \"./index.js\";\n",
    "src/consumer.js": "import { helper } from \"./outer.js\";\nimport \"./symbolless.js\";\nexport function Use() { return helper(); }\n",
    "src/caller.js": "import { \"<module>\" as anchor } from \"missing-pkg\";\nexport function Caller() { return anchor; }\n"
  }).map(([file, text]) => ({ path: file, text }));
  const graph = analyzeTypeScriptProject({ name: "snapshot", absolutePath: "/__project_context__" }, { nodeLimit: 2000, edgeLimit: 4000, sourceFiles });
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const into = graph.edges.filter((edge) => byId.get(edge.to).kind === "module").map((edge) => `${byId.get(edge.from).file}:${byId.get(edge.from).label} -> ${byId.get(edge.to).file}`).sort();
  assert.deepEqual(into, ["src/consumer.js:Use -> src/outer.js", "src/outer.js:<module> -> src/index.js"]);
  assert.equal(graph.nodes.some((node) => node.kind === "module" && ["src/lib.js", "src/consumer.js"].includes(node.file)), false);
});
