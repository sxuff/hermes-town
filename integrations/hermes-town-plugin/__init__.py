"""Hermes Town bridge — a passive, bounded, privacy-first lifecycle observer.

What this plugin is
-------------------
Hermes Town renders one resident per live agent execution context. This plugin
is the only thing that connects the two, and it is deliberately the smallest
possible connection: ten documented ``register(ctx)`` hooks, a bounded queue,
and one background worker that POSTs a fixed-shape envelope to a loopback URL.

It registers no tools, injects no context, returns no control directive, reads
no session transcript, and imports nothing from Hermes' private runtime. Python
standard library only.

The privacy boundary is the whole point
---------------------------------------
Hermes hands these callbacks prompts, tool arguments, terminal commands, tool
output, assistant responses, child goals, child summaries, error text, and a
fistful of raw runtime identifiers. **None of it leaves this process.**

The callbacks below read only an explicit allowlist of keyword arguments and
never touch ``args``, ``result``, ``user_message``, ``assistant_response``,
``conversation_history``, ``child_goal``, ``child_summary``,
``tool_call_history``, ``error_message``, or ``middleware_trace`` — the fields
are accepted into ``**_ignored`` and dropped unread.

The identifiers that *are* read — ``session_id``, ``parent_session_id``,
``child_session_id``, ``child_subagent_id`` — are read for two purposes only:
as HMAC input, and as a comparison between two ids. No identifier is stored,
logged or published, and the comparison result is a single bit that never
leaves the resolver.

Which resident an event belongs to
----------------------------------
Hermes runs a delegated child through the same conversation loop as the
top-level agent, so every generic session hook fires a second time carrying the
*child's* session id. Because a resident key is ``HMAC(class ‖ raw id)``, the
same id hashes to two unrelated keys in the ``main`` and ``child`` namespaces,
and a hook that reaches straight for ``main`` cannot see the child resident
``subagent_start`` already created — it mints a duplicate coordinator instead.
Every generic hook therefore goes through :func:`_resolve_session`, which
resolves the child namespace first.

What is published is built from scratch out of:

* a pseudonymous resident key: ``HMAC-SHA256`` of a raw runtime id under a
  key derived locally from the bridge token, truncated to 64 bits of hex.
  The raw id is used as HMAC input and then discarded; it is never stored,
  logged, or transmitted.
* one enumerated role category from a closed mapping table;
* one enumerated lifecycle kind;
* one enumerated outcome classification;
* a tool name matched against ``^[A-Za-z0-9_.:-]{1,64}$``, or the literal
  ``tool`` when it does not match;
* an unguessable random event id, for server-side de-duplication.

Nothing else is representable in the wire format: :func:`_publish` builds each
event dict from local variables, so a field cannot leak by being forwarded.

Hot path
--------
A hook callback validates, pseudonymises, and calls ``queue.put_nowait``. It
performs no I/O, takes no long lock, and never raises into Hermes. Delivery
happens on one bounded daemon worker with a sub-second HTTP timeout. A full
queue drops the newest event and increments a private counter; a network
failure is counted and forgotten. Hermes is never blocked, slowed past a dict
update, or altered in any way by this plugin.

Configuration
-------------
``HERMES_TOWN_BRIDGE_URL``
    Ingest endpoint. Default ``http://127.0.0.1:4187/api/town/ingest``.
    Must be an ``http`` loopback URL or an ``https`` URL.

``HERMES_TOWN_BRIDGE_TOKEN_FILE``
    Shared-secret file. Default
    ``${HERMES_HOME:-~/.hermes}/hermes-town/runtime/bridge-token``.
    Must already exist as a regular file with no group or other permission
    bits. This plugin never creates, prints, or logs the token.

When the token file is missing or weak the plugin loads, registers its hooks,
and stays inert. That is the fail-closed state: no delivery, no error, no
change to Hermes.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import queue
import re
import secrets
import stat
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Wire contract — mirrored by server/lib/contract.mjs
# ---------------------------------------------------------------------------

INGRESS_VERSION = "hermes-town.ingress.v1"

#: Lifecycle kinds the Town server accepts. Anything else is unrepresentable.
KIND_SPAWNED = "spawned"
KIND_ASSIGNED = "assigned"
KIND_TOOL_STARTED = "tool_started"
KIND_WAITING = "waiting"
KIND_COMPLETED = "completed"
KIND_FAILED = "failed"
KIND_DEPARTED = "departed"

#: The six role categories Hermes Town's district registry understands.
ROLE_COORDINATOR = "coordinator"
ROLE_RESEARCH = "research"
ROLE_FABRICATION = "fabrication"
ROLE_REVIEW = "review"
ROLE_TOOLING = "tooling"
ROLE_GENERAL = "general"

_ROLES = frozenset(
    {
        ROLE_COORDINATOR,
        ROLE_RESEARCH,
        ROLE_FABRICATION,
        ROLE_REVIEW,
        ROLE_TOOLING,
        ROLE_GENERAL,
    }
)

#: Closed mapping from an arbitrary Hermes child-role tag to one enum value.
#: A tag outside this table resolves to ``general``. The raw tag is used only
#: as a dictionary key here and is never forwarded, stored, or logged.
_CHILD_ROLE_MAP: Dict[str, str] = {
    "orchestrator": ROLE_COORDINATOR,
    "coordinator": ROLE_COORDINATOR,
    "planner": ROLE_COORDINATOR,
    "manager": ROLE_COORDINATOR,
    "lead": ROLE_COORDINATOR,
    "research": ROLE_RESEARCH,
    "researcher": ROLE_RESEARCH,
    "explore": ROLE_RESEARCH,
    "explorer": ROLE_RESEARCH,
    "analyst": ROLE_RESEARCH,
    "search": ROLE_RESEARCH,
    "build": ROLE_FABRICATION,
    "builder": ROLE_FABRICATION,
    "coder": ROLE_FABRICATION,
    "implementer": ROLE_FABRICATION,
    "engineer": ROLE_FABRICATION,
    "writer": ROLE_FABRICATION,
    "review": ROLE_REVIEW,
    "reviewer": ROLE_REVIEW,
    "critic": ROLE_REVIEW,
    "verifier": ROLE_REVIEW,
    "tester": ROLE_REVIEW,
    "auditor": ROLE_REVIEW,
    "tooling": ROLE_TOOLING,
    "tools": ROLE_TOOLING,
    "ops": ROLE_TOOLING,
    "deploy": ROLE_TOOLING,
    "deployer": ROLE_TOOLING,
    "release": ROLE_TOOLING,
    "leaf": ROLE_GENERAL,
    "general": ROLE_GENERAL,
    "worker": ROLE_GENERAL,
    "default": ROLE_GENERAL,
}

#: Closed mapping from a Hermes ``child_status`` to a Town classification.
#: A status outside this table produces *no* terminal claim at all: the child
#: simply departs. Inventing "failed" for an unrecognised status would be a
#: lie about the run.
_CHILD_STATUS_MAP: Dict[str, Tuple[str, str]] = {
    "completed": (KIND_COMPLETED, "ok"),
    "success": (KIND_COMPLETED, "ok"),
    "ok": (KIND_COMPLETED, "ok"),
    "failed": (KIND_FAILED, "error"),
    "error": (KIND_FAILED, "error"),
    "interrupted": (KIND_FAILED, "interrupted"),
    "cancelled": (KIND_FAILED, "cancelled"),
    "canceled": (KIND_FAILED, "cancelled"),
    "timeout": (KIND_FAILED, "error"),
    "timed_out": (KIND_FAILED, "error"),
}

_TOOL_NAME = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_GENERIC_TOOL = "tool"

# ---------------------------------------------------------------------------
# Bounded operational limits
# ---------------------------------------------------------------------------

QUEUE_LIMIT = 512
BODY_LIMIT_BYTES = 8 * 1024
BATCH_LIMIT = 24
HTTP_TIMEOUT_SECONDS = 0.5
#: Distinct execution contexts tracked at once. Beyond this the least recently
#: seen entry is evicted; the pseudonymous key stays deterministic either way,
#: so an evicted agent simply re-spawns on its next event.
IDENTITY_LIMIT = 512

DEFAULT_URL = "http://127.0.0.1:4187/api/town/ingest"
DEFAULT_TOKEN_RELATIVE = os.path.join("hermes-town", "runtime", "bridge-token")

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost", "[::1]"})


# ---------------------------------------------------------------------------
# Configuration and the local pseudonymisation key
# ---------------------------------------------------------------------------


def _default_token_path() -> str:
    home = os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")
    return os.path.join(home, DEFAULT_TOKEN_RELATIVE)


def _token_strength_bits(token: str) -> float:
    """Rough entropy estimate of a token string, in bits.

    Deliberately conservative: the alphabet is inferred from the character
    classes actually present, so a long string of one repeated character does
    not read as strong.
    """
    if not token:
        return 0.0
    alphabet = 0
    if any("a" <= c <= "z" for c in token):
        alphabet += 26
    if any("A" <= c <= "Z" for c in token):
        alphabet += 26
    if any("0" <= c <= "9" for c in token):
        alphabet += 10
    if any(not c.isalnum() for c in token):
        alphabet += 16
    distinct = len(set(token))
    if alphabet <= 1 or distinct < 8:
        return 0.0
    import math

    return len(token) * math.log2(min(alphabet, max(distinct, 2)))


def _read_token(path: str) -> Optional[str]:
    """Load the shared secret, or return ``None`` and stay inert.

    The token is never created here, never printed, and never logged. Only the
    *reason* a load failed is logged, and the reasons are fixed strings.
    """
    try:
        info = os.stat(path)
    except OSError:
        logger.debug("hermes-town: bridge token file is not present; bridge inert")
        return None
    if not stat.S_ISREG(info.st_mode):
        logger.warning("hermes-town: bridge token path is not a regular file; bridge inert")
        return None
    if info.st_mode & 0o077:
        logger.warning(
            "hermes-town: bridge token file is group/world accessible; bridge inert "
            "(chmod 600 the file to enable)"
        )
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            token = handle.read(4096).strip()
    except OSError:
        logger.warning("hermes-town: bridge token file could not be read; bridge inert")
        return None
    if _token_strength_bits(token) < 128:
        logger.warning("hermes-town: bridge token is too weak; bridge inert")
        return None
    return token


def _endpoint_is_allowed(url: str) -> bool:
    """Only loopback HTTP or HTTPS may receive town events."""
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return False
    if parsed.scheme not in {"http", "https"}:
        return False
    host = (parsed.hostname or "").lower()
    return host in _LOOPBACK_HOSTS


class _Bridge:
    """One process-wide bridge: identity map, queue, and delivery worker."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._identities: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
        self._queue: "queue.Queue[Dict[str, Any]]" = queue.Queue(maxsize=QUEUE_LIMIT)
        self._worker: Optional[threading.Thread] = None
        self._worker_lock = threading.Lock()
        self._nonce = secrets.token_bytes(16)
        self._counter = 0
        # Private counters. Never published, never attached to an event.
        self.dropped = 0
        self.delivered = 0
        self.delivery_failures = 0
        self.unclassified_stops = 0
        # A child whose own run_conversation ended before its parent reported
        # what really happened. Published nothing; see _on_session_end.
        self.deferred_child_ends = 0
        # Of those, the ones a later subagent_stop did classify and retire.
        # `deferred_child_ends - retired_child_ends` is exactly the number of
        # children still standing in the town with no parental verdict.
        self.retired_child_ends = 0
        # `main` residents that a later hook proved to be children, and that
        # were sent home again. See _retire_stale_main.
        self.retired_duplicates = 0

        self.url = os.environ.get("HERMES_TOWN_BRIDGE_URL", DEFAULT_URL).strip() or DEFAULT_URL
        token_path = (
            os.environ.get("HERMES_TOWN_BRIDGE_TOKEN_FILE", "").strip() or _default_token_path()
        )
        token = _read_token(token_path)
        if token is None:
            self.enabled = False
            self._auth = ""
            self._pseudonym_key = b""
            return
        if not _endpoint_is_allowed(self.url):
            logger.warning(
                "hermes-town: bridge URL is not loopback http or https; bridge inert"
            )
            self.enabled = False
            self._auth = ""
            self._pseudonym_key = b""
            return
        self.enabled = True
        self._auth = "Bearer " + token
        # A separate subkey, so the value used to blind runtime ids is not the
        # value used to authenticate. Neither ever leaves this process except
        # as the Authorization header on a loopback request.
        self._pseudonym_key = hmac.new(
            token.encode("utf-8"), b"hermes-town.pseudonym.v1", hashlib.sha256
        ).digest()

    # -- identity ----------------------------------------------------------

    def key_for(self, kind: str, raw_id: str) -> str:
        """Pseudonymous, stable resident key for one raw runtime identifier.

        ``raw_id`` is consumed as HMAC input and immediately discarded. The
        return value is the only identifier that exists downstream.
        """
        digest = hmac.new(
            self._pseudonym_key, (kind + "\x00" + raw_id).encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return "h/" + kind + "/" + digest[:16]

    def remember(self, key: str, klass: str, role: str) -> Dict[str, Any]:
        with self._lock:
            entry = self._identities.get(key)
            if entry is None:
                entry = {
                    "class": klass,
                    "role": role,
                    "spawned": False,
                    "terminal": False,
                    "completed": False,
                    # A child's own run ended, but its authoritative
                    # classification has not arrived yet. See _on_session_end.
                    "session_ended": False,
                    "pending": None,
                }
                self._identities[key] = entry
                while len(self._identities) > IDENTITY_LIMIT:
                    self._identities.popitem(last=False)
            else:
                self._identities.move_to_end(key)
            return dict(entry)

    def lookup(self, key: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            entry = self._identities.get(key)
            if entry is None:
                return None
            self._identities.move_to_end(key)
            return dict(entry)

    def update(self, key: str, **fields: Any) -> None:
        with self._lock:
            entry = self._identities.get(key)
            if entry is None:
                return
            entry.update(fields)
            self._identities.move_to_end(key)

    def next_event_id(self) -> str:
        with self._lock:
            self._counter += 1
            counter = self._counter
        digest = hashlib.sha256(self._nonce + counter.to_bytes(8, "big")).hexdigest()
        return "ev" + digest[:22]

    # -- publication -------------------------------------------------------

    def publish(
        self,
        key: str,
        kind: str,
        role: str,
        tool: Optional[str] = None,
        outcome: Optional[str] = None,
    ) -> None:
        """Enqueue exactly one bounded event. Never raises, never blocks."""
        if not self.enabled:
            return
        event: Dict[str, Any] = {
            "id": self.next_event_id(),
            "key": key,
            "kind": kind,
            "role": role if role in _ROLES else ROLE_GENERAL,
        }
        if kind == KIND_TOOL_STARTED:
            event["tool"] = tool if tool else _GENERIC_TOOL
        if outcome is not None:
            event["outcome"] = outcome
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            # Drop the newest. An old event still in the queue describes a
            # transition the town has not seen yet; a new one usually does not.
            self.dropped += 1
            return
        self._ensure_worker()

    def _ensure_worker(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        with self._worker_lock:
            if self._worker is not None and self._worker.is_alive():
                return
            worker = threading.Thread(
                target=self._run, name="hermes-town-bridge", daemon=True
            )
            self._worker = worker
            worker.start()

    def _run(self) -> None:
        while True:
            try:
                first = self._queue.get()
            except Exception:  # pragma: no cover - queue.get does not raise here
                return
            batch = [first]
            while len(batch) < BATCH_LIMIT:
                try:
                    batch.append(self._queue.get_nowait())
                except queue.Empty:
                    break
            for body in self._bodies(batch):
                self._deliver(body)

    def _bodies(self, batch):
        """Split one batch into <= 8 KiB JSON bodies."""
        pending = []
        for event in batch:
            candidate = pending + [event]
            encoded = json.dumps(
                {"v": INGRESS_VERSION, "events": candidate}, separators=(",", ":")
            ).encode("utf-8")
            if len(encoded) > BODY_LIMIT_BYTES and pending:
                yield json.dumps(
                    {"v": INGRESS_VERSION, "events": pending}, separators=(",", ":")
                ).encode("utf-8")
                pending = [event]
                continue
            pending = candidate
        if pending:
            yield json.dumps(
                {"v": INGRESS_VERSION, "events": pending}, separators=(",", ":")
            ).encode("utf-8")

    def _deliver(self, body: bytes) -> None:
        request = urllib.request.Request(
            self.url,
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": self._auth,
                "User-Agent": "hermes-town-bridge/1.0",
            },
        )
        try:
            # No proxy handler: a town event must never travel through an
            # environment proxy on its way to a loopback port.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                response.read(512)
            self.delivered += 1
        except (urllib.error.URLError, OSError, ValueError):
            # The town is a view, not a ledger: a lost frame is not worth a
            # retry loop inside somebody else's agent process.
            self.delivery_failures += 1
        except Exception:  # pragma: no cover - defensive
            self.delivery_failures += 1


_bridge: Optional[_Bridge] = None
_bridge_lock = threading.Lock()


def _get_bridge() -> _Bridge:
    global _bridge
    if _bridge is not None:
        return _bridge
    with _bridge_lock:
        if _bridge is None:
            _bridge = _Bridge()
    return _bridge


def _reset_bridge_for_tests() -> None:
    """Drop the process-wide bridge. Used by the repository's test harness."""
    global _bridge
    with _bridge_lock:
        _bridge = None


# ---------------------------------------------------------------------------
# Sanitisation
# ---------------------------------------------------------------------------


def _safe_tool(value: Any) -> str:
    """A publishable tool name, or the generic literal ``tool``."""
    if not isinstance(value, str):
        return _GENERIC_TOOL
    candidate = value.strip()
    return candidate if _TOOL_NAME.match(candidate) else _GENERIC_TOOL


def _mapped_role(value: Any) -> str:
    """One enum value from a closed table. The raw tag never escapes."""
    if not isinstance(value, str):
        return ROLE_GENERAL
    return _CHILD_ROLE_MAP.get(value.strip().lower(), ROLE_GENERAL)


def _identifier(value: Any) -> Optional[str]:
    """Accept a raw runtime id only as HMAC input, and only if it is a string."""
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate if candidate else None


# ---------------------------------------------------------------------------
# Namespace resolution
#
# Every generic session hook — ``pre_llm_call``, ``post_llm_call``,
# ``on_session_start``, ``on_session_end``, ``on_session_finalize``,
# ``on_session_reset``, ``pre_tool_call``, ``post_tool_call`` — receives a bare
# ``session_id``. Hermes runs a delegated child through the same conversation
# loop as the top-level agent, so **all of them fire again with the child's own
# session id** while that child is working.
#
# The resident key is ``HMAC(class ‖ raw id)``, so the same session id hashes to
# two different keys in the ``main`` and ``child`` namespaces. Hashing a child's
# session id in ``main`` therefore does not collide with, and cannot see, the
# ``child`` resident that ``subagent_start`` already created: it mints a second,
# permanently-active coordinator for a child that is already on screen. Every
# generic hook must resolve the child namespace first, which is what
# :func:`_resolve_session` exists to do.
# ---------------------------------------------------------------------------

#: The role a context is given when it has to be created from a generic hook,
#: before any hook that carries a role has been seen.
_DEFAULT_ROLE = {"main": ROLE_COORDINATOR, "child": ROLE_GENERAL}


def _resolve_session(
    bridge: _Bridge, session_id: Any, parent_session_id: Any = None
) -> Optional[Tuple[str, str, Optional[Dict[str, Any]]]]:
    """Resolve one raw session id to ``(class, key, entry or None)``.

    A known context wins, child namespace first: while a child is running, its
    session id is the id every generic hook carries, and the child resident is
    the only honest resident for it.

    For a context that has not been seen at all, Hermes' own declaration
    decides. ``pre_llm_call`` passes ``parent_session_id`` — the child agent's
    ``_parent_session_id`` stamp, which is empty for a top-level session and
    the parent's session id for a delegated one. Both ids are consumed here as
    a comparison and as HMAC input; neither is stored or published.
    """
    raw = _identifier(session_id)
    if raw is None:
        return None
    child_key = bridge.key_for("child", raw)
    child_entry = bridge.lookup(child_key)
    if child_entry is not None:
        return "child", child_key, child_entry
    parent = _identifier(parent_session_id)
    if parent is not None and parent != raw:
        # Hermes says this session has a parent, so it is not a top-level
        # coordinator — whatever an earlier hook that had no parentage to go on
        # may have made of it. The declaration wins over that guess.
        return "child", child_key, None
    main_key = bridge.key_for("main", raw)
    return "main", main_key, bridge.lookup(main_key)


def _retire_stale_main(bridge: _Bridge, raw: str) -> None:
    """Send home a ``main`` resident that has turned out to be a child.

    Only reachable when a hook carrying no parentage — ``on_session_start`` —
    saw a delegated child's session before ``subagent_start`` did, which needs
    the child's identity to have been evicted from the bounded map or the
    bridge to have been enabled mid-run. The duplicate departs instead of
    standing in the plaza forever, and no ending is invented for it.
    """
    key = bridge.key_for("main", raw)
    entry = bridge.lookup(key)
    if entry is None or entry.get("terminal"):
        return
    _retire(bridge, key, entry, None)
    bridge.retired_duplicates += 1


# ---------------------------------------------------------------------------
# Lifecycle: agent turns
# ---------------------------------------------------------------------------


def _ensure_resident(bridge: _Bridge, key: str, klass: str, role: str) -> Dict[str, Any]:
    """Publish ``spawned`` the first time a context is seen, or after it left."""
    entry = bridge.remember(key, klass, role)
    if not entry.get("spawned") or entry.get("terminal"):
        bridge.publish(key, KIND_SPAWNED, entry["role"])
        fresh = {"spawned": True, "terminal": False, "completed": False,
                 "session_ended": False, "pending": None}
        bridge.update(key, **fresh)
        entry = dict(entry, **fresh)
    return entry


def _on_pre_llm_call(
    session_id: Any = None, parent_session_id: Any = None, **_ignored: Any
) -> None:
    """A turn begins: the resident that owns this session takes its post.

    A top-level turn is central dispatch. A turn *inside a delegated child* is
    the child's own work, published on the child's resident with the child's
    role — never on a ``main`` resident for the same session id.

    ``user_message``, ``conversation_history`` and ``sender_id`` arrive in
    ``_ignored`` and are never read. ``parent_session_id`` is read only to
    decide which namespace an unseen session belongs to.
    """
    bridge = _get_bridge()
    if not bridge.enabled:
        return None
    resolved = _resolve_session(bridge, session_id, parent_session_id)
    if resolved is None:
        return None
    klass, key, entry = resolved
    if klass == "child":
        if entry is not None and entry.get("terminal"):
            # ``subagent_stop`` already published this child's ending. A
            # trailing turn does not resurrect a resident that has departed.
            return None
        # This is the one hook that knows a session's parentage, so it is the
        # one place a coordinator minted for a child can be recognised as such.
        _retire_stale_main(bridge, _identifier(session_id))
        entry = _ensure_resident(bridge, key, "child", (entry or {}).get("role") or ROLE_GENERAL)
        bridge.publish(key, KIND_ASSIGNED, entry["role"])
        return None
    _ensure_resident(bridge, key, "main", ROLE_COORDINATOR)
    bridge.publish(key, KIND_ASSIGNED, ROLE_COORDINATOR)
    return None


def _on_post_llm_call(session_id: Any = None, **_ignored: Any) -> None:
    """A turn produced a response. ``assistant_response`` is never read."""
    bridge = _get_bridge()
    if not bridge.enabled:
        return
    resolved = _resolve_session(bridge, session_id)
    if resolved is None:
        return
    klass, key, entry = resolved
    if entry is None or entry.get("terminal"):
        return
    if klass == "child":
        # A child's completion is not this hook's to claim. ``subagent_stop``
        # is the only callback carrying ``child_status``, and it is the only
        # place the town learns whether the child completed, failed, was
        # interrupted or was cancelled. Publishing ``completed`` here would
        # win the race and then silence the truth. The child has stopped
        # talking, so it waits; the verdict comes from its parent.
        bridge.publish(key, KIND_WAITING, entry["role"], outcome="ok")
        return
    bridge.publish(key, KIND_COMPLETED, entry["role"], outcome="ok")
    bridge.update(key, completed=True)


# ---------------------------------------------------------------------------
# Lifecycle: tools
# ---------------------------------------------------------------------------


def _on_pre_tool_call(
    tool_name: Any = None,
    session_id: Any = None,
    parent_session_id: Any = None,
    **_ignored: Any,
) -> None:
    """A tool starts. ``args`` arrives in ``_ignored`` and is never read.

    A child's tool call carries the child's session id, so it is routed to the
    child's resident and the child's district — never to a ``main`` resident
    minted for the same id.

    Returns ``None`` unconditionally: this observer never blocks, approves, or
    modifies a tool call.
    """
    bridge = _get_bridge()
    if not bridge.enabled:
        return None
    resolved = _resolve_session(bridge, session_id, parent_session_id)
    if resolved is None:
        return None
    klass, key, entry = resolved
    if entry is None:
        # An unseen context still gets a resident rather than a dropped tool
        # call, in the namespace Hermes' own parentage stamp points at.
        entry = _ensure_resident(bridge, key, klass, _DEFAULT_ROLE[klass])
    elif entry.get("terminal"):
        if klass == "child":
            # The parent has already reported this child's ending. A trailing
            # tool call is not a reason to disbelieve it.
            return None
        entry = _ensure_resident(bridge, key, klass, entry["role"])
    bridge.publish(key, KIND_TOOL_STARTED, entry["role"], tool=_safe_tool(tool_name))
    return None


def _on_post_tool_call(
    session_id: Any = None, status: Any = None, **_ignored: Any
) -> None:
    """A tool returned. ``result``, ``error_message`` and ``args`` are never read.

    Only the ok/error classification Hermes has already computed is used.
    """
    bridge = _get_bridge()
    if not bridge.enabled:
        return
    resolved = _resolve_session(bridge, session_id)
    if resolved is None:
        return
    _klass, key, entry = resolved
    # An unknown context is not invented here, and a resident that has already
    # departed is not brought back by a late tool result. `pre_tool_call`
    # re-spawns a context that is genuinely still working, so anything arriving
    # here after a departure is trailing.
    if entry is None or entry.get("terminal"):
        return
    if status == "error":
        bridge.publish(key, KIND_FAILED, entry["role"], outcome="error")
    else:
        bridge.publish(key, KIND_WAITING, entry["role"], outcome="ok")


# ---------------------------------------------------------------------------
# Lifecycle: sessions
# ---------------------------------------------------------------------------


def _on_session_start(session_id: Any = None, **_ignored: Any) -> None:
    """A session was created. Hermes fires this for a delegated child's own
    session too, after ``subagent_start`` has already given it a resident."""
    bridge = _get_bridge()
    if not bridge.enabled:
        return
    resolved = _resolve_session(bridge, session_id)
    if resolved is None:
        return
    klass, key, _entry = resolved
    if klass == "child":
        # The child's spawn, role and district are ``subagent_start``'s to
        # publish; this hook carries no role and must not mint a coordinator.
        return
    _ensure_resident(bridge, key, "main", ROLE_COORDINATOR)


def _retire(bridge: _Bridge, key: str, entry: Dict[str, Any], terminal: Optional[Tuple[str, str]]) -> None:
    if entry.get("terminal"):
        return
    # A turn that already reported its completion does not report it twice on
    # the way out: the resident would re-play its completion reaction.
    if terminal == (KIND_COMPLETED, "ok") and entry.get("completed"):
        terminal = None
    if terminal is not None:
        kind, outcome = terminal
        bridge.publish(key, kind, entry["role"], outcome=outcome)
    bridge.publish(key, KIND_DEPARTED, entry["role"])
    bridge.update(key, terminal=True, spawned=False, pending=None)


def _defer_child_end(
    bridge: _Bridge, key: str, entry: Dict[str, Any], terminal: Optional[Tuple[str, str]]
) -> None:
    """Record that a child's own run ended, and publish nothing.

    Hermes fires ``on_session_end`` at the end of *every* ``run_conversation``,
    including the one a delegated child runs for itself — and it fires it
    before ``delegate_task`` collects that child and fires ``subagent_stop``.
    Retiring the child here would publish the child's own view of its turn and
    then make the real ``child_status`` unreachable, because a retired resident
    is never retired twice: an interrupted or cancelled child would be recorded
    in the town as having completed.

    So the ending is remembered, not published. ``subagent_stop`` owns a
    child's terminal truth, and falls back to what is remembered here only when
    Hermes hands it a status the closed table does not map.
    """
    if entry.get("terminal") or entry.get("session_ended"):
        return
    bridge.update(key, session_ended=True, pending=terminal)
    bridge.deferred_child_ends += 1


def _on_session_end(
    session_id: Any = None,
    completed: Any = None,
    interrupted: Any = None,
    failed: Any = None,
    **_ignored: Any,
) -> None:
    """A run finished. Only the three booleans Hermes already computed are read."""
    bridge = _get_bridge()
    if not bridge.enabled:
        return
    resolved = _resolve_session(bridge, session_id)
    if resolved is None:
        return
    klass, key, entry = resolved
    if entry is None:
        return
    if interrupted is True:
        terminal = (KIND_FAILED, "interrupted")
    elif failed is True:
        terminal = (KIND_FAILED, "error")
    elif completed is True:
        terminal = (KIND_COMPLETED, "ok")
    else:
        terminal = None
    if klass == "child":
        _defer_child_end(bridge, key, entry, terminal)
        return
    _retire(bridge, key, entry, terminal)


def _on_session_finalize(session_id: Any = None, **_ignored: Any) -> None:
    _retire_by_session(session_id)


def _on_session_reset(session_id: Any = None, **_ignored: Any) -> None:
    _retire_by_session(session_id)


def _retire_by_session(session_id: Any) -> None:
    bridge = _get_bridge()
    if not bridge.enabled:
        return
    resolved = _resolve_session(bridge, session_id)
    if resolved is None:
        return
    klass, key, entry = resolved
    if entry is None:
        return
    if klass == "child":
        # Same race as ``on_session_end``: a session boundary that happens to
        # carry a child's session id must not depart a resident whose parent
        # has not reported on it yet.
        _defer_child_end(bridge, key, entry, None)
        return
    _retire(bridge, key, entry, None)


# ---------------------------------------------------------------------------
# Lifecycle: subagents
# ---------------------------------------------------------------------------


def _on_subagent_start(
    child_session_id: Any = None,
    child_subagent_id: Any = None,
    child_role: Any = None,
    **_ignored: Any,
) -> None:
    """A child agent was constructed. ``child_goal`` is never read.

    The child is keyed on its session id when it has one, because that is the
    id its own tool hooks will carry; the subagent id is the fallback.
    """
    bridge = _get_bridge()
    if not bridge.enabled:
        return
    raw = _identifier(child_session_id) or _identifier(child_subagent_id)
    if raw is None:
        return
    role = _mapped_role(child_role)
    key = bridge.key_for("child", raw)
    previous = bridge.remember(key, "child", role)
    if previous.get("role") != role:
        # A reused context with a different role is a different resident to the
        # town, so it re-spawns instead of silently changing costume.
        bridge.update(key, role=role, spawned=False, terminal=False)
    entry = _ensure_resident(bridge, key, "child", role)
    bridge.publish(key, KIND_ASSIGNED, entry["role"])


def _on_subagent_stop(
    child_session_id: Any = None,
    child_subagent_id: Any = None,
    child_status: Any = None,
    **_ignored: Any,
) -> None:
    """A child agent finished. ``child_summary`` and ``tool_call_history``
    arrive in ``_ignored`` and are never read."""
    bridge = _get_bridge()
    if not bridge.enabled:
        return
    raw = _identifier(child_session_id) or _identifier(child_subagent_id)
    if raw is None:
        return
    key = bridge.key_for("child", raw)
    entry = bridge.lookup(key)
    if entry is None:
        return
    status = child_status.strip().lower() if isinstance(child_status, str) else ""
    terminal = _CHILD_STATUS_MAP.get(status)
    if terminal is None:
        if status:
            bridge.unclassified_stops += 1
        # Nothing was invented for an unmapped status, but the child's own
        # ``on_session_end`` may have computed one from Hermes' own booleans.
        # That is a real classification, held back rather than published, so
        # using it here is reporting what happened — not guessing.
        terminal = entry.get("pending")
    if entry.get("session_ended") and not entry.get("terminal"):
        bridge.retired_child_ends += 1
    _retire(bridge, key, entry, terminal)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

HOOKS = (
    ("pre_llm_call", _on_pre_llm_call),
    ("post_llm_call", _on_post_llm_call),
    ("pre_tool_call", _on_pre_tool_call),
    ("post_tool_call", _on_post_tool_call),
    ("on_session_start", _on_session_start),
    ("on_session_end", _on_session_end),
    ("on_session_finalize", _on_session_finalize),
    ("on_session_reset", _on_session_reset),
    ("subagent_start", _on_subagent_start),
    ("subagent_stop", _on_subagent_stop),
)


def register(ctx) -> None:
    """Register ten passive observers. No tools, no commands, no middleware.

    Nothing here opens a socket, reads a token more than once, or blocks: the
    bridge is constructed lazily on the first hook firing, and the delivery
    worker starts on the first enqueued event.
    """
    for name, callback in HOOKS:
        ctx.register_hook(name, callback)
