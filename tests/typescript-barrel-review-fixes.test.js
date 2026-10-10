import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { gitFixture } from "./helpers/git-fixture.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

// N1 PR #76 user review.
// R1-* (P1, alias precedence): in snapshot mode a module specifier that matches several tsconfig `paths` patterns
//       selects the pattern TypeScript selects: an exact pattern before any wildcard, then the wildcard with the
//       longest matched prefix; the pattern's order in `paths` does not matter. Imports, re-exports and the
//       unrepresented counter use the same selection. Every case runs in BOTH `paths` orders, with the real lib as
//       Impact target (consumer and its test found, available) and the shadow lib as control (consumer not found).
//       Only the selected pattern's targets are tried; a target missing from the snapshot does not fall through to
//       another pattern (R1-4).
// R2-* (P2, namespace + default): `import D, * as ns from` a barrel still checks the default binding.
function project(t, files) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{\"type\":\"module\"}\n");
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  f.write("tests/consumer.test.js", "import test from \"node:test\";\nimport { use } from \"../src/consumer.js\";\ntest(\"use\", () => use());\n");
  f.commit();
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_N1R" }]));
  const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "d.json") } };
  return { impact: (origin) => buildProjectImpact("PrJ_N1R", { paths: [origin], includeTests: true }, options) };
}
function snapshotGraph(files) {
  const all = { "package.json": "{\"type\":\"module\"}\n", ...files };
  const r = analyzeTypeScriptProject({ name: "snapshot", absolutePath: "/__project_context__" },
    { nodeLimit: 2000, edgeLimit: 4000, sourceFiles: Object.entries(all).map(([file, text]) => ({ path: file, text })) });
  const byId = new Map(r.nodes.map((n) => [n.id, n]));
  const name = (id) => `${byId.get(id).file}:${byId.get(id).label}`;
  return { edges: r.edges.map((e) => `${name(e.from)} -> ${name(e.to)} [${e.label}]`).sort(), unrep: r.unrepresentedImports };
}
const affected = (i) => i.affectedFiles.map((a) => a.path).sort();
const testsOf = (i) => i.affectedTests.candidates.map((c) => c.path).sort();
const reasons = (i) => Object.values(i.completeness).flat().sort();
const tsconfig = (paths) => JSON.stringify({ compilerOptions: { baseUrl: ".", paths: Object.fromEntries(paths) } }) + "\n";
const A = (n) => `export function a() { return ${n}; }\n`;
const CONSUMER = (specifier) => `import { a } from "${specifier}";\nexport function use() { return a(); }\n`;

// [id, label, real lib, shadow lib, `paths` entries (real pattern last = first-match picks the shadow), extra files]
const CASES = [
  ["R1-1", "exact `@lib/index.js` vs wildcard `@lib/*`", "src/x.js", "shadow/x.js",
    [["@lib/*", ["shadow/*"]], ["@lib/index.js", ["src/index.js"]]],
    { "src/x.js": A(1), "src/index.js": "export * from \"./x.js\";\n", "shadow/x.js": A(2), "shadow/index.js": "export * from \"./x.js\";\n",
      "src/consumer.js": CONSUMER("@lib/index.js") }],
  ["R1-2", "overlapping wildcards `@lib/*` vs `@lib/deep/*` (longest prefix)", "src/x.js", "shadow/deep/x.js",
    [["@lib/*", ["shadow/*"]], ["@lib/deep/*", ["src/*"]]],
    { "src/x.js": A(1), "src/index.js": "export * from \"./x.js\";\n", "shadow/deep/x.js": A(2), "shadow/deep/index.js": "export * from \"./x.js\";\n",
      "src/consumer.js": CONSUMER("@lib/deep/index.js") }],
  ["R1-3", "re-export through an alias, exact vs wildcard", "src/x.js", "shadow/x.js",
    [["@lib/*", ["shadow/*"]], ["@lib/index.js", ["src/index.js"]]],
    { "src/x.js": A(1), "src/index.js": "export * from \"./x.js\";\n", "shadow/x.js": A(2), "shadow/index.js": "export * from \"./x.js\";\n",
      "src/outer.js": "export * from \"@lib/index.js\";\n", "src/consumer.js": CONSUMER("./outer.js") }]
];
for (const [id, label, real, shadow, paths, files] of CASES) {
  for (const [order, entries] of [["real pattern listed last", paths], ["real pattern listed first", [...paths].reverse()]]) {
    test(`${id} P1 alias precedence, ${label}, ${order}: Impact on the real lib finds consumer and test (available); shadow lib does not`, (t) => {
      const all = { "tsconfig.json": tsconfig(entries), ...files };
      const g = snapshotGraph(all);
      assert.ok(g.edges.some((edge) => edge.endsWith(`-> ${real}:a [importa]`) && edge.startsWith("src/consumer.js:use")), JSON.stringify(g.edges));
      assert.equal(g.edges.some((edge) => edge.includes(`-> ${shadow}:a`) && edge.startsWith("src/consumer.js:use")), false, JSON.stringify(g.edges));
      assert.equal(g.unrep, 0, JSON.stringify(g.edges));
      const p = project(t, all);
      const i = p.impact(real);
      assert.ok(affected(i).includes("src/consumer.js"), JSON.stringify(affected(i)));
      if (!files["src/outer.js"]) assert.deepEqual(testsOf(i), ["tests/consumer.test.js"]);
      assert.equal(i.status, "available", JSON.stringify(reasons(i)));
      assert.equal(i.observation.incomplete, false);
      const s = p.impact(shadow);
      assert.equal(affected(s).includes("src/consumer.js"), false, JSON.stringify(affected(s)));
    });
  }
}

