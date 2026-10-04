import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolveTrackA1 } from "../src/lib/track-a-symbol-resolution.js";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { contextDigest } from "../src/lib/project-context-files.js";

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Synthetic in-memory sources ? behavior fixtures, not A1 observations.
const FIXTURE_SINGLE_FOO = [
  "// synthetic fixture: exactly one declaration of foo",
  "export function foo() {",
  "  return 1;",
  "}",
  ""
].join("\n");

const FIXTURE_TWO_FOO_NESTED = [
  "// synthetic fixture: top-level foo plus nested method foo",
  "export function foo() {",
  "  return 1;",
  "}",
  "class Container {",
  "  foo() {",
  "    return 2;",
  "  }",
  "}",
  ""
].join("\n");

const FIXTURE_TRUNCATED = [
  "// synthetic fixture: truncated / invalid source",
  "export function foo() {"
].join("\n");

function assertNoStableId(result) {
  assert.equal(Object.hasOwn(result, "stableId"), false);
}

test("1. single declaration with matching source hash is not accepted A1 evidence", () => {
  // Count declaration-like surfaces in the fixture text itself (not via analyzer).
  const declSurfaces = [...FIXTURE_SINGLE_FOO.matchAll(/\bfunction\s+foo\b/g)];
  assert.equal(declSurfaces.length, 1, "fixture text must declare foo exactly once");

  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 }
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assert.equal(result.coverage.wholeByteString, true);
  assert.equal(result.coverage.syntacticDiagnosticCount, 0);
  assertNoStableId(result);
  {
    const start = FIXTURE_SINGLE_FOO.indexOf("export function foo");
    const nameStart = start + "export function ".length;
    const end = FIXTURE_SINGLE_FOO.indexOf("}", start) + 1;
    assertQualifyingOccurrences(result, [{
      source: FIXTURE_SINGLE_FOO,
      name: "foo",
      kind: "function",
      path: null,
      range: { start, end },
      nameRange: { start: nameStart, end: nameStart + 3 },
      text: FIXTURE_SINGLE_FOO.slice(start, end)
    }]);
  }
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) =>
      note.includes("source-hash match is not full observation binding") &&
      note.includes("not accepted A1 evidence")
    ),
    "note must say a source-hash match is not accepted A1 evidence"
  );
});

test("2. two declarations including nested: not_evaluated even if provider returns one node", () => {
  // Fixture text has a top-level function foo and a nested method foo.
  // The nested declaration is outside the domain and is not a second qualifying occurrence.
  const functionFoo = [...FIXTURE_TWO_FOO_NESTED.matchAll(/\bfunction\s+foo\b/g)];
  const methodFoo = [...FIXTURE_TWO_FOO_NESTED.matchAll(/^\s+foo\s*\(/gm)];
  assert.equal(functionFoo.length, 1, "fixture must include top-level function foo");
  assert.equal(methodFoo.length, 1, "fixture must include nested method foo");

  const sourceSha256 = sha256Text(FIXTURE_TWO_FOO_NESTED);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TWO_FOO_NESTED, "utf8"),
    binding: { sourceSha256 },
    // Provider may return a single node; producer must not treat that as uniqueness.
    providerNode: { id: "synthetic-provider-node-not-a-real-identity" }
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[0].path, null);
  assert.equal(
    FIXTURE_TWO_FOO_NESTED.slice(result.occurrences[0].range.start, result.occurrences[0].range.end).includes("foo()"),
    true
  );
  assert.equal(
    FIXTURE_TWO_FOO_NESTED.slice(result.occurrences[0].range.start, result.occurrences[0].range.end).includes("class Container"),
    false
  );
  assertNoStableId(result);
  assert.equal(JSON.stringify(result).includes("synthetic-provider-node-not-a-real-identity"), false);
});

test("3. invalid/truncated source that does not parse: not_evaluated", () => {
  const sourceSha256 = sha256Text(FIXTURE_TRUNCATED);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TRUNCATED, "utf8"),
    binding: { sourceSha256 }
  });

  assert.equal(result.status, "not_evaluated");
  assertNoStableId(result);
  assert.ok(result.coverage.syntacticDiagnosticCount > 0);
  assert.equal(Object.hasOwn(result, "occurrences") ? result.occurrences.length : 0, 0);
});

test("4. incompatible or omitted binding: not_evaluated", () => {
  const omitted = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8")
  });
  assert.equal(omitted.status, "not_evaluated");
  assertNoStableId(omitted);
  assertNoOccurrencesKey(omitted);

  const incompatible = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256: "0".repeat(64) }
  });
  assert.equal(incompatible.status, "not_evaluated");
  assertNoStableId(incompatible);
  assertNoOccurrencesKey(incompatible);
});

test("5. provider node id is not copied and is not treated as a stable id", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 },
    providerNode: { id: "symbol_anything" }
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[0].path, null);
  assert.ok(result.coverage);
  assertNoStableId(result);
  assert.equal(JSON.stringify(result).includes("symbol_anything"), false);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) =>
      note.includes("provider node id was not validated against the symbol, file, and snapshot") &&
      note.includes("was not copied")
    ),
    "note must say the provider node id was not copied"
  );
});

test("6. extra binding fields do not flip a source-hash match to positive", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: {
      sourceSha256,
      projectId: "fake-project-not-an-observation",
      snapshotToken: "fake-snapshot-token-not-recomputed"
    }
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.coverage.wholeByteString, true);
  assert.equal(result.coverage.syntacticDiagnosticCount, 0);
  assertNoStableId(result);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("fake-project-not-an-observation"), false);
  assert.equal(serialized.includes("fake-snapshot-token-not-recomputed"), false);
  assert.ok(
    result.notes.some((note) => note.includes("not accepted A1 evidence")),
    "extra binding fields are still not accepted A1 evidence"
  );
});

