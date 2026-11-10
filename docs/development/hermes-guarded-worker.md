# Offline guarded Hermes worker

This opt-in Linux worker runs a bounded batch through the Hermes tool dispatcher and produces a reviewable Git
patch. An operator grants individual files at an exact commit. The worker reads committed blobs, proposes edits
in temporary copies and returns a patch on stdout. The real worktree, Hermes profiles and gateway are not modified.

## Run a batch

Requirements are Linux with unprivileged user and mount namespaces, Bubblewrap with seccomp support,
`libseccomp.so.2`, Git and a Python environment with the Hermes runtime dependencies. Use Python 3.12 or newer.
The selected Hermes checkout must contain the Git objects for one of [the two tested revisions](hermes-guard-probe.md).
Its tracked runtime modules are read directly from Git. Missing objects or isolation capabilities stop execution.

From the Nexus checkout, the following example grants one tracked UTF-8 file in a separate project. Substitute
the project checkout, Hermes checkout, Python interpreter and file path. The digest refers to the committed
file, including its original newlines.

```bash
repo=/path/to/project
hermes=/path/to/hermes-agent
file=src/example.txt
revision=$(git -C "$repo" rev-parse HEAD)
before=$(git -C "$repo" cat-file blob "$revision:$file" | sha256sum | cut -d' ' -f1)
python - "$file" "$before" <<'PY' | /path/to/hermes/venv/bin/python -B -m integrations.hermes_guard \
  --repo "$repo" --hermes-checkout "$hermes" --revision "$revision" --task review_example --write "$file"
import json, sys
print(json.dumps([{"tool": "nexus_guard_replace", "args": {
    "path": sys.argv[1], "beforeSha256": sys.argv[2], "text": "Proposed text\n"
}}]))
PY
```

`--read PATH` grants read access, and `--write PATH` grants both read and replace access. Each named file must
be a regular tracked blob under the specified Git worktree root. Mode checks exclude symlinks and
submodules. The worker accepts at most 16 distinct files, 128 KiB per file, 1 MiB total, and 16 calls. Paths
use alphanumeric, underscore, period and hyphen characters in ordinary segments. Hidden entries, directories,
new files, renames, deletions and arbitrary commands are outside this mode.

The tools are `nexus_guard_read` with `{path}`, and `nexus_guard_replace` with `{path,beforeSha256,text}`.
The latter compares the expected digest with the current staged bytes before writing. A stale digest yields a
`content_changed` result. An ungranted operation yields a denial. A completed batch can contain both accepted and
denied calls. Each accepted change appears in the top-level `patch`. Inspect `results` and `decisions` for each call.

A caller with a verified Nexus receipt can send `{"calls":[...],"nexusContext":{...}}` in place of the plain
array. The context requires `projectId`, `taskId`, `revision` and `snapshotToken`. Optional `sources` entries
have `path` and `sha256`, `symbols` entries have `name` and `path`, and `relevantPaths` contains paths. The
limit is 16 KiB and 16 items per list. Paths must be granted, task/revision must match, and each supplied source
digest must match its immutable Git blob. The raw worker treats the project ID and snapshot token as caller-supplied
evidence. The operator's explicit file grant remains the authority. Context metadata cannot add a writable file.

## Enforcement and evidence

- The launcher exposes the pinned Hermes runtime, the trusted system and Python installation, a read-only view
  of just the granted Git blobs and exact writable mounts for the disposable edit targets. It uses fresh user,
  PID, IPC, UTS and mount namespaces, drops capabilities, disables further user namespaces and clears the
  inherited environment. The worker has a private 64 MiB `/tmp`, a temporary profile and no host credentials
  supplied in its environment. The project and Hermes checkouts must reside outside the exposed runtime mounts.
- Seccomp rejects socket creation, alternate socket paths such as io_uring and mount/namespace escape operations.
  Linux's network namespace could not be created on the verification host. Actual INET socket and UNIX datagram socket-pair attempts inside
  the worker received `EPERM` under the installed filter. The worker is offline and performs no model call.
- The integrated Hermes pre-LLM context collector must return the exact granted task/revision/file context plus any
  supplied Nexus evidence. Known tool calls require a pre-tool decision and a post-tool outcome. Unknown tool names
  are rejected before entering Hermes. These separate phases appear in the receipt. The guarded handlers repeat
  path checks for direct calls.
- Before emitting a patch, the launcher verifies evidence bindings, event ordering, response schemas, content
  hashes and final bytes of **every** staged file against the operation sequence. It also rechecks the project
  HEAD. A verification error yields an unavailable result without a patch. Isolated worker execution is limited
  to 45 seconds, and the parent bounds Git output, capture size and individual source sizes.
