/**
 * Hermes Nexus — server entry point
 *
 * Lightweight orchestrator: router dispatch, static serving, error handling.
 * All API routes are registered via src/routes/*.routes.js
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createRouter } from "./utils/router.js";
import { sendJson, sendError } from "./utils/response.js";
import {
  handleListProjects,
  handleGetProject,
  handleGetProjectStructure,
  handleHealth
} from "./routes/projects.routes.js";
import {
  handleSearch,
  handleExpand,
  handleFullGraph,
  handleImpact,
  handleContext,
  handleInsights
} from "./routes/explore.routes.js";
import { handleIndexProject } from "./routes/index.routes.js";
import {
  handleClearSymbolCache,
  handleSymbolCacheStats
} from "./routes/cache.routes.js";
import { registerIntelligenceRoutes } from "./routes/intelligence.routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");

// --- Router setup ---
const router = createRouter();

router.add("GET", "/api/health", handleHealth);
router.add("GET", "/api/projects", handleListProjects);
router.add("GET", "/api/projects/:name/structure", handleGetProjectStructure);
router.add("GET", "/api/projects/:name", handleGetProject);
router.add("GET", "/api/explore/:project/search", handleSearch);
router.add("GET", "/api/explore/:project/expand", handleExpand);
router.add("GET", "/api/explore/:project/full", handleFullGraph);
router.add("GET", "/api/explore/:project/impact", handleImpact);
router.add("GET", "/api/explore/:project/context", handleContext);
router.add("GET", "/api/explore/:project/insights", handleInsights);
router.add("POST", "/api/index/:project", handleIndexProject);
router.add("GET", "/api/cache/symbols", handleSymbolCacheStats);
router.add("DELETE", "/api/cache/symbols", handleClearSymbolCache);
registerIntelligenceRoutes(router);

// --- Static file serving ---
function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";

  return "application/octet-stream";
}

function serveStatic(req, res) {
  const rawUrl = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = rawUrl.pathname === "/" ? "/index.html" : rawUrl.pathname;

  const safePath = path
    .normalize(urlPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");

  const filePath = path.join(PUBLIC_DIR, safePath);

  // Path traversal protection
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  const content = fs.readFileSync(filePath);

  res.writeHead(200, {
    "content-type": getMime(filePath),
    "cache-control": "no-store"
  });

  res.end(content);
}

// --- Request handler ---
export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API routes
  if (url.pathname.startsWith("/api/")) {
    try {
      const matched = await router.dispatch(req, res);

      if (!matched) {
        sendError(res, 404, "not_found", `Rota não encontrada: ${req.method} ${url.pathname}`);
      }
    } catch (error) {
      console.error("[server] Error handling API request:", error);
      sendError(res, 500, "internal_error", error.message || "Erro inesperado");
    }

    return;
  }

  // Static files
  serveStatic(req, res);
});

export function resolveBindAddress(env = process.env) {
  if (env.HOST === undefined) return "0.0.0.0";
  if (env.HOST.trim() === "") {
    throw new TypeError("HOST must contain a bind address when set.");
  }
  return env.HOST;
}

export function startServer({ env = process.env, listener = server, log = console.log } = {}) {
  const port = Number(env.PORT || 8770);
  const host = resolveBindAddress(env);

  return listener.listen(port, host, () => {
    const address = listener.address();
    const effectiveHost = address.address.includes(":") ? `[${address.address}]` : address.address;
    log(`Hermes Nexus ativo em http://${effectiveHost}:${address.port}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
