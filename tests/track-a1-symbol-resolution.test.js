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
  assert.deepEqual(omitted.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
  assertNoStableId(omitted);
  assertNoOccurrencesKey(omitted);

  const incompatible = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256: "0".repeat(64) }
  });
  assert.equal(incompatible.status, "not_evaluated");
  assert.deepEqual(incompatible.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
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
    assert.deepEqual(result.notes, [TASK_PATHS_WERE_REJECTED_NOTE]);
    assert.notEqual(result.status, "partial");
    assert.notEqual(result.status, "resolved_unique");
    assert.equal(Object.hasOwn(result, "pathRecords"), false);
    assert.equal(Object.hasOwn(result, "provider"), false);
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
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assertNoIdentityFields(result);
  assertNoOccurrencesKey(result);
  assert.deepEqual(result.notes, [FILES_WERE_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
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
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
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
  assert.deepEqual(result.notes, [NAME_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
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
  assert.deepEqual(result.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
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
    matchedLowerBound: 1,
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
  assert.equal(result.status, "resolved_unique");
  assert.equal(result.pathRecords.length, 1);
  assert.equal(result.pathRecords[0].path, parts.task.paths[0]);
  assert.equal(result.pathRecords[0].sha256, sha256Text(source));
  assert.equal(result.pathRecords[0].sha256, parts.sourceSha256);
  assert.match(result.pathRecords[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.pathRecords[0].byteSize, Buffer.byteLength(source));
  assert.equal(result.pathRecords[0].parse, "complete");
  assert.equal(result.pathRecords[0].enumeration, "complete");
  assert.equal(result.pathRecords[0].matched, 1);
});

test("43. full binding with query.domain omitted stays not_evaluated", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, { query: { name: "foo" } });
  assert.equal(Object.hasOwn(parts.query, "domain"), false);
  let threw = false;
  let result;
  try {
    result = resolveWithBinding(source, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "unsupported");
  assert.deepEqual(result.notes, [QUERY_DOMAIN_IS_NOT_SUPPORTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "occurrences"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("44. full binding with a different query.domain stays not_evaluated", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    query: { name: "foo", domain: "other_domain_not_direct_declarations" }
  });
  let threw = false;
  let result;
  try {
    result = resolveWithBinding(source, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "unsupported");
  assert.deepEqual(result.notes, [QUERY_DOMAIN_IS_NOT_SUPPORTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "occurrences"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
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

const FIXTURE_NO_FOO = "export const other = 1;\n";

test("48. full binding and no matching name is not_found", () => {
  const source = FIXTURE_NO_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  const requestToken = expectedSymbolRequestToken(parts);
  const occurrences = Object.hasOwn(result, "occurrences") ? result.occurrences : [];

  assert.equal(result.status, "not_found");
  assert.equal(result.census, 0);
  assert.deepEqual(occurrences, []);
  assert.equal(result.counts.exactMatchCount, 0);
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 0,
    matchedLowerBound: 0,
    exactMatchCount: 0
  });
  assert.equal(Object.hasOwn(result, "symbolId"), false);
  assert.equal(Object.hasOwn(result, "declarationId"), false);
  assert.equal(JSON.stringify(result).includes("symbolId"), false);
  assert.equal(JSON.stringify(result).includes("declarationId"), false);
  assert.match(result.requestToken, /^[a-f0-9]{64}$/);
  assert.equal(result.requestToken, requestToken);
  assert.equal(result.snapshotBinding.requestToken, requestToken);
  assert.equal(result.generatedAt, null);
  assert.deepEqual(result.completeness, {
    source: "complete",
    parse: "complete",
    enumeration: "complete",
    output: "complete"
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
  assertNativeTypescriptProvider(result);
});

test("49. census 0 with query.domain omitted stays not_evaluated, not not_found", () => {
  const source = FIXTURE_NO_FOO;
  const parts = fullBindingParts(source, { query: { name: "foo" } });
  assert.equal(Object.hasOwn(parts.query, "domain"), false);
  let threw = false;
  let result;
  try {
    result = resolveWithBinding(source, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.notEqual(result.status, "not_found");
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [QUERY_DOMAIN_IS_NOT_SUPPORTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "occurrences"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("50. full binding and truncated invalid source stays partial, not not_found", () => {
  const source = FIXTURE_TRUNCATED;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "partial");
  assert.notEqual(result.status, "not_found");
});

test("51. full binding and one function foo stays resolved_unique", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "resolved_unique");
  assert.equal(result.census, 1);
});

const PATH_A = "src/a.js";
const PATH_B = "src/b.js";
const FILE_B_OTHER = "export const other = 1;\n";

function combinedSourceSha(texts) {
  return sha256Text(texts.join(""));
}

function multiPathBinding(ordered, { query, revision } = {}) {
  const rev = revision ?? linkedRevision();
  const texts = ordered.map((entry) => entry[1]);
  const produced = createProviderSnapshot(
    { projectId: SYNTHETIC_PROJECT_ID },
    ordered.map(([path, text]) => ({ path, text })),
    providerRevision(rev)
  );
  const project = {
    projectId: SYNTHETIC_PROJECT_ID,
    rootId: SYNTHETIC_ROOT_ID,
    relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
  };
  const paths = ordered.map(([path]) => path);
  const task = { id: SYNTHETIC_TASK_ID, paths };
  const resolvedQuery = query ?? { name: "foo", domain: SYMBOL_QUERY_DOMAIN };
  const snapshot = {
    projectId: SYNTHETIC_PROJECT_ID,
    token: produced.token,
    revision: rev
  };
  return {
    combinedSha: combinedSourceSha(texts),
    snapshot,
    project,
    task,
    query: resolvedQuery,
    revision: rev,
    files: ordered.map(([path, text]) => ({
      path,
      sourceBytes: Buffer.from(text, "utf8")
    }))
  };
}

function resolveAcrossPaths(ordered, parts) {
  return resolveTrackA1({
    name: "foo",
    files: parts.files,
    binding: { sourceSha256: parts.combinedSha },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
}

function expectedMultiSymbolRequestToken(parts) {
  const fields = [
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
    parts.task.paths[0]
  ];
  for (let index = 1; index < parts.task.paths.length; index += 1) {
    fields.push(parts.task.paths[index]);
  }
  fields.push(parts.query.name, parts.query.domain);
  return contextDigest(JSON.stringify(fields));
}

test("52. foo only in src/a.js across two paths is resolved_unique", () => {
  const ordered = [
    [PATH_A, FIXTURE_SINGLE_FOO],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);
  const requestToken = expectedMultiSymbolRequestToken(parts);
  const source = FIXTURE_SINGLE_FOO;
  const start = source.indexOf("export function foo");
  const nameStart = start + "export function ".length;
  const end = source.indexOf("}", start) + 1;
  const spec = {
    name: "foo",
    kind: "function",
    path: PATH_A,
    range: { start, end },
    nameRange: { start: nameStart, end: nameStart + 3 }
  };
  const fileSha = sha256Text(source);
  const declarationId = expectedDeclarationId(spec, parts.snapshot.token, fileSha);

  assert.equal(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assert.notEqual(result.status, "ambiguous");
  assert.equal(result.census, 1);
  assert.equal(result.occurrences.length, 1);
  assert.equal(result.occurrences[0].path, PATH_A);
  assert.equal(result.occurrences[0].name, "foo");
  assert.equal(result.occurrences[0].declarationId, declarationId);
  assert.match(result.occurrences[0].declarationId, /^[a-f0-9]{64}$/);
  assert.equal(result.occurrences[0].symbolId, "symbol_" + declarationId);
  assert.notEqual(fileSha, parts.combinedSha);
  assert.deepEqual(result.counts, {
    requested: 2,
    processed: 2,
    retained: 1,
    matchedLowerBound: 1,
    exactMatchCount: 1
  });
  assert.equal(result.requestToken, requestToken);
  assert.equal(result.snapshotBinding.requestToken, requestToken);
  assert.equal(result.snapshotBinding.sourceDigest, parts.combinedSha);
  assert.equal(result.completeness.output, "complete");
  assert.equal(result.completeness.parse, "complete");
  assert.equal(result.completeness.enumeration, "complete");
  assertNativeTypescriptProvider(result);
  assert.equal(result.status, "resolved_unique");
  assert.equal(result.pathRecords.length, 2);
  assert.deepEqual(result.pathRecords.map((record) => record.path), [PATH_A, PATH_B]);
  assert.deepEqual(result.pathRecords.map((record) => record.matched), [1, 0]);
  assert.equal(result.pathRecords[0].sha256, sha256Text(FIXTURE_SINGLE_FOO));
  assert.equal(result.pathRecords[1].sha256, sha256Text(FILE_B_OTHER));
  assert.match(result.pathRecords[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(result.pathRecords[1].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.pathRecords[0].byteSize, Buffer.byteLength(FIXTURE_SINGLE_FOO));
  assert.equal(result.pathRecords[1].byteSize, Buffer.byteLength(FILE_B_OTHER));
  assert.equal(result.pathRecords[0].parse, "complete");
  assert.equal(result.pathRecords[1].parse, "complete");
  assert.equal(result.pathRecords[0].enumeration, "complete");
  assert.equal(result.pathRecords[1].enumeration, "complete");
});

test("53. foo in both src/a.js and src/b.js is ambiguous", () => {
  const ordered = [
    [PATH_A, FIXTURE_SINGLE_FOO],
    [PATH_B, FIXTURE_SINGLE_FOO]
  ];
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);

  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assert.equal(result.census, 2);
  assert.equal(result.occurrences.length, 2);
  assert.deepEqual(result.occurrences.map((occurrence) => occurrence.path), [PATH_A, PATH_B]);
  assert.equal(result.completeness.output, "not_evaluated");
  assert.equal(result.status, "ambiguous");
  assert.equal(result.pathRecords.length, 2);
  assert.deepEqual(result.pathRecords.map((record) => record.path), [PATH_A, PATH_B]);
  assert.deepEqual(result.pathRecords.map((record) => record.matched), [1, 1]);
  assert.equal(result.pathRecords[0].parse, "complete");
  assert.equal(result.pathRecords[1].parse, "complete");
  assert.equal(result.pathRecords[0].enumeration, "complete");
  assert.equal(result.pathRecords[1].enumeration, "complete");
});

test("54. foo in neither clean path is not_found", () => {
  const ordered = [
    [PATH_A, FILE_B_OTHER],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);
  const requestToken = expectedMultiSymbolRequestToken(parts);

  assert.equal(result.status, "not_found");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "partial");
  assert.equal(result.census, 0);
  assert.deepEqual(result.occurrences, []);
  assert.equal(result.counts.exactMatchCount, 0);
  assert.deepEqual(result.counts, {
    requested: 2,
    processed: 2,
    retained: 0,
    matchedLowerBound: 0,
    exactMatchCount: 0
  });
  assert.equal(result.requestToken, requestToken);
  assert.equal(JSON.stringify(result).includes("symbolId"), false);
  assert.equal(JSON.stringify(result).includes("declarationId"), false);
  assert.equal(result.completeness.output, "complete");
  assertNativeTypescriptProvider(result);
});

test("55. thirty-three task paths stay not_evaluated and do not parse", () => {
  const text = FILE_B_OTHER;
  const paths = Array.from({ length: 33 }, (_value, index) => "src/p" + index + ".js");
  const sourceBytes = Buffer.from(text, "utf8");
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: sha256Text(text) },
    task: { id: SYNTHETIC_TASK_ID, paths },
    files: paths.map((path) => ({ path, sourceBytes })),
    project: {
      projectId: SYNTHETIC_PROJECT_ID,
      rootId: SYNTHETIC_ROOT_ID,
      relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
    },
    query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
  });

  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [TASK_PATH_COUNT_EXCEEDS_32_NOTE]);
  assert.equal(JSON.stringify(result).includes("resolved_unique"), false);
  assert.notEqual(result.status, "not_found");
  assert.equal(Object.hasOwn(result, "census"), false);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("56. a syntax error in one of two paths is partial", () => {
  const ordered = [
    [PATH_A, FIXTURE_TRUNCATED],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);

  assert.equal(result.status, "partial");
  assert.notEqual(result.status, "not_found");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.completeness.parse, "partial");
  assert.ok(result.coverage.syntacticDiagnosticCount > 0);
  assert.equal(result.completeness.output, "not_evaluated");
  assert.equal(result.pathRecords.length, 2);
  assert.deepEqual(result.pathRecords.map((record) => record.path), [PATH_A, PATH_B]);
  assert.equal(result.pathRecords[0].parse, "partial");
  assert.equal(result.pathRecords[1].parse, "complete");
  assert.equal(result.pathRecords[0].sha256, sha256Text(FIXTURE_TRUNCATED));
  assert.equal(result.pathRecords[1].sha256, sha256Text(FILE_B_OTHER));
  assert.match(result.pathRecords[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.pathRecords[0].byteSize, Buffer.byteLength(FIXTURE_TRUNCATED));
  assert.equal(result.pathRecords[1].byteSize, Buffer.byteLength(FILE_B_OTHER));
  assert.notEqual(result.pathRecords[0].parse, "complete");
  assert.notEqual(result.status, "resolved_unique");
});

test("57. an unsupported form in one of two paths blocks resolved_unique", () => {
  const ordered = [
    [PATH_A, FIXTURE_SINGLE_FOO],
    [PATH_B, "const { a } = value;\n"]
  ];
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);

  assert.equal(result.status, "partial");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assert.equal(result.census, 1);
  assert.equal(result.completeness.enumeration, "partial");
  assert.equal(result.completeness.output, "not_evaluated");
  assert.equal(result.pathRecords.length, 2);
  assert.deepEqual(result.pathRecords.map((record) => record.enumeration), ["complete", "partial"]);
  assert.deepEqual(result.pathRecords.map((record) => record.matched), [1, 0]);
  assert.deepEqual(result.pathRecords.map((record) => record.parse), ["complete", "complete"]);
  assert.equal(result.status, "partial");
});

const PER_FILE_BYTE_CEILING = 131072;

function sourceOfByteLength(byteLength) {
  const head = "export function foo() {\n";
  const bytes = Buffer.alloc(byteLength, 0x20);
  bytes.write(head, 0, "utf8");
  return bytes;
}

test("58. 131073 bytes with one task path and an otherwise full binding is not_evaluated before parse", () => {
  const bytes = sourceOfByteLength(PER_FILE_BYTE_CEILING + 1);
  const sourceSha256 = sha256Text(bytes.toString("utf8"));
  const base = fullBindingParts(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: bytes,
    binding: { sourceSha256 },
    snapshot: {
      projectId: base.snapshot.projectId,
      path: base.snapshot.path,
      sourceSha256,
      byteSize: bytes.length,
      revision: base.snapshot.revision,
      token: base.snapshot.token
    },
    task: base.task,
    project: base.project,
    query: base.query
  });

  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.notEqual(result.status, "not_found");
  assert.notEqual(result.status, "partial");
  assert.notEqual(result.status, "ambiguous");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Array.isArray(result.notes), true);
  assert.equal(result.notes.some((note) => note.includes("byte ceiling")), true);
  for (const note of result.notes) {
    assert.equal(note.includes("\u0000"), false);
    assert.equal(note.includes("export function"), false);
    assert.equal(note.length <= 160, true);
  }
  assert.equal(JSON.stringify(result).includes("resolved_unique"), false);
});

test("59. exactly 131072 bytes is not rejected for the source byte ceiling", () => {
  const bytes = sourceOfByteLength(PER_FILE_BYTE_CEILING);
  const text = bytes.toString("utf8");
  const parts = fullBindingParts(text);
  const result = resolveWithBinding(text, parts);
  assert.notEqual(result.status, "resolved_unique");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("byte ceiling"), false);
  assert.equal(serialized.includes("resolved_unique"), false);
});

test("60. existing small resolved_unique fixture stays resolved_unique", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "resolved_unique");
  assert.ok(Buffer.byteLength(source) < PER_FILE_BYTE_CEILING);
});

function assertContractIdentity(result) {
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.analysisVersion, "symbol-resolution-evidence-v1");
  assert.equal(result.policyVersion, "tsjs-direct-declarations-1");
  assert.equal(Object.hasOwn(result, "generatedAt"), true);
  assert.equal(result.generatedAt, null);
}

test("61. resolved_unique fixture includes contract identity", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "resolved_unique");
  assertContractIdentity(result);
});

test("62. not_evaluated ceiling rejection includes contract identity", () => {
  const bytes = sourceOfByteLength(PER_FILE_BYTE_CEILING + 1);
  const sourceSha256 = sha256Text(bytes.toString("utf8"));
  const base = fullBindingParts(FIXTURE_SINGLE_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: bytes,
    binding: { sourceSha256 },
    snapshot: {
      projectId: base.snapshot.projectId,
      path: base.snapshot.path,
      sourceSha256,
      byteSize: bytes.length,
      revision: base.snapshot.revision,
      token: base.snapshot.token
    },
    task: base.task,
    project: base.project,
    query: base.query
  });
  assert.equal(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.notes.some((note) => note.includes("byte ceiling")), true);
  assertContractIdentity(result);
});

test("63. ambiguous result includes contract identity", () => {
  const sourceSha256 = sha256Text(FIXTURE_TWO_TOP_LEVEL_FOO);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_TWO_TOP_LEVEL_FOO, "utf8"),
    binding: { sourceSha256 }
  });
  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "not_evaluated");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.census, 2);
  assertContractIdentity(result);
});

