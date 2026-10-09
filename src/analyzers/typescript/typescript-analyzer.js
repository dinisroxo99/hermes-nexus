/**
 * TypeScript Analyzer
 *
 * Initial analyzer for TypeScript/JavaScript projects using ts-morph.
 * Extracts imports, exports, React components, hooks, providers, types and interfaces.
 */

import { Project, ts } from 'ts-morph';
import fs from 'node:fs';
import path from 'node:path';
import { compareContextStrings, normalizeContextSources } from '../../lib/project-context-files.js';

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
    const snapshotConfig = snapshot ? readSnapshotTsConfig(rootPath, snapshot) : null;
    const tsProject = new Project(snapshot ? {
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, noLib: true, ...snapshotConfig.checkerOptions }
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
    const pathAliases = snapshot
      ? snapshotConfig.aliases
      : readPathAliases(rootPath, undefined);
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

    // F1: a source file without top-level symbols still imports. In snapshot (provider) mode it gets one
    // module anchor so its imports are represented as edges. Anchors never enter symbolsByName or
    // fileSymbolsByPath, so they are never re-export aliases, name matches or symbol-import targets.
    // N1/D11 (amends the F1 anchor contract): a module anchor is never a name match, never a re-export alias,
    // never in symbolsByName or fileSymbolsByPath, and never the target of a symbol import or of symbol
    // resolution through a barrel. The ONLY edges into an anchor are file-level dependency edges into a PURE
    // BARREL's anchor (see isPureBarrel), snapshot mode only: importer -> pure barrel (`importa barrel`) and
    // outer barrel -> pure barrel (`re-exporta barrel`). Anchors of every other file (side-effect-only,
    // imports-only, type-only files without `from` such as a local `export type { T }`, symbol-less mixed
    // barrels, any non-barrel) receive no edges. Type-only RE-EXPORT files (`export type * from`,
    // `export type { T } from`) are pure barrels and do receive them.
    const codePaths = snapshot ? new Set(snapshot.map((file) => file.path).filter((file) => /\.(ts|tsx|js|jsx)$/i.test(file))) : null;
    const anchorByPath = new Map();
    if (snapshot) {
      for (const sourceFile of sourceFiles) {
        const relativePath = normalizeRelativePath(rootPath, sourceFile.getFilePath());
        if (fileSymbolsByPath.has(relativePath) || localModuleTargets(sourceFile, relativePath, { pathAliases, knownPaths: codePaths }).size === 0) continue;
        const anchor = createModuleAnchor(relativePath);
        seenNodeKeys.add(`${relativePath}:${anchor.label}`);
        nodes.push(anchor);
        anchorByPath.set(relativePath, anchor);
      }
    }

    // N1: re-exporting modules ("barrels": any code file with at least one `export … from '<module>'`) are resolved
    // name-by-name through the compiler's export table (stars, chains, cycles, aliases, default-as, `export * as ns`,
    // type-only), snapshot only. Only PURE barrels (isPureBarrel) may receive the D10/D11 anchor edges.
    const barrel = snapshot ? createBarrelContext(tsProject, { rootPath, pathAliases, codePaths, fileSymbolsByPath, defaultSymbolByPath }) : null;

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
        anchorByPath,
        barrel,
        defaultSymbolByPath,
        exportAliasesByPath,
        pathAliases,
        rootPath
      });
    }

    // F1: every local module reference the graph still cannot represent (namespace or side-effect import,
    // dynamic import/require, unregistered export name, symbol-less target, analyzer-ignored file) is counted
    // so the provider reports partial instead of a silently complete graph. Counted before any cap.
    // N1 tsconfig: a snapshot tsconfig that could not be read completely (invalid JSONC or option, unresolved or
    // cyclic `extends`, root `references` or a jsconfig.json that are not read yet) is counted too. This does not
    // make every alias divergence visible: the open resolver gaps in docs/typescript-barrel-reexports.md remain.
    const unrepresentedImports = snapshot
      ? countUnrepresentedImports(tsProject.getSourceFiles(), { rootPath, nodes, edges, exportAliasesByPath, pathAliases, knownPaths: codePaths, barrel }) + snapshotConfig.issues
      : 0;

    const filteredNodes = filterNodes(nodes, { layers, features });
    if (snapshot) {
      filteredNodes.sort(compareSnapshotNodes);
    }
    const allowedNodeIds = new Set(filteredNodes.map((node) => node.id));
    const limitedNodes = filteredNodes.slice(0, nodeLimit);
    const limitedNodeIds = new Set(limitedNodes.map((node) => node.id));
    const eligibleEdges = uniqueEdges(edges, Boolean(snapshot))
      .filter((edge) => allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to));
    if (snapshot) {
      eligibleEdges.sort(compareSnapshotEdges);
    }
    const retainedEdges = eligibleEdges.filter((edge) => limitedNodeIds.has(edge.from) && limitedNodeIds.has(edge.to));
    const limitedEdges = retainedEdges
      .slice(0, edgeLimit);
    const limited = limitedNodes.length < filteredNodes.length || limitedEdges.length < retainedEdges.length;

    return {
      success: true,
      projectType: 'typescript',
      message: `Analisei ${limitedNodes.length} símbolos TypeScript`,
      nodes: limitedNodes,
      edges: limitedEdges,
      limited,
      unrepresentedImports,
      originalNodeCount: filteredNodes.length,
      originalEdgeCount: retainedEdges.length,
      metadata: {
        totalFiles: files.length,
        totalSymbols: filteredNodes.length,
        totalEdges: retainedEdges.length,
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
  const knownPaths = context.knownPaths || new Set(context.fileSymbolsByPath.keys());

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
    // Snapshot (N1 review P1): TypeScript tries only the best-matching pattern's targets, never a later pattern.
    if (context.pathAliases.bestMatchOnly) return null;
  }

  return null;
}

