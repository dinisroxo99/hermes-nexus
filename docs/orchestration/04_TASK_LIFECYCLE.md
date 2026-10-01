# Task lifecycle

[Overview](00_OVERVIEW.md)

## Orientation and readiness

Start with `kanban_show` on the assigned card. Read contract, admitted state, parent
handoffs, comments/prior attempts and child edges. Handoffs are point-in-time evidence;
reverify identity driving current work. Work only inside the admitted assigned
workspace. Confirm absolute path, branch/detached state, full HEAD, clean index/tracked
tree and untracked state before effects.

- **Sticky blocked admission:** execution cards start blocked until orchestrator
  explicitly admits them after validation. Satisfied dependencies are not admission.
- **Ordinary dependency readiness:** after admission, incomplete parents still gate
  scheduling; their completion supplies readiness, not broader authority.

Do not unblock/transition other cards. Revision, scope or ownership mismatch requires
stopping, not reset/clean/force or speculative repair.

## Execution and blockers

Execute only the admitted contract. Use `kanban_heartbeat` for long operations.
Record actual checks and limitations, not plausible passes. Missing upstream evidence,
credentials/capability, required human decisions or workspace/revision mismatch are
genuine blockers: report the precise gap with `kanban_block` on the worker's own card.
Do not block merely to replace a completed review verdict or widen scope to fix an
external gap.

## Structured handoff

Complete only the worker's own card with `kanban_complete`, summary and metadata.
Repository handoffs identify absolute path/role, branch or accepted detached state,
baseline provenance, full actual candidate SHA/tree, commit list, paths,
index/tracked/untracked status, checks performed, unresolved issues and effect limits.
Provisioning carries writer before/after plus target identity. Review names exact
reviewed revision; publication names reviewed/pushed/PR head and verified merge.

Never invent future SHAs, IDs, checks or runtime model proof. After edits, pre-edit
context/impact evidence is **baseline-only**, not candidate proof. Completion ends a
phase and exposes evidence; orchestrator acceptance and separate next-stage admission
remain required.

## Selected independent-review lifecycle

This DAG uses a separate reviewer on a frozen verifier:

- Documenter/implementer **do not call `kanban_request_review`** or self-route.
- Reviewer **does not call `kanban_request_changes`**, requeue implementation or
  author corrections. It completes its own card with **PASS** or actionable
  **FINDINGS**, including exact SHA/tree and file/line actions.
- Orchestrator alone accepts, creates a separately bounded correction when authorized,
  or blocks. Initial docs DAG authorizes no extra correction cards by workers.
- Parent done, including reviewer FINDINGS, is **not publication permission**. P stays
  blocked until orchestrator accepts independent PASS on the exact candidate and
  explicitly admits publication.

Generic Hermes tools support same-card review/rework and other dependency workflows.
Those capabilities do not override this coordinator-managed lifecycle or justify a
second same-card lane alongside V/R/P.
