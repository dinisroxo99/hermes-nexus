import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { analyzeTypeScriptProject } from "../src/analyzers/typescript/typescript-analyzer.js";

function makeTempTypeScriptProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-project-map-ts-analyzer-"));

  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  fs.writeFileSync(path.join(root, "tsconfig.json"), '{"compilerOptions":{"jsx":"react-jsx"}}\n');

  return root;
}

function analyzeTempProject(root) {
  return analyzeTypeScriptProject({
    name: "temp-typescript",
    absolutePath: root
  });
}

test("analyzeTypeScriptProject detects named default function exports", () => {
  const root = makeTempTypeScriptProject();
  const componentDir = path.join(root, "src", "features", "invoices", "components");
  fs.mkdirSync(componentDir, { recursive: true });
  fs.writeFileSync(
    path.join(componentDir, "invoice-list.tsx"),
    "export default function InvoiceList() { return null; }\n"
  );

  const result = analyzeTempProject(root);

  assert.equal(result.success, true);
  assert.ok(result.nodes.some((node) => node.label === "InvoiceList"));
});

test("analyzeTypeScriptProject detects named default class exports", () => {
  const root = makeTempTypeScriptProject();
  const serviceDir = path.join(root, "src", "features", "invoices", "services");
  fs.mkdirSync(serviceDir, { recursive: true });
  fs.writeFileSync(
    path.join(serviceDir, "invoice-service.ts"),
    "export default class InvoiceService {}\n"
  );

  const result = analyzeTempProject(root);

  assert.equal(result.success, true);
  assert.ok(result.nodes.some((node) => node.label === "InvoiceService"));
});

test("analyzeTypeScriptProject does not duplicate named default exports", () => {
  const root = makeTempTypeScriptProject();
  const componentDir = path.join(root, "src", "features", "invoices", "components");
  fs.mkdirSync(componentDir, { recursive: true });
  fs.writeFileSync(
    path.join(componentDir, "invoice-list.tsx"),
    "export default function InvoiceList() { return null; }\n"
  );

  const result = analyzeTempProject(root);
  const matches = result.nodes.filter((node) => node.label === "InvoiceList");

  assert.equal(matches.length, 1);
});

test("analyzeTypeScriptProject keeps named hook export detection", () => {
  const root = makeTempTypeScriptProject();
  const hooksDir = path.join(root, "src", "features", "invoices", "hooks");
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.writeFileSync(
    path.join(hooksDir, "use-invoices.ts"),
    "export function useInvoices() { return []; }\n"
  );

  const result = analyzeTempProject(root);
  const hook = result.nodes.find((node) => node.label === "useInvoices");

  assert.ok(hook);
  assert.equal(hook.category, "hook");
});

test("analyzeTypeScriptProject detects anonymous default component exports from file name", () => {
  const root = makeTempTypeScriptProject();
  const componentDir = path.join(root, "src", "features", "invoices", "components");
  fs.mkdirSync(componentDir, { recursive: true });
  fs.writeFileSync(
    path.join(componentDir, "invoice-list.tsx"),
    "export default function () { return null; }\n"
  );

  const result = analyzeTempProject(root);

  assert.equal(result.success, true);
  assert.ok(result.nodes.some((node) => node.label === "InvoiceList"));
});

test("analyzeTypeScriptProject connects default import aliases to default exports", () => {
  const root = makeTempTypeScriptProject();
  const srcDir = path.join(root, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  fs.writeFileSync(
    path.join(srcDir, "invoice-list.tsx"),
    "export default function InvoiceList() { return null; }\n"
  );

  fs.writeFileSync(
    path.join(srcDir, "app.tsx"),
    "import List from './invoice-list';\nexport function App() { return List; }\n"
  );

  const result = analyzeTempProject(root);
  const app = result.nodes.find((node) => node.label === "App");
  const invoiceList = result.nodes.find((node) => node.label === "InvoiceList");

  assert.equal(result.success, true);
  assert.ok(app);
  assert.ok(invoiceList);
  assert.ok(result.edges.some((edge) =>
    edge.from === app.id &&
    edge.to === invoiceList.id &&
    edge.relation === "imports" &&
    edge.label === "importa default"
  ));
});

test("analyzeTypeScriptProject resolves tsconfig path aliases", () => {
  const root = makeTempTypeScriptProject();
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      jsx: "react-jsx",
      baseUrl: ".",
      paths: {
        "@features/*": ["src/features/*"]
      }
    }
  }));

  fs.mkdirSync(path.join(root, "src", "features", "invoices"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "features", "invoices", "invoice-service.ts"),
    "export class InvoiceService {}\n"
  );
  fs.writeFileSync(
    path.join(root, "src", "app.ts"),
    "import { InvoiceService } from '@features/invoices/invoice-service';\nexport function App() { return InvoiceService; }\n"
  );

  const result = analyzeTempProject(root);
  const app = result.nodes.find((node) => node.label === "App");
  const service = result.nodes.find((node) => node.label === "InvoiceService");

  assert.ok(result.edges.some((edge) => edge.from === app.id && edge.to === service.id));
});

test("analyzeTypeScriptProject resolves named re-exports through barrel files", () => {
  const root = makeTempTypeScriptProject();
  fs.mkdirSync(path.join(root, "src", "components"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "components", "invoice-list.tsx"),
    "export function InvoiceList() { return null; }\n"
  );
  fs.writeFileSync(
    path.join(root, "src", "components", "index.ts"),
    "export { InvoiceList } from './invoice-list';\n"
  );
  fs.writeFileSync(
    path.join(root, "src", "app.tsx"),
    "import { InvoiceList } from './components';\nexport function App() { return InvoiceList; }\n"
  );

  const result = analyzeTempProject(root);
  const app = result.nodes.find((node) => node.label === "App");
  const invoiceList = result.nodes.find((node) => node.label === "InvoiceList");

  assert.ok(result.edges.some((edge) => edge.from === app.id && edge.to === invoiceList.id));
});