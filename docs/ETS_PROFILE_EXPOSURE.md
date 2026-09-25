# ETS profile exposure

[Home](../README.md) · [Current status](CURRENT_STATUS.md)

## Verification boundary

This map records pin bytes, `scope_enabled`, SOUL hashes (instructions, not a
wrapper) and proof cards for ETS caller exposure on development profiles.
Hashes are copied from accepted kanban records (`t_e837c52a` and the cited
install/review cards). This documentation task did not re-hash `~/.hermes`,
did not call `project_*`, and did not start Nexus.

Plugin/caller pin: `6ebb7aaa7ae7027c3e590a51bdbf5b5935651776` (tree
`8e97d59c406e9a1e195fcff4213c941d4f07f5de`). Ancestors: caller
`cc4fcbcbad68de2d6e8d4bed9df9eaff29a60acb`; composer
`e9faf6a3f1e18224479e45b0f1afa2f1ac8405c5`.

Distinguish **plan**, **verified execution** and **pending**. Handoffs are
dated historical evidence, not a live probe in this documentation task.

## Stable contract

These facts must not be contradicted:

- `provides_tools` is exactly `project_task_context` and `project_impact`.
- `project_effective_task_scope` does **not** enter the global yaml.
- Hide-by-omit: `register()` adds `project_effective_task_scope` only when
  `scope_enabled` is exactly true. Omitted or false ≠ true.
- `includeTests` omitted in the plugin ≠ true.
- SOUL paragraphs are instructions, not a wrapper.
- ETS is read-only classification. WRITE does not authorize edit, lock,
  dispatch or new cards, and does not open Step 4, Conflict Engine, Guard,
  legacy tools or extra documentation work. Do not propose the next step from
  ETS.
- Incomplete / partial / unsupported / unavailable / `not_evaluated` ≠ safety.
  Test candidates ≠ results. Do not invent `dirty: false` or opaque IDs. Do
  not force `available`.
- When obtaining ETS: Context, then Impact and ETS with `includeTests` true;
  standalone Impact keeps the tool default (omitted ≠ true).
- Step 4 is **not** initiated as coordination/enforcement. Composer
  `compose_effective_task_scope` at `e9faf6a3f1e18224479e45b0f1afa2f1ac8405c5`
  remains read-only local. Labels WRITE/WATCH; RESERVED/IMPACT `not_emitted`.
- Nine Project Map tools remain LEGACY/DEFERRED. `787f662` / adapter 1A are
  outside this delta. R1/R2 remain OPEN/HIGH. G1 remains REJECTED. This is
  not G1 PASS or production readiness.

## Plan

Design card `t_d34a0d79` (`ETS_ARCHITECT_EXPOSE_DESIGN_OK`): isolation is
possible without putting the ETS name in global `provides_tools`. The pin
already hides the tool by omitting `register_tool` unless `scope_enabled` is
exactly true. Exposure is a per-profile plugin copy of the pin plus
`settings.scope_enabled: true` on that profile. Composer, hide-by-omit, the
two adopted schemas and global `provides_tools` stay unchanged. That design
was architect-scoped; it did not by itself authorize a six-profile fleet.

## Verified execution

Independent pinned copies (not symlinks) of the pin plugin, with
`scope_enabled: true`, on six development profiles. `default` and
`workspace-manager` remain excluded. workspace-manager has no flag
(`scope_enabled` = null).

### `scope_enabled`

| Profile | `scope_enabled` |
|---|---|
| orchestrator | true |
| architect | true |
| implementer | true |
| tester | true |
| reviewer | true |
| documenter | true |
| workspace-manager | null (no flag) |
| default | excluded |

### Pin plugin SHA-256 (six files)

Accepted on orchestrator install `t_06106b67` and byte review `t_e837c52a`
(plugin byte-identical to pin). Full hashes, not truncated:

| File | SHA-256 |
|---|---|
| `__init__.py` | `7540f6d1d846894ed20ad3e50d083b6cd2c708f3f421e2c7fefc9e089fe6f81b` |
| `client.py` | `23918265689be31efd153091260443d2dc2738a28eea63c1bc2e8c0d72b049ae` |
| `effective_task_scope.py` | `01d5ddff7fbdd5c64509b466c47ed083a461b504f396455d35e0549555fa0603` |
| `plugin.yaml` | `754da14feeaf937dddc4a41df115ea92630345735a4f27cfebeb634ecb0dbb9c` |
| `schemas.py` | `422d7924c062eb5ee390723a79203a8d5373c6ef32592ca2cfa184d00e43ecf9` |
| `tools.py` | `bc1921ba65e8fa03ead1fdacc4306f4db6c9bade7411ed3345580a4a01142bd0` |

