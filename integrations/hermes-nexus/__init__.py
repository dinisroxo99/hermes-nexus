"""Hermes Nexus standalone plugin registration."""

from __future__ import annotations

import importlib

from .client import NexusClientError, validate_base_url
from .legacy_schemas import ADMIN_TOOL_NAMES, READ_TOOL_NAMES
from .legacy_tools import legacy_registrations
from .schemas import PROJECT_IMPACT_SCHEMA, PROJECT_TASK_CONTEXT_SCHEMA
from .tools import create_handlers


_CORE_TOOL_NAMES = ("project_task_context", "project_impact")
_LEGACY_TOOL_NAMES = (*READ_TOOL_NAMES, *ADMIN_TOOL_NAMES)


def _tool_exists(ctx, name: str) -> bool:
    probe = getattr(ctx, "has_registered_tool", None)
    if callable(probe):
        return bool(probe(name))
    manager = getattr(ctx, "_manager", None)
    scope = getattr(manager, "scope_key", None)
    if scope is None:
        return False
    registry = importlib.import_module("tools.registry").registry
    return registry.get_entry(name, scope=scope) is not None


def register(ctx) -> None:
    """Register the core catalog and optional bounded legacy catalog without I/O."""
    base_url = ctx.get_config("base_url")
    legacy_enabled = ctx.get_config("legacy_enabled", False)
    if type(legacy_enabled) is not bool:
        raise RuntimeError("Hermes Nexus legacy_enabled must be a boolean.")
    names = (*_CORE_TOOL_NAMES, *_LEGACY_TOOL_NAMES) if legacy_enabled else _CORE_TOOL_NAMES
    if any(_tool_exists(ctx, name) for name in names):
        raise RuntimeError("Hermes Nexus tool registration was refused.")
    task_context, impact = create_handlers(base_url)

    def available() -> bool:
        try:
            validate_base_url(base_url)
        except NexusClientError:
            return False
        return True

    handles = []
    registrations = [
        (_CORE_TOOL_NAMES[0], "project_intelligence", PROJECT_TASK_CONTEXT_SCHEMA, task_context),
        (_CORE_TOOL_NAMES[1], "project_intelligence", PROJECT_IMPACT_SCHEMA, impact),
    ]
    if legacy_enabled:
        registrations.extend(legacy_registrations(base_url))
    try:
        for name, toolset, schema, handler in registrations:
            handle = ctx.register_tool(
                name=name,
                toolset=toolset,
                schema=schema,
                handler=handler,
                check_fn=available,
                is_async=True,
                override=False,
                description=schema["description"],
            )
            # The real PluginContext returns None when a scoped name is already
            # owned. Minimal capability-probe contexts historically return None
            # for every successful recording call and have no host manager.
            if handle is None and hasattr(ctx, "_manager"):
                raise RuntimeError("Hermes Nexus tool registration was refused.")
            if handle is not None:
                handles.append(handle)
    except Exception:
        for handle in reversed(handles):
            dispose = getattr(handle, "dispose", None)
            if callable(dispose):
                dispose()
        raise
