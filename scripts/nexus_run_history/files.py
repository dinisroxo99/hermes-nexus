"""Read or publish a standalone store without handing its path to a SQLite VFS."""
import os
import secrets
import stat
import time
from contextlib import contextmanager
from pathlib import Path

from scripts.nexus_session_usage.snapshot import UsageError, _no_journals, _parent, _stamp

MAX_BYTES = 32 * 1024 * 1024


def _entry(directory, name):
    try:
        st = os.stat(name, dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        return None
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or not 0 < st.st_size <= MAX_BYTES:
        raise UsageError("invalid_store_file")
    return _stamp(st)


@contextmanager
def locked_store(filename, write):
    try:
        import fcntl
    except ImportError:
        raise UsageError("secure_store_lock_unavailable") from None
    path = Path(filename).absolute()
    if not path.name or ".." in path.parts:
        raise UsageError("invalid_store_path")
    with _parent(path) as (directory, name):
        # The directory inode is the stable cross-process lock. No named lock or sidecar is created or followed.
        deadline = time.monotonic() + 5
        mode = fcntl.LOCK_EX if write else fcntl.LOCK_SH
        while True:
            try:
                fcntl.flock(directory, mode | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise UsageError("history_store_busy") from None
                time.sleep(0.01)
        _no_journals(directory, name)
        stamp = _entry(directory, name)
        data = None
        if stamp is not None:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            with os.fdopen(fd, "rb", buffering=0) as source:
                if _stamp(os.fstat(fd)) != stamp:
                    raise UsageError("history_store_changed")
                data = source.read(stamp[2] + 1)
                if len(data) != stamp[2] or _stamp(os.fstat(fd)) != stamp:
                    raise UsageError("history_store_changed")
        elif not write:
            raise UsageError("history_store_unavailable")

        def verify():
            with _parent(path) as (current, _):
                if not os.path.samestat(os.fstat(directory), os.fstat(current)):
                    raise UsageError("history_store_changed")
            _no_journals(directory, name)
            if _entry(directory, name) != stamp:
                raise UsageError("history_store_changed")

        def publish(payload):
            nonlocal stamp
            if not write or len(payload) > MAX_BYTES:
                raise UsageError("history_store_limit")
            temp = ".nexus-history-" + secrets.token_hex(16)
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
            renamed = False
            try:
                with os.fdopen(fd, "wb") as dest:
                    dest.write(payload)
                    dest.flush()
                    os.fsync(fd)
                    written = os.fstat(fd)
                verify()
                if not os.path.samestat(written, os.stat(temp, dir_fd=directory, follow_symlinks=False)):
                    raise UsageError("history_store_changed")
                # replace renames the directory entry itself; even a last-instant symlink cannot redirect the write.
                os.replace(temp, name, src_dir_fd=directory, dst_dir_fd=directory)
                renamed = True
                published = os.stat(name, dir_fd=directory, follow_symlinks=False)
                if not os.path.samestat(written, published) or published.st_nlink != 1 or published.st_size != len(payload):
                    raise UsageError("history_store_changed")
                stamp = _stamp(published)
                os.fsync(directory)
            finally:
                if not renamed:
                    try:
                        os.unlink(temp, dir_fd=directory)
                    except FileNotFoundError:
                        pass

        verify()
        yield data, publish
        verify()
