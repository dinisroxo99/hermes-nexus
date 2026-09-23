"""Bounded async HTTP client for the local Hermes Nexus pilot."""

from __future__ import annotations

import asyncio
import json
import math
import re
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import quote

import httpx

REQUEST_MAX_BYTES = 65_536
RESPONSE_MAX_BYTES = 1_048_576
TOTAL_TIMEOUT_SECONDS = 60.0
CLEANUP_TIMEOUT_SECONDS = 2.0
_BASE_URL_RE = re.compile(r"http://127\.0\.0\.1:([0-9]{1,5})(/)?\Z", re.ASCII)

_SUCCESS = {
    "project_task_context": ("task-context", "task-context-v1", "Task context constructed."),
    "project_impact": ("impact", "impact-v2", "Project impact constructed."),
}
_SAFE_SERVER_MESSAGE = {
    "project_task_context": "Task context could not be constructed safely.",
    "project_impact": "Project impact could not be constructed safely.",
}
_ALLOWLIST = {
    "project_task_context": {
        400: {
            "invalid_json", "invalid_project_identity", "invalid_task_context_request",
            "invalid_context_sources", "invalid_context_analysis", "project_identity_required",
            "context_budget_exceeded",
        },
        404: {"project_not_found", "project_unavailable"},
        409: {
            "ambiguous_project", "project_identity_conflict", "worktree_parent_mismatch",
            "context_sources_changed", "context_revision_changed", "context_project_changed",
        },
        413: {"request_body_too_large"},
        500: {"task_context_failed"},
    },
    "project_impact": {
        400: {
            "invalid_project_identity", "project_identity_required", "invalid_json",
            "invalid_impact_request", "impact_budget_exceeded",
        },
        404: {"project_not_found", "project_unavailable"},
        409: {
            "ambiguous_project", "project_identity_conflict", "worktree_parent_mismatch",
            "impact_sources_changed", "impact_revision_changed", "impact_project_changed",
        },
        413: {"request_body_too_large"},
        500: {"impact_failed", "impact_response_too_large"},
    },
}
_MESSAGES = {
    "nexus_invalid_arguments": "The tool arguments are invalid.",
    "nexus_client_request_too_large": "The Nexus request exceeds the client transport limit.",
    "nexus_configuration_error": "The Nexus client configuration is invalid.",
    "nexus_timeout": "The Nexus request timed out.",
    "nexus_connection_failed": "The Nexus service could not be reached.",
    "nexus_client_response_too_large": "The Nexus response exceeds the client transport limit.",
    "nexus_redirect_rejected": "The Nexus service returned a redirect, which is not allowed.",
    "nexus_invalid_response": "The Nexus service returned an invalid response.",
    "nexus_incompatible_response": "The Nexus service response version is incompatible.",
    "nexus_context_mismatch": "The Nexus response does not match the requested project context.",
    "nexus_cleanup_failed": "The Nexus client could not close transport resources safely.",
    "nexus_client_failed": "The Nexus client failed safely.",
    "nexus_http_error": "The Nexus service rejected the request.",
}


@dataclass(slots=True)
class NexusClientError(Exception):
    code: str
    category: str
    http_status: int | None = None
    mismatched_fields: tuple[str, ...] = ()
    message: str | None = None

    def __post_init__(self) -> None:
        if self.message is None:
            self.message = _MESSAGES[self.code]
        Exception.__init__(self, self.message)

    def as_result(self, tool: str) -> dict[str, Any]:
        result: dict[str, Any] = {
            "tool": tool,
            "ok": False,
            "error": self.code,
            "category": self.category,
            "httpStatus": self.http_status,
            "message": self.message,
        }
        if self.code == "nexus_context_mismatch":
            result["mismatchedFields"] = list(self.mismatched_fields)
        return result


def _error(code: str, category: str, status: int | None = None, *, fields: list[str] | None = None, message: str | None = None) -> NexusClientError:
    return NexusClientError(code, category, status, tuple(fields or ()), message)


