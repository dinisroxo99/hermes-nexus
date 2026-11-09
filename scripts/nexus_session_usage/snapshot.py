"""Load one bounded, standalone SQLite database into memory without opening its live journals."""
import os
import sqlite3
import stat
from contextlib import contextmanager
from pathlib import Path


MAX_BYTES = 64 * 1024 * 1024


class UsageError(Exception):
    """A safe diagnostic code, with no filesystem path or database contents."""


@contextmanager
def _parent(absolute):
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_DIRECTORY"):
        raise UsageError("secure_path_open_unavailable")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    directory = os.open(absolute.anchor, flags)
    try:
        for part in absolute.parts[1:-1]:
            child = os.open(part, flags, dir_fd=directory)
            os.close(directory)
            directory = child
        yield directory, absolute.name
    finally:
        os.close(directory)


def _no_journals(directory, name):
    for suffix in ("-wal", "-shm", "-journal"):
        try:
            os.stat(name + suffix, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            continue
        raise UsageError("standalone_snapshot_required")


def _stamp(st):
    return (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)


def _verify_current_path(absolute, parent_stamp, file_stamp):
    # A renamed ancestor detaches an open directory without changing the held parent or file.
    try:
        with _parent(absolute) as (directory, name):
            _no_journals(directory, name)
            actual_file = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if _stamp(actual_file) != file_stamp or _stamp(os.fstat(directory)) != parent_stamp:
                raise UsageError("snapshot_changed")
    except OSError:
        raise UsageError("snapshot_changed") from None


def snapshot_bytes(path):
    target = Path(path)
    if not target.name or ".." in target.parts:
        raise UsageError("invalid_input_path")
    try:
        absolute = target.absolute()
        with _parent(absolute) as (directory, name):
            parent_stamp = _stamp(os.fstat(directory))
            _no_journals(directory, name)
            entry = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if not stat.S_ISREG(entry.st_mode):
                raise UsageError("regular_file_required")
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | getattr(os, "O_NOCTTY", 0)
            fd = os.open(name, flags, dir_fd=directory)
            with os.fdopen(fd, "rb", buffering=0) as stream:
                before = os.fstat(stream.fileno())
                if _stamp(entry) != _stamp(before):
                    raise UsageError("snapshot_changed")
                if before.st_size > MAX_BYTES:
                    raise UsageError("database_too_large")
                data = stream.read(before.st_size + 1)
                after = os.stat(name, dir_fd=directory, follow_symlinks=False)
                _no_journals(directory, name)
                if len(data) != before.st_size or _stamp(before) != _stamp(after) or parent_stamp != _stamp(os.fstat(directory)):
                    raise UsageError("snapshot_changed")
                _verify_current_path(absolute, parent_stamp, _stamp(before))
    except OSError:
        raise UsageError("input_unavailable") from None
    if len(data) < 100 or data[:16] != b"SQLite format 3\0" or data[18:20] not in (b"\1\1", b"\2\2"):
        raise UsageError("invalid_database")
    if data[18:20] == b"\2\2":
        # SQLite cannot deserialize WAL-mode images. Only the isolated in-memory copy is converted,
        # after confirming the whole standalone main file was stable and no WAL/journal was present.
        data = data[:18] + b"\1\1" + data[20:]
    return data


@contextmanager
def open_snapshot(path):
    with open_snapshot_data(snapshot_bytes(path)) as db:
        yield db


@contextmanager
def open_snapshot_data(data, *, instruction_budget=250000):
    db = sqlite3.connect(":memory:")
    try:
        if not hasattr(db, "deserialize"):
            raise UsageError("sqlite_deserialize_unavailable")
        db.deserialize(data)
        db.execute("PRAGMA temp_store=MEMORY")
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("PRAGMA query_only=ON")
        db.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 2 * 1024 * 1024)
        steps = 0

        def bounded_query():
            nonlocal steps
            steps += 1
            return steps * 100 > instruction_budget

        db.set_progress_handler(bounded_query, 100)
        yield db
    except sqlite3.Error:
        raise UsageError("unreadable_or_unsupported_database") from None
    finally:
        db.close()
