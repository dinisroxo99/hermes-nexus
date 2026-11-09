"""All labels and native-like records in these tests belong only to disposable fixtures."""
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.benchmarks.paired_cases import task_prompt
from scripts.nexus_dataset.routing import CASES_BY_ID, ENGINE, FIXTURE, HERMES, MODEL_BYTES, PROTOCOL
from scripts.nexus_session_usage.report import COUNTERS

ROOT = Path(__file__).resolve().parents[2]
def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


class DatasetExportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.project = self.root / "project"
        self.project.mkdir()
        self.env = dict(os.environ, DATA_DIR=str(self.root), PROJECTS_ROOTS=json.dumps([{"id": "test", "path": str(self.root)}]),
                        GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1", GIT_AUTHOR_NAME="Fixture",
                        GIT_COMMITTER_NAME="Fixture", GIT_AUTHOR_EMAIL="test@example.invalid", GIT_COMMITTER_EMAIL="test@example.invalid")
        self.git("init", "--template=", "-b", "main")
        self.git("config", "core.autocrlf", "false")
        (self.project / "src").mkdir()
        (self.project / "package.json").write_text("{}\n")
        (self.project / "tsconfig.json").write_text("{}\n")
        self.source = "export class ParcelRoute {} // private source sentinel\n"
        (self.project / "src/parcel.ts").write_text(self.source)
        (self.project / "src/archive.ts").write_text("export class Archived {}\n")
        self.git("add", ".")
        self.git("commit", "-m", "Add data")
        self.first_sha = self.git("rev-parse", "HEAD")
        self.git("rm", "src/archive.ts")
        self.git("commit", "-m", "Delete archive")
        self.revision = self.git("rev-parse", "HEAD")
        self.project_id = "PrJ_ReviewTest"
        (self.root / "projects.json").write_text(json.dumps([{"name": "test", "rootId": "test", "relativePath": "project",
                                                              "projectId": self.project_id}]))
        self.labels = {"schemaVersion": 1, "purpose": "project_qa_labels", "projectId": self.project_id,
                       "revision": self.revision, "labels": []}

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.project, env=self.env, text=True, stderr=subprocess.DEVNULL).strip()

    def run_cli(self, *args):
        run = subprocess.run([sys.executable, "-B", "-m", "scripts.nexus_dataset", *args],
                             cwd=ROOT, env=self.env, capture_output=True, text=True, timeout=60)
        return run, [json.loads(line) for line in run.stdout.splitlines()], json.loads(run.stderr)

    def symbol(self):
        return {"question": "symbol", "subject": "ParcelRoute", "decision": "accepted",
                "answerSha256": sha("Found 1 exact symbol observation(s) for ParcelRoute."),
                "citations": [{"path": "src/parcel.ts", "blobSha256": sha(self.source)}]}

    def qa(self, pin=None):
        path = self.root / "labels.json"
        path.write_text(json.dumps(self.labels), encoding="utf-8")
        return self.run_cli("qa", "--project-id", self.project_id, "--revision", self.revision, "--labels", str(path),
                            "--labels-sha256", pin or sha(path.read_bytes()))

    def test_explicit_labels_git_blobs_and_deleted_history(self):
        archived = sha("export class Archived {}\n")
        history = {"question": "history", "subject": "src/archive.ts", "decision": "accepted",
                   "citations": [{"path": "src/archive.ts", "commitSha": self.revision, "change": "deleted", "blobSha256": archived},
                                 {"path": "src/archive.ts", "commitSha": self.first_sha, "change": "added", "blobSha256": archived}],
                   "answerSha256": sha("Found 2 committed change(s) to src/archive.ts in the examined history.")}
        self.labels["labels"] = [self.symbol(), history]
        run, rows, summary = self.qa()
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(summary, {"considered": 2, "emitted": 2, "excluded": {}})
        self.assertEqual([r["citations"] for r in rows], [self.symbol()["citations"], history["citations"]])
        self.assertNotIn("private source sentinel", run.stdout)
        self.assertEqual(self.qa()[0].stdout, run.stdout)

    def test_frozen_project_ids_and_fixture_heads_are_excluded_before_project_lookup(self):
        self.labels["labels"] = [self.symbol()]
        self.project_id = self.labels["projectId"] = "PrJ_GoldenAlpha"
        self.assertEqual(self.qa()[2]["excluded"], {"held_out": 1})
        self.project_id = self.labels["projectId"] = "PrJ_Bench"
        self.assertEqual(self.qa()[2]["excluded"], {"held_out": 1})
        self.project_id = self.labels["projectId"] = "OtherRegistration"
        self.revision = self.labels["revision"] = FIXTURE
        self.assertEqual(self.qa()[2]["excluded"], {"held_out": 1})

    def test_label_claim_alone_cannot_satisfy_independent_evidence(self):
        bad = self.symbol()
        bad["citations"][0]["blobSha256"] = "0" * 64
        held = dict(self.symbol(), subject="Shared")
        rejected = dict(self.symbol(), subject="Unused", decision="rejected")
        self.labels["labels"] = [bad, held, rejected]
        run, rows, summary = self.qa()
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(rows, [])
        self.assertEqual(summary["excluded"], {"held_or_ineligible": 1, "not_accepted": 1, "oracle_mismatch": 1})
        self.assertEqual(self.qa(pin="0" * 64)[0].returncode, 1)
        self.labels["labels"] = [{**self.symbol(), "answerSha256": "0" * 64}]
        self.assertEqual(self.qa()[2]["excluded"], {"answer_mismatch": 1})

    def test_pinned_manifest_refuses_symlink_limits_and_duplicate_claims_without_partial_output(self):
        self.labels["labels"] = [self.symbol(), self.symbol()]
        run, rows, _ = self.qa()
        self.assertEqual(run.returncode, 1)
        self.assertEqual(rows, [])
        regular = self.root / "labels.json"
        alias = self.root / "alias.json"
        alias.symlink_to(regular)
        def export(labels):
            return self.run_cli("qa", "--project-id", self.project_id, "--revision", self.revision, "--labels", str(labels),
                                "--labels-sha256", sha(regular.read_bytes()))
        self.assertEqual(export(alias)[0].returncode, 1)
        regular.write_bytes(b"0" * (256 * 1024 + 1))
        self.assertEqual(export(regular)[2], {"error": "invalid_artifact_size"})

    def test_stale_dirty_ambiguous_and_mismatched_project_labels(self):
        self.labels["labels"] = [self.symbol()]
        self.labels["projectId"] = "OtherProject"
        self.assertEqual(self.qa()[2]["excluded"], {"label_binding_mismatch": 1})
        self.labels["projectId"] = self.project_id
        (self.project / "src/shadow.ts").write_text("export class ParcelRoute {}\n")
        self.assertEqual(self.qa()[2]["excluded"], {"stale_or_dirty_project": 1})
        self.git("add", "."); self.git("commit", "-m", "Add homonym")
        self.assertEqual(self.qa()[2]["excluded"], {"stale_or_dirty_project": 1})
        self.revision = self.git("rev-parse", "HEAD")
        self.labels["revision"] = self.revision
        self.assertEqual(self.qa()[2]["excluded"], {"absent_or_ambiguous_symbol": 1})

    def test_routing_requires_real_native_message_counter_and_recomputed_outcome_bindings(self):
        sid, case_id = "bench-1-local-fix-baseline", "local-fix"
        answer = '{"operator":"ceil"}'
        prompt = task_prompt(CASES_BY_ID[case_id])
        db_path = self.root / (sid + ".sqlite")
        model = "qwen2.5-coder-1.5b"
        values = [12, 5, 2, 0, 0, 1]
        with sqlite3.connect(db_path) as db:
            db.execute("CREATE TABLE sessions(id TEXT PRIMARY KEY,model TEXT," + ",".join(k + " INTEGER" for k in COUNTERS) + ")")
            db.execute("INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?)", (sid, model, *values))
            db.execute("CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,role TEXT,content TEXT)")
            db.executemany("INSERT INTO messages VALUES(?,?,?,?)", [(1, sid, "user", prompt), (2, sid, "assistant", answer)])
        report = {"format": "nexus-paired-hermes-v1", "fixtureRevision": FIXTURE, "hermesRevision": HERMES,
                  "model": model, "protocolSha256": PROTOCOL, "modelSha256": MODEL_BYTES, "engineSha256": ENGINE, "rows": [
                      {"arm": "baseline", "task": case_id, "execution": "completed", "repeat": 1, "sessionId": sid,
                       "fixtureRevision": FIXTURE, "promptSha256": sha(prompt), "answer": answer, "score": "pass",
                       "usage": {"status": "present", "positiveTokenCountObserved": True,
                                 "counters": dict(zip(COUNTERS, values)), "sessionId": sid}}]}
        manifest = {sid: {"file": sid + ".sqlite", "sha256": sha(db_path.read_bytes())}}
        def routing():
            rpt = self.root / "report.json"; man = self.root / "manifest.json"
            rpt.write_text(json.dumps(report)); man.write_text(json.dumps(manifest))
            return self.run_cli("routing", "--report", str(rpt), "--report-sha256", sha(rpt.read_bytes()),
                                "--session-manifest", str(man), "--session-manifest-sha256", sha(man.read_bytes()))
        run, rows, summary = routing()
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(summary["emitted"], 1)
        self.assertEqual(rows[0]["outcome"], "pass")
        self.assertNotIn("ceil", run.stdout)
        self.assertNotIn(prompt, run.stdout)
        report["rows"][0]["score"] = "wrong_answer"
        self.assertEqual(routing()[2]["excluded"], {"oracle_disagreement": 1})
        report["rows"][0]["answer"] = '{"operator":"floor"}'
        self.assertEqual(routing()[2]["excluded"], {"native_answer_mismatch": 1})
        report["rows"][0]["usage"]["counters"]["input_tokens"] = 9
        self.assertEqual(routing()[2]["excluded"], {"counter_mismatch": 1})
        manifest.clear()
        self.assertEqual(routing()[2]["excluded"], {"native_snapshot_missing": 1})
