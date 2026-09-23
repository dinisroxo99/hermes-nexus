"""Hermes Nexus standalone plugin registration."""

from __future__ import annotations

from .client import NexusClientError, validate_base_url
from .schemas import PROJECT_IMPACT_SCHEMA, PROJECT_TASK_CONTEXT_SCHEMA
from .tools import create_handlers


def register(ctx) -> None:
    """Register exactly two async, read-only tools without contacting Nexus."""
    base_url = ctx.get_config("base_url")
    task_context, impact = create_handlers(base_url)

    def available() -> bool:
        try:
            validate_base_url(base_url)
        except NexusClientError:
            return False
        return True

    handles = []
    registrations = (
        ("project_task_context", PROJECT_TASK_CONTEXT_SCHEMA, task_context),
        ("project_impact", PROJECT_IMPACT_SCHEMA, impact),
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
    except Exception:
        for handle in reversed(handles):
            dispose = getattr(handle, "dispose", None)
            if callable(dispose):
                dispose()
        raise
