# ETS profile exposure

[Home](../README.md) · [Current status](CURRENT_STATUS.md)

## Verification boundary

This map records operator-authorized SOUL hashes and live inspect proofs for
ETS caller exposure on development profiles, plus 2026-09-28 six-profile live
collect persist copied from named Kanban handoffs. Hashes are copied from the
accepted records below and were not recomputed from `~/.hermes`. This
documentation task did not inspect live runs, JSONL files, or sessions. The
SOUL-hash subsection remains the operator docs-only scope on baseline
`13fca6ed`, not ETS WRITE. The collect-persist subsection is Kanban-handoff
attribution only.

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

## Six-profile live collect persist (2026-09-28)

Copied from Kanban handoffs. Not a personal live-run, JSONL, or session
inspection. Dated 2026-09-28 observed `origin/main`
`643eb3ab6433389f99264bc2b0a1aff7389ddc5d` (PR #37) carries canonical Git
`integrations/hermes-nexus/tools.py` overlay sha256
`5dabeda0c30dd742e2b463fe1959d1cd133790e7a5a37e28422543a8ab5349e0`.
Historical content origin (not proven ancestor of main):
`e62463eba49640448e42425b9e500497c4f02af0`. Content equality of `tools.py`
≠ ancestry of `e62463e` and ≠ every installed file. **Do not present the
native caller as absent from main.** `6152cea` (now an ancestor of
checkpoint `050540d0`) qualified the ETS handler description; that
`schemas.py` text is included in this revision and is **not copied into
local installations**.
This mission did **not** recopy. Code gates: implementer `t_3110d536`,
tester `t_9ec8c071`, reviewer `t_463c224e`.

Installed copies (local `~/.hermes/profiles/<name>/plugins/hermes-nexus`) at
the dated handoff are **that inventory**, not "always ten files": nine match
`28e9815b1a6efed8bae41f0d513d9856c8a44858`;
`tools.py` is overlay sha256
`5dabeda0c30dd742e2b463fe1959d1cd133790e7a5a37e28422543a8ab5349e0`
(same **tools.py** bytes as `e62463e` content and as the six-profile
install at that date). Canonical Git
`integrations/hermes-nexus/tools.py` **is** that overlay blob, **not**
the `28e9815` `tools.py` blob (`54c0fdcf9547cb8f6d98a52a13d5cbb937f0759b`)
(Kanban `t_3110d536` / `t_9ec8c071` / `t_463c224e` plus `t_f8a1aba6` /
`t_cd20ab7c` / `t_defcbfd1` / `t_d215eea4`; not a personal dest-hash
inspection). `default` and `workspace-manager` were **not** installed
(plugin install/config/exposure). That does **not** forbid the
workspace-manager **role**.

Hash-gate remaining 5: `t_cd20ab7c` PASS. Architect dest `tools.py`
`5dabeda0…` (`t_d215eea4` / `t_defcbfd1`). Recopy remaining 5: `t_f8a1aba6`.
**No recopy** of the six profiles. Live service HEAD throughout:
`bc8b52d7280e7adc83f05cb20df97fbb3199804c` (untouched). Profile-native
caller tests `t_a2277b22` CallerTests 33/33, test_tools 60/60; review
`t_56e363fe` PASS. WRITE/WATCH classification exists and is not Step 4
coordination/enforcement. Step 4 (Effective Task Scope as
coordination/enforcement), Step 5 (Conflict Engine), and Step 6 (Guard)
have not been initiated.

Live-persist PASS (historical; not re-run here; no `HERMES_PROFILE`;
`DATA_DIR` prefix only; locator `expectedRevision.branch: null`,
`task.paths: []`; stored `runId` = kwargs.session_id; `nexusTools` **bool**;
payload collect exactly 6 keys; JSONL +1). Native profile from
`HERMES_HOME` exact `.../profiles/<name>` and/or `__file__`
`.../profiles/<name>/plugins/hermes-nexus/tools.py`. Fail-closed if neither;
HOME/`__file__` conflict skips persist. Hermes 0.21.5 `-p` does not export
`HERMES_PROFILE`. These six records do not declare continuous collection on
CLI, gateway, or workers. Collect-forward semantics:
[CURRENT_STATUS](CURRENT_STATUS.md#collect-forward-semantics-current-code-on-this-candidate-no-code-change).

| profile | card | session / stored runId | jsonl_after sha256 |
|---|---|---|---|
| architect | `t_30cbb71f` | `20260928_163841_aee965` | `000de80caaea6fc71d74bea2d5517c78721c02418e6af66f02528767a34b014f` (`t_30cbb71f` `jsonl_after.sha256`) |
| implementer | `t_ae7af4ff` | `20260928_170741_ac0c09` | `a1bd9974fad4964318b2116f1d84eeed199ae12e2749bbfa04bc3e2aeceb0e07` |
| tester | `t_d286e24a` | `20260928_171743_709433` | `165ab22d5566a3f4cfb56d1b6092dfee9c214ec2ab0810e3753c7451f229ae03` |
| reviewer | `t_8695e990` | `20260928_172135_ed86b2` | `5e22fc801570c38f112e3cabfbd6f4b971c2ab1fb91d6e725f4d13989da1ba06` |
| documenter | `t_2c324855` | `20260928_172518_08cdc7` | `0d26d286ff37094e71c262abb85cb389a052366cb3d56938d2877a881f7b0af2` |
| orchestrator | `t_29a66ff6` | `20260928_172918_30fdb4` | `ad48a803f2d579c0ab22becdcb4dae67f2750308c468c822972db0d1ecdf66de` |

## Contract that remains true

- `provides_tools` remains two tools (`project_task_context` + `project_impact`).
  Two names are compatible with ETS gated by `scope_enabled`.
- Legado `787f662` is out.
- Historical local names: Step 4.0 used ≠ Guard ≠ Step 4.1. They do not
  renumber the roadmap. Step 4 = Effective Task Scope as
  coordination/enforcement; Step 5 = Conflict Engine; Step 6 = Guard.
  WRITE/WATCH classification ≠ complete coordination/enforcement.
