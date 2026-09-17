import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import { createProviderSnapshot } from "../src/analyzers/common/analyzer-provider-contract.js";
import { runSerenaSnapshot } from "../src/analyzers/external/serena-transport.js";
import { analyzeContextSources } from "../src/lib/analyzer-service.js";

const enabled = process.env.SERENA_DOCKER_TESTS === "1";
const realSpawn = childProcess.spawnSync;
const project = { projectId: "Prj_Sandbox" };
const files = [{ path: "one.py", text: "class One: pass\nraise RuntimeError('SOURCE_MUST_NOT_EXECUTE')\n" }];
function docker(args, options = {}) {
  const result = realSpawn("/usr/bin/docker", args, { encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, ...options });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixtureImage(t, body, removePyright = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "serena-image-fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "Dockerfile"), "FROM project-map-serena-python:1 AS base\nFROM base\nCOPY --from=base /opt/bridge.py /opt/original_bridge.py\nCOPY bridge.py /opt/bridge.py\n"
    + (removePyright ? "USER 0\nRUN rm /opt/pyright/langserver.index.js\nUSER 65532:65532\n" : ""));
  fs.writeFileSync(path.join(root, "bridge.py"), body);
  const idFile = path.join(root, "image-id");
  docker(["build", "--network=none", "--pull=false", "--iidfile", idFile, root]);
  const image = fs.readFileSync(idFile, "utf8").trim();
  t.after(() => docker(["image", "rm", image]));
  return image;
}
function captureTransport(t) {
  const calls = [];
  t.mock.method(childProcess, "spawnSync", (command, args, options) => {
    const result = realSpawn(command, args, options);
    calls.push({ args, result });
    return result;
  });
  return calls;
}
function assertDisposed(calls) {
  const run = calls.find((call) => call.args.includes("run"));
  assert.ok(run);
  const name = run.args[run.args.indexOf("--name") + 1];
  assert.equal(docker(["ps", "-aq", "--filter", `name=^/${name}$`]), "");
  const mount = run.args[run.args.indexOf("--mount") + 1];
  assert.equal(fs.existsSync(mount.match(/source=([^,]+)/)[1]), false);
}

test("real hostile-worker probes verify semantic container isolation", { skip: !enabled }, (t) => {
  const image = fixtureImage(t, `import importlib.util, json, os, pathlib, socket, sys
spec = importlib.util.spec_from_file_location('semantic', '/opt/original_bridge.py')
semantic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(semantic)
result = semantic.analyze(json.load(sys.stdin))
def writable(name):
    try:
        pathlib.Path(name).write_text('forbidden')
        return True
    except OSError:
        return False
sock = socket.socket()
sock.settimeout(0.25)
try:
    sock.connect(('1.1.1.1', 443))
    network = True
except OSError:
    network = False
status = pathlib.Path('/proc/self/status').read_text()
probe = dict(uid=os.getuid(), network=network, interfaces=socket.if_nameindex(),
    rootWritable=writable('/opt/forbidden'), sourceWritable=writable('/snapshot/forbidden.py'), tempWritable=writable('/tmp/allowed'),
    source=[str(p.relative_to('/snapshot')) for p in pathlib.Path('/snapshot').rglob('*') if p.is_file()],
    home=os.environ.get('HOME'), hostHome=bool(list(pathlib.Path('/home').iterdir())), dockerSocket=pathlib.Path('/var/run/docker.sock').exists(),
    git=pathlib.Path('/snapshot/.git').exists(), capEff=[line for line in status.splitlines() if line.startswith('CapEff:')][0],
    noNewPrivs=[line for line in status.splitlines() if line.startswith('NoNewPrivs:')][0],
    memory=pathlib.Path('/sys/fs/cgroup/memory.max').read_text().strip(), cpu=pathlib.Path('/sys/fs/cgroup/cpu.max').read_text().strip(),
    pids=pathlib.Path('/sys/fs/cgroup/pids.max').read_text().strip(), tmpBytes=os.statvfs('/tmp').f_blocks * os.statvfs('/tmp').f_frsize,
    environment=sorted(os.environ), mountInfo=pathlib.Path('/proc/self/mountinfo').read_text())
print(json.dumps(dict(result=result, probe=probe)))
`);
  const calls = captureTransport(t);
  // A probe payload is deliberately NOT valid provider evidence.
  assert.equal(runSerenaSnapshot(createProviderSnapshot(project, files), { image }).status, "invalid");
  const { result, probe } = JSON.parse(calls.find((c) => c.args.includes("run")).result.stdout);
  assert.ok(result.nodes.some((n) => n.label === "One"));
  assert.equal(probe.uid, 65532);
  assert.equal(probe.network, false);
  assert.deepEqual(probe.interfaces.map((entry) => entry[1]), ["lo"]);
  assert.equal(probe.rootWritable, false); assert.equal(probe.sourceWritable, false); assert.equal(probe.tempWritable, true);
  assert.deepEqual(probe.source, ["one.py"]);
  assert.equal(probe.home, "/tmp/home"); assert.equal(probe.hostHome, false); assert.equal(probe.dockerSocket, false); assert.equal(probe.git, false);
  assert.match(probe.capEff, /0000000000000000$/); assert.match(probe.noNewPrivs, /1$/);
  assert.equal(probe.memory, "1073741824"); assert.equal(probe.cpu, "200000 100000"); assert.equal(probe.pids, "64"); assert.equal(probe.tmpBytes, 64 * 1024 * 1024);
  assert.equal(probe.environment.some((key) => /TOKEN|SECRET|CREDENTIAL|DOCKER_HOST/.test(key)), false);
  assert.match(probe.mountInfo, /\/snapshot ro,/);
  assert.match(probe.mountInfo, /\/tmp rw,nosuid,nodev,noexec/);
  assertDisposed(calls);
});

