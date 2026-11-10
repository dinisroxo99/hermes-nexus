// Build the same public producer outputs used by the Nexus service in the disposable benchmark registry.
import fs from "node:fs";
import path from "node:path";
import { buildProjectTaskContext } from "../../src/lib/task-context.js";
import { buildProjectImpact } from "../../src/lib/project-impact-service.js";

const { root, revision, cases } = JSON.parse(fs.readFileSync(0, "utf8"));
const registry = { roots: [{ id: "bench", path: root }], manualProjectsFile: path.join(root, "projects.json"),
  discoveredProjectsFile: path.join(root, "discovered-projects.json") };
for (const example of cases) {
  const task = { id: example.id, title: example.title, paths: [example.target] };
  const pack = buildProjectTaskContext({ projectId: "PrJ_Bench", task }, { registry });
  const impact = buildProjectImpact("PrJ_Bench", { paths: task.paths, includeTests: true }, { registry });
  if ([pack, impact].some((result) => result.revision.commitSha !== revision || result.revision.dirty !== false)) {
    throw new Error("benchmark_revision_mismatch");
  }
  const evidence = {
    projectId: pack.projectId, revision, provider: pack.analysis.provider,
    symbols: pack.sections.symbols.items.map(({ name, path }) => ({ name, path })),
    affected: impact.affectedFiles.map((file) => file.path),
    testCandidates: impact.affectedTests.candidates.map((file) => file.path),
    finding: impact.findingState, status: impact.status,
    sourceIncomplete: pack.observation.incomplete || impact.observation.incomplete
  };
  process.stdout.write(JSON.stringify({ id: example.id, evidence }) + "\n");
}
