# Model routing

[Overview](00_OVERVIEW.md)

## Evidence-based dimensions

Record integer `complexity`, `risk`, `ambiguity`, `context_size`, each **1..5**, with
evidence in card body and manifest. These are separate dimensions, not a weighted
score or fabricated benchmark:

- Complexity: reasoning depth, coupling and interface coordination.
- Risk: consequences/reversibility of authorized effects.
- Ambiguity: unresolved requirements affecting work.
- Context size: relevant evidence integration, not raw token count.

Explain material high dimensions and why lower tiers are unsafe when escalating.
Irrelevant bulk context alone is not escalation; a long fixed contract is not
necessarily unresolved architecture.

## Four candidate policy routes

| Tier | Explicit model/provider | Policy |
|---|---|---|
| `T0_FAST` | `grok-4.6` / `xai-oauth` | Mechanical clear narrow work, low dimensions normally 1..2 |
| `T1_NORMAL` | `gpt-6.1-sol` / `openai-codex` | Ordinary bounded work without higher triggers |
| `T2_STRONG` | `grok-4.7` / `xai-oauth` | Deep review, difficult analysis/coupling or a material dimension 4 |
| `T3_FRONTIER` | `gpt-6-astra-900k` / `openai-codex` | Complex cross-package planning/architecture or exceptional ambiguity/risk/context integration, normally dimension 5; explain why lower tiers are unsafe |

Routes are policy, **not availability or benchmark guarantees**. Persist explicit
native `model` and `provider` overrides; record tier/rationale/scores in body and
manifest. No per-task reasoning override and no duplicate tier profiles. No model or
provider substitution without approval, including authentication/availability failure.

## Pinned docs DAG routes

Scores below are complexity / risk / ambiguity / context_size, not aggregated.
Detailed body/manifest rationale is recorded in `t_1994a059`.

| Stage | Scores | Tier | Rationale |
|---|---|---|---|
| W | 2 / 2 / 1 / 2 | T0_FAST | Mechanical pinned provisioning, bounded Git effects, no-repair contract |
| DOC | 3 / 2 / 2 / 4 | T1_NORMAL | Operator-mapped fixed-contract synthesis; context 4 is volume, not materially harder reasoning |
| V | 2 / 2 / 1 / 2 | T0_FAST | Mechanical exact-candidate provisioning; future SHA is an upstream output |
| R | 3 / 2 / 2 / 4 | T2_STRONG | Deep independent cross-document evidence/contract integration |
| P | 3 / 3 / 2 / 3 | T1_NORMAL | Bounded normal publication after exact-SHA acceptance, remote/CI stop gates |

Persisted override proves stored requested routing, not runtime inference identity.
Historical smoke preserves `MODEL_OVERRIDE_PERSISTED = YES` and
`MODEL_RUNTIME_PROOF = UNKNOWN`; prose, agreement and configured names do not upgrade
that UNKNOWN. See [Limitations](08_LIMITATIONS.md).
