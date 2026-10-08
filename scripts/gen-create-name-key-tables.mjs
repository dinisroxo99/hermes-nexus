#!/usr/bin/env node
/**
 * Offline generator for the two data tables of the create-name key bundle `hn-create-name-key-v3`
 * (absence-witness evidence contract r3.4, §1.5, §2.6 P-10, D1):
 *
 *   1. `src/lib/unicode-data/kernel-nfdicf-12.1.0.js`: the kernel-model table `T12` + `ccc12`,
 *      generated from the vendored raw Unicode 12.1.0 UCD files with the algorithm the contract
 *      describes in §1.5 (canonical decomposition mapping without compatibility forms; C+F case
 *      folding; Default_Ignorable_Code_Point as the empty mapping; algorithmic Hangul decomposition;
 *      `nfdi` expanded to a fixpoint and copied where no fold exists; `nfdicf` expanded to a fixpoint).
 *   2. `src/lib/unicode-data/casefold-17.0.0.js`: the Unicode 17.0.0 full case folding table
 *      (status C and F only) used by `K`.
 *
 * This is an independent implementation written from the Unicode Standard and the UCD file formats.
 * No Linux kernel source, table or port is used or vendored (the kernel is GPL-2.0; contract SF-4).
 * The raw inputs are checked against their pinned sha256 before anything is read. No network.
 *
 * Usage: node scripts/gen-create-name-key-tables.mjs --write   (rewrite both generated files)
 *        node scripts/gen-create-name-key-tables.mjs --check   (exit 1 if a generated file differs)
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(REPO, "vendor", "unicode");
const OUT_DIR = path.join(REPO, "src", "lib", "unicode-data");

export const RAW_INPUT_SHA256 = Object.freeze({
  "ucd-12.1.0/UnicodeData.txt": "93ab1acd8fd9d450463b50ae77eab151a7cda48f98b25b56baed8070f80fc936",
  "ucd-12.1.0/CaseFolding.txt": "9c772627c6ee77eea6a17b42927b8ee28ca05dc65d6a511062104baaf3d12294",
  "ucd-12.1.0/DerivedCoreProperties.txt": "a6eb7a8671fb532fbd88c37fd7b20b5b2e7dbfc8b121f74c14abe2947db0da68",
  "ucd-17.0.0/CaseFolding.txt": "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183"
});

export const KERNEL_TABLE_FILE = path.join(OUT_DIR, "kernel-nfdicf-12.1.0.js");
export const CASEFOLD_TABLE_FILE = path.join(OUT_DIR, "casefold-17.0.0.js");

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, "0");
const parseCps = (text) => text.trim().split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16));

/** Read every raw input after checking all four pinned digests first (KM-1: a mismatch fails). */
export function readVerifiedRawInputs(vendorDir = VENDOR) {
  const buffers = {};
  for (const [name, expected] of Object.entries(RAW_INPUT_SHA256)) {
    const buffer = fs.readFileSync(path.join(vendorDir, name));
    const actual = sha256(buffer);
    if (actual !== expected) {
      throw Object.assign(new Error(`raw UCD input ${name}: sha256 ${actual} != pinned ${expected}`), { code: "ucd_input_hash_mismatch" });
    }
    buffers[name] = buffer;
  }
  return Object.fromEntries(Object.entries(buffers).map(([name, buffer]) => [name, buffer.toString("utf8")]));
}

function dataLines(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const body = line.split("#")[0].trim();
    if (body) out.push(body.split(";").map((field) => field.trim()));
  }
  return out;
}

/** C+F rows of a CaseFolding.txt file: Map<cp, cp[]>. S and T rows are unused (full folding). */
function caseFoldingCF(text) {
  const map = new Map();
  for (const [code, status, mapping] of dataLines(text)) {
    if (status === "C" || status === "F") map.set(parseInt(code, 16), parseCps(mapping));
  }
  return map;
}

export function buildKernelModelTables(raw) {
  const unicodeData = raw["ucd-12.1.0/UnicodeData.txt"];
  const nfdi = new Map();
  const ccc = new Map();
  let rangeFirst = null;
  for (const line of unicodeData.split("\n")) {
    if (!line) continue;
    const f = line.split(";");
    const cp = parseInt(f[0], 16);
    const combiningClass = parseInt(f[3], 10);
    if (f[1].endsWith(", First>")) { rangeFirst = cp; continue; }
    if (f[1].endsWith(", Last>")) {
      if (combiningClass) for (let x = rangeFirst; x <= cp; x++) ccc.set(x, combiningClass);
      rangeFirst = null;
      continue;
    }
    if (combiningClass) ccc.set(cp, combiningClass);
    // Canonical decomposition mapping only; a mapping starting with a <tag> is a compatibility form.
    if (f[5] && !f[5].startsWith("<")) nfdi.set(cp, parseCps(f[5]));
  }
  const nfdicf = caseFoldingCF(raw["ucd-12.1.0/CaseFolding.txt"]);
  const ignorable = new Set();
  for (const [range, property] of dataLines(raw["ucd-12.1.0/DerivedCoreProperties.txt"])) {
    if (property !== "Default_Ignorable_Code_Point") continue;
    const [a, b] = range.split("..").map((h) => parseInt(h, 16));
    for (let x = a; x <= (b ?? a); x++) ignorable.add(x);
  }
  for (const cp of ignorable) { nfdi.set(cp, []); nfdicf.set(cp, []); }
  // Hangul syllables: algorithmic L V (T) decomposition (The Unicode Standard §3.12).
  const SBase = 0xac00, LBase = 0x1100, VBase = 0x1161, TBase = 0x11a7, NCount = 588, TCount = 28, SCount = 11172;
  for (let s = 0; s < SCount; s++) {
    const l = LBase + Math.floor(s / NCount);
    const v = VBase + Math.floor((s % NCount) / TCount);
    const t = TBase + (s % TCount);
    const mapping = t === TBase ? [l, v] : [l, v, t];
    nfdi.set(SBase + s, mapping);
    nfdicf.set(SBase + s, mapping.slice());
  }
  const expandToFixpoint = (map) => {
    for (const [cp, initial] of map) {
      let current = initial;
      for (;;) {
        let changed = false;
        const next = [];
        for (const d of current) {
          const replacement = map.get(d);
          if (replacement !== undefined && !(replacement.length === 1 && replacement[0] === d)) { next.push(...replacement); changed = true; }
          else next.push(d);
        }
        current = next;
        if (!changed) break;
      }
      map.set(cp, current);
    }
  };
  expandToFixpoint(nfdi);
  for (const [cp, mapping] of nfdi) if (!nfdicf.has(cp)) nfdicf.set(cp, mapping.slice());
  expandToFixpoint(nfdicf);
  return { nfdicf, ccc };
}

