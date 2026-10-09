import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { gitFixture } from "./helpers/git-fixture.js";
import { buildProjectImpact } from "../src/lib/project-impact-service.js";
import { buildProjectTaskContext } from "../src/lib/task-context.js";
import { listAnalyzerProviders } from "../src/analyzers/common/analyzer-registry.js";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

// F1 (SB-1): a JS/TS file without top-level symbols must still be represented as an importer, and any local import the
// native graph still cannot represent must surface as provider_partial (never a silent complete Impact).
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function project(t, files) {
  const f = gitFixture(t, { committed: false });
  f.write("package.json", "{\"type\":\"module\"}\n");
  for (const [file, text] of Object.entries(files)) f.write(file, text);
  f.commit();
  const manualProjectsFile = path.join(f.root, "projects.json");
  fs.writeFileSync(manualProjectsFile, JSON.stringify([{ name: "fixture", rootId: "test", relativePath: "main", projectId: "PrJ_F1" }]));
  const options = { registry: { roots: [{ id: "test", path: f.root }], manualProjectsFile, discoveredProjectsFile: path.join(f.root, "d.json") } };
  return { ...f, options, impact: (paths, includeTests = true) => buildProjectImpact("PrJ_F1", { paths, includeTests }, options) };
}
const affected = (i) => i.affectedFiles.map((a) => a.path).sort();
const tests = (i) => i.affectedTests.candidates.map((c) => c.path).sort();
const reasons = (i) => Object.values(i.completeness).flat().sort();

const LIB = "export function helper() { return 1; }\nexport class Widget {}\nexport const lowerConst = 2;\n";
const CLEAN = {
  "src/lib.js": LIB,
  "tests/lib.test.js": "import test from \"node:test\";\nimport { helper } from \"../src/lib.js\";\ntest(\"helper\", () => helper());\n"
};
const MIXED = {
  ...CLEAN,
  "src/side-effect.js": "import { helper } from \"./lib.js\";\nhelper();\n",
  "src/import-only.js": "import { Widget } from \"./lib.js\";\n",
  "src/index.js": "export { helper, Widget } from \"./lib.js\";\n",
  "src/consumer.js": "import { Widget } from \"./index.js\";\nexport function UseWidget() { return Widget; }\n",
  "src/app.js": "import \"./side-effect.js\";\nexport function App() { return 1; }\n",
  "src/uses-const.js": "import { lowerConst } from \"./lib.js\";\nexport function UsesConst() { return lowerConst; }\n",
  "tests/ns.test.js": "import test from \"node:test\";\nimport * as lib from \"../src/lib.js\";\ntest(\"ns\", () => lib.helper());\n"
};

test("F1-1 symbol-less test file importing a symbol is an affected file and test candidate (RED at base)", (t) => {
  const i = project(t, CLEAN).impact(["src/lib.js"]);
  assert.deepEqual(affected(i), ["tests/lib.test.js"]);
  assert.deepEqual(tests(i), ["tests/lib.test.js"]);
});

test("F1-2 fully representable fixture stays complete: no provider_partial is invented (GREEN at base and after; guards against over-flagging)", (t) => {
  const i = project(t, CLEAN).impact(["src/lib.js"]);
  assert.equal(i.status, "available");
  assert.equal(i.observation.incomplete, false);
  assert.deepEqual(reasons(i), []);
});

test("F1-3 side-effect-only, import-only and re-export-only files are affected importers (RED at base)", (t) => {
  const i = project(t, MIXED).impact(["src/lib.js"]);
  for (const file of ["src/side-effect.js", "src/import-only.js", "src/index.js", "src/consumer.js", "tests/lib.test.js"]) {
    assert.ok(affected(i).includes(file), `${file} missing from ${JSON.stringify(affected(i))}`);
  }
});

test("F1-4 never silently complete: unrepresentable local imports (namespace, unregistered name, side-effect) mark the graph partial (RED at base)", (t) => {
  const i = project(t, MIXED).impact(["src/lib.js"]);
  assert.equal(i.status, "partial");
  assert.equal(i.observation.incomplete, true);
  assert.ok(i.completeness.provider.includes("provider_partial"), JSON.stringify(i.completeness));
});

test("F1-5 a symbol-less origin imported only for side effects is not reported as complete no_evidence_found (RED at base)", (t) => {
  const i = project(t, MIXED).impact(["src/side-effect.js"]);
  assert.notDeepEqual({ status: i.status, findingState: i.findingState, incomplete: i.observation.incomplete },
    { status: "available", findingState: "no_evidence_found", incomplete: false });
  assert.equal(i.observation.incomplete, true);
});

test("F1-6 faithful hermes-nexus case: tests/router.test.js depends on src/utils/router.js (RED at base)", (t) => {
  const files = {
    "src/utils/router.js": fs.readFileSync(path.join(REPO, "src/utils/router.js"), "utf8"),
    "tests/router.test.js": fs.readFileSync(path.join(REPO, "tests/router.test.js"), "utf8")
  };
  const i = project(t, files).impact(["src/utils/router.js"]);
  assert.ok(affected(i).includes("tests/router.test.js"), JSON.stringify(affected(i)));
  assert.ok(tests(i).includes("tests/router.test.js"));
});

test("F1-7 module anchors never appear as Pack symbols or references (GREEN at base and after)", (t) => {
  const f = project(t, MIXED);
  const pack = buildProjectTaskContext({ projectId: "PrJ_F1", task: { id: "f1", title: "T", paths: ["tests/lib.test.js", "src/side-effect.js", "src/lib.js"] } }, f.options);
  const names = pack.sections.symbols.items.map((s) => s.name);
  const ends = pack.sections.references.items.flatMap((r) => [r.from.name, r.to.name]);
  assert.ok(![...names, ...ends].some((n) => n === "<module>"), JSON.stringify({ names, ends }));
  assert.ok(pack.sections.symbols.items.every((s) => s.kind !== "module"));
});

test("F1-8 legacy (non-snapshot) analysis emits no module anchors (GREEN at base and after)", (t) => {
  const f = project(t, MIXED);
  const result = analyzeTypeScriptProject({ name: "fixture", absolutePath: f.repo }, { nodeLimit: 2000, edgeLimit: 4000 });
  assert.equal(result.nodes.some((n) => n.kind === "module" || n.label === "<module>"), false);
});

test("F1-9 native.typescript provider version is bumped for the changed graph (RED at base)", () => {
  const native = listAnalyzerProviders().find((p) => p.id === "native.typescript");
  assert.equal(native.version, "2");
});
