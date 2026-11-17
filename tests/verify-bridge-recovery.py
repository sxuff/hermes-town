#!/usr/bin/env python3
"""Verify the bridge recovers when the token appears after the first hook.

The bridge is a process-wide singleton built on the first lifecycle hook. When
the plugin is enabled before ``hermes town start`` has written the token file,
that first hook builds a bridge that can never deliver. The token is written by
a separate command that may run at any point relative to the gateway's first
turn, so the bridge must be able to recover on its own rather than require a
gateway restart the plugin cannot ask for.
"""

from __future__ import annotations

import importlib.util
import os
import secrets
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "integrations" / "hermes-town-plugin" / "__init__.py"

FAILURES: list[str] = []


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  ok   {message}")
    else:
        print(f"  FAIL {message}")
        FAILURES.append(message)


def load_plugin(home: Path):
    """Import the plugin with HERMES_HOME pointing at a temporary home."""
    os.environ["HERMES_HOME"] = str(home)
    spec = importlib.util.spec_from_file_location("hermes_town_bridge", PLUGIN)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_token(home: Path) -> Path:
    """Write a token the bridge will accept.

    The bridge requires at least 128 bits of estimated entropy, so the token
    has to be random: a repeated character is rejected as too weak.
    """
    runtime = home / "hermes-town" / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    token = runtime / "bridge-token"
    token.write_text(secrets.token_hex(32), encoding="utf-8")
    os.chmod(token, stat.S_IRUSR | stat.S_IWUSR)
    return token


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        home = Path(tmp)
        module = load_plugin(home)

        # The token does not exist yet: the bridge must start inert.
        bridge = module._get_bridge()
        check(bridge.enabled is False, "bridge is inert before the token exists")

        # A hook runs while the bridge is inert. It must not raise, and it must
        # not publish anything.
        module._on_session_start(session_id="session-before-token")
        check(bridge.enqueued == 0, "no event is queued while the bridge is inert")

        # The Town CLI writes the token.
        write_token(home)

        # The next hook must recover the bridge by itself.
        module._on_session_start(session_id="session-after-token")
        check(bridge.enabled is True, "bridge enables itself once the token exists")
        check(bridge.enqueued >= 1, "the event that follows the token is queued")

        # The resident key must be minted from the real pseudonym key, so the
        # same session id always maps to the same resident.
        key = bridge.key_for("main", "session-after-token")
        check(
            key.startswith("h/main/") and len(key.split("/")[-1]) == 16,
            "the resident key is a town key minted from the real pseudonym key",
        )
        check(
            bridge.key_for("main", "session-after-token") == key,
            "the resident key is stable across calls",
        )

        # A resident registered while the bridge was inert must not survive as
        # an orphan under a different key.
        orphans = [
            k for k, entry in bridge._identities.items()
            if k.startswith("h/main/") and not entry.get("published")
        ]
        check(not orphans, "no orphan resident is left behind by the recovery")

    if FAILURES:
        print(f"\n{len(FAILURES)} check(s) failed")
        return 1
    print("\nbridge recovery verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
