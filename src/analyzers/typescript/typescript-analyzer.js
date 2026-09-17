/**
 * TypeScript Analyzer
 *
 * Initial analyzer for TypeScript/JavaScript projects using ts-morph.
 * Extracts imports, exports, React components, hooks, providers, types and interfaces.
 */

import { Project } from 'ts-morph';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeContextSources } from '../../lib/project-context-files.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.git',
  '.vscode',
  'public'
]);

export const typeScriptAnalyzer = {
  projectType: 'typescript',
  name: 'TypeScript analyzer',
  fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  searchUsesAnalysis: true,
  expandUsesAnalysis: true,
  capabilities: {
    analyze: true,
    search: true,
    expand: true,
    fullGraph: true,
    metadata: true,
    pathAliases: true,
    reExports: true
  },
  analyze: analyzeTypeScriptProject,
  search: searchSymbols,
  expand: expandNode
};


export function analyzeTypeScriptProject(project, options = {}) {
  const {
    nodeLimit = 500,
    edgeLimit = 1200,
    layers = [],
    features = []
  } = options;
  const rootPath = project.absolutePath;
  const snapshot = options.sourceFiles === undefined ? null : normalizeContextSources(options.sourceFiles);

  if (!snapshot && !fs.existsSync(rootPath)) {
    return emptyResult(`Caminho do projeto não encontrado: ${rootPath}`);
  }

  const files = snapshot ? snapshot.filter((file) => /\.(ts|tsx|js|jsx)$/i.test(file.path)).map((file) => path.join(rootPath, file.path)) : findAllSourceFiles(rootPath);

  if (!files.length) {
    return emptyResult('Nenhum ficheiro .ts/.tsx/.js/.jsx encontrado');
  }

  try {
    const tsConfigPath = path.join(rootPath, 'tsconfig.json');
    const tsProject = new Project(snapshot ? {
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, noLib: true }
    } : {
      tsConfigFilePath: fs.existsSync(tsConfigPath) ? tsConfigPath : undefined,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true
      }
    });

    for (const file of files) {
      if (snapshot) tsProject.createSourceFile(file, snapshot.find((source) => path.join(rootPath, source.path) === file).text);
      else tsProject.addSourceFileAtPath(file);
    }

    const nodes = [];
    const edges = [];
    const seenNodeKeys = new Set();
    const symbolsByName = new Map();
    const fileSymbolsByPath = new Map();
    const defaultSymbolByPath = new Map();
    const exportAliasesByPath = new Map();
    const pathAliases = readPathAliases(rootPath, snapshot ? snapshot.find((file) => file.path === 'tsconfig.json')?.text || '{}' : undefined);
    const sourceFiles = tsProject.getSourceFiles().filter((sourceFile) => {
      const relativePath = normalizeRelativePath(rootPath, sourceFile.getFilePath());
      return !shouldIgnorePath(relativePath);
    });

    for (const sourceFile of sourceFiles) {
      const relativePath = normalizeRelativePath(rootPath, sourceFile.getFilePath());
      extractSymbols(sourceFile, relativePath, {
        nodes,
        seenNodeKeys,
        symbolsByName,
        fileSymbolsByPath,
        defaultSymbolByPath,
        exportAliasesByPath,
        pathAliases,
        rootPath
      });
    }

    for (const sourceFile of sourceFiles) {
      const relativePath = normalizeRelativePath(rootPath, sourceFile.getFilePath());
      collectReExportAliases(sourceFile, relativePath, {
        fileSymbolsByPath,
        defaultSymbolByPath,
        exportAliasesByPath,
        pathAliases
      });
    }

    for (const sourceFile of sourceFiles) {
      const relativePath = normalizeRelativePath(rootPath, sourceFile.getFilePath());
      extractImportEdges(sourceFile, relativePath, {
        edges,
        symbolsByName,
        fileSymbolsByPath,
        defaultSymbolByPath,
        exportAliasesByPath,
        pathAliases,
        rootPath
      });
    }

    const filteredNodes = filterNodes(nodes, { layers, features });
    const allowedNodeIds = new Set(filteredNodes.map((node) => node.id));
    const limitedNodes = filteredNodes.slice(0, nodeLimit);
    const limitedNodeIds = new Set(limitedNodes.map((node) => node.id));
    const limitedEdges = uniqueEdges(edges)
      .filter((edge) => allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to))
      .filter((edge) => limitedNodeIds.has(edge.from) && limitedNodeIds.has(edge.to))
      .slice(0, edgeLimit);

    return {
      success: true,
      projectType: 'typescript',
      message: `Analisei ${limitedNodes.length} símbolos TypeScript`,
      nodes: limitedNodes,
      edges: limitedEdges,
      metadata: {
        totalFiles: files.length,
        totalSymbols: nodes.length,
        totalEdges: edges.length,
        analyzer: typeScriptAnalyzer.name,
        capabilities: typeScriptAnalyzer.capabilities,
        pathAliasCount: pathAliases.length
      }
    };
  } catch (error) {
    console.error('[TypeScriptAnalyzer] Error:', error);
    return emptyResult(`Erro ao analisar: ${error.message}`);
  }
}

