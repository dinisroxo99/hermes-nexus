"""Build an operator-granted view from immutable, bounded Git blobs."""
import os
from pathlib import Path
import re
import subprocess
import tempfile


MAX_FILE = 128 * 1024
ID = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}\Z")
SHA = re.compile(r"(?:[a-f0-9]{40}|[a-f0-9]{64})\Z")


def git(root, *args, input_data=None, max_output=4 * 1024 * 1024):
    env = {"PATH": os.defpath, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_REPLACE_OBJECTS": "1", "GIT_TERMINAL_PROMPT": "0", "GIT_NO_LAZY_FETCH": "1"}

    def output_limit():
        import resource
        _, hard = resource.getrlimit(resource.RLIMIT_FSIZE)
        ceiling = max_output + 1 if hard == resource.RLIM_INFINITY else min(max_output + 1, hard)
        resource.setrlimit(resource.RLIMIT_FSIZE, (ceiling, ceiling))

    with tempfile.TemporaryFile() as out:
        subprocess.run(["git", "--literal-pathspecs", "-C", str(root), *args], env=env, input=input_data,
                       stdin=subprocess.DEVNULL if input_data is None else None, stdout=out,
                       preexec_fn=output_limit if os.name == "posix" else None, stderr=subprocess.DEVNULL,
                       timeout=30, check=True)
        if out.tell() > max_output:
            raise ValueError("git_output_budget")
        out.seek(0)
        return out.read(max_output)


def path_allowed(value):
    return isinstance(value, str) and 0 < len(value) <= 256 and all(SEGMENT.fullmatch(s) for s in value.split("/"))


def materialize(repo, revision, task, reads, writes, destination):
    paths = [*reads, *writes]
    if not SHA.fullmatch(revision) or not ID.fullmatch(task):
        raise ValueError("invalid_revision_or_task")
    if not 1 <= len(paths) <= 16 or len(set(paths)) != len(paths) or not all(path_allowed(p) for p in paths):
        raise ValueError("invalid_file_grants")
    if Path(os.fsdecode(git(repo, "rev-parse", "--show-toplevel")).rstrip("\n")).resolve() != repo:
        raise ValueError("project_must_be_git_root")
    check_revision(repo, revision)
    total = 0
    for name in paths:
        entry = git(repo, "ls-tree", "-z", revision, "--", name).removesuffix(b"\0").partition(b"\t")
        fields = entry[0].split()
        if len(fields) != 3 or fields[0] not in (b"100644", b"100755") or fields[1] != b"blob" or entry[2] != name.encode():
            raise ValueError("grant_requires_tracked_regular_file")
        oid = fields[2].decode("ascii")
        size = int(git(repo, "cat-file", "-s", oid))
        total += size
        if size > MAX_FILE or total > 1024 * 1024:
            raise ValueError("file_budget")
        data = git(repo, "cat-file", "blob", oid)
        if b"\0" in data:
            raise ValueError("text_files_only")
        data.decode("utf-8")
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        target.chmod(0o755 if fields[0] == b"100755" else 0o644)
    return {"task": task, "revision": revision, "read": sorted(paths), "write": sorted(writes)}


def check_revision(repo, revision):
    if git(repo, "rev-parse", "--verify", "HEAD").decode().strip() != revision:
        raise ValueError("stale_revision")
