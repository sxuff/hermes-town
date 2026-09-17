#!/usr/bin/env python3
"""Emit a small real plugin lifecycle to a test Town server."""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "integrations" / "hermes-town-plugin" / "__init__.py"
SENTINEL = "HT_DELIVERY_PRIVATE_SENTINEL"


class Context:
    def __init__(self) -> None:
        self.hooks: dict[str, list] = {}

    def register_hook(self, name, callback):
        self.hooks.setdefault(name, []).append(callback)


def load_plugin():
    spec = importlib.util.spec_from_file_location(
        "hermes_town_delivery_plugin", PLUGIN,
        submodule_search_locations=[str(PLUGIN.parent)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("could not create plugin import spec")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    if not os.environ.get("HERMES_TOWN_BRIDGE_URL"):
        raise RuntimeError("HERMES_TOWN_BRIDGE_URL is required")
    if not os.environ.get("HERMES_TOWN_BRIDGE_TOKEN_FILE"):
        raise RuntimeError("HERMES_TOWN_BRIDGE_TOKEN_FILE is required")

    plugin = load_plugin()
    plugin._reset_bridge_for_tests()
    ctx = Context()
    plugin.register(ctx)
    session_id = f"{SENTINEL}-session"

    def fire(name, **kwargs):
        callbacks = ctx.hooks.get(name, [])
        assert len(callbacks) == 1
        assert callbacks[0](**kwargs) is None

    fire(name="on_session_start", session_id=session_id)
    fire(
        name="pre_llm_call", session_id=session_id, parent_session_id="",
        user_message=f"{SENTINEL}-prompt", conversation_history=[],
    )
    fire(
        name="pre_tool_call", tool_name="read_file", session_id=session_id,
        args={"path": f"/{SENTINEL}/private"},
    )
    fire(
        name="post_tool_call", tool_name="read_file", session_id=session_id,
        args={"path": f"/{SENTINEL}/private"}, result=f"{SENTINEL}-output", status="ok",
    )
    fire(
        name="on_session_end", session_id=session_id,
        completed=True, failed=False, interrupted=False,
    )

    # An empty queue is not a finished delivery: the worker drains the queue
    # before it POSTs the batch, so wait until every enqueued event has had
    # its delivery attempt. Otherwise this process can exit with the final
    # batch still in flight on the daemon thread, and the town never sees it.
    bridge = plugin._get_bridge()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if bridge.enqueued > 0 and bridge.processed == bridge.enqueued:
            break
        time.sleep(0.05)
    ok = (bridge.enqueued > 0 and bridge.processed == bridge.enqueued
          and bridge.delivery_failures == 0)
    print(json.dumps({
        "ok": ok,
        "deliveredBatches": bridge.delivered,
        "enqueued": bridge.enqueued,
        "processed": bridge.processed,
        "deliveryFailures": bridge.delivery_failures,
        "queueEmpty": bridge._queue.empty(),
    }))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
