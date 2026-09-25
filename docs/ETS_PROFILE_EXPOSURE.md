# ETS profile exposure

[Home](../README.md) · [Current status](CURRENT_STATUS.md)

## Verification boundary

This map records operator-authorized SOUL hashes and live inspect proofs for
ETS caller exposure on development profiles. Hashes are copied from the
accepted records below and were not recomputed from `~/.hermes`. This
documentation change is authorized by the operator docs-only scope on baseline
`13fca6ed`, not by ETS WRITE.

Partial, incomplete, unsupported, unavailable, or `not_evaluated` evidence
never proves safety. Test candidates are not results. ETS WRITE does not
authorize edit, lock, dispatch, or new cards.

## Profile SOUL hashes

Use these hashes exactly:

- implementer SOUL `41076dfe1990cae5571bab72e7fae319ce15a16d3c166b805e6712224f7b48e7` — consumes WRITE (proof `t_9e146969`)
- tester SOUL `39592d0be2fba9c51e0c8493bc0c17ac8711f6a73d91d72e4bcad7c337d6cdff` — consumes WATCH (proof `t_21911c92`)
- reviewer SOUL `96875f027a057dfb156474797936af621176653f8305a6482c9bf09c7881e5c9` — reviews WRITE+WATCH (proof `t_c8588cc3`)
- architect / documenter / orchestrator: flag + `includeTests`; orchestrator WRITE does not dispatch

Do not invent extra SOUL hashes for architect, documenter, or orchestrator.

## Live proofs

Live proofs on inspect `6ebb7aa` (`6ebb7aaa7ae7027c3e590a51bdbf5b5935651776`),
path `src/routes/task-context.routes.js`, ETS status `incomplete`, WRITE 1,
WATCH 5.

## Contract that remains true

- `provides_tools` remains two tools (`project_task_context` + `project_impact`).
- Legado `787f662` is out.
- Step 4.0 used ≠ Guard ≠ Step 4.1.
