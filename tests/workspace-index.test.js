import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_INDEX_LIMITS,
  buildWorkspaceIndex
} from "../src/lib/workspace-index.js";

function makeTempProject(name = "sample-project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-workspace-index-"));
  const absolutePath = path.join(root, name);
  fs.mkdirSync(absolutePath, { recursive: true });
  return {
    name,
    relativePath: name,
    absolutePath
  };
}

function writeAgent(project, relativeDir, yaml, body = "# Workspace\n\nWorkspace instructions.\n") {
  const dir = path.join(project.absolutePath, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "AGENT.md"), `---\n${yaml.trim()}\n---\n\n${body}`);
}

function workspaceIds(index) {
  return index.workspaces.map((workspace) => workspace.id);
}

function errorCodes(index) {
  return index.errors.map((error) => error.code);
}

test("buildWorkspaceIndex discovers canonical AGENT.md manifests in deterministic manifestPath order", () => {
  const project = makeTempProject();
  writeAgent(project, "testing", `
schemaVersion: 1
workspace:
  id: sample-testing
  project: sample-project
executor:
  required: sample-test-engineer
`, "# Testing\n\nTesting instructions.\n");
  writeAgent(project, path.join("engineering", "backend"), `
schemaVersion: 1
workspace:
  id: sample-backend
  project: sample-project
executor:
  required: sample-backend-engineer
owner:
  agent: sample-backend-architect
reviewers:
  - sample-reviewer
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
    agent: sample-test-engineer
`, "# Backend\n\nBackend instructions.\n");

  const index = buildWorkspaceIndex(project);

  assert.equal(index.schemaVersion, 1);
  assert.equal(index.valid, true);
  assert.equal(index.bounded, true);
  assert.deepEqual(index.project, {
    name: "sample-project",
    relativePath: "sample-project"
  });
  assert.deepEqual(index.limits, {
    maxDepth: 8,
    maxWorkspaces: 100,
    maxErrors: 50,
    maxWarnings: 50,
    includeInstructions: false
  });
  assert.equal(index.truncated, false);
  assert.deepEqual(workspaceIds(index), ["sample-backend", "sample-testing"]);
  assert.deepEqual(index.workspaces.map((workspace) => workspace.manifestPath), [
    "engineering/backend/AGENT.md",
    "testing/AGENT.md"
  ]);
  assert.deepEqual(index.workspaces[0], {
    id: "sample-backend",
    manifestPath: "engineering/backend/AGENT.md",
    workspacePath: "engineering/backend",
    project: "sample-project",
    executor: { required: "sample-backend-engineer" },
    owner: { agent: "sample-backend-architect" },
    reviewers: ["sample-reviewer"],
    permissions: {
      read: true,
      write: true,
      executeCommands: true,
      createAgents: false
    },
    scope: {
      include: ["src/backend/**"],
      exclude: []
    },
    preconditions: ["tests_green_before_change"],
    routing: {
      success: { agent: "sample-test-engineer" }
    },
    source: {
      path: "engineering/backend/AGENT.md",
      frontMatterStartLine: 1,
      frontMatterEndLine: 25,
      instructionsStartLine: 27
    }
  });
  assert.deepEqual(index.errors, []);
  assert.deepEqual(index.warnings, []);
  assert.equal(JSON.stringify(index).includes(project.absolutePath), false);
});

test("buildWorkspaceIndex indexes a valid root-level AGENT.md with relative manifest path", () => {
  const project = makeTempProject();
  writeAgent(project, ".", `
schemaVersion: 1
workspace:
  id: sample-root
executor:
  required: sample-backend-engineer
`);

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, true);
  assert.equal(index.workspaces.length, 1);
  assert.equal(index.workspaces[0].manifestPath, "AGENT.md");
  assert.equal(index.workspaces[0].workspacePath, ".");
  assert.equal(index.workspaces[0].project, "sample-project");
});

test("buildWorkspaceIndex treats AGENTS.md as contextual instructions, not a workspace manifest", () => {
  const project = makeTempProject();
  fs.writeFileSync(path.join(project.absolutePath, "AGENTS.md"), `---\nschemaVersion: 1\nworkspace:\n  id: sample-wrong\nexecutor:\n  required: sample-backend-engineer\n---\n`);

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, true);
  assert.deepEqual(index.workspaces, []);
  assert.deepEqual(index.errors, []);
});

test("buildWorkspaceIndex does not duplicate Markdown instructions by default", () => {
  const project = makeTempProject();
  writeAgent(project, "engineering/backend", `
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`, "# Backend\n\nAlways send this work to generic-coder.\n" );

  const index = buildWorkspaceIndex(project);

  assert.equal(index.workspaces[0].executor.required, "sample-backend-engineer");
  assert.equal(Object.hasOwn(index.workspaces[0], "instructions"), false);
  assert.equal(JSON.stringify(index).includes("generic-coder"), false);
});

