import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { getFullGraphExplorer, searchSymbolExplorer, clearSymbolIndexCache, getSymbolIndexCacheStats } from "../src/lib/symbol-index.js";
import { gitFixture } from "./helpers/git-fixture.js";

test("direct .NET symbol queries reject stale revisions and successive dirty edits", (t) => {
  const f = gitFixture(t);
  clearSymbolIndexCache();
  t.after(() => clearSymbolIndexCache());
  f.write("Core.csproj", "<Project />\n");
  f.write("Source.cs", "namespace Sample; public class Original {}\n");
  f.commit();
  assert.ok(searchSymbolExplorer(f.project, "Original").nodes.length);
  f.write("Source.cs", "namespace Sample; public class Committed {}\n");
  f.commit("changed");
  assert.ok(searchSymbolExplorer(f.project, "Committed").nodes.length);
  assert.equal(searchSymbolExplorer(f.project, "Original").nodes.length, 0);
  assert.equal(getSymbolIndexCacheStats().size, 1);
  for (const name of ["DirtyOne", "DirtyTwo"]) {
    f.write("Source.cs", `namespace Sample; public class ${name} {}\n`);
    assert.ok(getFullGraphExplorer(f.project).nodes.some((node) => node.label === name));
    assert.equal(getSymbolIndexCacheStats().size, 0);
  }
});

test(".NET symbol cache separates worktrees and retains name-based clearing", (t) => {
  const f = gitFixture(t);
  clearSymbolIndexCache();
  t.after(() => clearSymbolIndexCache());
  f.write("Core.csproj", "<Project />\n");
  f.write("Source.cs", "namespace Sample; public class ParentOnly {}\n");
  f.commit();
  const linked = { ...f.project, absolutePath: f.worktree() };
  f.write("Source.cs", "namespace Sample; public class ChildOnly {}\n", linked.absolutePath);
  f.commit("child", linked.absolutePath);
  assert.ok(searchSymbolExplorer(linked, "ChildOnly").nodes.length);
  assert.equal(searchSymbolExplorer(f.project, "ChildOnly").nodes.length, 0);
  assert.equal(getSymbolIndexCacheStats().size, 2);
  assert.equal(clearSymbolIndexCache(f.project.name).removed, 2);
});

function makeGraphProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-dotnet-graph-"));

  for (const project of ["Faturas.Application", "Faturas.Domain", "Faturas.Infrastructure"]) {
    const dir = path.join(root, project);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${project}.csproj`), `<Project Sdk=\"Microsoft.NET.Sdk\"></Project>`);
  }

  fs.mkdirSync(path.join(root, "Faturas.Application", "Invoices"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "Faturas.Application", "Invoices", "InvoiceService.cs"),
    `namespace Faturas.Application.Invoices;
     public class InvoiceService {
       private readonly Invoice _invoice;
       public InvoiceService(Invoice invoice) { _invoice = invoice; }
     }`
  );

  fs.mkdirSync(path.join(root, "Faturas.Domain", "Invoices"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "Faturas.Domain", "Invoices", "Invoice.cs"),
    "namespace Faturas.Domain.Invoices; public class Invoice {}"
  );

  fs.mkdirSync(path.join(root, "Faturas.Infrastructure", "Suppliers"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "Faturas.Infrastructure", "Suppliers", "SupplierRepository.cs"),
    "namespace Faturas.Infrastructure.Suppliers; public class SupplierRepository {}"
  );

  return { name: "temp-faturas", absolutePath: root };
}

test("graph nodes include layer and feature metadata", () => {
  const project = makeGraphProject();
  const graph = getFullGraphExplorer(project, { nodeLimit: 50, edgeLimit: 50 });

  const invoiceService = graph.nodes.find((node) => node.label === "InvoiceService");
  assert.ok(invoiceService);
  assert.equal(invoiceService.layer, "Application");
  assert.equal(invoiceService.feature, "Invoices");

  const repository = graph.nodes.find((node) => node.label === "SupplierRepository");
  assert.ok(repository);
  assert.equal(repository.layer, "Infrastructure");
  assert.equal(repository.feature, "Suppliers");
});

test("getFullGraphExplorer filters graph by layer and feature", () => {
  const project = makeGraphProject();

  const applicationOnly = getFullGraphExplorer(project, {
    nodeLimit: 50,
    edgeLimit: 50,
    layers: ["Application"]
  });
  assert.deepEqual(new Set(applicationOnly.nodes.map((node) => node.layer)), new Set(["Application"]));

  const invoicesOnly = getFullGraphExplorer(project, {
    nodeLimit: 50,
    edgeLimit: 50,
    features: ["Invoices"]
  });
  assert.ok(invoicesOnly.nodes.length >= 2);
  assert.deepEqual(new Set(invoicesOnly.nodes.map((node) => node.feature)), new Set(["Invoices"]));
  assert.equal(invoicesOnly.nodes.some((node) => node.feature === "Suppliers"), false);
});
