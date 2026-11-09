import path from "node:path";
import { parseArgs } from "node:util";

const usage = "node scripts/ask-project.mjs --project-id ID (--symbol NAME | --tests-for PATH | --impact-of PATH | --history-of PATH) [--worktree DIR [--root-id ID]]";
try {
  const { values } = parseArgs({ options: {
    "project-id": { type: "string" }, symbol: { type: "string" },
    "tests-for": { type: "string" }, "impact-of": { type: "string" }, "history-of": { type: "string" },
    worktree: { type: "string" }, "root-id": { type: "string" }, help: { type: "boolean" }
  } });
  const selectors = ["symbol", "tests-for", "impact-of", "history-of"].filter((key) => values[key] !== undefined);
  if (values.help) {
    console.log(usage);
  } else if (!values["project-id"] || selectors.length !== 1 || !values[selectors[0]] || (values["root-id"] !== undefined && !values.worktree)) {
    throw Object.assign(new Error(), { code: "invalid_arguments" });
  } else {
    const { answerProjectQuestion } = await import("../src/lib/project-question.js");
    const { resolveProjectConfig } = await import("../src/lib/project-config.js");
    const { getConfiguredProjectRoots } = await import("../src/lib/project-roots.js");
    const config = resolveProjectConfig();
    const registry = { roots: getConfiguredProjectRoots(),
      manualProjectsFile: path.join(config.dataDir, "projects.json"),
      discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json") };
    const worktree = values.worktree !== undefined ? { relativePath: values.worktree, rootId: values["root-id"] ?? "default" } : undefined;
    const selector = selectors[0];
    const question = { symbol: "symbol", "impact-of": "impact", "tests-for": "tests", "history-of": "history" }[selector];
    const result = answerProjectQuestion({ projectId: values["project-id"], question, subject: values[selector], worktree },
      { registry, ...(config.serenaPythonImage ? { analyzer: { serena: { image: config.serenaPythonImage } } } : {}) });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  // Some dependency errors include repository paths. Return only a bounded machine-readable code.
  const code = typeof error.code === "string" && /^[a-z_]{1,80}$/.test(error.code)
    ? error.code : error.code?.startsWith("ERR_PARSE_ARGS") ? "invalid_arguments" : "project_question_failed";
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 1;
}
