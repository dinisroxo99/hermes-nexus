import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_SCOPE_LIMITS,
  WorkspaceScopeError,
  matchWorkspaceScopes
} from "../src/lib/workspace-scope.js";

function workspace(overrides = {}) {
  return {
    id: "sample-backend",
    manifestPath: "engineering/backend/AGENT.md",
    workspacePath: "engineering/backend",
    scope: {
      include: ["src/backend/**"],
      exclude: []
    },
    executor: { required: "sample-backend-engineer" },
    owner: { agent: "sample-owner" },
    reviewers: ["sample-reviewer"],
    permissions: { read: true, write: true },
    routing: { success: { agent: "sample-routing-agent" } },
    ...overrides
  };
}

function assertScopeError(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof WorkspaceScopeError, true);
    assert.equal(error.code, code);
    assert.equal(error.stack?.includes("secret"), false);
    return true;
  });
}

test("matchWorkspaceScopes returns a bounded empty result when no task paths are supplied", () => {
  const result = matchWorkspaceScopes([workspace()], []);

  assert.deepEqual(result, {
    schemaVersion: 1,
    bounded: true,
    limits: {
      maxTaskPaths: 100,
      maxTaskPathLength: 1024,
      maxWorkspaces: 500,
      maxMatches: 500,
      maxReasonsPerWorkspace: 100,
      maxWarnings: 50
    },
    paths: [],
    matches: [],
    unmatchedPaths: [],
    warnings: [],
    truncated: false
  });
});

test("matchWorkspaceScopes normalizes, de-duplicates, and lexicographically sorts task paths", () => {
  const result = matchWorkspaceScopes([workspace()], [
    "src\\backend\\zeta.ts",
    "src/backend/alpha.ts",
    "src/backend/zeta.ts",
    "README.md"
  ]);

  assert.deepEqual(result.paths, [
    "README.md",
    "src/backend/alpha.ts",
    "src/backend/zeta.ts"
  ]);
  assert.deepEqual(result.matches[0].matchedPaths, [
    "src/backend/alpha.ts",
    "src/backend/zeta.ts"
  ]);
  assert.deepEqual(result.unmatchedPaths, ["README.md"]);
});

test("matchWorkspaceScopes rejects unsafe untrusted task paths with a controlled error", () => {
  for (const taskPath of [
    "../secret",
    "foo/../../secret",
    "/absolute/path",
    "C:\\secret",
    "C:/secret",
    "\\\\server\\share"
  ]) {
    assertScopeError(
      () => matchWorkspaceScopes([workspace()], [taskPath]),
      "invalid_task_path"
    );
  }
});

test("matchWorkspaceScopes rejects drive-relative, control-character, and oversized task paths", () => {
  for (const taskPath of [
    "C:relative/path",
    "src/unsafe\u0000name.ts",
    "src/unsafe\u007fname.ts",
    `src/${"x".repeat(1021)}`
  ]) {
    assertScopeError(
      () => matchWorkspaceScopes([workspace()], [taskPath]),
      "invalid_task_path"
    );
  }
});

test("matchWorkspaceScopes requires bounded array inputs", () => {
  assertScopeError(() => matchWorkspaceScopes({}, []), "invalid_workspaces");
  assertScopeError(() => matchWorkspaceScopes([], "src/app.ts"), "invalid_task_paths");
  assertScopeError(
    () => matchWorkspaceScopes([], Array.from({ length: 101 }, (_, index) => `src/file-${index}.ts`)),
    "too_many_task_paths"
  );
  assertScopeError(
    () => matchWorkspaceScopes(Array.from({ length: 501 }, (_, index) => workspace({ id: `sample-${index}` })), []),
    "too_many_workspaces"
  );
});