def validate_base_url(value: Any) -> str:
    if not isinstance(value, str):
        raise _error("nexus_configuration_error", "configuration")
    match = _BASE_URL_RE.fullmatch(value)
    if match is None or not 1 <= int(match.group(1)) <= 65535:
        raise _error("nexus_configuration_error", "configuration")
    return value[:-1] if match.group(2) else value


def serialize_request(body: Any) -> bytes:
    try:
        encoded = json.dumps(
            body,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise _error("nexus_invalid_arguments", "input") from None
    if len(encoded) > REQUEST_MAX_BYTES:
        raise _error("nexus_client_request_too_large", "input")
    return encoded


def _reject_constant(_value: str) -> None:
    raise ValueError("non-finite JSON number")


def _parse_finite_float(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError("non-finite JSON number")
    return parsed


def _reject_duplicate(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _check_depth(value: Any, depth: int = 0) -> None:
    if depth > 100:
        raise ValueError("JSON nesting too deep")
    if isinstance(value, dict):
        for child in value.values():
            _check_depth(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _check_depth(child, depth + 1)


def parse_response(raw: bytes) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8", errors="strict")
        value = json.loads(
            text,
            object_pairs_hook=_reject_duplicate,
            parse_constant=_reject_constant,
            parse_float=_parse_finite_float,
        )
        _check_depth(value)
    except (UnicodeError, ValueError, RecursionError):
        raise _error("nexus_invalid_response", "protocol") from None
    if not isinstance(value, dict):
        raise _error("nexus_invalid_response", "protocol")
    return value


def _require(record: Any, key: str, expected: type | tuple[type, ...] | None = None) -> Any:
    if not isinstance(record, dict) or key not in record:
        raise _error("nexus_invalid_response", "protocol")
    value = record[key]
    if expected is not None:
        if expected is bool:
            valid = type(value) is bool
        elif expected is int:
            valid = type(value) is int
        else:
            valid = isinstance(value, expected)
        if not valid:
            raise _error("nexus_invalid_response", "protocol")
    return value


def _opaque(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def _revision_mismatches(data: dict[str, Any], arguments: dict[str, Any], *, context: bool) -> list[str]:
    revision = _require(data, "revision", dict)
    expected = arguments["expectedRevision"]
    required_types = {
        "status": str,
        "commitSha": str,
        "branch": (str, type(None)),
        "dirty": bool,
        "isLinkedWorktree": bool,
    }
    for key, expected_type in required_types.items():
        _require(revision, key, expected_type)

    repository_key = "repositoryIdentity" if context else "repositoryId"
    repository_id = _require(revision, repository_key, str)
    worktree_id = _require(revision, "worktreeId", str)
    if not _opaque(repository_id) or not _opaque(worktree_id):
        raise _error("nexus_invalid_response", "protocol")
    alias_key = "repositoryId" if context else "repositoryIdentity"
    if alias_key in revision:
        alias = _require(revision, alias_key, str)
        if not _opaque(alias):
            raise _error("nexus_invalid_response", "protocol")
    else:
        alias = repository_id

    fields: list[str] = []
    for key in ("status", "commitSha", "branch", "dirty", "isLinkedWorktree"):
        if revision[key] != expected[key]:
            fields.append(key)
    if alias != repository_id:
        fields.append("repositoryId")
    if "repositoryId" in expected and repository_id != expected["repositoryId"]:
        fields.append("repositoryId")
    if "worktreeId" in expected and worktree_id != expected["worktreeId"]:
        fields.append("worktreeId")
    return fields


def _identity_mismatches(data: dict[str, Any], arguments: dict[str, Any]) -> list[str]:
    project = _require(data, "project", dict)
    _require(data, "projectId", str)
    _require(project, "rootId", str)
    _require(project, "relativePath", str)
    fields: list[str] = []
    if data["projectId"] != arguments["projectId"]:
        fields.append("projectId")
    if project["rootId"] != arguments["worktree"]["rootId"]:
        fields.append("rootId")
    if project["relativePath"] != arguments["worktree"]["relativePath"]:
        fields.append("relativePath")
    return fields


def _validate_observation(data: dict[str, Any]) -> dict[str, Any]:
    observation = _require(data, "observation", dict)
    for key, fixed in (
        ("basis", "working_tree"),
        ("cacheReuse", "disabled"),
        ("digestCoverage", "bounded_collected_sources"),
    ):
        value = _require(observation, key, str)
        if value != fixed:
            raise _error("nexus_invalid_response", "protocol")
    _require(observation, "incomplete", bool)
    return observation


def _validate_context(data: dict[str, Any], arguments: dict[str, Any]) -> list[str]:
    context_pack_id = _require(data, "contextPackId", str)
    if len(context_pack_id) != 72 or not context_pack_id.startswith("context_") or not _opaque(context_pack_id[8:]):
        raise _error("nexus_invalid_response", "protocol")
    analysis = _require(data, "analysis", dict)
    _require(analysis, "status", str)
    provider = _require(analysis, "provider")
    if provider is not None and not isinstance(provider, dict):
        raise _error("nexus_invalid_response", "protocol")
    _require(analysis, "coverage", dict)
    _require(analysis, "snapshotToken", str)
    _require(analysis, "attempts", list)
    provenance = _require(analysis, "provenance", dict)
    provenance_project = _require(provenance, "projectId", str)
    _validate_observation(data)
    observation = data["observation"]
    _require(observation, "sourceDigest", str)

    sections = _require(data, "sections", dict)
    fields: list[str] = []
    for name in ("task", "policy", "workspaces", "documents", "constraints", "files", "symbols", "references", "tests", "diagnostics"):
        section = _require(sections, name, dict)
        _require(section, "status", str)
        _require(section, "truncated", bool)
        section_provenance = _require(section, "provenance", dict)
        if "projectId" in section_provenance:
            section_project = _require(section_provenance, "projectId", str)
            if section_project != arguments["projectId"]:
                fields.append("provenance.projectId")
    fields.extend(_identity_mismatches(data, arguments))
    fields.extend(_revision_mismatches(data, arguments, context=True))
    if provenance_project != arguments["projectId"]:
        fields.append("provenance.projectId")
    return fields


def _validate_impact(data: dict[str, Any], arguments: dict[str, Any]) -> list[str]:
    provider = _require(data, "provider")
    if provider is not None and not isinstance(provider, dict):
        raise _error("nexus_invalid_response", "protocol")
    _require(data, "coverage", dict)
    _require(data, "snapshotToken", str)
    _validate_observation(data)
    _require(data, "status", str)
    _require(data, "findingState", str)
    _require(data, "affectedFiles", list)
    _require(data, "affectedTests", dict)
    _require(data, "limits", dict)
    completeness = _require(data, "completeness", dict)
    for dimension in ("source", "provider", "traversal", "output"):
        _require(completeness, dimension, list)
    fields = _identity_mismatches(data, arguments)
    fields.extend(_revision_mismatches(data, arguments, context=False))
    worktree = _require(data, "worktree", dict)
    returned_worktree_id = _require(worktree, "worktreeId", str)
    if not _opaque(returned_worktree_id):
        raise _error("nexus_invalid_response", "protocol")
    if returned_worktree_id != data["revision"]["worktreeId"] and "worktreeId" not in fields:
        fields.append("worktreeId")
    return fields


def validate_success(tool: str, envelope: dict[str, Any], arguments: dict[str, Any]) -> dict[str, Any]:
    if envelope.get("ok") is not True or "error" in envelope or not isinstance(envelope.get("data"), dict):
        raise _error("nexus_invalid_response", "protocol")
    _route, version, message = _SUCCESS[tool]
    if envelope.get("message") != message:
        raise _error("nexus_incompatible_response", "protocol")
    data = envelope["data"]
    schema_version = _require(data, "schemaVersion", int)
    analysis_version = _require(data, "analysisVersion", str)
    if schema_version != 1 or analysis_version != version:
        raise _error("nexus_incompatible_response", "protocol")
    if _require(data, "generatedAt") is not None:
        raise _error("nexus_invalid_response", "protocol")
    fields = _validate_context(data, arguments) if tool == "project_task_context" else _validate_impact(data, arguments)
    if fields:
        ordered = list(dict.fromkeys(fields))
        raise _error("nexus_context_mismatch", "identity", 200, fields=ordered)
    return {"tool": tool, "ok": True, "data": data, "message": message}


def classify_http_error(tool: str, status: int, envelope: dict[str, Any]) -> NexusClientError:
    if 300 <= status <= 399:
        return _error("nexus_redirect_rejected", "http", status)
    if envelope.get("ok") is not False or "data" in envelope or not isinstance(envelope.get("error"), str):
        return _error("nexus_http_error", "http", status)
    code = envelope["error"]
    if code not in _ALLOWLIST[tool].get(status, set()):
        return _error("nexus_http_error", "http", status)
    return _error(code, "http", status, message=_SAFE_SERVER_MESSAGE[tool])


class NexusClient:
    """One-shot local HTTP client with no retry, cache, discovery, or Git logic."""

    def __init__(self, base_url: Any, *, transport: httpx.AsyncBaseTransport | None = None, client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient):
        self.base_url = validate_base_url(base_url)
        self._transport = transport
        self._client_factory = client_factory

    async def request(self, tool: str, arguments: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
        if tool not in _SUCCESS:
            raise _error("nexus_client_failed", "protocol")
        payload = serialize_request(body)
        route = _SUCCESS[tool][0]
        url = f"{self.base_url}/api/intelligence/projects/{quote(arguments['projectId'], safe='')}/{route}"
        client = self._client_factory(
            trust_env=False,
            follow_redirects=False,
            timeout=httpx.Timeout(connect=5.0, write=5.0, pool=5.0, read=55.0),
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=0),
            transport=self._transport,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
                "Accept-Encoding": "identity",
            },
        )
        response: httpx.Response | None = None
        cancelled: asyncio.CancelledError | None = None
        result: dict[str, Any] | None = None
        pending_error: NexusClientError | None = None
        try:
            async with asyncio.timeout(TOTAL_TIMEOUT_SECONDS):
                request = client.build_request("POST", url, content=payload)
                response = await client.send(request, stream=True)
                if 300 <= response.status_code <= 399:
                    raise _error("nexus_redirect_rejected", "http", response.status_code)
                raw = await self._read_response(response)
                try:
                    envelope = parse_response(raw)
                    if response.status_code != 200:
                        raise classify_http_error(tool, response.status_code, envelope)
                    result = validate_success(tool, envelope, arguments)
                except NexusClientError as exc:
                    if exc.http_status is None:
                        exc.http_status = response.status_code
                    raise
        except asyncio.CancelledError as exc:
            cancelled = exc
        except TimeoutError:
            pending_error = _error("nexus_timeout", "transport", self._status(response))
        except httpx.TimeoutException:
            pending_error = _error("nexus_timeout", "transport", self._status(response))
        except (httpx.ConnectError, httpx.NetworkError, httpx.RemoteProtocolError):
            pending_error = _error("nexus_connection_failed", "transport", self._status(response))
        except (httpx.DecodingError, httpx.StreamError):
            pending_error = _error("nexus_invalid_response", "protocol", self._status(response))
        except NexusClientError as exc:
            pending_error = exc
        except Exception:
            pending_error = _error("nexus_client_failed", "protocol", self._status(response))
        cleanup_ok, cleanup_cancellation = await self._cleanup(response, client)
        if cancelled is None:
            cancelled = cleanup_cancellation
        if cancelled is not None:
            raise cancelled
        if not cleanup_ok:
            raise _error("nexus_cleanup_failed", "transport", self._status(response))
        if pending_error is not None:
            raise pending_error
        if result is None:
            raise _error("nexus_client_failed", "protocol")
        return result

    @staticmethod
    def _status(response: httpx.Response | None) -> int | None:
        return response.status_code if response is not None else None

    async def _read_response(self, response: httpx.Response) -> bytes:
        content_type = response.headers.get("content-type", "")
        media_type, separator, parameters = content_type.partition(";")
        if media_type.strip().lower() != "application/json":
            raise _error("nexus_invalid_response", "protocol", response.status_code)
        if separator:
            pieces = [piece.strip().lower() for piece in parameters.split(";") if piece.strip()]
            if pieces != ["charset=utf-8"]:
                raise _error("nexus_invalid_response", "protocol", response.status_code)
        encoding = response.headers.get("content-encoding", "identity").strip().lower()
        if encoding not in {"", "identity"}:
            raise _error("nexus_invalid_response", "protocol", response.status_code)
        declared: int | None = None
        if "content-length" in response.headers:
            try:
                declared = int(response.headers["content-length"])
            except ValueError:
                raise _error("nexus_invalid_response", "protocol", response.status_code) from None
            if declared < 0:
                raise _error("nexus_invalid_response", "protocol", response.status_code)
            if declared > RESPONSE_MAX_BYTES:
                raise _error("nexus_client_response_too_large", "transport", response.status_code)
        chunks: list[bytes] = []
        total = 0
        async for chunk in response.aiter_bytes(RESPONSE_MAX_BYTES if RESPONSE_MAX_BYTES < 65_536 else 65_536):
            total += len(chunk)
            if total > RESPONSE_MAX_BYTES:
                raise _error("nexus_client_response_too_large", "transport", response.status_code)
            chunks.append(chunk)
        if declared is not None and declared != total:
            raise _error("nexus_invalid_response", "protocol", response.status_code)
        return b"".join(chunks)

    async def _cleanup(
        self,
        response: httpx.Response | None,
        client: httpx.AsyncClient,
    ) -> tuple[bool, asyncio.CancelledError | None]:
        """Attempt every closer within one deadline and defer caller cancellation."""
        closers = []
        if response is not None:
            closers.append(("response", response.aclose))
        closers.append(("client", client.aclose))
        tasks = {
            asyncio.create_task(closer(), name=f"hermes-nexus-close-{name}")
            for name, closer in closers
        }
        pending = set(tasks)
        deadline = asyncio.get_running_loop().time() + CLEANUP_TIMEOUT_SECONDS
        cancellation: asyncio.CancelledError | None = None
        timed_out = False

        while pending:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                timed_out = True
                break
            try:
                _done, pending = await asyncio.wait(pending, timeout=remaining)
            except asyncio.CancelledError as exc:
                if cancellation is None:
                    cancellation = exc
                current = asyncio.current_task()
                if current is not None:
                    current.uncancel()
                continue
            if pending:
                timed_out = True
                break

        if pending:
            # A second cancellation terminates a closer that handled the first.
            # Each pulse yields only one event-loop turn and cannot extend the
            # configured cleanup deadline into another blocking wait.
            for _attempt in range(4):
                for task in pending:
                    task.cancel()
                try:
                    await asyncio.sleep(0)
                except asyncio.CancelledError as exc:
                    if cancellation is None:
                        cancellation = exc
                    current = asyncio.current_task()
                    if current is not None:
                        current.uncancel()
                pending = {task for task in pending if not task.done()}
                if not pending:
                    break

        failed = timed_out or bool(pending)
        for task in tasks - pending:
            try:
                task.result()
            except BaseException:
                failed = True
        return not failed, cancellation
