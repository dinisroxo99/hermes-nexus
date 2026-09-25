"""Agent-facing adapters for the two read-only Hermes Nexus operations."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .client import NexusClient, NexusClientError
from .effective_task_scope import compose_effective_task_scope
from .schemas import ArgumentsError, validate_impact_arguments, validate_task_context_arguments


def _json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _failure(tool: str, code: str, category: str, message: str) -> str:
    return _json(
        {
            "tool": tool,
            "ok": False,
            "error": code,
            "category": category,
            "httpStatus": None,
            "message": message,
        }
    )


async def _invoke(tool: str, args: Any, base_url: Any) -> str:
    try:
        if tool == "project_task_context":
            validated = validate_task_context_arguments(args)
            body = {
                "task": validated["task"],
                "worktree": validated["worktree"],
            }
            for key in ("limits", "includeExcerpts"):
                if key in validated:
                    body[key] = validated[key]
        else:
            validated = validate_impact_arguments(args)
            body = {
                "paths": validated["paths"],
                "worktree": validated["worktree"],
            }
            for key in ("limits", "includeTests"):
                if key in validated:
                    body[key] = validated[key]
        result = await NexusClient(base_url).request(tool, validated, body)
        return _json(result)
    except asyncio.CancelledError:
        raise
    except ArgumentsError:
        return _failure(
            tool,
            "nexus_invalid_arguments",
            "input",
            "The tool arguments are invalid.",
        )
    except NexusClientError as error:
        return _json(error.as_result(tool))
    except Exception:
        return _failure(
            tool,
            "nexus_client_failed",
            "protocol",
            "The Nexus client failed safely.",
        )


def create_handlers(base_url: Any):
    """Bind profile-local configuration without performing network activity."""

    async def project_task_context(args: dict[str, Any], **_kwargs: Any) -> str:
        return await _invoke("project_task_context", args, base_url)

    async def project_impact(args: dict[str, Any], **_kwargs: Any) -> str:
        return await _invoke("project_impact", args, base_url)

    return project_task_context, project_impact


def create_scope_handler() -> Any:
    """Create the gated effective task scope caller handler (local compose only, receives already-accepted ok=true pack+impact).

    Does not call Nexus. Returns the compose result (v1 or existing fail-closed reject codes).
    include_tests omitted/None forces False per contract. Never mutates; caller does not wash errors.
    """

    async def project_effective_task_scope(args: dict[str, Any], **_kwargs: Any) -> str:
        if not isinstance(args, dict):
            pack = None
            impact = None
            include_tests = None
            task = None
        else:
            pack = args.get("pack")
            impact = args.get("impact")
            include_tests = args.get("includeTests") if "includeTests" in args else None
            task = args.get("task")
        # pack/impact expected already accepted (ok=true); compose handles extract + all fail-closed codes
        # do not call compose from the two core handlers
        scope = compose_effective_task_scope(
            pack, impact, include_tests=include_tests, task=task
        )
        return _json(scope)

    return project_effective_task_scope