function emptyResult(message) {
  return {
    success: false,
    projectType: 'typescript',
    message,
    nodes: [],
    edges: []
  };
}

function findAllSourceFiles(rootPath) {
  const files = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = normalizeRelativePath(rootPath, fullPath);

      if (shouldIgnorePath(relativePath)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  walk(rootPath);
  return files;
}

function normalizeRelativePath(rootPath, filePath) {
  return path.relative(rootPath, filePath).replace(/\\/g, '/');
}

function shouldIgnorePath(relativePath) {
  const parts = relativePath.split(/[\\/]+/);

  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
  }

  return false;
}

function extractSymbols(sourceFile, relativePath, context) {
  const fileName = path.basename(sourceFile.getFilePath());
  const sourceText = sourceFile.getText();

  for (const declaration of sourceFile.getClasses()) {
    registerSymbol(context, relativePath, createNode({
      name: declaration.getName(),
      kind: 'class',
      relativePath,
      fileName,
      start: declaration.getStart(),
      category: classifyNode(declaration.getName(), 'class')
    }));
  }

  for (const declaration of sourceFile.getFunctions()) {
    registerSymbol(context, relativePath, createNode({
      name: declaration.getName(),
      kind: isHookName(declaration.getName()) ? 'hook' : 'function',
      relativePath,
      fileName,
      start: declaration.getStart(),
      category: classifyNode(declaration.getName(), 'function')
    }));
  }

  for (const declaration of sourceFile.getInterfaces()) {
    registerSymbol(context, relativePath, createNode({
      name: declaration.getName(),
      kind: 'interface',
      relativePath,
      fileName,
      start: declaration.getStart(),
      category: 'interface'
    }));
  }

  for (const declaration of sourceFile.getTypeAliases()) {
    registerSymbol(context, relativePath, createNode({
      name: declaration.getName(),
      kind: 'type',
      relativePath,
      fileName,
      start: declaration.getStart(),
      category: 'type'
    }));
  }

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();

    if (!isInterestingVariableSymbol(name)) {
      continue;
    }

    registerSymbol(context, relativePath, createNode({
      name,
      kind: isHookName(name) ? 'hook' : 'component',
      relativePath,
      fileName,
      start: declaration.getStart(),
      category: classifyNode(name, 'component')
    }));
  }

  extractDefaultExportSymbols(sourceFile, relativePath, fileName, context);
  extractRegexSymbols(sourceText, relativePath, fileName, context);
}

