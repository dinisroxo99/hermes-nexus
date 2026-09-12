import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_MANIFEST_LIMITS,
  parseAgentManifest,
  readAgentManifest
} from "../src/lib/agent-manifest.js";

function frontMatter(yaml, body = "# Backend\n\nContextual instructions for the model.\n") {
  return `---\n${yaml.trim()}\n---\n\n${body}`;
}

function assertFailure(result, code) {
  assert.equal(result.ok, false);
  assert.equal(result.error.code, code);
}

function makeTempRoot(prefix = "project-map-agent-manifest-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("parses the minimum valid AGENT.md contract and preserves Markdown separately", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`, "# Backend\n\nUse generic-coder for this task.\n"), {
    sourcePath: "workspaces/sample-backend/AGENT.md"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, {
    schemaVersion: 1,
    workspace: {
      id: "sample-backend"
    },
    executor: {
      required: "sample-backend-engineer"
    },
    owner: null,
    reviewers: [],
    permissions: {
      read: false,
      write: false,
      executeCommands: false,
      createAgents: false
    },
    scope: {
      include: [],
      exclude: []
    },
    preconditions: [],
    routing: {},
    instructions: "# Backend\n\nUse generic-coder for this task.\n",
    source: {
      path: "workspaces/sample-backend/AGENT.md",
      frontMatterStartLine: 1,
      frontMatterEndLine: 7,
      instructionsStartLine: 9
    }
  });
  assert.deepEqual(result.warnings, []);
});

