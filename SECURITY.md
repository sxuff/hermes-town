# Security policy

Hermes Town is a local visualization of Hermes lifecycle metadata. The live server binds to `127.0.0.1` by default and is not designed for public hosting.

## Supported version

Only the latest tagged release is supported.

## Report a vulnerability

Use GitHub private vulnerability reporting on this repository. Do not open a public issue containing a credential, raw Hermes identifier, prompt, tool argument, command, path, tool result, assistant response, child goal, or child summary.

## Trust boundary

- The Hermes plugin observes documented lifecycle hooks and emits only allowlisted metadata.
- The browser never receives a Hermes credential and never connects to a Hermes API, gateway, session database, transcript, or JSONL file.
- The ingest endpoint requires a local bearer token. Snapshot, event stream, and health routes are read-only but unauthenticated, so keep the server on loopback.
- Do not bind the live server to a public interface or place it behind a public tunnel.

See `LIVE_BRIDGE.md` for the complete data contract and operator runbook.
