# Hermes Town native plugin

A passive lifecycle observer for [Hermes Town](https://github.com/sxuff/hermes-town). It renders one pseudonymous resident per Hermes execution context without reading what the agent is working on.

This directory is the source package used by the developer-preview installer:

```bash
node scripts/install-hermes-town-plugin.mjs
```

The installer copies `plugin.yaml`, `__init__.py`, and this README into `<hermes home>/plugins/hermes-town/`, then creates a local bridge token if one does not exist. It does not enable the plugin, edit configuration, restart Hermes, or start the Town server.

## Registered hooks

- `pre_llm_call`
- `post_llm_call`
- `pre_tool_call`
- `post_tool_call`
- `on_session_start`
- `on_session_end`
- `on_session_finalize`
- `on_session_reset`
- `subagent_start`
- `subagent_stop`

The plugin registers no tools, commands, middleware, or prompt context. Pre-call hooks always return `None`.

## Published fields

Each event can contain only:

- `id`: random event identifier for de-duplication
- `key`: HMAC-derived `h/<main|child>/<16 hex>` resident key
- `kind`: closed lifecycle enum
- `role`: closed role enum
- `tool`: sanitized tool name on `tool_started`
- `outcome`: closed outcome enum when applicable

All other callback fields are ignored. The queue is bounded to 512 events, delivery uses one daemon worker, request bodies are capped at 8 KiB, and the HTTP timeout is 0.5 seconds.

## Configuration

| Variable | Default |
|---|---|
| `HERMES_TOWN_BRIDGE_URL` | `http://127.0.0.1:4187/api/town/ingest` |
| `HERMES_TOWN_SKILL_NAMES` | unset. Set to `1` to publish the skill name a `skill_view` or `skill_manage` call asks for, so the town gives each skill its own market stall. Nothing else from tool arguments is ever read. |
| `HERMES_TOWN_BRIDGE_TOKEN_FILE` | `${HERMES_HOME:-~/.hermes}/hermes-town/runtime/bridge-token` |

Only loopback HTTP or HTTPS endpoints are accepted. The token must be a regular file with at least 128 estimated bits of entropy. On POSIX systems it must have no group or other permission bits.

## Validate

```bash
hermes plugins doctor integrations/hermes-town-plugin --ci
python3 tests/verify-plugin-privacy.py
```
