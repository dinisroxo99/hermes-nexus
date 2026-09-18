# Optional Serena/Python AnalyzerProvider

This image is a **read-only semantic-analysis worker**, not a Serena agent/MCP
server. It uses Serena's SolidLSP library and Pyright over stdio. Project Map
owns snapshots, validation and Context Packs; Git remains revision/content truth.
Hermes runtime and Honcho memory are not part of this integration.

## Build and opt in

Prerequisite: Linux/WSL, `/usr/bin/docker`, and access to the local Docker Engine
at `/var/run/docker.sock`. Do not install host Python dependencies or change
Docker/Git configuration as part of enabling this provider.

From the repository root:

```sh
docker build -t project-map-serena-python:1 docker/serena-python
docker image inspect project-map-serena-python:1 --format '{{.Id}}'
SERENA_DOCKER_TESTS=1 node --test tests/serena-*-docker.test.js
```

Build-time network is required to fetch checksum-verified Serena/Pyright archives
and hash-locked wheels. Build context is allowlisted by `.dockerignore`; it does
not contain the live source repository or credentials. `:1` is a build/test
convenience tag only, **not an accepted runtime reference**.

To enable the existing task-context HTTP endpoint for Python repositories, set
`SERENA_PYTHON_IMAGE` to the exact `sha256:<64 lowercase hex>` ID from your verified
build before starting Project Map. It also supports this setting through the
existing project configuration loader. Empty process environment explicitly
turns it off, even when an env-file value exists. No configuration was enabled
automatically by the implementation. Missing Docker/image/Pyright degrades;
there is no runtime build, pull, dependency download or install.

Trusted JavaScript callers can pass `analyzer: { serena: { image: IMAGE_ID },
requiredLanguages: ["python"] }` to `buildProjectTaskContext`, or equivalent
options directly to `analyzeContextSources`. The language requirement is useful
in mixed repositories, where existing native .NET then TypeScript/JavaScript
priority is preserved. HTTP clients cannot supply analyzer/runtime settings or
language requirements. Legacy graph/impact endpoints remain unchanged.

## Pinned inputs

- Serena source: `f8f53b77f04e50aadf9e5789841ec6a95c874514` (`1.7.1.dev0`).
- Serena archive SHA-256: `2696d5a2d209e2cfb06916fc277509cb7bf9cdadadd59c60b77b75d2882a37a0`.
- Pyright: `1.1.403`; npm archive SHA-512:
  `OyslngwxftKgNfbiyR8WDadUoLHDoinwUfbd50P1VBfLWkR5cro9R52qMQMpVI/LiSVpWbzunToR2NX7SanwmA==` (base64).
- Python: `3.11.13`, slim-bookworm base
  `sha256:86adf8dbadc3d6e82ee5dd2c74bec2e1c2467cdad47886280501df722372d2e1`.
- Node: `22.18.0`, bookworm-slim source image
  `sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e`.
- Python runtime dependency closure: [requirements.lock](requirements.lock),
  exact versions and artifact hashes derived from the pinned upstream `uv.lock`.
  Only SolidLSP's needed dependencies are installed; MCP/LLM/model/GUI dependencies
  are not installed. The source tree includes inert upstream modules, not exposed
  tools or running services.
- Verified image/dependency inventory: [versions.json](versions.json). Its image
  ID is the local verified artifact, not a promise of bit-identical image output
  on every rebuild. Dependency inputs are pinned; record each rebuilt image ID.

Upstream license files are included at `/opt/serena/LICENSE` and
`/opt/serena/LICENSES`. SolidLSP is MIT; imported Serena utility code is
GPL-3.0-or-later. Preserve upstream notices/source obligations when distributing
this image; this is not an assertion that the combined image is MIT-only.

## Fixed runtime contract

