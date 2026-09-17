"""One snapshot, fixed read-only semantic operations; no MCP/agent/tool dispatcher."""
import hashlib
import json
import logging
import pathlib
import signal
import sys

ROOT = pathlib.Path("/snapshot")
OPERATIONS = {"boundedSourceAnalysis", "detection", "symbols"}
BINDING = ("schemaVersion", "projectId", "snapshotToken", "requestToken", "providerId", "providerVersion")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def observe(request):
    pairs = []
    if len(request["files"]) > 500:
        raise ValueError("Too many files")
    total = 0
    for file in request["files"]:
        name = file["path"]
        parts = pathlib.PurePosixPath(name).parts
        if not parts or name.startswith("/") or ".." in parts or "\\" in name or ":" in name or not name.endswith(".py"):
            raise ValueError("Invalid source")
        target = ROOT / name
        if target.is_symlink() or target.resolve() != target:
            raise ValueError("Invalid source")
        data = target.read_bytes()
        total += len(data)
        if len(data) > 128 * 1024 or total > 4 * 1024 * 1024 or digest(data) != file["sha256"]:
            raise ValueError("Snapshot mismatch")
        pairs.append([name, digest(data)])
    if pairs != sorted(pairs) or len({p[0] for p in pairs}) != len(pairs):
        raise ValueError("Invalid source ordering")
    token = digest(json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode())
    if token != request["observedSourceToken"]:
        raise ValueError("Observation mismatch")
    return token


def analyze(request):
    from solidlsp.ls import SolidLanguageServer
    from solidlsp.ls_config import LanguageServerConfig, LanguageServerId
    from solidlsp.settings import SolidLSPSettings

    if request["schemaVersion"] != 1 or not set(request["operations"]).issubset(OPERATIONS):
        raise ValueError("Unsupported request")
    observed = observe(request)
    settings = SolidLSPSettings(solidlsp_dir="/tmp/solidlsp", project_data_path="/tmp/project",
        ls_specific_settings={"python": {"ls_base_cmd": ["/usr/local/bin/node", "/opt/pyright/langserver.index.js"], "ls_args": ["--stdio"]}})
    server = SolidLanguageServer.create(LanguageServerConfig(LanguageServerId.PYTHON), str(ROOT), timeout=10, solidlsp_settings=settings)
    nodes = []
    limited = False
    with server.start_server_context():
        for file in request["files"]:
            for symbol in server.request_document_symbols(file["path"]).iter_symbols():
                if len(nodes) >= 256:
                    limited = True
                    break
                position = symbol["selectionRange"]["start"]
                key = json.dumps([file["path"], symbol["name"], position], sort_keys=True)
                nodes.append({"id": "s_" + digest(key.encode()), "label": symbol["name"], "file": file["path"],
                              "kind": {5: "class", 6: "function", 12: "function"}.get(symbol["kind"], "symbol"), "line": position["line"] + 1})
    if observe(request) != observed:
        raise ValueError("Snapshot changed")
    return {**{key: request[key] for key in BINDING}, "observedSourceToken": observed,
            "status": "partial" if limited else "available", "nodes": nodes, "edges": [], "definitions": [], "implementations": [], "diagnostics": []}


def main():
    signal.alarm(29)
    logging.disable(logging.CRITICAL)
    request = json.loads(sys.stdin.buffer.read(26 * 1024 * 1024 + 1))
    result = analyze(request)
    output = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode()
    if len(output) > 256 * 1024:
        raise ValueError("Response too large")
    sys.stdout.buffer.write(output)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("serena_analysis_unavailable\n")
        sys.exit(1)
