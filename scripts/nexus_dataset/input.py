"""Read explicitly supplied, digest-pinned artifacts without following symlinks."""
import hashlib
import json
import os
import re
import stat
from pathlib import Path

from scripts.nexus_session_usage.snapshot import UsageError, _no_journals, _parent, _stamp

HASH = re.compile(r"[0-9a-f]{64}\Z")


def pinned_bytes(path, expected, limit, *, standalone=False, charge=None):
    path = Path(path)
    if not path.name or ".." in path.parts or not HASH.fullmatch(expected):
        raise UsageError("invalid_pinned_input")
    path = path.absolute()
    try:
        with _parent(path) as (directory, name):
            if standalone:
                _no_journals(directory, name)
            fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=directory)
            with os.fdopen(fd, "rb", buffering=0) as source:
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
                    raise UsageError("invalid_artifact_size")
                if charge is not None:
                    charge(before.st_size)
                data = source.read(before.st_size + 1)
                if len(data) != before.st_size or _stamp(before) != _stamp(os.fstat(fd)):
                    raise UsageError("artifact_changed")
            with _parent(path) as (current, _):
                if standalone:
                    _no_journals(current, name)
                if not os.path.samestat(os.fstat(directory), os.fstat(current)) or _stamp(before) != _stamp(
                        os.stat(name, dir_fd=current, follow_symlinks=False)):
                    raise UsageError("artifact_changed")
    except OSError:
        raise UsageError("artifact_unavailable") from None
    if hashlib.sha256(data).hexdigest() != expected:
        raise UsageError("artifact_digest_mismatch")
    return data


def artifact(path, expected, limit):
    data = pinned_bytes(path, expected, limit)
    def unique(items):
        result = dict(items)
        if len(result) != len(items):
            raise UsageError("duplicate_json_key")
        return result
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=unique)
    except (ValueError, RecursionError):
        raise UsageError("invalid_artifact_json") from None
