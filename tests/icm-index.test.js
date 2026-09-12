import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  ICM_INDEX_LIMITS,
  buildProjectIcmIndex
} from "../src/lib/icm-index.js";

function makeTempProject(name = "sample-project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-icm-index-"));
  const absolutePath = path.join(root, name);
  fs.mkdirSync(absolutePath, { recursive: true });
  return {
    name,
    relativePath: name,
    absolutePath
  };
}

function writeFile(project, relativePath, contents) {
  const filePath = path.join(project.absolutePath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function writeAgent(project, relativeDir = "engineering/backend", yaml = "") {
  writeFile(project, path.join(relativeDir, "AGENT.md"), `---
schemaVersion: 1
workspace:
  id: sample-backend
  project: sample-project
executor:
  required: sample-backend-engineer
owner:
  agent: sample-backend-architect
reviewers:
  - sample-review
permissions:
  read: true
  write: true
  executeCommands: true
  createAgents: false
scope:
  include:
    - src/backend/**
preconditions:
  - tests_green_before_change
routing:
  success:
    agent: sample-review
${yaml}---

# Backend

Workspace instructions should stay compact by default.
`);
}

function workspaceIds(index) {
  return index.workspaces.map((workspace) => workspace.id);
}

function documentPaths(index) {
  return index.documents.map((document) => document.path);
}

test("buildProjectIcmIndex composes workspace contracts with contextual documents", () => {
  const project = makeTempProject();
  writeFile(project, "PROJECT.md", "# Sample Project\n\nProject context.\n");
  writeFile(project, "AGENTS.md", "# Root Agents\n\nModel context.\n");
  writeAgent(project);
  writeFile(project, "engineering/backend/CONTEXT.md", "# Backend Context\n\nDomain context.\n");
  writeFile(project, "docs/adr/ADR-001-storage.md", "# Storage\n\nUse storage.\n");

  const index = buildProjectIcmIndex(project);

  assert.equal(index.schemaVersion, 1);
  assert.equal(index.valid, true);
  assert.equal(index.bounded, true);
  assert.deepEqual(index.project, {
    name: "sample-project",
    relativePath: "sample-project"
  });
  assert.deepEqual(index.authority, {
    workspaceContracts: "agent_manifest_front_matter",
    contextualDocuments: "context_only"
  });
  assert.equal(index.limits.maxErrors, 100);
  assert.equal(index.limits.maxWarnings, 100);
  assert.equal(index.limits.workspace.includeInstructions, false);
  assert.equal(index.limits.documents.includeContent, false);
  assert.deepEqual(workspaceIds(index), ["sample-backend"]);
  assert.deepEqual(documentPaths(index), [
    "AGENTS.md",
    "PROJECT.md",
    "docs/adr/ADR-001-storage.md",
    "engineering/backend/CONTEXT.md"
  ]);
  assert.deepEqual(index.truncated, {
    workspaces: false,
    documents: false
  });
  assert.deepEqual(index.errors, []);
  assert.deepEqual(index.warnings, []);
  assert.equal(JSON.stringify(index).includes(project.absolutePath), false);
  assert.equal(documentPaths(index).includes("engineering/backend/AGENT.md"), false);
  assert.equal(Object.hasOwn(index.documents[0], "executor"), false);
});

test("buildProjectIcmIndex preserves AGENT.md authority over contextual prose", () => {
  const project = makeTempProject();
  writeAgent(project);
  writeFile(project, "AGENTS.md", "# Agents\n\nexecutor: generic-coder\nrouting:\n  success:\n    agent: unsafe-agent\n");
  writeFile(project, "engineering/backend/CONTEXT.md", "# Context\n\nexecutor: generic-coder\n");

  const index = buildProjectIcmIndex(project, {
    documents: { includeContent: true }
  });

  assert.equal(index.valid, true);
  assert.equal(index.workspaces[0].executor.required, "sample-backend-engineer");
  assert.deepEqual(index.workspaces[0].routing, {
    success: { agent: "sample-review" }
  });
  assert.ok(index.documents.some((document) => document.content?.includes("executor: generic-coder")));
  assert.ok(index.documents.every((document) => !Object.hasOwn(document, "routing")));
  assert.equal(Object.hasOwn(index, "selectedAgent"), false);
  assert.equal(Object.hasOwn(index, "decision"), false);
});

test("buildProjectIcmIndex returns a valid bounded empty index for projects without ICM files", () => {
  const project = makeTempProject();

  const index = buildProjectIcmIndex(project);

  assert.equal(index.valid, true);
  assert.deepEqual(index.workspaces, []);
  assert.deepEqual(index.documents, []);
  assert.deepEqual(index.errors, []);
  assert.deepEqual(index.warnings, []);
  assert.deepEqual(index.truncated, { workspaces: false, documents: false });
});

test("buildProjectIcmIndex supports workspace-only projects", () => {
  const project = makeTempProject();
  writeAgent(project);

  const index = buildProjectIcmIndex(project);

  assert.equal(index.valid, true);
  assert.deepEqual(workspaceIds(index), ["sample-backend"]);
  assert.deepEqual(index.documents, []);
});

test("buildProjectIcmIndex supports context-only projects without inventing workspaces", () => {
  const project = makeTempProject();
  writeFile(project, "PROJECT.md", "# Sample Project\n");
  writeFile(project, "AGENTS.md", "# Root Agents\n");

  const index = buildProjectIcmIndex(project);

  assert.equal(index.valid, true);
  assert.deepEqual(index.workspaces, []);
  assert.deepEqual(documentPaths(index), ["AGENTS.md", "PROJECT.md"]);
});

test("buildProjectIcmIndex preserves project-mismatch workspace errors and contextual documents", () => {
  const project = makeTempProject();
  writeFile(project, "PROJECT.md", "# Sample Project\n");
  writeFile(project, "engineering/backend/AGENT.md", `---
schemaVersion: 1
workspace:
  id: sample-backend
  project: other-project
executor:
  required: sample-backend-engineer
---

# Backend
`);

  const index = buildProjectIcmIndex(project);

  assert.equal(index.valid, false);
  assert.deepEqual(index.workspaces, []);
  assert.deepEqual(documentPaths(index), ["PROJECT.md"]);
  assert.deepEqual(index.errors, [{
    source: "workspace",
    code: "workspace_project_mismatch",
    path: "engineering/backend/AGENT.md",
    expectedProject: "sample-project",
    actualProject: "other-project"
  }]);
});

test("buildProjectIcmIndex preserves duplicate workspace ambiguity without resolving it", () => {
  const project = makeTempProject();
  writeAgent(project, "engineering/backend");
  writeAgent(project, "engineering/frontend");
  writeFile(project, "PROJECT.md", "# Sample Project\n");

  const index = buildProjectIcmIndex(project);

  assert.equal(index.valid, false);
  assert.deepEqual(index.workspaces, []);
  assert.deepEqual(documentPaths(index), ["PROJECT.md"]);
  assert.deepEqual(index.errors, [{
    source: "workspace",
    code: "duplicate_workspace_id",
    workspaceId: "sample-backend",
    paths: [
      "engineering/backend/AGENT.md",
      "engineering/frontend/AGENT.md"
    ]
  }]);
});

test("buildProjectIcmIndex keeps contextual read errors non-fatal when workspace authority is valid", () => {
  const project = makeTempProject();
  writeAgent(project);
  writeFile(project, "CONTEXT.md", "# Broken Context\n");
  const brokenPath = path.join(project.absolutePath, "CONTEXT.md");
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function readFileSyncWithBrokenContext(filePath, ...args) {
    if (filePath === brokenPath) {
      throw new Error("simulated read failure");
    }
    return originalReadFileSync.call(this, filePath, ...args);
  };

  try {
    const index = buildProjectIcmIndex(project);

    assert.equal(index.valid, true);
    assert.deepEqual(workspaceIds(index), ["sample-backend"]);
    assert.deepEqual(index.documents, []);
    assert.deepEqual(index.errors, [{
      source: "document",
      code: "document_read_failed",
      path: "CONTEXT.md",
      message: "Contextual document could not be read."
    }]);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test("buildProjectIcmIndex composes errors and warnings with bounded subsystem sources", () => {
  const project = makeTempProject();
  writeFile(project, "broken/AGENT.md", "---\nworkspace: [unterminated\n---\n# Broken\n");
  writeFile(project, "CONTEXT.md", "# Oversized\n" + "x".repeat(128 * 1024 + 1));

  const index = buildProjectIcmIndex(project);

  assert.equal(index.valid, false);
  assert.deepEqual(index.errors.map((error) => [error.source, error.code, error.path]), [
    ["workspace", "invalid_yaml", "broken/AGENT.md"],
    ["document", "document_too_large", "CONTEXT.md"]
  ]);
  assert.deepEqual(index.warnings, []);
});

test("buildProjectIcmIndex bounds final errors and reports truncation deterministically", () => {
  const project = makeTempProject();
  for (let index = 0; index < 55; index += 1) {
    writeFile(project, `broken-workspaces/${String(index).padStart(2, "0")}/AGENT.md`, "---\nworkspace: [unterminated\n---\n# Broken\n");
    writeFile(project, `broken-documents/${String(index).padStart(2, "0")}/CONTEXT.md`, "x".repeat(128 * 1024 + 1));
  }

  const index = buildProjectIcmIndex(project, { maxErrors: 60 });

  assert.equal(index.valid, false);
  assert.equal(index.errors.length, 60);
  assert.equal(index.warnings[0].source, "icm");
  assert.equal(index.warnings[0].code, "errors_truncated");
  assert.ok(index.warnings[0].omitted > 0);
});

test("buildProjectIcmIndex passes explicit workspace and document options without ambiguous names", () => {
  const project = makeTempProject();
  writeAgent(project, "a");
  writeFile(project, "b/AGENT.md", `---
schemaVersion: 1
workspace:
  id: sample-frontend
executor:
  required: sample-frontend-engineer
---

# Frontend
`);
  writeFile(project, "a/AGENTS.md", "# A\n");
  writeFile(project, "b/AGENTS.md", "# B\n");

  const index = buildProjectIcmIndex(project, {
    workspace: { maxWorkspaces: 1, includeInstructions: true },
    documents: { maxDocuments: 1, includeContent: true }
  });

  assert.equal(index.limits.workspace.maxWorkspaces, 1);
  assert.equal(index.limits.workspace.includeInstructions, true);
  assert.equal(index.limits.documents.maxDocuments, 1);
  assert.equal(index.limits.documents.includeContent, true);
  assert.equal(index.workspaces.length, 1);
  assert.equal(Object.hasOwn(index.workspaces[0], "instructions"), true);
  assert.equal(index.documents.length, 1);
  assert.equal(Object.hasOwn(index.documents[0], "content"), true);
  assert.deepEqual(index.truncated, {
    workspaces: true,
    documents: true
  });
});

test("buildProjectIcmIndex receives a resolved project and does not add routing or enforcement decisions", () => {
  const project = makeTempProject();
  writeAgent(project);

  const index = buildProjectIcmIndex(project);

  assert.equal(Object.hasOwn(index, "rootId"), false);
  assert.equal(Object.hasOwn(index, "registry"), false);
  assert.equal(Object.hasOwn(index, "selectedAgent"), false);
  assert.equal(Object.hasOwn(index, "confidence"), false);
  assert.equal(Object.hasOwn(index, "allowed"), false);
  assert.equal(Object.hasOwn(index, "denied"), false);
  assert.equal(JSON.stringify(index).includes("ALLOW"), false);
  assert.equal(JSON.stringify(index).includes("DENY"), false);
  assert.ok(ICM_INDEX_LIMITS.defaultMaxErrors <= 100);
  assert.ok(ICM_INDEX_LIMITS.defaultMaxWarnings <= 100);
});