test("buildWorkspaceIndex can include parser-preserved Markdown instructions when explicitly requested", () => {
  const project = makeTempProject();
  writeAgent(project, "engineering/backend", `
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`, "# Backend\n\nAlways send this work to generic-coder.\n");

  const index = buildWorkspaceIndex(project, { includeInstructions: true });

  assert.equal(index.workspaces[0].executor.required, "sample-backend-engineer");
  assert.equal(index.workspaces[0].instructions, "# Backend\n\nAlways send this work to generic-coder.\n");
});

test("buildWorkspaceIndex reports duplicate workspace IDs as non-authoritative errors", () => {
  const project = makeTempProject();
  writeAgent(project, "engineering/frontend", `
schemaVersion: 1
workspace:
  id: shared-workspace
executor:
  required: sample-frontend-engineer
`);
  writeAgent(project, "engineering/backend", `
schemaVersion: 1
workspace:
  id: shared-workspace
executor:
  required: sample-backend-engineer
`);

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, false);
  assert.deepEqual(index.workspaces, []);
  assert.deepEqual(index.errors, [{
    code: "duplicate_workspace_id",
    workspaceId: "shared-workspace",
    paths: [
      "engineering/backend/AGENT.md",
      "engineering/frontend/AGENT.md"
    ]
  }]);
});

test("buildWorkspaceIndex preserves valid workspaces when another manifest is invalid", () => {
  const project = makeTempProject();
  writeAgent(project, "engineering/backend", `
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`);
  fs.mkdirSync(path.join(project.absolutePath, "engineering", "broken"), { recursive: true });
  fs.writeFileSync(path.join(project.absolutePath, "engineering", "broken", "AGENT.md"), "---\nworkspace: [unterminated\n---\n# Broken\n");

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, false);
  assert.deepEqual(workspaceIds(index), ["sample-backend"]);
  assert.deepEqual(errorCodes(index), ["invalid_yaml"]);
  assert.equal(index.errors[0].path, "engineering/broken/AGENT.md");
  assert.equal(index.errors[0].stack, undefined);
});

test("buildWorkspaceIndex preserves specific parser error codes", () => {
  const project = makeTempProject();
  writeAgent(project, "unsupported", `
schemaVersion: 2
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`);
  writeAgent(project, "missing-executor", `
schemaVersion: 1
workspace:
  id: sample-frontend
executor: {}
`);

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, false);
  assert.deepEqual(index.errors.map((error) => [error.path, error.code]), [
    ["missing-executor/AGENT.md", "missing_required_executor"],
    ["unsupported/AGENT.md", "unsupported_schema_version"]
  ]);
});

test("buildWorkspaceIndex rejects explicit workspace.project mismatches", () => {
  const project = makeTempProject();
  writeAgent(project, "engineering/backend", `
schemaVersion: 1
workspace:
  id: sample-backend
  project: other-project
executor:
  required: sample-backend-engineer
`);
  writeAgent(project, "testing", `
schemaVersion: 1
workspace:
  id: sample-testing
executor:
  required: sample-test-engineer
`);

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, false);
  assert.deepEqual(workspaceIds(index), ["sample-testing"]);
  assert.deepEqual(index.errors, [{
    code: "workspace_project_mismatch",
    path: "engineering/backend/AGENT.md",
    expectedProject: "sample-project",
    actualProject: "other-project"
  }]);
  assert.equal(index.workspaces[0].project, "sample-project");
});

test("buildWorkspaceIndex does not traverse ignored dependency or generated directories", () => {
  const project = makeTempProject();
  for (const ignoredDir of [".git", "node_modules", "bin", "obj", "dist", "build", "coverage", ".next"]) {
    writeAgent(project, path.join(ignoredDir, "fake-package"), `
schemaVersion: 1
workspace:
  id: sample-${ignoredDir.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "git"}
executor:
  required: sample-backend-engineer
`);
  }

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, true);
  assert.deepEqual(index.workspaces, []);
  assert.deepEqual(index.errors, []);
});

test("buildWorkspaceIndex does not follow symlinked directories or symlinked AGENT.md files", { skip: !canCreateSymlink() }, () => {
  const project = makeTempProject();
  const external = makeTempProject("external-project");
  writeAgent(external, "linked-workspace", `
schemaVersion: 1
workspace:
  id: sample-linked
executor:
  required: sample-linked-engineer
`);
  fs.symlinkSync(path.join(external.absolutePath, "linked-workspace"), path.join(project.absolutePath, "linked-workspace"), "dir");

  fs.mkdirSync(path.join(project.absolutePath, "symlink-file"), { recursive: true });
  fs.symlinkSync(
    path.join(external.absolutePath, "linked-workspace", "AGENT.md"),
    path.join(project.absolutePath, "symlink-file", "AGENT.md"),
    "file"
  );

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, true);
  assert.deepEqual(index.workspaces, []);
});

