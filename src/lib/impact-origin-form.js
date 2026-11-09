const LEGACY_IMPACT_KEYS = Object.freeze(["schemaVersion", "analysisVersion", "projectId", "project", "originPath", "revision",
  "worktree", "snapshotToken", "generatedAt", "provider", "coverage", "observation", "limits", "status", "findingState",
  "affectedFiles", "affectedTests", "completeness"]);
const LEGACY_OBSERVATION_KEYS = Object.freeze(["basis", "cacheReuse", "digestCoverage", "targetSource", "incomplete"]);

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/**
 * Pure, total view: the single-origin Impact the route itself just built for a one-path task
 * is re-expressed in the multi-origin targets[] form the composer accepts. Any shape that is not
 * exactly that (both forms, other key sets, a different or non-string origin, a malformed
 * targetSource, a task with != 1 path) is returned unchanged, so the composer still rejects it.
 * No field value is recomputed; bound bytes (snapshotToken, targetSource.hash, witnesses) are copied.
 */
export function canonicalImpactOriginForm(request, impact) {
  const paths = request?.task?.paths;
  if (!Array.isArray(paths) || paths.length !== 1) return impact;
  if (!exactKeys(impact, LEGACY_IMPACT_KEYS) || Object.hasOwn(impact, "targets")) return impact;
  if (typeof impact.originPath !== "string" || impact.originPath !== paths[0]) return impact;
  const observation = impact.observation;
  if (!exactKeys(observation, LEGACY_OBSERVATION_KEYS)) return impact;
  const source = observation.targetSource;
  if (source !== null && !(exactKeys(source, ["path", "hash"]) && source.path === impact.originPath && typeof source.hash === "string")) return impact;
  if (typeof impact.status !== "string" || typeof impact.findingState !== "string") return impact;
  if (!impact.completeness || typeof impact.completeness !== "object" || Array.isArray(impact.completeness)) return impact;
  const copy = JSON.parse(JSON.stringify(impact));
  const { originPath, observation: { targetSource, ...restObservation }, ...rest } = copy;
  const out = {};
  for (const key of LEGACY_IMPACT_KEYS) {
    if (key === "originPath") {
      out.targets = [{ originPath, targetSource, status: copy.status, findingState: copy.findingState, completeness: JSON.parse(JSON.stringify(copy.completeness)) }];
    } else if (key === "observation") {
      out.observation = restObservation;
    } else {
      out[key] = rest[key];
    }
  }
  return out;
}
