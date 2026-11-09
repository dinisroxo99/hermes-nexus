import sys
import tempfile
import unittest
from types import SimpleNamespace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "benchmarks"))
from paired_cases import CASES, mentions_expected_paths, validate_answer
from paired_hermes import evidence_turn, finish, git, setup_problem, summarize


class PairedBenchmarkTests(unittest.TestCase):
    def test_frozen_executable_patch_and_transitive_import_oracles(self):
        self.assertEqual(validate_answer(CASES[0], '{"operator":"ceil"}'), "pass")
        self.assertEqual(validate_answer(CASES[0], '{"operator":"round"}'), "wrong_answer")
        self.assertEqual(validate_answer(CASES[0], '{"operator":"ceil;process.exit(0)"}'), "invalid_answer")
        self.assertEqual(validate_answer(CASES[1], '{"paths":["src/print.js","src/invoice.js"]}'), "pass")
        self.assertEqual(validate_answer(CASES[1], '{"paths":["src/invoice.js"]}'), "wrong_answer")
        self.assertEqual(validate_answer(CASES[2], '{"paths":["tests/invoice.test.js"]}'), "pass")
        self.assertEqual(validate_answer(CASES[2], 'some text {"paths":["tests/invoice.test.js"]}'), "invalid_answer")

    def test_prose_mentions_are_separate_from_the_required_json_score(self):
        text = "tests/invoice.test.js imports src/invoice.js."
        self.assertTrue(mentions_expected_paths(CASES[2], text))
        self.assertEqual(validate_answer(CASES[2], text), "invalid_answer")
        self.assertFalse(mentions_expected_paths(CASES[2], text + " tests/invented.test.js"))
        self.assertIsNone(mentions_expected_paths(CASES[0], text))

    def test_matched_deltas_require_two_completed_arms_and_observed_usage(self):
        def row(repeat, arm, tokens, status="completed"):
            return {"task": "t", "repeat": repeat, "arm": arm, "execution": status, "score": "wrong_answer",
                    "usage": {"positiveTokenCountObserved": tokens is not None, "counters": {"input_tokens": tokens}}}
        report = summarize([row(1,"baseline",100), row(1,"nexus",120), row(2,"baseline",10), row(2,"nexus",None),
                            row(3,"baseline",15), row(3,"nexus",200,"agent_error")])
        dist = report["pairedNexusMinusBaseline"]
        self.assertEqual(dist["input_tokens"], {"count":1, "min":20, "median":20, "max":20})
        self.assertIsNone(dist["output_tokens"])

    def test_compact_evidence_keeps_symbols_paths_tests_and_coverage_but_omits_descriptor(self):
        evidence = {"provider": {"id": "a-long-descriptor"}, "revision": "binding", "symbols": [{"name":"X","path":"x.js"}],
                    "affected":["y.js"], "testCandidates":["tests/x.js"], "status":"partial",
                    "finding":"evidence_found", "sourceIncomplete":True}
        compact = evidence_turn("compact", evidence)
        for value in ["X@x.js","y.js","tests/x.js","partial","evidence_found","sourceIncomplete=true"]:
            self.assertIn(value, compact)
        self.assertNotIn("a-long-descriptor", compact)
        self.assertNotIn("binding", compact)
        self.assertIn("a-long-descriptor", evidence_turn("nexus", evidence))
        self.assertIsNone(evidence_turn("baseline", evidence))

    def test_unavailable_setup_and_unsupported_checkout_are_distinct(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            args = SimpleNamespace(hermes=root / "missing", python=Path(sys.executable), gguf=root / "weights",
                                   llama_server=root / "server")
            self.assertEqual(setup_problem(args), ("unavailable", "hermes_missing"))
            args.hermes.mkdir()
            args.gguf.touch()
            args.llama_server.touch()
            git(["init", "-q"], args.hermes)
            git(["commit", "--allow-empty", "--no-gpg-sign", "-qm", "fixture"], args.hermes)
            self.assertEqual(setup_problem(args), ("unsupported", "unsupported_hermes_checkout"))

    def test_triplet_measurement_requires_all_three_arms(self):
        known = {"positiveTokenCountObserved":True,"counters":{"api_call_count":1}}
        rows = [{"repeat":1,"task":"impact","arm":a,"execution":"completed","usage":known}
                for a in ("baseline","nexus","compact")]
        report = {"rows":rows,"compactCohort":True,"repeats":2}
        self.assertEqual(finish(report)["measurement"]["observedTriplets"], 1)
        rows.pop()
        self.assertEqual(finish(report)["measurement"]["observedTriplets"], 0)
