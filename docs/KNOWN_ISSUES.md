# Known issues and deferred technical debt

This is the maintained repository summary of verified open or deferred defects,
with revision-bound evidence and durable workflow references. It is not a roadmap,
gate authorization, or replacement for historical reviews. The referenced Hermes
Kanban cards remain the workflow authority; repository summaries do not close them.

[Documentation index](README.md)

## OPTION-L-R1 — HTTPX lifecycle cleanup timing

- **Status:** KNOWN ISSUE — DEFERRED
- **Severity:** HIGH
- **Current priority:** LOW / non-blocking only for the separately gated, bounded,
  manually supervised architect pilot.
- **Affected revision:** `7f8d8d35eb2e18d6eb97d589550dac6e2affd423`,
  tree `1ff2934d96f974d0f8f5f329ebc89a8cdd0e8a76`.
- **Ownership:** architect owns technical assessment and backlog `t_87a4d9ae`;
  coordinator/operator owns reprioritization, scope, acceptance, and closure.

### Limitation and evidence

After observable caller cancellation or total timeout starts the shared cleanup
clock, a still-pending HTTP send/read worker or its unwind is not cancelled at that
cleanup deadline. `_CloseLifecycle.begin_cleanup` records the deadline origin but
schedules no expiry action for the worker. Supervision can remain in
`asyncio.shield(worker)` after the initial cancellation request. Later `close()`
applies deadline logic to response/client closer tasks, not the pending worker.
Eventual `nexus_cleanup_failed` after natural settlement does not establish
deadline enforcement.

Revision-bound source evidence:
[client.py](../integrations/hermes-nexus/client.py), lines 374–377 (`begin_cleanup`),
403–457 (`close`), 493–499 (total expiry), and 571–597 (worker supervision).
The committed
[test_client.py](../tests/hermes_nexus_plugin/test_client.py), lines 1243–1287,
contains `ClientTests.test_late_available_closers_are_invoked_after_shared_deadline`.
The definitive reviewer executed that finite fixture: it passed while pending
unwind crossed the shared cleanup deadline before closer invocation. These paths
are navigation links; the affected revision above pins the evidence. The accepted
bind-only child `45679d6ff8ea9c6ef65e3df749b1cdfbb814b34d` leaves this client and
test unchanged.

**Not fixed.** Formal G1 remains **REJECTED**; `OPTION-L-R1` and `OPTION-L-R2`
remain open. This finding is distinct from the waived stronger guarantee of
owning/classifying all HTTPX/httpcore-internal cleanup or proving physical release.
It does not establish a live TCP hang or leak, and establishes no hard cleanup,
cancellation, or resource-release guarantee. Stable pilot operation does not close
it; narrow pilot acceptance is not a fix.

### Reprioritization and pilot treatment

The canonical rule from backlog `t_87a4d9ae`, priority amendment comment **90**,
is to reprioritize and reopen the hard-lifecycle architecture decision when
**either condition alone** occurs:

1. **The system becomes substantially more complex.** Examples include unattended
   or 24/7 operation, broader profile/global rollout, concurrency,
   gateway/cron/autonomous traffic, remote or less-trusted operation, or execution
   model/runtime-stack changes that invalidate bounded-pilot assumptions.
2. **The problem manifests in practice.** Examples include a hang, leaked
   invocation-owned task/FD/socket/resource, repeated timeout, cancellation anomaly,
   unconsumed task failure, unexpected cleanup/transport failure, failure to settle
   within the operator containment window, or sustained unexplained related
   thread/FD/socket/memory growth.

These categories are alternatives, not cumulative prerequisites; examples do not
add prerequisites. During any separately authorized pilot, applicable hangs,
leaked tasks/sockets/resources, repeated timeouts, cancellation anomalies, or
resource growth require an immediate stop of further live calls and escalation
under `PILOT_ACCEPTANCE_STOP_LIFECYCLE`. The pilot contract's stricter stop and
containment rules still apply. Reopening architecture does not automatically
authorize custom transport, process isolation, or another lifecycle correction.

The low/non-blocking priority applies only to the separately adjudicated,
localhost-only, bounded, manually supervised architect pilot, not unattended
operation or claims of hard lifecycle isolation. The
[pilot runbook](hermes-nexus-architect-pilot.md#architect-only-option-l-lifecycle-disclosure)
retains its operational gates; this register authorizes no activation or execution.

### Closure

Closure requires separately approved architecture and implementation, exact-SHA
independent pending-unwind deadline and lifecycle/resource verification and review,
and explicit coordinator adjudication. Neither stable operation nor acceptance of
a narrower operating mode satisfies these criteria.

### Durable workflow references

References identify immutable evidence on the `hermes-nexus` Hermes Kanban board
by task, comment, and run; they are not a duplicated audit log or public web URLs.

- `t_87a4d9ae`: architect-owned deferred backlog; comment **90** is the authoritative
  priority-policy amendment.
- `t_c750024c`, run **118**: definitive `OPTION_L_G1_REVIEW_STOP`.
- `t_8441f220`: comment **82**, coordinator G1 rejection; comment **83**, separate
  pilot decision, not a G1 pass.
- `t_f33a8cb9`: `PILOT_ACCEPTANCE` contract comments **84–87**; comment **88**,
  bind-only authorization. Additive amendments **94–95** describe the accepted
  bind artifact and supervised operations requirements, not pilot acceptance.
- `t_f2483d47`: Option L contract comments **78–81**.
- `t_bec2982c` and `t_78748ff1`: historical lifecycle and Option T reviews.
