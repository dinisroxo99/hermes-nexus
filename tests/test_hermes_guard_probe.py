import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts.hermes_guard_probe.__main__ import run_probe
from scripts.hermes_guard_probe.worker import BLOCK, TOOL, experiment


class DispatchDouble:
    def register_hook(self, _event, callback):
        self.hook = callback

    def register_tool(self, _name, _toolset, _schema, handler):
        self.handler = handler

    def dispatch_tool(self, name, args, **_):
        return self.handler(args)

    def guarded(self, name, args, **_):
        directive = self.hook(name, args)
        if directive:
            return json.dumps({"error": directive["message"]})
        return self.dispatch_tool(name, args)


class ProbeTests(unittest.TestCase):
    def test_positive_control_and_observed_direct_dispatch_are_reported_separately(self):
        runtime = DispatchDouble()
        self.assertEqual(experiment(runtime, runtime.guarded), {
            "status": "veto_observed", "control_delivered": True, "ordinary_dispatch_blocked": True,
            "direct_plugin_dispatch": "executed_without_hook",
        })

    def test_error_text_alone_cannot_prove_veto(self):
        runtime = DispatchDouble()

        def dispatch(name, args, **kwargs):
            if args["mode"] == "deny":
                runtime.hook(name, args)
                runtime.dispatch_tool(name, args)
                return json.dumps({"error": BLOCK})
            return runtime.guarded(name, args, **kwargs)

        self.assertFalse(experiment(runtime, dispatch)["ordinary_dispatch_blocked"])

    def test_unavailable_tool_cannot_prove_veto(self):
        runtime = DispatchDouble()
        result = experiment(runtime, lambda *_args, **_kwargs: json.dumps({"error": BLOCK}))
        self.assertFalse(result["control_delivered"])
        self.assertEqual(result["status"], "veto_not_established")

    def test_hook_that_is_never_delivered_cannot_pass(self):
        runtime = DispatchDouble()
        self.assertEqual(experiment(runtime, runtime.dispatch_tool)["status"], "veto_not_established")

    def test_incompatible_direct_api_does_not_erase_normal_evidence(self):
        runtime = DispatchDouble()
        guarded = runtime.guarded
        def dispatch(name, args, **kwargs):
            if args["mode"] == "allow":
                runtime.hook(name, args)
                return runtime.handler(args)
            return guarded(name, args, **kwargs)
        with patch.object(runtime, "dispatch_tool", side_effect=TypeError):
            result = experiment(runtime, dispatch)
        self.assertEqual(result["status"], "veto_observed")
        self.assertEqual(result["direct_plugin_dispatch"], "inconclusive")

    @unittest.skipUnless(os.environ.get("HERMES_GUARD_PROBE_CHECKOUT"), "requires explicit trusted Hermes checkout")
    def test_against_real_checkout(self):
        result = run_probe(Path(os.environ["HERMES_GUARD_PROBE_CHECKOUT"]))
        self.assertEqual(result["status"], "veto_observed", result)
        self.assertTrue(result["control_delivered"])
        self.assertTrue(result["ordinary_dispatch_blocked"])


if __name__ == "__main__":
    unittest.main()