function extractRegexSymbols(sourceText, relativePath, fileName, context) {
  const componentRegex = /(?:export\s+)?const\s+([A-Z][A-Za-z0-9_]*)\s*=/g;
  const hookRegex = /(?:export\s+)?(?:function|const)\s+(use[A-Za-z0-9_]*)\s*(?:=|\()/g;
  let match;

  while ((match = componentRegex.exec(sourceText)) !== null) {
    const name = match[1];
    registerSymbol(context, relativePath, createNode({
      name,
      kind: 'component',
      relativePath,
      fileName,
      start: match.index,
      category: classifyNode(name, 'component')
    }));
  }

  while ((match = hookRegex.exec(sourceText)) !== null) {
    const name = match[1];
    registerSymbol(context, relativePath, createNode({
      name,
      kind: 'hook',
      relativePath,
      fileName,
      start: match.index,
      category: 'hook'
    }));
  }
}


// Default exports with named declarations can already be seen by class/function scans.
// Register through the normal symbol path so existing dedupe keeps one node per file/name.
// Keep the exported symbol by file so default imports can resolve aliases like `import List from './invoice-list'`.
function extractDefaultExportSymbols(sourceFile, relativePath, fileName, context) {
  const defaultSymbol = sourceFile.getDefaultExportSymbol?.();

  if (!defaultSymbol) {
    return;
  }

  const declarations = defaultSymbol.getDeclarations?.() || [];

  for (const declaration of declarations) {
    const name = inferDefaultExportName(declaration, relativePath);

    if (!name) {
      continue;
    }

    const kind = inferDefaultExportKind(declaration, name);
    
    const node = createNode({name, kind, relativePath, fileName, 
      start: declaration.getStart?.() || 0, category: classifyNode(name, kind)});

    registerSymbol(context, relativePath, node);
    context.defaultSymbolByPath?.set(relativePath, node);
  }
}

function resolveRelativeImportPath(fromRelativePath, moduleSpecifier, knownPaths) {
  const fromDir = path.dirname(fromRelativePath);
  const normalizedBase = path.normalize(path.join(fromDir, moduleSpecifier)).replace(/\\/g, '/');
  const candidates = [
    normalizedBase,
    `${normalizedBase}.ts`,
    `${normalizedBase}.tsx`,
    `${normalizedBase}.js`,
    `${normalizedBase}.jsx`,
    `${normalizedBase}/index.ts`,
    `${normalizedBase}/index.tsx`,
    `${normalizedBase}/index.js`,
    `${normalizedBase}/index.jsx`
  ];

  return candidates.find((candidate) => knownPaths.has(candidate)) || null;
}

function resolveImportPath(fromRelativePath, moduleSpecifier, context) {
  const knownPaths = new Set(context.fileSymbolsByPath.keys());

  if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/')) {
    return resolveRelativeImportPath(fromRelativePath, moduleSpecifier, knownPaths);
  }

  for (const alias of context.pathAliases || []) {
    const match = matchPathAlias(moduleSpecifier, alias);
    if (!match) continue;

    for (const target of match.targets) {
      const resolved = resolveFromProjectRoot(target, knownPaths);
      if (resolved) return resolved;
    }
  }

  return null;
}

function readPathAliases(rootPath, sourceText) {
  const tsConfigPath = path.join(rootPath, 'tsconfig.json');

  if (sourceText === undefined && !fs.existsSync(tsConfigPath)) {
    return [];
  }

  try {
    const raw = stripJsonComments(sourceText === undefined ? fs.readFileSync(tsConfigPath, 'utf8') : sourceText);
    const parsed = JSON.parse(raw);
    const compilerOptions = parsed.compilerOptions || {};
    const baseUrl = compilerOptions.baseUrl || '.';
    const paths = compilerOptions.paths || {};

    return Object.entries(paths).map(([pattern, targets]) => ({
      pattern,
      targets: (Array.isArray(targets) ? targets : [targets]).map((target) => {
        return path.posix.normalize(path.posix.join(baseUrl.replace(/\\/g, '/'), String(target).replace(/\\/g, '/')));
      })
    }));
  } catch {
    return [];
  }
}