`src/analyzers/external/serena-transport.js` accepts a normalized authorized
snapshot and a trusted immutable image ID. It revalidates the snapshot, exports
only Python source text, and materializes a fresh private temporary directory.
Docker gets **only** its source subdirectory as `/snapshot:ro`, never the live
repository, `.git`, host HOME, registry, credentials, Docker socket or another
project. Docker CLI configuration is a separate empty private directory, with
a minimal environment and fixed local daemon endpoint.

- UID/GID `65532:65532`; all capabilities dropped; no-new-privileges.
- Network `none`; no published ports, host PID/IPC namespace or remote endpoint.
- Read-only root and source; `/tmp` is a 64 MiB noexec/nosuid/nodev tmpfs;
  `/dev/shm` is bounded to 1 MiB. No persistent project volumes.
- 2 CPUs, 1 GiB RAM, no extra swap, 64 PIDs; Docker logging disabled.
- Fixed Python entrypoint and fixed Node/Pyright executable. No shell dispatcher,
  arbitrary tool calls, user-selected commands or project-controlled config.
- 30-second host request deadline including preparation/startup; SIGKILL the CLI
  on timeout/output overflow, then force-remove the named container. Cleanup has
  a separate 2-second budget. Concurrent Docker auto-removal is verified with
  bounded retries. Cleanup failure suppresses evidence (`cleanup_failed`).
- Worker has a 29-second explicit SIGALRM handler, including when running as
  container PID 1. Pyright scan-readiness hint wait is capped at 5 seconds;
  individual LSP requests at 10 seconds, inside the overall deadline.
- Maximum response 256 KiB. Host capture also bounds stderr; errors are sanitized.

No source is imported or executed. Semantic operation allowlist:
`documentSymbol`, `definition`, `references`, plus fixed LSP lifecycle and
read-only document synchronization. Serena editing/shell/memory/project switching/
onboarding/agent operations have no dispatcher and cannot be requested.

## Evidence and limitations

Provider ID `external.serena-python`, version `1-f8f53b77-pyright-1.1.403`.
Python `.py` suffix recognition is case-insensitive without renaming paths.
Symbols/definitions/references are semantic; detection/bounded source handling
are structural. Dependencies, implementations and diagnostics are unsupported.

Every response binds project ID, revision/worktree snapshot token, descriptor
request token and provider ID/version. `observedSourceToken` binds the exported
sorted path/SHA-256 pairs: the worker reads and hashes mounted bytes before and
after analysis, comparing them with the request. Exact snapshot URIs, source
locations (1-based UTF-16), symbol IDs, relationships and declared capabilities
are validated before consumption. Raw LSP data/paths never enter Context Packs.
Definitions are queried at declarations and reference sites. Reference edges
originate at an enclosing symbol or a synthetic `<module>` file symbol, not an
inferred caller/callee relationship. Cross-provider evidence is never merged.

The worker caps discovery at 256 document symbols, plus needed module nodes;
references at 512 edges and definitions at 256. Budget omissions are partial;
a response that still exceeds 256 KiB is rejected rather than passed through.
There is no persistent semantic index or project memory. Disposable SolidLSP
scratch/cache files live only on tmpfs, then disappear with the container.

Not guaranteed: complete analysis of a large source-limited snapshot, arbitrary
third-party imports without installed project packages, dynamic Python behavior,
compiler diagnostics, or cross-provider/Impact v2 analysis. Out-of-snapshot
semantic targets fail closed rather than importing external evidence. Unusual
suffix casing can delay startup until the 5-second readiness-hint cap. Context
Pack retains its existing source/revision reobservation and Linux/WSL descriptor
requirements; no atomic whole-worktree snapshot or complete secret-DLP claim.

The transport is synchronous to preserve the current API: an opted-in Python
analysis can block the Node event loop for its bounded request. This is not a
multi-tenant runtime/scheduler. It requires a trusted local Docker daemon and
host operator; daemon outage/host termination can prevent cleanup. Such failures
are not reported as valid evidence. No host-level installation or configuration
change, image push, Hermes orchestration or Step 3 work is included.
