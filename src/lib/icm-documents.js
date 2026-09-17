import fs from "node:fs";
import path from "node:path";

import { isPathInsideRoot } from "./project-roots.js";
import { isIgnoredProjectScanDir } from "./project-scan-policy.js";
import { normalizeContextSources } from "./project-context-files.js";

export const ICM_DOCUMENT_INDEX_LIMITS = Object.freeze({
  defaultMaxDepth: 8,
  maxMaxDepth: 16,
  defaultMaxDocuments: 200,
  maxMaxDocuments: 1000,
  defaultMaxErrors: 50,
  defaultMaxWarnings: 50,
  maxFileSizeBytes: 128 * 1024,
  maxContentBytes: 32 * 1024,
  maxTotalContentBytes: 256 * 1024
});

const DOCUMENT_NAMES = new Map([
  ["PROJECT.md", "project"],
  ["AGENTS.md", "agents"],
  ["CONTEXT.md", "context"]
]);

const ADR_ROOTS = new Set([
  "docs/adr",
  "docs/adrs",
  "adr",
  "adrs"
]);

export function buildIcmDocumentIndex(project, options = {}) {
  const absolutePath = typeof project?.absolutePath === "string" ? path.resolve(project.absolutePath) : null;
  const projectName = typeof project?.name === "string" ? project.name : null;
  const projectRelativePath = typeof project?.relativePath === "string" ? project.relativePath : projectName;
  const maxDepth = clampInteger(options.maxDepth, {
    defaultValue: ICM_DOCUMENT_INDEX_LIMITS.defaultMaxDepth,
    min: 0,
    max: ICM_DOCUMENT_INDEX_LIMITS.maxMaxDepth
  });
  const maxDocuments = clampInteger(options.maxDocuments, {
    defaultValue: ICM_DOCUMENT_INDEX_LIMITS.defaultMaxDocuments,
    min: 1,
    max: ICM_DOCUMENT_INDEX_LIMITS.maxMaxDocuments
  });
  const maxErrors = clampInteger(options.maxErrors, {
    defaultValue: ICM_DOCUMENT_INDEX_LIMITS.defaultMaxErrors,
    min: 1,
    max: ICM_DOCUMENT_INDEX_LIMITS.defaultMaxErrors
  });
  const maxWarnings = clampInteger(options.maxWarnings, {
    defaultValue: ICM_DOCUMENT_INDEX_LIMITS.defaultMaxWarnings,
    min: 1,
    max: ICM_DOCUMENT_INDEX_LIMITS.defaultMaxWarnings
  });
  const includeContent = options.includeContent === true;
  const errors = [];
  const warnings = [];

  const index = {
    schemaVersion: 1,
    valid: true,
    bounded: true,
    project: {
      name: projectName,
      relativePath: projectRelativePath
    },
    limits: {
      maxDepth,
      maxDocuments,
      maxErrors,
      maxWarnings,
      maxFileSizeBytes: ICM_DOCUMENT_INDEX_LIMITS.maxFileSizeBytes,
      includeContent
    },
    documents: [],
    errors,
    warnings,
    truncated: false
  };

  if (!projectName || !absolutePath) {
    addError(errors, { code: "invalid_project", message: "ICM Document Index requires a resolved project with name and absolutePath." }, maxErrors);
    index.valid = false;
    return index;
  }

  const rootStat = safeLstat(absolutePath);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    addError(errors, { code: "project_unavailable", message: "Resolved project path is not a directory." }, maxErrors);
    index.valid = false;
    return index;
  }

  const sources = options.sourceFiles === undefined ? null : new Map(normalizeContextSources(options.sourceFiles).map((file) => [file.path, file]));
  const candidates = sources ? [...sources.keys()].flatMap((file) => {
    const depth = file.split("/").length - 1;
    const kind = classifyDocument(file, path.posix.basename(file), depth);
    return kind && depth <= maxDepth ? [{ kind, path: file }] : [];
  }) : findIcmDocumentCandidates(absolutePath, { maxDepth });
  let totalContentBytes = 0;
  const documents = [];

  for (const candidate of candidates) {
    const snapshotFile = sources?.get(candidate.path);
    const fileStat = snapshotFile ? null : safeLstat(candidate.absolutePath);
    if (!snapshotFile && (!fileStat || !fileStat.isFile() || fileStat.isSymbolicLink())) {
      continue;
    }

    const byteSize = snapshotFile ? snapshotFile.byteSize : fileStat.size;
    if (byteSize > ICM_DOCUMENT_INDEX_LIMITS.maxFileSizeBytes) {
      addError(errors, {
        code: "document_too_large",
        path: candidate.path
      }, maxErrors);
      continue;
    }

    const readResult = snapshotFile ? { ok: true, text: snapshotFile.text } : readTextFile(candidate.absolutePath);
    if (!readResult.ok) {
      addError(errors, {
        code: "document_read_failed",
        path: candidate.path,
        message: "Contextual document could not be read."
      }, maxErrors);
      continue;
    }

    const document = toDocumentEntry(candidate, readResult.text, byteSize);
    if (includeContent) {
      const bounded = boundContent(readResult.text, totalContentBytes);
      document.content = bounded.content;
      totalContentBytes += bounded.byteLength;
    }
    documents.push(document);
  }

  index.documents = documents.slice(0, maxDocuments);
  index.truncated = documents.length > maxDocuments;

  flushErrorTruncationWarning(errors, warnings, maxWarnings);
  if (warnings.length > maxWarnings) {
    warnings.length = maxWarnings;
  }
  index.valid = errors.length === 0;
  return index;
}

