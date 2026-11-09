import path from "node:path";
import { askProject } from "../lib/project-question.js";
import { resolveProjectConfig } from "../lib/project-config.js";
import { validateProjectId } from "../lib/project-registry.js";
import { getConfiguredProjectRoots } from "../lib/project-roots.js";
import { readJsonBody } from "../utils/request-body.js";
import { sendError, sendOk } from "../utils/response.js";

const QUESTIONS = ["symbol", "tests", "impact", "history", "validated-history"];
const FIELDS = ["question", "subject", "worktree", "taskId", "historyRevision", "includeHistory", "synthesize"];
const MISSING = ["project_unavailable", "project_not_found"];
const STALE = ["ambiguous_project", "project_identity_conflict", "worktree_parent_mismatch", "history_observation_changed",
  "context_sources_changed", "context_revision_changed", "context_project_changed", "impact_sources_changed",
  "impact_revision_changed", "impact_project_changed"];
const invalid = () => Object.assign(new Error("Invalid project question."), { code: "invalid_project_question" });

function normalizeQuestion(body, projectId) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((k) => !FIELDS.includes(k))
      || !QUESTIONS.includes(body.question)) throw invalid();
  for (const key of ["includeHistory", "synthesize"]) {
    if (Object.hasOwn(body, key) && typeof body[key] !== "boolean") throw invalid();
  }
  const historical = body.question === "validated-history";
  if (historical ? Object.hasOwn(body, "subject") : (typeof body.subject !== "string" || !body.subject || body.subject.length > 1024)) {
    throw invalid();
  }
  if (!historical && !body.includeHistory && (Object.hasOwn(body, "taskId") || Object.hasOwn(body, "historyRevision"))) throw invalid();
  const { includeHistory, synthesize, ...input } = body;
  return { input: { ...input, projectId }, includeHistory: Boolean(includeHistory), synthesize: Boolean(synthesize) };
}

export function createProjectQuestionHandler(dependencies = {}) {
  let synthesisBusy = false;
  return async (req, res, { projectId }) => {
    let reservedModel = false;
    try {
      validateProjectId(projectId);
      const question = normalizeQuestion(await readJsonBody(req, { limitBytes: 16384 }), projectId);
      if (question.synthesize && synthesisBusy) {
        sendError(res, 429, "local_model_busy", "Another synthesis is in progress.");
        return;
      }
      if (question.synthesize) synthesisBusy = reservedModel = true;
      const config = (dependencies.getProjectConfig || resolveProjectConfig)();
      const registry = { roots: (dependencies.getConfiguredProjectRoots || getConfiguredProjectRoots)(),
        manualProjectsFile: path.join(config.dataDir, "projects.json"),
        discoveredProjectsFile: path.join(config.dataDir, "discovered-projects.json") };
      const result = await (dependencies.askProject || askProject)(question.input, {
        registry, includeHistory: question.includeHistory, synthesize: question.synthesize,
        historyStore: process.env.NEXUS_RUN_HISTORY_STORE,
        localModel: { port: Number(process.env.NEXUS_LOCAL_MODEL_PORT), model: process.env.NEXUS_LOCAL_MODEL_ID },
        ...(config.serenaPythonImage ? { analyzer: { serena: { image: config.serenaPythonImage } } } : {})
      });
      sendOk(res, 200, result, "Project evidence retrieved.");
    } catch (error) {
      const code = error?.code;
      const status = code === "request_body_too_large" ? 413 : MISSING.includes(code) ? 404 : STALE.includes(code) ? 409
        : /^invalid_[a-z_]{1,45}$/.test(code) || code === "history_boundary_excluded" ? 400 : 500;
      sendError(res, status, status === 500 ? "project_question_failed" : code, "Project evidence could not be retrieved.");
    } finally {
      if (reservedModel) synthesisBusy = false;
    }
  };
}