const SYNTHETIC_REPOSITORY_ID = "ab".repeat(32);
const SYNTHETIC_WORKTREE_ID = "cd".repeat(32);
const SYNTHETIC_PROJECT_ID = "prj_synthetic";
const SYNTHETIC_COMMIT_SHA = "11".repeat(20);
const SYNTHETIC_PATH = "src/example.js";

function syntheticRevision() {
  return {
    repositoryId: SYNTHETIC_REPOSITORY_ID,
    worktreeId: SYNTHETIC_WORKTREE_ID,
    status: "available",
    commitSha: SYNTHETIC_COMMIT_SHA,
    branch: null,
    dirty: false,
    isLinkedWorktree: false
  };
}

function providerRevision(revision) {
  return {
    repositoryId: revision.repositoryId,
    worktreeId: revision.worktreeId,
    status: revision.status,
    commitSha: revision.commitSha,
    branch: revision.branch,
    dirty: revision.dirty,
    isLinkedWorktree: revision.isLinkedWorktree
  };
}

function snapshotFromBytes(text, { token, sourceSha256, revision } = {}) {
  const bytes = Buffer.from(text, "utf8");
  const hash = sha256Text(text);
  const rev = revision ?? syntheticRevision();
  const produced = createProviderSnapshot(
    { projectId: SYNTHETIC_PROJECT_ID },
    [{ path: SYNTHETIC_PATH, text }],
    providerRevision(rev)
  );
  return {
    projectId: SYNTHETIC_PROJECT_ID,
    path: SYNTHETIC_PATH,
    sourceSha256: sourceSha256 ?? hash,
    byteSize: bytes.length,
    revision: rev,
    token: token ?? produced.token
  };
}

function flipLastHex(token) {
  const last = token[token.length - 1];
  return token.slice(0, -1) + (last === "0" ? "1" : "0");
}


function utf16Location(text, offset) {
  let line = 1;
  let column = 1;
  for (let i = 0; i < offset; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function assertNoOccurrencesKey(result) {
  assert.equal(Object.hasOwn(result, "occurrences"), false);
}

function assertOccurrenceIdentityAbsent(occurrence) {
  assert.equal(Object.hasOwn(occurrence, "stableId"), false);
  assert.equal(Object.hasOwn(occurrence, "symbolId"), false);
  assert.equal(Object.hasOwn(occurrence, "declarationId"), false);
}

function assertQualifyingOccurrences(result, expected) {
  assert.ok(Array.isArray(result.occurrences));
  assert.equal(result.occurrences.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    const occurrence = result.occurrences[i];
    const spec = expected[i];
    assert.equal(occurrence.name, spec.name);
    assert.equal(occurrence.kind, spec.kind);
    assert.equal(occurrence.path, spec.path);
    assert.deepEqual(occurrence.range, spec.range);
    assert.deepEqual(occurrence.nameRange, spec.nameRange);
    assert.deepEqual(occurrence.location, {
      start: utf16Location(spec.source, spec.range.start),
      end: utf16Location(spec.source, spec.range.end)
    });
    assert.equal(spec.source.slice(occurrence.nameRange.start, occurrence.nameRange.end), spec.name);
    assert.equal(spec.source.slice(occurrence.range.start, occurrence.range.end), spec.text);
    assertOccurrenceIdentityAbsent(occurrence);
    assert.deepEqual(
      Object.keys(occurrence).sort(),
      ["kind", "location", "name", "nameRange", "path", "range"]
    );
  }
}

function assertNoIdentityFields(result) {
  assertNoStableId(result);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.notEqual(result.status, "positive");
  assert.notEqual(result.status, "resolved_unique");
}

test("7. matching snapshot token for one declaration is still not accepted A1 evidence", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const snapshot = snapshotFromBytes(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 },
    snapshot
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[0].path, null);
  assert.equal(result.coverage.wholeByteString, true);
  assert.equal(result.coverage.syntacticDiagnosticCount, 0);
  assertNoIdentityFields(result);
  assert.equal(JSON.stringify(result).includes(snapshot.token), false);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) =>
      note.includes("snapshot token matched") &&
      note.includes("supplied bytes") &&
      note.includes("not accepted") &&
      note.includes("declaration identity") &&
      note.includes("completeness")
    ),
    "note must say the snapshot token matched and this is not accepted A1 evidence"
  );
});

test("8. flipped snapshot token does not recompute and is not_evaluated", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const real = snapshotFromBytes(FIXTURE_SINGLE_FOO);
  const snapshot = { ...real, token: flipLastHex(real.token) };
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 },
    snapshot
  });

  assert.equal(result.status, "not_evaluated");
  assertNoIdentityFields(result);
  assertNoOccurrencesKey(result);
  assert.equal(JSON.stringify(result).includes(real.token), false);
  assert.equal(JSON.stringify(result).includes(snapshot.token), false);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) => note.includes("snapshot token") && note.includes("did not recompute")),
    "note must say the snapshot token did not recompute"
  );
});

test("9. snapshot sourceSha256 that is not the hash of the bytes is not_evaluated", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const snapshot = snapshotFromBytes(FIXTURE_SINGLE_FOO, { sourceSha256: "0".repeat(64) });
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 },
    snapshot
  });

  assert.equal(result.status, "not_evaluated");
  assertNoIdentityFields(result);
  assertNoOccurrencesKey(result);
  assert.equal(Object.hasOwn(result, "census"), false, "a forged snapshot hash must not be ignored in favor of a bytes-only census");
  assert.equal(JSON.stringify(result).includes(snapshot.token), false);
  assert.equal(Object.hasOwn(result, "stableId"), false);
});

