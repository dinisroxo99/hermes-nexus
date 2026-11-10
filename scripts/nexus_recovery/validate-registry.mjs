import { validateRegistryState } from "../../src/lib/registry-readiness.js";

// Internal recovery seam. Python already bounded the two raw registries before parsing them.
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error("registry_limit");
    chunks.push(chunk);
  }
  const { manual, discovered } = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  validateRegistryState(manual, discovered);
} catch {
  process.exitCode = 1;
}