test("64. two paths, one small file and one 131073-byte buffer, are not_evaluated for the byte ceiling before decode", () => {
  const small = Buffer.from(FIXTURE_SINGLE_FOO, "utf8");
  const oversize = Buffer.alloc(PER_FILE_BYTE_CEILING + 1, 0x20);
  assert.equal(Buffer.isBuffer(oversize), true);
  assert.equal(typeof oversize, "object");
  assert.equal(oversize.byteLength, 131073);
  assert.ok(small.byteLength < PER_FILE_BYTE_CEILING);

  const originalToString = Buffer.prototype.toString;
  let decodedOversize = false;
  Buffer.prototype.toString = function trackA1ByteCeilingToString(...args) {
    if (Buffer.isBuffer(this) && this.byteLength > PER_FILE_BYTE_CEILING) {
      decodedOversize = true;
    }
    return originalToString.apply(this, args);
  };

  try {
    const result = resolveTrackA1({
      name: "foo",
      files: [
        { path: PATH_A, sourceBytes: small },
        { path: PATH_B, sourceBytes: oversize }
      ],
      binding: { sourceSha256: "a".repeat(64) },
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });

    assert.equal(result.status, "not_evaluated");
    assert.notEqual(result.status, "resolved_unique");
    assert.equal(Object.hasOwn(result, "pathRecords"), false);
    assert.equal(Array.isArray(result.notes), true);
    assert.equal(result.notes.some((note) => note.includes("byte ceiling")), true);
    assert.equal(decodedOversize, false);
  } finally {
    Buffer.prototype.toString = originalToString;
  }
});

function compactByteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function resolveBound(source, parts, limits) {
  const input = {
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  if (limits !== undefined) input.limits = limits;
  return resolveTrackA1(input);
}

function assertBudgetExceeded(error) {
  assert.equal(error instanceof Error, true);
  assert.equal(error.code, "symbol_resolution_budget_exceeded");
  assert.equal(error.message, "symbol_resolution_budget_exceeded");
  return true;
}

test("65. small resolved_unique fixture returns without limits and with compactBytes 131072", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const withoutLimits = resolveWithBinding(source, parts);
  const withoutKey = resolveBound(source, parts, {});
  const withMax = resolveBound(source, parts, { compactBytes: 131072 });

  assert.equal(withoutLimits.status, "resolved_unique");
  assert.deepEqual(withoutKey, withoutLimits);
  assert.deepEqual(withMax, withoutLimits);
  assert.equal(withoutLimits.requestToken, expectedSymbolRequestToken(parts));
  assert.equal(Object.hasOwn(withoutLimits, "limits"), false);
  assert.equal(Object.hasOwn(withoutLimits, "reasons"), false);
  assert.equal(Object.hasOwn(withMax, "limits"), false);
  assert.equal(Object.hasOwn(withMax, "reasons"), false);
});

test("66. compactBytes equal to the JSON size returns and one byte under throws", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const baseline = resolveWithBinding(source, parts);
  const size = compactByteLength(baseline);

  const exact = resolveBound(source, parts, { compactBytes: size });
  assert.deepEqual(exact, baseline);
  assert.equal(compactByteLength(exact), size);

  assert.throws(
    () => resolveBound(source, parts, { compactBytes: size - 1 }),
    assertBudgetExceeded
  );
});

function repeatedFooSource(count) {
  const lines = ["// synthetic fixture: many direct declarations of foo"];
  for (let index = 0; index < count; index += 1) {
    lines.push("export function foo() { return 1; }");
  }
  lines.push("");
  return lines.join("\n");
}

test("67. a result above 65536 bytes that fits in 131072 throws without limits and returns at the maximum", () => {
  let count = 80;
  let sized = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const source = repeatedFooSource(count);
    const parts = fullBindingParts(source);
    const result = resolveBound(source, parts, { compactBytes: 131072 });
    const size = compactByteLength(result);
    if (size > 65536 && size <= 131072) {
      sized = { count, source, parts, result, size };
      break;
    }
    count = size <= 65536
      ? Math.ceil(count * (70000 / Math.max(size, 1)))
      : Math.max(2, Math.floor(count * (100000 / size)));
  }
  assert.notEqual(sized, null);
  assert.equal(sized.result.status, "ambiguous");
  assert.equal(sized.result.census, sized.count);
  assert.equal(sized.result.occurrences.length, sized.count);
  assert.equal(Object.hasOwn(sized.result, "limits"), false);
  assert.equal(Object.hasOwn(sized.result, "reasons"), false);

  assert.throws(() => resolveBound(sized.source, sized.parts), assertBudgetExceeded);
  assert.throws(() => resolveBound(sized.source, sized.parts, {}), assertBudgetExceeded);

  const atMax = resolveBound(sized.source, sized.parts, { compactBytes: 131072 });
  assert.equal(atMax.status, "ambiguous");
  assert.equal(atMax.census, sized.count);
  assert.equal(atMax.occurrences.length, sized.count);
  assert.equal(compactByteLength(atMax) > 65536, true);
  assert.equal(compactByteLength(atMax) <= 131072, true);
  assert.deepEqual(atMax, sized.result);
});

test("68. an invalid compactBytes override is not_evaluated before parse and does not throw", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const originalToString = Buffer.prototype.toString;
  let decodedSource = false;
  Buffer.prototype.toString = function trackCompactBytesToString(...args) {
    if (this === sourceBytes) decodedSource = true;
    return originalToString.apply(this, args);
  };

  try {
    for (const compactBytes of [0, -1, 1.5, 131073, Number.POSITIVE_INFINITY, Number.NaN, "65536", null]) {
      const result = resolveTrackA1({
        name: "foo",
        sourceBytes,
        binding: { sourceSha256: parts.sourceSha256 },
        snapshot: parts.snapshot,
        task: parts.task,
        project: parts.project,
        query: parts.query,
        limits: { compactBytes }
      });
      assert.equal(result.status, "not_evaluated");
      assert.equal(Object.hasOwn(result, "pathRecords"), false);
      assert.equal(Array.isArray(result.notes), true);
      assert.equal(result.notes.includes("compactBytes override was rejected"), true);
      assert.equal(Object.hasOwn(result, "limits"), false);
      assert.equal(Object.hasOwn(result, "reasons"), false);
      assertContractIdentity(result);
    }
    assert.equal(decodedSource, false);
  } finally {
    Buffer.prototype.toString = originalToString;
  }
});

const NAME_LENGTH_NOTE = "name exceeds 128 characters";
const NAME_128 = "n".repeat(128);
const NAME_129 = "n".repeat(129);

function assertNoNameLengthNote(result) {
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(NAME_LENGTH_NOTE), false);
  assert.equal(JSON.stringify(result).includes(NAME_LENGTH_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
}

function resolveWithoutDecode(sourceBytesList, run) {
  const watched = sourceBytesList;
  const originalToString = Buffer.prototype.toString;
  let decoded = false;
  Buffer.prototype.toString = function trackNameLengthToString(...args) {
    if (watched.includes(this)) decoded = true;
    return originalToString.apply(this, args);
  };
  try {
    const result = run();
    return { result, decoded };
  } finally {
    Buffer.prototype.toString = originalToString;
  }
}

test("69. a 129-character name is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: NAME_129,
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [NAME_LENGTH_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("70. a 129-character query.name is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: { name: NAME_129, domain: parts.query.domain }
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [NAME_LENGTH_NOTE]);
  assertContractIdentity(result);
});

test("71. a 128-character name does not get the length note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveTrackA1({
    name: NAME_128,
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: { name: NAME_128, domain: parts.query.domain }
  });

  assert.notEqual(result.status, undefined);
  assertNoNameLengthNote(result);
  assert.equal(NAME_128.length, 128);
});

