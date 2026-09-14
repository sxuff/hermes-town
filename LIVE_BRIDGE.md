# Live Hermes bridge

Hermes Town turns lifecycle metadata from a running Hermes process into residents and movement without reading the content of the work.

## Architecture

```text
Hermes process
  │ documented native plugin hooks
  │ validate, HMAC-pseudonymize, enqueue
  ▼
integrations/hermes-town-plugin
  │ bounded batches over authenticated loopback HTTP
  ▼
server/
  │ strict ingress schema, durable bounded journal
  ├─ GET /api/town/snapshot
  ├─ GET /api/town/events
  ├─ GET /api/town/health
  └─ static dist/
  ▼
src/live/liveSource.ts
  │ snapshot, SSE, incremental polling fallback
  ▼
src/sim/town.ts → src/scenes/TownScene.ts
```

## Trust boundaries

- Hermes runs the native plugin in-process. The callbacks receive normal Hermes hook payloads, but the plugin reads only a small allowlist.
- The plugin sends events only to loopback HTTP or HTTPS. It bypasses environment proxies.
- The ingest route is the only writer and requires a bearer token.
- Snapshot, SSE, and health routes are read-only and unauthenticated. Keep the server bound to loopback.
- The browser receives no Hermes credential and never connects to a Hermes API, gateway, transcript, session database, or JSONL file.

## Wire contract

The plugin can publish only:

- `id`: random event identifier used for de-duplication
- `key`: `h/<main|child>/<16 hex>`, derived from a raw execution-context identifier with HMAC-SHA256
- `kind`: `spawned`, `assigned`, `tool_started`, `waiting`, `completed`, `failed`, or `departed`
- `role`: `coordinator`, `research`, `fabrication`, `review`, `tooling`, or `general`
- `tool`: a value matching `^[A-Za-z0-9_.:-]{1,64}$`, otherwise `tool`
- `outcome`: `ok`, `error`, `interrupted`, or `cancelled`

The server rejects an entire request if an event contains any unknown field. It does not strip an unexpected field and continue.

The following data has no field in the contract:

- prompts and user messages
- conversation history
- child goals and summaries
- tool arguments and terminal commands
- paths and filenames
- tool output and assistant responses
- raw error messages
- raw Hermes session, task, turn, tool-call, subagent, user, or chat identifiers
- credentials

The raw execution-context identifier is used only as HMAC input and is then discarded. Public display names are derived from the role and the last four characters of the pseudonymous key.

## Plugin behavior

The plugin registers ten passive hooks:

| Hook | Town effect |
|---|---|
| `on_session_start` | creates the main resident if needed |
| `pre_llm_call` | assigns the resident |
| `post_llm_call` | records a waiting state without claiming task success |
| `pre_tool_call` | sends the resident to the tool's work place |
| `post_tool_call` | records waiting or a bounded failure state |
| `subagent_start` | creates a child resident with a closed role mapping |
| `subagent_stop` | classifies the child outcome and sends it home |
| `on_session_end` | classifies and retires a main resident |
| `on_session_finalize` | retires a main resident when applicable |
| `on_session_reset` | retires the previous main resident |

A delegated child runs the same generic session hooks as its parent. Namespace resolution therefore checks the child namespace first and uses Hermes' `parent_session_id` stamp before falling back to a main resident. This prevents a child from creating a second coordinator resident.

Only `subagent_stop` carries the parent's final child status. A child's own session ending is deferred rather than published as an optimistic completion. If the parent status never arrives, the child remains visible instead of receiving an invented outcome.

Every hook validates, pseudonymizes, and calls `queue.put_nowait`. Network delivery happens on one daemon worker.

| Limit | Value |
|---|---|
| Queue | 512 events, newest dropped on overflow |
| Batch | up to 24 events |
| Request body | at most 8 KiB |
| HTTP timeout | 0.5 seconds |
| Retry | none |
| Dependencies | Python standard library only |

## Server behavior

