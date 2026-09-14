#!/usr/bin/env python3
"""Verify the native bridge emits only bounded lifecycle metadata."""

from __future__ import annotations

import importlib.util
import inspect
import json
import os
import queue
import re
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "integrations" / "hermes-town-plugin" / "__init__.py"
SENTINEL = "HT_PRIVATE_SENTINEL"
EXPECTED_HOOKS = {
    "pre_llm_call", "post_llm_call", "pre_tool_call", "post_tool_call",
    "on_session_start", "on_session_end", "on_session_finalize",
    "on_session_reset", "subagent_start", "subagent_stop",
}
EVENT_KEYS = {"id", "key", "kind", "role", "tool", "outcome"}
KEY_RE = re.compile(r"^h/(main|child)/[0-9a-f]{16}$")


class Context:
    def __init__(self) -> None:
        self.hooks: dict[str, list] = {}
        self.forbidden: list[str] = []

    def register_hook(self, name, callback):
        self.hooks.setdefault(name, []).append(callback)

    def __getattr__(self, name):
        if name.startswith("register_") or name.startswith("dispatch_"):
            def reject(*_args, **_kwargs):
                self.forbidden.append(name)
            return reject
        raise AttributeError(name)


def load_plugin():
    spec = importlib.util.spec_from_file_location(
        "hermes_town_release_plugin", PLUGIN,
        submodule_search_locations=[str(PLUGIN.parent)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("could not create plugin import spec")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def fire(ctx: Context, fired_hooks: set[str], name: str, **kwargs):
    callbacks = ctx.hooks.get(name, [])
    assert len(callbacks) == 1, f"{name} registered {len(callbacks)} callbacks"
    result = callbacks[0](**kwargs)
    assert result is None, f"{name} returned a control value"
    fired_hooks.add(name)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="hermes-town-privacy-") as tmp:
        token_path = Path(tmp) / "bridge-token"
        token_path.write_text("CorrectHorseBatteryStaple-0123456789-abcdef\n", encoding="utf-8")
        os.chmod(token_path, stat.S_IRUSR | stat.S_IWUSR)
        os.environ["HERMES_TOWN_BRIDGE_TOKEN_FILE"] = str(token_path)
        os.environ["HERMES_TOWN_BRIDGE_URL"] = "http://127.0.0.1:1/api/town/ingest"

        plugin = load_plugin()
        plugin._reset_bridge_for_tests()
        ctx = Context()
        plugin.register(ctx)

        assert set(ctx.hooks) == EXPECTED_HOOKS
        assert not ctx.forbidden
        for callbacks in ctx.hooks.values():
            for callback in callbacks:
                assert any(
                    p.kind is inspect.Parameter.VAR_KEYWORD
                    for p in inspect.signature(callback).parameters.values()
                )

        bridge = plugin._get_bridge()
        bridge._queue = queue.Queue(maxsize=plugin.QUEUE_LIMIT)
        bridge._ensure_worker = lambda: None
        fired_hooks: set[str] = set()

        main_id = f"{SENTINEL}-main-session"
        child_id = f"{SENTINEL}-child-session"
        private = {
            "user_message": f"{SENTINEL}-prompt",
            "conversation_history": [{"role": "user", "content": f"{SENTINEL}-history"}],
            "task_id": f"{SENTINEL}-task",
            "turn_id": f"{SENTINEL}-turn",
            "sender_id": f"{SENTINEL}-sender",
        }

        fire(ctx, fired_hooks, "on_session_start", session_id=main_id, model=f"{SENTINEL}-model")
        fire(ctx, fired_hooks, "pre_llm_call", session_id=main_id, parent_session_id="", **private)
        fire(
            ctx, fired_hooks, "pre_tool_call", tool_name=f"../../{SENTINEL}", session_id=main_id,
            args={"command": f"{SENTINEL}-command", "path": f"/{SENTINEL}/file"},
            tool_call_id=f"{SENTINEL}-tool-call",
        )
        fire(
            ctx, fired_hooks, "post_tool_call", tool_name="terminal", session_id=main_id,
            args={"command": f"{SENTINEL}-command-2"},
            result=json.dumps({"output": f"{SENTINEL}-output"}),
            status="error", error_message=f"{SENTINEL}-error",
        )
        fire(
            ctx, fired_hooks, "subagent_start", parent_session_id=main_id,
            child_session_id=child_id, child_subagent_id=f"{SENTINEL}-subagent",
            child_role="researcher", child_goal=f"{SENTINEL}-goal",
        )
        fire(
            ctx, fired_hooks, "pre_llm_call", session_id=child_id, parent_session_id=main_id,
            user_message=f"{SENTINEL}-child-prompt",
            conversation_history=[{"role": "user", "content": f"{SENTINEL}-child-history"}],
        )
        fire(
            ctx, fired_hooks, "subagent_stop", parent_session_id=main_id,
            child_session_id=child_id, child_role="researcher",
            child_summary=f"{SENTINEL}-summary", child_status="completed",
            tool_call_history=[{"tool_input": f"{SENTINEL}-input"}],
        )
        fire(
            ctx, fired_hooks, "post_llm_call", session_id=main_id,
            assistant_response=f"{SENTINEL}-assistant", user_message=f"{SENTINEL}-prompt-2",
        )
        fire(
            ctx, fired_hooks, "on_session_end", session_id=main_id, completed=True,
            failed=False, interrupted=False, turn_exit_reason=f"{SENTINEL}-reason",
        )
        fire(ctx, fired_hooks, "on_session_finalize", session_id=main_id)
        fire(ctx, fired_hooks, "on_session_reset", session_id=main_id, reason=f"{SENTINEL}-reset")
        assert fired_hooks == EXPECTED_HOOKS

        events = []
        while not bridge._queue.empty():
            events.append(bridge._queue.get_nowait())
        assert events, "hooks emitted no lifecycle events"
        encoded = json.dumps(events, sort_keys=True)
        assert SENTINEL not in encoded, "private sentinel reached the event queue"
        assert any(event.get("tool") == "tool" for event in events), "unsafe tool name was not replaced"
        for event in events:
            assert set(event) <= EVENT_KEYS
            assert KEY_RE.fullmatch(event["key"])

        assert plugin._endpoint_is_allowed("http://127.0.0.1:4187/api/town/ingest")
        assert plugin._endpoint_is_allowed("https://localhost:4187/api/town/ingest")
        assert not plugin._endpoint_is_allowed("https://example.com/collect")
        assert not plugin._endpoint_is_allowed("http://example.com/collect")
        assert not plugin._endpoint_is_allowed("file:///tmp/collect")

        print(json.dumps({
            "ok": True,
            "hooks": len(ctx.hooks),
            "events": len(events),
            "privateSentinelAbsent": True,
            "loopbackOnly": True,
        }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