test("10. revision with repositoryIdentity and no repositoryId is not_evaluated", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const revision = syntheticRevision();
  delete revision.repositoryId;
  revision.repositoryIdentity = SYNTHETIC_REPOSITORY_ID;
  const snapshot = {
    projectId: SYNTHETIC_PROJECT_ID,
    path: SYNTHETIC_PATH,
    sourceSha256,
    byteSize: Buffer.byteLength(FIXTURE_SINGLE_FOO),
    revision,
    token: "ee".repeat(32)
  };
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 },
    snapshot
  });

  assert.equal(result.status, "not_evaluated");
  assertNoIdentityFields(result);
  assertNoOccurrencesKey(result);
  assert.equal(Object.hasOwn(result, "census"), false, "repositoryIdentity must not be ignored in favor of a bytes-only census");
  assert.equal(JSON.stringify(result).includes(SYNTHETIC_REPOSITORY_ID), false);
  assert.equal(JSON.stringify(result).includes("repositoryIdentity"), false);
});

const FIXTURE_ONLY_NESTED_FUNCTION_FOO = [
  "// synthetic fixture: only a nested function named foo",
  "function outer() {",
  "  function foo() {",
  "    return 1;",
  "  }",
  "  return 0;",
  "}",
  ""
].join("\n");

const FIXTURE_TWO_TOP_LEVEL_FOO = [
  "// synthetic fixture: two top-level function declarations named foo",
  "function foo() {",
  "  return 1;",
  "}",
  "function foo() {",
  "  return 2;",
  "}",
  ""
].join("\n");

const FIXTURE_FOO_PLUS_DESTRUCTURE = [
  "// synthetic fixture: top-level foo plus a destructuring variable",
  "function foo() {",
  "  return 1;",
  "}",
  "const { other } = { other: 1 };",
  ""
].join("\n");

const FIXTURE_FOO_PLUS_NAMESPACE = [
  "// synthetic fixture: top-level foo plus a namespace declaration",
  "function foo() {",
  "  return 1;",
  "}",
  "namespace Other {",
  "  export const value = 1;",
  "}",
  ""
].join("\n");

const FIXTURE_TWO_FOO_PLUS_DESTRUCTURE = [
  "// synthetic fixture: two top-level foo functions plus a destructuring binding",
  "function foo() {",
  "  return 1;",
  "}",
  "function foo() {",
  "  return 2;",
  "}",
  "const { other } = { other: 1 };",
  ""
].join("\n");

test("11. only a nested function foo is outside the domain: census 0 and not_evaluated", () => {
  const sourceSha256 = sha256Text(FIXTURE_ONLY_NESTED_FUNCTION_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_ONLY_NESTED_FUNCTION_FOO, "utf8"),
    binding: { sourceSha256 }
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "not_found");
  assert.equal(result.census, 0);
  assert.deepEqual(result.occurrences, []);
  assertNoStableId(result);
  assertNoIdentityFields(result);
});

test("12. two top-level function declarations named foo: census 2 and ambiguous", () => {
  const sourceSha256 = sha256Text(FIXTURE_TWO_TOP_LEVEL_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TWO_TOP_LEVEL_FOO, "utf8"),
    binding: { sourceSha256 }
  });

  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "not_evaluated");
  assert.notEqual(result.status, "not_found");
  assert.equal(result.census, 2);
  assert.equal(result.occurrences.length, 2);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[1].name, "foo");
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[1].kind, "function");
  assert.equal(result.occurrences[0].path, null);
  assert.equal(result.occurrences[1].path, null);
  assert.ok(result.occurrences[0].range.start < result.occurrences[1].range.start);
  assertOccurrenceIdentityAbsent(result.occurrences[0]);
  assertOccurrenceIdentityAbsent(result.occurrences[1]);
  assert.equal(result.coverage.wholeByteString, true);
  assert.equal(result.coverage.syntacticDiagnosticCount, 0);
  assertNoStableId(result);
  assertNoIdentityFields(result);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) => note.includes("more than one direct declaration")),
    "note must say the name has more than one direct declaration"
  );
});

test("13. top-level foo plus destructuring or namespace stays not_evaluated as an incomplete unsupported form", () => {
  for (const fixture of [FIXTURE_FOO_PLUS_DESTRUCTURE, FIXTURE_FOO_PLUS_NAMESPACE]) {
    const sourceSha256 = sha256Text(fixture);
    const result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(fixture, "utf8"),
      binding: { sourceSha256 }
    });

    assert.equal(result.status, "not_evaluated");
    assert.notEqual(result.status, "ambiguous");
    assert.notEqual(result.status, "not_found");
    assert.notEqual(result.status, "positive");
    assert.equal(result.census, 1);
    assert.equal(result.occurrences.length, 1);
    assert.equal(result.occurrences[0].name, "foo");
    assert.equal(result.occurrences[0].kind, "function");
    assert.equal(result.occurrences[0].path, null);
    assertOccurrenceIdentityAbsent(result.occurrences[0]);
    assertNoStableId(result);
    assertNoIdentityFields(result);
    assert.ok(Array.isArray(result.notes));
    assert.ok(
      result.notes.some((note) =>
        note.includes("incomplete") && note.includes("unsupported declaration form")
      ),
      "note must say the path is incomplete because of an unsupported declaration form"
    );
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("positive"), false);
    assert.equal(serialized.includes("resolved_unique"), false);
  }
});

test("14. two top-level foo functions plus a destructuring binding: ambiguous, incomplete note remains", () => {
  const sourceSha256 = sha256Text(FIXTURE_TWO_FOO_PLUS_DESTRUCTURE);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TWO_FOO_PLUS_DESTRUCTURE, "utf8"),
    binding: { sourceSha256 }
  });

  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "not_evaluated");
  assert.notEqual(result.status, "not_found");
  assert.equal(result.census, 2);
  assert.equal(result.occurrences.length, 2);
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[1].kind, "function");
  assert.equal(result.occurrences[0].path, null);
  assert.ok(result.occurrences[0].range.end <= result.occurrences[1].range.start);
  assert.equal(result.coverage.wholeByteString, true);
  assert.equal(result.coverage.syntacticDiagnosticCount, 0);
  assertNoStableId(result);
  assertNoIdentityFields(result);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) =>
      note.includes("incomplete") && note.includes("unsupported declaration form")
    ),
    "incomplete-form note must remain when ambiguity wins"
  );
  assert.ok(
    result.notes.some((note) => note.includes("more than one direct declaration")),
    "note must say the name has more than one direct declaration"
  );
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("positive"), false);
  assert.equal(serialized.includes("resolved_unique"), false);
});

