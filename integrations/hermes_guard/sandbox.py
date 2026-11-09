"""Linux namespaces, an explicit filesystem view, and an inherited syscall filter."""
import ctypes
import errno
import os
from pathlib import Path
import shutil
import sys


def network_filter(file):
    # Bubblewrap loads this filter before the worker. libseccomp rejects other
    # architectures by default. io_uring and socketcall are alternate socket paths.
    lib = ctypes.CDLL("libseccomp.so.2")
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
    context = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
    if not context:
        raise RuntimeError("seccomp_unavailable")
    try:
        for name in ("socket", "socketpair", "socketcall", "connect", "bind", "sendto", "sendmsg", "sendmmsg",
                     "recvmsg", "recvmmsg", "io_uring_setup", "io_uring_enter", "io_uring_register", "setns",
                     "unshare", "mount", "umount2", "pivot_root", "open_tree", "move_mount", "fsopen", "fspick",
                     "mount_setattr", "open_by_handle_at", "ptrace", "process_vm_writev", "process_vm_readv",
                     "bpf", "keyctl", "add_key", "request_key"):
            nr = lib.seccomp_syscall_resolve_name(name.encode())
            if nr >= 0 and lib.seccomp_rule_add(context, 0x00050000 | errno.EPERM, nr, 0):
                raise RuntimeError("seccomp_rule_failed")
        if lib.seccomp_export_bpf(context, file.fileno()):
            raise RuntimeError("seccomp_export_failed")
        file.seek(0)
    finally:
        lib.seccomp_release(context)


def python_mounts():
    mounts = []
    for root in dict.fromkeys((sys.base_prefix, sys.prefix)):
        prefix = Path(root).resolve()
        if prefix in (Path("/"), Path("/tmp"), Path.home().resolve()):
            raise ValueError("invalid_python_prefix")
        if not prefix.is_relative_to("/usr"):
            mounts.append(prefix)
    return mounts


def command(runtime, view, authority, writes, worker, filter_file):
    bwrap = shutil.which("bwrap", path=os.defpath)
    if not bwrap or sys.platform != "linux":
        raise RuntimeError("linux_bubblewrap_required")
    args = [bwrap, "--die-with-parent", "--new-session", "--unshare-user", "--unshare-pid", "--unshare-ipc",
            "--unshare-uts", "--disable-userns", "--cap-drop", "ALL", "--clearenv",
            "--ro-bind", "/usr", "/usr", "--size", str(64 * 1024 * 1024), "--tmpfs", "/tmp"]
    for name in ("bin", "sbin", "lib", "lib64"):
        source = Path("/") / name
        if source.is_symlink():
            args.extend(["--symlink", os.readlink(source), str(source)])
        elif source.is_dir():
            args.extend(["--ro-bind", str(source), str(source)])
    for prefix in python_mounts():
        args.extend(["--ro-bind", str(prefix), str(prefix)])
    args.extend(["--dev", "/dev", "--proc", "/proc",
                 "--dir", "/tmp/home", "--dir", "/tmp/empty-plugins", "--dir", "/tmp/profile",
                 "--ro-bind", str(runtime), "/runtime", "--ro-bind", str(view), "/work",
                 "--ro-bind", str(Path(__file__).resolve().parent), "/guard",
                 "--ro-bind", str(authority), "/authority.json"])
    for name in writes:
        # Only disposable copies are ever bind-mounted writable.
        args.extend(["--bind", str(view / name), "/work/" + name])
    args.extend(["--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/tmp/home", "--setenv", "TMPDIR", "/tmp",
                 "--setenv", "HERMES_HOME", "/tmp/profile", "--setenv", "HERMES_BUNDLED_PLUGINS", "/tmp/empty-plugins",
                 "--setenv", "HERMES_ENABLE_PROJECT_PLUGINS", "0", "--chdir", "/work",
                 "--remount-ro", "/", "--seccomp", str(filter_file.fileno()), "--", sys.executable, "-IB", worker])
    return args
