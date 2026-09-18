/**
 * Project type detection
 *
 * Detects the type of project based on files present in the root.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Supported project types
 * @typedef {'dotnet'|'nodejs'|'typescript'|'python'|'unknown'} ProjectType
 */

/**
 * Detect project type by inspecting files in the project root
 * @param {string} absolutePath - Absolute path to project root
 * @returns {ProjectType} Detected project type
 */
export function detectProjectType(absolutePath) {
  if (!fs.existsSync(absolutePath)) {
    return 'unknown';
  }

  const files = fs.readdirSync(absolutePath);
  const fileSet = new Set(files.map(f => f.toLowerCase()));

  // .NET detection
  const hasCsproj = files.some(f => f.toLowerCase().endsWith('.csproj'))
    || hasNestedFileWithExtension(absolutePath, '.csproj', 3);
  const hasSln = files.some(f => {
    const lower = f.toLowerCase();
    return lower.endsWith('.sln') || lower.endsWith('.slnx');
  });
  const hasDotnetProps = fileSet.has('directory.build.props');
  
  if (hasCsproj || hasSln || hasDotnetProps) {
    return 'dotnet';
  }

  // Node.js / TypeScript detection
  const hasPackageJson = fileSet.has('package.json');
  const hasJsFiles = files.some(f => f.endsWith('.js') && !f.startsWith('.'));
  const hasTsConfig = fileSet.has('tsconfig.json');
  const hasTsFiles = files.some(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    || hasNestedFileWithExtension(absolutePath, '.ts', 4)
    || hasNestedFileWithExtension(absolutePath, '.tsx', 4);

  if (hasPackageJson && (hasTsConfig || hasTsFiles)) {
    return 'typescript';
  }

  if (hasPackageJson || hasJsFiles) {
    return 'nodejs';
  }

  // Python detection
  const hasPyProjectToml = fileSet.has('pyproject.toml');
  const hasSetupPy = fileSet.has('setup.py');
  const hasRequireTxt = fileSet.has('requirements.txt');
  const hasPyFiles = files.some(f => f.endsWith('.py'));

  if ((hasPyProjectToml || hasSetupPy || hasRequireTxt) && hasPyFiles) {
    return 'python';
  }

  return 'unknown';
}

function hasNestedFileWithExtension(root, extension, maxDepth) {
  const ignored = new Set(['bin', 'obj', '.git', '.vs', 'node_modules', '.next', 'dist', 'build', 'coverage']);

  function walk(dir, depth) {
    if (depth > maxDepth || !fs.existsSync(dir)) {
      return false;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (ignored.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
        return true;
      }

      if (entry.isDirectory() && walk(fullPath, depth + 1)) {
        return true;
      }
    }

    return false;
  }

  return walk(root, 0);
}

/**
 * Get a human-readable label for the project type
 * @param {ProjectType} type
 * @returns {string}
 */
export function getProjectTypeLabel(type) {
  const labels = {
    dotnet: '.NET (C#)',
    nodejs: 'Node.js',
    typescript: 'TypeScript',
    python: 'Python',
    unknown: 'Desconhecido'
  };

  return labels[type] || type;
}

/**
 * Check if a project type is currently supported for analysis
 * @param {ProjectType} type
 * @returns {boolean}
 */
export function isSupportedProjectType(type) {
  return type === 'dotnet' || type === 'typescript' || type === 'nodejs';
}