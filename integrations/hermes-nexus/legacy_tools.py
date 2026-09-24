"""Agent-facing handlers for bounded legacy Project Map compatibility tools."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .client import NexusClient, NexusClientError
from .legacy_schemas import (
    ADMIN_TOOL_NAMES,
    LEGACY_SCHEMAS,
    READ_TOOL_NAMES,
    LegacyArgumentsError,
    validate_legacy_arguments,
)


_ADMIN_MESSAGE = (
    "This administrative operation requires explicit operation authorization and was not attempted."
)


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


def _admin_denial(tool: str) -> str:
    return _json(
        {
            "tool": tool,
            "ok": False,
            "error": "REQUIRES_EXPLICIT_OPERATION_AUTHORIZATION",
            "category": "authorization",
            "httpStatus": None,
            "message": _ADMIN_MESSAGE,
            "execution": "not_attempted",
        }
    )


async def _invoke_read(tool: str, args: Any, base_url: Any) -> str:
    try:
        validated = validate_legacy_arguments(tool, args)
        result = await NexusClient(base_url).request_legacy(tool, validated)
        return _json(result)
    except asyncio.CancelledError:
        raise
    except LegacyArgumentsError:
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


async def _invoke_admin(tool: str, args: Any) -> str:
    try:
        validate_legacy_arguments(tool, args)
        return _admin_denial(tool)
    except asyncio.CancelledError:
        raise
    except LegacyArgumentsError:
        return _failure(
            tool,
            "nexus_invalid_arguments",
            "input",
            "The tool arguments are invalid.",
        )
    except Exception:
        return _failure(
            tool,
            "nexus_client_failed",
            "protocol",
            "The Nexus client failed safely.",
        )


def create_legacy_handlers(base_url: Any) -> dict[str, Any]:
    """Bind fixed profile-local configuration without client creation or I/O."""
    handlers: dict[str, Any] = {}

    for name in READ_TOOL_NAMES:
        async def read_handler(args: dict[str, Any], *, _tool: str = name, **_kwargs: Any) -> str:
            return await _invoke_read(_tool, args, base_url)

        handlers[name] = read_handler

    for name in ADMIN_TOOL_NAMES:
        async def admin_handler(args: dict[str, Any], *, _tool: str = name, **_kwargs: Any) -> str:
            return await _invoke_admin(_tool, args)

        handlers[name] = admin_handler

    return handlers


def legacy_registrations(base_url: Any) -> tuple[tuple[str, str, dict[str, Any], Any], ...]:
    """Return the exact ordered legacy registration catalog."""
    handlers = create_legacy_handlers(base_url)
    return tuple(
        (
            name,
            "project_map" if name in READ_TOOL_NAMES else "project_map_admin",
            LEGACY_SCHEMAS[name],
            handlers[name],
        )
        for name in (*READ_TOOL_NAMES, *ADMIN_TOOL_NAMES)
    )