const NOTICE = [
  "// Derived from Unicode Character Database data files. Copyright © Unicode, Inc.",
  "// Distributed under the Unicode License v3; the full copyright and permission notice is in",
  "// ./LICENSE-UNICODE-V3.txt (identical copy: vendor/unicode/LICENSE-UNICODE-V3.txt)."
];

export function generateKernelNfdicfTableSource(raw = readVerifiedRawInputs()) {
  const { nfdicf, ccc } = buildKernelModelTables(raw);
  const mapping = [...nfdicf.keys()].sort((a, b) => a - b).map((cp) => `${hex(cp)}:${nfdicf.get(cp).map(hex).join(" ")}`).join(",");
  const classes = [...ccc.keys()].sort((a, b) => a - b).map((cp) => `${hex(cp)}:${ccc.get(cp)}`).join(",");
  return [
    "// GENERATED FILE, do not edit. Regenerate with: node scripts/gen-create-name-key-tables.mjs --write",
    "// Kernel-model table T12 + ccc12 for the key Kk of hn-create-name-key-v3 (contract r3.4 §1.5).",
    "// Inputs (vendor/unicode/ucd-12.1.0/, Unicode 12.1.0): UnicodeData.txt sha256 " + RAW_INPUT_SHA256["ucd-12.1.0/UnicodeData.txt"] + ",",
    "//   CaseFolding.txt sha256 " + RAW_INPUT_SHA256["ucd-12.1.0/CaseFolding.txt"] + ",",
    "//   DerivedCoreProperties.txt sha256 " + RAW_INPUT_SHA256["ucd-12.1.0/DerivedCoreProperties.txt"] + ".",
    "// NFDICF: \"CP:M M ...\" per code point with a fully expanded fold-then-decompose mapping; an empty",
    "// mapping is a Default_Ignorable_Code_Point (an empty stopper). CCC: \"CP:class\" for every non-zero",
    "// Canonical_Combining_Class of Unicode 12.1.0 (absent = 0). Hex code points, ascending.",
    "// Independent implementation from the Unicode Standard; no Linux kernel source or table is included.",
    ...NOTICE,
    `export const KERNEL_NFDICF_12_1_0 = ${JSON.stringify(mapping)};`,
    `export const KERNEL_CCC_12_1_0 = ${JSON.stringify(classes)};`,
    ""
  ].join("\n");
}

export function generateCaseFold17TableSource(raw = readVerifiedRawInputs()) {
  const fold = caseFoldingCF(raw["ucd-17.0.0/CaseFolding.txt"]);
  const mapping = [...fold.keys()].sort((a, b) => a - b).map((cp) => `${hex(cp)}:${fold.get(cp).map(hex).join(" ")}`).join(",");
  return [
    "// GENERATED FILE, do not edit. Regenerate with: node scripts/gen-create-name-key-tables.mjs --write",
    "// Unicode 17.0.0 full case folding (CaseFolding.txt status C and F only) for the key K of",
    "// hn-create-name-key-v3 (contract r3.4 §1.5). Source: vendor/unicode/ucd-17.0.0/CaseFolding.txt,",
    "// sha256 " + RAW_INPUT_SHA256["ucd-17.0.0/CaseFolding.txt"] + ".",
    "// Format: \"CP:M M ...\" per folded code point, hex, ascending.",
    ...NOTICE,
    `export const CASEFOLD_CF_17_0_0 = ${JSON.stringify(mapping)};`,
    ""
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  const raw = readVerifiedRawInputs();
  const outputs = [[KERNEL_TABLE_FILE, generateKernelNfdicfTableSource(raw)], [CASEFOLD_TABLE_FILE, generateCaseFold17TableSource(raw)]];
  if (mode === "--write") {
    for (const [file, text] of outputs) { fs.writeFileSync(file, text); console.log(`${path.relative(REPO, file)} ${sha256(Buffer.from(text))}`); }
  } else if (mode === "--check") {
    let ok = true;
    for (const [file, text] of outputs) {
      const same = fs.existsSync(file) && fs.readFileSync(file, "utf8") === text;
      console.log(`${path.relative(REPO, file)} ${same ? "up to date" : "DIFFERS"}`);
      ok &&= same;
    }
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error("usage: node scripts/gen-create-name-key-tables.mjs --write | --check");
    process.exitCode = 2;
  }
}
