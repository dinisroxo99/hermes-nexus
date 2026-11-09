import { observeProjectOperation } from "../src/lib/project-operation-observation.js";

try {
  if (process.argv.length !== 2 || process.stdin.isTTY) {
    throw Object.assign(new Error(), { code: "usage: node scripts/observe-project-operation.mjs < request.json" });
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 65536) throw Object.assign(new Error(), { code: "request_body_too_large" });
    chunks.push(chunk);
  }
  let request;
  try { request = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw Object.assign(new Error(), { code: "invalid_json" }); }
  process.stdout.write(JSON.stringify(observeProjectOperation(request)) + "\n");
} catch (e) {
  process.stderr.write((e.code || "project_operation_failed") + "\n");
  process.exitCode = 1;
}
