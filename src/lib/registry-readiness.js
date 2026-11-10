import { mergeProjectRegistries, normalizeProjectEntryForRuntime } from "./project-registry.js";

export function validateRegistryState(manual, discovered) {
  const check = (rows, registrySource) => {
    if (!Array.isArray(rows) || rows.length > 10000) throw new Error("registry_invalid");
    return rows.map((row) => {
      const entry = normalizeProjectEntryForRuntime(row, { registrySource });
      if (!entry) throw new Error("registry_invalid");
      return entry;
    });
  };
  const merged = mergeProjectRegistries(check(manual, "manual"), check(discovered, "discovered"));
  if (merged.warnings.length) throw new Error("registry_invalid");
}