const TASK_PATH_SINGLE = { paths: [SYNTHETIC_PATH] };

test("15. one path + truncated invalid source => partial with parse completeness partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_TRUNCATED);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TRUNCATED, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "partial");
  assert.notEqual(result.status, "not_found");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(Object.hasOwn(result, "occurrences") ? result.occurrences.length : 0, 0);
  assert.ok(result.coverage.syntacticDiagnosticCount > 0);
  assert.equal(result.completeness.parse, "partial");
  assert.equal(result.completeness.output, "not_evaluated");
  assertNoIdentityFields(result);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
});

test("16. one path + destructuring and no second qualifying declaration => partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_FOO_PLUS_DESTRUCTURE);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_FOO_PLUS_DESTRUCTURE, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "partial");
  assert.notEqual(result.status, "not_found");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[0].path, SYNTHETIC_PATH);
  assertOccurrenceIdentityAbsent(result.occurrences[0]);
  assert.equal(result.completeness.enumeration, "partial");
  assert.equal(result.completeness.output, "not_evaluated");
  assertNoIdentityFields(result);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) =>
      note.includes("incomplete") && note.includes("unsupported declaration form")
    ),
    "note must say the path is incomplete because of an unsupported declaration form"
  );
});

test("17. one path + two top-level foo declarations => ambiguous, not partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_TWO_TOP_LEVEL_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TWO_TOP_LEVEL_FOO, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "partial");
  assert.equal(result.census, 2);
  assert.equal(result.occurrences.length, 2);
  assert.equal(result.occurrences[0].path, SYNTHETIC_PATH);
  assert.equal(result.occurrences[1].path, SYNTHETIC_PATH);
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[1].kind, "function");
  assert.equal(result.completeness.parse, "complete");
  assert.equal(result.completeness.enumeration, "complete");
  assert.equal(result.completeness.output, "not_evaluated");
  assertNoIdentityFields(result);
});

test("18. one path + one clean top-level foo, no snapshot => not_evaluated with output not_evaluated", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[0].path, SYNTHETIC_PATH);
  assertOccurrenceIdentityAbsent(result.occurrences[0]);
  assert.equal(result.completeness.parse, "complete");
  assert.equal(result.completeness.output, "not_evaluated");
  assert.equal(result.completeness.source, "not_evaluated");
  assert.equal(result.completeness.enumeration, "complete");
  assertNoIdentityFields(result);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) =>
      note.includes("output coverage is not complete") &&
      note.includes("neither not_found nor resolved_unique")
    ),
    "note must say output coverage is not complete so this is neither not_found nor resolved_unique"
  );
});

test("19. absolute or parent-segment paths => not_evaluated", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  for (const paths of [["/tmp/x.js"], ["../x.js"]]) {
    const result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
      binding: { sourceSha256 },
      task: { paths }
    });

    assert.equal(result.status, "not_evaluated");
    assert.notEqual(result.status, "partial");
    assert.notEqual(result.status, "resolved_unique");
    assertNoIdentityFields(result);
    assertNoOccurrencesKey(result);
  }
});

test("20. paths length 2 => not_evaluated without parse claim of resolved_unique", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 },
    task: { paths: [SYNTHETIC_PATH, "src/other.js"] }
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "partial");
  assert.equal(Object.hasOwn(result, "census"), false, "must not parse when more than one path is supplied");
  assertNoIdentityFields(result);
  assertNoOccurrencesKey(result);
  assert.ok(Array.isArray(result.notes));
  assert.ok(
    result.notes.some((note) =>
      note.includes("only a single explicit path") && note.includes("implemented")
    ),
    "note must say only a single explicit path is implemented"
  );
});

test("21. inputs that omit task.paths keep status and do not gain completeness", () => {
  const sourceSha256 = sha256Text(FIXTURE_TRUNCATED);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TRUNCATED, "utf8"),
    binding: { sourceSha256 }
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "completeness"), false);
  assert.equal(Object.hasOwn(result, "occurrences") ? result.occurrences.length : 0, 0);
});

test("22. mismatched snapshot token with task.paths stays not_evaluated, not partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_TRUNCATED);
  const real = snapshotFromBytes(FIXTURE_SINGLE_FOO);
  const snapshot = {
    ...real,
    sourceSha256,
    byteSize: Buffer.byteLength(FIXTURE_TRUNCATED),
    token: flipLastHex(real.token)
  };
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TRUNCATED, "utf8"),
    binding: { sourceSha256 },
    snapshot,
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "partial");
  assertNoIdentityFields(result);
  assertNoOccurrencesKey(result);
});

const FIXTURE_FOO_AT_START = [
  "function foo() {",
  "  return 1;",
  "}",
  ""
].join("\n");

const FIXTURE_FOO_MULTILINE = [
  "function foo(",
  "  value",
  ") {",
  "  return value;",
  "}",
  ""
].join("\n");

const FIXTURE_TOP_LEVEL_AND_NESTED_FOO = [
  "function foo() {",
  "  return 1;",
  "}",
  "function outer() {",
  "  function foo() {",
  "    return 2;",
  "  }",
  "  return 0;",
  "}",
  "class Container {",
  "  foo() {",
  "    return 3;",
  "  }",
  "}",
  ""
].join("\n");

const FIXTURE_TWO_FOO_AT_START = [
  "function foo() {",
  "  return 1;",
  "}",
  "function foo() {",
  "  return 2;",
  "}",
  ""
].join("\n");

