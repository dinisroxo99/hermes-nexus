# Step 4 entry contract — Effective Task Scope

```
PREPARED
NOT IMPLEMENTED
```

This is the canonical entry contract for the first Roadmap Step 4
implementation slice. It persists the independently reviewed architecture
decision. It is not implementation authorization, operator risk acceptance,
deployment approval, runtime exposure, or a claim that Roadmap Step 4 is
complete.

The first slice below is **SPECIFIED_NOT_STARTED**. No Step 4, 5, or 6 code
is started by this document. Do not invent architecture, labels, endpoints,
or authorization beyond this contract.

## Contract baseline observation

Repository text at SHA
`ef3df8d36561d56b90c535e1b8ad85993200a674` (tree
`c9c89b1568ffc06c243b7169ef1251f71aea684d`; subject: merge of PR #42) is
the contract baseline **observation**. That SHA is not a future merge SHA,
not live service, and not an instruction to treat this documentation
checkout as deployed.

Sources of the reviewed decision (external artifacts; not repository files):

- architecture decision, independently hashed
  `61264902fb20edf753924ab9c9dab3a5a385c82504d12cf47bedb2cb1372bce4`
- independent review PASS, independently hashed
  `741c8b4ae7357b362a9e409909ca82d4521adeaedb831f8a420544a2774f8181`

Reviewed decision: `t_76027c14` run 638. Independent review: `t_6a9ad7f3`
run 639 PASS.

Future module names in this contract are **PROPOSED**. They are not asserted
to exist at the baseline. Current code at the baseline includes the Python
ETS precursor (WRITE/WATCH only) and implemented Impact v2.
`src/lib/workspace-scope.js` is workspace/path matching, not the full
Step 4 resolver.

Partial, unsupported, unavailable, or `not_evaluated` Project Intelligence
evidence never proves safety. This contract does not invent `dirty: false`
or opaque repository/worktree IDs.

## A. Naming

**DECISION A:** Preserve Roadmap Step 4 = Effective Task Scope; Step 5 =
Conflict Engine; Step 6 = Hermes Guard integration.

The active plan's numbering is authoritative for this work. Steps 1, 2, 2.5
and 3 remain COMPLETE/ACCEPTED. Step 4 is NOT IMPLEMENTED; Steps 5 and 6 are
NOT IMPLEMENTED. This document prepares entry; it starts none of them.

“Phase 2 — Scope and Conflict Engine” is the broader historical design
grouping. Its internal “Step 4 — Detect task conflicts” maps to work for
**Roadmap Step 5**, not Roadmap Step 4. Historical Step 4.0/4.1 and
ETS-4/contract-1 labels remain historical names; do not renumber or rewrite
them.

Do not import historical Phase-2 “Step 6 — Expose tool/API” into Roadmap
Step 4 or Roadmap Step 6. Active-plan Step 6 remains Guard. This slice
authorizes no tool.

## B. WRITE semantics

**DECISION B:** WRITE is mutation intent classified by a read-only analysis;
it is not operational authorization. WRITE alone does not grant operational
authorization.

| Owner/layer | Meaning and responsibility |
|---|---|
| Nexus Step 4 | Describe one task's intended mutation targets and evidence-derived classifications. No mutation or operational permission grant. |
| Hermes / explicit task policy | Decide whether the assigned role may perform the work and with which tools. A valid scope is not a substitute for that decision. |
| Nexus Step 5 | Compare scopes and produce conflict/revalidation evidence. Comparison does not transfer Kanban ownership. |
| Hermes Step 6 integration | Apply approved runtime policy to operations, using scope/conflict evidence as inputs. |

Current ETS WRITE/WATCH already means read-only classification. WRITE does
not authorize edit, dispatch, locks, leases, or new cards. RESERVED, WATCH,
and IMPACT do not imply those powers either.

Sentences such as “The current task is authorized to mutate this
path/symbol” in `06_SCOPE_IMPACT_CONFLICTS.md` and “Only WRITE is
automatically writable” in `21_RUNTIME_SECURITY_AND_ENFORCEMENT.md` are
historical target-design language. They do not describe current Step 4
semantics.

## C. Versioning

**DECISION C:** `effective-task-scope-v1` remains semantically frozen. The
new domain contract is `analysisVersion: "effective-task-scope-v2"`,
`schemaVersion: 2`.

Current precursor (frozen; do not reinterpret):

- schemaVersion 1; analysisVersion `effective-task-scope-v1`.
- `labelsEmitted` exactly `["write", "watch"]`.
- reserved/impact are not emitted; existing `labelsNotEmitted` reasons
  remain unchanged.
- Existing availability, includeTests behavior, errors, ordering, repository
  aliases, field shapes and exhaustive flags are not reinterpreted.
- `write-write-intersection-v1` and `write-watch-intersection-v1`
  deliberately require the v1 version and labels. They must continue to
  refuse v2 rather than have fields renamed or versions laundered to fit.

Current v1 can emit reason `tests_not_requested` when a requested
affectedTests section is not available, while still attaching candidate
roles. v2's separate mismatch rule is new and must not be back-ported.

The v2 schema is deliberately distinct because the evidence model, category
containers, change semantics, status handling and four-category vocabulary
differ. It has a separate internal `policyVersion: "step4-foundation-1"`
identifying the initial deterministic rules. Later rule changes need an
explicit versioned policy and review; breaking DTO changes need a
schema/analysis contract decision. No implicit v1-to-v2 upgrade, v2-to-v1
downgrade, union acceptance, replacement handler, or adapter change belongs
in the first slice.

## D. Canonical implementation layer

**DECISION D:** Implement future v2 deterministic domain logic once in
`src/lib/`, in the repository's existing JavaScript ES-module style. Hermes
integration remains an adapter, not a second resolver.

PROPOSED modules (do not exist as Step 4 modules at this baseline):

- `src/lib/effective-task-scope-policy.js`: v2 constants, strict
  input/binding validation, pure change-semantics resolution and rule/budget
  vocabulary.
- `src/lib/effective-task-scope.js`: the pure
  `composeEffectiveTaskScope(request, evidence)` composition boundary.
- `tests/effective-task-scope-policy.test.js` and
  `tests/effective-task-scope.test.js`: isolated contract, example and
  property/invariant tests.

The composer receives already obtained data; it must not invoke
`buildProjectTaskContext`, `buildProjectImpact`, analyzers, Git, filesystem
collection, HTTP, Hermes, persistence, or clocks. It consumes the existing
contracts rather than changing them. Use current pure validators where their
semantics fit, but do not import a live service merely to reuse a helper or
refactor foundations to obtain one.

The architectural precedent is `composeProjectImpact(input, observation)`
separated from IO in the Impact service. No TypeScript build pipeline or new
dependency is needed.

Keeping frozen Python v1 is compatibility preservation for a different
contract, not permission to implement Python v2. Future v2 adapters will
obtain the canonical Node result through a separately approved integration
seam; they may validate/wrap transport, not recalculate classifications. No
HTTP route or tool is selected or implemented in the first slice. No
duplicated v2 Python resolver.

## E. Input contract

**DECISION E:** v2 is an internal, data-only, one-task request plus accepted
Context/Impact evidence, bound to a truthfully supplied current observation.
It is not a new public request DTO.

PROPOSED call shape: `composeEffectiveTaskScope(request, evidence)`. Request
owns intent and the expected binding; evidence owns observed facts. Both are
bounded JSON-compatible data objects. Required does not mean “invent a
value”; unavailable observations have an explicit terminal outcome.

| Field | Requirement / origin | Validation and fail-closed behavior |
|---|---|---|
| request.task.id | Required; caller-supplied from Hermes task identity | Nonempty bounded string, at most 128 characters. Exact identity, not generated by Nexus. Must equal Context task echo. |
| request.task.title | Required; caller-supplied | Nonempty, at most 200 characters; exact canonical echo match. Descriptive data, not policy. |
| request.task.paths | Required; caller-supplied explicit mutation-intent targets | First slice requires 1–32 literal project-relative file paths, count checked before deduplication. Each at most 1024 characters. No directories/globs/automatic workspace expansion. Exact canonical sorted set must equal Context task paths and Impact originPath/targets. |
| request.task.symbols | Optional, caller-supplied; omission canonicalizes to [] | At most 8 bounded names of at most 128 characters, consistent with current Context. Names are not stable IDs. First slice with a nonempty list returns not_evaluated / symbol_targets_not_supported, not widened file WRITE or a silently ignored symbol. |
| request.projectId | Required; caller supplies existing persisted identity | Validate format and exact equality with both evidence documents. No name fallback, enrollment, path-derived ID, or project auto-discovery in the composer. |
| request.worktree.rootId, relativePath | Required; caller supplies verified selected locator | Bounded canonical configured-root-relative locator. Must equal both evidence project locators. Absolute host roots do not enter the result. Pure validation is not filesystem containment verification. |
| request.expectedRevision | Required; caller supplies actual revision-reader observation | Requires explicit status, commitSha, branch, dirty, isLinkedWorktree, repositoryId, worktreeId. Evaluation needs available status, full commit SHA, explicit branch string or null, observed dirty false, linked-worktree true, and opaque nonempty IDs. Missing required members are rejected. Truthful unavailable/unborn/not_git, nullable unknown fields or dirty true are not made clean; first slice returns not_evaluated. |
| expectedRevision.repositoryId / worktreeId | Required for evaluated output; copied from accepted observation, never derived here | For the first slice use the adopted caller's 64-lowercase-hex ID constraint. Context canonical field is revision.repositoryIdentity; Impact canonical field is revision.repositoryId. Normalize into v2 repositoryId only after presence, format and equality checks; any supplied alias must match its canonical field. No null==null acceptance. |
| expectedRevision.branch | Required, caller-supplied observed value | String at most 512 characters or explicit null for detached. Missing is not detached. A branch/commit/worktree mismatch is not normalized away. |
| expectedRevision.dirty | Required observed boolean or explicit unknown null in a terminal observation | Only exactly false supports classification in this first slice. No default, cast or clean-worktree repair. The composer does not claim a dirty-content fingerprint. Do not invent `dirty: false`. |
| evidence.pack | Required; caller-supplied accepted inner Task Context Pack data | Require schemaVersion 1 / task-context-v1; identity/revision, contextPackId, analysis snapshotToken/provider/coverage, observation, limits, task echo and bounded section metadata. Reject transport errors/wrappers passed as domain data and incompatible versions. A transport adapter may unwrap accepted results later; it may not manufacture acceptance. |
| Context task echo | Required, derived from pack.sections.task.items | Exactly one retained task item with matching id/title/paths/symbols. Missing, truncated or conflicting task echo rejects. No description text is needed or copied to v2. |
| Workspace scope | Derived from pack.sections.workspaces, not an additional authority-bearing request field | Retain bounded workspace id/path/workspacePath/matchedPaths, provenance and section/item truncation. Empty available/empty section means no observed match; omitted/not_analyzed/truncated means limited evidence. No match expands WRITE. Existing workspace matching is reused upstream, not duplicated. |
| Context files/symbols/constraints evidence | Derived and conditional | Retain only metadata used by a rule: exact source path/hash and symbol id/name/path where actually present. Full symbol mode, when separately implemented, must resolve a name uniquely within supplied explicit paths and the same snapshot; ambiguity/uncovered symbols stay unevaluated. declaredOnly permissions and repository prose are never operational authorization. |
| evidence.impact | Required; caller-supplied accepted inner ImpactResult | Require schemaVersion 1 / impact-v2. Validate single-target or multi-target variant exclusively, exact explicit origin set, revisions, snapshot token, provider, coverage, observation, limits, affectedFiles, affectedTests and all completeness dimensions. No symbols, change kind, strongCoupling, compatibility score, runtime permission, or full graph is claimed to exist in this result. |
| request.includeTests | Required explicit caller boolean in v2 | True requires a requested affectedTests section; false requires not_requested with no candidates. Omission is rejected in this new internal contract, not interpreted as true. This changes neither current Impact defaults nor v1 behavior. A true request paired with not_requested is a request/evidence mismatch; partial/unsupported/unavailable requested sections remain incomplete. |
| Affected-test candidates | Derived only from impact.affectedTests when requested | Preserve exact path/origins/originSummary and heuristic provenance. Context tests are a different heuristic source, not substitutes for requested Impact tests. Candidates are not executed tests or coverage proof. |
| request.changeSemantics | Optional caller declaration object `{category}` | One category from F; omission is recorded, not guessed from the title. Provenance is task_declaration, not provider analysis. Invalid category/extra policy fields reject. Declaration cannot suppress witnessed relationships. |
| Provider/evidence provenance | Required for retained derived classifications; derived from source DTOs | Preserve provider id/version, capability, relationshipKind, trust, basis, source hash, location and retained origin. Wrong provider/token/source binding or a malformed retained witness rejects; no invented source locations or origins. Nullable provider for unavailable evidence is retained in terminal/incomplete summaries. |
| Completeness | Required source metadata, plus derived v2 evaluation metadata | Impact's source/provider/traversal/output arrays, target states, test states, observation.incomplete and Context section statuses/truncation are preserved. Missing evaluation metadata never produces available. Structurally malformed required records reject. |
| request.limits | Optional caller restriction within fixed v2 maxima | Only finite safe positive integers, no coercion/clamping; the first slice accepts compactBytes only. Unknown limit names reject. Upstream Impact/Context limits are evidence, not execution controls. |

Revision field spelling matters: Context does not supply Impact's canonical
`repositoryId` spelling. The normalized v2 field is a deliberate new-contract
mapping, not a rename of either producer.

Paths are case-sensitive and literal. Reuse `normalizeImpactPaths` for
validation/deduplication but require each original spelling to equal its
normalized spelling: do not silently trim leading spaces, replace separators,
drop trailing slashes, or repair traversal. Existing Context/Impact
normalization remains unchanged.

**WRITE item versus missing target evidence:** an explicit requested file
path is a WRITE item in classification-bearing results. Missing
`targetSource` for a syntactically valid requested path is
`not_evaluated` evidence and makes the result incomplete. It is not proof
of in-project existence or absence, and it is not safety. Do not drop the
WRITE item because target evidence is missing. A requested path may remain
explicit intent in an incomplete result when other targets are evaluable,
but cannot establish safe membership by itself.

The first slice does not distinguish create/delete/rename operations or
expand directory requests.

Trust boundary: the domain function validates consistency, not authenticity
or live filesystem containment. Only a later separately gated
service/adapter can supply freshly resolved project/worktree observations
through the existing collectors. No user-provided field can turn a
fabricated object into authenticated evidence. Tests may use labelled
fixtures; runtime callers must supply accepted observations.

## F. Change semantics

**DECISION F:** Explicit task declarations and deterministic inference
coexist, with separate provenance and a conservative, explainable
reconciliation. No LLM is required.

Machine categories are `documentation`, `test_only`, `local_implementation`,
`public_signature`, `interface_contract`, `schema_migration`, `unknown`
(human labels: documentation, test-only, local implementation, public
signature, interface/contract, schema/migration, unknown).

First-slice algorithm:

1. Preserve an optional declared category as `task_declaration`. Never parse
   imperative task prose or Markdown into trusted instructions.
2. Compute an inferred category from canonical requested paths only: all
   `.md`, `.rst`, or `.txt` paths => documentation; otherwise all paths
   matching the existing source-extension plus test-path conventions =>
   `test_only`; otherwise unknown. Mixed docs/test sets and ordinary
   implementation filenames remain unknown. These are heuristic path
   observations, not proof of actual edit semantics. Documentation extensions
   are the stated lowercase `.md` / `.rst` / `.txt` set. Paths remain
   case-sensitive. The test-path rule is the existing case-insensitive
   predicate used by Context selection and Impact.
3. A declared `public_signature`, `interface_contract`, or
   `schema_migration` takes precedence over path heuristics, without claiming
   verified signature/schema differences. A declared unknown remains unknown.
   A declared `local_implementation` is accepted as intent when path
   inference is unknown; a contradictory docs/test path inference yields
   unknown plus `declaration_path_disagreement`. A documentation/`test_only`
   declaration must agree with its respective all-path heuristic; otherwise
   effective category is unknown plus `declaration_path_disagreement`. With
   no declaration, use the inferred category.
4. Record declared, inferred, effective, basis/trust, rule ID and reasons
   separately. Unknown is explicit; no default to “local”, “safe”, or
   confidence zero. Future structural diff/signature evidence may refine
   inference only through an approved rule/evidence extension; current
   ImpactResult contains no diff/change semantics.
5. This first policy never suppresses retained dependencies for a claimed
   documentation or test-only change. Documentation can contain contracts;
   tests can be shared. For known documentation/`test_only`/
   `local_implementation`, retained distance 1–2 => WATCH, farther evidence
   => IMPACT. For `public_signature`/`interface_contract`/`schema_migration`/
   unknown, all retained affected non-WRITE paths => WATCH pending richer
   compatibility analysis. Tests requested as candidates are WATCH
   regardless of distance. See H/I for precedence and omissions.

There is no unsubstantiated promise that interface changes already produce
RESERVED. Strong coupling needs an adopted proof model; it cannot be
synthesized by combining a high-risk declaration with a generic
import/reference. Unknown broadens awareness among observed paths, never
WRITE or runtime locks, and adds `semantics_unknown` to v2 completeness.

## G. Output contract

**DECISION G:** Emit a new bounded deterministic discriminated result, with
explicit evaluation/completeness rather than a scalar confidence score.

PROPOSED v2 result fields:

| Field | Contract |
|---|---|
| schemaVersion / analysisVersion / policyVersion | 2 / effective-task-scope-v2 / step4-foundation-1. Fixed field order in serializer; not v1-compatible. |
| status | available, incomplete, not_evaluated, rejected, or stale, as defined below. |
| task | `{id,title,paths,symbols}` canonical intent; no description or instructions. Present after valid task binding. |
| projectId / project | Persisted ID and selected `{rootId,relativePath}`. Never absolute host paths. |
| revisionBinding | `{status,commitSha,branch,dirty,isLinkedWorktree,repositoryId,worktreeId}`. One exact observation binding, not a revision range. Preserve null only in non-evaluable envelopes. Impact isGit may be null; do not invent true or require it as an extra assertion. |
| sourceBinding | `{contextPackId,contextSnapshotToken,impactSnapshotToken,contextSourceDigest,digestCoverage}`. Require equal snapshot tokens for composition; sourceDigest is Context's bounded digest, not an Impact field or whole-tree hash. Preserve canonical provenance of each reference. |
| changeSemantics | `{declared,inferred,effective,provenance,reasons}` following F; deterministic rule IDs, no prose-driven authority. |
| write / reserved / watch / impact | Each category is `{status,items,reasons,truncated}`; category statuses available, incomplete, not_evaluated. Empty available is bounded no matching evidence; empty not_evaluated is unknown. These category containers exist only for classification-bearing available/incomplete results. |
| Category item | `{target,roles,ruleIds,evidenceRefs,origins,attribution}`. target is `{kind:"file",path}` initially; future symbol target `{kind:"symbol",path,symbolId}` requires exact snapshot-bound resolution. Roles describe explicit_task_path, affected_file, affected_test_candidate or later explicit_symbol, not permissions. |
| origins / attribution | Preserve per-origin originPath, observed minimumDistance, witness reference and originSummary. Never synthesize full routes, additional origins or absolute minimal graph distances. |
| evidence | Bounded deduplicated source/witness records needed by retained items. Retain complete Impact witness fields and candidate provenance; declaration evidence is labelled separately from analysis. Every reference resolves within this result. |
| completeness | Preserve upstream Context observation/section statuses, Impact global/target/test statuses and all source/provider/traversal/output reasons; add separately namespaced resolver reasons/evaluation states. No rewriting missing-data reasons into available. |
| limits / bounds | Fixed input/output/entry limits, requested compactBytes and inherited producer limits; recorded counts and upstream truncation/attribution flags. Never report an exact unknown omitted count. |
| stale | `{state,checkedAgainst,requiresReobservation,reasons}`. Bound means consistent against the supplied expected observation, not continuously fresh. Missing live reobservation is explicit. See J. |
| generatedAt | null. No volatile clock, generated random IDs or elapsed time in the deterministic domain result. |
| reasons | Bounded deterministic machine reasons, with the originating stage; no raw errors, source excerpts, credentials or absolute paths. |

No `confidence: 0.0`, scalar confidence, probability of safety,
`watchExhaustive` guarantee, ALLOW/BLOCK decision, task status transition,
lock ownership or lease enters v2. Evidence basis
(semantic/structural/heuristic/unknown), per-category evaluation and
completeness replace a scalar. v1's existing fields remain frozen, not
retrospectively corrected.

### Status rules and precedence

Validation runs before classification, in this order: input shape/version/bounds;
identity and task/origin consistency; Context/Impact source/revision agreement;
supplied-current-observation comparison; evaluation eligibility; classification
and final output bounds.

- **rejected:** malformed/oversized/incompatible input; identity/task/origin
  mismatch; conflicting canonical aliases; internally inconsistent evidence
  or missing required binding. No classification containers. Structured
  reasons only; do not echo unvalidated identity/text. Request IDs are not
  accepted merely because they agree with each other.
- **stale:** evidence is internally coherent but differs from a supplied
  current observation for the same project/repository/worktree, or a later
  consumer detects a change in an input bound by J. No consumable
  classification containers in a stale outcome. Different
  project/repository/worktree identity is rejected, not relabelled “stale”.
- **not_evaluated:** a well-formed request cannot be evaluated (truthfully
  dirty/unavailable/unborn/non-Git observation; unsupported symbol mode;
  Impact globally unsupported/unavailable/not_evaluated). No classification
  containers; a valid task echo may be retained as intent, never advertised
  as resolved WRITE.
- **incomplete:** one or more usable explicit targets/evidence items can be
  classified, but a target, relevant Context section, category, semantics,
  tests, provider, source, traversal, witness attribution or output is
  incomplete. Preserve useful witnessed evidence and exact causes. Aggregate
  `evidence_found` never cancels a per-target `not_evaluated`.
- **available:** all required evaluation categories and requested evidence
  were evaluated against coherent bindings, with no relevant incompleteness.
  This is “available bounded analysis,” not safe-to-run/no-conflict/coverage/
  permission. Optional tests explicitly not requested are labelled
  `not_requested` in evidence, never “tested”; they do not by themselves
  invalidate a policy that did not request them.

In the specified first slice RESERVED is `not_evaluated` with reason
`coupling_evidence_not_supported`. Therefore successful classification
results in this slice are **incomplete**, never falsely available full
Step 4 scopes. That is an intentional visible capability limit, not a test
to waive or hide. The full output model supports available for later
genuinely evaluated capabilities; the foundation does not simulate them.

A too-small output budget is `scope_budget_exceeded`. Do not invent an HTTP
status or a success envelope for that case.

## H. WRITE / RESERVED / WATCH / IMPACT

**DECISION H:** Four distinct analysis classifications; none is an
operational lock or grant.

- **WRITE:** the exact target the task intends to modify. File WRITE comes
  only from explicit task paths; impact, workspace matches, references and
  tests never add WRITE. A future explicitly resolved symbol stays a symbol
  intent; no implicit containing-file permission is manufactured.
- **RESERVED:** evidence of strong direct coupling that makes another task's
  WRITE potentially incompatible. Not a runtime lock, not a conflict by
  itself, not an instruction to wait. Step 5 will assess comparisons. A
  nonempty RESERVED entry requires an adopted direct-coupling proof and rule
  identifying both endpoints and affected contract/change semantics; generic
  relation/distance is insufficient.
- **WATCH:** an observed relevant dependency/consumer/test needing awareness
  or revalidation. It does not automatically block or serialize. Distance
  1–2 is an awareness heuristic, not semantic compatibility proof.
- **IMPACT:** transitive/informational observed effect beyond the awareness
  rule. Never grants WRITE and never generates a hard lock alone. Exclusion
  from WATCH does not mean absence of risk.

Initial RESERVED policy is deliberately closed: none of Impact v2's
imports/uses/references by itself qualifies as strong coupling, including
semantic references. `reserved.items=[]`, status `not_evaluated`,
`coupling_evidence_not_supported`. Do not convert that empty set to “no
reservations required”. A later bounded direct-coupling evidence
producer/rule is prerequisite to nonempty RESERVED; designing/implementing
that producer is not in the first slice and is not delegated to a worker to
improvise.

Invariants:

1. All items belong to exactly the enclosing project/repository/worktree/revision.
   Cross-project evidence rejects; filenames are not globally keyed identities.
2. Within one target granularity, final categories are disjoint, with
   precedence WRITE > RESERVED > WATCH > IMPACT. WRITE ∩ RESERVED is empty
   after normalization. Preserve lower-classification reasons on the winning
   entry instead of duplicating targets or dropping evidence. In the first
   slice all targets are files.
3. With future symbol support, a file and symbol are different target keys;
   a file target may contain symbols. Do not imply different symbols in one
   file can safely run concurrently. File-vs-symbol overlap rules belong to
   Step 5, not a Step 4 conflict assertion.
4. Deduplicate by exact target identity; union roles, rules and evidence
   deterministically. Exact duplicate evidence records may deduplicate. The
   same evidence key with conflicting payload/source hash rejects rather than
   “last wins”.
5. Item order is path, then kind, then symbolId where present. Use
   locale-independent JavaScript ordinal comparison (UTF-16 code-unit order,
   matching neighboring JS helpers), never localeCompare. All
   reason/role/rule/ref sets use the same defined comparator. Do not claim
   this changes frozen Python v1 ordering.
6. Origins order by originPath, then minimumDistance, then witness
   reference. Distances are observed per-origin file hops; do not discard
   origin attribution when aggregating one path.
7. Requested test candidates union the `affected_test_candidate` role into
   the same path item. A WRITE test remains WRITE; it is not repeated in
   WATCH. Candidate provenance is retained and still not a test result.
8. Less evidence cannot make the result more complete, erase a known
   limitation, or create stronger write/permission claims. Truncation cannot
   produce available or no-conflict.
9. No mutation of inputs. Equivalent canonical data gives byte-identical
   output. No clocks, random selection, graph-wide locks, or analyzer
   execution.

## I. Impact v2 mapping

**DECISION I:** Consume only retained, versioned Impact v2 evidence; do not
promote relationship labels into proofs they do not carry. Map only real
fields. Partial, unsupported, unavailable, and `not_evaluated` never prove
safety.

| Actual source | v2 mapping | Explicit limit |
|---|---|---|
| Context task paths plus Impact originPath OR targets[].originPath | Validate the exact explicit origin set; classify explicit intent as WRITE only in classification-bearing results | Impact origins themselves do not grant mutation permission or imply file existence. |
| affectedFiles[].path, origins[].originPath | Preserve target and each retained attribution | No origin without its retained witness. |
| origins[].minimumDistance | Observed reverse-impact file-hop distance used by F/H awareness rules | Not semantic strength; same-file relationships consume no file hop; retained minimum is not a guarantee about all omitted paths. |
| origins[].witness.relationshipKind | Copy imports, uses, references with capability/provider/trust/basis | Current traversal only admits these three relation kinds. No implements/override/signature/schema dependency proof is present. |
| origins[].witness | Keep id, provider id/version, capability, source path/hash, location\|null, trust and basis | A witness is a retained edge, not the complete transitive path or symbol endpoints. Do not invent a call chain, symbol ID or source range. |
| affectedTests.candidates | When explicitly requested, add candidate role and WATCH unless WRITE wins | Candidate projection must match its qualifying retained affected file, including origins and originSummary. Extra/mismatching candidate evidence rejects. Candidates are heuristic. |
| provider and coverage | Preserve the selected provider and observed/covered/uncovered languages | One selected graph only; no graph federation or treating Python definitions as dependency edges. Context and Impact provider id/version and snapshot bindings must agree for this slice. |
| observation and completeness | Carry source/provider/traversal/output limitations and per-target/test evaluation states | Partial, unsupported, unavailable, not_evaluated and empty arrays never prove safety. |
| limits, originSummary, attributionTruncated | Report inherited bounds and omission evidence | No whole-graph completeness or hidden exact omitted count. If a retained item's attribution is truncated, conservatively keep it WATCH rather than demoting it to informational IMPACT on incomplete distance attribution. |

Initial mapping order:

1. Validate inputs, exact origins, revisions and snapshot consistency. A
   malformed record rejects; do not silently skip it like an untrusted
   optional comment.
2. Build explicit WRITE items without expanding them.
3. For usable retained affected items, classify requested tests,
   truncated-attribution items, and all high/unknown-semantics items as
   WATCH; otherwise distance 1–2 => WATCH and distance greater than 2 =>
   IMPACT. A distance-zero item can only refer back to an explicit origin
   file in the initial file model and is absorbed by WRITE; an inconsistent
   non-origin zero-distance file rejects.
4. RESERVED remains explicitly `not_evaluated`; no heuristic fallback to
   reservation.
5. Union roles/evidence; normalize disjoint categories; propagate every
   source limitation. If aggregate evidence exists but one origin is
   `not_evaluated`, return incomplete with that origin's state visible.

Not proven by this mapping: universal strong coupling, behavioral/signature
compatibility, test coverage, runtime permission, conflict-free execution,
safe merge, exhaustive consumer lists, or a lock over affected files.

## J. Revision / staleness

**DECISION J:** A scope is bound to one project, repository, worktree,
revision and bounded source observation; it is never an everlasting or live
permission.

Required evaluated binding is projectId + selected locator + opaque
repositoryId + opaque worktreeId + commitSha + explicit branch|null + dirty
false + isLinkedWorktree true. Compare Context `repositoryIdentity` to
Impact `repositoryId` without changing the producers. Repository/worktree
IDs are namespace-local opaque observations, not portable global hashes to
derive in a caller.

Composition requires Context `analysis.snapshotToken` to equal Impact
`snapshotToken`. Retain `contextPackId` and Context `sourceDigest`
separately; those are different artifacts and are not compared to each
other. If the two producers observed different source sets/revisions/tokens,
reject the mixed bundle and reacquire coherent evidence. A provider
id/version mismatch also rejects mixing in this first policy; no automatic
“best of both” union.

At composition, `stale.state` is `bound`, `checkedAgainst` is
`supplied_expected_revision`, and `requiresReobservation` is true. “Bound”
means consistent with supplied data, not a live check performed by the pure
resolver. A caller must not assert it checked the live filesystem by calling
this function.

Invalidate/recompute on any commit, branch/detached, dirty,
worktree/repository identity, locator/project binding, source hash/token,
explicit target/symbol/declaration, provider observation,
workspace/constraint evidence, policyVersion, or analysis/schema version
change. First policy is deliberately stricter than “changed relevant nodes
only”: any changed revision binding invalidates; no Git-diff relevance
exemption. Changing limits/includeTests produces a new result, never mutates
a stored one.

When current observation differs from internally coherent evidence in the
same identity, return stale and require recomputation. If identity crosses
projects/repositories/worktrees, reject consumption outright. A
stale/not_evaluated/rejected scope cannot be used as current conflict or
enforcement input. Incomplete data may be shown as incomplete evidence,
never used as proof of non-conflict. If there is no fresh observation, do
not claim continued freshness; reacquire Context → Impact before
consequential downstream consumption.

Dirty/null/unborn/non-Git support is not enabled by agreement on bad values.
Do not stash, commit, clean or reset to make evidence admissible.
Dirty-content fingerprints remain deferred. Bounded digests/reobservation
are not atomic snapshots and do not close the after-check mutation race;
future runtime enforcement must retain that limitation.

## K. Lifecycle ownership

**DECISION K:** Hermes owns task/run/Kanban lifecycle; Nexus owns the
meaning of a derived scope snapshot. The first slice is pure and
nonpersistent.

Keep three planes distinct:

- Scope snapshot state: derived result, validity, missing evidence, staleness.
- Hermes task state: todo/running/blocked/review/done, claims, dependencies,
  retries, worker/worktree ownership.
- Future Guard state: operation checks and any separately approved
  enforcement mechanism.

No second task DB, active-scope registry, scheduler, worktree manager,
heartbeat/lease service, automatic card creation or dispatcher callback is
introduced. The historical PROPOSED → RESOLVED → ACTIVE → STALE/RELEASED
scope sketch is not implemented as a rival state machine. First-slice output
exists only in memory; serialization for callers/tests is not active
persistence. This is a pure revision-bound snapshot.

## L. Step 4 versus Step 5

**DECISION L:** Step 4 consumes ONE task and ONE revision/worktree binding;
Step 5 compares TWO or more independently bound task scopes.

Step 4 emits classifications, their evidence, limits and validity. It does
not take current active tasks as an input, evaluate pairwise overlaps,
decide severity, return conflict/reasons/recommendedAction for task pairs,
or schedule waiting. Those belong to Roadmap Step 5 and Hermes lifecycle
policy. The historical resolver evidence list including “current task
scopes” is not adopted into the one-task v2 foundation.

The two existing Python intersection functions are v1
observation/characterization. `emptyIsNotNoConflict: true` is meaningful.
They have no conflict decision, severity, compatibility model, scheduler, or
enforcement; they do not become the Conflict Engine because their names
involve intersections. Their v1 validation gates remain unchanged and cannot
consume v2 by pretending it has only two labels. v1 intersections are
characterization, not the Conflict Engine.

## M. Step 4 versus Step 6

**DECISION M:** Step 4 supplies evidence metadata only; Step 6 owns runtime
integration/enforcement through Hermes, subject to a proven host capability
and separate authorization.

Step 4 does **not** implement `pre_tool_call`, shell mutation interception,
operation ALLOW/BLOCK/REQUIRE_REPLAN, locks, leases, final-diff enforcement,
mutation interception, or Guard. A metadata field that says “scope is stale”
is not a runtime REQUIRE_REPLAN command. No new tool, route, manifest name,
`scope_enabled` default, SOUL automatic invocation or runtime hook is
authorized here.

The historical planned enforcement documents describe a target, not evidence
that the installed Hermes hook exists or fails closed. CURRENT_STATUS
records the hook gap. This contract neither selects a Hermes implementation
mechanism nor closes that gap.

## Risk entry

```
G1 = REJECTED
R1 = OPEN / DEFERRED
R2 = OPEN / DEFERRED
```

Disposition:

- `STEP4_CORE_DEV_ALLOWED_WITH_EXISTING_DEFERRED_RISKS`
- `RUNTIME_EXPOSURE_REQUIRES_SEPARATE_RISK_GATE`

The first statement is a technical architectural disposition for a later
explicitly authorized implementation card. It does not authorize coding or
adopting v2 at runtime in this documentation task.

Rationale: R1 concerns pending HTTPX worker cleanup timing; R2 concerns
missing lifecycle/resource evidence. Known issues retain those findings and
HIGH severity / LOW non-blocking development priority under the existing
adoption scope. An isolated deterministic domain module, unit/property
tests, and no production call sites do not add HTTP calls, change transport
ownership, broaden trust/exposure, or introduce lifecycle behavior. No
repository evidence forces the pure foundation to wait for an R1/R2 fix.

A new endpoint, tool exposure, plugin adoption, automatic Hermes use, active
coordination, background/gateway/cron integration, or enforcement is a
separate material scope/runtime change and requires coordinator/operator
risk reassessment before that slice. Existing two-tool approval and gated v1
exposure do not preapprove v2. If an actual lifecycle symptom appears, stop
affected calls and escalate under the existing rules. Neither green tests
nor a successfully prepared document closes G1/R1/R2.

No risk fix, new transport, process isolation, service restart, profile
recopy, rollout, or risk-closure card is part of this contract.

## First slice (SPECIFIED_NOT_STARTED)

### Goal and bounded scope

Deliver a pure, file-target-only v2 domain foundation that validates
coherent existing Context/Impact evidence, resolves explicit change
semantics, and deterministically emits WRITE/WATCH/IMPACT plus an explicit
unsupported RESERVED evaluation. It establishes the four-category model
without inventing coupling evidence. This is meaningful foundational code,
not a claim to finish all of Roadmap Step 4.

No HTTP/service integration, no runtime caller, no persistence, no live
deploy. Existing Context/Impact/v1 code is not rewritten or migrated.

### Expected files/modules

PROPOSED additions only:

1. `src/lib/effective-task-scope-policy.js` — constants/strict request and
   evidence validation, revision mapping, pure path-based semantics rules,
   fixed bounds and closed reason vocabulary.
2. `src/lib/effective-task-scope.js` — named export
   `composeEffectiveTaskScope(request, evidence)`; deterministic composition
   of the model specified in E–J.
3. `tests/effective-task-scope-policy.test.js` — input/version/binding/path/
   semantics/bounds tests.
4. `tests/effective-task-scope.test.js` — classification examples, evidence
   preservation, no-IO/immutability/determinism and invariant tests, with
   inline explicitly labelled data fixtures.

No edits to `integrations/hermes-nexus/`, routes, live-service modules,
scripts, manifests or dependencies. Do not move frozen v1 to Node or
duplicate v2 in Python. No generic rules framework or plugin architecture is
needed for this slice.

### Input and output

Use E's strict internal call shape; require explicit file paths, task
identity, persisted project identity, selected worktree, truthful expected
revision, explicit includeTests, accepted inner task-context-v1 and
impact-v2 data. Optional changeSemantics contains category only. First slice
supports symbols absent/empty only; nonempty symbol requests return the
documented terminal `not_evaluated` result. No new strong-coupling input,
diff parser, or analyzer request controls are admitted.

Use G's `schemaVersion: 2`, `analysisVersion: "effective-task-scope-v2"`,
`policyVersion: "step4-foundation-1"` output. New category containers cannot
be confused with v1 arrays/exhaustive flags. Reserved `not_evaluated` means
the classification-bearing top-level result is incomplete. Full available is
not attainable in this foundation, intentionally. Tests must enforce this
rather than fabricate a coupling producer to obtain an available fixture.

Request ownership is separate from evidence: source/snapshot/provider
metadata is validated, not taken as editable request policy. Current
provider evidence remains single-provider and may be partial. Dirty
observations remain rejected for evaluation without any Git repair.

### Limits/bounds (new v2 policy, not changes to upstream contracts)

- Requested paths: 1–32; symbols: at most 8 syntactically, but nonempty
  unsupported in this slice; limits checked before deduplication.
- Path/locator strings: at most 1024 characters; task id 128; title 200;
  symbol name 128; branch 512. IDs follow E's exact patterns.
- Accepted inner Context Pack compact bytes: at most 131072; accepted inner
  ImpactResult compact bytes: at most 131072. Preserve and validate their
  reported limits and section/item maxima against the existing contracts; do
  not admit oversized arrays merely because strings are short.
- Complete request-plus-evidence compact input ceiling: 327680 UTF-8 bytes.
  Data must be bounded JSON-compatible records, without cycles, callable
  values or accessor-backed fields. Validation walks are bounded (maximum
  nesting 32 and visited JSON values 20000), avoiding unbounded recursive
  normalization before budget checking.
- At most 320 distinct classified file targets and 1024 retained
  origin/witness references; upstream affectedFiles/affectedTests/
  originWitnessRecords limits also apply. At most 128 resolver reason
  records. Input duplication cannot circumvent pre-deduplication limits.
- `request.limits.compactBytes`: default 65536, maximum 131072, finite safe
  positive integer; no coercion/clamping. Other v2 limit overrides are not
  admitted in the first slice.
- Output preserves whole records and the evidence they require. First-slice
  simplicity: if the canonical result cannot fit the requested budget or
  fixed entry bounds, return rejected / `scope_budget_exceeded` rather than
  trimming WRITE, evidence or known incompleteness. No partial object,
  dangling evidence reference, backfill, hidden omission or
  success-at-any-cost envelope.
- Inherited producer omissions remain explicit even when the v2 projection
  itself is untruncated. The resolver performs no traversal and therefore
  has no fake traversal count/depth of its own; report Impact's inherited
  depth/work limits.
- A tiny requested output budget that cannot hold a fixed rejection envelope
  produces a bounded domain error `scope_budget_exceeded` rather than
  violating the budget. No transport/HTTP status is specified by this
  internal slice.

### Invariants and change semantics

Implement F/H/I exactly: no automatic WRITE expansion; ordinal deterministic
deduplication; disjoint file categories; witnessed origins preserved; no
promotions from generic references to RESERVED; unknown semantics explicit
and conservative; candidate roles unioned; no confidence scalar; incomplete
never becomes safety. Accepted partial multi-target evidence must remain
per-target partial, including when its aggregate finding is
`evidence_found`.

Paths are literal. Current functions may normalize equivalent path spelling,
but v2 rejects spelling changes at its boundary rather than silently
repairing a different pathname. Future support for directory expansion,
create/delete/rename semantics or symbols is an explicitly scoped later
change, not an incidental implementation choice.

### Stale behavior

No IO, clock, re-observation loop, watcher or active store. Compare the
supplied current revision with evidence; detect coherent-old versus mixed
evidence as J specifies. Mark consistent results bound with
`requiresReobservation` true. Do not call unchanged data “fresh now”.
Reacquisition is the later caller's responsibility, not a hidden service
call in the domain function.

### Required tests

Contract/unit tests:

- strict keys/types/versions; truthfully missing/dirty/unavailable
  observations; branch null versus omission; malformed commit/opaque IDs;
  missing canonical repository fields; alias conflicts;
  cross-project/locator/repository/worktree mismatch;
- same SHA in a different worktree rejected; coherent old revision versus
  mixed pack/impact binding; equal source tokens required, source hash
  conflicts rejected; isGit null not silently changed;
- Context task identity/title/path/symbol echo mismatch; single- and
  multi-target origin forms; invalid path spellings/traversal/URI/glob/
  absolute paths; empty/over-limit inputs; directory/new-file evidence not
  magically observed;
- declared/inferred precedence for all seven semantic categories;
  contradictory low-impact declarations; mixed paths; explicit unknown; no
  LLM or prose authority;
- WRITE is exactly explicit file intent; generic imports/uses/references
  never RESERVED; direct and distance-2 WATCH; farther IMPACT only for known
  lower categories; public/interface/schema/unknown retains observed paths
  in WATCH;
- requested test candidate with dual role; test also in WRITE; false versus
  omitted includeTests; true/not_requested mismatch; partial requested test
  evidence; candidate origins exactly match affected-file projection;
- per-origin/per-target evidence, witness provider/source/nullable location,
  truncation and unsupported language propagation; aggregate
  `evidence_found` with a target `not_evaluated`; global
  unsupported/unavailable/not_evaluated produces no usable classification;
- reserved empty/`not_evaluated` plus top-level incomplete; no available
  full-scope foundation result; no safety, conflict, runtime permission or
  confidence fields;
- byte/count/string/depth limits, multibyte UTF-8 output, equality boundary
  and overflow, whole-envelope refusal, bounded sanitized errors;
- evidence de-duplication versus conflicting evidence collision;
  deterministic canonical ordering including non-ASCII; input immutability,
  no clock/network/fs/Git/provider/Hermes calls.

Property/invariant tests using deterministic generated fixtures and Node's
existing runner, no new library:

- permutations of logically equivalent canonical input sets produce
  identical serialized output;
- duplicate explicit paths/roles/evidence do not produce duplicate targets
  or origins, but over-limit raw duplicates still reject;
- output category intersections are empty for the file-only slice;
  referenced evidence always exists;
- reducing available evidence/truncating attribution never increases
  completeness or WRITE, and never emits RESERVED without supported proof;
- substituting any enclosing project/repository/worktree binding cannot
  preserve an accepted result;
- all outputs respect measured compact bytes or return the fixed domain
  refusal; no input mutations after success or failure.

Compatibility: run the unchanged v1 composer, write-write and write-watch
tests. Add tests showing a v2-shaped scope is not handed off to those
consumers or disguised as v1. Existing two-tool exposure and gated v1
behavior remain unchanged by construction: no integration file is in the
slice.

Future verification commands for an implementation worker (not executed by
this documentation task): `node --test tests/effective-task-scope-policy.test.js
tests/effective-task-scope.test.js`; explicit `node --check` on both new JS
files; `npm test`; `npm run check`; unchanged focused Python v1 tests;
`git diff --check`. Do not claim those future tests were executed here.

### Non-goals and risk gate

No nonempty RESERVED producer, semantic compatibility proof, arbitrary
policy engine, complete symbol resolver, diff analysis, new endpoint/tool,
Python v2, Hermes automatic use, active persistence/coordination, Step 5
conflict detection, Step 6 Guard, R1/R2 work, installed plugin changes,
service changes or rollout.

Gate: `STEP4_CORE_DEV_ALLOWED_WITH_EXISTING_DEFERRED_RISKS`; an explicitly
scoped implementation authorization and independent technical review are
still required. Any request to wire it into a runtime entry point stops this
slice and invokes `RUNTIME_EXPOSURE_REQUIRES_SEPARATE_RISK_GATE`.

### Profile/worktree and rollback

Proposed execution profile: implementer. Tester/reviewer may independently
verify through coordinator-managed later work. No model/provider selection.

A workspace-manager/coordinator must provision one dedicated writer worktree
and branch at an explicitly selected base after this decision's independent
review. No writer path/card/branch is created or assigned by this document.

Removal is simple: the foundation is isolated additions with test-only
imports and no application registration, data migration, persistence or
active callers. Removing/reverting those additions restores the prior
capability surface; v1 remains untouched. Any discovered production call
site invalidates this rollback claim and exceeds the slice.

### Acceptance criteria

1. Independent review accepts the E–J DTO/rules against this pinned
   baseline; authorization is scoped to the additions above.
2. A real pure domain result—not a stub—implements the supported file
   mapping and all terminal/incomplete outcomes, backed by the required
   focused and invariant tests.
3. Every nontrivial classification has retained evidence and a rule ID; no
   fabricated coupling/provider/snapshot/test fact.
4. Fixed bounds and deterministic serialization are verified; no
   mutation/IO/hidden side effects or upstream schema changes.
5. Existing v1 behavior/consumers and Impact/Context contracts remain intact;
   no endpoint/tool/config/profile/manifests change.
6. Full suite/check and explicit new-file syntax checks are recorded at the
   implementation SHA, plus independent review.
7. Handoff states “foundation implemented” if that later slice passes, not
   “Step 4 complete”; RESERVED/symbol/runtime limitations remain visible.
8. G1 REJECTED and R1/R2 OPEN / DEFERRED are preserved. Runtime exposure
   cannot piggyback on core acceptance.

## Open questions

None requiring a material product/architecture decision for this first
slice. Nonempty RESERVED evidence, complete symbol support and runtime
exposure are deliberately excluded capabilities with explicit
prerequisites, not choices left for an implementer to invent. A future
expansion must specify and review its evidence contract before coding.

## Non-goals of this documentation contract

- Implement Step 4, 5 or 6.
- Change repository production code, manifests, `provides_tools`, or
  `scope_enabled`.
- Close G1/R1/R2, unblock cards, or treat this page as runtime exposure.
- Treat bounded/partial evidence, a passing baseline test, a target
  document, a successful tool call or a candidate test list as
  authorization, safety, implementation, or deployment proof.
