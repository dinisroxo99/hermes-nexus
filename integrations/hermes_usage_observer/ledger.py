"""Small private spool; publication replaces a directory entry and never follows an output filename."""
import json
import os
import re
import stat
import time
from contextlib import contextmanager
from pathlib import Path

from .events import ObserverError, event_key, verified_event


MAX_EVENTS = 1024
MAX_BYTES = 4096
NAME = re.compile(r"[a-f0-9]{64}\.json\Z")
PENDING = ".pending"


@contextmanager
def directory(path):
    target = Path(path)
    if not target.is_absolute() or target == target.parent or ".." in target.parts:
        raise ObserverError("invalid_capture_directory")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    fd = os.open(target.anchor, flags)
    try:
        for segment in target.parts[1:]:
            nxt = os.open(segment, flags, dir_fd=fd)
            os.close(fd)
            fd = nxt
        st = os.fstat(fd)
        if st.st_uid != os.geteuid() or st.st_mode & 0o077:
            raise ObserverError("capture_directory_not_private")
        yield fd
    finally:
        os.close(fd)


@contextmanager
def locked(path, *, write):
    import fcntl
    try:
        with directory(path) as fd:
            deadline = time.monotonic() + 0.25
            mode = fcntl.LOCK_EX if write else fcntl.LOCK_SH
            while True:
                try:
                    fcntl.flock(fd, mode | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise ObserverError("capture_busy") from None
                    time.sleep(.01)
            def verify():
                with directory(path) as check:
                    if not os.path.samestat(os.fstat(fd), os.fstat(check)):
                        raise ObserverError("capture_directory_changed")
            verify()
            yield fd, verify
            verify()
    except OSError:
        raise ObserverError("capture_unavailable") from None


def entries(fd):
    names = []
    with os.scandir(fd) as items:
        for item in items:
            if item.name == PENDING:
                continue
            if not NAME.fullmatch(item.name) or len(names) == MAX_EVENTS:
                raise ObserverError("invalid_event_store")
            names.append(item.name)
    return sorted(names)


def _unique_fields(items):
    fields = dict(items)
    if len(fields) != len(items):
        raise ObserverError("invalid_event_store")
    return fields


def read_record(fd, name):
    entry = os.stat(name, dir_fd=fd, follow_symlinks=False)
    if not stat.S_ISREG(entry.st_mode) or entry.st_nlink != 1 or not 0 < entry.st_size <= MAX_BYTES:
        raise ObserverError("invalid_event_store")
    source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    with os.fdopen(source, "rb") as stream:
        if not os.path.samestat(os.fstat(source), entry):
            raise ObserverError("invalid_event_store")
        data = stream.read(MAX_BYTES + 1)
    try:
        record = json.loads(data, object_pairs_hook=_unique_fields)
    except (ValueError, UnicodeError, RecursionError):
        raise ObserverError("invalid_event_store") from None
    verified_event(record, name[:-5])
    return record


def persist(path, event):
    key = event_key(event)
    name = key + ".json"
    record = {"version": 1, "state": "observed", "event": event}
    with locked(path, write=True) as (fd, verify):
        names = entries(fd)
        if name in names:
            previous = read_record(fd, name)
            if previous["state"] == "conflict" or previous == record:
                return previous["state"] if previous["state"] == "conflict" else "duplicate"
            record = {**previous, "state": "conflict"}
        elif len(names) == MAX_EVENTS:
            raise ObserverError("event_limit_reached")
        payload = json.dumps(record, separators=(",", ":"), sort_keys=True).encode()
        if len(payload) > MAX_BYTES:
            raise ObserverError("event_too_large")
        try:
            os.unlink(PENDING, dir_fd=fd)  # residue of an interrupted write in the operator-provisioned directory
        except FileNotFoundError:
            pass
        out = os.open(PENDING, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        try:
            with os.fdopen(out, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
                verify()
                if not os.path.samestat(os.fstat(stream.fileno()), os.stat(PENDING, dir_fd=fd, follow_symlinks=False)):
                    raise ObserverError("capture_directory_changed")
                os.replace(PENDING, name, src_dir_fd=fd, dst_dir_fd=fd)
                os.fsync(fd)
        finally:
            try:
                os.unlink(PENDING, dir_fd=fd)
            except FileNotFoundError:
                pass
    return record["state"]
