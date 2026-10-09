import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { gitFixture } from "./helpers/git-fixture.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { listAnalyzerProviders } from "../src/analyzers/common/analyzer-registry.js";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

// N1: dependants that reach a definition only through a re-exporting module ("barrel") must be affected, and anything
// the graph cannot represent must make the provider partial (never a silent complete). Real analyzer + real Impact.
function project(t, files) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{\"type\":\"module\"}\n");
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  f.commit();
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_N1" }]));
  const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "d.json") } };
  return { ...f, options, impact: (paths) => buildProjectImpact("PrJ_N1", { paths, includeTests: true }, options) };
}
const affected = (i) => i.affectedFiles.map((a) => a.path).sort();
const testsOf = (i) => i.affectedTests.candidates.map((c) => c.path).sort();
const reasons = (i) => Object.values(i.completeness).flat().sort();

const X = "export function a() { return 1; }\n";
const Y = "export function c() { return 3; }\n";
const TEST = "import test from \"node:test\";\nimport { use } from \"../src/consumer.js\";\ntest(\"use\", () => use());\n";
const fx = (index, imports, extra = {}) => ({ "src/x.js": X, "src/index.js": index,
  "src/consumer.js": `import { ${imports} } from "./index.js";\nexport function use() { return [${imports.replace(/\b\w+ as /g, "")}]; }\n`,
  "tests/consumer.test.js": TEST, ...extra });
const withY = (index, imports, extra) => fx(index + "export * from \"./y.js\";\n", `${imports}, c`, { "src/y.js": Y, ...extra });
const FULL = ["src/consumer.js", "src/index.js", "tests/consumer.test.js"];

const FORMS = [
  ["star", "export * from \"./x.js\";\n", "a", {}],
  ["named", "export { a } from \"./x.js\";\n", "a", {}],
  ["named alias", "export { a as b } from \"./x.js\";\n", "b", {}],
  ["default-as", "export { default as b } from \"./x.js\";\n", "b", { "src/x.js": "export default function A() { return 1; }\n" }],
  ["namespace re-export", "export * as ns from \"./x.js\";\n", "ns", {}]
];
const BASE = { star: "GREEN", named: "GREEN", "named alias": "RED", "default-as": "RED", "namespace re-export": "RED" };

// N1-1..5: each form through a single-source barrel.
FORMS.forEach(([name, index, imports, extra], k) => {
  test(`N1-${k + 1} ${name}: barrel dependant and its test are affected; status available (${BASE[name]} at base)`, (t) => {
    const i = project(t, fx(index, imports, extra)).impact(["src/x.js"]);
    assert.deepEqual(affected(i), FULL);
    assert.deepEqual(testsOf(i), ["tests/consumer.test.js"]);
    assert.equal(i.status, "available", JSON.stringify(reasons(i)));
  });
});

// N1-6..10: the same forms in a two-source barrel. At base the edge to y masked the missing edge to x: SILENT complete.
FORMS.forEach(([name, index, imports, extra], k) => {
  test(`N1-${k + 6} ${name} + second star source: dependant of x is affected, never silently missed (${BASE[name]} at base)`, (t) => {
    const i = project(t, withY(index, imports, extra)).impact(["src/x.js"]);
    assert.deepEqual(affected(i), FULL);
    assert.equal(i.status, "available", JSON.stringify(reasons(i)));
  });
});

test("N1-11 type-only re-export (TS): dependant is affected (GREEN at base)", (t) => {
  const i = project(t, { "tsconfig.json": "{}\n", "src/x.ts": "export interface T { v: number }\n", "src/index.ts": "export type { T } from \"./x\";\n",
    "src/consumer.ts": "import type { T } from \"./index\";\nexport function use(t: T) { return t.v; }\n" }).impact(["src/x.ts"]);
  assert.deepEqual(affected(i), ["src/consumer.ts", "src/index.ts"]);
  assert.equal(i.status, "available");
});

test("N1-12 chain of barrels with aliases (outer -> index -> x): dependant affected, available (RED at base)", (t) => {
  const i = project(t, fx("export { a as b } from \"./x.js\";\n", "d", { "src/outer.js": "export { b as d } from \"./index.js\";\n",
    "src/consumer.js": "import { d } from \"./outer.js\";\nexport function use() { return d(); }\n" })).impact(["src/x.js"]);
  assert.deepEqual(affected(i), ["src/consumer.js", "src/index.js", "src/outer.js", "tests/consumer.test.js"]);
  assert.equal(i.status, "available", JSON.stringify(reasons(i)));
});

