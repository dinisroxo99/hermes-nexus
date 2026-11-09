# Compare two task scopes

`POST /api/intelligence/projects/:projectId/task-conflicts` compares two proposed task intents against
fresh project evidence. Its response identifies observed file overlaps and which tasks produced them.
A single request can compare two tasks planned against one linked checkout, or explicit writes made
against sibling worktrees of the same project at the same commit.

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

Each result orders the task IDs and the categories deterministically. A shared binding identifies
one project, its revision and a snapshot token. For siblings the response retains both bindings
and reports only WRITE/WRITE paths with matching SHA-256 target evidence. Distinct commits, dirty
worktrees, stale observations and disjoint siblings cannot establish a shared-write result. An
incomplete scope can still yield a positive overlap. Empty partial evidence gives no clearance to
schedule tasks. The service returns at most 16 paths, highest severity first, plus the total and
a truncation flag. Task scheduling and tool permissions belong to Hermes.

## Repository example

In a disposable registered clone of Hermes Nexus at `8f8aa98d1793b4270bdfcd1515f09bf8f0380791`,
two task IDs targeted `src/lib/effective-task-scope-policy.js` in the same clean linked worktree.
The comparison reported a high-severity WRITE/WRITE overlap there and an informational WATCH/WATCH
overlap in `src/lib/effective-task-scope-adapter.js`. Its overall status was `incomplete`: the
Context Pack and Impact both reported incomplete coverage, and RESERVED remained incomplete.