test("buildWorkspaceIndex honors bounded scan depth", () => {
  const project = makeTempProject();
  writeAgent(project, ".", `
schemaVersion: 1
workspace:
  id: sample-root
executor:
  required: sample-backend-engineer
`);
  writeAgent(project, "level1", `
schemaVersion: 1
workspace:
  id: sample-level-one
executor:
  required: sample-backend-engineer
`);
  writeAgent(project, path.join("level1", "level2"), `
schemaVersion: 1
workspace:
  id: sample-level-two
executor:
  required: sample-backend-engineer
`);

  const index = buildWorkspaceIndex(project, { maxDepth: 1 });

  assert.deepEqual(index.limits.maxDepth, 1);
  assert.deepEqual(index.workspaces.map((workspace) => workspace.manifestPath), [
    "AGENT.md",
    "level1/AGENT.md"
  ]);
});

test("buildWorkspaceIndex clamps maxDepth and maxWorkspaces to explicit maximums", () => {
  const project = makeTempProject();
  writeAgent(project, "a", `
schemaVersion: 1
workspace:
  id: sample-a
executor:
  required: sample-backend-engineer
`);

  const index = buildWorkspaceIndex(project, { maxDepth: 99, maxWorkspaces: 999 });

  assert.equal(index.limits.maxDepth, WORKSPACE_INDEX_LIMITS.maxMaxDepth);
  assert.equal(index.limits.maxWorkspaces, WORKSPACE_INDEX_LIMITS.maxMaxWorkspaces);
});

test("buildWorkspaceIndex bounds workspace count and truncates only on actual omission", () => {
  const exactProject = makeTempProject();
  writeAgent(exactProject, "a", `
schemaVersion: 1
workspace:
  id: sample-a
executor:
  required: sample-backend-engineer
`);
  writeAgent(exactProject, "b", `
schemaVersion: 1
workspace:
  id: sample-b
executor:
  required: sample-backend-engineer
`);

  const exact = buildWorkspaceIndex(exactProject, { maxWorkspaces: 2 });
  assert.deepEqual(workspaceIds(exact), ["sample-a", "sample-b"]);
  assert.equal(exact.truncated, false);

  const truncatedProject = makeTempProject();
  for (const id of ["a", "b", "c"]) {
    writeAgent(truncatedProject, id, `
schemaVersion: 1
workspace:
  id: sample-${id}
executor:
  required: sample-backend-engineer
`);
  }

  const truncated = buildWorkspaceIndex(truncatedProject, { maxWorkspaces: 2 });
  assert.deepEqual(workspaceIds(truncated), ["sample-a", "sample-b"]);
  assert.equal(truncated.truncated, true);
});

test("buildWorkspaceIndex bounds error and warning payloads", () => {
  const project = makeTempProject();
  for (let index = 0; index < WORKSPACE_INDEX_LIMITS.defaultMaxErrors + 5; index += 1) {
    const dir = path.join(project.absolutePath, `broken-${String(index).padStart(2, "0")}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "AGENT.md"), "---\nworkspace: [unterminated\n---\n# Broken\n");
  }

  const index = buildWorkspaceIndex(project);

  assert.equal(index.valid, false);
  assert.equal(index.errors.length, WORKSPACE_INDEX_LIMITS.defaultMaxErrors);
  assert.equal(index.warnings.length, 1);
  assert.deepEqual(index.warnings[0], {
    code: "errors_truncated",
    omitted: 5
  });
});

test("buildWorkspaceIndex uses a resolved project input and never resolves registry/config itself", () => {
  const project = makeTempProject();
  writeAgent(project, "engineering/backend", `
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
permissions:
  write: true
routing:
  success:
    agent: sample-review
`);

  const index = buildWorkspaceIndex(project);

  assert.deepEqual(index.workspaces[0].routing, {
    success: { agent: "sample-review" }
  });
  assert.equal(index.workspaces[0].permissions.write, true);
  assert.equal(Object.hasOwn(index.workspaces[0], "selectedAgent"), false);
  assert.equal(Object.hasOwn(index.workspaces[0], "decision"), false);
  assert.equal(Object.hasOwn(index.workspaces[0], "allowed"), false);
  assert.equal(Object.hasOwn(index.workspaces[0], "denied"), false);
});

function canCreateSymlink() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-map-workspace-symlink-check-"));
  const target = path.join(root, "target");
  const link = path.join(root, "link");

  try {
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, "dir");
    return true;
  } catch {
    return false;
  }
}
