import fs from "node:fs";
import path from "node:path";
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createProviderSnapshot, PROVIDER_LIMITS } from "../common/analyzer-provider-contract.js";
import { createExternalSnapshotRequest, readExternalSnapshotResponse } from "./snapshot-provider.js";
import { SERENA_PROVIDER } from "./serena-provider.js";

export const SERENA_RUNTIME = Object.freeze({ deadlineMs: 30000, cleanupMs: 2000, responseBytes: PROVIDER_LIMITS.responseBytes });
export const isSerenaImageId = (image) => typeof image === "string" && /^sha256:[a-f0-9]{64}$/.test(image);

// Only a trusted immutable local image is configurable. No command, root, URL,
// tool dispatcher, inherited Docker context or client-supplied runtime settings.
export function runSerenaSnapshot(inputSnapshot, options = {}) {
  const start = performance.now();
  if (!isSerenaImageId(options.image)) return { status: "unavailable" };
  let root;
  let launched = false;
  let result = { status: "unavailable" };
  const name = `project-map-serena-${randomUUID()}`;
  const deadline = Number.isFinite(options.deadlineMs) ? Math.max(1, Math.min(SERENA_RUNTIME.deadlineMs, Math.floor(options.deadlineMs))) : SERENA_RUNTIME.deadlineMs;
  const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
  const dockerArgs = () => ["--host=unix:///var/run/docker.sock", "--config", path.join(root, "docker")];
  try {
    const snapshot = createProviderSnapshot({ projectId: inputSnapshot.projectId }, inputSnapshot.files, inputSnapshot.revision);
    if (snapshot.token !== inputSnapshot.token) return { status: "invalid" };
    const request = createExternalSnapshotRequest(snapshot, SERENA_PROVIDER);
    root = fs.mkdtempSync("/tmp/project-map-serena-");
    const source = path.join(root, "source");
    fs.mkdirSync(source, { mode: 0o755 });
    fs.mkdirSync(path.join(root, "docker"), { mode: 0o700 });
    for (const file of request.files) {
      const target = path.join(source, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
      fs.writeFileSync(target, file.text, { flag: "wx", mode: 0o444 });
    }
    const remaining = Math.floor(deadline - (performance.now() - start));
    if (remaining <= 0) return { status: "timeout" };
    launched = true;
    const run = childProcess.spawnSync("/usr/bin/docker", [...dockerArgs(), "run", "--name", name, "--rm", "--pull=never", "--network=none",
      "--read-only", "--user=65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--cpus=2", "--memory=1g", "--memory-swap=1g",
      "--pids-limit=64", "--log-driver=none", "--stop-timeout=1", "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m", "--shm-size=1m",
      "--mount", `type=bind,source=${source},target=/snapshot,readonly`, "--entrypoint=/usr/local/bin/python", "-i", options.image, "-P", "/opt/bridge.py"],
    { input: JSON.stringify(request), encoding: "utf8", shell: false, cwd: root, env, timeout: remaining, killSignal: "SIGKILL", maxBuffer: SERENA_RUNTIME.responseBytes });
    if (["ENOENT", "EACCES"].includes(run.error?.code)) launched = false;
    if (run.error?.code === "ETIMEDOUT") result = { status: "timeout" };
    else if (run.error?.code === "ENOBUFS" || Buffer.byteLength(run.stdout || "") > SERENA_RUNTIME.responseBytes) result = { status: "oversized" };
    else if (run.error || run.status === 125 || run.status === 127) result = { status: "unavailable" };
    else if (run.status !== 0) result = { status: "crashed" };
    else {
      readExternalSnapshotResponse(snapshot, SERENA_PROVIDER, run.stdout, { requireObservedSource: true });
      result = { status: "available", response: run.stdout };
    }
  } catch { result = { status: "invalid" }; }
  finally {
    if (launched) {
      // Killing the CLI does not kill a daemon-owned container. Remove it by our
      // generated name on every exit, including timeout and output overflow.
      try {
        const cleanup = childProcess.spawnSync("/usr/bin/docker", [...dockerArgs(), "rm", "--force", name],
          { encoding: "utf8", shell: false, env, timeout: SERENA_RUNTIME.cleanupMs, killSignal: "SIGKILL", maxBuffer: 4096 });
        if (cleanup.error || (cleanup.status !== 0 && !/^Error response from daemon: No such container: project-map-serena-[a-f0-9-]+\s*$/.test(cleanup.stderr || ""))) result = { status: "cleanup_failed" };
      } catch { result = { status: "cleanup_failed" }; }
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
  return result;
}
