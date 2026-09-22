# Hermes Town

A local pixel-art interface for Hermes Agent. Every resident represents a real Hermes execution context. Tool calls send residents to the library, workshop, forge, post office, observatory, or town hall. Completed sessions rest at the tavern and eventually walk home.

![Hermes Town](artifacts/world-remodel.png)

> v0.3.0 packages the bridge, local server, and prebuilt town together. Runtime use needs Hermes and Node.js, not a repository checkout, npm, or a frontend build. Catalog availability follows a separately reviewed pin update.

## Requirements

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) 0.21.2, the validated preview baseline
- Node.js `^20.19.0` or `>=22.12.0`
- npm only for contributors building from source

## Try the demo

A scripted demo runs at [sxuff.github.io/hermes-town](https://sxuff.github.io/hermes-town/). Every session on that page is simulated in the browser; nothing there connects to a Hermes runtime.

To run the same demo locally:

```bash
git clone https://github.com/sxuff/hermes-town.git
cd hermes-town
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/?agents=demo&hour=17`.

## Connect a local Hermes runtime

### Packaged plugin (v0.3.0 and later)

Once the catalog entry points to a release containing this runtime:

```bash
hermes plugins install hermes-town
hermes plugins enable hermes-town
hermes town start
```

Open the printed local URL, normally `http://127.0.0.1:4187/`. Use `hermes town start --open` to also open a browser on a machine with a graphical session.

Start a **new Hermes CLI session**, or restart the gateway you want to observe, then run a turn. Installing/enabling the plugin does not reload an already-running process. Town never restarts Hermes for you.

```bash
hermes town status          # setup, server ownership, first-event diagnostics
hermes town status --json   # machine-readable diagnostics
hermes town stop            # stop only this profile's managed Town server
hermes town open            # reopen the browser
hermes town setup           # optional prerequisite/token check without starting
```

`start` creates a private token if needed and launches the bundled server on loopback. Repeating it reuses the same healthy managed process. `stop` authenticates that exact process with a separate private management secret, never a PID from a stale file. It does not disable the Hermes plugin. The server is not a login service: after reboot, run `hermes town start` again.

**Already installed v0.2.0?** It contains the bridge only. These commands will not appear until a new release is published, its catalog pin is reviewed, and you run `hermes plugins update hermes-town`. The plugin never downloads replacements for its reviewed code.

### Profiles and remote hosts

Use the same profile for Town and the Hermes process you observe:

```bash
hermes -p work town start
hermes -p work town status
hermes -p work town stop
```

State stays under that profile's Hermes home. Multiple profiles on one host need distinct ports and matching `HERMES_TOWN_BRIDGE_URL=http://127.0.0.1:PORT/api/town/ingest` in both the observed Hermes process and the Town CLI environment. A port mismatch is refused, not silently "connected". `hermes town start --port PORT` must match that setting. Managed mode uses the profile's token; external token paths and HTTPS ingest setups remain advanced/manual deployments.

Run Town **on the Hermes host**. On a remote host, the printed loopback address is remote too. Use a private SSH forward to view it locally; never expose the unauthenticated live snapshot/SSE routes through a public tunnel. Browser opening is opt-in and explains when no graphical session is available.

### What "connected" means

- **Local setup ready:** `hermes town status` checks the packaged files, Node.js, and private token.
- **Server ready:** the browser can reach Town. This alone does not prove the plugin is loaded.
- **Hermes events received:** accepted events arrived during this server run. The UI shows the last-event age. It does not infer current health or task success from silence.

Cron keepers and journal replay do not count as new bridge delivery. Before the first event, expand **Connect Hermes** for setup guidance. The CLI reports the observed process's plugin-loading state as unknown rather than inventing it.

### Contributors: install from this checkout

```bash
npm ci
npm run package:plugin
npm run install:plugin
hermes plugins doctor integrations/hermes-town-plugin --ci
hermes plugins enable hermes-town
hermes town start
```

The installer does not enable anything, edit configuration, or restart Hermes. To select a home, use `node scripts/install-hermes-town-plugin.mjs --hermes-home /path/to/hermes-home`. It leaves catalog-managed plugin bytes untouched. The prebuilt `integrations/hermes-town-plugin/runtime/` directory is part of the reviewed release; `npm run check:package` rejects stale or tampered bundle contents.

For manual foreground service deployment, `npm run build && npm run serve:live` remains available. See [the advanced runbook](LIVE_BRIDGE.md#operator-runbook).

## Privacy model

The plugin publishes only:

- a pseudonymous resident key derived with HMAC
- one of seven role classes
- one of seven lifecycle kinds
- a sanitized tool name when a tool starts
- one of four outcome classifications
- a skill name, only when `HERMES_TOWN_SKILL_NAMES=1` opts in

Prompts, messages, tool arguments, commands, paths, tool output, assistant responses, child goals, summaries, raw errors, raw runtime identifiers, and credentials have no field in the wire contract. The plugin and server both enforce allowlists.

The live server is for same-host use. It binds to `127.0.0.1`, sends no CORS headers, and serves an authenticated ingest endpoint plus read-only snapshot, SSE, and health routes. Do not expose a live town publicly. If you want a public showcase, use demo mode with no Hermes connection.

See [LIVE_BRIDGE.md](LIVE_BRIDGE.md) for the full contract and runbook.

## How events become behaviour

A session is one resident, the coordinator. It thinks at a hall desk. Every
tool call dispatches a runner: a smaller figure that leaves the desk, goes to
that tool's building, works there for a few real seconds, and walks back with
the result (a tick, or smoke if the tool failed). A turn with six tool calls
is six runners fanning out across town while the coordinator sits thinking.
When the turn ends the coordinator walks to the notice board in the square,
pins the result, and goes to stand at its own front door with a "waiting for
you" bubble until the next turn. Ten minutes of silence and it sits down on
the porch; half an hour later it is forgotten. Subagents are full residents
with their own runners. Sessions from earlier today sit dim on their porches.

Every figure on screen is one session, one subagent, or one tool call. Nothing
is invented to fill the frame.

The director (a HUD toggle, on by default) follows whoever most recently had
something happen when three or fewer sessions are active, at 3x, and backs
off for 45 seconds whenever you move the camera yourself.

The tool-to-building table in `src/sim/toolMap.ts` covers the Hermes tool
registry and the common Claude Code names. Unknown tools go to the market.

## Controls

- Drag to pan.
- Scroll to zoom.
- Click a resident to inspect it.
- Use the bottom buttons to focus a building.
- Toggle Follow to track the selected resident.
- Click the minimap to jump.

## Project layout

```text
src/art/        Sprite import, terrain, structures, and character poses
src/assets/     Original runtime sprite atlases
src/world/      Authored town, countryside, collision, and pathfinding
src/sim/        Resident state, intents, stations, and tool-to-place mapping
src/live/       Live SSE and scripted demo sources
src/scenes/     Phaser rendering, camera, lighting, and particles
server/         Same-host static, snapshot, SSE, and ingest server
integrations/   Passive native Hermes bridge plugin
scripts/        Installation and browser verification
```

## Verification

```bash
npm ci
npm run test:contracts
npm run build
npm run test:onboarding
npx playwright install chromium
npm run verify:characters
npm run verify:world
npm run verify:onboarding
hermes plugins doctor integrations/hermes-town-plugin --ci
```

`test:contracts` checks the plugin privacy allowlist, the real HTTP server contract, and cron keeper pre-registration, including cross-language key agreement with the plugin. `verify:characters` checks neutral arm symmetry, tool visibility, sprite bounds, distance-driven gait, workstation transitions, and event-driven reactions in Chromium. `verify:world` exercises navigation, resident lifecycle behavior, camera controls, offline-live honesty, and visual captures in Chromium.

For character review, run `npm run build && node scripts/capture-characters.mjs`. It exports sprite atlases and captures the production renderer using explicitly scripted events, with live endpoints blocked. Images and metadata are saved under `output/playwright/characters/`; these are test fixtures, not live Hermes activity.

## License

Hermes Town, including the code and shipped original assets, is licensed under the [MIT License](LICENSE).
