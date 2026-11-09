import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  CREATE_ABSENCE_WITNESS_FS_ALLOWLIST, CREATE_ABSENCE_WITNESS_LIMITS
} from "./create-destination-absence-witness-constants.js";
import { nameKey, kernelModelNameKey } from "./create-name-key.js";
import { compareContextStrings, isContextPathAllowed } from "./project-context-files.js";
import { crossesNestedBoundary } from "./project-create-observation.js";

export const OPERATION_TREE_LIMITS = Object.freeze({ files: 32, entries: 256, depth: 8, bytesPerFile: 131072 });
export const refuse = (code) => { throw Object.assign(new Error(code), { code }); };
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const proc = (fd) => `/proc/self/fd/${fd}`;

function gitEntries(binding, target) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  Object.assign(env, { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", LC_ALL: "C" });
  let bytes;
  try {
    bytes = execFileSync("git", ["--no-replace-objects", "--literal-pathspecs", "-C", binding.root,
      "ls-tree", "-r", "-z", binding.revision.commitSha, "--", target], {
      env, stdio: ["ignore", "pipe", "ignore"], timeout: 3000, maxBuffer: 262144
    });
  } catch { refuse("operation_git_tree_unavailable"); }
  const rows = utf8.decode(bytes).split("\0");
  if (rows.pop() !== "" || !rows.length) refuse("operation_source_untracked");
  if (rows.length > OPERATION_TREE_LIMITS.files) refuse("operation_tree_limit");
  const tree = new Map();
  for (const row of rows) {
    const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t([^\u0000-\u001f\u007f]+)$/.exec(row);
    if (!match || (match[3] !== target && !match[3].startsWith(target + "/")) || tree.has(match[3])) {
      refuse("operation_git_tree_unsupported");
    }
    tree.set(match[3], { mode: match[1], blob: match[2] });
  }
  return tree;
}

function mountOf(fd) {
  const info = fs.readFileSync(`/proc/self/fdinfo/${fd}`, "utf8");
  const id = /^mnt_id:\s*(\d+)$/m.exec(info)?.[1];
  if (!id) refuse("operation_mount_unverified");
  return id;
}

function descriptor(fd, absolute, rootMount) {
  if (!fs.readlinkSync(proc(fd), { encoding: "buffer" }).equals(Buffer.from(absolute))) refuse("operation_source_changed");
  const mount = mountOf(fd);
  if (rootMount !== undefined && mount !== rootMount) refuse("operation_mount_boundary");
  const fsType = "0x" + (Number(fs.statfsSync(proc(fd)).type) >>> 0).toString(16);
  if (!CREATE_ABSENCE_WITNESS_FS_ALLOWLIST.includes(fsType)) refuse("operation_filesystem_unsupported");
  return mount;
}

function directoryAncestors(root, relative, visit) {
  if (process.platform !== "linux" || !fs.constants.O_NOFOLLOW || !fs.constants.O_DIRECTORY) {
    refuse("operation_descriptor_unavailable");
  }
  const flags = fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
  let fd = fs.openSync(root, flags);
  try {
    const mount = descriptor(fd, root);
    let absolute = root;
    for (const part of relative.split("/").filter(Boolean)) {
      const next = fs.openSync(`${proc(fd)}/${part}`, flags);
      fs.closeSync(fd);
      fd = next;
      absolute = path.join(absolute, part);
      descriptor(fd, absolute, mount);
      if (fs.lstatSync(`${proc(fd)}/.git`, { throwIfNoEntry: false })) refuse("operation_repository_boundary");
    }
    return visit(fd, mount);
  } finally { fs.closeSync(fd); }
}

function readNames(fd, budget) {
  const dir = fs.opendirSync(proc(fd), { encoding: "buffer" });
  const names = [];
  const keys = new Set();
  const kernelKeys = new Set();
  try {
    let entry;
    while ((entry = dir.readSync())) {
      if (++budget.entries > OPERATION_TREE_LIMITS.entries) refuse("operation_tree_limit");
      const name = utf8.decode(entry.name);
      const key = nameKey(name);
      const kernel = kernelModelNameKey(name);
      if (!key || !kernel || keys.has(key) || kernelKeys.has(kernel)) refuse("operation_name_collision");
      keys.add(key);
      kernelKeys.add(kernel);
      names.push(name);
    }
  } finally { dir.closeSync(); }
  return names.sort(compareContextStrings);
}

// A regular blob may have an ambiguous spelling even when its exact Git path exists.
// Check the explicitly selected segments without publishing the names of their siblings.
function verifySpelling(root, target) {
  let parent = "";
  for (const segment of target.split("/")) {
    directoryAncestors(root, parent, (fd) => {
      const dir = fs.opendirSync(proc(fd), { encoding: "buffer" });
      let count = 0;
      let exact = false;
      const key = nameKey(segment);
      const kernel = kernelModelNameKey(segment);
      try {
        let entry;
        while ((entry = dir.readSync())) {
          if (++count > CREATE_ABSENCE_WITNESS_LIMITS.maxEntriesPerParent) refuse("operation_tree_limit");
          const name = utf8.decode(entry.name);
          if (name === segment) exact = true;
          else if (nameKey(name) === key || kernelModelNameKey(name) === kernel) refuse("operation_name_collision");
        }
      } finally { dir.closeSync(); }
      if (!exact) refuse("operation_source_changed");
    });
    parent = parent ? parent + "/" + segment : segment;
  }
}

function recordFile(state, parent, mount, relative) {
  const git = state.tree.get(relative);
  const admitted = state.sources.get(relative);
  if (!git || !admitted) refuse("operation_source_not_bound");
  const fd = fs.openSync(`${proc(parent)}/${path.posix.basename(relative)}`,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    descriptor(fd, path.join(state.binding.root, relative), mount);
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(OPERATION_TREE_LIMITS.bytesPerFile)) refuse("operation_source_unsupported");
    const buffer = Buffer.alloc(Number(before.size) + 1);
    const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const after = fs.fstatSync(fd, { bigint: true });
    if (BigInt(count) !== before.size || before.size !== after.size || before.ctimeNs !== after.ctimeNs
        || before.mtimeNs !== after.mtimeNs) refuse("operation_source_changed");
    const content = buffer.subarray(0, count);
    const mode = (before.mode & 0o111n) ? "100755" : "100644";
    const sha256 = createHash("sha256").update(content).digest("hex");
    const blob = createHash(git.blob.length === 40 ? "sha1" : "sha256")
      .update(`blob ${count}\0`).update(content).digest("hex");
    if (git.blob !== blob || git.mode !== mode || admitted.sha256 !== sha256) refuse("operation_source_changed");
    state.files.push({ path: relative, sha256, gitBlob: blob, mode, bytes: count });
  } finally { fs.closeSync(fd); }
}

