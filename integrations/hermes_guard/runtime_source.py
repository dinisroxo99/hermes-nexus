"""Materialize tracked runtime blobs; ignored profile files, filters and Git hooks stay outside."""
from pathlib import Path

from .inputs import git

PINS = {"903a57c540917cedd30c7d971938f1af7bdf60e2", "546f3b3032d6e21e72dc5240091da1275005d847"}
MODULE_DIRS = {"acp_adapter", "agent", "cron", "gateway", "hermes_cli", "hermes_platform", "pm", "tools", "providers"}


def prepare_runtime(checkout, target, *, agent=False):
    revision = git(checkout, "rev-parse", "--verify", "HEAD").decode().strip()
    if revision not in PINS:
        raise ValueError("unverified_hermes_revision")
    names = git(checkout, "ls-tree", "-z", "--name-only", revision).decode().split("\0")
    paths = [p for p in names if p in MODULE_DIRS or p.endswith(".py")]
    if agent:
        paths.append("plugins")
    records = git(checkout, "ls-tree", "-rz", revision, "--", *paths).rstrip(b"\0").split(b"\0")
    entries = []
    for record in records:
        descriptor, name = record.split(b"\t", 1)
        mode, kind, oid = descriptor.split()
        relative = Path(name.decode())
        if relative.parts[0] == "plugins" and relative.suffix != ".py":
            continue
        if kind != b"blob" or mode not in (b"100644", b"100755") or relative.is_absolute() or ".." in relative.parts:
            raise ValueError("unsupported_runtime_entry")
        entries.append((relative, mode, oid))
    # Both audited revisions contain < 42 MiB in the selected trees. Use one Git process for all files.
    blobs = git(checkout, "cat-file", "--batch", input_data=b"".join(oid + b"\n" for _, _, oid in entries),
                max_output=64 * 1024 * 1024)
    offset = 0
    for relative, mode, oid in entries:
        end = blobs.index(b"\n", offset)
        actual, kind, size = blobs[offset:end].split()
        if actual != oid or kind != b"blob":
            raise ValueError("unavailable_runtime_blob")
        offset = end + 1 + int(size)
        if blobs[offset:offset + 1] != b"\n":
            raise ValueError("invalid_runtime_blob")
        file = target / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(blobs[end + 1:offset])
        file.chmod(0o755 if mode == b"100755" else 0o644)
        offset += 1
    return revision
