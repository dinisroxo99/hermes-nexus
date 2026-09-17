import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  getConfiguredProjectRoots,
  isPathInsideRoot,
  normalizeRootPath,
  resolveProjectLocation,
  validateRelativeProjectPath
} from "../src/lib/project-roots.js";

test("getConfiguredProjectRoots preserves legacy PROJECTS_ROOT_CONTAINER", () => {
  const roots = getConfiguredProjectRoots({
    env: {
      PROJECTS_ROOT_CONTAINER: "/projects"
    },
    envFileValues: {}
  });

  assert.deepEqual(roots, [{
    id: "default",
    path: "/projects",
    source: "env",
    writableRegistry: true
  }]);
});

test("getConfiguredProjectRoots consumes PROJECTS_ROOTS from centralized config", () => {
  const roots = getConfiguredProjectRoots({
    env: {
      PROJECTS_ROOTS: JSON.stringify([
        { id: "personal", path: "/home/example/projects" },
        { id: "work", path: "/work/projects", writableRegistry: false }
      ])
    },
    envFileValues: {}
  });

  assert.deepEqual(roots, [
    { id: "personal", path: "/home/example/projects", source: "env", writableRegistry: true },
    { id: "work", path: "/work/projects", source: "env", writableRegistry: false }
  ]);
});

test("getConfiguredProjectRoots keeps generated root IDs stable", () => {
  const roots = getConfiguredProjectRoots({
    env: {
      PROJECTS_ROOTS: JSON.stringify([
        { path: "/first/root" },
        { path: "/second/root" }
      ])
    },
    envFileValues: {}
  });

  assert.deepEqual(
    roots.map((root) => root.id),
    ["root-1", "root-2"]
  );
});

test("normalizeRootPath converts trusted Windows roots to WSL paths on linux", () => {
  const actual = normalizeRootPath("C:\\Users\\Example\\Projects", { platform: "linux" });

  assert.equal(actual, "/mnt/c/Users/Example/Projects");
});

test("normalizeRootPath keeps trusted POSIX roots stable", () => {
  assert.equal(normalizeRootPath("/home/dinis/projects"), "/home/dinis/projects");
  assert.equal(normalizeRootPath("/projects"), "/projects");
});

test("isPathInsideRoot accepts root and descendant paths", () => {
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/sample"), true);
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/sample/src/File.cs"), true);
});

test("isPathInsideRoot rejects sibling and escaped paths", () => {
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/sample2/src/File.cs"), false);
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/secret"), false);
  assert.equal(isPathInsideRoot("/projects/sample", "/projects/sample/../secret"), false);
  assert.equal(isPathInsideRoot("/projects/sample", path.resolve("/projects/sample/../secret")), false);
});

test("validateRelativeProjectPath accepts safe relative project paths", () => {
  assert.deepEqual(validateRelativeProjectPath("sample-service"), {
    valid: true,
    relativePath: "sample-service"
  });
  assert.deepEqual(validateRelativeProjectPath("sample-service/src"), {
    valid: true,
    relativePath: "sample-service/src"
  });
  assert.deepEqual(validateRelativeProjectPath("apps/web"), {
    valid: true,
    relativePath: "apps/web"
  });
});

test("validateRelativeProjectPath rejects traversal before normalization", () => {
  assert.equal(validateRelativeProjectPath("../secret").valid, false);
  assert.equal(validateRelativeProjectPath("foo/../../secret").valid, false);
});

test("validateRelativeProjectPath rejects absolute project paths", () => {
  assert.equal(validateRelativeProjectPath("/absolute").valid, false);
  assert.equal(validateRelativeProjectPath("C:\\secret").valid, false);
  assert.equal(validateRelativeProjectPath("C:/secret").valid, false);
  assert.equal(validateRelativeProjectPath("\\\\server\\share").valid, false);
});

test("validateRelativeProjectPath explicitly rejects empty and dot paths", () => {
  assert.equal(validateRelativeProjectPath("").valid, false);
  assert.equal(validateRelativeProjectPath("   ").valid, false);
  assert.equal(validateRelativeProjectPath(".").valid, false);
});

test("resolveProjectLocation rejects unsafe locators and unknown roots before filesystem resolution", () => {
  const roots = [{ id: "default", path: "/unused" }];
  for (const relativePath of ["../outside", "/outside", "C:outside", "C:/outside", "\\\\server\\share", "."]) {
    assert.throws(() => resolveProjectLocation({ relativePath }, roots), { code: "project_unavailable" });
  }
  assert.throws(() => resolveProjectLocation({ rootId: "unknown", relativePath: "api" }, roots), { code: "project_unavailable" });
  assert.throws(() => resolveProjectLocation({ relativePath: "api" }, [...roots, ...roots]), { code: "project_unavailable" });
});
