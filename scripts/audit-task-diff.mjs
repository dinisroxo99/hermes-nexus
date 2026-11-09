import { auditTaskDiff, baselineDigest, captureDiffBaseline, MAX_RECEIPT_BYTES } from "../src/lib/task-diff-audit.js";

try {
  const [mode, projectId, rootId, relativePath, taskId, pin] = process.argv.slice(2);
  const capture = mode === "capture" && process.argv.length === 6;
  const compare = mode === "compare" && process.argv.length === 8;
  if ((!capture && !compare) || process.stdin.isTTY) throw new Error("usage");
  const chunks = [];
  let count = 0;
  for await (const chunk of process.stdin) {
    count += chunk.length;
    if (count > MAX_RECEIPT_BYTES) throw new Error("diff_input_too_large");
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks);
  const location = { projectId, worktree: { rootId, relativePath } };
  if (capture) {
    let task;
    try { task = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input)); }
    catch { throw new Error("invalid_json"); }
    const receipt = captureDiffBaseline(location, task);
    process.stdout.write(receipt);
    process.stderr.write(baselineDigest(receipt) + "\n");
  } else {
    const report = auditTaskDiff(location, taskId, input, pin);
    process.stdout.write(JSON.stringify(report) + "\n");
    if (report.finding === "outside_write_observed") process.exitCode = 2;
  }
} catch (cause) {
  const safe = ["usage", "invalid_json", "diff_input_too_large"].includes(cause.message) ? cause.message : cause.code;
  process.stderr.write((typeof safe === "string" && /^[a-z0-9_]+$/.test(safe) ? safe : "diff_unavailable") + "\n");
  process.exitCode = 1;
}
