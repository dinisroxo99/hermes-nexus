import { detectProjectType } from "./analyzer-detection.js";
import { dotNetAnalyzer } from "../dotnet/dotnet-analyzer.js";
import { typeScriptAnalyzer } from "../typescript/typescript-analyzer.js";

const analyzers = new Map();

export function registerAnalyzer(analyzer) {
  if (!analyzer?.projectType) {
    throw new Error("Analyzer must expose a projectType.");
  }

  analyzers.set(analyzer.projectType, analyzer);
}

export function getAnalyzer(projectType) {
  return analyzers.get(projectType) || null;
}

export function listAnalyzerCapabilities() {
  return Array.from(analyzers.values()).map((analyzer) => ({
    projectType: analyzer.projectType,
    name: analyzer.name,
    capabilities: analyzer.capabilities || {}
  }));
}

export function resolveAnalyzer(project) {
  const projectType = detectProjectType(project.absolutePath);
  const analyzer = getAnalyzer(projectType);

  return {
    projectType,
    analyzer
  };
}

registerAnalyzer(dotNetAnalyzer);
registerAnalyzer(typeScriptAnalyzer);
