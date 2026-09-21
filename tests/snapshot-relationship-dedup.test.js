import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { analyzeContextSources } from "../src/lib/analyzer-service.js";
import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

const project = { name: "alias-relationships", projectId: "PrJ_Alias" };
const relationshipKey = (edge) => JSON.stringify([edge.from, edge.to, edge.relation]);

function aliasSources(extension, uniqueCount, reverse = false) {
  // DepC precedes DepB/DepA in the native snapshot edge order for these paths.
  // Its two aliases must not consume the slots belonging to other relationships.
  const names = ["DepC", "DepB", "DepA"].slice(0, uniqueCount);
  const imports = [`${names[0]} as ${reverse ? "PublicDep" : "LocalDep"}`, ...names.slice(1)];
  if (reverse) imports.reverse();
  const statements = [
    `import { ${imports.join(", ")} } from './dep.${extension}';`,
    `export { ${names[0]} as ${reverse ? "LocalDep" : "PublicDep"} } from './dep.${extension}';`
  ];
  if (reverse) statements.reverse();
  const files = [
    { path: `dep.${extension}`, text: (reverse ? [...names].reverse() : names).map((name) => `export class ${name} {}`).join("\n") },
    { path: `consumer.${extension}`, text: [...statements, "export class Consumer {}"].join("\n") }
  ];
  return reverse ? files.reverse() : files;
}

function targetNames(result) {
  const byId = new Map(result.nodes.map((node) => [node.id, node.label]));
  return result.edges.map((edge) => byId.get(edge.to));
}

for (const extension of ["ts", "js"]) {
  test(`${extension} snapshot alias duplicate is complete at the exact unique edge limit`, () => {
    const files = aliasSources(extension, 1);
    const unrestricted = analyzeContextSources(project, files);
    const exact = analyzeContextSources(project, files, { edgeLimit: 1 });

    assert.equal(unrestricted.edges.length, 1);
    assert.equal(unrestricted.limited, false);
    assert.deepEqual(exact.nodes, unrestricted.nodes);
    assert.deepEqual(exact.edges, unrestricted.edges);
    assert.equal(exact.limited, false);
    assert.equal(exact.status, "available");
  });

  test(`${extension} snapshot alias duplicate cannot displace another unique relationship`, () => {
    const files = aliasSources(extension, 2);
    const unrestricted = analyzeContextSources(project, files);
    const exact = analyzeContextSources(project, files, { edgeLimit: 2 });

    assert.equal(unrestricted.edges.length, 2);
    assert.equal(unrestricted.limited, false);
    assert.deepEqual(targetNames(exact), ["DepC", "DepB"]);
    assert.deepEqual(exact.edges, unrestricted.edges);
    assert.equal(exact.limited, false);
    assert.equal(exact.status, "available");
  });

  test(`${extension} snapshot alias dedup reports actual unique relationship omission`, () => {
    const files = aliasSources(extension, 3);
    const unrestricted = analyzeContextSources(project, files);
    const limited = analyzeContextSources(project, files, { edgeLimit: 2 });

    assert.equal(unrestricted.edges.length, 3);
    assert.equal(unrestricted.limited, false);
    assert.equal(limited.edges.length, 2);
    assert.equal(new Set(limited.edges.map(relationshipKey)).size, 2);
    assert.deepEqual(targetNames(limited), ["DepC", "DepB"]);
    assert.deepEqual(limited.edges, unrestricted.edges.slice(0, 2));
    assert.equal(limited.limited, true);
    assert.equal(limited.status, "partial");
  });

  test(`${extension} snapshot alias relationship selection is invariant under extraction order`, () => {
    for (const [uniqueCount, edgeLimit] of [[1, 1], [2, 2], [3, 2]]) {
      const first = analyzeContextSources(project, aliasSources(extension, uniqueCount), { edgeLimit });
      const reversed = analyzeContextSources(project, aliasSources(extension, uniqueCount, true), { edgeLimit });

      assert.deepEqual(reversed.nodes, first.nodes);
      assert.deepEqual(reversed.edges, first.edges);
      assert.equal(first.edges.length, Math.min(uniqueCount, edgeLimit));
      assert.equal(first.limited, uniqueCount > edgeLimit);
      assert.equal(reversed.limited, first.limited);
      assert.equal(reversed.status, first.status);
      // Source text differs, so the snapshot token is intentionally not compared.
    }
  });

  test(`${extension} legacy analysis retains alias-derived native IDs and edge budgeting`, (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-alias-legacy-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const file of aliasSources(extension, 2)) fs.writeFileSync(path.join(root, file.path), file.text);
    assert.equal(fs.existsSync(path.join(root, "tsconfig.json")), false);
    const legacyProject = { name: "legacy-alias", absolutePath: root };
    const unrestricted = analyzeTypeScriptProject(legacyProject);
    const limited = analyzeTypeScriptProject(legacyProject, { edgeLimit: 2 });

    assert.equal(unrestricted.success, true);
    assert.equal(unrestricted.edges.length, 3);
    assert.equal(new Set(unrestricted.edges.map((edge) => edge.id)).size, 3);
    assert.equal(new Set(unrestricted.edges.map(relationshipKey)).size, 2);
    assert.equal(limited.edges.length, 2);
    assert.deepEqual(limited.edges, unrestricted.edges.slice(0, 2));
    assert.equal(limited.limited, true);
  });
}