test("parses and normalizes all canonical schemaVersion 1 fields deterministically", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-engineering-backend
  project: sample-project
executor:
  required: sample-backend-engineer
owner:
  agent: sample-backend-architect
reviewers:
  - sample-reviewer
  - sample-reviewer
permissions:
  read: true
  write: true
  executeCommands: true
  createAgents: false
scope:
  include:
    - src/backend/**
    - tests/backend/**
  exclude:
    - src/frontend/**
preconditions:
  - tests_green_before_change
routing:
  success:
    agent: sample-test-engineer
  architectureChange:
    agent: sample-backend-architect
  unclearRequirement:
    agent: sample-product-agent
`), {
    sourcePath: "AGENT.md"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, {
    schemaVersion: 1,
    workspace: {
      id: "sample-engineering-backend",
      project: "sample-project"
    },
    executor: {
      required: "sample-backend-engineer"
    },
    owner: {
      agent: "sample-backend-architect"
    },
    reviewers: ["sample-reviewer"],
    permissions: {
      read: true,
      write: true,
      executeCommands: true,
      createAgents: false
    },
    scope: {
      include: ["src/backend/**", "tests/backend/**"],
      exclude: ["src/frontend/**"]
    },
    preconditions: ["tests_green_before_change"],
    routing: {
      architectureChange: {
        agent: "sample-backend-architect"
      },
      success: {
        agent: "sample-test-engineer"
      },
      unclearRequirement: {
        agent: "sample-product-agent"
      }
    },
    instructions: "# Backend\n\nContextual instructions for the model.\n",
    source: {
      path: "AGENT.md",
      frontMatterStartLine: 1,
      frontMatterEndLine: 33,
      instructionsStartLine: 35
    }
  });
});

test("does not treat Markdown prose as routing or executor authority", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
routing:
  success:
    agent: sample-test-engineer
`, "# Backend\n\nUse generic-coder for this task. Route success to prose-agent.\n"));

  assert.equal(result.ok, true);
  assert.equal(result.manifest.executor.required, "sample-backend-engineer");
  assert.deepEqual(result.manifest.routing, {
    success: {
      agent: "sample-test-engineer"
    }
  });
  assert.match(result.manifest.instructions, /generic-coder/);
});

test("rejects Markdown-only AGENT.md as missing machine front matter", () => {
  const result = parseAgentManifest("# Backend\n\nexecutor: sample-backend-engineer\n", {
    sourcePath: "AGENT.md"
  });

  assertFailure(result, "missing_front_matter");
});

test("rejects invalid YAML without exposing raw parser stack traces", () => {
  const result = parseAgentManifest("---\nworkspace: [unterminated\n---\n# Backend\n");

  assertFailure(result, "invalid_yaml");
  assert.equal(result.error.stack, undefined);
});

test("rejects unsupported schema versions explicitly", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 2
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`));

  assertFailure(result, "unsupported_schema_version");
});

test("requires schemaVersion, workspace.id, and executor.required only", () => {
  assertFailure(parseAgentManifest(frontMatter(`
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`)), "missing_schema_version");

  assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace: {}
executor:
  required: sample-backend-engineer
`)), "invalid_workspace_id");

  assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor: {}
`)), "missing_required_executor");

  assert.equal(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`)).ok, true);
});

test("validates canonical machine identifiers without treating them as file paths", () => {
  for (const id of ["sample-backend", "sample-backend-engineer", "cookation.engineering.backend"]) {
    const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: ${id}
executor:
  required: sample-backend-engineer
`));

    assert.equal(result.ok, true, id);
  }

  for (const id of ["", "   ", "../agent", "team/agent", "team\\agent", "agent\nnext"]) {
    const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: ${JSON.stringify(id)}
executor:
  required: sample-backend-engineer
`));

    assertFailure(result, "invalid_workspace_id");
  }
});

test("normalizes reviewers as bounded de-duplicated strings in first-seen order", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
reviewers:
  - sample-reviewer
  - sample-backend-architect
  - sample-reviewer
`));

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest.reviewers, ["sample-reviewer", "sample-backend-architect"]);

  const oversized = Array.from({ length: AGENT_MANIFEST_LIMITS.maxReviewers + 1 }, (_, index) => `  - reviewer-${index}`).join("\n");
  assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
reviewers:
${oversized}
`)), "too_many_reviewers");
});

test("validates scope patterns as bounded project-relative data without glob matching", () => {
  const valid = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
scope:
  include:
    - src/backend/**
    - tests/backend/**
  exclude:
    - src/frontend/**
`));

  assert.equal(valid.ok, true);
  assert.deepEqual(valid.manifest.scope.include, ["src/backend/**", "tests/backend/**"]);
  assert.deepEqual(valid.manifest.scope.exclude, ["src/frontend/**"]);

  for (const pattern of ["/etc/**", "C:/secret/**", "../secret/**", "src/../secret/**"]) {
    assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
scope:
  include:
    - ${JSON.stringify(pattern)}
`)), "invalid_scope_pattern");
  }
});

test("requires canonical permission values to be booleans", () => {
  const valid = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
permissions:
  read: true
  write: false
  executeCommands: true
  createAgents: false
`));

  assert.equal(valid.ok, true);
  assert.deepEqual(valid.manifest.permissions, {
    read: true,
    write: false,
    executeCommands: true,
    createAgents: false
  });

  assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
permissions:
  write: "false"
`)), "invalid_permission_value");
});

test("validates bounded deterministic routing metadata without executing routes", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
routing:
  unclearRequirement:
    agent: sample-product-agent
  success:
    agent: sample-test-engineer
`));

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.manifest.routing), ["success", "unclearRequirement"]);
  assert.deepEqual(result.manifest.routing.success, { agent: "sample-test-engineer" });

  const oversized = Array.from({ length: AGENT_MANIFEST_LIMITS.maxRoutingEntries + 1 }, (_, index) => `  event${index}:\n    agent: sample-test-engineer`).join("\n");
  assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
routing:
${oversized}
`)), "too_many_routing_entries");
});

test("parses bounded preconditions as metadata only", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
preconditions:
  - tests_green_before_change
  - tests_green_before_change
`));

  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest.preconditions, ["tests_green_before_change"]);

  const oversized = Array.from({ length: AGENT_MANIFEST_LIMITS.maxPreconditions + 1 }, (_, index) => `  - precondition_${index}`).join("\n");
  assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
preconditions:
${oversized}
`)), "too_many_preconditions");
});

test("rejects oversized manifests before parsing", () => {
  const result = parseAgentManifest(`${"#".repeat(AGENT_MANIFEST_LIMITS.maxFileSizeBytes + 1)}`);

  assertFailure(result, "manifest_too_large");
});

test("rejects duplicate YAML keys instead of choosing ambiguous authority", () => {
  const result = parseAgentManifest(`---
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: agent-a
executor:
  required: agent-b
---

# Backend
`);

  assertFailure(result, "duplicate_yaml_key");
});

test("tolerates unknown top-level fields with bounded warnings but rejects malformed known fields", () => {
  const result = parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
futureField:
  enabled: true
`));

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, [{
    code: "unknown_top_level_field",
    field: "futureField"
  }]);
  assert.equal(Object.hasOwn(result.manifest, "futureField"), false);

  assertFailure(parseAgentManifest(frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
permissions:
  write: "false"
`)), "invalid_permission_value");
});

test("readAgentManifest reads one supplied AGENT.md file without scanning workspaces", () => {
  const dir = makeTempRoot();
  const manifestPath = path.join(dir, "AGENT.md");
  fs.writeFileSync(manifestPath, frontMatter(`
schemaVersion: 1
workspace:
  id: sample-backend
executor:
  required: sample-backend-engineer
`));
  fs.writeFileSync(path.join(dir, "PROJECT.md"), "# Must not be scanned\n");

  const result = readAgentManifest(manifestPath, {
    sourcePath: "workspace/AGENT.md"
  });

  assert.equal(result.ok, true);
  assert.equal(result.manifest.workspace.id, "sample-backend");
  assert.equal(result.manifest.source.path, "workspace/AGENT.md");
});