function findIcmDocumentCandidates(root, { maxDepth }) {
  const candidates = [];

  function visit(dir, depth) {
    if (!isPathInsideRoot(root, dir)) {
      return;
    }

    const dirStat = safeLstat(dir);
    if (!dirStat || !dirStat.isDirectory() || dirStat.isSymbolicLink()) {
      return;
    }

    for (const entry of readDirEntries(dir)) {
      const absoluteEntryPath = path.join(dir, entry.name);
      const relativeEntryPath = normalizeRelative(path.relative(root, absoluteEntryPath));

      if (entry.isFile() && !entry.isSymbolicLink() && isPathInsideRoot(root, absoluteEntryPath)) {
        const kind = classifyDocument(relativeEntryPath, entry.name, depth);
        if (kind) {
          candidates.push({
            kind,
            path: relativeEntryPath,
            absolutePath: absoluteEntryPath
          });
        }
        continue;
      }

      if (depth >= maxDepth) {
        continue;
      }

      if (!entry.isDirectory() || entry.isSymbolicLink() || isIgnoredProjectScanDir(entry.name)) {
        continue;
      }

      visit(absoluteEntryPath, depth + 1);
    }
  }

  visit(root, 0);
  return candidates.sort((left, right) => compareStrings(left.path, right.path));
}

function classifyDocument(relativePath, fileName, containingDirectoryDepth) {
  if (fileName === "AGENT.md") {
    return null;
  }

  if (fileName === "PROJECT.md") {
    return containingDirectoryDepth === 0 ? "project" : null;
  }

  if (DOCUMENT_NAMES.has(fileName)) {
    return DOCUMENT_NAMES.get(fileName);
  }

  if (fileName.toLowerCase().endsWith(".md") && isInAdrRoot(relativePath)) {
    return "adr";
  }

  return null;
}

function isInAdrRoot(relativePath) {
  const parent = path.posix.dirname(relativePath);
  return [...ADR_ROOTS].some((adrRoot) => parent === adrRoot || parent.startsWith(`${adrRoot}/`));
}

function toDocumentEntry(candidate, text, byteSize) {
  return {
    kind: candidate.kind,
    path: candidate.path,
    title: extractTitle(text, candidate.path),
    lineCount: countLines(text),
    byteSize,
    source: {
      path: candidate.path
    }
  };
}

function extractTitle(text, relativePath) {
  const h1 = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^#\s+(.+?)\s*#*\s*$/))
    .find(Boolean);

  if (h1) {
    return h1[1].trim();
  }

  return fallbackTitle(relativePath);
}

function fallbackTitle(relativePath) {
  const basename = path.posix.basename(relativePath, path.posix.extname(relativePath));
  const withoutAdrPrefix = basename.replace(/^ADR[-_ ]*\d+[-_ ]*/i, "");
  const normalized = (withoutAdrPrefix || basename)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return basename;
  }

  return normalized
    .split(" ")
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1)}` : word)
    .join(" ");
}

function countLines(text) {
  if (text === "") {
    return 0;
  }

  return text.replace(/\r?\n$/, "").split(/\r?\n/).length;
}

function boundContent(text, totalContentBytes) {
  const remaining = ICM_DOCUMENT_INDEX_LIMITS.maxTotalContentBytes - totalContentBytes;
  if (remaining <= 0) {
    return { content: "", byteLength: 0 };
  }

  const maxBytes = Math.min(ICM_DOCUMENT_INDEX_LIMITS.maxContentBytes, remaining);
  const buffer = Buffer.from(String(text || ""), "utf8");
  if (buffer.length <= maxBytes) {
    return { content: text, byteLength: buffer.length };
  }

  const content = buffer.subarray(0, maxBytes).toString("utf8");
  return {
    content,
    byteLength: Buffer.byteLength(content, "utf8")
  };
}

function readTextFile(filePath) {
  try {
    return {
      ok: true,
      text: fs.readFileSync(filePath, "utf8")
    };
  } catch {
    return { ok: false };
  }
}

function addError(errors, error, maxErrors) {
  if (errors.length < maxErrors) {
    errors.push(error);
    return;
  }

  errors.omittedCount = (errors.omittedCount || 0) + 1;
}

function flushErrorTruncationWarning(errors, warnings, maxWarnings) {
  if (!errors.omittedCount) {
    return;
  }

  if (warnings.length < maxWarnings) {
    warnings.push({
      code: "errors_truncated",
      omitted: errors.omittedCount
    });
  }
  delete errors.omittedCount;
}

function readDirEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

function safeLstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

function normalizeRelative(value) {
  return String(value || "").replaceAll("\\", "/");
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function clampInteger(raw, { defaultValue, min, max }) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
