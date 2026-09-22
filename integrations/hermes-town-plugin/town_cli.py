"""Profile-local Town launcher. No configuration edits or plugin activation.

Exit codes: 0 success (status is diagnostic), 2 invalid configuration or unsafe
files, 3 missing prerequisites, 4 ownership/port conflict, 5 lifecycle failure,
6 another lifecycle operation holds the profile lock.

POSIX enforces ownership and private modes. On Windows, regular-file,
single-link and reparse-point checks are enforced, but Python's stdlib does
not audit Windows ACLs: the operator must restrict the Hermes home and its
inherited ACLs to their account (and trusted administrators). chmod is not
an ACL security boundary. No stored PID is used to control a process.
"""
from __future__ import annotations

import argparse
import contextlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import webbrowser

BUNDLE = Path(__file__).resolve().parent / "runtime"
DEFAULT_PORT = 4187
TIMEOUT = 10.0
LOG_LIMIT = 1024 * 1024


class TownError(Exception):
    def __init__(self, message, code=2):
        super().__init__(message)
        self.code = code


def setup_parser(parser):
    commands = parser.add_subparsers(dest="town_action", required=True)
    for action in ("setup", "start", "status", "stop", "open"):
        sub = commands.add_parser(action, help=f"{action.capitalize()} the profile-local town")
        sub.add_argument("--port", type=int, default=None)
        if action == "status":
            sub.add_argument("--json", action="store_true", dest="town_json")
        if action == "start":
            sub.add_argument("--open", action="store_true", dest="town_open",
                             help="Opt in to opening a browser after readiness")


def settings(port=None):
    home = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser().absolute()
    runtime = home / "hermes-town" / "runtime"
    override = os.environ.get("HERMES_TOWN_BRIDGE_URL", "").strip()
    parsed = None
    if override:
        try:
            parsed = urllib.parse.urlsplit(override)
            valid = (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")
                     and parsed.username is None and parsed.password is None
                     and parsed.path == "/api/town/ingest" and not parsed.query and not parsed.fragment
                     and parsed.port is not None)
        except ValueError:
            valid = False
        if not valid:
            raise TownError("HERMES_TOWN_BRIDGE_URL must be http://127.0.0.1:PORT/api/town/ingest (localhost also supported); HTTPS/IPv6 require an external server.")
    selected = port if port is not None else (parsed.port if parsed else DEFAULT_PORT)
    if not 1 <= selected <= 65535:
        raise TownError("--port must be between 1 and 65535")
    if parsed and selected != parsed.port:
        raise TownError("--port conflicts with HERMES_TOWN_BRIDGE_URL; use the same port in both.")
    if selected != DEFAULT_PORT and not parsed:
        raise TownError(f"Custom port requires HERMES_TOWN_BRIDGE_URL=http://127.0.0.1:{selected}/api/town/ingest in the observed Hermes process and this CLI environment.")
    token = runtime / "bridge-token"
    token_override = os.environ.get("HERMES_TOWN_BRIDGE_TOKEN_FILE", "").strip()
    if token_override and Path(token_override).expanduser().absolute() != token:
        raise TownError("External HERMES_TOWN_BRIDGE_TOKEN_FILE is unsupported by managed Town; unset it and use this profile's hermes-town/runtime/bridge-token.")
    return home, runtime, selected


def safe_info(info, directory=False):
    """Windows reparse points include junctions, not just symlinks."""
    if getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
        return False
    if directory:
        return stat.S_ISDIR(info.st_mode) and (os.name != "posix" or info.st_uid == os.getuid())
    return (stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and (os.name != "posix" or
                 (info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600)))


def private_flags(flags):
    if os.name == "posix":
        return flags | os.O_NOFOLLOW | os.O_NONBLOCK
    return flags | getattr(os, "O_BINARY", 0)