test("72. an empty name stays rejected without the length note", () => {
  const result = resolveTrackA1({
    name: "",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    query: { name: "", domain: SYMBOL_QUERY_DOMAIN }
  });
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NAME_WAS_REJECTED_NOTE]);
  assertNoNameLengthNote(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("73. a 129-character name on two paths is not_evaluated before either buffer is decoded", () => {
  const fileA = Buffer.from(FIXTURE_SINGLE_FOO, "utf8");
  const fileB = Buffer.from("export function bar() { return 2; }\n", "utf8");
  const { result, decoded } = resolveWithoutDecode([fileA, fileB], () => resolveTrackA1({
    name: NAME_129,
    files: [
      { path: PATH_A, sourceBytes: fileA },
      { path: PATH_B, sourceBytes: fileB }
    ],
    task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
    project: {
      projectId: SYNTHETIC_PROJECT_ID,
      rootId: SYNTHETIC_ROOT_ID,
      relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
    },
    query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [NAME_LENGTH_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
});

test("74. a name of 129 code units is not normalized or trimmed before the length check", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const name = "e\u0301".repeat(64) + "x";
  assert.equal(name.length, 129);
  assert.equal(name.normalize("NFC").length < 128, true);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name,
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NAME_LENGTH_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

const PATH_LENGTH_NOTE = "path exceeds 1024 characters";
const PATH_1024 = "a".repeat(1024);
const PATH_1025 = "p".repeat(1025);

test("75. a 1025-character task path is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: { id: parts.task.id, paths: [PATH_1025] },
    project: parts.project,
    query: parts.query
  }));

  assert.equal(PATH_1025.length, 1025);
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PATH_LENGTH_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("76. a 1025-character project.relativePath is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const relativePath = "r".repeat(1025);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: { ...parts.project, relativePath },
    query: parts.query
  }));

  assert.equal(relativePath.length, 1025);
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PATH_LENGTH_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("77. two task paths are not_evaluated before decode when only the second exceeds 1024", () => {
  const fileA = Buffer.from(FIXTURE_SINGLE_FOO, "utf8");
  const fileB = Buffer.from("export function bar() { return 2; }\n", "utf8");
  const longPath = "q".repeat(1025);
  const { result, decoded } = resolveWithoutDecode([fileA, fileB], () => resolveTrackA1({
    name: "foo",
    files: [
      { path: PATH_A, sourceBytes: fileA },
      { path: longPath, sourceBytes: fileB }
    ],
    task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, longPath] },
    project: {
      projectId: SYNTHETIC_PROJECT_ID,
      rootId: SYNTHETIC_ROOT_ID,
      relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
    },
    query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
  }));

  assert.equal(PATH_A.length < 1024, true);
  assert.equal(longPath.length, 1025);
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PATH_LENGTH_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
});

test("78. a task path and relativePath of exactly 1024 characters do not get the length note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const relativePath = "b".repeat(1024);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: { id: parts.task.id, paths: [PATH_1024] },
    project: { ...parts.project, relativePath },
    query: parts.query
  });

  assert.equal(PATH_1024.length, 1024);
  assert.equal(relativePath.length, 1024);
  assert.notEqual(result.status, undefined);
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(PATH_LENGTH_NOTE), false);
  assert.equal(JSON.stringify(result).includes(PATH_LENGTH_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
});

test("79. a 1025-code-unit task path is not normalized or trimmed before the length check", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const path = "e\u0301".repeat(512) + "x";
  assert.equal(path.length, 1025);
  assert.equal(path.normalize("NFC").length <= 1024, true);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: { id: parts.task.id, paths: [path] },
    project: parts.project,
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PATH_LENGTH_NOTE]);
});

const PROJECT_ID_NOTE = "projectId exceeds 128 characters";
const ROOT_ID_NOTE = "rootId exceeds 128 characters";
const ID_128 = "c".repeat(128);
const ID_129 = "d".repeat(129);

function assertNoIdLengthNotes(result) {
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(PROJECT_ID_NOTE), false);
  assert.equal(notes.includes(ROOT_ID_NOTE), false);
  assert.equal(JSON.stringify(result).includes(PROJECT_ID_NOTE), false);
  assert.equal(JSON.stringify(result).includes(ROOT_ID_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
}

test("80. a 129-character project.projectId is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: { ...parts.project, projectId: ID_129 },
    query: parts.query
  }));

  assert.equal(ID_129.length, 129);
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PROJECT_ID_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("81. a 129-character snapshot.projectId is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: { ...parts.snapshot, projectId: ID_129 },
    task: parts.task,
    project: parts.project,
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PROJECT_ID_NOTE]);
  assertContractIdentity(result);
});

test("82. a 129-character project.rootId is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: { ...parts.project, rootId: ID_129 },
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [ROOT_ID_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("83. two paths with a 129-character projectId are not_evaluated before either buffer is decoded", () => {
  const fileA = Buffer.from(FIXTURE_SINGLE_FOO, "utf8");
  const fileB = Buffer.from("export function bar() { return 2; }\n", "utf8");
  const { result, decoded } = resolveWithoutDecode([fileA, fileB], () => resolveTrackA1({
    name: "foo",
    files: [
      { path: PATH_A, sourceBytes: fileA },
      { path: PATH_B, sourceBytes: fileB }
    ],
    task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
    project: {
      projectId: ID_129,
      rootId: SYNTHETIC_ROOT_ID,
      relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
    },
    query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PROJECT_ID_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
});

test("84. projectId and rootId of exactly 128 characters do not get the length notes", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: { ...parts.snapshot, projectId: ID_128 },
    task: parts.task,
    project: { ...parts.project, projectId: ID_128, rootId: ID_128 },
    query: parts.query
  });

  assert.equal(ID_128.length, 128);
  assert.notEqual(result.status, undefined);
  assertNoIdLengthNotes(result);
});

test("85. an empty projectId or rootId stays rejected without the length notes", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const emptyProjectId = resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: { ...parts.snapshot, projectId: "" },
    task: parts.task,
    project: { ...parts.project, projectId: "" },
    query: parts.query
  });
  const emptyRootId = resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: { ...parts.project, rootId: "" },
    query: parts.query
  });

  assert.equal(emptyProjectId.status, "not_evaluated");
  assert.equal(emptyRootId.status, "not_evaluated");
  assert.deepEqual(emptyProjectId.notes, [SNAPSHOT_WAS_REJECTED_NOTE]);
  assertNoIdLengthNotes(emptyProjectId);
  assertNoIdLengthNotes(emptyRootId);
});

test("86. projectId and rootId both over 128 produce both notes, projectId first, before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: { ...parts.snapshot, projectId: ID_129 },
    task: parts.task,
    project: { ...parts.project, projectId: ID_129, rootId: ID_129 },
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PROJECT_ID_NOTE, ROOT_ID_NOTE]);
});

test("87. a 129-code-unit projectId is not normalized before the length check", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const projectId = "e\u0301".repeat(64) + "x";
  assert.equal(projectId.length, 129);
  assert.equal(projectId.normalize("NFC").length <= 128, true);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: { ...parts.project, projectId },
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [PROJECT_ID_NOTE]);
});

const BRANCH_NOTE = "branch exceeds 512 characters";
const BRANCH_512 = "b".repeat(512);
const BRANCH_513 = "b".repeat(513);

function assertNoBranchLengthNote(result) {
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(BRANCH_NOTE), false);
  assert.equal(JSON.stringify(result).includes(BRANCH_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
}

test("88. a 513-character branch is not_evaluated before the buffer is decoded", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const snapshot = {
    ...parts.snapshot,
    revision: { ...parts.snapshot.revision, branch: BRANCH_513 }
  };
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  }));

  assert.equal(BRANCH_513.length, 513);
  assert.equal(snapshot.revision.branch, BRANCH_513);
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [BRANCH_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("89. two paths with a 513-character branch are not_evaluated before either buffer is decoded", () => {
  const fileA = Buffer.from(FIXTURE_SINGLE_FOO, "utf8");
  const fileB = Buffer.from("export function bar() { return 2; }\n", "utf8");
  const { result, decoded } = resolveWithoutDecode([fileA, fileB], () => resolveTrackA1({
    name: "foo",
    files: [
      { path: PATH_A, sourceBytes: fileA },
      { path: PATH_B, sourceBytes: fileB }
    ],
    snapshot: { revision: { branch: BRANCH_513 } },
    task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
    project: {
      projectId: SYNTHETIC_PROJECT_ID,
      rootId: SYNTHETIC_ROOT_ID,
      relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
    },
    query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [BRANCH_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
});

test("90. a branch of exactly 512 characters does not get the length note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, { revision: linkedRevision({ branch: BRANCH_512 }) });
  const result = resolveWithBinding(source, parts);

  assert.equal(BRANCH_512.length, 512);
  assert.equal(parts.snapshot.revision.branch, BRANCH_512);
  assert.notEqual(result.status, undefined);
  assertNoBranchLengthNote(result);
});

test("91. a null branch stays accepted without the length note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  assert.equal(parts.snapshot.revision.branch, null);
  const result = resolveWithBinding(source, parts);

  assert.equal(result.status, "resolved_unique");
  assert.equal(result.revisionBinding.branch, null);
  assertNoBranchLengthNote(result);
});

test("92. an absent branch stays rejected without the length note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const revision = linkedRevision();
  delete revision.branch;
  const parts = fullBindingParts(source, { revision });
  assert.equal(Object.hasOwn(parts.snapshot.revision, "branch"), false);
  const result = resolveWithBinding(source, parts);

  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SNAPSHOT_WAS_REJECTED_NOTE]);
  assertNoBranchLengthNote(result);
});

test("93. a 513-code-unit branch is not normalized before the length check", () => {
  const source = FIXTURE_SINGLE_FOO;
  const branch = "e\u0301".repeat(256) + "x";
  assert.equal(branch.length, 513);
  assert.equal(branch.normalize("NFC").length <= 512, true);
  const parts = fullBindingParts(source);
  const snapshot = {
    ...parts.snapshot,
    revision: { ...parts.snapshot.revision, branch }
  };
  const sourceBytes = Buffer.from(source, "utf8");
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  }));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [BRANCH_NOTE]);
});

const RETAINED_MATCH_NOTE = "retained match ceiling was reached";

function repeatedSameNameFoo(count) {
  return Array.from({ length: count }, () => "export function foo() { return 1; }").join("\n") + "\n";
}

function resolveRepeatedFoo(count) {
  const source = repeatedSameNameFoo(count);
  return resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256: sha256Text(source) },
    task: { id: SYNTHETIC_TASK_ID, paths: [SYNTHETIC_PATH] },
    project: {
      projectId: SYNTHETIC_PROJECT_ID,
      rootId: SYNTHETIC_ROOT_ID,
      relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
    },
    query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN },
    limits: { compactBytes: 131072 }
  });
}

function containsNumber(value, target) {
  if (typeof value === "number") return value === target;
  if (Array.isArray(value)) return value.some((item) => containsNumber(item, target));
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => containsNumber(item, target));
  }
  return false;
}

test("94. 256 qualifying matches stay ambiguous with complete enumeration", () => {
  const result = resolveRepeatedFoo(256);

  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.census, 256);
  assert.equal(result.occurrences.length, 256);
  assert.equal(result.completeness.enumeration, "complete");
  assert.equal(result.pathRecords.length, 1);
  assert.equal(result.pathRecords[0].matched, 256);
  assert.equal(result.notes.includes(RETAINED_MATCH_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assert.equal(result.occurrences[0].range.start < result.occurrences[255].range.start, true);
});

test("95. the 257th qualifying match stops retention at 256 with a lower bound", () => {
  const result = resolveRepeatedFoo(257);

  assert.equal(result.status, "ambiguous");
  assert.notEqual(result.status, "resolved_unique");
  assert.equal(result.census, 256);
  assert.equal(result.occurrences.length, 256);
  assert.equal(result.completeness.enumeration, "partial");
  assert.notEqual(result.completeness.output, "complete");
  assert.equal(result.counts.retained, 256);
  assert.equal(result.counts.matchedLowerBound, 256);
  assert.equal(result.counts.exactMatchCount, null);
  assert.equal(result.notes.includes(RETAINED_MATCH_NOTE), true);
  assert.equal(result.pathRecords.length, 1);
  assert.equal(result.pathRecords[0].matched, 256);
  assert.equal(containsNumber(result, 257), false);
  assert.equal(result.notes.some((note) => note.includes("257")), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assert.equal(result.occurrences[0].range.start < result.occurrences[255].range.start, true);
});

test('96. matchedLowerBound contract resolved_unique', () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, 'resolved_unique');
  assert.equal(result.counts.exactMatchCount, 1);
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 1,
    matchedLowerBound: 1,
    exactMatchCount: 1
  });
});

test('97. matchedLowerBound contract 257 ceiling', () => {
  const result = resolveRepeatedFoo(257);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.census, 256);
  assert.equal(result.completeness.enumeration, 'partial');
  assert.equal(result.notes.includes(RETAINED_MATCH_NOTE), true);
  assert.equal(containsNumber(result, 257), false);
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 256,
    matchedLowerBound: 256,
    exactMatchCount: null
  });
  assert.deepEqual(Object.keys(result.counts).sort(), [
    'exactMatchCount',
    'matchedLowerBound',
    'processed',
    'requested',
    'retained'
  ]);
});

