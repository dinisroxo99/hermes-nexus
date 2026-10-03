import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolveTrackA1 } from "../src/lib/track-a-symbol-resolution.js";

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
  assert.equal(result.census, 2);
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
});

test("4. incompatible or omitted binding: not_evaluated", () => {
  const omitted = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8")
  });
  assert.equal(omitted.status, "not_evaluated");
  assertNoStableId(omitted);

  const incompatible = resolveTrackA1({
    name: "foo",
    sourceBytes: Buffer.from(FIXTURE_SINGLE_FOO, "utf8"),
    binding: { sourceSha256: "0".repeat(64) }
  });
  assert.equal(incompatible.status, "not_evaluated");
  assertNoStableId(incompatible);
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