test("23. function foo at the start of the file records one occurrence and stays not_evaluated", () => {
  const source = FIXTURE_FOO_AT_START;
  const sourceSha256 = sha256Text(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 }
  });
  const start = 0;
  const nameStart = source.indexOf("foo");
  const end = source.indexOf("}") + 1;
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assertNoIdentityFields(result);
  assertQualifyingOccurrences(result, [{
    source,
    name: "foo",
    kind: "function",
    path: null,
    range: { start, end },
    nameRange: { start: nameStart, end: nameStart + 3 },
    text: source.slice(start, end)
  }]);
  assert.deepEqual(result.occurrences[0].location.start, { line: 1, column: 1 });
  assert.equal(JSON.stringify(result).includes("resolved_unique"), false);
  assert.equal(JSON.stringify(result).includes("symbolId"), false);
  assert.equal(JSON.stringify(result).includes("declarationId"), false);
  assert.equal(JSON.stringify(result).includes("stableId"), false);
});

test("24. two top-level function foo declarations record two occurrences and stay ambiguous", () => {
  const source = FIXTURE_TWO_FOO_AT_START;
  const sourceSha256 = sha256Text(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 }
  });
  const firstStart = 0;
  const firstName = source.indexOf("foo");
  const firstEnd = source.indexOf("}") + 1;
  const secondStart = source.indexOf("function foo", firstEnd);
  const secondName = source.indexOf("foo", secondStart);
  const secondEnd = source.indexOf("}", secondStart) + 1;
  assert.equal(result.status, "ambiguous");
  assert.equal(result.census, 2);
  assertNoIdentityFields(result);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assertQualifyingOccurrences(result, [
    {
      source,
      name: "foo",
      kind: "function",
      path: null,
      range: { start: firstStart, end: firstEnd },
      nameRange: { start: firstName, end: firstName + 3 },
      text: source.slice(firstStart, firstEnd)
    },
    {
      source,
      name: "foo",
      kind: "function",
      path: null,
      range: { start: secondStart, end: secondEnd },
      nameRange: { start: secondName, end: secondName + 3 },
      text: source.slice(secondStart, secondEnd)
    }
  ]);
});

test("25. nested function and method named foo are not extra occurrences", () => {
  const source = FIXTURE_TOP_LEVEL_AND_NESTED_FOO;
  const sourceSha256 = sha256Text(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 }
  });
  const start = 0;
  const nameStart = source.indexOf("foo");
  const end = source.indexOf("}") + 1;
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assertNoIdentityFields(result);
  assertQualifyingOccurrences(result, [{
    source,
    name: "foo",
    kind: "function",
    path: null,
    range: { start, end },
    nameRange: { start: nameStart, end: nameStart + 3 },
    text: source.slice(start, end)
  }]);
  assert.equal(result.occurrences.length, 1);
});

test("26. comment-free multiline function declaration records the whole node", () => {
  const source = FIXTURE_FOO_MULTILINE;
  const sourceSha256 = sha256Text(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 }
  });
  const start = 0;
  const nameStart = source.indexOf("foo");
  const end = source.lastIndexOf("}") + 1;
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assertNoIdentityFields(result);
  assertQualifyingOccurrences(result, [{
    source,
    name: "foo",
    kind: "function",
    path: null,
    range: { start, end },
    nameRange: { start: nameStart, end: nameStart + 3 },
    text: source.slice(start, end)
  }]);
  assert.equal(result.occurrences[0].location.start.line, 1);
  assert.equal(result.occurrences[0].location.start.column, 1);
  assert.ok(result.occurrences[0].location.end.line > result.occurrences[0].location.start.line);
});

test("27. truncated source with one task path stays partial and has no occurrence", () => {
  const sourceSha256 = sha256Text(FIXTURE_TRUNCATED);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TRUNCATED, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "partial");
  assert.equal(Object.hasOwn(result, "occurrences") ? result.occurrences.length : 0, 0);
  assertNoIdentityFields(result);
});

test("28. qualifying kinds are function, class, interface, type, enum, and variable", () => {
  const cases = [
    ["function foo() {}\n", "function", 0, "function foo() {}".length],
    ["class foo {}\n", "class", 0, "class foo {}".length],
    ["interface foo {}\n", "interface", 0, "interface foo {}".length],
    ["type foo = number;\n", "type", 0, "type foo = number;".length],
    ["enum foo { A }\n", "enum", 0, "enum foo { A }".length],
    ["const foo = 1;\n", "variable", "const ".length, "const foo = 1".length]
  ];
  for (const [source, kind, start, end] of cases) {
    const nameStart = source.indexOf("foo");
    const result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(source, "utf8"),
      binding: { sourceSha256: sha256Text(source) }
    });
    assert.equal(result.status, "not_evaluated");
    assertNoIdentityFields(result);
    assertQualifyingOccurrences(result, [{
      source,
      name: "foo",
      kind,
      path: null,
      range: { start, end },
      nameRange: { start: nameStart, end: nameStart + 3 },
      text: source.slice(start, end)
    }]);
  }
});

test("29. bad name returns before parse and does not gain an occurrence", () => {
  const result = resolveTrackA1({
    name: "",
    sourceBytes: Buffer.from(FIXTURE_FOO_AT_START, "utf8"),
    binding: { sourceSha256: sha256Text(FIXTURE_FOO_AT_START) }
  });
  assert.equal(result.status, "not_evaluated");
  assertNoOccurrencesKey(result);
  assertNoIdentityFields(result);
});

const FIXTURE_NESTED_BODY_DESTRUCTURE = [
  "// synthetic fixture: destructuring only inside the body of top-level foo",
  "function foo() {",
  "  const { a } = value;",
  "}",
  ""
].join("\n");

const FIXTURE_DIRECT_DESTRUCTURE_A = [
  "// synthetic fixture: direct source-file destructuring",
  "function foo() {",
  "  return 1;",
  "}",
  "const { a } = value;",
  ""
].join("\n");

