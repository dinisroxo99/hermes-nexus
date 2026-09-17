import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateRelativeProjectPath, isPathInsideRoot } from "./project-roots.js";
import { isIgnoredProjectScanDir } from "./project-scan-policy.js";

export const CONTEXT_SOURCE_LIMITS = Object.freeze({ maxDepth: 8, maxEntries: 10000, maxFiles: 500, maxFileBytes: 128 * 1024, maxTotalBytes: 4 * 1024 * 1024 });
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".cs", ".csproj", ".sln", ".slnx", ".py", ".go", ".rs", ".java", ".md", ".json", ".yaml", ".yml", ".txt"]);

export const compareContextStrings = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const contextDigest = (value) => createHash("sha256").update(value).digest("hex");

export function isContextPathAllowed(value) {
  if (typeof value !== "string" || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value) || /^[A-Za-z]:/.test(value)) return false;
  const valid = validateRelativeProjectPath(value);
  if (!valid.valid || valid.relativePath !== value) return false;
  return value.split("/").every((part) => !isIgnoredProjectScanDir(part)
    && !/^(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.pypirc|credentials?(?:\..*)?|secrets?(?:\..*)?|service[-_]account(?:\..*)?|id_rsa|id_ed25519)$/i.test(part));
}

export function normalizeContextSources(sourceFiles) {
  const invalid = () => Object.assign(new Error("Invalid bounded context sources."), { code: "invalid_context_sources" });
  if (!Array.isArray(sourceFiles) || sourceFiles.length > CONTEXT_SOURCE_LIMITS.maxFiles) throw invalid();
  let total = 0;
  const seen = new Set();
  return sourceFiles.map((file) => {
    if (!isContextPathAllowed(file?.path) || !EXTENSIONS.has(path.posix.extname(file.path).toLowerCase())
      || typeof file.text !== "string" || file.text.includes("\0") || seen.has(file.path)) throw invalid();
    const byteSize = Buffer.byteLength(file.text);
    total += byteSize;
    if (byteSize > CONTEXT_SOURCE_LIMITS.maxFileBytes || total > CONTEXT_SOURCE_LIMITS.maxTotalBytes) throw invalid();
    seen.add(file.path);
    return { path: file.path, text: file.text, byteSize, sha256: contextDigest(file.text) };
  }).sort((a, b) => compareContextStrings(a.path, b.path));
}

export function collectContextSources(project, options = {}) {
  const limits = Object.fromEntries(Object.entries(CONTEXT_SOURCE_LIMITS).map(([key, max]) => [key,
    Number.isFinite(options[key]) ? Math.max(key === "maxDepth" ? 0 : 1, Math.min(max, Math.floor(options[key]))) : max
  ]));
  const root = path.resolve(project.absolutePath);
  if (fs.realpathSync(root) !== root) throw Object.assign(new Error("Resolved context root changed."), { code: "invalid_context_sources" });
  const excluded = options.excludedPaths || [];
  if (!Array.isArray(excluded) || excluded.some((p) => !isContextPathAllowed(p))) {
    throw Object.assign(new Error("Invalid context boundaries."), { code: "invalid_context_sources" });
  }
  const files = [];
  const diagnostics = [];
  let visited = 0;
  let bytes = 0;
  let truncated = false;
  const issue = (code, file) => {
    truncated = true;
    if (diagnostics.length < 40) diagnostics.push({ code, ...(file ? { path: file } : {}) });
  };
  // Kernel-backed descriptor paths bind the opened object, not a raceable pathname.
  // Without this facility collection fails closed; never fall back to path prechecks.
  const verifyDescriptor = (fd, expected) => {
    if (fs.readlinkSync(`/proc/self/fd/${fd}`) !== expected) throw new Error("Context source moved.");
  };
  function visit(dir, depth) {
    if (visited > limits.maxEntries) return;
    const entries = [];
    let handle;
    let directoryFd;
    try {
      directoryFd = fs.openSync(dir, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0));
      verifyDescriptor(directoryFd, dir);
      handle = fs.opendirSync(`/proc/self/fd/${directoryFd}`);
      let entry;
      while ((entry = handle.readSync())) {
        visited += 1;
        if (visited > limits.maxEntries) { issue("source_scan_limit"); return; }
        entries.push(entry);
      }
    } catch { issue("source_directory_unavailable"); return; }
    finally { handle?.closeSync(); if (directoryFd !== undefined) fs.closeSync(directoryFd); }
    entries.sort((a, b) => compareContextStrings(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (!isContextPathAllowed(relative) || entry.isSymbolicLink()
        || excluded.some((p) => relative === p || relative.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) {
        try { fs.lstatSync(path.join(absolute, ".git")); continue; } catch (error) {
          if (error.code !== "ENOENT") { issue("source_unavailable", relative); continue; }
        }
        if (depth >= limits.maxDepth) { issue("source_depth_limit", relative); continue; }
        visit(absolute, depth + 1);
      } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        if (files.length >= limits.maxFiles) { issue("source_file_limit"); continue; }
        let fd;
        try {
          if (!isPathInsideRoot(root, fs.realpathSync(absolute))) { issue("source_unavailable"); continue; }
          fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
          verifyDescriptor(fd, absolute);
          const before = fs.fstatSync(fd);
          if (!before.isFile() || before.size > limits.maxFileBytes || bytes + before.size > limits.maxTotalBytes) {
            issue("source_byte_limit", relative); continue;
          }
          const buffer = Buffer.alloc(before.size + 1);
          const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
          bytes += count;
          const after = fs.fstatSync(fd);
          if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
            issue("source_changed", relative); continue;
          }
          const text = buffer.subarray(0, count).toString("utf8");
          if (text.includes("\0") || text.includes("\ufffd")) { issue("source_binary", relative); continue; }
          files.push({ path: relative, text, byteSize: count, sha256: contextDigest(text) });
        } catch { issue("source_unavailable", relative); }
        finally { if (fd !== undefined) fs.closeSync(fd); }
      }
    }
  }
  visit(root, 0);
  files.sort((a, b) => compareContextStrings(a.path, b.path));
  diagnostics.sort((a, b) => compareContextStrings(JSON.stringify(a), JSON.stringify(b)));
  return { files, limits, truncated, diagnostics, digest: contextDigest(JSON.stringify(files.map((file) => [file.path, file.sha256]))) };
}