test("explicit project-relative include patterns use OR semantics", () => {
  const result = matchWorkspaceScopes([
    workspace({
      scope: {
        include: ["src/backend/**", "tests/backend/**"],
        exclude: []
      }
    })
  ], [
    "src/backend/orders/create.ts",
    "src/frontend/page.ts",
    "tests/backend/order.test.ts"
  ]);

  assert.deepEqual(result.matches[0], {
    workspaceId: "sample-backend",
    manifestPath: "engineering/backend/AGENT.md",
    workspacePath: "engineering/backend",
    matchedPaths: [
      "src/backend/orders/create.ts",
      "tests/backend/order.test.ts"
    ],
    reasons: [
      {
        path: "src/backend/orders/create.ts",
        type: "scope_include",
        pattern: "src/backend/**"
      },
      {
        path: "tests/backend/order.test.ts",
        type: "scope_include",
        pattern: "tests/backend/**"
      }
    ]
  });
  assert.deepEqual(result.unmatchedPaths, ["src/frontend/page.ts"]);
});

test("scope.exclude wins when include and exclude both match", () => {
  const result = matchWorkspaceScopes([
    workspace({
      scope: {
        include: ["src/backend/**"],
        exclude: ["src/backend/generated/**"]
      }
    })
  ], [
    "src/backend/orders/create.ts",
    "src/backend/generated/client.ts"
  ]);

  assert.deepEqual(result.matches[0].matchedPaths, ["src/backend/orders/create.ts"]);
  assert.deepEqual(result.unmatchedPaths, ["src/backend/generated/client.ts"]);
  assert.equal(JSON.stringify(result).includes("scope_exclude"), false);
});

test("a non-root workspace with no include uses workspacePath containment", () => {
  const result = matchWorkspaceScopes([
    workspace({ scope: { include: [], exclude: [] } })
  ], [
    "engineering/backend",
    "engineering/backend/src/service.ts",
    "engineering/frontend/src/page.ts"
  ]);

  assert.deepEqual(result.matches[0].matchedPaths, [
    "engineering/backend",
    "engineering/backend/src/service.ts"
  ]);
  assert.deepEqual(result.matches[0].reasons, [
    {
      path: "engineering/backend",
      type: "workspace_path",
      pattern: "engineering/backend/**"
    },
    {
      path: "engineering/backend/src/service.ts",
      type: "workspace_path",
      pattern: "engineering/backend/**"
    }
  ]);
  assert.deepEqual(result.unmatchedPaths, ["engineering/frontend/src/page.ts"]);
});

test("a root workspace with no include matches every valid task path", () => {
  for (const workspacePath of [".", ""]) {
    const result = matchWorkspaceScopes([
      workspace({
        manifestPath: "AGENT.md",
        workspacePath,
        scope: { include: [], exclude: [] }
      })
    ], ["README.md", "src/app.ts"]);

    assert.deepEqual(result.matches[0].matchedPaths, ["README.md", "src/app.ts"]);
    assert.equal(result.matches[0].workspacePath, ".");
    assert.deepEqual(result.unmatchedPaths, []);
  }
});

test("scope.exclude applies after empty-include workspacePath fallback", () => {
  const result = matchWorkspaceScopes([
    workspace({
      manifestPath: "AGENT.md",
      workspacePath: ".",
      scope: { include: [], exclude: ["vendor/**"] }
    })
  ], ["src/app.ts", "vendor/generated.ts"]);

  assert.deepEqual(result.matches[0].matchedPaths, ["src/app.ts"]);
  assert.deepEqual(result.unmatchedPaths, ["vendor/generated.ts"]);
});

test("explicit include scope overrides the manifest directory fallback", () => {
  const result = matchWorkspaceScopes([
    workspace({
      workspacePath: "engineering/backend",
      scope: { include: ["src/backend/**"], exclude: [] }
    })
  ], [
    "engineering/backend/internal.ts",
    "src/backend/order.ts"
  ]);

  assert.deepEqual(result.matches[0].matchedPaths, ["src/backend/order.ts"]);
  assert.deepEqual(result.unmatchedPaths, ["engineering/backend/internal.ts"]);
});