- In the isolated adversarial test, ordinary dispatch vetoed a deliberately registered attack tool. Direct
  plugin dispatch still reached that tool. A real shell inside its handler could change the writable **copy**.
  It could not overwrite or rename a read-only file, create a file under the project mount, see the host fixture
  or unlisted repository file, or open an INET socket. The host worktree remained clean and the ordinary worker's
  patch passed a separate `git apply --check`.

This mode covers offline proposals on two pinned upstream checkouts. Automatic task claims, live LLM or gateway
execution, fleet deployment, untrusted third-party Python plugins, host workloads, full resource isolation and
all Hermes tool surfaces require separate evidence. Nothing installs a global hook or turns ETS WRITE into
execution authority.

## Verify

```bash
HERMES_GUARD_PROBE_CHECKOUT=/path/to/trusted/hermes-agent \
  /path/to/hermes/venv/bin/python -B -m unittest discover -s tests/hermes_nexus_plugin -p test_guarded_worker.py
```

The suite includes a real Hermes dispatcher/turn-context test, a direct-plugin/shell/namespace test, input
isolation, stale revision, symlink and malformed evidence controls, and forged receipt rejection. Without the
explicit checkout, the two live-runtime cases are skipped.

## Registered project and known peer tasks

The project-aware launcher intersects explicit operator grants with a fresh ETS receipt and re-observes
the checkout after dispatch. The worker verifies every granted file's SHA-256 against the immutable
Git blob it actually stages. Only admitted symbol and path evidence enters the Hermes pre-LLM context.
The checkout is never a writable mount. The result contains a proposed patch.

```bash
node scripts/guarded-project-task.mjs --project-id PrJ_Example --root-id dev \
  --worktree task-checkout --revision "$REVISION" --task-id T1 --write src/order.ts \
  --hermes-checkout /path/to/pinned/hermes-agent --python /path/to/its/venv/bin/python < batch.json
```

Supply `{"task":{"id":"T1","title":"Edit order","paths":["src/order.ts"]},"calls":[...]}` on standard
input. A model cannot enlarge the operator's `--read` and `--write` arguments by naming new files in the batch.
`--peer-intents FILE` accepts an operator-supplied array of up to four normal ETS request bodies for other
active tasks. The launcher builds and compares real observations before and after execution and withholds the
patch on conflicts, incomplete peer evidence or changes. Without peer inputs, `comparedPeers` is empty.
Hermes retains ownership of the live task inventory.

## Model-selected edit

A second opt-in experiment runs a fixed status-edit task through the real Hermes `AIAgent`. It requires a trusted
local llama.cpp executable and GGUF, the same Python environment as above, and the Node dependencies for the
project-aware CLI. The runner starts and stops the local inference server. It creates a temporary registered
project and linked worktree; there is no live service or fleet configuration to change.

```bash
/path/to/hermes/venv/bin/python -B -m integrations.hermes_guard.model_acceptance \
  --hermes /path/to/trusted/hermes-agent --llama-server /path/to/llama-server \
  --gguf /path/to/qwen2.5-0.5b-instruct-q4_k_m.gguf
```

Hermes selects tools and formats/interprets completions in a second Bubblewrap process with no host project
mount, network sockets, or model credentials. The process advertises only `edit_status_text`. A framed pipe
transports the real model HTTP payloads to a parent-owned loopback server. The parent restricts destinations,
methods and endpoints, and independently extracts native tool calls from the returned completion bytes. Model
prose cannot authorize an edit. An exact match between selected arguments and the tool callback is required
before the parent submits a replacement through `scripts/guarded-project-task.mjs`. That operation revalidates
the registered project, operator grant, ETS and Nexus context before releasing a staged patch. One independent
checkout applies that patch and checks the complete changed file set and expected bytes. Both original
worktrees must remain clean.

On 2026-11-09, Qwen2.5-0.5B-Instruct Q4_K_M made two chat completions. Its first native edit selected the
replacement of `export const status = "draft"` with `export const status = "ready"`. Hermes delivered the same
arguments to the tool, the project-aware worker returned one patch, and the independent oracle passed.
The agent finished normally, and both source worktrees were clean. The tested fixture commit, model and engine
hashes, actual arguments and patch are in [the recorded run](hermes-guarded-model-acceptance.json).

This experiment exercises one fixed file, prompt, local model and operator grant. The score records a patch
proposal and its application in the oracle's disposable checkout. It does not measure general coding quality,
modify a user's project, or run an autonomous online worker.