def private_open(path, flags):
    """Check before/after open, including descriptor identity; never truncate."""
    check_file(path, missing=bool(flags & os.O_CREAT))
    fd = os.open(path, private_flags(flags), 0o600)
    try:
        info, named = os.fstat(fd), path.lstat()
        if (not safe_info(info) or not safe_info(named)
                or not os.path.samestat(info, named)):
            raise TownError(f"Unsafe {path.name}: file changed during open.")
        return fd
    except BaseException:
        os.close(fd)
        raise


def check_file(path, missing=False):
    try:
        info = path.lstat()
    except FileNotFoundError:
        if missing:
            return False
        raise TownError(f"Required private file missing: {path.name}") from None
    if not safe_info(info):
        raise TownError(f"Unsafe {path.name}: require regular non-symlink file, one link; POSIX requires owner and mode 0600; Windows requires private ACLs.")
    return True


def private_read(path):
    fd = private_open(path, os.O_RDONLY)
    with os.fdopen(fd, "r", encoding="utf-8") as stream:
        data = stream.read(16385)
        if len(data) > 16384:
            raise TownError(f"Oversized {path.name}")
        return data


def runtime_dirs(runtime, create=False, tighten=False):
    for path in (runtime.parent, runtime):
        if create:
            try:
                path.mkdir(mode=0o700)
            except FileExistsError:
                pass
        try:
            info = path.lstat()
        except FileNotFoundError:
            return False
        if not safe_info(info, directory=True):
            raise TownError("Town runtime directories must be owned, actual non-symlink directories.")
        if os.name == "posix" and stat.S_IMODE(info.st_mode) != 0o700:
            if not tighten:
                raise TownError("Town runtime directories require mode 0700; run hermes town setup to tighten owned directories.")
            # Explicit setup migration for the earlier installer's 0755 parent.
            # chmod the checked descriptor, never a symlink path.
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                opened = os.fstat(fd)
                if not safe_info(opened, directory=True) or not os.path.samestat(info, opened):
                    raise TownError("Town runtime directory changed during setup.")
                os.fchmod(fd, 0o700)
            finally:
                os.close(fd)
        if not safe_info(path.lstat(), directory=True):
            raise TownError("Town runtime directory changed during setup.")
    return True


def file_lock(fd, unlock=False):
    if os.name == "posix":
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_UN if unlock else fcntl.LOCK_EX | fcntl.LOCK_NB)
    elif os.name == "nt":
        import msvcrt
        if not unlock and os.fstat(fd).st_size == 0:
            os.write(fd, b"\0")
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK if unlock else msvcrt.LK_NBLCK, 1)
    else:
        raise TownError("Managed Town requires POSIX or Windows.")


def spawn_options():
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
                "close_fds": True}
    return {"start_new_session": True, "umask": 0o077, "close_fds": True}


@contextlib.contextmanager
def locked(runtime, tighten=False):
    runtime_dirs(runtime, create=True, tighten=tighten)
    path = runtime / "lifecycle.lock"
    fd = private_open(path, os.O_CREAT | os.O_RDWR)
    acquired = False
    try:
        try:
            file_lock(fd)
            acquired = True
        except OSError:
            raise TownError("Another Town lifecycle operation is running; retry shortly.", 6) from None
        yield
    finally:
        try:
            if acquired:
                file_lock(fd, unlock=True)
        finally:
            os.close(fd)


def node_status():
    node = shutil.which("node")
    if not node:
        return None, "Node.js missing; install ^20.19.0 or >=22.12.0."
    try:
        result = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=5)
        match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)\s*", result.stdout)
        version = tuple(map(int, match.groups())) if match and result.returncode == 0 else (0, 0, 0)
        if not ((version[0] == 20 and version >= (20, 19, 0)) or version >= (22, 12, 0)):
            return None, "Unsupported Node.js; install ^20.19.0 or >=22.12.0."
    except (OSError, subprocess.TimeoutExpired):
        return None, "Node.js version check failed."
    return str(Path(node).absolute()), "ready"


