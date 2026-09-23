from __future__ import annotations

import asyncio
import importlib.util
import json
import math
import sys
import unittest
from pathlib import Path

import httpx


def _load_module():
    path = Path(__file__).parents[2] / "integrations" / "hermes-nexus" / "client.py"
    spec = importlib.util.spec_from_file_location("hermes_nexus_test_client", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


client_module = _load_module()
HEX40 = "a" * 40
REPOSITORY_ID = "b" * 64
WORKTREE_ID = "c" * 64


def arguments(*, impact=False):
    revision = {
        "status": "available",
        "commitSha": HEX40,
        "branch": "feat/test",
        "dirty": False,
        "isLinkedWorktree": True,
    }
    if impact:
        revision.update(repositoryId=REPOSITORY_ID, worktreeId=WORKTREE_ID)
    return {
        "projectId": "prj_123",
        "worktree": {"rootId": "local", "relativePath": "checkout"},
        "expectedRevision": revision,
    }


def revision(*, impact=False):
    value = {
        "status": "available",
        "commitSha": HEX40,
        "branch": "feat/test",
        "dirty": False,
        "isLinkedWorktree": True,
        "worktreeId": WORKTREE_ID,
    }
    value["repositoryId" if impact else "repositoryIdentity"] = REPOSITORY_ID
    return value


def context_data():
    sections = {}
    for name in ("task", "policy", "workspaces", "documents", "constraints", "files", "symbols", "references", "tests", "diagnostics"):
        sections[name] = {
            "status": "available",
            "truncated": False,
            "items": [],
            "limit": 1,
            "provenance": {"projectId": "prj_123"},
        }
    return {
        "schemaVersion": 1,
        "analysisVersion": "task-context-v1",
        "contextPackId": "context_" + "d" * 64,
        "projectId": "prj_123",
        "project": {"rootId": "local", "relativePath": "checkout"},
        "generatedAt": None,
        "revision": revision(),
        "analysis": {
            "status": "partial",
            "provider": None,
            "coverage": {},
            "snapshotToken": "snapshot",
            "attempts": [],
            "provenance": {"projectId": "prj_123"},
        },
        "observation": {
            "basis": "working_tree",
            "cacheReuse": "disabled",
            "digestCoverage": "bounded_collected_sources",
            "sourceDigest": "digest",
            "incomplete": True,
        },
        "sections": sections,
        "additive": {"preserved": True},
    }


def impact_data():
    return {
        "schemaVersion": 1,
        "analysisVersion": "impact-v2",
        "projectId": "prj_123",
        "project": {"rootId": "local", "relativePath": "checkout"},
        "generatedAt": None,
        "revision": revision(impact=True),
        "worktree": {"worktreeId": WORKTREE_ID},
        "snapshotToken": "snapshot",
        "provider": None,
        "coverage": {},
        "observation": {
            "basis": "working_tree",
            "cacheReuse": "disabled",
            "digestCoverage": "bounded_collected_sources",
            "incomplete": True,
        },
        "status": "unsupported",
        "findingState": "not_evaluated",
        "affectedFiles": [],
        "affectedTests": {"status": "not_requested", "candidates": []},
        "limits": {},
        "completeness": {"source": [], "provider": ["provider_unsupported"], "traversal": [], "output": []},
        "unknownAdditive": [1, 2],
    }


def response(data, message, *, status=200, headers=None):
    return httpx.Response(
        status,
        json={"ok": status == 200, "data": data, "message": message} if status == 200 else data,
        headers=headers or {"content-type": "application/json; charset=utf-8"},
    )


def encoded_envelope(data, message):
    return json.dumps(
        {"ok": True, "data": data, "message": message},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


class StreamingBytes(httpx.AsyncByteStream):
    def __init__(self, *chunks, failure=None):
        self.chunks = chunks
        self.failure = failure
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            yield chunk
        if self.failure is not None:
            raise self.failure

    async def aclose(self):
        self.closed = True


class ConfigurationAndParsingTests(unittest.TestCase):
    def test_base_url_accepts_only_literal_loopback_explicit_port(self):
        self.assertEqual(client_module.validate_base_url("http://127.0.0.1:8770"), "http://127.0.0.1:8770")
        self.assertEqual(client_module.validate_base_url("http://127.0.0.1:8770/"), "http://127.0.0.1:8770")
        for invalid in (
            None, "", "http://localhost:8770", "https://127.0.0.1:8770",
            "http://user@127.0.0.1:8770", "http://127.0.0.1:8770/api",
            "http://127.0.0.1:8770/?x=1", "http://127.0.0.1:8770/#x",
            "http://127.0.0.1", "http://127.0.0.1:8770//",
            "http://127.0.0.1:8770?", "http://127.0.0.1:8770#",
            "http://127.0.0.1:8770/?", "http://127.0.0.1:8770/#",
            " http://127.0.0.1:8770", "http://127.0.0.1:8770 ",
            "http://127.0.0.1:8770\n", "http://127.0.0.1:\t8770",
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(client_module.NexusClientError) as caught:
                    client_module.validate_base_url(invalid)
                self.assertEqual(caught.exception.code, "nexus_configuration_error")

    def test_request_serialization_is_compact_utf8_and_rejects_nonfinite(self):
        self.assertEqual(client_module.serialize_request({"é": True}), b'{"\xc3\xa9":true}')
        with self.assertRaises(client_module.NexusClientError) as caught:
            client_module.serialize_request({"x": float("nan")})
        self.assertEqual(caught.exception.code, "nexus_invalid_arguments")

    def test_request_guard_accepts_exact_limit_and_rejects_one_over(self):
        exact_text = "x" * (client_module.REQUEST_MAX_BYTES - len(b'{"x":""}'))
        self.assertEqual(len(client_module.serialize_request({"x": exact_text})), client_module.REQUEST_MAX_BYTES)
        with self.assertRaises(client_module.NexusClientError) as caught:
            client_module.serialize_request({"x": exact_text + "x"})
        self.assertEqual(caught.exception.code, "nexus_client_request_too_large")

    def test_parser_rejects_duplicate_nonfinite_invalid_utf8_and_nonobject(self):
        for raw in (
            b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":1e999}',
            b'{"error":{"nested":[1e999]}}', b"\xff", b"[]", b"not-json",
        ):
            with self.subTest(raw=raw):
                with self.assertRaises(client_module.NexusClientError) as caught:
                    client_module.parse_response(raw)
                self.assertEqual(caught.exception.code, "nexus_invalid_response")

    def test_parser_preserves_finite_numbers_and_rejects_deep_json(self):
        parsed = client_module.parse_response(b'{"x":1e308,"nested":{"y":-1.25}}')
        self.assertTrue(math.isfinite(parsed["x"]))
        self.assertEqual(parsed["nested"]["y"], -1.25)
        nested = ("[" * 102 + "0" + "]" * 102).encode()
        with self.assertRaises(client_module.NexusClientError) as caught:
            client_module.parse_response(b'{"deep":' + nested + b"}")
        self.assertEqual(caught.exception.code, "nexus_invalid_response")


class ClientTests(unittest.IsolatedAsyncioTestCase):
    async def _call(self, tool, args, body, handler):
        transport = httpx.MockTransport(handler)
        return await client_module.NexusClient("http://127.0.0.1:8770", transport=transport).request(tool, args, body)

    async def test_context_exact_post_projection_headers_and_additive_data(self):
        seen = []

        async def handler(request):
            seen.append(request)
            self.assertEqual(request.method, "POST")
            self.assertEqual(request.url.path, "/api/intelligence/projects/prj_123/task-context")
            self.assertEqual(request.headers["accept"], "application/json")
            self.assertEqual(request.headers["accept-encoding"], "identity")
            self.assertEqual(request.headers["content-type"], "application/json; charset=utf-8")
            self.assertEqual(json.loads(request.content), {"task": {"title": "x"}, "worktree": args["worktree"]})
            return response(context_data(), "Task context constructed.")

        args = arguments()
        result = await self._call("project_task_context", args, {"task": {"title": "x"}, "worktree": args["worktree"]}, handler)
        self.assertEqual(len(seen), 1)
        self.assertTrue(result["ok"])
        self.assertEqual(result["data"]["additive"], {"preserved": True})

    async def test_impact_uses_distinct_repository_id_mapping(self):
        async def handler(request):
            self.assertEqual(request.url.path, "/api/intelligence/projects/prj_123/impact")
            self.assertNotIn("expectedRevision", json.loads(request.content))
            return response(impact_data(), "Project impact constructed.")

        result = await self._call("project_impact", arguments(impact=True), {"paths": ["a.js"], "worktree": arguments()["worktree"]}, handler)
        self.assertEqual(result["data"]["revision"]["repositoryId"], REPOSITORY_ID)
        self.assertEqual(result["data"]["unknownAdditive"], [1, 2])

    async def test_partial_and_truncated_domain_evidence_passes_through_unchanged(self):
        context = context_data()
        context["sections"]["files"]["truncated"] = True
        context["sections"]["files"]["status"] = "partial"

        async def context_handler(_request):
            return response(context, "Task context constructed.")

        context_result = await self._call("project_task_context", arguments(), {}, context_handler)
        self.assertEqual(context_result["data"], context)

        impact = impact_data()
        impact["status"] = "partial"
        impact["findingState"] = "evidence_found"
        impact["completeness"]["output"] = ["output_byte_limit"]
        impact["affectedFiles"] = [{"path": "src/a.js", "additive": {"truncated": True}}]

        async def impact_handler(_request):
            return response(impact, "Project impact constructed.")

        impact_result = await self._call("project_impact", arguments(impact=True), {}, impact_handler)
        self.assertEqual(impact_result["data"], impact)

    async def test_both_tools_use_exact_path_for_both_accepted_base_url_forms(self):
        cases = (
            ("project_task_context", arguments(), "/api/intelligence/projects/prj_123/task-context", context_data(), "Task context constructed."),
            ("project_impact", arguments(impact=True), "/api/intelligence/projects/prj_123/impact", impact_data(), "Project impact constructed."),
        )
        for base_url in ("http://127.0.0.1:8770", "http://127.0.0.1:8770/"):
            for tool, args, expected_path, data, message in cases:
                seen = []

                async def handler(request, current_data=data, current_message=message):
                    seen.append((request.url.path, request.url.query, request.url.fragment))
                    return response(current_data, current_message)

                nexus = client_module.NexusClient(base_url, transport=httpx.MockTransport(handler))
                await nexus.request(tool, args, {})
                self.assertEqual(seen, [(expected_path, b"", "")])

    async def test_invalid_base_url_fails_before_client_or_network_creation(self):
        creations = 0

        def factory(**_kwargs):
            nonlocal creations
            creations += 1
            raise AssertionError("client must not be created")

        for suffix in ("?", "#", "/?", "/#", " ", "\n"):
            with self.subTest(suffix=suffix):
                with self.assertRaises(client_module.NexusClientError) as caught:
                    client_module.NexusClient("http://127.0.0.1:8770" + suffix, client_factory=factory)
                self.assertEqual(caught.exception.code, "nexus_configuration_error")
        self.assertEqual(creations, 0)

    async def test_each_identity_mismatch_withholds_data(self):
        mutations = (
            ("projectId", lambda data: data.update(projectId="wrong")),
            ("rootId", lambda data: data["project"].update(rootId="wrong")),
            ("relativePath", lambda data: data["project"].update(relativePath="wrong")),
            ("commitSha", lambda data: data["revision"].update(commitSha="f" * 40)),
            ("branch", lambda data: data["revision"].update(branch="wrong")),
            ("dirty", lambda data: data["revision"].update(dirty=True)),
            ("isLinkedWorktree", lambda data: data["revision"].update(isLinkedWorktree=False)),
            ("repositoryId", lambda data: data["revision"].update(repositoryId="e" * 64)),
            ("worktreeId", lambda data: data["revision"].update(worktreeId="e" * 64)),
        )
        for expected_field, mutate in mutations:
            with self.subTest(expected_field=expected_field):
                data = impact_data()
                mutate(data)

                async def handler(_request, current=data):
                    return response(current, "Project impact constructed.")

                with self.assertRaises(client_module.NexusClientError) as caught:
                    await self._call("project_impact", arguments(impact=True), {}, handler)
                self.assertEqual(caught.exception.code, "nexus_context_mismatch")
                self.assertIn(expected_field, caught.exception.mismatched_fields)
                self.assertNotIn("wrong", str(caught.exception.as_result("project_impact")))

    async def test_context_conflicting_repository_alias_and_provenance_mismatch_fail_closed(self):
        for expected_field, mutate in (
            ("repositoryId", lambda data: data["revision"].update(repositoryId="e" * 64)),
            ("provenance.projectId", lambda data: data["analysis"]["provenance"].update(projectId="wrong")),
        ):
            data = context_data()
            mutate(data)

            async def handler(_request, current=data):
                return response(current, "Task context constructed.")

            with self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, handler)
            self.assertEqual(caught.exception.code, "nexus_context_mismatch")
            self.assertIn(expected_field, caught.exception.mismatched_fields)

    async def test_impact_conflicting_context_style_repository_alias_fails_closed(self):
        data = impact_data()
        data["revision"]["repositoryIdentity"] = "e" * 64

        async def handler(_request):
            return response(data, "Project impact constructed.")

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_impact", arguments(impact=True), {}, handler)
        self.assertEqual(caught.exception.code, "nexus_context_mismatch")
        self.assertIn("repositoryId", caught.exception.mismatched_fields)

    async def test_missing_metadata_is_invalid_and_wrong_version_incompatible(self):
        data = context_data()
        data["revision"].pop("worktreeId")

        async def missing(_request):
            return response(data, "Task context constructed.")

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_task_context", arguments(), {}, missing)
        self.assertEqual(caught.exception.code, "nexus_invalid_response")

        data = context_data()
        data["analysisVersion"] = "future"

        async def future(_request):
            return response(data, "Task context constructed.")

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_task_context", arguments(), {}, future)
        self.assertEqual(caught.exception.code, "nexus_incompatible_response")

    async def test_allowlisted_http_error_preserves_only_code_status_and_fixed_message(self):
        async def handler(_request):
            return httpx.Response(
                409,
                json={"ok": False, "error": "impact_revision_changed", "message": "SECRET /home/person"},
                headers={"content-type": "application/json"},
            )

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_impact", arguments(impact=True), {}, handler)
        result = caught.exception.as_result("project_impact")
        self.assertEqual(result["error"], "impact_revision_changed")
        self.assertEqual(result["httpStatus"], 409)
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertEqual(result["message"], "Project impact could not be constructed safely.")

    async def test_spoofed_or_wrong_status_error_becomes_static_http_error(self):
        for status, code in ((409, "impact_failed"), (401, "project_not_found")):
            async def handler(_request, current_status=status, current_code=code):
                return httpx.Response(current_status, json={"ok": False, "error": current_code}, headers={"content-type": "application/json"})

            with self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_impact", arguments(impact=True), {}, handler)
            self.assertEqual(caught.exception.code, "nexus_http_error")

    async def test_redirect_is_not_followed(self):
        calls = 0

        async def handler(_request):
            nonlocal calls
            calls += 1
            return httpx.Response(302, content=b"not JSON", headers={"content-type": "text/html", "location": "http://127.0.0.1:8770/other"})

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_task_context", arguments(), {}, handler)
        self.assertEqual(caught.exception.code, "nexus_redirect_rejected")
        self.assertEqual(calls, 1)

    async def test_content_type_encoding_and_declared_oversize_rejected(self):
        cases = (
            ({"content-type": "text/plain"}, "nexus_invalid_response"),
            ({"content-type": "application/json", "content-encoding": "gzip"}, "nexus_invalid_response"),
            ({"content-type": "application/json", "content-length": str(client_module.RESPONSE_MAX_BYTES + 1)}, "nexus_client_response_too_large"),
        )
        for headers, code in cases:
            async def handler(_request, current=headers):
                class RawStream(httpx.AsyncByteStream):
                    async def __aiter__(self):
                        yield b"{}"

                return httpx.Response(200, stream=RawStream(), headers=current)

            with self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, handler)
            self.assertEqual(caught.exception.code, code, headers)

    async def test_no_length_stream_accepts_exact_limit_and_rejects_actual_one_over(self):
        data = context_data()
        data["padding"] = ""
        base = encoded_envelope(data, "Task context constructed.")
        data["padding"] = "x" * (client_module.RESPONSE_MAX_BYTES - len(base))
        exact = encoded_envelope(data, "Task context constructed.")
        self.assertEqual(len(exact), client_module.RESPONSE_MAX_BYTES)
        streams = []

        async def exact_handler(_request):
            stream = StreamingBytes(exact[:65535], exact[65535:])
            streams.append(stream)
            return httpx.Response(200, stream=stream, headers={"content-type": "application/json"})

        result = await self._call("project_task_context", arguments(), {}, exact_handler)
        self.assertTrue(result["ok"])
        self.assertTrue(streams[-1].closed)

        async def over_handler(_request):
            stream = StreamingBytes(exact, b"x")
            streams.append(stream)
            return httpx.Response(200, stream=stream, headers={"content-type": "application/json"})

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_task_context", arguments(), {}, over_handler)
        self.assertEqual(caught.exception.code, "nexus_client_response_too_large")
        self.assertEqual(caught.exception.http_status, 200)
        self.assertTrue(streams[-1].closed)

    async def test_declared_lengths_must_match_actual_stream_bytes(self):
        raw = encoded_envelope(context_data(), "Task context constructed.")
        for declared in (len(raw) - 1, len(raw) + 1):
            async def handler(_request, current=declared):
                return httpx.Response(
                    200,
                    stream=StreamingBytes(raw),
                    headers={"content-type": "application/json", "content-length": str(current)},
                )

            with self.subTest(declared=declared), self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, handler)
            self.assertEqual(caught.exception.code, "nexus_invalid_response")
            self.assertEqual(caught.exception.http_status, 200)

    async def test_split_multibyte_utf8_stream_succeeds(self):
        data = context_data()
        data["additive"] = {"text": "é"}
        raw = encoded_envelope(data, "Task context constructed.")
        split = raw.index("é".encode("utf-8")) + 1

        async def handler(_request):
            return httpx.Response(
                200,
                stream=StreamingBytes(raw[:split], raw[split:]),
                headers={"content-type": "application/json"},
            )

        result = await self._call("project_task_context", arguments(), {}, handler)
        self.assertEqual(result["data"]["additive"]["text"], "é")

    async def test_nested_numeric_overflow_is_protocol_error_with_received_status(self):
        raw = encoded_envelope(context_data(), "Task context constructed.")
        raw = raw.replace(b'"preserved":true', b'"preserved":{"nested":[1e999]}')

        async def handler(_request):
            return httpx.Response(200, content=raw, headers={"content-type": "application/json"})

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_task_context", arguments(), {}, handler)
        self.assertEqual(caught.exception.code, "nexus_invalid_response")
        self.assertEqual(caught.exception.http_status, 200)

        async def error_handler(_request):
            return httpx.Response(
                409,
                content=b'{"ok":false,"error":"impact_revision_changed","additive":{"value":1e999}}',
                headers={"content-type": "application/json"},
            )

        with self.assertRaises(client_module.NexusClientError) as caught:
            await self._call("project_impact", arguments(impact=True), {}, error_handler)
        self.assertEqual(caught.exception.code, "nexus_invalid_response")
        self.assertEqual(caught.exception.http_status, 409)

    async def test_total_deadline_maps_to_static_timeout(self):
        original = client_module.TOTAL_TIMEOUT_SECONDS
        client_module.TOTAL_TIMEOUT_SECONDS = 0.01
        try:
            async def handler(_request):
                await asyncio.sleep(1)
                return response(context_data(), "Task context constructed.")

            with self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, handler)
            self.assertEqual(caught.exception.code, "nexus_timeout")
        finally:
            client_module.TOTAL_TIMEOUT_SECONDS = original

    async def test_transport_timeout_matrix_and_post_header_status(self):
        for timeout_type in (
            httpx.ConnectTimeout,
            httpx.WriteTimeout,
            httpx.PoolTimeout,
            httpx.ReadTimeout,
        ):
            async def before_headers(_request, current=timeout_type):
                raise current("TEST_ONLY_SECRET")

            with self.subTest(timeout=timeout_type.__name__, phase="before"), self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, before_headers)
            self.assertEqual(caught.exception.code, "nexus_timeout")
            self.assertIsNone(caught.exception.http_status)

        for failure, expected_code in (
            (httpx.ReadTimeout("TEST_ONLY_SECRET"), "nexus_timeout"),
            (httpx.ReadError("TEST_ONLY_SECRET"), "nexus_connection_failed"),
        ):
            async def after_headers(_request, current=failure):
                return httpx.Response(
                    503,
                    stream=StreamingBytes(failure=current),
                    headers={"content-type": "application/json"},
                )

            with self.subTest(failure=type(failure).__name__, phase="after"), self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, after_headers)
            self.assertEqual(caught.exception.code, expected_code)
            self.assertEqual(caught.exception.http_status, 503)

    async def test_slow_trickle_cannot_defeat_total_deadline(self):
        original = client_module.TOTAL_TIMEOUT_SECONDS
        client_module.TOTAL_TIMEOUT_SECONDS = 0.03
        stream = None
        try:
            class SlowStream(StreamingBytes):
                async def __aiter__(self):
                    while True:
                        await asyncio.sleep(0.005)
                        yield b" "

            async def handler(_request):
                nonlocal stream
                stream = SlowStream()
                return httpx.Response(200, stream=stream, headers={"content-type": "application/json"})

            with self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, handler)
            self.assertEqual(caught.exception.code, "nexus_timeout")
            self.assertEqual(caught.exception.http_status, 200)
            self.assertTrue(stream.closed)
        finally:
            client_module.TOTAL_TIMEOUT_SECONDS = original

    async def test_cancellation_during_send_closes_client_and_leaves_no_cleanup_task(self):
        entered = asyncio.Event()
        client_closed = asyncio.Event()

        class TrackingClient(httpx.AsyncClient):
            async def aclose(self):
                await super().aclose()
                client_closed.set()

        async def handler(_request):
            entered.set()
            await asyncio.Event().wait()

        nexus = client_module.NexusClient(
            "http://127.0.0.1:8770",
            transport=httpx.MockTransport(handler),
            client_factory=TrackingClient,
        )
        task = asyncio.create_task(nexus.request("project_task_context", arguments(), {}))
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(client_closed.is_set())
        self.assertFalse([
            item for item in asyncio.all_tasks()
            if not item.done() and item.get_name().startswith("hermes-nexus-close-")
        ])

    async def test_cancellation_is_re_raised_and_transport_closed(self):
        closed = asyncio.Event()
        entered = asyncio.Event()

        class BlockingStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                entered.set()
                await asyncio.Event().wait()
                yield b""

            async def aclose(self):
                closed.set()

        async def handler(_request):
            return httpx.Response(200, stream=BlockingStream(), headers={"content-type": "application/json"})

        task = asyncio.create_task(self._call("project_task_context", arguments(), {}, handler))
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(closed.is_set())

    async def test_cleanup_failure_overrides_success_without_leaking_raw_error(self):
        class FailingCloseClient(httpx.AsyncClient):
            async def aclose(self):
                await super().aclose()
                raise RuntimeError("SECRET cleanup path")

        async def handler(_request):
            return response(context_data(), "Task context constructed.")

        transport = httpx.MockTransport(handler)
        nexus = client_module.NexusClient(
            "http://127.0.0.1:8770",
            transport=transport,
            client_factory=FailingCloseClient,
        )
        with self.assertRaises(client_module.NexusClientError) as caught:
            await nexus.request("project_task_context", arguments(), {})
        self.assertEqual(caught.exception.code, "nexus_cleanup_failed")
        self.assertEqual(caught.exception.http_status, 200)
        self.assertNotIn("SECRET", str(caught.exception))

    async def test_response_close_failure_still_attempts_client_close(self):
        calls = []

        class BadStream(StreamingBytes):
            async def aclose(self):
                calls.append("response")
                raise RuntimeError("TEST_ONLY_SECRET")

        class TrackingClient(httpx.AsyncClient):
            async def aclose(self):
                calls.append("client")
                await super().aclose()

        async def handler(_request):
            return httpx.Response(200, stream=BadStream(b"{}"), headers={"content-type": "text/plain"})

        nexus = client_module.NexusClient(
            "http://127.0.0.1:8770",
            transport=httpx.MockTransport(handler),
            client_factory=TrackingClient,
        )
        with self.assertRaises(client_module.NexusClientError) as caught:
            await nexus.request("project_task_context", arguments(), {})
        self.assertEqual(caught.exception.code, "nexus_cleanup_failed")
        self.assertEqual(caught.exception.http_status, 200)
        self.assertEqual(set(calls), {"response", "client"})

    async def test_cleanup_deadline_cancels_then_joins_resistant_closer(self):
        original = client_module.CLEANUP_TIMEOUT_SECONDS
        client_module.CLEANUP_TIMEOUT_SECONDS = 0.01
        cancellation_seen = asyncio.Event()
        release = asyncio.Event()
        client_closed = asyncio.Event()
        try:
            class ResistantClient(httpx.AsyncClient):
                async def aclose(self):
                    while not release.is_set():
                        try:
                            await release.wait()
                        except asyncio.CancelledError:
                            cancellation_seen.set()
                    await super().aclose()
                    client_closed.set()

            async def handler(_request):
                return response(context_data(), "Task context constructed.")

            nexus = client_module.NexusClient(
                "http://127.0.0.1:8770",
                transport=httpx.MockTransport(handler),
                client_factory=ResistantClient,
            )
            task = asyncio.create_task(
                nexus.request("project_task_context", arguments(), {})
            )
            await asyncio.wait_for(cancellation_seen.wait(), 1)
            await asyncio.sleep(0)
            self.assertFalse(task.done())
            release.set()
            with self.assertRaises(client_module.NexusClientError) as caught:
                await asyncio.wait_for(task, 1)
            self.assertEqual(caught.exception.code, "nexus_cleanup_failed")
            self.assertEqual(caught.exception.http_status, 200)
            self.assertTrue(client_closed.is_set())
            self.assertFalse([
                item for item in asyncio.all_tasks()
                if not item.done() and item.get_name().startswith("hermes-nexus-close-")
            ])
        finally:
            release.set()
            client_module.CLEANUP_TIMEOUT_SECONDS = original

    async def test_actual_httpx_eof_close_failure_is_cleanup_failure(self):
        raw = encoded_envelope(context_data(), "Task context constructed.")
        calls = []

        class FailingEofStream(StreamingBytes):
            async def aclose(self):
                calls.append("response")
                raise RuntimeError("TEST_ONLY_SECRET")

        class TrackingClient(httpx.AsyncClient):
            async def aclose(self):
                calls.append("client")
                await super().aclose()

        async def handler(_request):
            return httpx.Response(
                200,
                stream=FailingEofStream(raw),
                headers={"content-type": "application/json"},
            )

        nexus = client_module.NexusClient(
            "http://127.0.0.1:8770",
            transport=httpx.MockTransport(handler),
            client_factory=TrackingClient,
        )
        with self.assertRaises(client_module.NexusClientError) as caught:
            await nexus.request("project_task_context", arguments(), {})
        self.assertEqual(caught.exception.code, "nexus_cleanup_failed")
        self.assertEqual(caught.exception.http_status, 200)
        self.assertEqual(set(calls), {"response", "client"})

    async def test_actual_httpx_eof_completion_observes_both_closers(self):
        raw = encoded_envelope(context_data(), "Task context constructed.")
        calls = []

        class TrackingEofStream(StreamingBytes):
            async def aclose(self):
                calls.append("response")
                await super().aclose()

        class TrackingClient(httpx.AsyncClient):
            async def aclose(self):
                calls.append("client")
                await super().aclose()

        async def handler(_request):
            return httpx.Response(
                200,
                stream=TrackingEofStream(raw),
                headers={"content-type": "application/json"},
            )

        nexus = client_module.NexusClient(
            "http://127.0.0.1:8770",
            transport=httpx.MockTransport(handler),
            client_factory=TrackingClient,
        )
        result = await nexus.request("project_task_context", arguments(), {})
        self.assertTrue(result["ok"])
        self.assertEqual(set(calls), {"response", "client"})
        self.assertFalse([
            item for item in asyncio.all_tasks()
            if not item.done() and item.get_name().startswith("hermes-nexus-close-")
        ])

    async def test_actual_httpx_eof_uses_cleanup_deadline_and_completes_owned_tasks(self):
        original = client_module.CLEANUP_TIMEOUT_SECONDS
        client_module.CLEANUP_TIMEOUT_SECONDS = 0.01
        raw = encoded_envelope(context_data(), "Task context constructed.")
        cancellation_seen = asyncio.Event()
        closed = asyncio.Event()
        try:
            class SlowEofStream(StreamingBytes):
                async def aclose(self):
                    try:
                        await asyncio.Event().wait()
                    except asyncio.CancelledError:
                        cancellation_seen.set()
                    closed.set()

            async def handler(_request):
                return httpx.Response(
                    200,
                    stream=SlowEofStream(raw),
                    headers={"content-type": "application/json"},
                )

            with self.assertRaises(client_module.NexusClientError) as caught:
                await self._call("project_task_context", arguments(), {}, handler)
            self.assertEqual(caught.exception.code, "nexus_cleanup_failed")
            self.assertEqual(caught.exception.http_status, 200)
            self.assertTrue(cancellation_seen.is_set())
            self.assertTrue(closed.is_set())
            self.assertFalse([
                item for item in asyncio.all_tasks()
                if not item.done() and item.get_name().startswith("hermes-nexus-close-")
            ])
        finally:
            client_module.CLEANUP_TIMEOUT_SECONDS = original

    async def test_cancellation_during_actual_httpx_eof_waits_for_completion(self):
        raw = encoded_envelope(context_data(), "Task context constructed.")
        entered = asyncio.Event()
        release = asyncio.Event()
        closed = asyncio.Event()

        class GatedEofStream(StreamingBytes):
            async def aclose(self):
                entered.set()
                await release.wait()
                closed.set()

        async def handler(_request):
            return httpx.Response(
                200,
                stream=GatedEofStream(raw),
                headers={"content-type": "application/json"},
            )

        task = asyncio.create_task(
            self._call("project_task_context", arguments(), {}, handler)
        )
        await asyncio.wait_for(entered.wait(), 1)
        for _ in range(4):
            task.cancel()
            await asyncio.sleep(0)
        self.assertFalse(task.done())
        release.set()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
        self.assertTrue(closed.is_set())
        self.assertFalse([
            item for item in asyncio.all_tasks()
            if not item.done() and item.get_name().startswith("hermes-nexus-close-")
        ])

    async def test_repeated_cancellation_during_cleanup_is_deferred_until_closure(self):
        entered = asyncio.Event()
        release = asyncio.Event()
        client_closed = asyncio.Event()

        class SlowClient(httpx.AsyncClient):
            async def aclose(self):
                entered.set()
                await release.wait()
                await super().aclose()
                client_closed.set()

        async def handler(_request):
            return response(context_data(), "Task context constructed.")

        nexus = client_module.NexusClient(
            "http://127.0.0.1:8770",
            transport=httpx.MockTransport(handler),
            client_factory=SlowClient,
        )
        task = asyncio.create_task(nexus.request("project_task_context", arguments(), {}))
        await asyncio.wait_for(entered.wait(), 1)
        task.cancel()
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        release.set()
        with self.assertRaises(asyncio.CancelledError):
            await asyncio.wait_for(task, 1)
        self.assertTrue(client_closed.is_set())
        self.assertFalse([
            item for item in asyncio.all_tasks()
            if not item.done() and "aclose" in getattr(item.get_coro(), "__qualname__", "")
        ])


if __name__ == "__main__":
    unittest.main()
