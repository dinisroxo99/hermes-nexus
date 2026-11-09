"""Back up and restore Nexus registry files and the optional validated run history store."""
import argparse
import ctypes
import errno
from contextlib import closing
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
from zipfile import BadZipFile, ZIP_STORED, ZipFile, ZipInfo

from scripts.nexus_session_usage.snapshot import MAX_BYTES, UsageError, snapshot_bytes

REGISTRIES = ("projects.json", "discovered-projects.json")
STORE = "history.sqlite"
REGISTRY_MAX = 4 * 1024 * 1024
ARCHIVE_MAX = MAX_BYTES + REGISTRY_MAX * 2 + 65536


def regular_bytes(path, limit):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    path = Path(path).absolute()
    if ".." in path.parts or path.parent.resolve(strict=True) != path.parent:
        raise UsageError("unexpected_file")
    parent = path.parent.stat()
    fd = os.open(path, flags)
    with os.fdopen(fd, "rb", buffering=0) as stream:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise UsageError("unexpected_file")
        data = stream.read(limit + 1)
        after = os.stat(path, follow_symlinks=False)
        def stamp(value):
            return value.st_dev, value.st_ino, value.st_size, value.st_ctime_ns, value.st_mtime_ns
        if (not os.path.samestat(parent, path.parent.stat()) or path.parent.resolve(strict=True) != path.parent
                or stamp(before) != stamp(after) or len(data) != before.st_size):
            raise UsageError("source_changed")
        return data


def verify_content(name, data):
    if name == STORE:
        from scripts.nexus_run_history.store import store_version
        with closing(sqlite3.connect(":memory:")) as db:
            db.deserialize(data)
            db.execute("PRAGMA trusted_schema=OFF")
            db.execute("PRAGMA query_only=ON")
            store_version(db)
            if db.execute("PRAGMA quick_check(1)").fetchone() != ("ok",):
                raise UsageError("history_integrity_check_failed")
    elif name in REGISTRIES:
        value = json.loads(data.decode("utf-8")) if data.strip() else []
        if not isinstance(value, list) or len(value) > 10000 or any(not isinstance(row, dict) for row in value):
            raise UsageError("invalid_registry")
    else:
        raise UsageError("unexpected_archive_member")


def validate_state(files):
    for name, data in files.items():
        verify_content(name, data)
    def rows(name):
        data = files.get(name, b"")
        return json.loads(data.decode("utf-8")) if data.strip() else []
    payload = {"manual": rows(REGISTRIES[0]), "discovered": rows(REGISTRIES[1])}
    helper = Path(__file__).with_name("validate-registry.mjs")
    result = subprocess.run(["node", str(helper)], input=json.dumps(payload, ensure_ascii=False).encode(),
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
    if result.returncode:
        raise UsageError("invalid_registry")


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_state(directory, store):
    if not directory.is_dir():
        raise UsageError("missing_data_directory")
    files = {}
    for name in REGISTRIES:
        try:
            files[name] = regular_bytes(directory / name, REGISTRY_MAX)
        except FileNotFoundError:
            continue
    if store is not None:
        files[STORE] = snapshot_bytes(store)
    if not files:
        raise UsageError("no_state_selected")
    return files


def create_backup(directory, store, destination):
    files = read_state(directory, store)
    if files != read_state(directory, store):
        raise UsageError("sources_changed")
    validate_state(files)
    manifest = {"schemaVersion": 1, "files": {name: digest(data) for name, data in sorted(files.items())}}
    # A hard link publishes the complete archive and never overwrites an existing destination.
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".nexus-backup-") as stage:
        with ZipFile(stage, "w", compression=ZIP_STORED) as archive:
            for name, data in sorted(files.items()):
                archive.writestr(ZipInfo(name), data)
            archive.writestr(ZipInfo("manifest.json"), json.dumps(manifest, sort_keys=True))
        stage.flush()
        os.fsync(stage.fileno())
        stage.seek(0)
        fingerprint = digest(stage.read())
        os.link(stage.name, destination)
        sync_directory(destination.parent)
    return {"schemaVersion": 1, "sha256": fingerprint, "members": sorted(files)}


def verified_members(archive_path, pin):
    raw = regular_bytes(archive_path, ARCHIVE_MAX)
    if digest(raw) != pin:
        raise UsageError("archive_digest_mismatch")
    with ZipFile(io.BytesIO(raw)) as archive:
        info = archive.infolist()
        names = {member.filename for member in info}
        if (len(info) != len(names) or "manifest.json" not in names or len(info) < 2
                or not names <= {*REGISTRIES, STORE, "manifest.json"}):
            raise UsageError("invalid_archive_inventory")
        for member in info:
            limit = MAX_BYTES if member.filename == STORE else (4096 if member.filename == "manifest.json" else REGISTRY_MAX)
            if member.compress_type != ZIP_STORED or member.file_size > limit:
                raise UsageError("invalid_archive_member")
        files = {name: archive.read(name) for name in sorted(names - {"manifest.json"})}
        expected = {"schemaVersion": 1, "files": {name: digest(data) for name, data in files.items()}}
        if json.loads(archive.read("manifest.json")) != expected:
            raise UsageError("invalid_archive_manifest")
        validate_state(files)
    return files


def publish_directory(stage, destination):
    # Linux/WSL. Plain rename can overwrite a directory created by another process.
    rename = getattr(ctypes.CDLL(None, use_errno=True), "renameat2", None)
    if rename is None:
        raise UsageError("atomic_restore_unavailable")
    if rename(-100, os.fsencode(stage), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise FileExistsError(destination)
        if code in (errno.EINVAL, errno.ENOSYS, errno.ENOTSUP):
            raise UsageError("atomic_restore_unavailable")
        raise OSError(code, os.strerror(code))


def restore(archive_path, pin, destination):
    files = verified_members(archive_path, pin)
    with tempfile.TemporaryDirectory(prefix=".nexus-restore-", dir=destination.parent) as tmp:
        stage = Path(tmp) / "state"
        stage.mkdir(mode=0o700)
        for name, data in files.items():
            fd = os.open(stage / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        sync_directory(stage)
        publish_directory(stage, destination)
        sync_directory(destination.parent)
    return {"schemaVersion": 1, "restored": sorted(files), "sha256": pin}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest="action", required=True)
    backup = modes.add_parser("backup")
    backup.add_argument("--data-dir", required=True, type=Path)
    backup.add_argument("--history-store", type=Path)
    backup.add_argument("--output", required=True, type=Path)
    unpack = modes.add_parser("restore")
    unpack.add_argument("--archive", required=True, type=Path)
    unpack.add_argument("--sha256", required=True)
    unpack.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = (create_backup(args.data_dir, args.history_store, args.output) if args.action == "backup"
                  else restore(args.archive, args.sha256, args.destination))
    except (UsageError, OSError, ValueError, subprocess.SubprocessError, BadZipFile, sqlite3.Error, RecursionError) as error:
        code = str(error) if isinstance(error, UsageError) else "recovery_failed"
        print(json.dumps({"error": code}), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