def bundle_ready():
    """Check packaged bytes, not repository sources or mutable profile state."""
    import hashlib
    required = {"server/serve-live.mjs", "server/townServer.mjs", "dist/index.html"}
    try:
        manifest = json.loads((BUNDLE / "manifest.json").read_text(encoding="utf-8"))
        files = manifest["files"]
        if not isinstance(files, dict) or not required.issubset(files):
            return False
        for name, digest in files.items():
            relative = Path(name)
            if relative.is_absolute() or ".." in relative.parts or not re.fullmatch(r"[0-9a-f]{64}", digest):
                return False
            target = BUNDLE / relative
            if target.is_symlink() or not target.resolve().is_relative_to(BUNDLE.resolve()):
                return False
            with target.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                    return False
        return True
    except (OSError, ValueError, KeyError, TypeError):
        return False


def token_ready(runtime, create=False):
    path = runtime / "bridge-token"
    if not check_file(path, missing=True):
        if not create:
            return False
        fd = private_open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
        with os.fdopen(fd, "w") as stream:
            stream.write(secrets.token_hex(32) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
    token = private_read(path).strip()
    alphabet = (26 if any(c.islower() for c in token) else 0) + (26 if any(c.isupper() for c in token) else 0) + (10 if any(c.isdigit() for c in token) else 0) + (16 if any(not c.isalnum() for c in token) else 0)
    distinct = len(set(token))
    if (not re.fullmatch(r"[!-~]{1,4096}", token) or distinct < 8
            or len(token) * math.log2(max(1, min(alphabet, distinct))) < 128):
        raise TownError("Bridge token is malformed or too weak; replace it with a securely generated token (it was not overwritten).")
    return True


def setup(runtime):
    if not bundle_ready():
        raise TownError("Packaged runtime missing or integrity check failed; install a Hermes Town release containing runtime/manifest.json, runtime/server and runtime/dist.", 3)
    node, reason = node_status()
    if not node:
        raise TownError(reason, 3)
    token_ready(runtime, create=True)
    return node


def api(port, route, token=None, method="GET"):
    # http.client bypasses proxy variables and never follows redirects.
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
    try:
        headers = {"Authorization": "Bearer " + token} if token else {}
        conn.request(method, "/api/town/" + route, headers=headers)
        response = conn.getresponse()
        data = response.read(16385)
        expected = 202 if route == "manage/stop" and method == "POST" else 200
        if response.status != expected or len(data) > 16384:
            return None
        value = json.loads(data)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, http.client.HTTPException):
        return None
    finally:
        conn.close()


def listening(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def read_state(runtime):
    path = runtime / "server.json"
    if not check_file(path, missing=True):
        return None
    try:
        value = json.loads(private_read(path))
        if (not isinstance(value, dict) or type(value.get("port")) is not int
                or not 1 <= value["port"] <= 65535
                or not re.fullmatch(r"[0-9a-f]{64}", value.get("managementToken", ""))
                or value.get("profile") != str(runtime.parent.parent)):
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise TownError("Invalid managed server state; refusing to control any process.") from None


def owned(state):
    if not state:
        return False
    reply = api(state["port"], "manage", state["managementToken"])
    return bool(reply and reply.get("ok") is True and reply.get("service") == "hermes-town")


def save_state(runtime, state):
    target = runtime / "server.json"
    check_file(target, missing=True)
    fd, name = tempfile.mkstemp(prefix=".server-", dir=runtime)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, target)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def stop_owned(state):
    if not owned(state):
        raise TownError("Server ownership could not be authenticated; no process was stopped.", 4)
    reply = api(state["port"], "manage/stop", state["managementToken"], "POST")
    if not reply or reply.get("ok") is not True:
        raise TownError("Stop was not acknowledged; managed state retained, no PID signalled.", 5)
    deadline = time.monotonic() + TIMEOUT
    while time.monotonic() < deadline:
        if not listening(state["port"]):
            return
        time.sleep(0.1)
    raise TownError("Stop requested, but endpoint still reachable; managed state retained.", 5)


