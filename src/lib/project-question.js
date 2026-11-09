import { readProjectFileHistory } from "./project-file-history.js";
import { buildProjectImpact } from "./project-impact-service.js";
import { locateProjectSymbol } from "./project-symbol-location.js";

// The answer is a projection of a single fresh producer response, so all citations refer to one observation.
export function answerProjectQuestion({ projectId, question, subject, worktree }, options = {}) {
  if (question === "symbol") {
    const result = locateProjectSymbol({ projectId, symbol: subject, worktree }, options);
    const count = result.evidence.length;
    const answer = count
      ? `Found ${count} exact symbol observation(s) for ${subject}.`
      : `The current Context Pack returned no exact match for ${subject}.`;
    return { ...result, question, answer };
  }
  if (question === "history") {
    const result = readProjectFileHistory({ projectId, path: subject, ...(worktree ? { worktree } : {}) }, options);
    const answer = result.evidence.length
      ? `Found ${result.evidence.length} committed change(s) to ${subject} in the examined history.`
      : `No change to ${subject} was observed in the examined history.`;
    return { ...result, question, answer };
  }
  if (!["tests", "impact"].includes(question)) {
    throw Object.assign(new Error("Unknown project question."), { code: "invalid_question" });
  }

  const tests = question === "tests";
  const impact = buildProjectImpact(projectId, { paths: [subject], includeTests: tests, ...(worktree ? { worktree } : {}) }, options);
  const evidence = tests ? impact.affectedTests.candidates : impact.affectedFiles;
  const kind = tests ? "candidate test" : "affected file";
  const answer = evidence.length
    ? `Impact returned ${evidence.length} ${kind}(s) for ${impact.originPath}.`
    : `Impact returned no ${kind}s for ${impact.originPath} in this observation.`;
  return {
    schemaVersion: 1, question, answer, projectId, project: impact.project, revision: impact.revision,
    snapshotToken: impact.snapshotToken, originPath: impact.originPath, observation: impact.observation,
    status: impact.status, findingState: impact.findingState, completeness: impact.completeness,
    provider: impact.provider, coverage: impact.coverage, limits: impact.limits,
    ...(tests ? { testStatus: impact.affectedTests.status } : {}), evidence
  };
}
