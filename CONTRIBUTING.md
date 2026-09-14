# Contributing

Hermes Town accepts focused bug fixes and improvements that preserve the privacy and product boundaries in `AGENTS.md`, `PRODUCT.md`, and `LIVE_BRIDGE.md`.

## Development

```bash
npm ci
npm run dev
```

Use `http://127.0.0.1:5173/?agents=demo&hour=17` for visual development. Demo mode must remain visibly distinct from live Hermes activity.

## Before opening a pull request

```bash
npm run test:contracts
npm run build
npx playwright install chromium
npm run verify:world
hermes plugins doctor integrations/hermes-town-plugin --ci
```

Do not commit credentials, raw Hermes identifiers, prompts, arguments, commands, paths, outputs, responses, goals, summaries, transcripts, session databases, runtime journals, or screenshots containing private data.

Use small commits with a conventional subject such as `fix:`, `feat:`, `docs:`, or `test:`. Sign off commits with `git commit -s`.
