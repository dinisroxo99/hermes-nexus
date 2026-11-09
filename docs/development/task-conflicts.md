# Compare two task scopes

`POST /api/intelligence/projects/:projectId/task-conflicts` compares two proposed task intents against
fresh project evidence. Its response identifies observed file overlaps and which tasks produced them.
A single request can compare tasks planned on one clean linked checkout or on independently observed
sibling worktrees of the same registered project and repository. Each scope binds its own checkout
and commit. Sibling commits may differ.

## Request

Supply exactly `left` and `right`. Each value is a request for the existing
[effective-task-scope endpoint](../effective-task-scope-http-route.md). Use two different task IDs.
The route validates both requests before building either scope. It takes the project ID from the URL
and produces its own Context Packs, Impact observations and scope classifications.

For example, the following Bash example compares two proposed changes to the same file on a clean
linked worktree. Set the project ID, root, relative checkout and target to values in your registry.

```bash
url='http://127.0.0.1:8770/api/intelligence/projects/PrJ_Example'
locator='{"rootId":"dev","relativePath":"checkout-feature"}'
target='src/orders.ts'

pack=$(jq -n --argjson tree "$locator" '{task:{title:"Observe revision"},worktree:$tree}' |
  curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary @- "$url/task-context")
rev=$(jq -ce '.data.revision | select(.status == "available" and .isLinkedWorktree and .dirty == false)
  | {status,commitSha,branch,dirty,isLinkedWorktree,repositoryId:.repositoryIdentity,worktreeId}' <<<"$pack")
jq -n --argjson rev "$rev" --argjson tree "$locator" --arg path "$target" '
  def intent($id): {task:{id:$id,title:$id,paths:[$path]},worktree:$tree,expectedRevision:$rev,
                    includeTests:true,changeSemantics:{category:"local_implementation"}};
  {left:intent("fix-order"),right:intent("refactor-order")}' |
  curl --fail-with-body -sS -H 'Content-Type: application/json' --data-binary @- "$url/task-conflicts"
```

Use the registered link's own locator and separately observed revision for each side of a sibling
comparison. When the registered project is already the selected checkout, omit the worktree locator
from the Context Pack lookup and include its registered locator in the two scope requests.

## Reading the evidence

| Same-snapshot overlap | Severity | Interpretation |
| --- | --- | --- |
| WRITE with WRITE or RESERVED | high | Serialize or replan the overlapping work. |
| WRITE with WATCH | warning | Revalidate the dependency before combining the changes. |
| Other shared classifications | info | Inspect the cited path if relevant to the change. |

Each result orders the task IDs and category pairs deterministically. A shared binding identifies
a single observation. For siblings, `binding` is null and `scopeBindings` records the two separate
revisions and snapshot tokens. `dimensions` reports which of the file, dependency and declaration
comparisons produced evidence. A structural provider witness identifies a structural relation.
A semantic provider witness retains its provider identity, semantic basis and trust label.

### Comparing sibling worktrees

| Observed facts | Finding |
| --- | --- |
| Both tasks explicitly write the same path and both Impact observations retain identical file bytes | High severity, with the shared SHA-256. |
| Two distinct commits contain different observed bytes at a path both tasks explicitly write | Warning with `basis: "same_path_distinct_content"` and the two hashes in task order. Revalidate before merging. |
| A task writes a consumer that the other task classifies as WATCH | Warning when both snapshots independently show reverse impact from the same explicit origin and both endpoint hashes agree. |
| A task writes a file retained only as transitive IMPACT | Informational when both snapshots independently corroborate the attributed reachability. |
| No shared bytes or corroborating relationship is available | No cross-snapshot dependency is established. |

After constructing both sibling scopes the service re-observes each checkout. It checks the project,
locator, full revision identity and snapshot token. A changed binding yields HTTP 409
`impact_sources_changed`. Where dependency corroboration is needed, the same read queries the
other task's origin paths. A request performs at most two additional Impact observations.

For example, task A writes `src/one.ts` and task B writes `tests/one.test.ts`. When Impact
on A's snapshot finds that the test imports `one.ts`, the service queries Impact for the same
origin in B's checkout. It accepts the second observation only if the project, locator, commit,
worktree identity, snapshot token and requested origins match its binding. The consumer hash must
match B's explicit target and both observations must agree on the origin hash. A tsconfig change
that redirects an unchanged import to another file can therefore remove this finding. A dependency
record cites the origin, endpoint hashes, provider and witness IDs from each observation. The
distance is one for a direct edge. For larger distances Impact retains an attribution and the final
edge witness. The response does not reconstruct the intermediate graph.

If both tasks declare the same symbol, a WRITE/WRITE row can also report `declarations`. The
service reuses the declaration witness already accepted for each task's ETS, including its path,
unique name, source hash and snapshot-specific declaration ID. A shared-snapshot match requires
the same declaration ID. IDs on distinct snapshots are local to their snapshot, so the comparison
requires an independently witnessed unique declaration of that name in the same byte-identical
file. Two different declarations in the same file still produce a file-level WRITE overlap.

`revalidation.distinctCommits` reports whether the two compared revisions differ. Any such
result requires revalidation. Each finding describes those bounded observations only. No merge base,
future merged tree or scheduling authorization is inferred. Missing, partial or truncated evidence
cannot establish safety. The service retains up to 16 paths, highest severity first, plus the total
count and truncation flag. Task scheduling and tool permissions belong to Hermes.

The request and existing overlap fields are compatible with the first comparison API. The result
now identifies `task-conflict-comparison-v2` and adds `dimensions`, `revalidation`, and optional
dependency or declaration citations on positive overlap rows.

## Repository example

In a disposable registered clone of Hermes Nexus at `8f8aa98d1793b4270bdfcd1515f09bf8f0380791`,
two task IDs targeted `src/lib/effective-task-scope-policy.js` in the same clean linked worktree.
The comparison reported a high-severity WRITE/WRITE overlap there and an informational WATCH/WATCH
overlap in `src/lib/effective-task-scope-adapter.js`. Its overall status was `incomplete`: the
Context Pack and Impact both reported incomplete coverage, and RESERVED remained incomplete.
