"""Offline capture comparison tests; all inputs are temporary synthetic files."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.nexus_log_compare.compare import MAX_BYTES, compare_captures


def record(run="R", profile="reviewer", sha="sha", flag=True, writes=(), watches=()):
    return json.dumps(dict(runId=run, profile=profile, sha=sha, nexusTools=flag,
                           writePaths=list(writes), watchPaths=list(watches)))


class CaptureComparisonTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.left = Path(temp.name) / "baseline"
        self.right = Path(temp.name) / "candidate"

    def write(self, left, right):
        self.left.write_text("".join(line + "\n" for line in left), encoding="utf-8")
        self.right.write_text("".join(line + "\n" for line in right), encoding="utf-8")

    def compare(self, **options):
        return compare_captures(self.left, self.right, **options)

    def test_descriptive_counts_and_deltas_use_only_shared_cohorts(self):
        secret = "sensitive/raw-file"
        self.write([record(writes=[secret, secret]), record(writes=[secret, secret]), record(sha="old")],
                   [record(flag=False, watches=["private-watch"]), record("S", watches=["private-watch"]), record(sha="new")])
        result = self.compare()
        self.assertEqual(result["status"], "compared")
        cohorts = result["observed_cohorts"]
        self.assertEqual((cohorts["shared"], cohorts["baseline_only"], cohorts["candidate_only"]), (1, 1, 1))
        expected = {"records": 0, "distinct_correlation_keys": 1, "nexus_tools_true_records": -1,
                    "nexus_tools_false_records": 1, "declared_write_path_entries": -4, "declared_watch_path_entries": 2}
        self.assertEqual(cohorts["rows"][0]["candidate_minus_baseline"], expected)
        self.assertEqual(cohorts["candidate_minus_baseline"], expected)
        self.assertEqual(result["baseline"]["observed"]["records"], 3)
        for raw in (secret, "private-watch", str(self.left)):
            self.assertNotIn(raw, json.dumps(result))
        self.assertIn("prompt_tokens", result["unavailable_from_d3"])
        reverse = compare_captures(self.right, self.left)["observed_cohorts"]["candidate_minus_baseline"]
        self.assertEqual(reverse, {k: -v for k, v in expected.items()})

    def test_structured_keys_and_sorting(self):
        left = [record(profile="a:b", sha="c"), record(profile="a", sha="b:c")]
        right = list(reversed(left))
        self.write(left, right)
        result = self.compare()
        self.write(right, left)
        self.assertEqual(self.compare(), result)
        self.assertEqual([(row["profile"], row["sha"]) for row in result["observed_cohorts"]["rows"]],
                         [("a", "b:c"), ("a:b", "c")])

    def test_comparison_uses_all_cohorts_before_capping_output(self):
        many = [record(profile=f"P{i:02}", watches=["w"]) for i in range(25)]
        self.write(many, list(reversed(many)) + [record(profile="P24", watches=["w"])])
        cohorts = self.compare()["observed_cohorts"]
        self.assertEqual((cohorts["shared"], cohorts["shared_omitted"], len(cohorts["rows"])), (25, 5, 20))
        self.assertEqual(cohorts["candidate_minus_baseline"]["declared_watch_path_entries"], 1)
        # The only shared cohort comes after the single-inspector display cap.
        self.write(many, [many[-1]])
        self.assertEqual(self.compare()["observed_cohorts"]["rows"][0]["profile"], "P24")

    def test_invalid_partial_and_empty_captures_suppress_deltas(self):
        self.write([record(), "{}"], [record(), record()])
        invalid = self.compare()
        self.assertEqual(invalid["reasons"], ["baseline_invalid_records"])
        self.assertIsNone(invalid["observed_cohorts"]["rows"][0]["candidate_minus_baseline"])
        truncated = self.compare(max_records=1)
        self.assertEqual(truncated["reasons"], ["baseline_incomplete", "candidate_incomplete"])
        self.assertIsNone(truncated["observed_cohorts"]["candidate_minus_baseline"])
        self.write([], [record()])
        self.assertEqual(self.compare()["reasons"], ["baseline_no_valid_records"])

    def test_incomplete_final_line_and_unterminated_valid_record(self):
        self.write([record()], [record()])
        self.right.write_text(record() + '\n{"runId":', encoding="utf-8")
        partial = self.compare()
        self.assertTrue(partial["candidate"]["incomplete_last_line"])
        self.assertEqual(partial["reasons"], ["candidate_incomplete", "candidate_invalid_records"])
        self.right.write_text(record(), encoding="utf-8")
        self.assertEqual(self.compare()["status"], "compared")

    def test_distinct_file_required_and_disjoint_cohorts_not_paired(self):
        self.write([record(sha="a")], [record(sha="b")])
        result = self.compare()
        self.assertEqual(result["reasons"], ["no_shared_profile_sha"])
        self.assertEqual(result["observed_cohorts"]["rows"], [])
        self.right.unlink()
        os.link(self.left, self.right)
        self.assertEqual(self.compare()["reasons"], ["same_file"])

    def test_hard_links_replaced_after_the_read_still_identify_the_opened_capture(self):
        self.write([record()], [record()])
        self.right.unlink()
        os.link(self.left, self.right)
        replacement = self.left.with_name("replacement")
        replacement.write_bytes(self.left.read_bytes())
        original_lstat = Path.lstat
        candidate_stats = 0

        def swap_after_final_stat(path):
            nonlocal candidate_stats
            observed = original_lstat(path)
            if path == self.right:
                candidate_stats += 1
                if candidate_stats == 2:
                    replacement.replace(path)
            return observed

        with patch.object(Path, "lstat", swap_after_final_stat):
            result = self.compare()
        self.assertFalse(os.path.samefile(self.left, self.right))
        self.assertTrue(result["baseline"]["complete"])
        self.assertTrue(result["candidate"]["complete"])
        self.assertEqual(result["reasons"], ["same_file"])
        self.assertIsNone(result["observed_cohorts"]["candidate_minus_baseline"])

    def test_byte_and_line_limits_and_utf8_errors(self):
        self.write([record()], [record()])
        self.assertEqual(self.compare(max_bytes=10)["baseline"]["limited_reason"], "max_bytes_exceeded")
        size = self.left.stat().st_size
        self.assertEqual(self.compare(max_bytes=size, max_line_bytes=size, max_records=1)["status"], "compared")
        self.left.write_bytes(b"x" * 300000)
        self.assertEqual(self.compare(max_line_bytes=100)["baseline"]["limited_reason"], "max_line_bytes_exceeded")
        self.left.write_bytes(b"\xff")
        unreadable = self.compare()
        self.assertEqual(unreadable["status"], "input_error")
        self.assertIsNone(unreadable["baseline"]["observed"])
        self.assertIsNone(unreadable["observed_cohorts"])
        with self.assertRaises(ValueError):
            self.compare(max_bytes=MAX_BYTES + 1)

    def test_utf8_budget_is_in_bytes_and_unobserved_bad_bytes_do_not_poison_a_prefix(self):
        encoded = record(profile="résumé").replace("\\u00e9", "é").encode("utf-8")
        self.left.write_bytes(encoded + b"\r" + encoded + b"\r")
        self.right.write_bytes(encoded + b"\r\n" + encoded + b"\n")
        self.assertEqual(self.compare()["status"], "compared")
        self.assertEqual(self.compare(max_line_bytes=len(encoded))["baseline"]["limited_reason"],
                         "max_line_bytes_exceeded")
        self.left.write_bytes(encoded + b"\n" + b"\xff")
        result = self.compare(max_records=1)
        self.assertEqual(result["status"], "not_comparable")
        self.assertEqual(result["baseline"]["limited_reason"], "max_records_exceeded")
        self.assertEqual(result["baseline"]["valid"], 1)

    def test_replaced_capture_is_incomplete_even_when_same_size_and_mtime(self):
        self.write([record()], [record()])
        old_stat = self.left.stat()
        replacement = self.left.with_name("replacement")
        replacement.write_bytes(self.left.read_bytes())
        os.utime(replacement, ns=(old_stat.st_atime_ns, old_stat.st_mtime_ns))
        original_lstat = Path.lstat
        left_calls = 0

        def replace_before_final_stat(path):
            nonlocal left_calls
            if path == self.left:
                left_calls += 1
                if left_calls == 2:
                    replacement.replace(path)
            return original_lstat(path)

        with patch.object(Path, "lstat", replace_before_final_stat):
            result = self.compare()
        self.assertTrue(result["baseline"]["changed_during_read"])
        self.assertEqual(result["reasons"], ["baseline_incomplete"])
        self.assertIsNone(result["observed_cohorts"]["candidate_minus_baseline"])

    def test_cli_with_symlink_and_missing_input(self):
        self.write([record()], [record()])
        args = [sys.executable, "-B", "-m", "scripts.nexus_log_compare", "--baseline", str(self.left)]
        def cli(candidate):
            return subprocess.run(args + ["--candidate", str(candidate)], cwd=Path(__file__).resolve().parents[2],
                                  capture_output=True, text=True, check=False)
        good = cli(self.right)
        self.assertEqual(good.returncode, 0)
        self.assertEqual(json.loads(good.stdout)["status"], "compared")
        self.right.unlink()
        for symlink in (False, True):
            if symlink:
                self.right.symlink_to(self.left)
            missing = cli(self.right)
            self.assertEqual(missing.returncode, 1)
            self.assertEqual(json.loads(missing.stdout)["reasons"], ["candidate_input_error"])


if __name__ == "__main__":
    unittest.main()
