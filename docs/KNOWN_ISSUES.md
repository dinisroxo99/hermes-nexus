# Known issues and deferred technical debt

This is the maintained repository summary of verified open or deferred defects,
with revision-bound evidence and durable workflow references. It is not a roadmap,
gate authorization, or replacement for historical reviews. The referenced Hermes
Kanban cards remain the workflow authority; repository summaries do not close them.

[Documentation index](README.md)

## DEV-ADOPTION-1 — current risk disposition

Operator decisions `t_779e8e9f` comment **149** and `t_87a4d9ae` comment **148**,
recorded additively in `t_5e427bb2` comment **150**, supersede the architect-only
priority restriction below for the approved development baseline
`feat/nexus-profile-integration@10d1f348fd4c6ddbb5319d972c71b426e51e574a`.
The baseline is the two-tool plugin (`project_task_context`, `project_impact`)
in exactly orchestrator, architect, implementer, tester, reviewer and documenter,
including normal concurrent development workers. Default and workspace-manager
remain excluded. Publication/adoption are accepted as recorded in
[DEV-ADOPTION-1](hermes-plugin-installation.md#dev-adoption-1--approved-development-adoption);
remaining limits below still apply.

**G1 remains technically/historically REJECTED. OPTION-L-R1 and OPTION-L-R2 remain
OPEN / KNOWN ISSUES — DEFERRED.** Current operator disposition is **HIGH severity,
LOW priority/non-blocking** for this exact development adoption and publication.
Original findings remain **R1 HIGH** and **R2 MEDIUM**. No lifecycle correction,
hard cleanup/isolation, absence of leaks, or production-readiness claim follows
from this waiver. Green tests, accepted bind/docs changes and partial manual
results do not close either finding or turn G1 into PASS.

The previously recorded triggers remain alternatives: a **subsequent material
change** to complexity, runtime, trust or scope, **or practical manifestation**.
The exact fleet/concurrent-development adoption just approved is the operational
reference and does not retrigger its own waiver by being implemented. Unattended
24/7 service, new gateway/cron surfaces, remote/less-trusted operation or further
material changes still require reassessment. Concrete lifecycle symptoms require
stopping affected calls and coordinator/operator adjudication; reopening does not
authorize an automatic fix, custom transport, process isolation or service restart.
INFRA-1 [current operation is accepted](hermes-plugin-installation.md#infra-1--approved-implementation-pending)
at the service pin, with WSL-restart boot not demonstrated and rollback not
proved; that acceptance does not authorize Step 4.

## OPTION-L-R1 — HTTPX lifecycle cleanup timing

- **Status:** KNOWN ISSUE — DEFERRED
- **Severity:** HIGH
- **Current priority:** LOW / non-blocking for DEV-ADOPTION-1 above. The former
  architect-only restriction is retained below as historical policy, not the
  controlling scope of the current waiver.
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

The historical rule from backlog `t_87a4d9ae`, priority amendment comment **90**,
is retained here with the baseline qualification in DEV-ADOPTION-1 above:
reprioritize and reopen the hard-lifecycle architecture decision when
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

At comment 90, low/non-blocking priority applied only to the separately
adjudicated localhost-only, bounded, manually supervised architect pilot.
DEV-ADOPTION-1 now controls the approved development fleet; neither disposition
establishes hard lifecycle isolation. The historical
[pilot runbook](hermes-nexus-architect-pilot.md#architect-only-option-l-lifecycle-disclosure)
retains its old gates for audit, not as a new pilot requirement for this adoption.

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

## OPTION-L-R2 — incomplete lifecycle and resource evidence

- **Status:** OPEN / KNOWN ISSUE — DEFERRED.
- **Historical finding severity:** MEDIUM (`t_c750024c`, run **118**).
- **Current operator severity/priority:** HIGH / LOW, non-blocking for
  DEV-ADOPTION-1 as scoped above; not evidence that the missing proof exists.
- **Affected baseline:** the same `7f8d8d35eb2e18d6eb97d589550dac6e2affd423`
  reviewed for R1. Client/Python tests remain unchanged at the adoption source
  baseline `10d1f348fd4c6ddbb5319d972c71b426e51e574a`.

The retained lifecycle/resource test matrix is incomplete: pending-unwind,
EOF total-only paths/orderings, repeated cancellation/baseline checks,
task/timer/outcome accounting and loop-error/socket oracles lack the required
retained evidence. Existing passing tests are not a complete resource-release
proof. This is distinct from the concrete pending-worker deadline defect in R1.

Technical assessment remains architect-owned; coordinator/operator owns scope,
reprioritization and closure. The same subsequent-material-change **or** practical-
manifestation triggers apply. Closure requires separately scoped implementation/
evidence work, exact-revision independent verification/review and explicit
adjudication, not merely stable development use or broader installation.