function visitDirectory(state, relative, depth) {
  if (depth > OPERATION_TREE_LIMITS.depth) refuse("operation_tree_limit");
  directoryAncestors(state.binding.root, relative, (fd, mount) => {
    const names = readNames(fd, state);
    // Git does not track empty directories. Their presence prevents a complete tracked-file expansion.
    if (!names.length) refuse("operation_empty_directory");
    state.directories.push(relative);
    for (const name of names) {
      const next = relative + "/" + name;
      if (!isContextPathAllowed(next) || crossesNestedBoundary(next, state.binding.excluded)) {
        refuse("operation_directory_boundary");
      }
      const stat = fs.lstatSync(`${proc(fd)}/${name}`);
      if (stat.isDirectory()) visitDirectory(state, next, depth + 1);
      else if (stat.isFile()) recordFile(state, fd, mount, next);
      else refuse("operation_entry_unsupported");
    }
  });
}

export function verifyDestinationDirectory(root, destination) {
  const parent = destination.split("/").slice(0, -1).join("/");
  try {
    if (parent) verifySpelling(root, parent);
    directoryAncestors(root, parent, () => {});
  } catch (e) {
    if (e.code?.startsWith("operation_")) throw e;
    refuse("operation_tree_unobservable");
  }
}

/** Compare the entire live bounded selection with regular Git blobs and admitted snapshot sources. */
export function observeTrackedTree(binding, snapshot, operation) {
  const directory = operation.kind === "expand_directory";
  const target = directory ? operation.path : operation.oldPath;
  try {
    const tree = gitEntries(binding, target);
    verifySpelling(binding.root, target);
    const state = { binding, tree, sources: new Map(snapshot.files.map((f) => [f.path, f])),
      files: [], directories: [], entries: 0 };
    if (directory) visitDirectory(state, target, 0);
    else {
      if (tree.size !== 1 || !tree.has(target)) refuse("operation_source_not_file");
      const parent = target.split("/").slice(0, -1).join("/");
      directoryAncestors(binding.root, parent, (fd, mount) => recordFile(state, fd, mount, target));
    }
    if (state.files.length !== tree.size) refuse("operation_directory_changed");
    return { directories: state.directories.sort(compareContextStrings),
      files: state.files.sort((a, b) => compareContextStrings(a.path, b.path)) };
  } catch (e) {
    if (e.code?.startsWith("operation_")) throw e;
    refuse("operation_tree_unobservable");
  }
}