test("real sleeping provider times out and its container is removed", { skip: !enabled }, (t) => {
  const image = fixtureImage(t, "import time\ntime.sleep(60)\n");
  const calls = captureTransport(t);
  const started = performance.now();
  const result = analyzeContextSources(project, files, { serena: { image, deadlineMs: 1500 } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.attempts[0].reason, "timeout");
  assert.ok(performance.now() - started < 6000);
  assertDisposed(calls);
});

test("worker deadline terminates PID 1 before the host deadline", { skip: !enabled }, (t) => {
  const image = fixtureImage(t, `import importlib.util, time
spec = importlib.util.spec_from_file_location('semantic', '/opt/original_bridge.py')
semantic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(semantic)
alarm = semantic.signal.alarm
semantic.signal.alarm = lambda seconds: alarm(1)
semantic.analyze = lambda request: time.sleep(60)
semantic.main()
`);
  const calls = captureTransport(t);
  const result = analyzeContextSources(project, files, { serena: { image, deadlineMs: 4000 } });
  assert.equal(result.attempts[0].reason, "timeout");
  const run = calls.find((c) => c.args.includes("run")).result;
  assert.equal(run.error, undefined);
  assert.equal(run.status, 124);
  assertDisposed(calls);
});

test("real missing Pyright fails offline without downloading a replacement", { skip: !enabled }, (t) => {
  const image = fixtureImage(t, fs.readFileSync(new URL("../docker/serena-python/bridge.py", import.meta.url), "utf8"), true);
  const calls = captureTransport(t);
  const result = analyzeContextSources(project, files, { serena: { image } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.attempts[0].reason, "crashed");
  assertDisposed(calls);
});

test("real provider crash degrades and disposes the sandbox", { skip: !enabled }, (t) => {
  const image = fixtureImage(t, "import sys\nsys.exit(7)\n");
  const calls = captureTransport(t);
  const result = analyzeContextSources(project, files, { serena: { image } });
  assert.equal(result.status, "unavailable"); assert.equal(result.attempts[0].reason, "crashed");
  assertDisposed(calls);
});

test("real oversized provider output is rejected and container state disposed", { skip: !enabled }, (t) => {
  const image = fixtureImage(t, "import sys\nsys.stdout.write('x' * 300000)\n");
  const calls = captureTransport(t);
  const result = analyzeContextSources(project, files, { serena: { image } });
  assert.equal(result.status, "unavailable"); assert.equal(result.attempts[0].reason, "oversized", JSON.stringify(calls.map(({ args, result }) => ({ args: args.slice(-3), status: result.status, stderr: result.stderr, error: result.error?.code }))));
  assertDisposed(calls);
});