- Node standard library only.
- 8 KiB request cap enforced while streaming.
- Up to 32 events accepted per request.
- 256 residents and 48 recent events per resident retained.
- 8,192 ingress event IDs retained for de-duplication.
- Server-owned cursor, per-resident sequence, and monotonic epoch clock.
- Bounded JSONL journal compacted atomically.
- Snapshot catch-up after a disconnect.
- SSE replay using `Last-Event-ID`.
- Incremental snapshot polling when a proxy accepts but buffers SSE frames.
- Explicit disconnected state with no fallback to demo residents.
- Security headers including CSP `connect-src 'self'`, no CORS headers, and `X-Frame-Options: DENY`.

The public v1 contract retains a role-derived `district` field for compatibility with the earlier renderer. The current 2D client ignores that field and maps tool names to places locally in `src/sim/toolMap.ts`.

## Run modes

| URL | Source |
|---|---|
| `/` | live snapshot and SSE |
| `/?agents=demo` | scripted browser demo |
| `/?agents=demo&hour=17` | scripted demo with fixed time of day |

A disconnected live page stays empty and says `disconnected`. It never substitutes demo residents.

## What a fresh client sees

A full snapshot describes the town as it is now, not the journal's history.
The server leaves out residents that have departed and residents nothing has
been heard from for fifteen minutes (`LIMITS.staleSeconds`); their journal
entries stay retained for the stream and for incremental catch-up. The
snapshot reports how many it left out as `omitted: { departed, stale }`, and
the town's status line shows that count as past sessions not shown. Residents
that are in the snapshot appear where they are, without walking in from the
gate.

In the browser, a resident with no event for ten minutes walks home on its
own and sits on its porch for half an hour before it is forgotten. A new event
for that session wakes it up. Nothing here claims Hermes ended the session; it
is only what the town shows when the stream goes quiet.

## Operator runbook

### 1. Install the source package

From the repository root:

```bash
npm run install:plugin
# Or choose a Hermes home explicitly:
node scripts/install-hermes-town-plugin.mjs --hermes-home /path/to/hermes-home
```

This copies the plugin files and creates a 32-byte random bridge token with mode `0600` on POSIX systems. The token value is never printed.

### 2. Validate and enable

```bash
hermes plugins doctor ~/.hermes/plugins/hermes-town --ci
hermes plugins enable hermes-town
hermes plugins list --plain --no-bundled
```

### 3. Build and start the local server

```bash
npm ci
npm run build
npm run serve:live
```

Defaults:

- server: `http://127.0.0.1:4187`
- token: `$HERMES_HOME/hermes-town/runtime/bridge-token`
- journal: `runtime/town-journal.jsonl`
- static files: `dist/`

Server flags include `--port`, `--host`, `--token-file`, `--journal`, `--static`, `--no-static`, and `--heartbeat-seconds`. The `--host` value is restricted to `127.0.0.1`, `localhost`, or `::1`.

### 4. Restart the observed Hermes process

```bash
hermes gateway restart
# Or start a new Hermes CLI session.
```

### 5. Open the town

```text
http://127.0.0.1:4187/
```

Drive a real tool call or delegated run and watch the corresponding resident activity.

### Disable and remove

```bash
hermes plugins disable hermes-town
rm -rf ~/.hermes/plugins/hermes-town
rm -f ~/.hermes/hermes-town/runtime/bridge-token
```

Disabling the plugin is sufficient to stop observation. Stopping the Town server is independent.

## Verification

```bash
npm run test:contracts
npm run build
npx playwright install chromium
npm run verify:world
hermes plugins doctor integrations/hermes-town-plugin --ci
```

`tests/verify-plugin-privacy.py` registers all ten hooks, fires each one with private sentinel values, and checks the captured queue. `tests/verify-server-contract.mjs` exercises loopback-only binding, authenticated and unauthenticated HTTP ingress, unknown-field rejection, real plugin delivery, the public snapshot, security headers, and token/path absence. `scripts/verify-world.mjs` exercises the actual browser UI and simulation.
