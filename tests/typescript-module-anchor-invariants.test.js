import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

// F1 module-anchor invariants (kills mutants that survived the F1-1..F1-9 suite):
// A-1: an anchor (kind "module") is never a symbol-import target and never a name match. It must not be added to the
//      per-file symbol map (an `export *` from a symbol-less file would then target it) nor registered for name
//      matching (an unresolved import of the name "<module>" would then match it).
//      N1/D11 amends this for PURE barrels only: a pure barrel's anchor may receive file-level edges from its
//      importers and outer barrels (tests/typescript-barrel-target.test.js N1-30, typescript-barrel-boundaries D11-*).
//      The fixtures below re-export from or import a symbol-less NON-barrel file, so they still expect no such edge.
// g:   legacy (non-snapshot) analysis creates no anchors and keeps its exact non-anchor nodes and edges.
const SNAPSHOT_PROJECT = { name: "snapshot", absolutePath: "/__project_context__" };
const LIMITS = { nodeLimit: 2000, edgeLimit: 4000 };

function describe(result) {
  const byId = new Map(result.nodes.map((node) => [node.id, node]));
  const name = (id) => `${byId.get(id)?.file}:${byId.get(id)?.label}`;
  return {
    nodes: result.nodes.map((node) => `${node.file}:${node.label}:${node.kind}`).sort(),
    edges: result.edges.map((edge) => `${name(edge.from)} -> ${name(edge.to)}`).sort(),
    edgesIntoModules: result.edges.filter((edge) => byId.get(edge.to)?.kind === "module").map((edge) => `${name(edge.from)} -> ${name(edge.to)}`)
  };
}

function snapshot(files) {
  const sourceFiles = Object.entries({ "package.json": "{\"type\":\"module\"}\n", ...files }).map(([file, text]) => ({ path: file, text }));
  const result = analyzeTypeScriptProject(SNAPSHOT_PROJECT, { ...LIMITS, sourceFiles });
  assert.equal(result.success, true, result.message);
  return describe(result);
}

const LIB = "export function helper() { return 1; }\n";
const SYMBOLLESS = "import { helper } from \"./lib.js\";\nhelper();\n";

test("A-1 an anchor is never an import or re-export target: export * and named imports from a symbol-less file add no edge into it", () => {
  const graph = snapshot({
    "src/lib.js": LIB,
    "src/symbolless.js": SYMBOLLESS,
    "src/barrel.js": "export * from \"./symbolless.js\";\nexport function Barrel() { return 1; }\n",
    "src/named.js": "import { thing } from \"./symbolless.js\";\nexport function Named() { return thing; }\n"
  });
  // The anchor exists (so the assertion below is not vacuous) ...
  assert.ok(graph.nodes.includes("src/symbolless.js:<module>:module"), JSON.stringify(graph.nodes));
  // ... but no raw edge targets a kind "module" node.
  assert.deepEqual(graph.edgesIntoModules, []);
  assert.deepEqual(graph.edges, ["src/symbolless.js:<module> -> src/lib.js:helper"]);
});

test("A-1 an anchor is never a name match: an unresolved import of the name \"<module>\" matches nothing", () => {
  const graph = snapshot({
    "src/lib.js": LIB,
    "src/symbolless.js": SYMBOLLESS,
    // Unresolved specifiers fall back to the global name match; "<module>" is reachable as a string import name.
    "src/caller.js": "import { \"<module>\" as anchor } from \"missing-pkg\";\nimport { helper } from \"missing-pkg\";\nexport function Caller() { return [anchor, helper]; }\n"
  });
  assert.ok(graph.nodes.includes("src/symbolless.js:<module>:module"), JSON.stringify(graph.nodes));
  assert.deepEqual(graph.edgesIntoModules, []);
  assert.deepEqual(graph.edges, ["src/caller.js:Caller -> src/lib.js:helper", "src/symbolless.js:<module> -> src/lib.js:helper"]);
});

test("g legacy (non-snapshot) analysis keeps its exact non-anchor nodes and edges and creates no module anchors", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f1-legacy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const files = {
    "package.json": "{\"type\":\"module\"}\n",
    "src/lib.js": "export function helper() { return 1; }\nexport class Widget {}\n",
    "src/consumer.js": "import { Widget } from \"./lib.js\";\nexport function UseWidget() { return Widget; }\n",
    "src/side-effect.js": SYMBOLLESS,
    "tests/lib.test.js": "import test from \"node:test\";\nimport { helper } from \"../src/lib.js\";\ntest(\"helper\", () => helper());\n"
  };
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  const result = analyzeTypeScriptProject({ name: "fixture", absolutePath: dir }, LIMITS);
  assert.equal(result.success, true, result.message);
  assert.equal(result.unrepresentedImports, 0);
  const graph = describe(result);
  assert.deepEqual(graph.nodes, ["src/consumer.js:UseWidget:function", "src/lib.js:Widget:class", "src/lib.js:helper:function"]);
  assert.deepEqual(graph.edges, ["src/consumer.js:UseWidget -> src/lib.js:Widget"]);
  assert.equal(result.nodes.filter((node) => node.kind === "module" || node.label === "<module>").length, 0);
});