function stripJsonComments(value) {
  return String(value)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function matchPathAlias(moduleSpecifier, alias) {
  const starIndex = alias.pattern.indexOf('*');

  if (starIndex === -1) {
    return moduleSpecifier === alias.pattern ? { targets: alias.targets } : null;
  }

  const prefix = alias.pattern.slice(0, starIndex);
  const suffix = alias.pattern.slice(starIndex + 1);

  if (!moduleSpecifier.startsWith(prefix) || !moduleSpecifier.endsWith(suffix)) {
    return null;
  }

  const wildcard = moduleSpecifier.slice(prefix.length, moduleSpecifier.length - suffix.length);
  return {
    targets: alias.targets.map((target) => target.replace('*', wildcard))
  };
}

function resolveFromProjectRoot(normalizedBase, knownPaths) {
  const candidates = [
    normalizedBase,
    `${normalizedBase}.ts`,
    `${normalizedBase}.tsx`,
    `${normalizedBase}.js`,
    `${normalizedBase}.jsx`,
    `${normalizedBase}/index.ts`,
    `${normalizedBase}/index.tsx`,
    `${normalizedBase}/index.js`,
    `${normalizedBase}/index.jsx`
  ];

  return candidates.find((candidate) => knownPaths.has(candidate)) || null;
}

function inferDefaultExportName(declaration, relativePath) {
  const namedDeclarationName = declaration.getName?.();

  if (namedDeclarationName) {
    return namedDeclarationName;
  }

  const symbolName = declaration.getSymbol?.()?.getName?.();

  if (symbolName && symbolName !== "default") {
    return symbolName;
  }

  return inferNameFromFilePath(relativePath);
}

function inferNameFromFilePath(relativePath) {
  const baseName = path.basename(relativePath).replace(/\.(tsx?|jsx?)$/, "");

  return baseName
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("") || "DefaultExport";
}

function inferDefaultExportKind(declaration, name) {
  const kindName = declaration.getKindName?.() || "";

  if (kindName.includes("Class")) {
    return "class";
  }

  if (kindName.includes("Function")) {
    return isHookName(name) ? "hook" : "function";
  }

  if (kindName.includes("Interface")) {
    return "interface";
  }

  if (kindName.includes("TypeAlias")) {
    return "type";
  }

  return isHookName(name) ? "hook" : "component";
}

function registerSymbol(context, relativePath, node) {
  if (!node?.label) return;

  const key = `${relativePath}:${node.label}`;

  if (context.seenNodeKeys.has(key)) {
    return;
  }

  context.seenNodeKeys.add(key);
  context.nodes.push(node);

  if (!context.symbolsByName.has(node.label)) {
    context.symbolsByName.set(node.label, []);
  }
  context.symbolsByName.get(node.label).push(node);

  if (!context.fileSymbolsByPath.has(relativePath)) {
    context.fileSymbolsByPath.set(relativePath, []);
  }
  context.fileSymbolsByPath.get(relativePath).push(node);
}

function extractImportEdges(sourceFile, relativePath, context) {
  const sourceSymbols = context.fileSymbolsByPath.get(relativePath) || [];
  collectReExportAliases(sourceFile, relativePath, context);

  if (!sourceSymbols.length) return;

  extractReExportEdges(sourceFile, relativePath, context, sourceSymbols);

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
    const targetPath = resolveImportPath(relativePath, moduleSpecifier, context);

    for (const element of importDeclaration.getNamedImports()) {
      const importName = element.getAliasNode()?.getText() || element.getName();
      const exportedName = element.getName();
      const targetSymbols = targetPath
        ? findExportedSymbols(context, targetPath, exportedName)
        : context.symbolsByName.get(exportedName) || [];
      addImportEdges(context.edges, sourceSymbols, targetSymbols, importName, 'importa');
    }

    const defaultImport = importDeclaration.getDefaultImport();
    if (defaultImport) {
      const importName = defaultImport.getText();
      const defaultTarget = targetPath ? context.defaultSymbolByPath?.get(targetPath) : null;
      const targetSymbols = defaultTarget ? [defaultTarget] : context.symbolsByName.get(importName) || [];
      addImportEdges(context.edges, sourceSymbols, targetSymbols, importName, 'importa default');
    }
  }
}