// N1 review P1 (snapshot mode only): order tsconfig `paths` patterns the way TypeScript selects among patterns that
// match one specifier: an exact pattern (no `*`) before any wildcard, then the wildcard with the longest prefix before
// the `*`; ties keep the tsconfig order (stable sort). With `bestMatchOnly`, resolveImportPath tries only the first
// matching pattern, so imports, re-exports, anchors and the unrepresented counter all select the module the compiler
// selects. Only snapshot-admitted paths are candidates (D6a: no host reads). Legacy analysis keeps its order.
function typescriptPathAliasPrecedence(aliases) {
  const rank = (alias) => {
    const star = alias.pattern.indexOf('*');
    return star === -1 ? Number.POSITIVE_INFINITY : star;
  };
  const ordered = aliases.map((alias, index) => ({ alias, index }))
    .sort((left, right) => rank(right.alias) - rank(left.alias) || left.index - right.index)
    .map(({ alias }) => alias);
  Object.defineProperty(ordered, 'bestMatchOnly', { value: true });
  return ordered;
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

// N1 tsconfig (user option A, snapshot mode only): ONE reading of the snapshot's tsconfig.json, done by TypeScript's own
// JSONC config parser (comments, trailing commas, `/*` or `*/` inside strings such as include globs) and config-file
// semantics (`extends`, `paths` relative to the config that declares them, `baseUrl`). It feeds BOTH the alias
// resolver (`aliases`, ordered by typescriptPathAliasPrecedence) and the D6a checker (`checkerOptions`), so the two
// cannot disagree about the config. The parse host answers only from snapshot entries: `extends` resolves only to
// configs admitted to the snapshot and nothing is read from the host file system (D6a). Every config diagnostic
// except "no inputs" (the host lists no directories on purpose) is kept as an issue: an invalid config, an unresolved
// `extends` or an `extends` cycle is counted as unrepresented (partial) and never collapses into an empty config;
// whatever TypeScript could still read (own `paths`, a readable base) stays in use. Legacy mode keeps readPathAliases.
// N1 B-3 (replaces B-2(b)): only the ROOT tsconfig.json is read. Every other tsconfig.json or jsconfig.json in the
// snapshot (nested or subdirectory configs, a root jsconfig.json, case variants such as TSConfig.json; basename,
// case-insensitive; tsconfig.*.json variants are not project configs and are ignored) and root `references` (even
// when the referenced config is not in the snapshot) can hold aliases this reading does not see. Together they add ONE
// issue per project (partial) instead of leaving importers silently missing. Only snapshot entries are enumerated;
// none of these configs is read. Reading the nearest config per directory and the references is B-2(c).
const TSCONFIG_NO_INPUTS = 18003;
const UNREAD_PROJECT_CONFIG = /^(tsconfig|jsconfig)\.json$/i;
function readSnapshotTsConfig(rootPath, snapshot) {
  const entry = snapshot.find((file) => file.path === 'tsconfig.json');
  const unreadConfigs = snapshot.some((file) => file.path !== 'tsconfig.json' && UNREAD_PROJECT_CONFIG.test(file.path.slice(file.path.lastIndexOf('/') + 1))) ? 1 : 0;
  if (!entry) return { aliases: typescriptPathAliasPrecedence([]), checkerOptions: {}, issues: unreadConfigs };
  const root = rootPath.replace(/\\/g, '/');
  const texts = new Map(snapshot.map((file) => [path.posix.join(root, file.path), file.text]));
  const host = {
    useCaseSensitiveFileNames: true,
    readDirectory: () => [],
    fileExists: (file) => texts.has(file),
    readFile: (file) => texts.get(file)
  };
  const configFileName = path.posix.join(root, 'tsconfig.json');
  const sourceFile = ts.parseJsonText(configFileName, entry.text);
  const parsed = ts.parseJsonSourceFileConfigFileContent(sourceFile, host, root, undefined, configFileName);
  const unreadReferences = parsed.projectReferences?.length ? 1 : 0;
  const issues = [...(sourceFile.parseDiagnostics || []), ...parsed.errors]
    .filter((diagnostic) => diagnostic.code !== TSCONFIG_NO_INPUTS).length + Math.max(unreadReferences, unreadConfigs);
  const { paths, baseUrl, pathsBasePath } = parsed.options;
  if (!paths || typeof paths !== 'object') return { aliases: typescriptPathAliasPrecedence([]), checkerOptions: {}, issues };
  const base = baseUrl || pathsBasePath || root;
  const aliases = Object.entries(paths).map(([pattern, targets]) => ({
    pattern,
    targets: (Array.isArray(targets) ? targets : [targets]).map((target) => {
      return path.posix.relative(root, path.posix.resolve(base, String(target).replace(/\\/g, '/')));
    })
  }));
  return { aliases: typescriptPathAliasPrecedence(aliases), checkerOptions: { paths, ...(baseUrl ? { baseUrl } : { pathsBasePath: base }) }, issues };
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
  const anchor = context.anchorByPath?.get(relativePath);
  const sourceSymbols = context.fileSymbolsByPath.get(relativePath) || (anchor ? [anchor] : []);
  collectReExportAliases(sourceFile, relativePath, context);

  if (!sourceSymbols.length) return;

  extractReExportEdges(sourceFile, relativePath, context, sourceSymbols);

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
    const barrelPath = barrelTargetPath(context.barrel, relativePath, moduleSpecifier);
    if (barrelPath) {
      for (const binding of importBindings(importDeclaration)) {
        const targets = barrelExportOrigins(context.barrel, barrelPath, binding.exportedName).symbols;
        addImportEdges(context.edges, sourceSymbols, targets, binding.importName, binding.exportedName === 'default' ? 'importa default' : 'importa');
      }
      // D10: the file-level dependency on a PURE barrel is an edge into its anchor (D11: the only edges anchors may receive).
      addBarrelAnchorEdge(context, sourceSymbols, barrelPath, moduleSpecifier, 'importa barrel');
      continue;
    }
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

    if (context.barrel) {
      const targetPath = resolveImportPath(relativePath, moduleSpecifier, { ...context, knownPaths: context.barrel.codePaths });
      if (!targetPath) continue;
      for (const origin of reExportOrigins(context.barrel, exportDeclaration, targetPath)) {
        addImportEdges(context.edges, sourceSymbols, origin.symbols, origin.name, 're-exporta');
      }
      if (context.barrel.barrelPaths.has(targetPath)) addBarrelAnchorEdge(context, sourceSymbols, targetPath, moduleSpecifier, 're-exporta barrel');
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

// N1/D10 + D11: the file-level dependency on a PURE barrel is one edge into its anchor. Any other target (a mixed
// barrel, a symbol-less non-barrel, a file without an anchor) gets no anchor edge; the D10 guard in
// barrelRequiredFiles then counts the unlinked barrel file, so the provider is partial instead of silently complete.
function addBarrelAnchorEdge(context, sourceSymbols, barrelPath, moduleSpecifier, label) {
  if (!context.barrel.pureBarrelPaths.has(barrelPath)) return;
  const anchor = context.anchorByPath.get(barrelPath);
  if (anchor) addImportEdges(context.edges, sourceSymbols, [anchor], moduleSpecifier, label);
}

function createBarrelContext(tsProject, { rootPath, pathAliases, codePaths, fileSymbolsByPath, defaultSymbolByPath }) {
  const sourceFileByPath = new Map();
  const barrelPaths = new Set();
  const pureBarrelPaths = new Set();
  for (const sourceFile of tsProject.getSourceFiles()) {
    const relativePath = normalizeRelativePath(rootPath, sourceFile.getFilePath());
    sourceFileByPath.set(relativePath, sourceFile);
    if (sourceFile.getExportDeclarations().some((declaration) => declaration.getModuleSpecifierValue?.())) barrelPaths.add(relativePath);
    if (isPureBarrel(sourceFile)) pureBarrelPaths.add(relativePath);
  }
  return { rootPath, pathAliases, codePaths, fileSymbolsByPath, defaultSymbolByPath, sourceFileByPath, barrelPaths, pureBarrelPaths, exportTables: new Map() };
}

// N1 pure-barrel definition (verifiable, syntactic): a file is a PURE barrel iff it has at least one top-level
// statement and EVERY top-level statement is a re-export declaration with a module specifier (`export * from`,
// `export * as ns from`, `export { a, b as c } from`, and the type-only forms `export type * from` and
// `export type { T } from`). The type-only forms are accepted because the relation they express is a structural
// type-level dependency, not runtime execution. Local declarations (including local type declarations such as
// `type T = …` or `interface I {}`) and local exports without `from` (`export {}`, `export { x }`, `export type { T }`)
// stay outside the definition. A pure barrel therefore declares nothing, exports nothing of its own, imports nothing
// and runs no side-effect statement. Having no recognised graph symbols is NOT sufficient: a symbol-less file with a
// re-export plus anything else (a lowercase `export const`, an import, a local `export { x }` or `export {}`, a
// side-effect statement) is a MIXED barrel and never receives an anchor edge.
function isPureBarrel(sourceFile) {
  const statements = sourceFile.getStatements();
  return statements.length > 0 && statements.every((statement) => statement.getKindName() === 'ExportDeclaration'
    && Boolean(statement.getModuleSpecifierValue?.()));
}

function barrelTargetPath(barrel, fromRelativePath, moduleSpecifier) {
  if (!barrel || !barrel.barrelPaths.size) return null;
  const target = resolveImportPath(fromRelativePath, moduleSpecifier, { pathAliases: barrel.pathAliases, knownPaths: barrel.codePaths });
  return target && target !== fromRelativePath && barrel.barrelPaths.has(target) ? target : null;
}

function importBindings(importDeclaration) {
  const bindings = importDeclaration.getNamedImports().map((element) => ({
    exportedName: element.getName(), importName: element.getAliasNode()?.getText() || element.getName()
  }));
  const defaultImport = importDeclaration.getDefaultImport();
  if (defaultImport) bindings.push({ exportedName: 'default', importName: defaultImport.getText() });
  return bindings;
}

function exportTable(barrel, targetPath) {
  if (!barrel.exportTables.has(targetPath)) {
    const sourceFile = barrel.sourceFileByPath.get(targetPath);
    // The compiler's export table follows `export *` chains and cycles and applies aliases, default-as and
    // namespace re-exports; a name it cannot resolve has no declarations and is reported unrepresented.
    barrel.exportTables.set(targetPath, sourceFile ? sourceFile.getExportedDeclarations() : new Map());
  }
  return barrel.exportTables.get(targetPath);
}

function declarationOrigin(barrel, declaration, name) {
  const file = normalizeRelativePath(barrel.rootPath, declaration.getSourceFile().getFilePath());
  const fileSymbols = barrel.fileSymbolsByPath.get(file) || [];
  if (declaration.getKindName() === 'SourceFile') return { file, symbols: fileSymbols };
  const declaredName = declaration.getName?.();
  const isDefault = name === 'default' || declaration.isDefaultExport?.();
  const symbols = fileSymbols.filter((node) => node.label === declaredName);
  const defaultSymbol = isDefault ? barrel.defaultSymbolByPath.get(file) : null;
  if (defaultSymbol && !symbols.includes(defaultSymbol)) symbols.push(defaultSymbol);
  return { file, symbols };
}

function originDeclarations(barrel, targetPath, name, seen) {
  if (seen.has(targetPath)) return [];
  seen.add(targetPath);
  const declarations = [...(exportTable(barrel, targetPath).get(name) || [])];
  // An `export *` name provided by two or more star sources is ambiguous (TS2308; excluded at runtime). The compiler
  // keeps only the first; this walk also links the other star candidates it finds (a conservative union, not a
  // resolution), and D3a (ambiguityGuard) counts the name so the result is partial. `seen` bounds the walk on
  // `export *` cycles.
  const sourceFile = name === 'default' ? null : barrel.sourceFileByPath.get(targetPath);
  const stars = (sourceFile?.getExportDeclarations() || []).filter((declaration) => declaration.getModuleSpecifierValue?.()
    && !declaration.getNamedExports().length && !declaration.getNamespaceExport?.());
  if (stars.length > 1) {
    for (const star of stars) {
      const starPath = resolveImportPath(targetPath, star.getModuleSpecifierValue(), { pathAliases: barrel.pathAliases, knownPaths: barrel.codePaths });
      if (!starPath || starPath === targetPath) continue;
      for (const declaration of originDeclarations(barrel, starPath, name, seen)) if (!declarations.includes(declaration)) declarations.push(declaration);
    }
  }
  return declarations;
}

// N1 review A-3: `export { default } from` gives the barrel its OWN default export, which extractSymbols registers as a
// regular graph symbol of the barrel (never an anchor), so such a barrel has no anchor. A `default` binding therefore
// also links that own symbol, as the base did: the importer's file-level dependency on the barrel is represented (D10
// guard satisfied) and the barrel as Impact target reaches the importer. Only `symbols` grows; `files` stays the
// compiler's origin set, so D3a ambiguity accounting is unchanged. No anchor, name match or D11 edge is involved.
function barrelExportOrigins(barrel, targetPath, name) {
  const origins = originDeclarations(barrel, targetPath, name, new Set()).map((declaration) => declarationOrigin(barrel, declaration, name));
  const symbols = [...new Set(origins.flatMap((origin) => origin.symbols))];
  const ownDefault = name === 'default' ? barrel.defaultSymbolByPath.get(targetPath) : null;
  if (ownDefault && ownDefault.file === targetPath && ownDefault.kind !== 'module' && !symbols.includes(ownDefault)) symbols.push(ownDefault);
  return { files: [...new Set(origins.map((origin) => origin.file))].sort(), symbols };
}

function reExportOrigins(barrel, exportDeclaration, targetPath) {
  const namespaceExport = exportDeclaration.getNamespaceExport?.();
  if (namespaceExport) {
    return [{ name: namespaceExport.getName(), files: [targetPath], symbols: barrel.fileSymbolsByPath.get(targetPath) || [] }];
  }
  const named = exportDeclaration.getNamedExports();
  const names = named.length ? named.map((element) => element.getName()) : [...exportTable(barrel, targetPath).keys()].filter((name) => name !== 'default');
  return names.map((name) => ({ name, ...barrelExportOrigins(barrel, targetPath, name) }));
}

function barrelRequiredFiles(barrel, sourceFile, from) {
  const required = new Map();
  const add = (target, files) => {
    if (!required.has(target)) required.set(target, []);
    required.get(target).push(files);
  };
  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    const target = barrelTargetPath(barrel, from, importDeclaration.getModuleSpecifierValue());
    if (!target) continue;
    // D10 guard: the barrel file itself must be linked (pure-barrel anchor edge, or an edge to one of its own symbols);
    // otherwise (mixed barrel, namespace import of a mixed barrel, ...) the import counts as unrepresented.
    add(target, [target]);
    // N1 review P2: a namespace import has no named bindings, but `import D, * as ns from` still has a default binding,
    // which must be checked like any other default import (importBindings yields only that default here).
    for (const binding of importBindings(importDeclaration)) add(target, ambiguityGuard(barrelExportOrigins(barrel, target, binding.exportedName).files));
  }
  for (const exportDeclaration of sourceFile.getExportDeclarations()) {
    const specifier = exportDeclaration.getModuleSpecifierValue?.();
    if (!specifier) continue;
    const target = resolveImportPath(from, specifier, { pathAliases: barrel.pathAliases, knownPaths: barrel.codePaths });
    if (!target || target === from) continue;
    for (const origin of reExportOrigins(barrel, exportDeclaration, target)) add(target, ambiguityGuard(origin.files));
    if (barrel.barrelPaths.has(target)) add(target, [target]);
  }
  return required;
}

// D3a: a name provided by two or more star sources is ambiguous (TS2308; excluded at runtime). It is linked to the
// candidates the union walk found (conservative union) and counted as unrepresented, so the result is partial and
// never presented as a single resolution.
function ambiguityGuard(files) {
  return files.length > 1 ? [] : files;
}

const MODULE_ANCHOR_LABEL = '<module>';

function createModuleAnchor(relativePath) {
  return createNode({ name: MODULE_ANCHOR_LABEL, kind: 'module', relativePath, fileName: path.basename(relativePath), start: 0, category: 'module' });
}

function localModuleTargets(sourceFile, relativePath, context) {
  const targets = new Set();
  for (const literal of sourceFile.getImportStringLiterals()) {
    const target = resolveImportPath(relativePath, literal.getLiteralValue(), context);
    if (target && target !== relativePath) targets.add(target);
  }
  return targets;
}

function countUnrepresentedImports(allSourceFiles, { rootPath, nodes, edges, exportAliasesByPath, pathAliases, knownPaths, barrel }) {
  const fileById = new Map(nodes.map((node) => [node.id, node.file]));
  const linked = new Set(edges.map((edge) => `${fileById.get(edge.from)}\u0000${fileById.get(edge.to)}`));
  let count = 0;
  for (const sourceFile of allSourceFiles) {
    const from = normalizeRelativePath(rootPath, sourceFile.getFilePath());
    // N1: a binding imported or re-exported through a barrel is represented only by an edge to the file that DEFINES
    // it (never by an edge to some other file the barrel re-exports); an unresolvable name counts as unrepresented.
    const perName = barrel ? barrelRequiredFiles(barrel, sourceFile, from) : new Map();
    for (const [target, required] of perName) {
      for (const files of required) {
        if (!files.length || !files.some((file) => file === from || linked.has(`${from}\u0000${file}`))) count += 1;
      }
    }
    for (const target of localModuleTargets(sourceFile, from, { pathAliases, knownPaths })) {
      if (perName.has(target)) continue;
      const reach = [target, ...[...(exportAliasesByPath.get(target)?.values() || [])].map((symbol) => symbol.file)];
      if (!reach.some((file) => linked.has(`${from}\u0000${file}`))) count += 1;
    }
    count += unresolvedAliasImports(sourceFile, from, { pathAliases, knownPaths });
  }
  return count;
}

// N1 tsconfig: a non-relative specifier that matches a tsconfig `paths` pattern but resolves to no snapshot file is
// counted, even when the global name fallback draws some edge for it: that edge is not a module resolution.
function unresolvedAliasImports(sourceFile, relativePath, context) {
  let count = 0;
  for (const literal of sourceFile.getImportStringLiterals()) {
    const specifier = literal.getLiteralValue();
    if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
    if (!context.pathAliases.some((alias) => matchPathAlias(specifier, alias))) continue;
    if (!resolveImportPath(relativePath, specifier, context)) count += 1;
  }
  return count;
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

function uniqueEdges(edges, snapshot = false) {
  const unique = new Map();

  for (const edge of edges) {
    // Snapshot budgets count provider relationships, not alias-derived native IDs.
    const key = snapshot ? JSON.stringify([edge.from, edge.to, edge.relation]) : edge.id;
    const previous = unique.get(key);
    if (!previous || (snapshot && compareSnapshotEdges(edge, previous) < 0)) {
      unique.set(key, edge);
    }
  }

  return [...unique.values()];
}

function compareSnapshotNodes(a, b) {
  return compareContextStrings(a.file, b.file)
    || compareContextStrings(a.label, b.label)
    || compareContextStrings(a.kind, b.kind)
    || compareContextStrings(a.id, b.id);
}

function compareSnapshotEdges(a, b) {
  return compareContextStrings(a.from, b.from)
    || compareContextStrings(a.to, b.to)
    || compareContextStrings(a.relation, b.relation)
    || compareContextStrings(a.id, b.id)
    || compareContextStrings(a.label ?? '', b.label ?? '');
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