test("overlapping workspaces all match and are ordered by manifestPath", () => {
  const broad = workspace({
    id: "sample-all-source",
    manifestPath: "z/AGENT.md",
    workspacePath: "z",
    scope: { include: ["src/**"], exclude: [] }
  });
  const backend = workspace({
    id: "sample-backend",
    manifestPath: "a/AGENT.md",
    workspacePath: "a",
    scope: { include: ["src/backend/**"], exclude: [] }
  });

  const result = matchWorkspaceScopes([broad, backend], ["src/backend/order.ts"]);

  assert.deepEqual(result.matches.map((match) => match.workspaceId), [
    "sample-backend",
    "sample-all-source"
  ]);
  assert.deepEqual(result.unmatchedPaths, []);
  assert.equal(Object.hasOwn(result.matches[0], "confidence"), false);
});

test("glob semantics support *, **, and ? with project-relative separators", () => {
  const result = matchWorkspaceScopes([
    workspace({
      scope: {
        include: ["src/*.ts", "src/**/*.tsx", "tests/unit/?.test.ts"],
        exclude: []
      }
    })
  ], [
    "src/index.ts",
    "src/backend/index.ts",
    "src/backend/page.tsx",
    "tests/unit/a.test.ts",
    "tests/unit/ab.test.ts"
  ]);

  assert.deepEqual(result.matches[0].matchedPaths, [
    "src/backend/page.tsx",
    "src/index.ts",
    "tests/unit/a.test.ts"
  ]);
  assert.deepEqual(result.unmatchedPaths, [
    "src/backend/index.ts",
    "tests/unit/ab.test.ts"
  ]);
});

test("glob matching does not treat leading ! as negation", () => {
  const result = matchWorkspaceScopes([
    workspace({
      scope: { include: ["!src/**"], exclude: [] }
    })
  ], ["src/app.ts"]);

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.unmatchedPaths, ["src/app.ts"]);
});

test("dotfiles match only when a pattern explicitly permits the dot segment", () => {
  const result = matchWorkspaceScopes([
    workspace({
      scope: { include: ["src/*.ts", "src/.*.ts"], exclude: [] }
    })
  ], ["src/.hidden.ts", "src/visible.ts"]);

  assert.deepEqual(result.matches[0].matchedPaths, ["src/.hidden.ts", "src/visible.ts"]);
  assert.deepEqual(result.matches[0].reasons, [
    {
      path: "src/.hidden.ts",
      type: "scope_include",
      pattern: "src/.*.ts"
    },
    {
      path: "src/visible.ts",
      type: "scope_include",
      pattern: "src/*.ts"
    }
  ]);
});

test("directory and nonexistent future paths are matched without filesystem access", () => {
  const result = matchWorkspaceScopes([workspace()], [
    "src/backend",
    "src/backend/orders/new-handler.ts"
  ]);

  assert.deepEqual(result.matches[0].matchedPaths, [
    "src/backend",
    "src/backend/orders/new-handler.ts"
  ]);
});

