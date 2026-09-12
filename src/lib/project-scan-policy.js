export const IGNORED_PROJECT_SCAN_DIRS = Object.freeze([
  ".git",
  ".vs",
  ".vscode",
  "node_modules",
  "bin",
  "obj",
  "dist",
  "build",
  "coverage",
  ".next"
]);

const IGNORED_PROJECT_SCAN_DIR_SET = new Set(IGNORED_PROJECT_SCAN_DIRS);

export function isIgnoredProjectScanDir(name) {
  return IGNORED_PROJECT_SCAN_DIR_SET.has(name);
}
