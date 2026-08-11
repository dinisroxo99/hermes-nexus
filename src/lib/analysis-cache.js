import fs from "node:fs";
import path from "node:path";

const DEFAULT_TTL_MS = Number(process.env.ANALYSIS_CACHE_TTL_MS || 5 * 60 * 1000);
const DEFAULT_MAX_ENTRIES = Number(process.env.ANALYSIS_CACHE_MAX_ENTRIES || 12);

const IGNORED_DIRS = new Set([
  "bin",
  "obj",
  ".git",
  ".vs",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage"
]);

const CACHE = new Map();
const STATS = {
  hits: 0,
  misses: 0,
  stale: 0,
  evictions: 0
};

export function getCachedAnalysis(project, analyzer, options = {}, factory) {
  const key = makeKey(project, analyzer.projectType);
  const now = Date.now();
  const signature = getProjectSignature(project.absolutePath, analyzer.fileExtensions || []);
  const cached = CACHE.get(key);

  if (cached) {
    const ageMs = now - cached.createdAt;
    const isFresh = ageMs < DEFAULT_TTL_MS && cached.signature === signature;

    if (isFresh) {
      STATS.hits += 1;
      cached.lastAccessedAt = now;
      return cached.analysis;
    }

    STATS.stale += 1;
    CACHE.delete(key);
  }

  STATS.misses += 1;
  const analysis = factory({
    ...options,
    nodeLimit: options.cacheNodeLimit || options.nodeLimit || 10000,
    edgeLimit: options.cacheEdgeLimit || options.edgeLimit || 25000
  });

  CACHE.set(key, {
    projectName: project.name,
    projectPath: project.absolutePath,
    projectType: analyzer.projectType,
    signature,
    createdAt: now,
    lastAccessedAt: now,
    analysis
  });

  evictIfNeeded();
  return analysis;
}

export function invalidateAnalysisCache(projectName = null) {
  let removed = 0;

  for (const [key, entry] of Array.from(CACHE.entries())) {
    if (!projectName || entry.projectName === projectName || key.startsWith(`${projectName}:`)) {
      CACHE.delete(key);
      removed += 1;
    }
  }

  return {
    removed,
    remaining: CACHE.size
  };
}

export function getAnalysisCacheStats() {
  const now = Date.now();

  return {
    ttlMs: DEFAULT_TTL_MS,
    maxEntries: DEFAULT_MAX_ENTRIES,
    size: CACHE.size,
    ...STATS,
    entries: Array.from(CACHE.entries()).map(([key, entry]) => ({
      key,
      project: entry.projectName,
      projectType: entry.projectType,
      ageMs: now - entry.createdAt,
      expiresInMs: Math.max(0, DEFAULT_TTL_MS - (now - entry.createdAt)),
      nodeCount: entry.analysis?.nodes?.length || 0,
      edgeCount: entry.analysis?.edges?.length || 0
    }))
  };
}

function evictIfNeeded() {
  while (CACHE.size > DEFAULT_MAX_ENTRIES) {
    const oldest = Array.from(CACHE.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)[0];

    if (!oldest) return;
    CACHE.delete(oldest[0]);
    STATS.evictions += 1;
  }
}

function makeKey(project, projectType) {
  return `${project.name}:${projectType}:${project.absolutePath}`;
}

function getProjectSignature(rootPath, extensions) {
  const wanted = new Set((extensions || []).map((extension) => extension.toLowerCase()));
  let fileCount = 0;
  let newestMtimeMs = 0;

  function walk(dir) {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (wanted.size && !wanted.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const stat = fs.statSync(fullPath);
      fileCount += 1;
      newestMtimeMs = Math.max(newestMtimeMs, stat.mtimeMs);
    }
  }

  walk(rootPath);
  return `${fileCount}:${Math.floor(newestMtimeMs)}`;
}