const FIXTURE_DIRECT_NAMESPACE_N = [
  "// synthetic fixture: direct source-file namespace",
  "namespace N { export function foo() {} }",
  ""
].join("\n");

const FIXTURE_NESTED_BODY_NAMESPACE = [
  "// synthetic fixture: namespace only inside the body of top-level foo",
  "function foo() {",
  "  namespace N { export function foo() {} }",
  "}",
  ""
].join("\n");

const FIXTURE_NESTED_BODY_FOR_OF_DESTRUCTURE = [
  "// synthetic fixture: for-of destructuring only inside the body of top-level foo",
  "function foo() {",
  "  for (const { a } of items) {}",
  "}",
  ""
].join("\n");

test("30. one path + destructuring nested in the body of foo stays not_evaluated with complete enumeration", () => {
  const sourceSha256 = sha256Text(FIXTURE_NESTED_BODY_DESTRUCTURE);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_NESTED_BODY_DESTRUCTURE, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "partial");
  assert.notEqual(result.status, "not_found");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.census, 1);
  assert.equal(result.completeness.enumeration, "complete");
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[0].kind, "function");
  assert.equal(result.occurrences[0].path, SYNTHETIC_PATH);
  assertOccurrenceIdentityAbsent(result.occurrences[0]);
  assertNoIdentityFields(result);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.equal(Object.hasOwn(result, "stableId"), false);
  assert.ok(
    !result.notes.some((note) => note.includes("unsupported declaration form")),
    "nested body destructuring must not be an unsupported declaration form"
  );
});

test("31. one path + direct source-file const { a } = value stays partial with enumeration partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_DIRECT_DESTRUCTURE_A);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_DIRECT_DESTRUCTURE_A, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "partial");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.completeness.enumeration, "partial");
  assertOccurrenceIdentityAbsent(result.occurrences[0]);
  assertNoIdentityFields(result);
  assert.ok(
    result.notes.some((note) =>
      note.includes("incomplete") && note.includes("unsupported declaration form")
    ),
    "direct source-file destructuring stays an unsupported declaration form"
  );
});

test("32. one path + direct source-file namespace N stays partial with enumeration partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_DIRECT_NAMESPACE_N);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_DIRECT_NAMESPACE_N, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "partial");
  assert.equal(result.census, 0);
  assert.deepEqual(result.occurrences, []);
  assert.equal(result.completeness.enumeration, "partial");
  assertNoIdentityFields(result);
  assert.ok(
    result.notes.some((note) =>
      note.includes("incomplete") && note.includes("unsupported declaration form")
    ),
    "direct source-file namespace stays an unsupported declaration form"
  );
});

test("33. one path + namespace nested in the body of foo does not make enumeration partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_NESTED_BODY_NAMESPACE);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_NESTED_BODY_NAMESPACE, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "partial");
  assert.equal(result.census, 1);
  assert.equal(result.completeness.enumeration, "complete");
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[0].kind, "function");
  assertOccurrenceIdentityAbsent(result.occurrences[0]);
  assertNoIdentityFields(result);
  assert.ok(
    !result.notes.some((note) => note.includes("unsupported declaration form")),
    "a namespace inside a function body must not set enumeration partial"
  );
});

test("34. one path + for-of destructuring nested in the body of foo does not make enumeration partial", () => {
  const sourceSha256 = sha256Text(FIXTURE_NESTED_BODY_FOR_OF_DESTRUCTURE);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_NESTED_BODY_FOR_OF_DESTRUCTURE, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "partial");
  assert.equal(result.census, 1);
  assert.equal(result.completeness.enumeration, "complete");
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].name, "foo");
  assertOccurrenceIdentityAbsent(result.occurrences[0]);
  assertNoIdentityFields(result);
});

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const trackA1Require = createRequire(import.meta.url);
const INSTALLED_TYPESCRIPT_VERSION = JSON.parse(
  readFileSync(trackA1Require.resolve("typescript/package.json"), "utf8")
).version;
const EXPECTED_PARSER = `typescript/${INSTALLED_TYPESCRIPT_VERSION}`;

function assertNativeTypescriptProvider(result) {
  assert.ok(Object.hasOwn(result, "provider"), "parsed result must include provider");
  assert.equal(result.provider.id, "native.typescript.declarations");
  assert.equal(result.provider.version, "1");
  assert.equal(result.provider.kind, "native");
  assert.equal(result.provider.parser, EXPECTED_PARSER);
}

test("35. parsed one-function fixture binds native TypeScript provider from installed package", () => {
  const sourceSha256 = sha256Text(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256 }
  });

  assertNativeTypescriptProvider(result);
  if (INSTALLED_TYPESCRIPT_VERSION === "6.0.3") {
    assert.equal(result.status, "not_evaluated");
  }
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assertNoIdentityFields(result);
});

test("36. ambiguous fixture includes native TypeScript provider and stays ambiguous", () => {
  const sourceSha256 = sha256Text(FIXTURE_TWO_TOP_LEVEL_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TWO_TOP_LEVEL_FOO, "utf8"),
    binding: { sourceSha256 }
  });

  assertNativeTypescriptProvider(result);
  if (INSTALLED_TYPESCRIPT_VERSION === "6.0.3") {
    assert.equal(result.status, "ambiguous");
  }
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assertNoIdentityFields(result);
});

test("37. sha-mismatch result has no provider key", () => {
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256: "0".repeat(64) }
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "provider"), false);
  assertNoIdentityFields(result);
  assertNoOccurrencesKey(result);
});

function expectedDeclarationId(spec, snapshotToken, sourceSha256) {
  return contextDigest(JSON.stringify([
    "tsjs-direct-declarations-1",
    "native.typescript.declarations",
    "1",
    EXPECTED_PARSER,
    snapshotToken,
    spec.path,
    sourceSha256,
    spec.kind,
    spec.range.start,
    spec.range.end,
    spec.nameRange.start,
    spec.nameRange.end,
    spec.name
  ]));
}