test('98. matchedLowerBound contract 256 complete', () => {
  const result = resolveRepeatedFoo(256);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.completeness.enumeration, 'complete');
  assert.equal(result.notes.includes(RETAINED_MATCH_NOTE), false);
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 256,
    matchedLowerBound: 256,
    exactMatchCount: 256
  });
});

test('99. matchedLowerBound contract census 2', () => {
  const source = FIXTURE_TWO_TOP_LEVEL_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.census, 2);
  assert.equal(result.completeness.enumeration, 'complete');
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 2,
    matchedLowerBound: 2,
    exactMatchCount: 2
  });
});

test('100. matchedLowerBound contract destructure partial', () => {
  const source = FIXTURE_DIRECT_DESTRUCTURE_A;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, 'partial');
  assert.equal(result.census, 1);
  assert.notEqual(result.completeness.enumeration, 'complete');
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 1,
    matchedLowerBound: 1,
    exactMatchCount: null
  });
});

test('101. matchedLowerBound contract not_found', () => {
  const source = FIXTURE_NO_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, 'not_found');
  assert.deepEqual(result.counts, {
    requested: 1,
    processed: 1,
    retained: 0,
    matchedLowerBound: 0,
    exactMatchCount: 0
  });
});

test('102. matchedLowerBound contract pre-parse not_evaluated', () => {
  const result = resolveTrackA1({
    name: '',
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, 'utf8'),
    binding: { sourceSha256: sha256Text(FIXTURE_SINGLE_FOO) }
  });
  assert.equal(result.status, 'not_evaluated');
  assert.equal(Object.hasOwn(result, 'counts'), false);
});

test('103. matchedLowerBound contract partial enumeration complete', () => {
  const ordered = [
    [PATH_A, FIXTURE_TRUNCATED],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);
  assert.equal(result.status, 'partial');
  assert.equal(result.completeness.enumeration, 'complete');
  assert.equal(result.counts.requested, 2);
  assert.equal(result.counts.processed, 2);
  assert.equal(result.counts.matchedLowerBound, result.counts.retained);
  assert.equal(result.counts.exactMatchCount, result.counts.retained);
  assert.equal(result.counts.matchedLowerBound, result.census);
  assert.deepEqual(Object.keys(result.counts).sort(), [
    'exactMatchCount',
    'matchedLowerBound',
    'processed',
    'requested',
    'retained'
  ]);
});

const NESTING_NOTE = "nesting exceeds 32";

function assertNoNestingNote(result) {
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(NESTING_NOTE), false);
  assert.equal(JSON.stringify(result).includes(NESTING_NOTE), false);
}

function nestedPlainObjects(count) {
  let node = {};
  for (let i = 1; i < count; i += 1) node = { nested: node };
  return node;
}

function nestedPlainsEndingInArray(plainCount) {
  let node = [];
  for (let i = 0; i < plainCount; i += 1) node = { nested: node };
  return node;
}

function shallowNestedInput(chain) {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  return {
    source,
    parts,
    sourceBytes,
    input: {
      name: "foo",
      sourceBytes,
      binding: { sourceSha256: parts.sourceSha256 },
      snapshot: parts.snapshot,
      task: parts.task,
      project: parts.project,
      query: parts.query,
      nested: chain
    }
  };
}