test("R1-4 P1 only the best-matching pattern is tried (as TypeScript): its target missing from the snapshot never falls through to a shorter wildcard (no barrel link), in both orders", () => {
  const files = { "shadow/deep/x.js": A(2), "shadow/deep/index.js": "export * from \"./x.js\";\n", "src/consumer.js": CONSUMER("@lib/deep/index.js") };
  for (const entries of [[["@lib/*", ["shadow/*"]], ["@lib/deep/*", ["missing/*"]]], [["@lib/deep/*", ["missing/*"]], ["@lib/*", ["shadow/*"]]]]) {
    const g = snapshotGraph({ "tsconfig.json": tsconfig(entries), ...files });
    // The specifier is unresolved, so it is never linked as a dependency on the shadow barrel. (The pre-existing
    // name-based fallback for unresolved specifiers, unchanged since base, may still name-match `a`; out of scope.)
    assert.equal(g.edges.some((edge) => edge.includes("-> shadow/deep/index.js:")), false, JSON.stringify(g.edges));
  }
});

const LIB_HELPER = "export function helper() { return 2; }\n";
test("R2-1 P2 `import D, * as ns` from a star-only barrel without a default: the default is still checked; partial", (t) => {
  const files = { "src/lib.js": LIB_HELPER, "src/index.js": "export * from \"./lib.js\";\n",
    "src/consumer.js": "import D, * as ns from \"./index.js\";\nexport function use() { return [D, ns.helper()]; }\n" };
  const g = snapshotGraph(files);
  assert.equal(g.unrep, 1, JSON.stringify(g.edges));
  // Control: the same default import without the namespace is partial too (base and PR).
  assert.equal(snapshotGraph({ ...files, "src/consumer.js": "import D from \"./index.js\";\nexport function use() { return D; }\n" }).unrep, 1);
  const p = project(t, files);
  for (const target of ["src/index.js", "src/lib.js"]) {
    const i = p.impact(target);
    assert.equal(i.status, "partial", `${target} ${JSON.stringify(reasons(i))}`);
    assert.ok(reasons(i).includes("provider_partial"), JSON.stringify(reasons(i)));
  }
});

test("R2-2 P2 control: `import D, * as ns` from a barrel with a valid default is not falsely partial", (t) => {
  const files = { "src/lib.js": "export default function A() { return 1; }\n", "src/index.js": "export { default } from \"./lib.js\";\n",
    "src/consumer.js": "import D, * as ns from \"./index.js\";\nexport function use() { return [D(), ns.default()]; }\n" };
  const g = snapshotGraph(files);
  assert.deepEqual(g.edges, ["src/consumer.js:use -> src/index.js:default [importa default]", "src/consumer.js:use -> src/lib.js:A [importa default]",
    "src/index.js:default -> src/lib.js:A [re-exporta]"]);
  assert.equal(g.unrep, 0);
  const p = project(t, files);
  for (const target of ["src/index.js", "src/lib.js"]) {
    const i = p.impact(target);
    assert.ok(affected(i).includes("src/consumer.js"), JSON.stringify(affected(i)));
    assert.equal(i.status, "available", `${target} ${JSON.stringify(reasons(i))}`);
  }
});