test("38. matching snapshot token and one task path sets symbolId to symbol_ plus declarationId", () => {
  const source = FIXTURE_SINGLE_FOO;
  const sourceSha256 = sha256Text(source);
  const snapshot = snapshotFromBytes(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 },
    snapshot,
    task: TASK_PATH_SINGLE
  });
  const start = source.indexOf("export function foo");
  const nameStart = start + "export function ".length;
  const end = source.indexOf("}", start) + 1;
  const spec = {
    name: "foo",
    kind: "function",
    path: SYNTHETIC_PATH,
    range: { start, end },
    nameRange: { start: nameStart, end: nameStart + 3 }
  };

  assert.equal(INSTALLED_TYPESCRIPT_VERSION, "6.0.3");
  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assert.notEqual(result.status, "positive");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  const occurrence = result.occurrences[0];
  assert.equal(occurrence.name, spec.name);
  assert.equal(occurrence.kind, spec.kind);
  assert.equal(occurrence.path, spec.path);
  assert.deepEqual(occurrence.range, spec.range);
  assert.deepEqual(occurrence.nameRange, spec.nameRange);
  const declarationId = expectedDeclarationId(spec, snapshot.token, sourceSha256);
  assert.equal(occurrence.declarationId, declarationId);
  assert.match(occurrence.declarationId, /^[a-f0-9]{64}$/);
  assert.equal(occurrence.symbolId, "symbol_" + occurrence.declarationId);
  assert.equal(occurrence.symbolId, "symbol_" + declarationId);
  assert.equal(Object.hasOwn(occurrence, "stableId"), false);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "stableId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.ok(Array.isArray(result.notes));
  const symbolNotes = result.notes.filter((note) => note.includes("symbol id"));
  assert.equal(symbolNotes.length, 1);
  assert.ok(
    symbolNotes[0].includes("declaration id") &&
      symbolNotes[0].includes("this snapshot only") &&
      symbolNotes[0].includes("not stable across snapshots"),
    "note must say the symbol id is the declaration id for this snapshot only and is not stable across snapshots"
  );
  assert.equal(symbolNotes[0].includes("not minted"), false);
  assert.equal(symbolNotes[0].includes("prefix"), false);
  assert.equal(symbolNotes[0].includes("accepted"), false);
  assert.equal(symbolNotes[0].includes(declarationId), false);
  assert.ok(
    result.notes.every((note) => !note.includes(declarationId)),
    "notes must not contain the declaration digest"
  );
});

test("39. same source with a snapshot token mismatch has no declarationId", () => {
  const source = FIXTURE_SINGLE_FOO;
  const sourceSha256 = sha256Text(source);
  const real = snapshotFromBytes(source);
  const snapshot = { ...real, token: flipLastHex(real.token) };
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 },
    snapshot,
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(JSON.stringify(result).includes("declarationId"), false);
  assert.equal(JSON.stringify(result).includes("symbolId"), false);
  assertNoOccurrencesKey(result);
  assertNoIdentityFields(result);
});

test("40. matching snapshot token with census 2 stays ambiguous and hashes each declarationId", () => {
  const source = FIXTURE_TWO_TOP_LEVEL_FOO;
  const sourceSha256 = sha256Text(source);
  const snapshot = snapshotFromBytes(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 },
    snapshot,
    task: TASK_PATH_SINGLE
  });
  const firstStart = source.indexOf("function foo");
  const firstName = source.indexOf("foo", firstStart);
  const firstEnd = source.indexOf("}", firstStart) + 1;
  const secondStart = source.indexOf("function foo", firstEnd);
  const secondName = source.indexOf("foo", secondStart);
  const secondEnd = source.indexOf("}", secondStart) + 1;
  const specs = [
    {
      name: "foo",
      kind: "function",
      path: SYNTHETIC_PATH,
      range: { start: firstStart, end: firstEnd },
      nameRange: { start: firstName, end: firstName + 3 }
    },
    {
      name: "foo",
      kind: "function",
      path: SYNTHETIC_PATH,
      range: { start: secondStart, end: secondEnd },
      nameRange: { start: secondName, end: secondName + 3 }
    }
  ];

  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "positive");
  assert.equal(result.census, 2);
  assert.equal(result.occurrences.length, 2);
  assert.notEqual(specs[0].range.start, specs[1].range.start);
  const ids = [];
  const symbolIds = [];
  for (let i = 0; i < specs.length; i += 1) {
    const occurrence = result.occurrences[i];
    assert.equal(occurrence.kind, specs[i].kind);
    assert.equal(occurrence.path, specs[i].path);
    assert.deepEqual(occurrence.range, specs[i].range);
    assert.deepEqual(occurrence.nameRange, specs[i].nameRange);
    const declarationId = expectedDeclarationId(specs[i], snapshot.token, sourceSha256);
    assert.equal(occurrence.declarationId, declarationId);
    assert.match(occurrence.declarationId, /^[a-f0-9]{64}$/);
    assert.equal(occurrence.symbolId, "symbol_" + occurrence.declarationId);
    assert.equal(occurrence.symbolId, "symbol_" + declarationId);
    assert.equal(Object.hasOwn(occurrence, "stableId"), false);
    ids.push(declarationId);
    symbolIds.push(occurrence.symbolId);
  }
  assert.notEqual(ids[0], ids[1]);
  assert.notEqual(symbolIds[0], symbolIds[1]);
  assert.equal(symbolIds[0], "symbol_" + ids[0]);
  assert.equal(symbolIds[1], "symbol_" + ids[1]);
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "stableId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.ok(result.notes.every((note) => !ids.some((id) => note.includes(id))));
});

