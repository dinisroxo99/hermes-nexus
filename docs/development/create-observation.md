# Observe proposed file creation

Run `scripts/observe-project-create.mjs` to ask whether a registered project's clean linked
worktree has enough evidence to classify proposed files as explicit create targets. The CLI
prints a point-in-time observation and the Effective Task Scope result. It only reads the checkout.

## Run

Use the same `DATA_DIR` and `PROJECTS_ROOTS` environment settings as the Nexus service. The
project ID must already be registered. The locator identifies a linked worktree of that project
under a configured root. For example, save this request as `create-request.json` outside the
worktree you want to observe.

```json
{
  "projectId": "PrJ_Fixture",
  "worktree": { "rootId": "work", "relativePath": "linked" },
  "task": {
    "id": "add-parser",
    "title": "Add the parser and its tests",
    "paths": ["src/parser.ts", "tests/parser.test.ts"]
  }
}
```

```sh
node scripts/observe-project-create.mjs < create-request.json
```

Optionally supply the full commit SHA as `expectedCommitSha` to require the worktree to match
that commit. A mismatch produces `create_observation_stale`. The operator supplies target paths
and a locator. Nexus obtains the repository and worktree identifiers from its revision reader,
and obtains the snapshot token from its freshly built Context Pack. Request fields for identities,
witnesses, filesystem policy or test seams are rejected. Input is limited to 65,536 bytes and 32 paths.

## Interpret the result

- `observations[]` gives the verdict, completeness and reason for each examined target. Parent
  directory listings stay internal. An empty array means the existing ETS gates provided the
  result without running the absence producer. See `scope.status` and `scope.reasons`.
- When every target is proven absent, `scope.write.items` identifies the declared paths,
  `scope.operationIntent.kind` is `create`, and `scope.status` is `incomplete`. WRITE classifies
  the task. The result gives no execution permission and reserves no path.
- A proposed path that names or traverses a registered child project fails before collection with
  `create_observation_nested_project_target`. This includes a child absent in one checkout and
  alternate spellings that collide under the witness name policy.
- Existing targets, unverified ancestors, changes during observation and
  incomplete Impact evidence can prevent classification. If one target lacks the required
  evidence, the batch receives no create WRITE items.
- Positive absence requires Unicode 17.0, Linux descriptor verification and a filesystem accepted
  by the [witness contract](../create-destination-absence-witness.md). An unsupported filesystem
  or Unicode version yields an unknown observation. The CLI keeps those policy checks intact.
- Successful evaluations, including refusals from the scope composer, produce JSON on standard
  output and exit 0. Invalid input, invalid locators and stale commit preconditions write an error
  code to standard error and exit 1.

The command rechecks the registered project, linked worktree, revision and nested project exclusions
after composing its result. The witness also re-observes revision and source tokens around its two
directory passes. A later filesystem change requires another observation. The existing ETS HTTP
route continues to use its own request contract.
