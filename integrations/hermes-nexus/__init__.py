"""Hermes Nexus standalone plugin registration."""

from __future__ import annotations

import importlib

from .client import NexusClientError, validate_base_url
from .effective_task_scope import compose_effective_task_scope
from .schemas import EFFECTIVE_TASK_SCOPE_SCHEMA, PROJECT_IMPACT_SCHEMA, PROJECT_TASK_CONTEXT_SCHEMA
from .tools import create_handlers, create_scope_handler


_TOOL_NAMES = ("project_task_context", "project_impact")


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
    """Register exactly two async, read-only tools without contacting Nexus."""
    base_url = ctx.get_config("base_url")
    scope_enabled = ctx.get_config("scope_enabled", False)
    if type(scope_enabled) is not bool:
        raise RuntimeError("Hermes Nexus scope_enabled must be a boolean.")
    if any(_tool_exists(ctx, name) for name in _TOOL_NAMES):
        raise RuntimeError("Hermes Nexus tool registration was refused.")
    task_context, impact = create_handlers(base_url)

    def available() -> bool:
        try:
            validate_base_url(base_url)
        except NexusClientError:
            return False
        return True

    handles = []
    registrations = (
        (_TOOL_NAMES[0], PROJECT_TASK_CONTEXT_SCHEMA, task_context),
        (_TOOL_NAMES[1], PROJECT_IMPACT_SCHEMA, impact),
    )
    try:
        for name, schema, handler in registrations:
            handle = ctx.register_tool(
                name=name,
                toolset="project_intelligence",
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
        if scope_enabled:
            # gated third handler; schema supplied only at register time (pack+impact)
            # hide mechanism is non-registration when flag false (dispatch ignores check_fn for hide)
            scope_handler = create_scope_handler()
            handle = ctx.register_tool(
                name="project_effective_task_scope",
                toolset="project_intelligence",
                schema=EFFECTIVE_TASK_SCOPE_SCHEMA,
                handler=scope_handler,
                check_fn=available,
                is_async=True,
                override=False,
                description=EFFECTIVE_TASK_SCOPE_SCHEMA["description"],
            )
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
