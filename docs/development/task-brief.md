# Compact task brief

`POST /api/intelligence/projects/:projectId/task-brief` produces a compact, read-only rendering for an agent
and a separate provenance envelope. It uses the same Context Pack and Impact producers as the existing endpoints.
The optional operation can be called on a registered Git project, including its explicitly selected linked worktree.

```json
{
  "task": {"title": "Inspect invoice rounding", "paths": ["src/invoice.js"]},
  "includeTests": true,
  "limits": {"symbols": 12, "affectedFiles": 20, "testCandidates": 8, "textBytes": 2048}
}
```

The task must have at least one file path and satisfy both producer contracts. `includeTests` defaults to true.
Use `worktree: {"rootId":"dev","relativePath":"linked-invoices"}` to select a linked checkout of the registered
parent. Omitting the locator selects the registered checkout. Supplying its own canonical locator is also supported.
Optional `expectedCommitSha` (full Git SHA) and `expectedSnapshotToken` (64 lowercase hex digits) pin the result.
A dirty tree can be observed, and its dirty flag is returned. An unavailable Git identity or a changed pin,
project/worktree, provider, revision or source snapshot yields HTTP 409 without brief text. Nested registered
projects are excluded. An unknown project returns 404. Invalid fields return 400 and an oversized request returns 413.

## Response

- `text` is the `task-brief-v1` rendering of symbols, affected paths, test candidates and coverage. The affected list
  can include tests. The tests line lists Impact's test candidates. With `includeTests: false` it says
  `Tests (not requested)`. The response contains no file excerpts.
- `binding` carries the project locator, Git revision and worktree identity, snapshot token, source digest, Context
  Pack ID, provider ID/version and trust label, producer versions and public IDs for the rendered symbols. The
  origin count and digest bind the canonical requested paths. The service rechecks the live source files, Git binding
  and nested boundaries before returning a result. The binding identifies a sampled observation.
- `coverage` separates source, Context Pack, Impact and rendering limits. `received` counts what each upstream
  producer returned. `rendered` counts items retained after projection limits. The text's `sourceIncomplete` summarizes
  producer incompleteness. `briefTruncated=true` marks projection omissions even when the producers had complete data.

| Rendering limit | Default | Accepted range |
| --- | ---: | ---: |
| Symbols | 12 | 0–24 |
| Affected paths | 20 | 0–80 |
| Test candidates | 8 | 0–16 |
| UTF-8 text bytes | 2,048 | 256–8,192 |

For evidence that fits the budget, the line layout follows the
[measured compact projection](paired-hermes-coder-results.md). On that six-pair fixture the compact rendering
used fewer prompt tokens than the full evidence rendering and more than the baseline. The envelope is for the
caller to retain separately from the agent's text.
