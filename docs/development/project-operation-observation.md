# Observe file and directory moves or expand a directory

The read-only operator produces a bounded manifest for a file or directory rename, a move, or an
explicit directory expansion on a clean linked Git worktree. Its output identifies files and content hashes.
The existing ETS HTTP request and response formats are unchanged.

Use the Nexus registry environment (`DATA_DIR`, `PROJECTS_ROOTS`) and write the request outside the
checkout being examined. The following request describes a proposed cross-directory move.

```json
{
  "projectId": "PrJ_Fixture",
  "worktree": { "rootId": "work", "relativePath": "linked" },
  "task": { "id": "extract-parser", "title": "Move the parser into src/parsing" },
  "operation": { "kind": "move", "oldPath": "src/parser.ts", "newPath": "src/parsing/parser.ts" }
}
```

```sh
node scripts/observe-project-operation.mjs < request.json
```

Use `"kind": "rename"` with the same fields for a rename, or replace `operation` with
`{"kind":"expand_directory","path":"src/parsing"}` to enumerate an existing directory. Paths
are exact, project-relative, explicitly selected names. A file move requires the destination parent
to exist. Both source passes require the existing create classifier to establish destination absence
on the same snapshot. The manifest binds the selected regular source's relative path, byte length,
file mode, SHA-256 and committed
Git blob ID. Source and destination must use distinct names under the create witness's name policy.

For directory expansion the operator walks every entry twice from verified directory descriptors,
sorts the results and compares them to the Git tree at the observed commit. It verifies each file
against both the committed blob and the project's descriptor-verified bounded source snapshot.
The directory list includes the selected root and the visited subdirectories. An ignored/untracked
file, empty directory, special file, symlink, nested repository, registered child project, mount
boundary, unreadable member or unrepresented source causes refusal of the entire manifest. The
operator checks for registered child paths even when they are missing in one checkout. It never
returns a partial set as a complete expansion.

## Transfer a whole directory

For example, use the following operation in the same request envelope to move `src/parsing` under
an existing `modules` directory. Use `rename_directory` for a directory rename.

```json
{ "kind": "move_directory", "oldPath": "src/parsing", "newPath": "modules/parsing" }
```

The entire source directory must pass the expansion checks. Neither root may be equal to, below,
or above the other under the portable name rules. Registered child projects below either root
are reserved even if their paths do not exist in the current checkout. Every mapped member must
have a representable, bounded destination path outside protected names.

The producer checks the proposed destination root before and after the two source observations.
Each check runs the directory-entry absence witness against the same revision and snapshot.
The parent directory must exist. Both validated witnesses must report absence and have the same
digest, including the parent listing evidence. A changed parent witness yields
`operation_destination_changed`, even if the name is still free. The public manifest exposes the
digest and verdict. Parent directory listings stay internal.

`mapping.directories` pairs each directory with its proposed new path, including the selected root.
`mapping.files` pairs each regular file with its proposed path, byte length and SHA-256. The digest
and bytes describe the verified **source** content for the proposed unchanged transfer. The
destination is absent, so the report includes no observed destination bytes. A stale commit, stale
evidence digest or any unavailable member refuses the whole proposal.

## Bounds and re-observation

The ceiling is 32 files, 256 directory entries and eight levels below the requested directory.
Individual files are capped at 128 KiB. Verification of a selected path segment stops at 1,024
siblings. The project collector's existing global limits also apply. The operator uses Linux
descriptor checks, Unicode 17.0 and the same admitted filesystem types as the create witness.
Filter helpers, unsupported index states and Git submodules are refused by the existing Git preflight.
A checkout with line-ending conversions that change the committed bytes cannot yield a complete manifest.

The report's `evidenceDigest` is SHA-256 over its compact UTF-8 JSON before the digest field is
appended. To require the same evidence on a subsequent read, pass this digest in
`expectedEvidenceDigest`. Use `expectedCommitSha` to require the same Git commit. Re-observation
resolves the registry and computes the inputs anew. A successful report goes to standard output. A refusal writes an
error code to standard error, exits 1 and emits no manifest. Common refusals are
`operation_stale`, `operation_name_collision`, `operation_destination_not_proven_absent`,
`operation_directory_boundary`, `operation_source_not_bound`, and `operation_tree_limit`.

The digest checks the integrity of the report. File and directory observations are bracketed reads
and describe a point in time. Hermes owns subsequent execution decisions.
