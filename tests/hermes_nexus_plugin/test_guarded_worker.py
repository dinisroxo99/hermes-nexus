import errno
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from integrations.hermes_guard.__main__ import run, validate_calls
from integrations.hermes_guard.inputs import git, materialize
from integrations.hermes_guard.evidence import validate_evidence
from integrations.hermes_guard.receipt import verify
from integrations.hermes_guard.policy import Guard, REPLACE
from integrations.hermes_guard.runtime_source import prepare_runtime
from integrations.hermes_guard.sandbox import command, network_filter


class GuardedWorkerTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        git(self.repo, "init", "-q", "--template=")
        for name in ["edit.txt", "readonly.txt", "private.txt"]:
            (self.repo / name).write_text("old\n", encoding="utf-8")
        git(self.repo, "add", ".")
        git(self.repo, "-c", "user.name=Fixture", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture")
        self.rev = git(self.repo, "rev-parse", "HEAD").decode().strip()
        self.stage = self.root / "stage"
        self.stage.mkdir()

    def test_reads_only_granted_immutable_blobs(self):
        (self.repo / "edit.txt").write_text("dirty")
        grant = materialize(self.repo, self.rev, "task", ["readonly.txt"], ["edit.txt"], self.stage)
        self.assertEqual(grant["write"], ["edit.txt"])
        self.assertEqual((self.stage / "edit.txt").read_bytes(), b"old\n")
        self.assertFalse((self.stage / "private.txt").exists())

    def test_rejects_stale_revision_unsafe_path_duplicates_and_symlink(self):
        for revision, paths in [(self.rev, ["../bad"]), (self.rev, [".git/config"]), (self.rev, ["q", "q"]),
                                ("0" * 40, ["edit.txt"])]:
            with self.assertRaises(ValueError):
                materialize(self.repo, revision, "task", [], paths, self.stage)
        if hasattr(os, "symlink"):
            (self.repo / "link").symlink_to("edit.txt")
            git(self.repo, "add", "link")
            git(self.repo, "-c", "user.name=Fixture", "-c", "user.email=test@example.invalid", "commit", "-qm", "link")
            with self.assertRaises(ValueError):
                materialize(self.repo, git(self.repo, "rev-parse", "HEAD").decode().strip(), "task", [], ["link"], self.stage)

    def test_direct_handler_checks_scope_and_content_hash(self):
        grant = materialize(self.repo, self.rev, "task", ["readonly.txt"], ["edit.txt"], self.stage)
        guard = Guard(grant, self.stage)
        args = {"beforeSha256": "stale", "path": "edit.txt", "text": "new"}
        self.assertEqual(json.loads(guard.handle(REPLACE, args))["error"], "content_changed")
        self.assertEqual(json.loads(guard.handle(REPLACE, {**args, "path": "readonly.txt"}))["error"], "path_outside_grant")
        self.assertEqual(guard.pre_tool(REPLACE, args, task_id="elsewhere")["message"], "task_mismatch")
        self.assertEqual((self.stage / "edit.txt").read_bytes(), b"old\n")

    def test_invalid_batch(self):
        for raw in (b'null', b'{}', b'[]', b'[{"tool":"Eval()","args":{}}]', b'[{"tool":"a","args":42}]'):
            with self.assertRaises(ValueError):
                validate_calls(raw)

    def test_evidence_binding_paths_and_source_hashes(self):
        grant = materialize(self.repo, self.rev, "task", ["readonly.txt"], ["edit.txt"], self.stage)
        evidence = {"projectId": "PrJ_Fixture", "taskId": "task", "revision": self.rev, "snapshotToken": "a" * 64,
                    "sources": [{"path": "edit.txt", "sha256": hashlib.sha256(b"old\n").hexdigest()}],
                    "symbols": [{"path": "edit.txt", "name": "Example"}], "relevantPaths": ["readonly.txt"]}
        validate_evidence(evidence, grant, self.stage)
        for edit in ({"taskId": "other"}, {"revision": "0" * 40}, {"snapshotToken": ""},
                     {"sources": [{"path": "edit.txt", "sha256": "b" * 64}]},
                     {"sources": evidence["sources"] * 2}, {"relevantPaths": ["private.txt"]},
                     {"symbols": [{"path": "edit.txt", "name": "\nunsafe"}]}, {"write": ["private.txt"]}):
            with self.subTest(fields=tuple(edit)), self.assertRaises(ValueError):
                validate_evidence({**evidence, **edit}, grant, self.stage)

    def test_launcher_rejects_missing_or_forged_receipt(self):
        grant = materialize(self.repo, self.rev, "task", [], ["edit.txt"], self.stage)
        call = {"tool": "nexus_guard_read", "args": {"path": "edit.txt"}}
        report = {"context": Guard(grant, self.stage).context("task")["context"],
                  "decisions": [{"tool": "nexus_guard_read", "phase": "pre_tool", "decision": "allow",
                                 "reason": "explicit_grant", "path": "edit.txt"},
                                {"tool": "nexus_guard_read", "phase": "post_tool", "status": "ok"}],
                  "results": [{"path": "edit.txt", "text": "old\n", "sha256": hashlib.sha256(b"old\n").hexdigest()}]}
        verify(report, [call], grant, None, self.stage, self.stage)
        for changes in ({"decisions": []}, {"context": "other"}, {"results": [{}]}, {"patch": "unexpected"}):
            with self.assertRaises(ValueError):
                verify({**report, **changes}, [call], grant, None, self.stage, self.stage)

    @unittest.skipUnless(os.environ.get("HERMES_GUARD_PROBE_CHECKOUT"), "requires trusted upstream checkout and Linux bubblewrap")
    def test_actual_hermes_hooks_patch_and_no_host_changes(self):
        calls = [{"tool": REPLACE, "args": {"path": path, "beforeSha256": hashlib.sha256(b"old\n").hexdigest(),
                                             "text": "changed\n"}} for path in ["edit.txt", "readonly.txt"]]
        calls.append({"tool": "terminal", "args": {"command": "exit 0"}})
        context = {"projectId": "PrJ_Fixture", "taskId": "task", "revision": self.rev, "snapshotToken": "a" * 64,
                   "sources": [{"path": "edit.txt", "sha256": hashlib.sha256(b"old\n").hexdigest()}]}
        report = run(self.repo, Path(os.environ["HERMES_GUARD_PROBE_CHECKOUT"]), self.rev, "task",
                     ["readonly.txt"], ["edit.txt"], calls, context)
        self.assertIn("Nexus project evidence", report["context"])
        self.assertIn("PrJ_Fixture", report["context"])
        self.assertIn(self.rev, report["context"])
        self.assertIn("+changed", report["patch"])
        self.assertNotIn("readonly.txt", report["patch"])
        self.assertEqual([(x["phase"], x.get("decision", x.get("status"))) for x in report["decisions"]],
                         [("pre_tool", "allow"), ("post_tool", "ok"), ("pre_tool", "deny"),
                          ("post_tool", "blocked"), ("worker_ingress", "deny")])
        git(self.repo, "apply", "--check", "-", input_data=report["patch"].encode())
        self.assertEqual(git(self.repo, "status", "--porcelain"), b"")

    @unittest.skipUnless(os.environ.get("HERMES_GUARD_PROBE_CHECKOUT"), "requires trusted upstream checkout and Linux bubblewrap")
    def test_real_direct_plugin_dispatch_shell_and_network_boundary(self):
        grant = materialize(self.repo, self.rev, "task", ["readonly.txt"], ["edit.txt"], self.stage)
        authority = self.root / "grant.json"
        authority.write_text(json.dumps(grant))
        runtime = self.root / "runtime"
        runtime.mkdir()
        prepare_runtime(Path(os.environ["HERMES_GUARD_PROBE_CHECKOUT"]), runtime)
        helper = Path(__file__).resolve().parents[1] / "helpers/hermes_guard_direct_probe.py"
        with tempfile.TemporaryFile() as fd:
            network_filter(fd)
            cmd = command(runtime, self.stage, authority, grant["write"], "/control.py", fd)
            index = cmd.index("--remount-ro")
            cmd[index:index] = ["--ro-bind", str(helper), "/control.py"]
            proc = subprocess.run(cmd, input=json.dumps({"hostFile": str(self.repo / "private.txt")}).encode(),
                                  pass_fds=(fd.fileno(),), capture_output=True, timeout=45, check=True)
        report = json.loads(proc.stdout)
        self.assertEqual(report["denied"]["error"], "tool_outside_worker_surface")
        self.assertEqual(report["ordinaryHandlerCalls"], [])
        self.assertEqual(report["directHandlerCalls"], ["handler"])
        attacked = report["direct"]
        for name in ("readonly", "unknown", "rename"):
            self.assertNotEqual(attacked[name], 0, name)
        self.assertEqual(attacked["allowed"], 0)
        self.assertEqual(attacked["socketErrno"], errno.EPERM)
        self.assertEqual(attacked["datagramPairErrno"], errno.EPERM)
        self.assertFalse(attacked["hostVisible"])
        self.assertFalse(attacked["unlistedVisible"])
        self.assertEqual((self.stage / "readonly.txt").read_bytes(), b"old\n")
        self.assertEqual((self.stage / "edit.txt").read_bytes(), b"approved")
        self.assertEqual(git(self.repo, "status", "--porcelain"), b"")


class LocalModelBrokerTests(unittest.TestCase):
    def test_provider_tool_selection_requires_native_call_in_actual_response(self):
        import base64
        from integrations.hermes_guard.model_acceptance import model_calls
        def wire(choice):
            raw = json.dumps({"choices": [{"message": choice}]}).encode()
            return {"body": base64.b64encode(raw).decode(), "contentType": "application/json"}
        args = {"original": "draft", "replacement": "ready"}
        self.assertEqual(model_calls(wire({"tool_calls": [{"function": {"name": "edit_status_text",
                          "arguments": json.dumps(args)}}]})), [args])
        self.assertEqual(model_calls(wire({"content": json.dumps({"tool": "edit_status_text", "args": args})})), [])

    def test_streamed_tool_arguments_reassemble_across_delta_frames(self):
        import base64
        from integrations.hermes_guard.model_acceptance import model_calls
        def delta(function):
            return "data: " + json.dumps({"choices": [{"delta": {"tool_calls": [{"index": 0, "function": function}]}}]})
        frames = [delta({"name": "edit_status_text", "arguments": '{"original":'}), delta({"arguments": '"draft"}'}), "data: [DONE]"]
        wire = {"body": base64.b64encode("\n\n".join(frames).encode()).decode(), "contentType": "text/event-stream"}
        self.assertEqual(model_calls(wire), [{"original": "draft"}])
