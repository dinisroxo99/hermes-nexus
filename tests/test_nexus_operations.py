"""Recovery and service observations using an isolated registry and a real loopback Nexus process."""
from contextlib import contextmanager
from hashlib import sha256
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import unittest
from zipfile import ZipFile

from scripts.nexus_operations.soak import get_json, verify_service
from scripts.nexus_recovery.__main__ import create_backup, restore
from scripts.nexus_session_usage.snapshot import UsageError

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def service(data_dir, root):
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(HOST="127.0.0.1", PORT="0", DATA_DIR=str(data_dir), PROJECTS_ROOTS=json.dumps([{"id": "dev", "path": str(root)}]),
               SERENA_PYTHON_IMAGE="")
    proc = subprocess.Popen(["node", str(ROOT / "src/server.js")], cwd=root, env=env, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        if not select.select([proc.stdout], [], [], 30)[0]:
            raise RuntimeError("service_start_timeout")
        line = proc.stdout.readline().strip()
        url = line.split()[-1]
        if not url.startswith("http://127.0.0.1:"):
            raise RuntimeError("unexpected_service_address")
        yield url, proc
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        proc.stdout.close()


class OperationsTests(unittest.TestCase):
    def test_crash_and_recover_registry_then_resolve_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "project"
            project.mkdir()
            (project / "app.ts").write_text("export class Example {}")
            registry = root / "data"
            registry.mkdir()
            rows = [{"projectId": "PrJ_Proof", "rootId": "dev", "relativePath": "project", "name": "example"}]
            (registry / "projects.json").write_text(json.dumps(rows))
            archive = root / "state.zip"
            with service(registry, root) as (url, proc):
                report = verify_service(url, 0, 60, "PrJ_Proof", proc.pid)
                self.assertEqual(report["status"], "healthy", report)
                self.assertEqual(report["processMetrics"]["samples"], 1)
                receipt = create_backup(registry, None, archive)
                (registry / "projects.json").write_text("broken")
                broken = verify_service(url, 0, 60)
                self.assertEqual((broken["livenessFailures"], broken["readinessFailures"]), (0, 1))
                proc.kill()
                proc.wait(timeout=5)
            self.assertEqual(verify_service(url, 0, 60)["livenessFailures"], 1)
            restored = root / "restored"
            restore(archive, receipt["sha256"], restored)
            self.assertEqual(json.loads((restored / "projects.json").read_text()), rows)
            with service(restored, root) as (new_url, _):
                self.assertEqual(verify_service(new_url, 0, 60, "PrJ_Proof")["status"], "healthy")

    def test_restore_checks_independent_hash_and_refuses_extra_archive_members(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "projects.json").write_text("[]")
            archive = root / "state.zip"
            create_backup(root, None, archive)
            with self.assertRaises(FileExistsError):
                create_backup(root, None, archive)
            with self.assertRaisesRegex(UsageError, "archive_digest_mismatch"):
                restore(archive, "0" * 64, root / "new")
            with ZipFile(archive, "a") as contents:
                contents.writestr("../outside", "unexpected")
            with self.assertRaisesRegex(UsageError, "invalid_archive_inventory"):
                restore(archive, sha256(archive.read_bytes()).hexdigest(), root / "new")
            self.assertFalse((root / "new").exists())

    def test_restore_requires_empty_new_destination_and_rejects_symlink_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            registry = root / "projects.json"
            registry.write_text("[]")
            archive = root / "state.zip"
            receipt = create_backup(root, None, archive)
            destination = root / "occupied"
            destination.mkdir()
            with self.assertRaises(FileExistsError):
                restore(archive, receipt["sha256"], destination)
            registry.unlink()
            registry.symlink_to(archive)
            with self.assertRaises(OSError):
                create_backup(root, None, root / "unsafe.zip")

    def test_invalid_registration_and_overlapping_project_identity_are_refused_before_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "projects.json"
            path.write_text('[{"projectId":"bad id","relativePath":"../outside","name":"broken"}]')
            with self.assertRaisesRegex(UsageError, "invalid_registry"):
                create_backup(root, None, root / "state.zip")
            path.write_text('[{"projectId":"PrJ_A","relativePath":"p","name":"a"}]')
            (root / "discovered-projects.json").write_text('[{"projectId":"PrJ_A","relativePath":"q","name":"b"}]')
            with self.assertRaisesRegex(UsageError, "invalid_registry"):
                create_backup(root, None, root / "state.zip")
            self.assertFalse((root / "state.zip").exists())

    def test_abrupt_restore_failure_leaves_final_destination_available_for_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "projects.json").write_text("[]")
            archive = root / "state.zip"
            pin = create_backup(root, None, archive)["sha256"]
            destination = root / "restored"
            # Kill between writing the private staging files and publishing their directory.
            code = ("import os,sys; from pathlib import Path; import scripts.nexus_recovery.__main__ as m; "
                    "m.publish_directory=lambda *args: os._exit(77); m.restore(Path(sys.argv[1]),sys.argv[2],Path(sys.argv[3]))")
            crash = subprocess.run([sys.executable, "-B", "-c", code, str(archive), pin, str(destination)],
                                   cwd=ROOT, timeout=15)
            self.assertEqual(crash.returncode, 77)
            self.assertFalse(destination.exists())
            restore(archive, pin, destination)
            self.assertEqual((destination / "projects.json").read_text(), "[]")

    def test_trickling_service_cannot_extend_the_probe_deadline(self):
        class Slow(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                for _ in range(40):
                    try:
                        self.wfile.write(b" ")
                    except OSError:
                        return
                    time.sleep(0.04)
            def log_message(self, *args):
                pass
        with HTTPServer(("127.0.0.1", 0), Slow) as server:
            worker = threading.Thread(target=server.handle_request, daemon=True)
            worker.start()
            start = time.monotonic()
            self.assertIsNone(get_json(server.server_address, "/", timeout=0.15))
            self.assertLess(time.monotonic() - start, 1)
            worker.join(2)

    def test_forbids_remote_or_credential_bearing_probes(self):
        for url in ("http://example.org", "http://name@127.0.0.1:8770", "https://127.0.0.1", "http://127.0.0.1/path"):
            with self.assertRaises(ValueError):
                verify_service(url, 0, 1)
