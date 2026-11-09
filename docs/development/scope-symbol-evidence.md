# Symbol evidence in an effective task scope

The existing read-only ETS HTTP endpoint can classify a task that names both explicit files and
TypeScript or JavaScript declarations. Use the existing ETS request with the project's registered
worktree locator, expected revision, task ID, title, paths, names in `task.symbols`, and
`includeTests`. The caller supplies no witness.

The service keeps the bounded, descriptor-verified source collection that its Context Pack already
reads and verifies. For nonempty `task.symbols`, a preliminary ETS evaluation must reach the missing
symbol evidence gate on a clean linked worktree. The collection must be complete, the Pack and Impact
must both report available, complete observations, and the explicit target files must be present.
The service recomputes the **full** provider snapshot from that collection, including files outside
the task, and verifies that its token matches both Pack and Impact. The existing admitted declaration
producer examines only the requested paths and names. The producer reference is the PR #56 merge
`4741b82ce4dcc46451a82a1f1100d83a7693ffb6`. The analyzed project's own revision is a separate binding.

With unique declarations and complete evidence, the existing composer can emit file-level WRITE on
the explicit paths. A symbol in another file cannot add that file to WRITE. For missing, ambiguous,
unparseable or unbound evidence the operation returns a refusal with no WRITE. The exact code comes
from the existing evidence rules. In particular, the current Track A1 producer can omit a citation
snapshot token on multi-file ambiguity, which the composer reports as `symbol_target_binding_mismatch`.
The service never fills in a missing token. The response is a point-in-time classification and does
not authorize a write or reserve a path.

The request shape for ETS is unchanged. The service also uses this logic when building scopes for
comparison. No new Hermes tool, incoming witness field or filesystem scan is needed.
