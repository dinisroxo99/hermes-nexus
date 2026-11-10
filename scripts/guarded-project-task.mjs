import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { prepareGuardedTask } from "../src/lib/guarded-task-context.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

async function input() {
  let size = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 1024 * 1024) fail("guard_input_too_large");
    chunks.push(chunk);
  }
  const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  if (!body || typeof body !== "object" || Object.keys(body).length !== 2
      || !Object.hasOwn(body, "task") || !Array.isArray(body.calls)) fail("invalid_guard_request");
  return body;
}

function peerIntents(file) {
  if (!file) return [];
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > 256 * 1024) fail("invalid_guard_peers");
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const n = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!n) break;
      length += n;
    }
    if (length !== stat.size) fail("invalid_guard_peers");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
  } finally { fs.closeSync(fd); }
}

try {
  const { values } = parseArgs({ options: {
    "project-id": { type: "string" }, "root-id": { type: "string" }, worktree: { type: "string" },
    revision: { type: "string" }, "task-id": { type: "string" }, "hermes-checkout": { type: "string" },
    "peer-intents": { type: "string" }, python: { type: "string" }, read: { type: "string", multiple: true }, write: { type: "string", multiple: true }
  } });
  const { task, calls } = await input();
  if (!values["hermes-checkout"] || !values["task-id"] || task?.id !== values["task-id"]) fail("guard_task_mismatch");
  const location = { projectId: values["project-id"], worktree: { rootId: values["root-id"] || "default", relativePath: values.worktree } };
  const args = [location, task, values.revision, values.read || [], values.write || []];
  const prepare = () => prepareGuardedTask(...args, { peers: peerIntents(values["peer-intents"]) });
  const before = prepare();
  const command = ["-B", "-m", "integrations.hermes_guard", "--repo", before.directory, "--hermes-checkout", values["hermes-checkout"],
    "--revision", values.revision, "--task", task.id, ...args[3].flatMap((file) => ["--read", file]),
    ...args[4].flatMap((file) => ["--write", file])];
  const worker = spawnSync(values.python || "python3", command, { cwd: root, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: "1" },
    input: JSON.stringify({ calls, nexusContext: before.context }), encoding: "utf8", timeout: 90000, maxBuffer: 5 * 1024 * 1024 });
  if (worker.status !== 0 || worker.error) fail("guard_worker_unavailable");
  const result = JSON.parse(worker.stdout);
  if (result.status !== "completed" || result.authority?.revision !== values.revision || result.authority?.task !== task.id
      || typeof result.patch !== "string") fail("guard_invalid_worker_report");
  const after = prepare();
  if (after.directory !== before.directory || !before.receipt.equals(after.receipt)
      || JSON.stringify(after.context) !== JSON.stringify(before.context) || JSON.stringify(after.peers) !== JSON.stringify(before.peers)) fail("guard_project_changed");
  console.log(JSON.stringify({ ...result, projectId: location.projectId, worktree: location.worktree,
    snapshotToken: before.context.snapshotToken, comparedPeers: before.peers }));
} catch (error) {
  console.error(JSON.stringify({ error: /^[a-z_]{1,80}$/.test(error.code || "") ? error.code : "guard_request_failed" }));
  process.exitCode = 1;
}