def start(home, runtime, port):
    node = setup(runtime)
    state = read_state(runtime)
    if owned(state):
        if state["port"] != port:
            raise TownError("This profile already runs on another port; stop it using its configured port first.", 4)
        if not api(port, "health"):
            raise TownError("Owned server is not healthy; stop it before restarting.", 5)
        return
    if listening(port):
        raise TownError("Port is occupied by an unrelated/unmanaged listener; refusing to adopt or stop it.", 4)
    for name in ("town-journal.jsonl", "server.log", "server.log.1"):
        check_file(runtime / name, missing=True)
    management = secrets.token_hex(32)
    env = os.environ.copy()
    env["HERMES_HOME"] = str(home)
    env["HERMES_TOWN_MANAGEMENT_TOKEN"] = management
    # A detached, constant-memory sink bounds logs even across long sessions.
    # It receives no management credential (that is passed only to Node).
    sink_env = os.environ.copy()
    sink_env.pop("HERMES_TOWN_MANAGEMENT_TOKEN", None)
    sink = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--_log-sink", str(runtime)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=sink_env, **spawn_options())
    process = None
    state = {"port": port, "managementToken": management, "profile": str(home), "startedAt": time.time()}
    try:
        process = subprocess.Popen([node, str(BUNDLE / "server/serve-live.mjs"), "--static", str(BUNDLE / "dist"), "--journal", str(runtime / "town-journal.jsonl"), "--token-file", str(runtime / "bridge-token"), "--port", str(port), "--host", "127.0.0.1"], stdin=subprocess.DEVNULL, stdout=sink.stdin, stderr=subprocess.STDOUT, env=env, cwd=str(runtime), **spawn_options())
        sink.stdin.close()
        state["pid"] = process.pid  # diagnostic only; never used for control
        deadline = time.monotonic() + TIMEOUT
        while time.monotonic() < deadline:
            if process.poll() is not None:
                break
            if owned(state) and api(port, "health"):
                save_state(runtime, state)
                return
            time.sleep(0.1)
        raise TownError("Town failed readiness; inspect the private runtime/server.log.", 5)
    except BaseException:
        if process is not None and process.poll() is None:
            if owned(state):
                stop_owned(state)
            else:
                # Only this still-live Popen child, never a PID loaded from disk.
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
        raise
    finally:
        if sink.stdin and not sink.stdin.closed:
            sink.stdin.close()


def status(runtime, port):
    dirs = runtime_dirs(runtime)
    node, reason = node_status()
    token_error = None
    try:
        token = dirs and token_ready(runtime)
    except TownError as error:
        token, token_error = False, str(error)
    state_error = None
    try:
        state = read_state(runtime) if dirs else None
    except TownError as error:
        state, state_error = None, str(error)
    owner = owned(state) and state["port"] == port
    health = api(port, "health")
    bridge = health.get("bridge") if health and owner else None
    count = bridge.get("receivedEvents") if isinstance(bridge, dict) else None
    if type(count) is not int or count < 0:
        count = None
    return {"url": f"http://127.0.0.1:{port}/", "bundleReady": bundle_ready(), "nodeReady": bool(node), "nodeDiagnostic": reason, "tokenReady": bool(token), "tokenDiagnostic": token_error, "serverReachable": listening(port), "serverHealthy": bool(health), "managedByThisProfile": bool(owner), "stateDiagnostic": state_error, "receivedEvents": count, "firstEventsObserved": count > 0 if count is not None else None, "pluginEnabled": "unknown", "pluginLoadedInObservedProcess": "unknown"}


def print_status(report):
    print(f"Town: {report['url']}")
    readiness = [("bundle", report["bundleReady"]), ("Node.js", report["nodeReady"]), ("private token", report["tokenReady"])]
    print("Local setup: " + ", ".join(f"{name} {'ready' if ready else 'needs attention'}" for name, ready in readiness))
    if report["managedByThisProfile"] and report["serverHealthy"]:
        print("Server: running, managed by this profile")
    elif report["serverReachable"]:
        print("Server: port occupied; ownership not verified for this profile")
    else:
        print("Server: not running")
    count = report["receivedEvents"]
    if count is None:
        print("Hermes events: unknown until this profile's server is running")
    elif count == 0:
        print("Hermes events: waiting for the first event during this server run")
    else:
        print(f"Hermes events: {count} accepted during this server run")
    print("Plugin loading in the observed Hermes process: unknown (not inferred from server health)")
    for field in ("tokenDiagnostic", "stateDiagnostic"):
        if report.get(field):
            print(f"Check: {report[field]}")
    if not report["nodeReady"]:
        print(f"Check: {report['nodeDiagnostic']}")
    if not report["serverReachable"]:
        print("Next: hermes town start (includes setup)")
    elif not report["managedByThisProfile"]:
        print("Next: use the original supervisor for that listener, or choose a matching unused bridge port.")
    elif count == 0:
        print("Next: start a new Hermes CLI session, or restart the observed gateway, then run a turn.")


