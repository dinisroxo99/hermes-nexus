# Hermes pre-tool veto probe

The local probe answers two questions about a specific Hermes Agent checkout. Can a plugin veto an ordinary tool
call before its handler runs? Does a plugin calling another tool via `PluginContext.dispatch_tool` go through
the same hook?

## Run

From the Nexus root, use a Python interpreter with the dependencies for the **trusted** Hermes checkout you
intend to exercise. The argument must name a clean Git worktree root. The experiment imports and runs that
checkout's Python code. It creates a temporary profile and registers an in-memory sentinel tool that records
its arguments. It does not call a shell, edit a project, register a production plugin, or contact a live Hermes
service. Ordinary Python socket connections and subprocess launches are disabled inside the worker.

```bash
/path/to/hermes/venv/bin/python -B -m scripts.hermes_guard_probe --checkout /path/to/hermes-agent
```

The child process receives a fresh home, profile, working directory and empty bundled-plugin directory.
Project plugin discovery is disabled and the parent environment's credentials and Python path are omitted.
The command checks the Git revision before and after the run. It prints a single JSON report and exits zero
only when the normal call delivers the positive control and honors the veto. Read the independent
`direct_plugin_dispatch` result even when the exit status is zero. An import failure, a dirty checkout
or a timeout cannot produce a positive result.

## Observations on 2026-11-09

| Upstream checkout | Normal control | Normal denied call | Direct plugin call while denied |
| --- | --- | --- | --- |
| Historical Nexus install source `903a57c540917cedd30c7d971938f1af7bdf60e2` | Handler and hook each ran once | Hook ran, handler did not run, exact block message returned | Handler ran, hook did not run |
| Upstream main observed at `546f3b3032d6e21e72dc5240091da1275005d847` | Same | Same | Same |

Both results came from isolated source checkouts, using Python 3.12. The process registered the callback with
Hermes' `PluginContext.register_hook` and invoked `model_tools.handle_function_call`. An allowed call had to
reach the sentinel. A denied call had to return the specified error, run the hook and leave the handler count
unchanged. The direct call then repeated the denied input through the plugin facade.

## What the result covers

- The normal dispatcher checks a `{"action":"block","message":"..."}` directive before calling the registry.
  The agent's own execution path also has a pre-dispatch check in the inspected source. Only the ordinary
  dispatcher was executed in this experiment. [Pinned dispatcher](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/model_tools.py#L765) · [Agent executor](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/agent/tool_executor.py#L663)
- A plugin can use `PluginContext.dispatch_tool`, which calls the registry directly. The probe reproduced this
  coverage gap on both revisions. [Pinned plugin API](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/hermes_cli/plugins.py#L704) · [Second checkout](https://github.com/NousResearch/hermes-agent/blob/546f3b3032d6e21e72dc5240091da1275005d847/hermes_cli/plugins_context.py#L483)
- An ordinary terminal request can be vetoed at the dispatch boundary. An allowed shell executes its command
  inside the selected backend. Subsequent operating-system file operations do not individually return to
  that hook. The upstream code-execution tool's default nested-tool RPC does use the ordinary dispatcher.
  Neither a shell nor a nested code-execution tool was invoked by this probe. [Terminal execution](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/tools/terminal_tool.py#L1156) · [Nested tool RPC](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/tools/code_execution_rpc.py#L28)
- At the historical source pin, a registered callback error or timeout can yield a block directive inside the
  hook manager. The outer dispatcher's hook-infrastructure exception handler can proceed without a block.
  These are separate failure paths and require separate integration tests. [Hook manager](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/hermes_cli/plugins_dispatch.py#L209) · [Outer dispatcher](https://github.com/NousResearch/hermes-agent/blob/903a57c540917cedd30c7d971938f1af7bdf60e2/model_tools.py#L773)

A live worker run, deployment/profile installation, enforcement across plugins and shell effects, and containment
of untrusted code remain outside this experiment. Replaying it against upstream source supplements the historical
[installed-profile evidence](../CURRENT_STATUS.md). It does not identify the runtime loaded on the operator's host.
