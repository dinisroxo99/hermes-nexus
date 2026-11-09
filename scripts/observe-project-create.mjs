import { observeProjectCreate } from "../src/lib/project-create-observation.js";

try {
  if (process.argv.length !== 2 || process.stdin.isTTY) {
    throw new Error("usage: node scripts/observe-project-create.mjs < request.json");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 65536) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new Error("invalid_json");
  }
  process.stdout.write(JSON.stringify(observeProjectCreate(input)) + "\n");
} catch (cause) {
  const publicErrors = ["request_body_too_large", "invalid_json", "usage: node scripts/observe-project-create.mjs < request.json"];
  const message = cause.code || (publicErrors.includes(cause.message) ? cause.message : "create_observation_failed");
  process.stderr.write(message + "\n");
  process.exitCode = 1;
}
