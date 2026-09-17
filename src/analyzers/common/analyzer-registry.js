import { detectProjectType } from "./analyzer-detection.js";
import { dotNetAnalyzer } from "../dotnet/dotnet-analyzer.js";
import { typeScriptAnalyzer } from "../typescript/typescript-analyzer.js";
import { normalizeProviderDescriptor, PROVIDER_LIMITS, providerError } from "./analyzer-provider-contract.js";
import { SERENA_PROVIDER } from "../external/serena-provider.js";

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

export function listAnalyzerProviders(externalProviders = [], options = {}) {
  if (!Array.isArray(externalProviders) || externalProviders.length > PROVIDER_LIMITS.providers - 2) throw providerError();
  if (options.serena) externalProviders = [...externalProviders, SERENA_PROVIDER];
  if (externalProviders.length > PROVIDER_LIMITS.providers - 2) throw providerError();
  const capabilities = { boundedSourceAnalysis: "structural", detection: "structural", symbols: "structural", references: "structural", dependencies: "structural" };
  const providers = [
    normalizeProviderDescriptor({ id: "native.dotnet", version: "1", kind: "native", priority: 200, languages: ["csharp"], capabilities }),
    normalizeProviderDescriptor({ id: "native.typescript", version: "1", kind: "native", priority: 190, languages: ["typescript", "javascript"], capabilities }),
    ...externalProviders.map((provider) => {
      if (provider?.kind !== "external") throw providerError();
      return normalizeProviderDescriptor(provider);
    })
  ];
  if (new Set(providers.map((provider) => provider.id)).size !== providers.length) throw providerError();
  return providers.sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
