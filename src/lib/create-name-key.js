/**
 * Create-name comparison keys, bundle `hn-create-name-key-v3` (absence-witness evidence contract
 * r3.4, §1.5). Pure, no IO.
 *
 *   K(x)  = post(NFD17(fold_CF17(NFD17(x))))       Unicode 17.0.0 canonical caseless key
 *   Kk(x) = post(KM(x))                            model of the Linux UTF8_NFDICF key (UCD 12.1.0)
 *   post  = P4 (U+0131 → "i", delete U+0307) → P5 (delete Default_Ignorable_Code_Point, 17.0)
 *           → P6 (trim trailing U+0020 / U+002E) → P7 (NFD17)
 *   x ≈ y iff K(x) === K(y) or Kk(x) === Kk(y)     (not transitive; always applied pairwise)
 *
 * `KM` is table-driven (vendored T12 + ccc12) and never calls String.prototype.normalize. `NFD17`
 * and `DI17` use the runtime and are only meaningful on a runtime reporting
 * `process.versions.unicode === "17.0"`; callers gate on UNICODE_VERSION before relying on a key.
 * None of the exported functions throws on a string holding a lone surrogate (§2.6 P-5).
 * The tables are generated from Unicode data (Unicode License v3, ./unicode-data/LICENSE-UNICODE-V3.txt);
 * no Linux kernel source, table or port is included.
 */
import { CASEFOLD_CF_17_0_0 } from "./unicode-data/casefold-17.0.0.js";
import { KERNEL_CCC_12_1_0, KERNEL_NFDICF_12_1_0 } from "./unicode-data/kernel-nfdicf-12.1.0.js";

export const CREATE_NAME_KEY_ID = "hn-create-name-key-v3";
export const UNICODE_VERSION = "17.0";
/** sha256 of vendor/unicode/ucd-17.0.0/CaseFolding.txt, the source of K's C+F table (NF-9). */
export const CASEFOLD_17_SOURCE_SHA256 = "ff8d8fefbf123574205085d6714c36149eb946d717a0c585c27f0f4ef58c4183";
/** sha256 of the generated files under src/lib/unicode-data/ (KM-1, KM-1b). */
export const KERNEL_NFDICF_TABLE_FILE_SHA256 = "d74ca9429eb248d1e4f83b4100e319c10e5f9bcf9903c0a958d9db5fd53efccf";
export const CASEFOLD_17_TABLE_FILE_SHA256 = "44e022f6220988e47891f63982b60cbb9f8c3a47e30156483d905180e23f1d32";

export const KERNEL_MODEL_KEY_DESCRIPTOR = Object.freeze({
  modelId: "linux-fs-unicode-utf8-nfdicf",
  kernelRef: "v6.17",
  kernelUcdVersion: "12.1.0",
  defaultIgnorableAsEmptyStopper: true,
  cccSource: "folded_character",
  postSteps: "P4-P7"
});

function parseMappingTable(text) {
  const map = new Map();
  for (const item of text.split(",")) {
    const colon = item.indexOf(":");
    const value = item.slice(colon + 1);
    map.set(parseInt(item.slice(0, colon), 16), value === "" ? [] : value.split(" ").map((h) => parseInt(h, 16)));
  }
  return map;
}

const FOLD17 = parseMappingTable(CASEFOLD_CF_17_0_0);
const T12 = parseMappingTable(KERNEL_NFDICF_12_1_0);
const CCC12 = new Map(KERNEL_CCC_12_1_0.split(",").map((item) => {
  const [cp, cls] = item.split(":");
  return [parseInt(cp, 16), Number(cls)];
}));

const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
const TRAILING_DOT_SPACE = /[ .]+$/u;

function post(value) {
  const p4 = value.replace(/\u0131/g, "i").replace(/\u0307/g, "");
  const p5 = p4.replace(DEFAULT_IGNORABLE, "");
  const p6 = p5.replace(TRAILING_DOT_SPACE, "");
  return p6.normalize("NFD");
}

function fromCodePoints(cps) {
  let out = "";
  for (const cp of cps) out += String.fromCodePoint(cp);
  return out;
}

/** K(x): Unicode 17.0.0 canonical caseless key with the post-steps P4–P7. */
export function nameKey(x) {
  const folded = [];
  for (const ch of String(x).normalize("NFD")) {
    const cp = ch.codePointAt(0);
    const fold = FOLD17.get(cp);
    if (fold === undefined) folded.push(cp); else folded.push(...fold);
  }
  return post(fromCodePoints(folded).normalize("NFD"));
}

/**
 * KM(x): per code point, the T12 mapping (no entry → the code point itself; empty entry → a stopper
 * that emits nothing); every emitted character carries the 12.1.0 CCC of that emitted character;
 * maximal runs of non-zero CCC are stably sorted by CCC; stoppers bound runs and are dropped.
 * Returns an array of code points. `options.noDefaultIgnorableStripping` selects the no-DI variant
 * (an empty entry is the code point itself with CCC 0; KM-3b).
 */
export function kernelModelCodePoints(x, options = {}) {
  const noDI = options.noDefaultIgnorableStripping === true;
  const units = [];
  for (const ch of String(x)) {
    const cp = ch.codePointAt(0);
    const mapping = T12.get(cp);
    if (mapping === undefined) units.push({ cp, ccc: CCC12.get(cp) ?? 0 });
    else if (mapping.length === 0) units.push(noDI ? { cp, ccc: 0 } : { cp: -1, ccc: 0 });
    else for (const d of mapping) units.push({ cp: d, ccc: CCC12.get(d) ?? 0 });
  }
  let i = 0;
  while (i < units.length) {
    if (units[i].ccc === 0) { i++; continue; }
    let j = i;
    while (j < units.length && units[j].ccc !== 0) j++;
    const run = units.slice(i, j).map((unit, index) => ({ unit, index }));
    run.sort((a, b) => a.unit.ccc - b.unit.ccc || a.index - b.index);
    for (let k = 0; k < run.length; k++) units[i + k] = run[k].unit;
    i = j;
  }
  return units.filter((unit) => unit.cp !== -1).map((unit) => unit.cp);
}

/** Kk(x) = post(KM(x)). */
export function kernelModelNameKey(x) {
  return post(fromCodePoints(kernelModelCodePoints(x)));
}

/** The dual collision rule: K equal or Kk equal. */
export function namesCollide(x, y) {
  return nameKey(x) === nameKey(y) || kernelModelNameKey(x) === kernelModelNameKey(y);
}
