const DEFAULTS = Object.freeze({ symbols: 12, affectedFiles: 20, testCandidates: 8, textBytes: 2048 });
const MAXIMUM = Object.freeze({ symbols: 24, affectedFiles: 80, testCandidates: 16, textBytes: 8192 });
export const briefError = (code) => Object.assign(new Error(code), { code });

export function briefLimits(raw = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some((key) => !Object.hasOwn(DEFAULTS, key))) {
    throw briefError("invalid_task_brief");
  }
  const values = { ...DEFAULTS, ...raw };
  for (const [key, n] of Object.entries(values)) {
    if (!Number.isInteger(n) || n < (key === "textBytes" ? 256 : 0) || n > MAXIMUM[key]) {
      throw briefError("invalid_task_brief");
    }
  }
  return values;
}

// Simple fixture symbols/paths use the measured renderer verbatim. Quote unusual public labels to keep separators legible.
function label(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) {
    throw briefError("task_brief_evidence_invalid");
  }
  return /^[A-Za-z0-9_./$-]+$/.test(value) ? value : JSON.stringify(value);
}

export function renderTaskBrief({ symbols, affectedFiles, testCandidates, status, finding, incomplete, testsStatus }, limits) {
  const available = {
    symbols: symbols.map(({ name, path }) => `${label(name)}@${label(path)}`),
    affectedFiles: affectedFiles.map(label),
    testCandidates: testCandidates.map(label)
  };
  const groups = Object.keys(available);
  const lists = Object.fromEntries(groups.map((key) => [key, available[key].slice(0, limits[key])]));
  const truncated = () => groups.some((key) => lists[key].length < available[key].length);
  const build = () => ["Nexus", "Symbols " + lists.symbols.join(", "), "Affected " + lists.affectedFiles.join(", "),
    testsStatus === "not_requested" ? "Tests (not requested)" : "Tests " + lists.testCandidates.join(", "),
    `Coverage ${status}; ${finding}; sourceIncomplete=${incomplete}`
      + (testsStatus !== "available" ? `; testsStatus=${testsStatus}` : "")
      + (truncated() ? "; briefTruncated=true" : "")].join("\n");

  let text = build();
  while (Buffer.byteLength(text) > limits.textBytes) {
    // Trim the largest list first, preserving producer ordering and room for the other kinds of evidence.
    const longest = groups.reduce((best, key) =>
      Buffer.byteLength(lists[key].join(", ")) > Buffer.byteLength(lists[best].join(", ")) ? key : best);
    if (!lists[longest].length) throw briefError("task_brief_evidence_invalid");
    lists[longest].pop();
    text = build();
  }
  const counts = Object.fromEntries(groups.map((key) => [
    key, { received: available[key].length, rendered: lists[key].length }
  ]));
  return { text, projection: { truncated: truncated(), textBytes: Buffer.byteLength(text), counts, limits } };
}
