// Keys of hn-create-name-key-v3 (absence-witness evidence contract r3.4, §1.5, §2.6 P-10, §5.4).
// KM-1, KM-1b, KM-1c, KM-2, KM-3 and KM-3b are table-only and run on any runtime (never skipped).
// KM-4 and FZ-1 compute K/Kk end to end and require a runtime reporting Unicode 17.0.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CASEFOLD_17_SOURCE_SHA256, CASEFOLD_17_TABLE_FILE_SHA256, KERNEL_NFDICF_TABLE_FILE_SHA256, KERNEL_MODEL_KEY_DESCRIPTOR,
  CREATE_NAME_KEY_ID, UNICODE_VERSION, kernelModelCodePoints, kernelModelNameKey, nameKey, namesCollide
} from "../src/lib/create-name-key.js";
import {
  CASEFOLD_TABLE_FILE, KERNEL_TABLE_FILE, RAW_INPUT_SHA256, generateCaseFold17TableSource, generateKernelNfdicfTableSource,
  readVerifiedRawInputs
} from "../scripts/gen-create-name-key-tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const UNICODE_17 = process.versions.unicode === "17.0";
const GATE = UNICODE_17 ? false : 'requires a runtime reporting Unicode 17.0 (process.versions.unicode === "17.0")';
const H = (cp) => cp.toString(16).toUpperCase().padStart(4, "0");
const cps = (s) => [...s].map((c) => c.codePointAt(0));
const str = (list) => String.fromCodePoint(...list);

test("KM-1: T12 + ccc12 regenerate byte-identically from the vendored UCD 12.1.0 files (offline, any runtime)", () => {
  const raw = readVerifiedRawInputs();
  const vendored = fs.readFileSync(KERNEL_TABLE_FILE);
  assert.equal(sha256(vendored), KERNEL_NFDICF_TABLE_FILE_SHA256);
  assert.equal(generateKernelNfdicfTableSource(raw), vendored.toString("utf8"));
  // A raw-file hash mismatch fails (no skip).
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || "/tmp"), "km1-"));
  try {
    for (const name of Object.keys(RAW_INPUT_SHA256)) {
      fs.mkdirSync(path.join(tmp, path.dirname(name)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, "vendor/unicode", name), path.join(tmp, name));
    }
    fs.appendFileSync(path.join(tmp, "ucd-12.1.0/UnicodeData.txt"), "\n");
    assert.throws(() => readVerifiedRawInputs(tmp), { code: "ucd_input_hash_mismatch" });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("KM-1b: K's 17.0.0 C+F table regenerates byte-identically from the vendored CaseFolding.txt", () => {
  const source = fs.readFileSync(path.join(ROOT, "vendor/unicode/ucd-17.0.0/CaseFolding.txt"));
  assert.equal(sha256(source), "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183");
  assert.equal(CASEFOLD_17_SOURCE_SHA256, sha256(source));
  assert.equal(source.length, 87539);
  const vendored = fs.readFileSync(CASEFOLD_TABLE_FILE);
  assert.equal(sha256(vendored), CASEFOLD_17_TABLE_FILE_SHA256);
  assert.equal(generateCaseFold17TableSource(readVerifiedRawInputs()), vendored.toString("utf8"));
});

test("KM-1c: vendored-data hygiene (notice files, headers, README, no DerivedAge, no kernel source)", () => {
  const a = fs.readFileSync(path.join(ROOT, "vendor/unicode/LICENSE-UNICODE-V3.txt"));
  const b = fs.readFileSync(path.join(ROOT, "src/lib/unicode-data/LICENSE-UNICODE-V3.txt"));
  assert.ok(a.equals(b));
  assert.ok(a.toString("utf8").startsWith("UNICODE LICENSE V3"));
  for (const file of fs.readdirSync(path.join(ROOT, "src/lib/unicode-data"))) {
    if (!file.endsWith(".js")) continue;
    const header = fs.readFileSync(path.join(ROOT, "src/lib/unicode-data", file), "utf8").split("\nexport ")[0];
    assert.match(header, /Unicode License v3/, file);
    assert.match(header, /LICENSE-UNICODE-V3\.txt/, file);
  }
  const readme = fs.readFileSync(path.join(ROOT, "vendor/unicode/README.md"), "utf8");
  for (const [name, digest] of Object.entries(RAW_INPUT_SHA256)) {
    assert.ok(readme.includes(name), name);
    assert.ok(readme.includes(digest), digest);
  }
  const all = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else all.push(path.relative(ROOT, p)); } };
  walk(path.join(ROOT, "vendor"));
  assert.deepEqual(all.sort(), [
    "vendor/unicode/LICENSE-UNICODE-V3.txt", "vendor/unicode/README.md",
    "vendor/unicode/ucd-12.1.0/CaseFolding.txt", "vendor/unicode/ucd-12.1.0/DerivedCoreProperties.txt",
    "vendor/unicode/ucd-12.1.0/UnicodeData.txt", "vendor/unicode/ucd-17.0.0/CaseFolding.txt"
  ]);
  assert.equal(all.some((p) => /DerivedAge|utf8data|utf8-norm|mkutf8data|\.c$|\.h$/.test(p)), false);
});

