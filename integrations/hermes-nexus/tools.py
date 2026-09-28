"""Agent-facing adapters for the two read-only Hermes Nexus operations."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from .client import NexusClient, NexusClientError
from .collect_forward_log import collect_forward_log
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


def _collect_forward_after_accepted(result: dict[str, Any], args: Any, **kwargs: Any) -> None:
    """Sole call site for collect_forward_log.

    Called only on accepted results (c/i after ok+data; ets when v1 accepted incl. incomplete).
    runId/profile resolved per ordered sources (eligible = isinstance(str) and strip() != '';
    forward original verbatim):
      profile: kwargs.profile → HERMES_PROFILE → HERMES_HOME (exact .../profiles/<name> only) →
               __file__ (exact .../profiles/<name>/plugins/hermes-nexus/tools.py or
                         .../plugins/hermes-nexus/integrations/hermes-nexus/tools.py) → skip.
      If HERMES_HOME and __file__ both yield names and they differ → fail-closed, do not persist
      (conflict check applied only when falling through to HOME/__file__ sources).
      Never default to "architect"; never infer from cwd or invent names.
    runId: kwargs.runId → os.environ.get('HERMES_KANBAN_RUN_ID') → kwargs.session_id → kwargs.task_id → skip.
    (If both session_id and task_id eligible and no earlier run source: session_id wins.)
    If either identity unresolved: do not call collect_forward_log.
    Exactly 6 keys; fresh dict; list copies only; never mutates inputs.
    try/except Exception wraps ONLY the collect_forward_log(fields) call.
    Any exception or not_evaluated return leaves the caller's JSON result unchanged.
    """
    try:
        if not isinstance(result, dict) or not isinstance(kwargs, dict):
            return

        def _eligible(v: Any) -> bool:
            return isinstance(v, str) and v.strip() != ""

        # profile resolution (fail-closed on HOME vs __file__ conflict)
        home_name = None
        home = os.environ.get("HERMES_HOME") or ""
        if _eligible(home):
            try:
                hp = Path(home)  # as-given; no .resolve() (no cwd join, no symlink follow)
                if hp.parent.name == "profiles":
                    n = hp.name
                    if _eligible(n):
                        home_name = n
            except Exception:
                pass

        file_name = None
        try:
            fp = Path(__file__)  # as-given; no .resolve() before layout check
            # contract/flat installed layout: .../profiles/<name>/plugins/hermes-nexus/tools.py
            if (
                fp.name == "tools.py"
                and fp.parent.name == "hermes-nexus"
                and fp.parent.parent.name == "plugins"
                and fp.parent.parent.parent.parent.name == "profiles"
            ):
                n = fp.parent.parent.parent.name
                if _eligible(n):
                    file_name = n
            # nested dev layout (still supported): .../profiles/<name>/plugins/hermes-nexus/integrations/hermes-nexus/tools.py
            elif (
                fp.name == "tools.py"
                and fp.parent.name == "hermes-nexus"
                and fp.parent.parent.name == "integrations"
                and fp.parent.parent.parent.name == "hermes-nexus"
                and fp.parent.parent.parent.parent.name == "plugins"
                and fp.parent.parent.parent.parent.parent.parent.name == "profiles"
            ):
                n = fp.parent.parent.parent.parent.parent.name
                if _eligible(n):
                    file_name = n
        except Exception:
            pass

        # profile: kwargs.profile → HERMES_PROFILE → HOME exact → __file__ exact → skip
        # HOME vs __file__ conflict skip only applied when falling through (no higher source)
        profile = kwargs.get("profile")
        if not _eligible(profile):
            profile = os.environ.get("HERMES_PROFILE")
            if not _eligible(profile):
                if home_name and file_name and home_name != file_name:
                    return  # fail-closed, do not persist
                profile = home_name
                if not _eligible(profile):
                    profile = file_name
                    if not _eligible(profile):
                        return
        profile = str(profile).strip() if _eligible(profile) else None
        if not _eligible(profile):
            return

        # runId: kwargs `runId` → os.environ.get('HERMES_KANBAN_RUN_ID') → kwargs `session_id` → kwargs `task_id` → skip
        # session wins over task_id when both and no prior source
        run_id = kwargs.get("runId")
        if not _eligible(run_id):
            run_id = os.environ.get("HERMES_KANBAN_RUN_ID")
            if not _eligible(run_id):
                run_id = kwargs.get("session_id")
                if not _eligible(run_id):
                    run_id = kwargs.get("task_id")
                    if not _eligible(run_id):
                        return

        # unwrap c/i result or treat ets scope as core
        if result.get("ok") is True and isinstance(result.get("data"), dict):
            core = result["data"]
            is_ets = False
        else:
            core = result
            is_ets = True

        if not isinstance(core, dict):
            return

        if is_ets:
            if (
                core.get("schemaVersion") != 1
                or core.get("analysisVersion") != "effective-task-scope-v1"
                or core.get("ok") is False
                or core.get("status") == "rejected"
            ):
                return
            sha = core.get("revisionBinding", {}).get("commitSha")
            nexus_tools = False
            write_raw = core.get("write")
            if not isinstance(write_raw, list):
                return
            write_list: list[str] = []
            for item in write_raw:
                if isinstance(item, dict):
                    p = item.get("path")
                    if not isinstance(p, str) or p.strip() == "":
                        return
                    write_list.append(p)
            watch_raw = core.get("watch")
            if not isinstance(watch_raw, list):
                return
            watch_list: list[str] = []
            for item in watch_raw:
                if isinstance(item, dict):
                    p = item.get("path")
                    if not isinstance(p, str) or p.strip() == "":
                        return
                    watch_list.append(p)
        else:
            rev = core.get("revision")
            if not isinstance(rev, dict):
                return
            sha = rev.get("commitSha")
            nexus_tools = True
            # context if args carries 'task' (per contract); impact otherwise
            if isinstance(args, dict) and isinstance(args.get("task"), dict):
                task_paths = args["task"].get("paths")
                if not isinstance(task_paths, list):
                    return
                write_list: list[str] = []
                for p in task_paths:
                    if not isinstance(p, str) or p.strip() == "":
                        return
                    write_list.append(p)
                watch_list: list[str] = []
            else:
                write_list = []
                watch_list = []

        if not isinstance(sha, str) or sha.strip() == "":
            return

        fields: dict[str, Any] = {
            "runId": run_id,
            "profile": profile,
            "sha": sha,
            "nexusTools": nexus_tools,
            "writePaths": list(write_list),
            "watchPaths": list(watch_list),
        }
        # only the collect call is wrapped
        collect_forward_log(fields)
    except Exception:
        # isolated: do not change the tool result JSON
        pass


async def _invoke(tool: str, args: Any, base_url: Any, **kwargs: Any) -> str:
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
        if isinstance(result, dict) and result.get("ok") is True and isinstance(result.get("data"), dict):
            _collect_forward_after_accepted(result, args, **kwargs)
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

    async def project_task_context(args: dict[str, Any], **kwargs: Any) -> str:
        return await _invoke("project_task_context", args, base_url, **kwargs)

    async def project_impact(args: dict[str, Any], **kwargs: Any) -> str:
        return await _invoke("project_impact", args, base_url, **kwargs)

    return project_task_context, project_impact


def create_scope_handler() -> Any:
    """Create the gated effective task scope caller handler (local compose only, receives already-accepted ok=true pack+impact).

    Does not call Nexus. Returns the compose result (v1 or existing fail-closed reject codes).
    include_tests omitted/None forces False per contract. Never mutates; caller does not wash errors.
    """

    async def project_effective_task_scope(args: dict[str, Any], **kwargs: Any) -> str:
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
        if isinstance(scope, dict):
            sv = scope.get("schemaVersion")
            av = scope.get("analysisVersion")
            if (
                sv == 1
                and av == "effective-task-scope-v1"
                and scope.get("ok") is not False
                and scope.get("status") != "rejected"
            ):
                _collect_forward_after_accepted(scope, args, **kwargs)
        return _json(scope)

    return project_effective_task_scope
