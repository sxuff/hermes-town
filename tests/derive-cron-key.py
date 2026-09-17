#!/usr/bin/env python3
"""Print the Town resident key the plugin derives for one cron session.

Used by tests/verify-cron-seed.mjs to pin cross-language agreement: the server
derives keeper keys in Node from the scheduler's job ids, and this reports what
the actual plugin derives for the same input. Reads a token file given by
HERMES_TOWN_BRIDGE_TOKEN_FILE, prints only the derived key, and writes nothing.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "integrations" / "hermes-town-plugin" / "__init__.py"


def load_plugin():
    spec = importlib.util.spec_from_file_location(
        "hermes_town_cron_key_plugin", PLUGIN,
        submodule_search_locations=[str(PLUGIN.parent)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("could not create plugin import spec")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    if not os.environ.get("HERMES_TOWN_BRIDGE_TOKEN_FILE"):
        raise RuntimeError("HERMES_TOWN_BRIDGE_TOKEN_FILE is required")
    if len(sys.argv) != 2:
        raise RuntimeError("usage: derive-cron-key.py <job-id>")
    plugin = load_plugin()
    plugin._reset_bridge_for_tests()
    ctx_hooks: dict = {}

    class Context:
        def register_hook(self, name, callback):
            ctx_hooks.setdefault(name, []).append(callback)

    plugin.register(Context())
    bridge = plugin._get_bridge()
    if not bridge.enabled:
        raise RuntimeError("bridge is inert; the token file must be strong and private")
    # The same two calls the plugin makes for a cron_<id>_<stamp> session.
    print(bridge.key_for("cron", sys.argv[1]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