test("KM-2: KM reproduces the 10 nfdicf vectors of linux v6.17 fs/unicode/tests/utf8_kunit.c (data only)", () => {
  // Expected input/output pairs transcribed as data from nfdicf_test_data (:67–136 at v6.17,
  // file sha256 40e1f9e02eac3a4b6e12b6f59ea42f915a81fefad0f306efe50edfcccb6f2db5); no kernel code.
  const vectors = [
    ["ABba", "abba"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZ0.1", "abcdefghijklmnopqrstuvwxyz0.1"],
    ["\u00DF", "ss"],
    ["\u00C5", "a\u030A"],
    ["\uAB70", "\u13A0"],
    ["\u13F8", "\u13F0"],
    ["\u{10C83}", "\u{10CC3}"],
    ["\u{104B5}", "\u{104DD}"],
    ["\uA7AE", "\u026A"],
    ["\u1C90", "\u10D0"]
  ];
  for (const [input, output] of vectors) assert.equal(str(kernelModelCodePoints(input)), output, input);
});

function canonicalListingDigest(options) {
  const hash = createHash("sha256");
  let buffer = [];
  for (let cp = 1; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    buffer.push(`${H(cp)}\t${kernelModelCodePoints(String.fromCodePoint(cp), options).map(H).join(" ")}\n`);
    if (buffer.length >= 65536) { hash.update(buffer.join("")); buffer = []; }
  }
  hash.update(buffer.join(""));
  return hash.digest("hex");
}

test("KM-3: canonical KM listing digest equals the pinned kernel v6.17 listing", () => {
  assert.equal(canonicalListingDigest({}), "35428a6864b7ee7c3b842135f952c9163b68d4e7238f26149ff26d2b2061c97a");
});

test("KM-3b: canonical listing of the no-DI variant equals the pinned v6.12 listing", () => {
  assert.equal(canonicalListingDigest({ noDefaultIgnorableStripping: true }), "b08a8500c7c6fa9e28a021745ded7a0f1fd759ff22738cdc9f7d9675827367a3");
});

test("key bundle constants", () => {
  assert.equal(CREATE_NAME_KEY_ID, "hn-create-name-key-v3");
  assert.equal(UNICODE_VERSION, "17.0");
  assert.deepEqual({ ...KERNEL_MODEL_KEY_DESCRIPTOR }, {
    modelId: "linux-fs-unicode-utf8-nfdicf", kernelRef: "v6.17", kernelUcdVersion: "12.1.0",
    defaultIgnorableAsEmptyStopper: true, cccSource: "folded_character", postSteps: "P4-P7"
  });
  assert.ok(Object.isFrozen(KERNEL_MODEL_KEY_DESCRIPTOR));
});

test("keys never throw on lone surrogates (P-5) and KM is table-driven for post-12.1 characters", () => {
  for (const s of ["a\uD800.js", "\uDC00", "\uD800\uD800", "x\uDFFF"]) {
    assert.equal(typeof nameKey(s), "string");
    assert.equal(typeof kernelModelNameKey(s), "string");
    assert.equal(typeof namesCollide(s, "a.js"), "boolean");
  }
  // U+0898 (CCC 230 from Unicode 14) and U+1FAE8 are unassigned in 12.1.0: no entry, CCC 0, emitted as-is.
  assert.deepEqual(kernelModelCodePoints("\u0301\u0898\u0300"), [0x0301, 0x0898, 0x0300]);
  assert.deepEqual(kernelModelCodePoints("\u{1FAE8}"), [0x1fae8]);
  // KM never calls String.prototype.normalize.
  const source = fs.readFileSync(path.join(ROOT, "src/lib/create-name-key.js"), "utf8");
  const km = source.slice(source.indexOf("export function kernelModelCodePoints"), source.indexOf("/** Kk(x)"));
  assert.equal(km.includes("normalize"), false);
});

test("KM-4: KM, K and Kk of the U+0345 vectors", { skip: GATE }, () => {
  const inputs = ["\u1FB3\u0301", "\u03B1\u0345\u0301", "\u03B1\u03AF", "\u0345\u0308", "\u03CA", "\u1FB4"];
  const km = [[0x3b1, 0x3b9, 0x301], [0x3b1, 0x3b9, 0x301], [0x3b1, 0x3b9, 0x301], [0x3b9, 0x308], [0x3b9, 0x308], [0x3b1, 0x301, 0x3b9]];
  const k = [[0x3b1, 0x301, 0x3b9], [0x3b1, 0x301, 0x3b9], [0x3b1, 0x3b9, 0x301], [0x308, 0x3b9], [0x3b9, 0x308], [0x3b1, 0x301, 0x3b9]];
  inputs.forEach((input, i) => {
    assert.deepEqual(kernelModelCodePoints(input), km[i], `KM ${i}`);
    assert.deepEqual(cps(nameKey(input)), k[i], `K ${i}`);
    assert.deepEqual(cps(kernelModelNameKey(input)), km[i], `Kk ${i}`);
  });
});

test("key regressions (§1.5 verification list)", { skip: GATE }, () => {
  const collide = [
    ["\u00C9new.js", "e\u0301new.js"], ["\u0131new.js", "inew.js"], ["new\u200B.js", "new.js"], ["new.js.", "new.js"], ["new.js ", "new.js"],
    ["\u0130new.js", "i\u0307new.js"], ["\u017Fecrets.json", "secrets.json"], ["id_rsa.", "ID_RSA"], ["New.js", "new.js"],
    ["\u1FB3\u0301.txt", "\u03B1\u03AF.txt"], ["\u03B1\u0345\u0301", "\u03B1\u03AF"], ["\u0345\u0308.md", "\u03CA.md"], ["\u1FB4.txt", "\u1FB3\u0301.txt"],
    ["A.js", "a.js"], ["\u0130.js", "i\u0307.js"]
  ];
  for (const [a, b] of collide) assert.equal(namesCollide(a, b), true, `${a} ≈ ${b}`);
  for (const [a, b] of [["new.js", "new.jsx"], ["\u03B1\u03AF", "\u03B1\u03B9"], ["\u1FB4.txt", "\u03B1\u03AF.txt"]]) {
    assert.equal(namesCollide(a, b), false, `${a} !≈ ${b}`);
  }
  assert.notEqual(nameKey("\u1FB3\u0301.txt"), nameKey("\u03B1\u03AF.txt"));
  assert.equal(kernelModelNameKey("\u1FB3\u0301.txt"), kernelModelNameKey("\u03B1\u03AF.txt"));
  assert.equal(nameKey("\u200B"), "");
  assert.equal(kernelModelNameKey("\u200B"), "");
});

// FZ-1 oracle: an independent implementation written from the Unicode Standard (§3.11 canonical
// ordering by adjacent exchange) over the vendored T12 + ccc12, separate from kernelModelCodePoints.
function loadOracleTables() {
  const text = fs.readFileSync(KERNEL_TABLE_FILE, "utf8");
  const grab = (name) => JSON.parse(text.match(new RegExp(`export const ${name} = (".*");`))[1]);
  const table = new Map();
  for (const item of grab("KERNEL_NFDICF_12_1_0").split(",")) {
    const [cp, mapping] = item.split(":");
    table.set(parseInt(cp, 16), mapping ? mapping.split(" ").map((h) => parseInt(h, 16)) : []);
  }
  const ccc = new Map(grab("KERNEL_CCC_12_1_0").split(",").map((item) => item.split(":").map((v, i) => (i ? Number(v) : parseInt(v, 16)))));
  return { table, ccc };
}

test("FZ-1: no kernel-model-equal pair escapes the dual key (both model variants)", { skip: GATE }, () => {
  const { table, ccc } = loadOracleTables();
  const oracleKey = (s, noDI) => {
    const seq = []; // [cp, ccc] or [null, 0] stopper
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      const m = table.get(cp);
      if (m === undefined) seq.push([cp, ccc.get(cp) || 0]);
      else if (m.length === 0) seq.push(noDI ? [cp, 0] : [null, 0]);
      else for (const d of m) seq.push([d, ccc.get(d) || 0]);
    }
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i + 1 < seq.length; i++) {
        const a = seq[i][1], b = seq[i + 1][1];
        if (a > b && b > 0) { const t = seq[i]; seq[i] = seq[i + 1]; seq[i + 1] = t; changed = true; }
      }
    }
    return seq.filter((e) => e[0] !== null).map((e) => e[0]).join(",");
  };
  const POOL = [0x0041, 0x0061, 0x0045, 0x0065, 0x0049, 0x0069, 0x0131, 0x0130, 0x0307, 0x03B1, 0x0391, 0x03B9, 0x0399, 0x03AF, 0x03AC,
    0x1FB3, 0x1FB4, 0x1FBC, 0x1F80, 0x1F88, 0x0345, 0x0301, 0x0300, 0x0308, 0x0313, 0x0342, 0x03CA, 0x0390, 0x1FD3, 0x0323, 0x0327,
    0x0328, 0x031B, 0x05B0, 0x1AB5, 0x0898, 0x00C9, 0x00E9, 0x00DF, 0x1E9E, 0x0073, 0x017F, 0x004B, 0x212A, 0x006B, 0x200B, 0x00AD,
    0x034F, 0xFE0F, 0x002E, 0x0020, 0xAC00, 0x1100, 0x1161, 0x11A8, 0x1FAE8];
  assert.equal(POOL.length, 56);
  let a = 0x5EED0345;
  const r = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const distinct = new Set();
  const order = [];
  for (let n = 0; n < 1_000_000; n++) {
    const len = 1 + Math.floor(r() * 6);
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCodePoint(POOL[Math.floor(r() * 56)]);
    if (!distinct.has(s)) { distinct.add(s); order.push(s); }
  }
  const kMemo = new Map(), kkMemo = new Map();
  const K = (s) => { let v = kMemo.get(s); if (v === undefined) { v = nameKey(s); kMemo.set(s, v); } return v; };
  const KK = (s) => { let v = kkMemo.get(s); if (v === undefined) { v = kernelModelNameKey(s); kkMemo.set(s, v); } return v; };
  const results = {};
  for (const noDI of [false, true]) {
    const groups = new Map();
    for (const s of order) {
      const key = oracleKey(s, noDI);
      let g = groups.get(key);
      if (!g) { g = []; groups.set(key, g); }
      if (g.length < 400) g.push(s);
    }
    let pairs = 0, dualMisses = 0, kOnlyMisses = 0;
    for (const g of groups.values()) {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        pairs++;
        const kEq = K(g[i]) === K(g[j]);
        if (!kEq) kOnlyMisses++;
        if (!kEq && KK(g[i]) !== KK(g[j])) dualMisses++;
      }
    }
    // Spot-check the collision function itself on a sample of pairs.
    results[noDI ? "noDI" : "default"] = { groups: groups.size, pairs, dualMisses, kOnlyMisses };
  }
  // Implementation vs independent oracle on every distinct fuzz string (default variant).
  let disagreements = 0;
  for (const s of order) if (kernelModelCodePoints(s).join(",") !== oracleKey(s, false)) disagreements++;
  assert.equal(disagreements, 0);
  assert.equal(results.default.dualMisses, 0);
  assert.equal(results.noDI.dualMisses, 0);
  assert.ok(results.default.kOnlyMisses > 0, "generator reaches the U+0345 class");
  // Expected counts pinned by the contract (§5.4 FZ-1) from the r3 scratch run.
  assert.deepEqual(
    { groups: results.default.groups, pairs: results.default.pairs, kOnlyMisses: results.default.kOnlyMisses, noDIPairs: results.noDI.pairs },
    { groups: 476058, pairs: 797017, kOnlyMisses: 18360, noDIPairs: 125239 });
  // The pair loop above uses K/Kk directly; namesCollide must agree with that rule.
  for (const s of order.slice(0, 2000)) assert.equal(namesCollide(s, order[0]), K(s) === K(order[0]) || KK(s) === KK(order[0]));
});