### SOUL SHA-256 (instructions, not a wrapper)

| Profile | SOUL SHA-256 |
|---|---|
| orchestrator | `70cd237ffded2b1d1afe55f05866b17c0259ca7594dfa92eb68a2615d9e5b6cf` |
| orchestrator baseline (not rehashed) | `026928a996620427025c4a78b7c2ec07afabc299f08edb20d25e6fe8cb003b6c` |
| architect | `2d33d54c6597554346a25427c77007ec1bd725678c9a2e8c09bec136d5a3c241` |
| implementer | `684b90d89e3e27403ce294bdb225202d078353cad68c0dfb232940b549208d7e` |
| tester | `85d5f9f75981d96f6cea486ce0546dd2128141380e7a68bd5a37468695265a91` |
| reviewer | `2626781f5b8cad79be206de287e1cc1a4a4d5f26e0c1799e2653e9ae0e41f4d3` |
| documenter | `4d14d2f369d6bd146022fc7fbbb067f6d878b8afd0c9ef459069047d9421f36f` |

Orchestrator SOUL contains both required phrases: (a) when obtaining ETS,
Impact and ETS with `includeTests` true; standalone Impact keeps the tool
default; (b) ETS is read-only classification; WRITE does not authorize.

### Installations

| Profile | Card | Marker |
|---|---|---|
| architect | `t_6f9e30b5` | `ETS_ARCHITECT_EXPOSE_INSTALLED` |
| implementer | `t_9c12d3d3` | `ETS_IMPLEMENTER_EXPOSE_INSTALLED` |
| tester | `t_fd40f413` | `ETS_TESTER_EXPOSE_INSTALLED` |
| reviewer | `t_955721db` | `ETS_REVIEWER_EXPOSE_INSTALLED` |
| documenter | `t_944820b8` | `ETS_DOCUMENTER_EXPOSE_INSTALLED` |
| orchestrator | `t_06106b67` | `ETS_ORCHESTRATOR_EXPOSE_INSTALLED` |

### Byte reviews (APPROVE, 0 material findings)

| Profile | Card | Marker |
|---|---|---|
| architect | `t_53dbe3df` | `PASS_ETS_ARCHITECT_EXPOSE_REVIEW` |
| implementer | `t_d12fb2f3` | `PASS_ETS_IMPLEMENTER_EXPOSE_REVIEW` |
| tester | `t_3f9c7cf5` | `PASS_ETS_TESTER_EXPOSE_REVIEW` |
| reviewer | `t_b0a0dfbb` | `PASS_ETS_REVIEWER_EXPOSE_REVIEW` |
| documenter | `t_929d8681` | `PASS_ETS_DOCUMENTER_EXPOSE_REVIEW` |
| orchestrator | `t_e837c52a` | `PASS_ETS_ORCHESTRATOR_EXPOSE_REVIEW` |

149/149 tester probes on the orchestrator pin are not byte proof.

## Orchestrator live proof

Two facts, both kept:

1. Card `t_8318a878` is the **old TUI / long session**. Tools were **not**
   loaded (`project_task_context`, `project_impact` and
   `project_effective_task_scope` missing). Marker
   `ETS_ORCHESTRATOR_EXPOSE_LIVE_PROOF_JS_NOT_EXECUTED`. That card is **not**
   the session that ran the tools. Do not convert it into a live PASS.
2. **After that TUI quit**, a **new session** ran the orchestrator live proof.
   Operator-authorized record only (no extra fields, no fabricated
   `findingState`, `available` not forced): `evidence_found`; ETS
   `incomplete`; WRITE **1**; WATCH **5**.

Incomplete ≠ safety. WRITE does not authorize. This is not G1 PASS and does
not start Step 4.

## Pending

- Step 4 not initiated as coordination/enforcement.
- Two-tool publication still pending.
- `default` and `workspace-manager` remain excluded.
- R1/R2 OPEN/HIGH; G1 REJECTED.
