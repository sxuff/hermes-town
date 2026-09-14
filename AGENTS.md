# Hermes Town operating contract

## Read before changing the project

1. `README.md` for the supported workflows.
2. `PRODUCT.md` for the product boundary.
3. `LIVE_BRIDGE.md` for the plugin, server, and privacy contract.
4. `SECURITY.md` for reporting and deployment constraints.

## Product principle

Hermes is the runtime. The town is the interface.

Every visible resident action maps to a real lifecycle event. Ambient smoke, sparks, lamps, foliage, and weather are presentation only. They must never imply work that did not happen.

## Current architecture

- Phaser 3, Vite, and strict TypeScript.
- 16 px navigation tiles and nearest-neighbor rendering.
- One authored town embedded in a larger countryside.
- Simulation code under `src/sim/` contains no Phaser imports.
- Tool name to place and work style is centralized in `src/sim/toolMap.ts`.
- The browser reads only the same-host Town snapshot and SSE endpoints.
- The native Hermes plugin uses documented hooks and publishes an allowlisted payload.

## Boundaries

- Never read Hermes transcripts, session databases, or raw JSONL.
- Never publish prompts, messages, arguments, commands, paths, outputs, responses, goals, summaries, raw errors, identifiers, or credentials.
- Keep the live server on loopback. Public showcases use demo mode with no Hermes connection.
- Unknown values remain unknown. Do not convert missing data to false, zero, success, or failure.
- Do not add fictional residents or autonomous NPC chatter.

## Working method

- Keep `src/main.ts` focused on boot and HUD wiring.
- Keep server and plugin payloads allowlist-only.
- Add a regression test before changing a privacy or lifecycle contract.
- Run `npm run test:contracts`, `npm run build`, and `npm run verify:world` before release.
- Validate the plugin with `hermes plugins doctor integrations/hermes-town-plugin --ci`.
- Exercise demo and disconnected-live states in a real browser.
