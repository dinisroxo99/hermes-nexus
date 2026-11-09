# Evaluate Project Expert retrieval

Run the frozen evaluation from the repository root with the project dependencies installed.

```sh
node scripts/evaluate-project-questions.mjs
```

The command prints a JSON report and exits 0 when all cases pass. A retrieval regression or fixture setup error exits 1.
It builds two temporary Git repositories with fixed identities, timestamps and contents, registers them in a temporary
project registry, calls the same `answerProjectQuestion` operation as `ask-project`, and removes the temporary directory.
The evaluator reads its checked-in fixtures and works offline.

## Golden set v1

| Question | Cases | Expected evidence |
| --- | ---: | --- |
| Symbol | 3 | Both projects define `Shared` in different files. A Python declaration has no native TypeScript evidence. Beta must report incomplete coverage for both its positive and its empty answer. |
| Tests | 2 | A candidate test imports the target. An independent source has no candidate tests. |
| Impact | 2 | A source has a consumer and a test. A deleted source is unobservable in the current tree. |
| History | 2 | Alpha's old file has three committed changes, most recent first. The same path has no history in beta. |

The oracle pins both HEADs, the project-relative paths, completeness, finding states and the expected history triples
(path, commit SHA, change kind). The report also checks the echoed subject and project ID. History reads Git commit
metadata and leaves dirty state unknown. Current-tree producers observe clean fixture worktrees.

For each question kind, hits count matched citation occurrences. Missing and unexpected counts use the same unit,
including duplicates. Precision uses all observed citations as the denominator, and recall uses all expected
citations. A zero denominator produces JSON `null`. Correctly empty answers contribute to case counts. A wrong
revision, suppressed coverage warning or reordered history can fail a case even when its citation scores are perfect.
The golden set measures retrieval behaviour for these fixtures. Runtime tokens, latency, cost, and real-world answer
quality require separate observations.

Review fixture changes and expectations independently. Intentional changes to the benchmark should update the
versioned answer key with the reasoning for the change. [Frozen cases](../../scripts/fixtures/project-question-golden.json)
and [fixture histories](../../scripts/fixtures/project-question-projects.mjs).
