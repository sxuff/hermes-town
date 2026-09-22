# Contributing

Hermes Town accepts focused bug fixes and improvements that preserve the privacy and product boundaries in `AGENTS.md`, `PRODUCT.md`, and `LIVE_BRIDGE.md`.

## Development

```bash
npm ci
npm run dev
```

Use `http://127.0.0.1:5173/?agents=demo&hour=17` for visual development. Demo mode must remain visibly distinct from live Hermes activity.

## Packaged runtime

End users install the prebuilt `integrations/hermes-town-plugin/runtime/` directory at a reviewed commit. After frontend, server, dependency, or build-configuration changes, run `npm run package:plugin` and include the refreshed runtime in the same change. A clean build followed by `npm run check:package` must pass; do not fix drift by editing the manifest alone. No install-time downloads or self-updates are permitted.

For integration with an installed Hermes environment, run `python3 tests/verify-native-hermes.py --hermes /path/to/hermes`. It installs into a temporary home, enables the plugin, exercises the actual native command dispatcher and lifecycle registry with synthetic events, verifies public privacy, and stops its own server. It never calls an LLM or touches your normal profile.

## Before opening a pull request

```bash
npm run test:contracts
npm run build
npm run test:onboarding
npx playwright install chromium
npm run verify:characters
npm run verify:world
npm run verify:onboarding
hermes plugins doctor integrations/hermes-town-plugin --ci
```

Do not commit credentials, raw Hermes identifiers, prompts, arguments, commands, paths, outputs, responses, goals, summaries, transcripts, session databases, runtime journals, or screenshots containing private data.

Use small commits with a conventional subject such as `fix:`, `feat:`, `docs:`, or `test:`. Sign off commits with `git commit -s`.