def open_browser(port):
    if sys.platform != "darwin" and os.name == "posix" and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        raise TownError(f"No graphical session; open http://127.0.0.1:{port}/ on this host or use a private SSH forward.", 5)
    if not webbrowser.open(f"http://127.0.0.1:{port}/"):
        raise TownError("No browser could be opened; use the printed local URL.", 5)


def run(args):
    try:
        home, runtime, port = settings(getattr(args, "port", None))
        action = args.town_action
        if action == "status":
            report = status(runtime, port)
            if getattr(args, "town_json", False):
                print(json.dumps(report, sort_keys=True))
            else:
                print_status(report)
            return 0
        with locked(runtime, tighten=action in ("setup", "start")):
            if action == "setup":
                setup(runtime)
                print("Town bundle, Node and private token ready. Plugin enablement/loading are not inferred or changed.")
                if os.name == "nt":
                    print("Windows: restrict the Hermes home's inherited ACLs to your account and trusted administrators; ACLs are not audited by this CLI.")
            elif action == "start":
                start(home, runtime, port)
                print(f"Town ready: http://127.0.0.1:{port}/. Run hermes town status to check first events.")
                if getattr(args, "town_open", False):
                    open_browser(port)
            elif action == "stop":
                state = read_state(runtime)
                if state and state["port"] != port:
                    raise TownError("Managed state uses another port; select that port and matching HERMES_TOWN_BRIDGE_URL.", 4)
                if state and owned(state):
                    stop_owned(state)
                    (runtime / "server.json").unlink()
                    print("Town stopped; endpoint is no longer reachable.")
                elif listening(port):
                    raise TownError("Listener is not authenticated as this profile's server; nothing stopped.", 4)
                else:
                    print("Town is not running; no process was signalled.")
            elif action == "open":
                state = read_state(runtime)
                if not state or state["port"] != port or not owned(state) or not api(port, "health"):
                    raise TownError("No healthy managed town; run hermes town start first.", 4)
                open_browser(port)
        return 0
    except TownError as error:
        print(f"hermes town: {error}", file=sys.stderr)
        return error.code
    except (OSError, ValueError, subprocess.SubprocessError):
        print("hermes town: local I/O or process operation failed; check prerequisites and private runtime permissions.", file=sys.stderr)
        return 5


def handler(args):
    # Hermes dispatchers do not all propagate handler return values.
    raise SystemExit(run(args))


def log_sink(runtime):
    runtime_dirs(runtime)
    current = runtime / "server.log"
    previous = runtime / "server.log.1"
    for path in (current, previous):
        check_file(path, missing=True)
    fd = private_open(current, os.O_WRONLY | os.O_APPEND | os.O_CREAT)
    with os.fdopen(fd, "ab", buffering=0) as initial:
        stream = initial
        try:
            while True:
                chunk = os.read(sys.stdin.fileno(), 8192)
                if not chunk:
                    break
                if stream.tell() + len(chunk) > LOG_LIMIT:
                    stream.close()
                    check_file(previous, missing=True)
                    os.replace(current, previous)
                    fd = private_open(current, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
                    stream = os.fdopen(fd, "ab", buffering=0)
                stream.write(chunk)
        finally:
            stream.close()


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--_log-sink":
        log_sink(Path(sys.argv[2]))
    else:
        parser = argparse.ArgumentParser(prog="hermes town")
        setup_parser(parser)
        handler(parser.parse_args())
