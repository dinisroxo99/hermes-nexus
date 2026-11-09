import { createHash } from "node:crypto";
import { buildCreateDestinationAbsenceWitness } from "./create-destination-absence-witness.js";
import { canonicalJson } from "./create-destination-absence-witness-constants.js";
import { nameKey, kernelModelNameKey } from "./create-name-key.js";
import { isContextSecretSegment } from "./context-path-secret-policy.js";
import { evaluateCreateDestinationAbsenceWitness } from "./effective-task-scope-policy.js";
import { normalizeImpactPaths } from "./impact-policy.js";
import { refuse, verifyDestinationDirectory } from "./operation-tree-evidence.js";
import { isContextPathAllowed } from "./project-context-files.js";
import { isIgnoredProjectScanDir } from "./project-scan-policy.js";

function representable(path) {
  if (!isContextPathAllowed(path) || path.length > 1024 || path.split("/").length > 64) return false;
  try { if (normalizeImpactPaths([path])[0] !== path) return false; } catch { return false; }
  return path.split("/").every((segment) => Buffer.byteLength(segment) <= 255 && segment.isWellFormed()
    && [nameKey(segment), kernelModelNameKey(segment)].every((key) => key && !isIgnoredProjectScanDir(key)
      && !isContextSecretSegment(key) && !/~[0-9]/.test(key)));
}

/** The directory has to be absent as an entry. Its future children cannot be individually observed. */
export function directoryDestination(input, binding, snapshotToken) {
  const newPath = input.operation.newPath;
  const { projectId, worktree } = input;
  const { repositoryId, worktreeId, revision } = binding;
  const witness = buildCreateDestinationAbsenceWitness({
    projectRoot: binding.root, request: { paths: [newPath] }, nestedProjectPaths: binding.excluded,
    expected: { projectId, repositoryId, worktreeId, revision, locator: worktree, snapshotToken }
  });
  const verified = evaluateCreateDestinationAbsenceWitness(witness, {
    projectId, repositoryId, worktreeId, revision, worktree, snapshotToken, taskPaths: [newPath]
  });
  if (!verified.ok || verified.unicodeMismatch || verified.targets[0]?.verdict !== "absent"
      || witness.targets[0]?.complete !== true) refuse("operation_destination_not_proven_absent");
  verifyDestinationDirectory(binding.root, newPath);
  return { path: newPath, verdict: "absent", complete: true,
    witnessDigest: createHash("sha256").update(canonicalJson(witness)).digest("hex") };
}

export function mapDirectoryTransfer(operation, tree) {
  const { oldPath, newPath } = operation;
  const project = (source) => {
    if (source !== oldPath && !source.startsWith(oldPath + "/")) refuse("operation_mapping_invalid");
    const destination = newPath + source.slice(oldPath.length);
    if (!representable(source) || !representable(destination)) refuse("operation_mapped_path_unsupported");
    return { oldPath: source, newPath: destination };
  };
  return {
    directories: tree.directories.map(project),
    files: tree.files.map((file) => ({ ...project(file.path), bytes: file.bytes, contentSha256: file.sha256 }))
  };
}
