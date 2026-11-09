"""Frozen, self-contained engineering workloads and independent result validation."""
import json
import posixpath
import re
import subprocess

FILES = {
    "package.json": '{"type":"module"}\n',
    "src/packs.js": "export function Packs(units) { return Math.floor(units / 4); }\n",
    "src/invoice.js": 'import { Packs } from "./packs.js";\nexport function Invoice(n) { return Packs(n); }\n',
    "src/print.js": 'import { Invoice } from "./invoice.js";\nexport function Print(n) { return Invoice(n); }\n',
    "src/fees.js": "export function Fees(n) { return n * 2; }\n",
    "tests/invoice.test.js": 'import { Invoice } from "../src/invoice.js";\nexport function CheckInvoice() { return Invoice(4) === 1; }\n',
    "tests/packs.test.js": 'import { Packs } from "../src/packs.js";\nexport function CheckPacks() { return Packs(8) === 2; }\n',
    "tests/fees.test.js": 'import { Fees } from "../src/fees.js";\nexport function CheckFees() { return Fees(2) === 4; }\n',
}
CASES = [
    {"id": "local-fix", "title": "Correct partial pack counting", "target": "src/packs.js",
     "question": 'Packs must count every started group of four units, including a partial last group. Which Math function should replace the current rounding function? Return only {"operator":"NAME"}, using the method name alone.'},
    {"id": "impact", "title": "Find downstream production imports", "target": "src/packs.js",
     "question": 'If src/packs.js changes, which other production files import it directly or transitively? Exclude the origin and all tests. Return only {"paths":["..."]}.'},
    {"id": "tests", "title": "Select regression tests", "target": "src/invoice.js",
     "question": 'If src/invoice.js changes, which test files import it directly or transitively? Return only {"paths":["..."]}.'},
]


def task_prompt(case):
    return ("Repository files: " + ", ".join(sorted(FILES)) + "\n" + case["question"]
            + " You may read any listed file with read_benchmark_file. Return only the requested JSON object.")


def reachable_importers(target):
    """Independent import oracle for this fixture's static relative import grammar."""
    links = {f: {posixpath.normpath(posixpath.join(posixpath.dirname(f), ref))
                 for ref in re.findall(r'from "(\.[^"]+)"', text)} for f, text in FILES.items()}
    reached = {target}
    while True:
        expanded = reached | {name for name, imports in links.items() if imports & reached}
        if expanded == reached:
            return reached - {target}
        reached = expanded


def validate_answer(case, text):
    raw = (text or "").strip()
    fenced = re.fullmatch(r"```(?:json)?\s*\n(.*?)\n```", raw, re.S)
    if fenced:
        raw = fenced.group(1)
    try:
        answer = json.loads(raw)
    except (TypeError, ValueError):
        return "invalid_answer"
    if not isinstance(answer, dict):
        return "invalid_answer"
    if case["id"] == "local-fix":
        if set(answer) != {"operator"} or answer["operator"] not in ("ceil", "floor", "round", "trunc"):
            return "invalid_answer"
        # Only four trusted substitutions are executable. Model-authored code never runs.
        source = FILES[case["target"]].replace("Math.floor", "Math." + answer["operator"])
        checks = "if (![0,1,4,5,8].every((n,i)=>Packs(n)===[0,1,1,2,2][i])) process.exit(1);"
        proc = subprocess.run(["node", "--input-type=module", "-"], input=source + checks,
                              text=True, capture_output=True, timeout=5)
        return "pass" if proc.returncode == 0 else "wrong_answer"
    if set(answer) != {"paths"} or not isinstance(answer["paths"], list) or not all(isinstance(p, str) for p in answer["paths"]):
        return "invalid_answer"
    prefix = "src/" if case["id"] == "impact" else "tests/"
    expected = sorted(p for p in reachable_importers(case["target"]) if p.startswith(prefix))
    return "pass" if sorted(answer["paths"]) == expected else "wrong_answer"


def mentions_expected_paths(case, text):
    """Secondary diagnostic of path mentions in prose, independent of the required output format."""
    if case["id"] == "local-fix" or not text:
        return None
    prefix = "src/" if case["id"] == "impact" else "tests/"
    mentions = set(re.findall(r"(?<![\w/-])(?:src|tests)/[A-Za-z0-9_./-]+\.js\b", text))
    reported = {p for p in mentions if p.startswith(prefix) and p != case["target"]}
    expected = {p for p in reachable_importers(case["target"]) if p.startswith(prefix)}
    return reported == expected