test("41. parsed result with no snapshot has no declarationId", () => {
  const source = FIXTURE_SINGLE_FOO;
  const sourceSha256 = sha256Text(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256 },
    task: TASK_PATH_SINGLE
  });

  assert.equal(result.status, "not_evaluated");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].path, SYNTHETIC_PATH);
  assert.equal(Object.hasOwn(result.occurrences[0], "declarationId"), false);
  assert.equal(Object.hasOwn(result.occurrences[0], "symbolId"), false);
  assert.equal(JSON.stringify(result).includes("declarationId"), false);
  assert.equal(JSON.stringify(result).includes("symbolId"), false);
  assert.notEqual(result.status, "resolved_unique");
  assertNoIdentityFields(result);
});

const SYMBOL_QUERY_DOMAIN = "tsjs_source_file_direct_declarations_v1";
const SYNTHETIC_ROOT_ID = "root_synthetic";
const SYNTHETIC_PROJECT_RELATIVE_PATH = "apps/synthetic";
const SYNTHETIC_TASK_ID = "task_synthetic_a1";

function linkedRevision(overrides = {}) {
  return {
    repositoryId: SYNTHETIC_REPOSITORY_ID,
    worktreeId: SYNTHETIC_WORKTREE_ID,
    status: "available",
    commitSha: SYNTHETIC_COMMIT_SHA,
    branch: null,
    dirty: false,
    isLinkedWorktree: true,
    ...overrides
  };
}

function fullBindingParts(source, { query, revision } = {}) {
  const sourceSha256 = sha256Text(source);
  const rev = revision ?? linkedRevision();
  const snapshot = snapshotFromBytes(source, { revision: rev });
  const project = {
    projectId: SYNTHETIC_PROJECT_ID,
    rootId: SYNTHETIC_ROOT_ID,
    relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
  };
  const task = { id: SYNTHETIC_TASK_ID, paths: [SYNTHETIC_PATH] };
  const resolvedQuery = query ?? {
    name: "foo",
    domain: SYMBOL_QUERY_DOMAIN
  };
  return {
    sourceSha256,
    snapshot,
    project,
    task,
    query: resolvedQuery,
    revision: snapshot.revision
  };
}

function expectedSymbolRequestToken(parts) {
  return contextDigest(JSON.stringify([
    "symbol-resolution-evidence-v1",
    "tsjs-direct-declarations-1",
    parts.project.projectId,
    parts.project.rootId,
    parts.project.relativePath,
    parts.revision.status,
    parts.revision.commitSha,
    parts.revision.branch,
    parts.revision.repositoryId,
    parts.revision.worktreeId,
    parts.revision.dirty,
    parts.revision.isLinkedWorktree,
    parts.snapshot.token,
    "native.typescript.declarations",
    "1",
    EXPECTED_PARSER,
    parts.task.id,
    parts.task.paths[0],
    parts.query.name,
    parts.query.domain
  ]));
}

function resolveWithBinding(source, parts) {
  return resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
}

test("42. full binding and one function is resolved_unique", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  const requestToken = expectedSymbolRequestToken(parts);

  assert.equal(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  const occurrence = result.occurrences[0];
  assert.match(occurrence.declarationId, /^[a-f0-9]{64}$/);
  assert.equal(occurrence.symbolId, "symbol_" + occurrence.declarationId);
  assert.match(occurrence.symbolId, /^symbol_[a-f0-9]{64}$/);
  assert.equal(occurrence.symbolId.startsWith("symbol_"), true);
  assert.equal(result.requestToken, requestToken);
  assert.equal(result.snapshotBinding.requestToken, requestToken);
  assert.equal(result.generatedAt, null);
  assert.equal(result.counts.exactMatchCount, 1);
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 1,
    exactMatchCount: 1
  });
  assert.deepEqual(result.revisionBinding, {
    status: parts.revision.status,
    commitSha: parts.revision.commitSha,
    branch: parts.revision.branch,
    repositoryId: parts.revision.repositoryId,
    worktreeId: parts.revision.worktreeId,
    dirty: parts.revision.dirty,
    isLinkedWorktree: parts.revision.isLinkedWorktree
  });
  assert.equal(Object.hasOwn(result.revisionBinding, "repositoryIdentity"), false);
  assert.deepEqual(result.snapshotBinding, {
    snapshotToken: parts.snapshot.token,
    sourceDigest: parts.sourceSha256,
    requestToken
  });
  assert.equal(result.completeness.source, "complete");
  assert.equal(result.completeness.parse, "complete");
  assert.equal(result.completeness.enumeration, "complete");
  assert.equal(result.completeness.output, "complete");
  assertNativeTypescriptProvider(result);
  assert.equal(parts.task.paths[0], "src/example.js");
  assert.equal(parts.snapshot.path, "src/example.js");
});

test("43. full binding with query.domain omitted stays not_evaluated", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, { query: { name: "foo" } });
  assert.equal(Object.hasOwn(parts.query, "domain"), false);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "unsupported");
  assert.equal(result.completeness.output, "not_evaluated");
});

test("44. full binding with a different query.domain stays not_evaluated", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    query: { name: "foo", domain: "other_domain_not_direct_declarations" }
  });
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "unsupported");
  assert.equal(result.completeness.output, "not_evaluated");
});

test("45. full binding with dirty revision stays not_evaluated", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    revision: linkedRevision({ dirty: true })
  });
  const result = resolveWithBinding(source, parts);
  assert.equal(parts.revision.dirty, true);
  assert.equal(parts.query.domain, SYMBOL_QUERY_DOMAIN);
  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.completeness.output, "not_evaluated");
});

test("46. two top-level functions plus full binding stay ambiguous", () => {
  const source = FIXTURE_TWO_TOP_LEVEL_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.census, 2);
  assert.equal(result.completeness.output, "not_evaluated");
});

test("47. direct destructuring plus full binding and census 1 of foo stays partial", () => {
  const source = FIXTURE_DIRECT_DESTRUCTURE_A;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "partial");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.census, 1);
  assert.equal(result.completeness.enumeration, "partial");
  assert.notEqual(result.completeness.output, "complete");
  assert.equal(result.completeness.output, "not_evaluated");
});
