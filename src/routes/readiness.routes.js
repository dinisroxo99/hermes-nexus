import fs from "node:fs";
import path from "node:path";
import { listAnalyzerProviders } from "../analyzers/common/analyzer-registry.js";
import { resolveProjectConfig } from "../lib/project-config.js";
import { validateRegistryState } from "../lib/registry-readiness.js";
import { normalizeRootPath } from "../lib/project-roots.js";
import { sendJson } from "../utils/response.js";

const REGISTRY_LIMIT_BYTES = 4 * 1024 * 1024;

function readableDirectory(directory) {
  try {
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.X_OK);
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

// Opening with NOFOLLOW/NONBLOCK prevents a corrupt registry symlink or FIFO from hanging the health check.
function readRegistry(directory, name) {
  let fd;
  try {
    fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > REGISTRY_LIMIT_BYTES) throw new Error("registry_limit");
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length !== stat.size) throw new Error("registry_changed");
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)).trim();
    return raw ? JSON.parse(raw) : [];
  } finally {
    fs.closeSync(fd);
  }
}

export function checkNexusReadiness(config) {
  const checks = { configuration: "unavailable", roots: "unknown", registry: "unknown", nativeProviders: "unknown" };
  try {
    config ??= resolveProjectConfig();
    checks.configuration = "ready";
    checks.roots = config.projectRoots?.length && config.projectRoots.every((root) => readableDirectory(normalizeRootPath(root.path)))
      ? "ready" : "unavailable";
    checks.registry = "unavailable";
    if (readableDirectory(config.dataDir)) {
      const manual = readRegistry(config.dataDir, "projects.json");
      const discovered = readRegistry(config.dataDir, "discovered-projects.json");
      validateRegistryState(manual, discovered);
      checks.registry = "ready";
    }
    const providers = listAnalyzerProviders().map((item) => item.id);
    checks.nativeProviders = ["native.dotnet", "native.typescript"].every((id) => providers.includes(id)) ? "ready" : "unavailable";
  } catch {
    // Return fixed status labels. Configuration errors can contain host paths.
  }
  const ready = Object.values(checks).every((state) => state === "ready");
  return { ready, checks };
}

export function handleReadiness(_req, res) {
  const data = checkNexusReadiness();
  sendJson(res, data.ready ? 200 : 503, { ok: data.ready, data, ...(data.ready ? {} : { error: "not_ready" }) });
}