test("matcher result never leaks executor, routing, permission, owner, or reviewer metadata", () => {
  const result = matchWorkspaceScopes([workspace()], ["src/backend/order.ts"]);
  const serialized = JSON.stringify(result);

  for (const forbidden of [
    "sample-backend-engineer",
    "sample-routing-agent",
    "sample-owner",
    "sample-reviewer",
    "executor",
    "routing",
    "permissions",
    "reviewers"
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("malformed externally supplied scopes produce bounded warnings instead of crashing", () => {
  const workspaces = Array.from({ length: 60 }, (_, index) => workspace({
    id: `sample-${index}`,
    manifestPath: `workspace-${String(index).padStart(2, "0")}/AGENT.md`,
    scope: index % 2 === 0
      ? { include: "src/**", exclude: [] }
      : { include: ["src/**"], exclude: [null] }
  }));

  const result = matchWorkspaceScopes(workspaces, ["src/app.ts"]);

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.unmatchedPaths, ["src/app.ts"]);
  assert.equal(result.warnings.length, WORKSPACE_SCOPE_LIMITS.maxWarnings);
  assert.equal(result.warnings.every((warning) => warning.code === "invalid_workspace_scope"), true);
  assert.equal(result.warnings.every((warning) => warning.stack === undefined), true);
});

test("drive-relative scope patterns are rejected as malformed workspace input", () => {
  const result = matchWorkspaceScopes([
    workspace({
      scope: { include: ["C:relative/**"], exclude: [] }
    })
  ], ["src/app.ts"]);

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.warnings, [{
    code: "invalid_workspace_scope",
    workspaceId: "sample-backend",
    manifestPath: "engineering/backend/AGENT.md"
  }]);
});

test("unsafe or oversized workspace and manifest paths are rejected without leaking them", () => {
  const result = matchWorkspaceScopes([
    workspace({ workspacePath: "C:relative" }),
    workspace({ id: "sample-control", manifestPath: "unsafe\u0000/AGENT.md" }),
    workspace({
      id: "sample-oversized",
      manifestPath: `${"x".repeat(1025)}/AGENT.md`
    })
  ], ["src/backend/app.ts"]);

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.unmatchedPaths, ["src/backend/app.ts"]);
  assert.equal(result.warnings.length, 3);
  assert.equal(result.warnings.every((warning) => warning.code === "invalid_workspace"), true);
  assert.equal(JSON.stringify(result).includes("C:relative"), false);
  assert.equal(JSON.stringify(result).includes("unsafe"), false);
  assert.equal(JSON.stringify(result).includes("x".repeat(1025)), false);
});

test("malformed workspace IDs are rejected without creating unbounded output", () => {
  const oversizedId = `sample-${"x".repeat(101)}`;
  const result = matchWorkspaceScopes([
    workspace({ id: oversizedId })
  ], ["src/backend/app.ts"]);

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.warnings, [{
    code: "invalid_workspace",
    workspaceId: null,
    manifestPath: "engineering/backend/AGENT.md"
  }]);
  assert.equal(JSON.stringify(result).includes(oversizedId), false);
});

test("malformed-workspace warnings are ordered independently of caller workspace order", () => {
  const result = matchWorkspaceScopes([
    workspace({
      id: "sample-z",
      manifestPath: "z/AGENT.md",
      scope: { include: "src/**", exclude: [] }
    }),
    workspace({
      id: "sample-a",
      manifestPath: "a/AGENT.md",
      scope: { include: "src/**", exclude: [] }
    })
  ], ["src/app.ts"]);

  assert.deepEqual(result.warnings.map((warning) => warning.manifestPath), [
    "a/AGENT.md",
    "z/AGENT.md"
  ]);
});

test("ambiguous duplicate workspace identities are rejected deterministically", () => {
  const first = workspace({
    scope: { include: ["src/first/**"], exclude: [] }
  });
  const second = workspace({
    scope: { include: ["src/second/**"], exclude: [] }
  });
  const paths = ["src/first/app.ts", "src/second/app.ts"];

  const forward = matchWorkspaceScopes([first, second], paths, { maxWarnings: 1 });
  const reverse = matchWorkspaceScopes([second, first], paths, { maxWarnings: 1 });

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.matches, []);
  assert.deepEqual(forward.unmatchedPaths, paths);
  assert.deepEqual(forward.warnings, [{
    code: "duplicate_workspace_scope_entry",
    workspaceId: "sample-backend",
    manifestPath: "engineering/backend/AGENT.md"
  }]);
});

test("match and reason outputs are bounded with exact truncation semantics", () => {
  const workspaces = [
    workspace({ id: "sample-a", manifestPath: "a/AGENT.md" }),
    workspace({ id: "sample-b", manifestPath: "b/AGENT.md" })
  ];

  const exact = matchWorkspaceScopes([workspaces[0]], ["src/backend/a.ts"], {
    maxMatches: 1,
    maxReasonsPerWorkspace: 1
  });
  assert.equal(exact.matches.length, 1);
  assert.equal(exact.matches[0].reasons.length, 1);
  assert.equal(exact.truncated, false);

  const truncated = matchWorkspaceScopes(workspaces, [
    "src/backend/a.ts",
    "src/backend/b.ts"
  ], {
    maxMatches: 1,
    maxReasonsPerWorkspace: 1
  });
  assert.equal(truncated.matches.length, 1);
  assert.equal(truncated.matches[0].reasons.length, 1);
  assert.equal(truncated.truncated, true);
  assert.deepEqual(truncated.unmatchedPaths, []);
});
