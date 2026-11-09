# Audit a task's final Git changes

This offline CLI lists Git-visible changed paths in a linked worktree and compares them with the file WRITE set
that Nexus observed at the start of a task. It runs locally using the configured project registry and built-in
Context Pack, Impact and Effective Task Scope producers. Hermes retains authority over workers and enforcement.

## Capture before editing

Use a trusted Nexus checkout, configure `PROJECTS_ROOTS` and `DATA_DIR` as for the service, and identify the
registered parent project and a separate, Git-listed linked worktree under the configured root. The locator must
identify the top of that worktree. Run the command with an operator-controlled audit directory outside the worktree.

For example, a task JSON file can contain the following.

```json
{"id":"task-17","title":"Update the invoice parser","paths":["src/invoice.ts"]}
```

```bash
node scripts/audit-task-diff.mjs capture PrJ_Example dev linked-invoices \
  < /operator/audit/task.json > /operator/audit/task-17.json 2> /operator/audit/task-17.sha256
```

Check the exit status before using the receipt. Capture requires a clean worktree at a commit, a revision-bound
ETS with an available, untruncated WRITE category, matching Context Pack and Impact snapshot tokens, and an
Impact target source for each WRITE path whose bytes match the committed blob. Requests with absent targets or
symbol targets cannot produce this file-level receipt. Clean checkouts whose working files differ from their
blobs because of a checkout filter or line-ending conversion are outside this capture mode.

The digest on standard error covers the exact receipt bytes including their final newline. Keep the digest in a
trusted location beyond the worker's control. The fingerprint identifies the bytes that the operator captured.
Provenance depends on the operator retaining that independent pin.

## Compare before committing

```bash
node scripts/audit-task-diff.mjs compare PrJ_Example dev linked-invoices task-17 \
  "$(cat /operator/audit/task-17.sha256)" < /operator/audit/task-17.json
```

The command rechecks the registered project, linked-worktree locator, repository and worktree identities, branch,
commit and task ID. A new HEAD requires a new capture. The report lists every observed changed path as `in_write`
or `outside_write`. A rename contributes its old and new paths. Results appear on standard output.

| Exit | Meaning |
| --- | --- |
| 0 | The sampled Git status contained no path outside the captured WRITE set. |
| 2 | At least one observed path was outside the captured WRITE set. |
| 1 | No comparison was available. The error code appears on standard error. |

## Coverage

The comparison reads the staged, unstaged and untracked paths reported by Git, including deleted files.
A change that enters or leaves a separately registered child project ends the comparison with
`diff_nested_project_change`. It emits no paths. Both ends of renames, the linked and canonical locations
and declared child roots currently missing on disk are covered. A task targeting a protected child cannot
produce a baseline. The final sample rechecks the registry boundaries.

Before invoking revision helpers that run Git status, the CLI reads the effective Git config and index for both
checkouts. When executable filters are configured, it checks every tracked path against the working and indexed
Git attributes. An installed Git LFS driver that none of those attributes selects is compatible. An active driver
produces `diff_git_helpers_unsupported` before status can invoke it. The CLI also disables the inactive configured
drivers for its own status read. External diff commands, promisor repositories and submodule entries are outside
this audit mode. Configuration and attributes must remain under trusted, stable control during the operation.
Concurrent adversarial reconfiguration between checks falls outside this audit's guarantees.
Ordinary ignored files, previously reverted edits, past commits and non-filesystem actions are outside this observation. Git index entries marked
assume-unchanged or skip-worktree cause the command to return unavailable. A collapsed directory entry, an
unrepresentable pathname or an exceeded bound also returns unavailable.

Each status observation is limited to 64 KiB, the index and HEAD mode listings to 1 MiB each, the change set to 256 paths
and each pathname to 1,024 bytes. Paths containing control characters, Unicode formatting characters or Unicode line separators
make the observation unavailable. The JSON output is limited to 128 KiB. The command compares two observations of the revision and path status. These
samples can miss changes between observations. The result is evidence for a human reviewer or a Hermes integration.
Runtime confinement, authorisation and a history of past writes require separate evidence.