function extractReExportEdges(sourceFile, relativePath, context, sourceSymbols) {
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDeclaration.getModuleSpecifierValue?.();

    if (!moduleSpecifier) {
      continue;
    }

    const targetPath = resolveImportPath(relativePath, moduleSpecifier, context);
    if (!targetPath) continue;

    const namedExports = exportDeclaration.getNamedExports();

    if (!namedExports.length) {
      addImportEdges(context.edges, sourceSymbols, context.fileSymbolsByPath.get(targetPath) || [], moduleSpecifier, 're-exporta');
      continue;
    }

    for (const namedExport of namedExports) {
      const exportedName = namedExport.getName();
      const alias = namedExport.getAliasNode()?.getText() || exportedName;
      addImportEdges(context.edges, sourceSymbols, findExportedSymbols(context, targetPath, exportedName), alias, 're-exporta');
    }
  }
}

function collectReExportAliases(sourceFile, relativePath, context) {
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDeclaration.getModuleSpecifierValue?.();
    if (!moduleSpecifier) continue;

    const targetPath = resolveImportPath(relativePath, moduleSpecifier, context);
    if (!targetPath) continue;

    if (!context.exportAliasesByPath.has(relativePath)) {
      context.exportAliasesByPath.set(relativePath, new Map());
    }

    const aliases = context.exportAliasesByPath.get(relativePath);
    const namedExports = exportDeclaration.getNamedExports();

    if (!namedExports.length) {
      for (const symbol of context.fileSymbolsByPath.get(targetPath) || []) {
        aliases.set(symbol.label, symbol);
      }
      continue;
    }

    for (const namedExport of namedExports) {
      const exportedName = namedExport.getName();
      const alias = namedExport.getAliasNode()?.getText() || exportedName;
      const targets = findExportedSymbols(context, targetPath, exportedName);
      if (targets[0]) aliases.set(alias, targets[0]);
    }
  }
}

function findExportedSymbols(context, targetPath, exportedName) {
  const alias = context.exportAliasesByPath?.get(targetPath)?.get(exportedName);
  if (alias) {
    return [alias];
  }

  if (exportedName === 'default') {
    const defaultTarget = context.defaultSymbolByPath?.get(targetPath);
    return defaultTarget ? [defaultTarget] : [];
  }

  return (context.fileSymbolsByPath.get(targetPath) || []).filter((node) => node.label === exportedName);
}

function addImportEdges(edges, sourceSymbols, targetSymbols, importName, label) {
  for (const sourceSymbol of sourceSymbols) {
    for (const targetSymbol of targetSymbols) {
      if (sourceSymbol.id === targetSymbol.id) continue;

      edges.push({
        id: `ts-edge-${sourceSymbol.id}-${targetSymbol.id}-${simpleHash(importName)}`,
        from: sourceSymbol.id,
        to: targetSymbol.id,
        relation: 'imports',
        label
      });
    }
  }
}

function createNode({ name, kind, relativePath, fileName, start, category }) {
  if (!name) return null;

  const hash = simpleHash(`${relativePath}:${name}`);

  return {
    id: `ts-${hash}`,
    label: name,
    kind,
    category,
    namespace: path.dirname(relativePath),
    projectName: null,
    layer: inferLayer(relativePath),
    feature: inferFeature(relativePath),
    file: relativePath,
    subtitle: `${fileName}:${start || 0}`
  };
}

function classifyNode(name = '', kind) {
  if (isHookName(name) || kind === 'hook') return 'hook';
  if (name.endsWith('Provider')) return 'provider';
  if (name.endsWith('Context')) return 'context';
  if (name.endsWith('Service')) return 'service';
  if (name.endsWith('Component') || kind === 'component' || /^[A-Z]/.test(name)) return 'component';

  return 'symbol';
}

