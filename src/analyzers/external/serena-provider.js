import { normalizeProviderDescriptor } from "../common/analyzer-provider-contract.js";

// Semantic capabilities verified against the pinned image; not an agent provider.
export const SERENA_PROVIDER = normalizeProviderDescriptor({
  id: "external.serena-python", version: "1-f8f53b77-pyright-1.1.403", kind: "external", priority: 50, languages: ["python"],
  capabilities: { boundedSourceAnalysis: "structural", detection: "structural", symbols: "semantic", definitions: "semantic", references: "semantic" }
});