test("N1-13 star chain (outer -> index -> x): no spurious partial (RED at base: provider_partial)", (t) => {
  const i = project(t, fx("export * from \"./x.js\";\n", "a", { "src/outer.js": "export * from \"./index.js\";\n",
    "src/consumer.js": "import { a } from \"./outer.js\";\nexport function use() { return a(); }\n" })).impact(["src/x.js"]);
  assert.deepEqual(affected(i), ["src/consumer.js", "src/index.js", "src/outer.js", "tests/consumer.test.js"]);
  assert.equal(i.status, "available", JSON.stringify(reasons(i)));
});

test("N1-14 export-star cycle with two star sources terminates and resolves (GREEN at base)", (t) => {
  const i = project(t, fx("export * from \"./x.js\";\nexport * from \"./w.js\";\n", "a", {
    "src/x.js": X + "export * from \"./index.js\";\nexport * from \"./w.js\";\n", "src/w.js": "export function w() { return 0; }\n" })).impact(["src/x.js"]);
  assert.ok(affected(i).includes("src/consumer.js"), JSON.stringify(affected(i)));
  assert.equal(i.status, "available", JSON.stringify(reasons(i)));
});

test("N1-15 star collision (x and z both export a): dependant is affected from BOTH candidates (GREEN at base)", (t) => {
  const files = fx("export * from \"./x.js\";\nexport * from \"./z.js\";\n", "a", { "src/z.js": "export function a() { return 26; }\n" });
  const f = project(t, files);
  for (const origin of ["src/x.js", "src/z.js"]) assert.ok(affected(f.impact([origin])).includes("src/consumer.js"), origin);
});

test("N1-16 never silently complete: an unresolvable name through a two-source barrel makes the provider partial (RED at base)", (t) => {
  const i = project(t, withY("export * from \"./x.js\";\n", "nope", {})).impact(["src/y.js"]);
  assert.ok(affected(i).includes("src/consumer.js"));
  assert.equal(i.status, "partial");
  assert.ok(reasons(i).includes("provider_partial"));
});

test("N1-17 never silently complete: a re-exported name whose defining file has no graph symbol stays partial (GREEN at base)", (t) => {
  const i = project(t, withY("export * from \"./x.js\";\n", "a", { "src/x.js": "export const a = 1;\n" })).impact(["src/x.js"]);
  assert.equal(i.status, "partial");
  assert.ok(reasons(i).includes("provider_partial"));
});

test("N1-18 Pack: no barrel pseudo-symbols, no module anchors in symbols or references (GREEN at base)", (t) => {
  const f = project(t, withY("export * as ns from \"./x.js\";\nexport { a as b } from \"./x.js\";\n", "ns, b", {}));
  const pack = buildProjectTaskContext({ projectId: "PrJ_N1", task: { title: "T", paths: ["src/x.js", "src/index.js", "src/consumer.js"] } }, f.options);
  for (const section of ["symbols", "references"]) {
    const text = JSON.stringify(pack.sections[section].items);
    assert.equal(text.includes("<module>"), false, section);
  }
  assert.equal(pack.sections.symbols.items.some((s) => s.path === "src/index.js" || s.kind === "module"), false);
});

test("N1-19 legacy (non-snapshot) analysis is unchanged by N1: no anchors, no barrel resolution (GREEN at base)", (t) => {
  const f = project(t, withY("export { a as b } from \"./x.js\";\n", "b", {}));
  const legacy = analyzeTypeScriptProject({ name: "fixture", absolutePath: f.repo }, { nodeLimit: 2000, edgeLimit: 4000 });
  const fileOf = new Map(legacy.nodes.map((n) => [n.id, n.file]));
  const pairs = [...new Set(legacy.edges.map((e) => `${fileOf.get(e.from)}->${fileOf.get(e.to)}`))].sort();
  assert.deepEqual(pairs, ["src/consumer.js->src/y.js"]);
  assert.equal(legacy.nodes.some((n) => n.kind === "module"), false);
  assert.equal(legacy.unrepresentedImports, 0);
});

test("N1-20 native.typescript provider version is bumped for the changed graph (RED at base)", () => {
  assert.equal(listAnalyzerProviders().find((p) => p.id === "native.typescript").version, "3");
});
