"""Opt-in native Hermes observer; hook callbacks never make control decisions."""
import logging
import os

from .events import ObserverError, observe
from .ledger import persist


def register(ctx):
    target = os.environ.get("NEXUS_USAGE_OBSERVER_DIR")
    if not target:
        return

    def post_api_request(**kwargs):
        try:
            event = observe(os.environ, **kwargs)
            if event is not None:
                persist(target, event)
        except (ObserverError, OSError, ImportError) as exc:
            code = str(exc) if isinstance(exc, ObserverError) else "capture_unavailable"
            logging.getLogger(__name__).warning("Usage observation dropped: %s", code)

    ctx.register_hook("post_api_request", post_api_request)
