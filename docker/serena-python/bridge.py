"""One snapshot, fixed read-only semantic operations; no MCP/agent/tool dispatcher."""
import hashlib
import json
import logging
import pathlib
import signal
import sys

ROOT = pathlib.Path("/snapshot")
OPERATIONS = {"boundedSourceAnalysis", "detection", "symbols", "definitions", "references"}
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
    symbols = []
    edges = []
    definitions = []
    limited = False
    files = {file["path"]: file for file in request["files"]}
    uris = {(ROOT / name).as_uri(): name for name in files}

    def location(uri, point):
        if uri not in uris:
            raise ValueError("Outside snapshot URI")
        name = uris[uri]
        lines = files[name]["text"].split("\n")
        line, column = point["line"], point["character"]
        if type(line) is not int or type(column) is not int or not 0 <= line < len(lines):
            raise ValueError("Invalid position")
        if not 0 <= column <= len(lines[line].rstrip("\r").encode("utf-16-le")) // 2:
            raise ValueError("Invalid position")
        return {"path": name, "line": line + 1, "column": column + 1}

    def query(method, name, position):
        with server.open_file(name):
            params = {"textDocument": {"uri": (ROOT / name).as_uri()}, "position": position}
            if method == "references":
                params["context"] = {"includeDeclaration": False}
                return server.server.send.references(params) or []
            result = server.server.send.definition(params) or []
            return result if isinstance(result, list) else [result]

    initialize = server.server.send.initialize

    def checked_initialize(params):
        result = initialize(params)
        for capability in ("documentSymbolProvider", "definitionProvider", "referencesProvider"):
            if not result.get("capabilities", {}).get(capability):
                raise ValueError("Required semantic capability unavailable")
        return result

    server.server.send.initialize = checked_initialize
    with server.start_server_context():
        for file in request["files"]:
            for symbol in server.request_document_symbols(file["path"]).iter_symbols():
                if len(nodes) >= 256:
                    limited = True
                    break
                position = symbol["selectionRange"]["start"]
                location(symbol["location"]["uri"], position)
                key = json.dumps([file["path"], symbol["name"], position], sort_keys=True)
                nodes.append({"id": "s_" + digest(key.encode()), "label": symbol["name"], "file": file["path"],
                              "kind": {5: "class", 6: "function", 12: "function"}.get(symbol["kind"], "symbol"), "line": position["line"] + 1})
                symbols.append((nodes[-1], symbol))
        # Definition queries at declarations and actual reference positions use Pyright,
        # never string/name matching. Edges describe references, not inferred calls.
        for node, symbol in symbols:
            position = symbol["selectionRange"]["start"]
            for target in query("definition", node["file"], position):
                uri = target.get("uri", target.get("targetUri"))
                target_range = target.get("range", target.get("targetSelectionRange"))
                definitions.append({"symbolId": node["id"], "target": location(uri, target_range["start"])})
            for reference in query("references", node["file"], position):
                place = location(reference["uri"], reference["range"]["start"])
                point = reference["range"]["start"]
                for target in query("definition", place["path"], point):
                    target_uri = target.get("uri", target.get("targetUri"))
                    target_range = target.get("range", target.get("targetSelectionRange"))
                    definitions.append({"symbolId": node["id"], "target": location(target_uri, target_range["start"])})
                owners = [(candidate, info) for candidate, info in symbols if candidate["file"] == place["path"]
                          and (info["range"]["start"]["line"], info["range"]["start"]["character"]) <= (point["line"], point["character"])
                          < (info["range"]["end"]["line"], info["range"]["end"]["character"])]
                if owners:
                    owner = min(owners, key=lambda pair: (pair[1]["range"]["end"]["line"] - pair[1]["range"]["start"]["line"], -pair[1]["range"]["start"]["character"]))[0]["id"]
                else:
                    owner = "f_" + digest(place["path"].encode())
                    if not any(n["id"] == owner for n in nodes):
                        nodes.append({"id": owner, "label": "<module>", "file": place["path"], "kind": "symbol", "line": 1})
                edges.append({"from": owner, "to": node["id"], "relation": "references", "location": place})
                if len(edges) >= 512:
                    limited = True
                    break
            if len(edges) >= 512 or len(definitions) >= 256:
                limited = True
                break
    definitions = [json.loads(row) for row in sorted({json.dumps(d, sort_keys=True) for d in definitions})]
    if len(definitions) > 256:
        definitions = definitions[:256]
        limited = True
    if observe(request) != observed:
        raise ValueError("Snapshot changed")
    return {**{key: request[key] for key in BINDING}, "observedSourceToken": observed,
            "status": "partial" if limited else "available", "nodes": nodes, "edges": edges, "definitions": definitions, "implementations": [], "diagnostics": []}


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