test("104. a chain of 33 plain objects is not_evaluated before decode", () => {
  const { sourceBytes, input } = shallowNestedInput(nestedPlainObjects(32));
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [NESTING_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("105. a chain of 32 plain objects does not get the nesting note", () => {
  const { input } = shallowNestedInput(nestedPlainObjects(31));
  const result = resolveTrackA1(input);
  assert.equal(result.status, "resolved_unique");
  assertNoNestingNote(result);
});

test("106. an array counts as one nesting level", () => {
  const allowed = shallowNestedInput(nestedPlainsEndingInArray(30));
  const allowedResult = resolveTrackA1(allowed.input);
  assert.equal(allowedResult.status, "resolved_unique");
  assertNoNestingNote(allowedResult);

  const rejected = shallowNestedInput(nestedPlainsEndingInArray(31));
  const { result, decoded } = resolveWithoutDecode(
    [rejected.sourceBytes],
    () => resolveTrackA1(rejected.input)
  );
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.notes, [NESTING_NOTE]);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("107. a two-node cycle does not hang and does not get the nesting note", { timeout: 5000 }, () => {
  const left = {};
  const right = {};
  left.other = right;
  right.other = left;
  const { sourceBytes, input } = shallowNestedInput(left);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, ["cyclic input was rejected"]);
  assertNoNestingNote(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("108. a shallow request does not get the nesting note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "resolved_unique");
  assertNoNestingNote(result);
});

test("109. invalid compactBytes on input nested past 32 keeps the override note", () => {
  const { input } = shallowNestedInput(nestedPlainObjects(40));
  input.limits = { compactBytes: 0 };
  const result = resolveTrackA1(input);
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.notes.includes("compactBytes override was rejected"), true);
  assert.equal(result.notes.includes(NESTING_NOTE), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

const VISITED_JSON_VALUES_NOTE = "visited JSON values exceed 20000";

function objectWithNullFields(count) {
  const node = {};
  for (let i = 0; i < count; i += 1) node["n" + i] = null;
  return node;
}

function assertNoVisitedJsonValuesNote(result) {
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(VISITED_JSON_VALUES_NOTE), false);
  assert.equal(JSON.stringify(result).includes(VISITED_JSON_VALUES_NOTE), false);
}

test("110. a root plus 20000 null fields is not_evaluated before the buffer is decoded", () => {
  const sourceBytes = Buffer.from(FIXTURE_SINGLE_FOO, "utf8");
  const input = objectWithNullFields(20000);
  input.sourceBytes = sourceBytes;
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [VISITED_JSON_VALUES_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("111. a root plus 19999 null fields does not get the visited JSON values note", () => {
  const result = resolveTrackA1(objectWithNullFields(19999));
  assert.equal(result.status, "not_evaluated");
  assertNoVisitedJsonValuesNote(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("112. a repeated object reference is not double-counted", () => {
  const shared = objectWithNullFields(19998);
  const result = resolveTrackA1({ a: shared, b: shared });
  assertNoVisitedJsonValuesNote(result);
});

test("113. a two-node cycle does not hang and does not get the visited JSON values note", { timeout: 5000 }, () => {
  const left = {};
  const right = {};
  left.other = right;
  right.other = left;
  const { sourceBytes, input } = shallowNestedInput(left);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, ["cyclic input was rejected"]);
  assertNoVisitedJsonValuesNote(result);
  assertNoNestingNote(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("114. a chain of 33 plain objects keeps only the nesting note", () => {
  const { sourceBytes, input } = shallowNestedInput(nestedPlainObjects(32));
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NESTING_NOTE]);
  assertNoVisitedJsonValuesNote(result);
});

test("115. invalid compactBytes keeps the override note when 20000 null fields are also present", () => {
  const input = objectWithNullFields(20000);
  input.limits = { compactBytes: 0 };
  const result = resolveTrackA1(input);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, ["compactBytes override was rejected"]);
  assertNoVisitedJsonValuesNote(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("116. a shallow request does not get the visited JSON values note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "resolved_unique");
  assertNoVisitedJsonValuesNote(result);
});

const INSPECTED_ENTRY_NOTE = 'inspected entry ceiling was reached';
const USUAL_OTHER_LINE = 'export function other() { return 1; }\n';
const USUAL_FOO_LINE = 'export function foo() { return 1; }\n';

function chunkUsualFunctions(total, line) {
  const chunks = [];
  let remaining = total;
  let index = 0;
  while (remaining > 0) {
    let count = 0;
    let size = 0;
    while (count < remaining && size + line.length <= 131072) {
      size += line.length;
      count += 1;
    }
    chunks.push(['src/fn' + index + '.js', line.repeat(count)]);
    remaining -= count;
    index += 1;
  }
  return chunks;
}

test('117. 20001 top-level functions stop before the last foo', () => {
  const ordered = chunkUsualFunctions(20000, USUAL_OTHER_LINE);
  ordered.push(['src/fn-last.js', USUAL_FOO_LINE]);
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);

  assert.notEqual(result.status, 'resolved_unique');
  assert.equal(result.status, 'partial');
  assert.notEqual(result.status, 'not_found');
  assert.equal(result.census, 0);
  assert.equal(result.occurrences.some((item) => item.name === 'foo'), false);
  assert.equal(result.notes.includes(INSPECTED_ENTRY_NOTE), true);
  assert.equal(result.completeness.enumeration, 'partial');
  assert.notEqual(result.completeness.output, 'complete');
  assert.equal(result.counts.exactMatchCount, null);
  assert.equal(result.counts.matchedLowerBound, result.counts.retained);
  assert.equal(result.counts.processed, result.counts.requested);
  assert.equal(containsNumber(result, 20001), false);
});

test('118. exactly 20000 non-matching functions stay not_found without the inspected note', () => {
  const ordered = chunkUsualFunctions(20000, USUAL_OTHER_LINE);
  const parts = multiPathBinding(ordered);
  const result = resolveAcrossPaths(ordered, parts);

  assert.equal(result.status, 'not_found');
  assert.notEqual(result.status, 'partial');
  assert.equal(result.completeness.enumeration, 'complete');
  assert.equal(result.notes.includes(INSPECTED_ENTRY_NOTE), false);
  assert.equal(result.counts.exactMatchCount, 0);
  assert.equal(result.counts.matchedLowerBound, result.counts.retained);
  assert.equal(result.counts.processed, result.counts.requested);
  assert.equal(containsNumber(result, 20001), false);
});

function declaratorNames(count) {
  const first = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ' + String.fromCharCode(36) + '_';
  const rest = first + '0123456789';
  const names = [];
  const reserved = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'of', 'as', 'any', 'type', 'get', 'set', 'async', 'from', 'namespace', 'module', 'declare', 'abstract', 'readonly', 'require', 'constructor', 'number', 'string', 'boolean', 'symbol', 'undefined', 'never', 'unknown', 'object', 'asserts', 'infer', 'keyof', 'unique', 'is']);
  const push = (name) => {
    if (name === 'foo' || reserved.has(name)) return;
    names.push(name);
  };
  for (let i = 0; i < first.length; i += 1) push(first[i]);
  for (let i = 0; i < first.length && names.length < count; i += 1) {
    for (let j = 0; j < rest.length && names.length < count; j += 1) {
      push(first[i] + rest[j]);
    }
  }
  for (let i = 0; i < first.length && names.length < count; i += 1) {
    for (let j = 0; j < rest.length && names.length < count; j += 1) {
      for (let k = 0; k < rest.length && names.length < count; k += 1) {
        push(first[i] + rest[j] + rest[k]);
      }
    }
  }
  return names;
}

test('119. a 20000-declarator statement does not inspect the last foo', () => {
  const names = declaratorNames(19999);
  names.push('foo');
  const source = 'export const ' + names.map((name) => name + '=1').join(',') + ';\n';
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);

  assert.equal(result.status, 'partial');
  assert.notEqual(result.status, 'resolved_unique');
  assert.notEqual(result.status, 'not_found');
  assert.equal(result.census, 0);
  assert.equal(result.occurrences.some((item) => item.name === 'foo'), false);
  assert.equal(result.notes.includes(INSPECTED_ENTRY_NOTE), true);
  assert.equal(result.completeness.enumeration, 'partial');
  assert.equal(result.counts.exactMatchCount, null);
  assert.equal(result.counts.matchedLowerBound, result.counts.retained);
  assert.equal(containsNumber(result, 20001), false);
});

test('120. 257 top-level foo functions do not get the inspected entry note', () => {
  const result = resolveRepeatedFoo(257);

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.census, 256);
  assert.equal(result.notes.includes(RETAINED_MATCH_NOTE), true);
  assert.equal(result.notes.includes(INSPECTED_ENTRY_NOTE), false);
  assert.equal(containsNumber(result, 257), false);
});

test('121. retained and inspected ceilings both leave notes', () => {
  const lines = [];
  for (let index = 0; index < 256; index += 1) lines.push(USUAL_FOO_LINE);
  for (let index = 0; index < 19743; index += 1) lines.push(USUAL_OTHER_LINE);
  lines.push(USUAL_FOO_LINE);
  lines.push(USUAL_OTHER_LINE);
  const ordered = [];
  let fileIndex = 0;
  let buf = '';
  for (const line of lines) {
    if (buf.length + line.length > 131072) {
      ordered.push(['src/both' + fileIndex + '.js', buf]);
      fileIndex += 1;
      buf = '';
    }
    buf += line;
  }
  if (buf.length > 0) ordered.push(['src/both' + fileIndex + '.js', buf]);
  const texts = ordered.map((entry) => entry[1]);
  const result = resolveTrackA1({
    name: 'foo',
    files: ordered.map(([path, text]) => ({ path, sourceBytes: Buffer.from(text, 'utf8') })),
    binding: { sourceSha256: sha256Text(texts.join('')) },
    task: { id: SYNTHETIC_TASK_ID, paths: ordered.map((entry) => entry[0]) },
    project: {
      projectId: SYNTHETIC_PROJECT_ID,
      rootId: SYNTHETIC_ROOT_ID,
      relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
    },
    query: { name: 'foo', domain: SYMBOL_QUERY_DOMAIN },
    limits: { compactBytes: 131072 }
  });

  assert.equal(result.status, 'ambiguous');
  assert.equal(result.census, 256);
  assert.equal(result.occurrences.length, 256);
  assert.equal(result.notes.includes(RETAINED_MATCH_NOTE), true);
  assert.equal(result.notes.includes(INSPECTED_ENTRY_NOTE), true);
  assert.equal(result.completeness.enumeration, 'partial');
  assert.notEqual(result.completeness.output, 'complete');
  assert.equal(result.counts.exactMatchCount, null);
  assert.equal(result.counts.retained, 256);
  assert.equal(result.counts.matchedLowerBound, result.counts.retained);
  assert.equal(containsNumber(result, 20001), false);
});

const CYCLIC_INPUT_NOTE = 'cyclic input was rejected';

test('122. a self-referential object is not_evaluated before decode', { timeout: 5000 }, () => {
  const cycle = {};
  cycle.self = cycle;
  const { sourceBytes, input } = shallowNestedInput(cycle);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(result.status, 'not_evaluated');
  assert.equal(result.notes.includes(CYCLIC_INPUT_NOTE), true);
  assert.deepEqual(result.notes, [CYCLIC_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, 'pathRecords'), false);
  assert.equal(Object.hasOwn(result, 'limits'), false);
  assert.equal(Object.hasOwn(result, 'reasons'), false);
  assertContractIdentity(result);
});

test('123. an array that contains itself is not_evaluated before decode', { timeout: 5000 }, () => {
  const cycle = [];
  cycle.push(cycle);
  const { sourceBytes, input } = shallowNestedInput(cycle);
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(result.status, 'not_evaluated');
  assert.deepEqual(result.notes, [CYCLIC_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, 'pathRecords'), false);
  assert.equal(Object.hasOwn(result, 'limits'), false);
  assert.equal(Object.hasOwn(result, 'reasons'), false);
  assertContractIdentity(result);
});

test('124. a diamond shared child is not rejected as cyclic', () => {
  const child = {};
  const diamond = { left: child, right: child };
  const { input } = shallowNestedInput(diamond);
  const result = resolveTrackA1(input);

  assert.equal(result.status, 'resolved_unique');
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(CYCLIC_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, 'limits'), false);
  assert.equal(Object.hasOwn(result, 'reasons'), false);
  assertContractIdentity(result);
});

test('125. a depth-33 chain keeps only the nesting note', () => {
  const { sourceBytes, input } = shallowNestedInput(nestedPlainObjects(32));
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(result.status, 'not_evaluated');
  assert.deepEqual(result.notes, [NESTING_NOTE]);
  assert.equal(result.notes.includes(CYCLIC_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, 'pathRecords'), false);
  assert.equal(Object.hasOwn(result, 'limits'), false);
  assert.equal(Object.hasOwn(result, 'reasons'), false);
  assertContractIdentity(result);
});

const ACCESSOR_INPUT_NOTE = "accessor input was rejected";

test("126. a root own getter is not_evaluated before decode and does not invoke the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  Object.defineProperty(input, "trap", {
    enumerable: true,
    get() {
      getterCalled = true;
      return { harmless: true };
    }
  });
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.notes.includes(ACCESSOR_INPUT_NOTE), true);
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("127. a getter nested under task is not_evaluated before decode and does not invoke the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const task = {
    id: parts.task.id,
    paths: parts.task.paths.slice()
  };
  Object.defineProperty(task, "trap", {
    enumerable: true,
    get() {
      getterCalled = true;
      return { harmless: true };
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task,
    project: parts.project,
    query: parts.query
  };
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("128. a setter-only own property is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let setterCalled = false;
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  Object.defineProperty(input, "trap", {
    enumerable: true,
    set() {
      setterCalled = true;
    }
  });
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(setterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("129. an accessor on a task.paths array index is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const paths = parts.task.paths.slice();
  Object.defineProperty(paths, "0", {
    enumerable: true,
    configurable: true,
    get() {
      getterCalled = true;
      return SYNTHETIC_PATH;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: { id: parts.task.id, paths },
    project: parts.project,
    query: parts.query
  };
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input));

  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("130. a Buffer source leaf with an own getter is not_evaluated without invoking it", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let bufferGetterCalled = false;
  Object.defineProperty(sourceBytes, "trap", {
    enumerable: true,
    get() {
      bufferGetterCalled = true;
      return 1;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(bufferGetterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("131. a symbol-keyed accessor is ignored and evaluation proceeds", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  Object.defineProperty(input, Symbol("trap"), {
    enumerable: true,
    get() {
      getterCalled = true;
      return { harmless: true };
    }
  });
  const result = resolveTrackA1(input);

  assert.equal(getterCalled, false);
  assert.equal(result.status, "resolved_unique");
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(ACCESSOR_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("132. an own getter named limits is not_evaluated before decode and does not invoke the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  Object.defineProperty(input, "limits", {
    enumerable: true,
    get() {
      getterCalled = true;
      return { compactBytes: 131072 };
    }
  });
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("133. a getter named compactBytes under limits is not_evaluated before decode and does not invoke the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const limits = {};
  Object.defineProperty(limits, "compactBytes", {
    enumerable: true,
    get() {
      getterCalled = true;
      return 131072;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    limits
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("134. invalid data compactBytes with a providerNode getter is not_evaluated without invoking the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    limits: { compactBytes: 0 }
  };
  Object.defineProperty(input, "providerNode", {
    enumerable: true,
    get() {
      getterCalled = true;
      return { id: "provider-should-not-run" };
    }
  });
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("135. a providerNode getter alone is not_evaluated without invoking the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  Object.defineProperty(input, "providerNode", {
    enumerable: true,
    get() {
      getterCalled = true;
      return { id: "provider-should-not-run" };
    }
  });
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("136. a providerNode getter with a depth-33 chain reached first does not invoke the getter", () => {
  const { sourceBytes, input } = shallowNestedInput(nestedPlainObjects(32));
  let getterCalled = false;
  Object.defineProperty(input, "providerNode", {
    enumerable: true,
    get() {
      getterCalled = true;
      return { id: "provider-should-not-run" };
    }
  });
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Array.isArray(result.notes), true);
  assert.equal(result.notes.length, 1);
  assert.equal(
    result.notes[0] === ACCESSOR_INPUT_NOTE || result.notes[0] === NESTING_NOTE,
    true
  );
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("137. a providerNode getter with a cycle reached first does not invoke the getter", () => {
  const left = {};
  const right = {};
  left.other = right;
  right.other = left;
  const { sourceBytes, input } = shallowNestedInput(left);
  let getterCalled = false;
  Object.defineProperty(input, "providerNode", {
    enumerable: true,
    get() {
      getterCalled = true;
      return { id: "provider-should-not-run" };
    }
  });
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Array.isArray(result.notes), true);
  assert.equal(result.notes.length, 1);
  assert.equal(
    result.notes[0] === ACCESSOR_INPUT_NOTE || result.notes[0] === CYCLIC_INPUT_NOTE,
    true
  );
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("138. a data providerNode with an id getter is not_evaluated without invoking the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const providerNode = {};
  Object.defineProperty(providerNode, "id", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "provider-id-should-not-run";
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    providerNode
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("139. invalid compactBytes with a providerNode id getter keeps the override note without invoking the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  const providerNode = {};
  Object.defineProperty(providerNode, "id", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "provider-id-should-not-run";
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    limits: { compactBytes: 0 },
    providerNode
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }

  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, ["compactBytes override was rejected"]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

const NON_PLAIN_INPUT_NOTE = "non-plain input was rejected";
const NAME_WAS_REJECTED_NOTE = "name was rejected";
const SOURCE_BYTES_WERE_REJECTED_NOTE = "source bytes were rejected";
const SOURCE_HASH_BINDING_WAS_REJECTED_NOTE = "source hash binding was rejected";
const TASK_PATHS_WERE_REJECTED_NOTE = "task paths were rejected";
const SNAPSHOT_WAS_REJECTED_NOTE = "snapshot was rejected";
const SOURCE_DID_NOT_ROUND_TRIP_NOTE = "source did not round-trip through the parser";
const TASK_PATH_COUNT_EXCEEDS_32_NOTE = "task path count exceeds 32";
const FILES_WERE_REJECTED_NOTE = "files were rejected";
const QUERY_DOMAIN_IS_NOT_SUPPORTED_NOTE = "query domain is not supported";
const QUERY_NAME_DOES_NOT_MATCH_NAME_NOTE = "query name does not match name";

function assertNonPlainRejection(result, decoded, threw) {
  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
}

test("140. a class-instance root is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  class TrackA1Root {}
  const input = new TrackA1Root();
  Object.assign(input, {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("141. a class instance under task with an own getter is not_evaluated without invoking the getter", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  class Box {}
  const box = new Box();
  Object.defineProperty(box, "trap", {
    enumerable: true,
    get() {
      getterCalled = true;
      return 1;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: { id: parts.task.id, paths: parts.task.paths.slice(), box },
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(getterCalled, false);
  assertNonPlainRejection(result, decoded, threw);
});

test("142. a Date under query is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: { name: "foo", domain: parts.query.domain, when: new Date(0) }
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("143. a Map value is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    bag: new Map()
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("144. a function value is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let fnCalled = false;
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    cb() {
      fnCalled = true;
    }
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(fnCalled, false);
  assertNonPlainRejection(result, decoded, threw);
});

test("145. a bigint value is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    n: 1n
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("146. a non-plain object with toJSON is not_evaluated without calling toJSON", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let toJsonCalled = false;
  class WithToJson {
    toJSON() {
      toJsonCalled = true;
      return { ok: true };
    }
  }
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    payload: new WithToJson()
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(toJsonCalled, false);
  assertNonPlainRejection(result, decoded, threw);
});

test("147. a plain object with a toJSON function data property is not_evaluated without calling toJSON", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let toJsonCalled = false;
  const payload = {
    toJSON() {
      toJsonCalled = true;
      return { ok: true };
    }
  };
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    payload
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(toJsonCalled, false);
  assertNonPlainRejection(result, decoded, threw);
});

test("148. a Buffer under files remains accepted and evaluates as before", () => {
  const ordered = [
    ["src/a.js", FIXTURE_SINGLE_FOO],
    ["src/b.js", "export function other() { return 2; }\n"]
  ];
  const parts = multiPathBinding(ordered);
  assert.equal(Buffer.isBuffer(parts.files[0].sourceBytes), true);
  assert.equal(Buffer.isBuffer(parts.files[1].sourceBytes), true);
  const result = resolveAcrossPaths(ordered, parts);
  assert.equal(result.status, "resolved_unique");
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(NON_PLAIN_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("149. the first offending own key wins between accessor and non-plain", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");

  let accessorFirstCalled = false;
  const accessorFirst = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  Object.defineProperty(accessorFirst, "trap", {
    enumerable: true,
    get() {
      accessorFirstCalled = true;
      return 1;
    }
  });
  accessorFirst.later = new Date(0);
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(accessorFirst)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(accessorFirstCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);

  let nonPlainFirstCalled = false;
  const nonPlainFirst = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    a: new Date(0)
  };
  Object.defineProperty(nonPlainFirst, "b", {
    enumerable: true,
    get() {
      nonPlainFirstCalled = true;
      return 1;
    }
  });
  threw = false;
  decoded = true;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(nonPlainFirst)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(nonPlainFirstCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("150. Object.create(Buffer.prototype) under sourceBytes is not_evaluated without invoking byteLength", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  let byteLengthCalled = false;
  const fake = Object.create(Buffer.prototype);
  Object.defineProperty(fake, "byteLength", {
    enumerable: true,
    get() {
      byteLengthCalled = true;
      return realBytes.byteLength;
    }
  });
  const input = {
    name: "foo",
    sourceBytes: fake,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(byteLengthCalled, false);
  assertNonPlainRejection(result, decoded, threw);
});

test("151. a Uint8Array subclass instance is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  class SubBuffer extends Uint8Array {}
  const subclass = Object.setPrototypeOf(Buffer.from(source, "utf8"), SubBuffer.prototype);
  const input = {
    name: "foo",
    sourceBytes: subclass,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("152. class X extends Array under task.paths is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  class PathList extends Array {}
  const paths = new PathList();
  paths.push(parts.task.paths[0]);
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: { id: parts.task.id, paths },
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("153. an array with a changed prototype is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const paths = parts.task.paths.slice();
  Object.setPrototypeOf(paths, Object.prototype);
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: { id: parts.task.id, paths },
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("154. a Float64Array is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    samples: new Float64Array([1, 2])
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("155. a DataView is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    view: new DataView(new ArrayBuffer(8))
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("156. a null root is not_evaluated without throwing", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1(null);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("157. an undefined root is not_evaluated without throwing", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1(undefined);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("158. a null-prototype nested object is accepted without the non-plain note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const query = Object.assign(Object.create(null), {
    name: "foo",
    domain: parts.query.domain
  });
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(source, "utf8"),
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query
  });
  assert.equal(result.status, "resolved_unique");
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(NON_PLAIN_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("159. a symbol value is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    tag: Symbol("x")
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("160. a boxed primitive is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    boxed: new String("x")
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("161. a Uint8Array sourceBytes is accepted when the body already accepts it", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Uint8Array.from(Buffer.from(source, "utf8"));
  assert.equal(Object.getPrototypeOf(sourceBytes), Uint8Array.prototype);
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  assert.equal(result.status, "resolved_unique");
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(NON_PLAIN_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("162. a DataView with prototype swapped to Uint8Array.prototype is not_evaluated without throwing", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  const fake = new DataView(new ArrayBuffer(8));
  Object.setPrototypeOf(fake, Uint8Array.prototype);
  const input = {
    name: "foo",
    sourceBytes: fake,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("163. a DataView with prototype swapped to Buffer.prototype is not_evaluated without throwing", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  const fake = new DataView(new ArrayBuffer(8));
  Object.setPrototypeOf(fake, Buffer.prototype);
  const input = {
    name: "foo",
    sourceBytes: fake,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("164. a Float32Array with prototype swapped to Buffer.prototype is not_evaluated without throwing", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  const fake = new Float32Array([1, 2, 3, 4]);
  Object.setPrototypeOf(fake, Buffer.prototype);
  const input = {
    name: "foo",
    sourceBytes: fake,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("165. a Float32Array with prototype swapped to Uint8Array.prototype is not_evaluated without throwing", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  const fake = new Float32Array([1, 2, 3, 4]);
  Object.setPrototypeOf(fake, Uint8Array.prototype);
  const input = {
    name: "foo",
    sourceBytes: fake,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("166. a real Buffer subclass prototype chain is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  const SubBufferProto = Object.create(Buffer.prototype);
  const subclass = Object.setPrototypeOf(Buffer.from(source, "utf8"), SubBufferProto);
  const input = {
    name: "foo",
    sourceBytes: subclass,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("167. Object.create(Uint8Array.prototype) is not_evaluated without throwing", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const realBytes = Buffer.from(source, "utf8");
  const fake = Object.create(Uint8Array.prototype);
  const input = {
    name: "foo",
    sourceBytes: fake,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([realBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("168. a primitive string root is not_evaluated without throwing", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1("not-an-object");
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("169. a null-prototype root with otherwise valid input evaluates without the non-plain note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = Object.assign(Object.create(null), {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  const result = resolveTrackA1(input);
  assert.equal(result.status, "resolved_unique");
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(NON_PLAIN_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("170. a symbol-keyed non-plain data value is not_evaluated before decode", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  input[Symbol("x")] = new Date(0);
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assertNonPlainRejection(result, decoded, threw);
});

test("171. a Buffer sourceBytes with an own byteLength getter is not_evaluated without invoking it", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  Object.defineProperty(sourceBytes, "byteLength", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled = true;
      return source.length;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("172. a Uint8Array sourceBytes with an own length getter is not_evaluated without invoking it", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Uint8Array.from(Buffer.from(source, "utf8"));
  let getterCalled = false;
  Object.defineProperty(sourceBytes, "length", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled = true;
      return source.length;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([Buffer.from(source, "utf8")], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("173. a Buffer with an own toString getter is not_evaluated without invoking it", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let getterCalled = false;
  Object.defineProperty(sourceBytes, "toString", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled = true;
      return Buffer.prototype.toString;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  };
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1(input)));
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("174. a Buffer under files with an own byteLength getter is not_evaluated without invoking it", () => {
  const ordered = [
    ["src/a.js", FIXTURE_SINGLE_FOO],
    ["src/b.js", "export function other() { return 2; }\n"]
  ];
  const parts = multiPathBinding(ordered);
  const leaf = parts.files[0].sourceBytes;
  let getterCalled = false;
  Object.defineProperty(leaf, "byteLength", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled = true;
      return Buffer.byteLength(ordered[0][1], "utf8");
    }
  });
  let threw = false;
  let decoded = true;
  let result;
  try {
    ({ result, decoded } = resolveWithoutDecode(
      parts.files.map((file) => file.sourceBytes),
      () => resolveAcrossPaths(ordered, parts)
    ));
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(decoded, false);
  assert.equal(getterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("175. a Buffer with an own data property still evaluates without the accessor note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  Object.defineProperty(sourceBytes, "tag", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: "meta"
  });
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  assert.equal(result.status, "resolved_unique");
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(ACCESSOR_INPUT_NOTE), false);
  assert.equal(Object.hasOwn(result, "limits"), false);
  assert.equal(Object.hasOwn(result, "reasons"), false);
  assertContractIdentity(result);
});

test("176. an oversized Buffer with an own byteLength getter matches plain oversized without invoking the getter", () => {
  const size = PER_FILE_BYTE_CEILING + 1;
  const plain = Buffer.alloc(size, 0x61);
  const withGetter = Buffer.alloc(size, 0x61);
  let getterCalled = false;
  Object.defineProperty(withGetter, "byteLength", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled = true;
      return size;
    }
  });
  const sourceSha256 = sha256Text(plain.toString("utf8"));
  const base = fullBindingParts(FIXTURE_SINGLE_FOO);
  function run(sourceBytes) {
    return resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256 },
      snapshot: {
        projectId: base.snapshot.projectId,
        path: base.snapshot.path,
        sourceSha256,
        byteSize: size,
        revision: base.snapshot.revision,
        token: base.snapshot.token
      },
      task: base.task,
      project: base.project,
      query: base.query
    });
  }
  const plainResult = run(plain);
  const guardedResult = run(withGetter);

  assert.equal(getterCalled, false);
  assert.deepEqual(guardedResult, plainResult);
  assert.equal(plainResult.status, "not_evaluated");
  assert.equal(Object.hasOwn(plainResult, "pathRecords"), false);
  assert.equal(Array.isArray(plainResult.notes), true);
  assert.equal(plainResult.notes.some((note) => note.includes("byte ceiling")), true);
  assert.equal(Object.hasOwn(plainResult, "limits"), false);
  assert.equal(Object.hasOwn(plainResult, "reasons"), false);
  assertContractIdentity(plainResult);
});

test("177. Object.getOwnPropertyNames is not called on an 8 MiB Buffer leaf during resolveTrackA1", () => {
  const size = 8 * 1024 * 1024;
  const leaf = Buffer.alloc(size, 0x20);
  const sourceSha256 = sha256Text(leaf.toString("utf8"));
  const base = fullBindingParts(FIXTURE_SINGLE_FOO);
  const input = {
    name: "foo",
    sourceBytes: leaf,
    binding: { sourceSha256 },
    snapshot: {
      projectId: base.snapshot.projectId,
      path: base.snapshot.path,
      sourceSha256,
      byteSize: size,
      revision: base.snapshot.revision,
      token: base.snapshot.token
    },
    task: base.task,
    project: base.project,
    query: base.query
  };
  const original = Object.getOwnPropertyNames;
  const seen = [];
  Object.getOwnPropertyNames = function spyGetOwnPropertyNames(value) {
    seen.push(value);
    return original(value);
  };
  let result;
  try {
    result = resolveTrackA1(input);
  } finally {
    Object.getOwnPropertyNames = original;
  }

  assert.equal(seen.includes(leaf), false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(result.notes.some((note) => note.includes("byte ceiling")), true);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

function oversizedUint8Array(size, fill = 0x61) {
  const leaf = new Uint8Array(size);
  leaf.fill(fill);
  return leaf;
}

function runSingleOversized(sourceBytes, size, sourceSha256) {
  const base = fullBindingParts(FIXTURE_SINGLE_FOO);
  return resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256 },
    snapshot: {
      projectId: base.snapshot.projectId,
      path: base.snapshot.path,
      sourceSha256,
      byteSize: size,
      revision: base.snapshot.revision,
      token: base.snapshot.token
    },
    task: base.task,
    project: base.project,
    query: base.query
  });
}

test("178. oversized Uint8Array with own length getter on the single path matches clean ceiling", () => {
  const size = PER_FILE_BYTE_CEILING + 1;
  const plain = oversizedUint8Array(size);
  const withGetter = oversizedUint8Array(size);
  let getterCalled = 0;
  Object.defineProperty(withGetter, "length", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return size;
    }
  });
  const sourceSha256 = sha256Text(Buffer.from(plain).toString("utf8"));
  let threw = false;
  let plainResult;
  let guardedResult;
  try {
    plainResult = runSingleOversized(plain, size, sourceSha256);
    guardedResult = runSingleOversized(withGetter, size, sourceSha256);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(getterCalled, 0);
  assert.deepEqual(guardedResult, plainResult);
  assert.equal(plainResult.status, "not_evaluated");
  assert.equal(plainResult.notes.some((note) => note.includes("byte ceiling")), true);
  assert.equal(Object.hasOwn(plainResult, "pathRecords"), false);
});

test("179. oversized Uint8Array with own length getter on the multi path matches clean ceiling", () => {
  const size = PER_FILE_BYTE_CEILING + 1;
  const plain = oversizedUint8Array(size, 0x20);
  const withGetter = oversizedUint8Array(size, 0x20);
  let getterCalled = 0;
  Object.defineProperty(withGetter, "length", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return size;
    }
  });
  const small = Buffer.from(FIXTURE_SINGLE_FOO, "utf8");
  function run(oversize) {
    return resolveTrackA1({
      name: "foo",
      files: [
        { path: PATH_A, sourceBytes: small },
        { path: PATH_B, sourceBytes: oversize }
      ],
      binding: { sourceSha256: "a".repeat(64) },
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  }
  let threw = false;
  let plainResult;
  let guardedResult;
  try {
    plainResult = run(plain);
    guardedResult = run(withGetter);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(getterCalled, 0);
  assert.deepEqual(guardedResult, plainResult);
  assert.equal(plainResult.status, "not_evaluated");
  assert.equal(plainResult.notes.some((note) => note.includes("byte ceiling")), true);
  assert.equal(Object.hasOwn(plainResult, "pathRecords"), false);
});

test("180. oversized Uint8Array with own valueOf getter matches clean ceiling without invoking", () => {
  const size = PER_FILE_BYTE_CEILING + 1;
  const plain = oversizedUint8Array(size);
  const withGetter = oversizedUint8Array(size);
  let getterCalled = 0;
  Object.defineProperty(withGetter, "valueOf", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return () => size;
    }
  });
  const sourceSha256 = sha256Text(Buffer.from(plain).toString("utf8"));
  let threw = false;
  let plainResult;
  let guardedResult;
  try {
    plainResult = runSingleOversized(plain, size, sourceSha256);
    guardedResult = runSingleOversized(withGetter, size, sourceSha256);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(getterCalled, 0);
  assert.deepEqual(guardedResult, plainResult);
  assert.equal(plainResult.notes.some((note) => note.includes("byte ceiling")), true);
});

test("181. a leaf at or under the ceiling with own data toString equals clean and is never called", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const clean = Buffer.from(source, "utf8");
  const shadowed = Buffer.from(source, "utf8");
  let toStringCalled = 0;
  Object.defineProperty(shadowed, "toString", {
    configurable: true,
    enumerable: true,
    writable: true,
    value() {
      toStringCalled += 1;
      return "export function evil() { return 0; }\n";
    }
  });
  const cleanResult = resolveTrackA1({
    name: "foo",
    sourceBytes: clean,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  const shadowedResult = resolveTrackA1({
    name: "foo",
    sourceBytes: shadowed,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  assert.equal(toStringCalled, 0);
  assert.deepEqual(shadowedResult, cleanResult);
  assert.equal(cleanResult.status, "resolved_unique");
});

test("182. a Uint8Array with own data length equals clean without throwing", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const clean = Uint8Array.from(Buffer.from(source, "utf8"));
  const shadowed = Uint8Array.from(Buffer.from(source, "utf8"));
  Object.defineProperty(shadowed, "length", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: 1
  });
  let threw = false;
  let cleanResult;
  let shadowedResult;
  try {
    cleanResult = resolveTrackA1({
      name: "foo",
      sourceBytes: clean,
      binding: { sourceSha256: parts.sourceSha256 },
      snapshot: parts.snapshot,
      task: parts.task,
      project: parts.project,
      query: parts.query
    });
    shadowedResult = resolveTrackA1({
      name: "foo",
      sourceBytes: shadowed,
      binding: { sourceSha256: parts.sourceSha256 },
      snapshot: parts.snapshot,
      task: parts.task,
      project: parts.project,
      query: parts.query
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.deepEqual(shadowedResult, cleanResult);
  assert.equal(cleanResult.status, "resolved_unique");
});

test("183. a setter-only accessor on a byte leaf is not_evaluated", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  let setterCalled = false;
  Object.defineProperty(sourceBytes, "trap", {
    configurable: true,
    enumerable: true,
    set() {
      setterCalled = true;
    }
  });
  const { result, decoded } = resolveWithoutDecode([sourceBytes], () => resolveTrackA1({
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  }));
  assert.equal(decoded, false);
  assert.equal(setterCalled, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [ACCESSOR_INPUT_NOTE]);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("184. a symbol-key accessor on a byte leaf is skipped and equals clean", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const clean = Buffer.from(source, "utf8");
  const withSym = Buffer.from(source, "utf8");
  let getterCalled = false;
  Object.defineProperty(withSym, Symbol("trap"), {
    enumerable: true,
    get() {
      getterCalled = true;
      return 1;
    }
  });
  const cleanResult = resolveTrackA1({
    name: "foo",
    sourceBytes: clean,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  const symResult = resolveTrackA1({
    name: "foo",
    sourceBytes: withSym,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  assert.equal(getterCalled, false);
  assert.deepEqual(symResult, cleanResult);
  assert.equal(cleanResult.status, "resolved_unique");
});

test("185. one thousand references to one leaf scan Object.getOwnPropertyNames once", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const leaf = Buffer.from(source, "utf8");
  Object.defineProperty(leaf, "meta", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: "x"
  });
  const refs = [];
  for (let i = 0; i < 1000; i += 1) refs.push(leaf);
  const input = {
    name: "foo",
    sourceBytes: leaf,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    nested: refs
  };
  const original = Object.getOwnPropertyNames;
  let leafCalls = 0;
  Object.getOwnPropertyNames = function spyGetOwnPropertyNames(value) {
    if (value === leaf) leafCalls += 1;
    return original(value);
  };
  let result;
  try {
    result = resolveTrackA1(input);
  } finally {
    Object.getOwnPropertyNames = original;
  }
  assert.equal(leafCalls, 1);
  assert.equal(result.status, "resolved_unique");
  const notes = Array.isArray(result.notes) ? result.notes : [];
  assert.equal(notes.includes(ACCESSOR_INPUT_NOTE), false);
});

test("186. single-path detached Uint8Array equals empty Buffer without throwing", () => {
  const emptySha = sha256Text("");
  const empty = Buffer.alloc(0);
  const ab = new ArrayBuffer(8);
  const detached = new Uint8Array(ab);
  ab.transfer();
  function run(sourceBytes) {
    return resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256: emptySha },
      task: { id: SYNTHETIC_TASK_ID, paths: [SYNTHETIC_PATH] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  }
  let threw = false;
  let emptyResult;
  let detachedResult;
  try {
    emptyResult = run(empty);
    detachedResult = run(detached);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.deepEqual(detachedResult, emptyResult);
  assert.equal(emptyResult.status, "not_evaluated");
});

test("187. single-path detached Buffer equals empty Buffer without throwing", () => {
  const emptySha = sha256Text("");
  const empty = Buffer.alloc(0);
  const ab = new ArrayBuffer(8);
  const detached = Buffer.from(ab);
  ab.transfer();
  function run(sourceBytes) {
    return resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256: emptySha },
      task: { id: SYNTHETIC_TASK_ID, paths: [SYNTHETIC_PATH] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  }
  let threw = false;
  let emptyResult;
  let detachedResult;
  try {
    emptyResult = run(empty);
    detachedResult = run(detached);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.deepEqual(detachedResult, emptyResult);
  assert.equal(emptyResult.status, "not_evaluated");
});

test("188. multi-path detached Uint8Array is not_evaluated without throwing", () => {
  const ab = new ArrayBuffer(8);
  const detached = new Uint8Array(ab);
  ab.transfer();
  const other = Buffer.from(FILE_B_OTHER, "utf8");
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      files: [
        { path: PATH_A, sourceBytes: detached },
        { path: PATH_B, sourceBytes: other }
      ],
      binding: { sourceSha256: "a".repeat(64) },
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.deepEqual(result.completeness, {
    source: "not_evaluated",
    parse: "not_evaluated",
    enumeration: "not_evaluated",
    output: "not_evaluated"
  });
});

test("189. multi-path detached Buffer matches detached Uint8Array without throwing", () => {
  const abU8 = new ArrayBuffer(8);
  const detachedU8 = new Uint8Array(abU8);
  abU8.transfer();
  const abBuf = new ArrayBuffer(8);
  const detachedBuf = Buffer.from(abBuf);
  abBuf.transfer();
  const other = Buffer.from(FILE_B_OTHER, "utf8");
  function run(leaf) {
    return resolveTrackA1({
      name: "foo",
      files: [
        { path: PATH_A, sourceBytes: leaf },
        { path: PATH_B, sourceBytes: other }
      ],
      binding: { sourceSha256: "a".repeat(64) },
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  }
  let threw = false;
  let u8Result;
  let bufResult;
  try {
    u8Result = run(detachedU8);
    bufResult = run(detachedBuf);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.deepEqual(bufResult, u8Result);
  assert.equal(u8Result.status, "not_evaluated");
  assert.deepEqual(u8Result.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
});

test("190. resizable ArrayBuffer view shrunk below offset equals empty on single and multi paths", () => {
  const emptySha = sha256Text("");
  function makeShrunk() {
    const rab = new ArrayBuffer(8, { maxByteLength: 64 });
    const view = new Uint8Array(rab, 4, 2);
    rab.resize(2);
    return view;
  }
  const empty = Buffer.alloc(0);
  function runSingle(sourceBytes) {
    return resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256: emptySha },
      task: { id: SYNTHETIC_TASK_ID, paths: [SYNTHETIC_PATH] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  }
  const other = Buffer.from(FILE_B_OTHER, "utf8");
  function runMulti(leaf) {
    return resolveTrackA1({
      name: "foo",
      files: [
        { path: PATH_A, sourceBytes: leaf },
        { path: PATH_B, sourceBytes: other }
      ],
      binding: { sourceSha256: "a".repeat(64) },
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  }
  let threw = false;
  let singleEmpty;
  let singleShrunk;
  let multiEmpty;
  let multiShrunk;
  try {
    singleEmpty = runSingle(empty);
    singleShrunk = runSingle(makeShrunk());
    multiEmpty = runMulti(Buffer.alloc(0));
    multiShrunk = runMulti(makeShrunk());
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.deepEqual(singleShrunk, singleEmpty);
  assert.deepEqual(multiShrunk, multiEmpty);
  assert.equal(singleEmpty.status, "not_evaluated");
  assert.equal(multiEmpty.status, "not_evaluated");
});

test("191. own data valueOf on a leaf is never called and equals clean", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const clean = Buffer.from(source, "utf8");
  const shadowed = Buffer.from(source, "utf8");
  let valueOfCalled = 0;
  Object.defineProperty(shadowed, "valueOf", {
    configurable: true,
    enumerable: true,
    writable: true,
    value() {
      valueOfCalled += 1;
      return 0;
    }
  });
  const cleanResult = resolveTrackA1({
    name: "foo",
    sourceBytes: clean,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  const shadowedResult = resolveTrackA1({
    name: "foo",
    sourceBytes: shadowed,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  assert.equal(valueOfCalled, 0);
  assert.deepEqual(shadowedResult, cleanResult);
  assert.equal(cleanResult.status, "resolved_unique");
});

test("192. multi-path own data toString shadow is never called and equals clean", () => {
  const ordered = [
    [PATH_A, FIXTURE_SINGLE_FOO],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered);
  const cleanFiles = parts.files.map((file) => ({
    path: file.path,
    sourceBytes: Buffer.from(file.sourceBytes)
  }));
  const shadowedFiles = parts.files.map((file) => ({
    path: file.path,
    sourceBytes: Buffer.from(file.sourceBytes)
  }));
  let toStringCalled = 0;
  Object.defineProperty(shadowedFiles[0].sourceBytes, "toString", {
    configurable: true,
    enumerable: true,
    writable: true,
    value() {
      toStringCalled += 1;
      return "export function evil() { return 0; }\n";
    }
  });
  const cleanResult = resolveTrackA1({
    name: "foo",
    files: cleanFiles,
    binding: { sourceSha256: parts.combinedSha },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  const shadowedResult = resolveTrackA1({
    name: "foo",
    files: shadowedFiles,
    binding: { sourceSha256: parts.combinedSha },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query
  });
  assert.equal(toStringCalled, 0);
  assert.deepEqual(shadowedResult, cleanResult);
  assert.equal(cleanResult.status, "resolved_unique");
});

test("193. object parent leaf-with-accessor then Date yields non-plain note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const leaf = Buffer.from(source, "utf8");
  let getterCalled = 0;
  Object.defineProperty(leaf, "trap", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return 1;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    nest: { a: leaf, b: new Date(0) }
  };
  const result = resolveTrackA1(input);
  assert.equal(getterCalled, 0);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
});

test("194. object parent Date then leaf-with-accessor yields non-plain note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const leaf = Buffer.from(source, "utf8");
  let getterCalled = 0;
  Object.defineProperty(leaf, "trap", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return 1;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    nest: { a: new Date(0), b: leaf }
  };
  const result = resolveTrackA1(input);
  assert.equal(getterCalled, 0);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
});

test("195. object parent leaf-with-accessor then accessor-object matches two-object-child control", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  function run(nest) {
    return resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256: parts.sourceSha256 },
      snapshot: parts.snapshot,
      task: parts.task,
      project: parts.project,
      query: parts.query,
      nest
    });
  }
  const controlTwoAccessors = run({
    a: { get yy() { return 1; } },
    b: { get zz() { return 1; } }
  });
  const controlAccessorThenDateChild = run({
    a: { get yy() { return 1; } },
    b: { x: new Date(0) }
  });
  // First-key child is visited first: both controls report accessor.
  assert.deepEqual(controlTwoAccessors.notes, [ACCESSOR_INPUT_NOTE]);
  assert.deepEqual(controlAccessorThenDateChild.notes, [ACCESSOR_INPUT_NOTE]);

  const leaf = Buffer.from(source, "utf8");
  let getterCalled = 0;
  Object.defineProperty(leaf, "trap", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return 1;
    }
  });
  const leafCase = run({
    a: leaf,
    b: { get zz() { return 1; } }
  });
  assert.equal(getterCalled, 0);
  assert.deepEqual(leafCase.notes, controlTwoAccessors.notes);
  assert.deepEqual(leafCase.notes, [ACCESSOR_INPUT_NOTE]);
});

test("196. array parent leaf-with-accessor then Date yields non-plain note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const leaf = Buffer.from(source, "utf8");
  let getterCalled = 0;
  Object.defineProperty(leaf, "trap", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return 1;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    nest: [leaf, new Date(0)]
  };
  const result = resolveTrackA1(input);
  assert.equal(getterCalled, 0);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
});

test("197. array parent Date then leaf-with-accessor yields non-plain note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  const leaf = Buffer.from(source, "utf8");
  let getterCalled = 0;
  Object.defineProperty(leaf, "trap", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return 1;
    }
  });
  const input = {
    name: "foo",
    sourceBytes,
    binding: { sourceSha256: parts.sourceSha256 },
    snapshot: parts.snapshot,
    task: parts.task,
    project: parts.project,
    query: parts.query,
    nest: [new Date(0), leaf]
  };
  const result = resolveTrackA1(input);
  assert.equal(getterCalled, 0);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NON_PLAIN_INPUT_NOTE]);
});

test("198. array parent leaf-with-accessor then accessor-object matches two-object-child control", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  const sourceBytes = Buffer.from(source, "utf8");
  function run(nest) {
    return resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256: parts.sourceSha256 },
      snapshot: parts.snapshot,
      task: parts.task,
      project: parts.project,
      query: parts.query,
      nest
    });
  }
  const controlTwoAccessors = run([
    { get yy() { return 1; } },
    { get zz() { return 1; } }
  ]);
  const controlAccessorThenDateChild = run([
    { get yy() { return 1; } },
    { x: new Date(0) }
  ]);
  assert.deepEqual(controlTwoAccessors.notes, [ACCESSOR_INPUT_NOTE]);
  assert.deepEqual(controlAccessorThenDateChild.notes, [ACCESSOR_INPUT_NOTE]);

  const leaf = Buffer.from(source, "utf8");
  let getterCalled = 0;
  Object.defineProperty(leaf, "trap", {
    configurable: true,
    enumerable: true,
    get() {
      getterCalled += 1;
      return 1;
    }
  });
  const leafCase = run([
    leaf,
    { get zz() { return 1; } }
  ]);
  assert.equal(getterCalled, 0);
  assert.deepEqual(leafCase.notes, controlTwoAccessors.notes);
  assert.deepEqual(leafCase.notes, [ACCESSOR_INPUT_NOTE]);
});

test("199. validation rejection not_evaluated stamps generatedAt null", () => {
  const result = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8")
  });
  assert.equal(result.status, "not_evaluated");
  assert.equal(Object.hasOwn(result, "generatedAt"), true);
  assert.equal(result.generatedAt, null);
});

test("200. ambiguous result stamps generatedAt null", () => {
  const source = FIXTURE_TWO_TOP_LEVEL_FOO;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "ambiguous");
  assert.equal(Object.hasOwn(result, "generatedAt"), true);
  assert.equal(result.generatedAt, null);
});

test("201. partial result stamps generatedAt null", () => {
  const source = FIXTURE_DIRECT_DESTRUCTURE_A;
  const parts = fullBindingParts(source);
  const result = resolveWithBinding(source, parts);
  assert.equal(result.status, "partial");
  assert.equal(Object.hasOwn(result, "generatedAt"), true);
  assert.equal(result.generatedAt, null);
});

test("202. empty name is not_evaluated with name was rejected", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "",
      sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
      binding: { sourceSha256: sha256Text(FIXTURE_SINGLE_FOO) }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NAME_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("203. bad sourceBytes is not_evaluated with source bytes were rejected", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes: 123,
      binding: { sourceSha256: "a".repeat(64) }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_BYTES_WERE_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("204. missing binding is not_evaluated with source hash binding was rejected", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8")
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("205. absolute task path is not_evaluated with task paths were rejected", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
      binding: { sourceSha256: sha256Text(FIXTURE_SINGLE_FOO) },
      task: { paths: ["/tmp/x.js"] }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [TASK_PATHS_WERE_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("206. snapshot shape failure is not_evaluated with snapshot was rejected", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(source, "utf8"),
      binding: { sourceSha256: parts.sourceSha256 },
      snapshot: { ...parts.snapshot, projectId: "" },
      task: parts.task,
      project: parts.project,
      query: parts.query
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SNAPSHOT_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("207. single-path BOM source is not_evaluated with parser round-trip note", () => {
  // ts-morph strips a leading UTF-8 BOM from getFullText, so decoded text
  // that still contains U+FEFF fails the round-trip check.
  const text = "\uFEFFexport function foo() { return 1; }\n";
  const sourceBytes = Buffer.from(text, "utf8");
  const sourceSha256 = sha256Text(text);
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256 },
      task: { id: SYNTHETIC_TASK_ID, paths: [SYNTHETIC_PATH] }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_DID_NOT_ROUND_TRIP_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), true);
  assertNativeTypescriptProvider(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("208. multi-path BOM source is not_evaluated with parser round-trip note", () => {
  const bomText = "\uFEFFexport function foo() { return 1; }\n";
  const otherText = FILE_B_OTHER;
  const fileA = Buffer.from(bomText, "utf8");
  const fileB = Buffer.from(otherText, "utf8");
  const combinedSha = sha256Text(bomText + otherText);
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      files: [
        { path: PATH_A, sourceBytes: fileA },
        { path: PATH_B, sourceBytes: fileB }
      ],
      binding: { sourceSha256: combinedSha },
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_DID_NOT_ROUND_TRIP_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), true);
  assertNativeTypescriptProvider(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("209. BOM source without task is not_evaluated with round-trip note and provider", () => {
  const text = "\uFEFFexport function foo() { return 1; }\n";
  const sourceBytes = Buffer.from(text, "utf8");
  const sourceSha256 = sha256Text(text);
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256 }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_DID_NOT_ROUND_TRIP_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), true);
  assertNativeTypescriptProvider(result);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("210. non-string name is not_evaluated with name was rejected", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: 42,
      sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
      binding: { sourceSha256: sha256Text(FIXTURE_SINGLE_FOO) }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [NAME_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("211. snapshot shape failure without task is not_evaluated with snapshot was rejected", () => {
  const source = FIXTURE_SINGLE_FOO;
  const sourceBytes = Buffer.from(source, "utf8");
  const sourceSha256 = sha256Text(source);
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256 },
      snapshot: {
        projectId: "",
        path: SYNTHETIC_PATH,
        sourceSha256,
        byteSize: sourceBytes.length,
        token: "token",
        revision: linkedRevision()
      }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SNAPSHOT_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("212. multi-path snapshot shape failure is not_evaluated with snapshot was rejected", () => {
  const ordered = [
    [PATH_A, FIXTURE_SINGLE_FOO],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered);
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      files: parts.files,
      binding: { sourceSha256: parts.combinedSha },
      snapshot: { ...parts.snapshot, projectId: "" },
      task: parts.task,
      project: parts.project,
      query: parts.query
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SNAPSHOT_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("213. multi-path missing binding is not_evaluated with source hash binding was rejected", () => {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      files: [
        { path: PATH_A, sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8") },
        { path: PATH_B, sourceBytes: Buffer.from(FILE_B_OTHER, "utf8") }
      ],
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("214. exactly 32 task paths do not emit the path-count note", () => {
  const paths = Array.from({ length: 32 }, (_value, index) => "src/p" + index + ".js");
  const files = paths.map((path, index) => ({
    path,
    sourceBytes: Buffer.from(
      index === 0 ? "export function foo() { return 1; }\n" : ("export const x" + index + " = 1;\n"),
      "utf8"
    )
  }));
  const combinedSha = createHash("sha256").update(Buffer.concat(files.map((file) => file.sourceBytes))).digest("hex");
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      files,
      binding: { sourceSha256: combinedSha },
      task: { id: SYNTHETIC_TASK_ID, paths },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.equal(Array.isArray(result.notes) && result.notes.includes(TASK_PATH_COUNT_EXCEEDS_32_NOTE), false);
  assert.equal(Object.hasOwn(result, "provider"), true);
  assert.equal(Object.hasOwn(result, "pathRecords"), true);
});

test("215. thirty-three task paths are not_evaluated with task path count exceeds 32", () => {
  const text = FILE_B_OTHER;
  const paths = Array.from({ length: 33 }, (_value, index) => "src/p" + index + ".js");
  const sourceBytes = Buffer.from(text, "utf8");
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes,
      binding: { sourceSha256: sha256Text(text) },
      task: { id: SYNTHETIC_TASK_ID, paths },
      files: paths.map((path) => ({ path, sourceBytes })),
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [TASK_PATH_COUNT_EXCEEDS_32_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

function multiFilesRejected(files) {
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      files,
      binding: { sourceSha256: "a".repeat(64) },
      task: { id: SYNTHETIC_TASK_ID, paths: [PATH_A, PATH_B] },
      project: {
        projectId: SYNTHETIC_PROJECT_ID,
        rootId: SYNTHETIC_ROOT_ID,
        relativePath: SYNTHETIC_PROJECT_RELATIVE_PATH
      },
      query: { name: "foo", domain: SYMBOL_QUERY_DOMAIN }
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [FILES_WERE_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
}

test("216. multi files null is not_evaluated with files were rejected", () => {
  multiFilesRejected(null);
});

test("217. multi files length mismatch is not_evaluated with files were rejected", () => {
  multiFilesRejected([{ path: PATH_A, sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8") }]);
});

test("218. multi files entry not plain object is not_evaluated with files were rejected", () => {
  multiFilesRejected([
    null,
    { path: PATH_B, sourceBytes: Buffer.from(FILE_B_OTHER, "utf8") }
  ]);
});

test("219. multi files non-string path is not_evaluated with files were rejected", () => {
  multiFilesRejected([
    { path: 1, sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8") },
    { path: PATH_B, sourceBytes: Buffer.from(FILE_B_OTHER, "utf8") }
  ]);
});

test("220. multi files duplicate path is not_evaluated with files were rejected", () => {
  multiFilesRejected([
    { path: PATH_A, sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8") },
    { path: PATH_A, sourceBytes: Buffer.from(FILE_B_OTHER, "utf8") }
  ]);
});

test("221. multi files bad sourceBytes type is not_evaluated with files were rejected", () => {
  multiFilesRejected([
    { path: PATH_A, sourceBytes: 123 },
    { path: PATH_B, sourceBytes: Buffer.from(FILE_B_OTHER, "utf8") }
  ]);
});

test("222. multi files missing task path is not_evaluated with files were rejected", () => {
  multiFilesRejected([
    { path: PATH_A, sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8") },
    { path: "src/other.js", sourceBytes: Buffer.from(FILE_B_OTHER, "utf8") }
  ]);
});

test("223. multi files non-utf8 round-trip is not_evaluated with files were rejected", () => {
  multiFilesRejected([
    { path: PATH_A, sourceBytes: Buffer.from([0xff, 0xfe, 0x00]) },
    { path: PATH_B, sourceBytes: Buffer.from(FILE_B_OTHER, "utf8") }
  ]);
});

test("224. unsupported query.domain is not_evaluated before parse on single path", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    query: { name: "foo", domain: "other_domain_not_direct_declarations" }
  });
  let threw = false;
  let result;
  try {
    result = resolveWithBinding(source, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [QUERY_DOMAIN_IS_NOT_SUPPORTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "occurrences"), false);
});

test("225. unsupported query.domain is not_evaluated before parse on multi path", () => {
  const ordered = [
    [PATH_A, FIXTURE_SINGLE_FOO],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered, {
    query: { name: "foo", domain: "other_domain_not_direct_declarations" }
  });
  let threw = false;
  let result;
  try {
    result = resolveAcrossPaths(ordered, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [QUERY_DOMAIN_IS_NOT_SUPPORTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "occurrences"), false);
});

test("226. query.name mismatch is not_evaluated before parse on single path", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    query: { name: "bar", domain: SYMBOL_QUERY_DOMAIN }
  });
  let threw = false;
  let result;
  try {
    result = resolveWithBinding(source, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [QUERY_NAME_DOES_NOT_MATCH_NAME_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "occurrences"), false);
});

test("227. query.name mismatch is not_evaluated before parse on multi path", () => {
  const ordered = [
    [PATH_A, FIXTURE_SINGLE_FOO],
    [PATH_B, FILE_B_OTHER]
  ];
  const parts = multiPathBinding(ordered, {
    query: { name: "bar", domain: SYMBOL_QUERY_DOMAIN }
  });
  let threw = false;
  let result;
  try {
    result = resolveAcrossPaths(ordered, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [QUERY_NAME_DOES_NOT_MATCH_NAME_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
  assert.equal(Object.hasOwn(result, "occurrences"), false);
});

test("228. bad domain and mismatched name emit only the domain note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    query: { name: "bar", domain: "other_domain_not_direct_declarations" }
  });
  let threw = false;
  let result;
  try {
    result = resolveWithBinding(source, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [QUERY_DOMAIN_IS_NOT_SUPPORTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("229. bad binding and bad domain emit only the binding note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    query: { name: "foo", domain: "other_domain_not_direct_declarations" }
  });
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(source, "utf8"),
      binding: { sourceSha256: "0".repeat(64) },
      snapshot: parts.snapshot,
      task: parts.task,
      project: parts.project,
      query: parts.query
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SOURCE_HASH_BINDING_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("230. bad snapshot and mismatched name emit only the snapshot note", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source, {
    query: { name: "bar", domain: SYMBOL_QUERY_DOMAIN }
  });
  let threw = false;
  let result;
  try {
    result = resolveTrackA1({
      name: "foo",
      sourceBytes: Buffer.from(source, "utf8"),
      binding: { sourceSha256: parts.sourceSha256 },
      snapshot: { ...parts.snapshot, projectId: "" },
      task: parts.task,
      project: parts.project,
      query: parts.query
    });
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "not_evaluated");
  assert.deepEqual(result.notes, [SNAPSHOT_WAS_REJECTED_NOTE]);
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "pathRecords"), false);
});

test("231. valid query with supported domain and matching name still resolves", () => {
  const source = FIXTURE_SINGLE_FOO;
  const parts = fullBindingParts(source);
  assert.equal(parts.query.domain, SYMBOL_QUERY_DOMAIN);
  assert.equal(parts.query.name, "foo");
  let threw = false;
  let result;
  try {
    result = resolveWithBinding(source, parts);
  } catch (_error) {
    threw = true;
  }
  assert.equal(threw, false);
  assert.equal(result.status, "resolved_unique");
  assert.equal(result.census, 1);
  assert.equal(Object.hasOwn(result, "provider"), true);
  assert.equal(Object.hasOwn(result, "pathRecords"), true);
  assert.equal(result.pathRecords.length, 1);
});