function isInterestingVariableSymbol(name) {
  return /^[A-Z][A-Za-z0-9_]*$/.test(name) || isHookName(name) || name.endsWith('Provider');
}

function isHookName(name = '') {
  return /^use[A-Z0-9_]/.test(name);
}

function inferLayer(relativePath) {
  const pathLower = `/${relativePath.toLowerCase()}`;

  if (pathLower.includes('/components/')) return 'presentation';
  if (pathLower.includes('/hooks/')) return 'logic';
  if (pathLower.includes('/utils/') || pathLower.includes('/lib/')) return 'common';
  if (pathLower.includes('/services/') || pathLower.includes('/api/')) return 'services';
  if (pathLower.includes('/types/') || pathLower.includes('/interfaces/')) return 'types';

  return 'unknown';
}

function inferFeature(relativePath) {
  const parts = relativePath.split('/');
  const commonDirs = new Set(['src', 'app', 'pages', 'components', 'hooks', 'utils', 'lib', 'types', 'features']);

  for (const part of parts) {
    if (part.includes('.')) continue;
    if (!commonDirs.has(part.toLowerCase())) {
      return part;
    }
  }

  return 'shared';
}

function filterNodes(nodes, { layers = [], features = [] }) {
  const layerFilter = new Set(layers.filter((item) => item && item !== '__none__'));
  const featureFilter = new Set(features.filter((item) => item && item !== '__none__'));

  return nodes.filter((node) => {
    if (layers.includes('__none__')) return false;
    if (features.includes('__none__')) return false;
    if (layerFilter.size && !layerFilter.has(node.layer)) return false;
    if (featureFilter.size && !featureFilter.has(node.feature)) return false;
    return true;
  });
}

function uniqueEdges(edges) {
  const seen = new Set();
  const unique = [];

  for (const edge of edges) {
    if (seen.has(edge.id)) continue;
    seen.add(edge.id);
    unique.push(edge);
  }

  return unique;
}

function simpleHash(str) {
  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  return Math.abs(hash).toString(16);
}

export function searchSymbols(result, query) {
  if (!result.success) {
    return {
      success: false,
      message: result.message,
      nodes: [],
      edges: []
    };
  }

  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      success: true,
      message: 'Escreve um símbolo para pesquisar',
      nodes: [],
      edges: []
    };
  }

  const matches = result.nodes.filter((node) =>
    node.label.toLowerCase().includes(q) ||
    node.kind.toLowerCase().includes(q) ||
    node.category.toLowerCase().includes(q) ||
    node.file.toLowerCase().includes(q)
  ).slice(0, 20);

  return {
    success: true,
    message: `Encontrei ${matches.length} símbolos com "${query}"`,
    nodes: matches,
    edges: [],
    projectType: 'typescript'
  };
}

export function expandNode(result, nodeId, direction = 'both') {
  if (!result.success) {
    return {
      success: false,
      message: result.message,
      nodes: [],
      edges: []
    };
  }

  const target = result.nodes.find((node) => node.id === nodeId);

  if (!target) {
    return {
      success: false,
      message: 'Nó não encontrado',
      nodes: [],
      edges: []
    };
  }

  const outgoing = result.edges.filter((edge) => edge.from === nodeId);
  const incoming = result.edges.filter((edge) => edge.to === nodeId);
  const selectedEdges = direction === 'both'
    ? [...outgoing, ...incoming]
    : direction === 'out'
      ? outgoing
      : incoming;
  const nodeIds = new Set([nodeId]);

  for (const edge of selectedEdges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }

  return {
    success: true,
    message: `${target.label}: ${outgoing.length} dependências, ${incoming.length} referências`,
    nodes: result.nodes.filter((node) => nodeIds.has(node.id)),
    edges: selectedEdges,
    projectType: 'typescript'
  };
}
