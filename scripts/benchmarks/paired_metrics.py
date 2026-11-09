"""Descriptive contrasts for matched Hermes sessions. Missing observations remain unknown."""
from collections import Counter
import statistics

from paired_cases import CASES

METRICS = ("prompt_tokens", "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens",
           "reasoning_tokens", "api_call_count", "fixtureReadCalls", "seconds")


def value(row, metric):
    if metric in ("fixtureReadCalls", "seconds"):
        return row.get(metric)
    usage = row.get("usage") or {}
    counters = usage.get("counters") or {}
    # An empty persisted session does not demonstrate a zero-cost model call.
    if not usage.get("positiveTokenCountObserved"):
        return None
    if metric == "prompt_tokens":
        parts = [counters.get(k) for k in ("input_tokens", "cache_read_tokens", "cache_write_tokens")]
        return sum(parts) if None not in parts else None
    return counters.get(metric)


def distribution(numbers):
    return {"count": len(numbers), "min": min(numbers), "median": statistics.median(numbers), "max": max(numbers)} if numbers else None


def contrasts(rows, left_arm, right_arm):
    pairs = {(r["repeat"], r["task"], r["arm"]): r for r in rows}
    deltas = {key: [] for key in METRICS}
    for (repeat, task, arm), left in pairs.items():
        right = pairs.get((repeat, task, right_arm))
        if arm != left_arm or not right or left["execution"] != "completed" or right["execution"] != "completed":
            continue
        for metric in METRICS:
            a, b = value(left, metric), value(right, metric)
            if a is not None and b is not None:
                deltas[metric].append(round(b - a, 3))
    return {k: distribution(v) for k, v in deltas.items()}


def summarize(rows, compact=False):
    arms = ("baseline", "nexus", "compact") if compact else ("baseline", "nexus")
    result = {"pairedNexusMinusBaseline": contrasts(rows, "baseline", "nexus"),
              "scores": {arm: dict(Counter(r["score"] for r in rows if r["arm"] == arm)) for arm in arms}}
    if compact:
        result["pairedCompactMinusBaseline"] = contrasts(rows, "baseline", "compact")
        result["pairedCompactMinusNexus"] = contrasts(rows, "nexus", "compact")
    return result


def finish(report):
    rows = report["rows"]
    measured = {(r["repeat"], r["task"], r["arm"]) for r in rows
                if r["execution"] == "completed" and (value(r, "api_call_count") or 0) > 0}
    arms = ("baseline", "nexus", "compact") if report.get("compactCohort") else ("baseline", "nexus")
    count = sum(1 for repeat, task, arm in measured
                if arm == "baseline" and all((repeat, task, name) in measured for name in arms))
    expected = len(CASES) * report["repeats"]
    unit = "Triplets" if len(arms) == 3 else "Pairs"
    report["measurement"] = {"status": "complete" if count == expected else "partial" if count else "unavailable",
                             "expected" + unit: expected, "observed" + unit: count}
    return report
