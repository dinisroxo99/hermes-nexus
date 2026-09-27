"""Agent-facing adapters for the two read-only Hermes Nexus operations."""

from __future__ import annotations

import asyncio
import json
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
    runId/profile from handler **kwargs (verbatim). Skips rather than invent.
    Exactly 6 keys; fresh dict; list copies only; never mutates inputs.
    try/except Exception wraps ONLY the collect_forward_log(fields) call.
    Any exception or not_evaluated return leaves the caller's JSON result unchanged.
    """
    try:
        if not isinstance(result, dict) or not isinstance(kwargs, dict):
            return
        run_id = kwargs.get("runId")
        profile = kwargs.get("profile")
        if not isinstance(run_id, str) or run_id.strip() == "":
            return
        if not isinstance(profile, str) or profile.strip() == "":
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
