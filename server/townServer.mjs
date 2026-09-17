// The Hermes Town live server.
//
// One same-host Node process with four responsibilities and no dependencies:
//
//   1. authenticate and validate a bounded ingress stream from the native
//      Hermes plugin, on a single POST route;
//   2. number, persist and de-duplicate what survives, into a bounded journal;
//   3. serve the built app, a read-only public snapshot, and an SSE stream
//      with cursor replay, all same-origin;
//   4. never let anything else through.
//
// Trust boundary: the ingress route is the only authenticated surface and the
// only writer. The public routes are read-only, unauthenticated, same-origin,
// and serve exactly the sanitised events the ingress route produced. The bearer
// token is read once at boot and never appears in a response, a log line, or
// the health record.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { LIVE_SOURCE_LABEL, PUBLIC_VERSION } from './lib/contract.mjs';
import { parseIngressBody } from './lib/ingress.mjs';
import { createTownState } from './lib/townState.mjs';
import { contentTypeFor, resolveStatic } from './lib/staticFiles.mjs';

/** Ingress bodies are capped hard: the plugin never sends more than 8 KiB. */
export const MAX_INGRESS_BYTES = 8 * 1024;

/** Minimum estimated entropy of the shared secret, in bits. */
export const MIN_TOKEN_BITS = 128;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function isLoopbackHost(host) {
  return typeof host === 'string' && LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
  // Same-origin everything. `connect-src 'self'` is what keeps the browser
  // from talking to a Hermes gateway directly; `frame-ancestors 'none'` keeps
  // the town out of somebody else's page. Inline styles are allowed because
  // the app sets CSS custom properties through the CSSOM.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
});

/**
 * Conservative entropy estimate: the alphabet is inferred from the character
 * classes actually present, and a string with few distinct characters scores
 * zero however long it is.
 */
export function tokenStrengthBits(token) {
  if (typeof token !== 'string' || token.length === 0) return 0;
  let alphabet = 0;
  if (/[a-z]/.test(token)) alphabet += 26;
  if (/[A-Z]/.test(token)) alphabet += 26;
  if (/[0-9]/.test(token)) alphabet += 10;
  if (/[^A-Za-z0-9]/.test(token)) alphabet += 16;
  const distinct = new Set(token).size;
  if (alphabet <= 1 || distinct < 8) return 0;
  return token.length * Math.log2(Math.min(alphabet, Math.max(distinct, 2)));
}

/**
 * Load the shared secret, failing closed on anything weak or loose.
 * The value is returned to the caller and never logged.
 */
export function loadToken(tokenPath) {
  let info;
  try {
    info = fs.statSync(tokenPath);
  } catch {
    throw new Error(
      `Bridge token file is missing: ${tokenPath}\n`
      + 'Create it with: node scripts/install-hermes-town-plugin.mjs',
    );
  }
  if (!info.isFile()) throw new Error(`Bridge token path is not a regular file: ${tokenPath}`);
  // Windows has no POSIX mode bits: stat reports 0o666 for every file, so the
  // check would refuse every token there. NTFS ACLs are the protection instead.
  if (process.platform !== 'win32' && info.mode & 0o077) {
    throw new Error(`Bridge token file is group/world accessible: ${tokenPath} (chmod 600 it)`);
  }
  const token = fs.readFileSync(tokenPath, 'utf8').trim();
  const bits = tokenStrengthBits(token);
  if (bits < MIN_TOKEN_BITS) {
    throw new Error(
      `Bridge token is too weak (${bits.toFixed(0)} bits, ${MIN_TOKEN_BITS} required): ${tokenPath}`,
    );
  }
  return token;
}

/** Length-independent comparison: both sides are hashed before comparing. */
function secretEquals(provided, expected) {
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function applyHeaders(res, extra = {}) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
}

function sendJson(res, status, body) {
  const text = `${JSON.stringify(body)}\n`;
  applyHeaders(res, { 'Content-Type': 'application/json; charset=utf-8' });
  res.writeHead(status);
  res.end(text);
}

/**
 * Read a request body with a hard cap enforced while it streams, so an
 * oversized upload is refused rather than buffered.
 */
function readCappedBody(req, limit) {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > limit) {
      resolve({ ok: false, reason: 'too_large' });
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        finish({ ok: false, reason: 'too_large' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish({ ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => finish({ ok: false, reason: 'aborted' }));
    req.on('aborted', () => finish({ ok: false, reason: 'aborted' }));
  });
}

/**
 * @param {object} options
 * @param {string} options.token            shared secret, already validated
 * @param {string} options.journalPath      durable bounded journal
 * @param {string|null} options.staticRoot  built app to serve, or null
 * @param {number} [options.heartbeatSeconds]
 * @param {{key: string}[]} [options.cronSeeds]  keeper keys derived from the
 *        scheduler's own job ids, stood up at boot (see lib/cronSeed.mjs)
 */
export function createTownServer({ token, journalPath, staticRoot = null, heartbeatSeconds = 15, cronSeeds = [] }) {
  if (typeof token !== 'string' || tokenStrengthBits(token) < MIN_TOKEN_BITS) {
    throw new Error('createTownServer requires a strong bridge token');
  }
  const state = createTownState({ journalPath });
  const seededKeepers = state.seedKeepers(cronSeeds);

  const root = staticRoot === null ? null : path.resolve(staticRoot);
  const startedAt = Date.now();

  /** @type {Set<{res: import('node:http').ServerResponse}>} */
  const clients = new Set();
  let sseConnections = 0;
  let sseReplayed = 0;
  let sseResets = 0;
  let authFailures = 0;
  let schemaFailures = 0;
  let oversized = 0;

  function broadcast(events) {
    if (events.length === 0 || clients.size === 0) return;
    const frame = events
      .map((event) => `id: ${event.cursor}\nevent: town\ndata: ${JSON.stringify(event)}\n\n`)
      .join('');
    for (const client of clients) {
      try {
        client.res.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  }

  const heartbeat = setInterval(() => {
    if (clients.size === 0) return;
    const frame = `event: heartbeat\ndata: ${JSON.stringify({
      at: Number((Date.now() / 1000).toFixed(3)),
      cursor: state.cursor,
    })}\n\n`;
    for (const client of clients) {
      try {
        client.res.write(frame);
      } catch {
        clients.delete(client);
      }
    }
  }, Math.max(1, heartbeatSeconds) * 1000);
  heartbeat.unref?.();

  // -- routes --------------------------------------------------------------

  async function handleIngest(req, res) {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/.exec(String(header));
    if (!match || !secretEquals(match[1].trim(), token)) {
      authFailures += 1;
      state.countRejected();
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    const body = await readCappedBody(req, MAX_INGRESS_BYTES);
    if (!body.ok) {
      if (body.reason === 'too_large') {
        oversized += 1;
        state.countRejected();
        sendJson(res, 413, { ok: false, error: 'payload_too_large', limitBytes: MAX_INGRESS_BYTES });
        return;
      }
      sendJson(res, 400, { ok: false, error: 'aborted' });
      return;
    }
    const parsed = parseIngressBody(body.text);
    if (!parsed.ok) {
      schemaFailures += 1;
      state.countRejected();
      sendJson(res, 400, { ok: false, error: 'schema', reason: parsed.reason });
      return;
    }
    const result = state.ingest(parsed.events);
    broadcast(result.events);
    sendJson(res, 202, {
      ok: true,
      accepted: result.accepted,
      duplicate: result.duplicate,
      skipped: result.skipped,
      cursor: state.cursor,
      streamId: state.streamId,
    });
  }

  function handleSnapshot(req, res, url) {
    const requested = Number(url.searchParams.get('since') ?? NaN);
    const since = Number.isFinite(requested) && requested >= 0 ? Math.floor(requested) : null;
    const expectedStreamId = url.searchParams.get('stream');
    sendJson(res, 200, state.snapshot(since, expectedStreamId));
  }

  function handleHealth(req, res) {
    const stats = state.stats();
    // Deliberately no paths, no host data, no ids, no token, no client info.
    sendJson(res, 200, {
      ok: true,
      service: 'hermes-town-live',
      contract: PUBLIC_VERSION,
      label: LIVE_SOURCE_LABEL,
      uptimeSeconds: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
      cursor: stats.cursor,
      agents: stats.agents,
      activeAgents: stats.activeAgents,
      retainedEvents: stats.retainedEvents,
      ingested: stats.ingested,
      duplicates: stats.duplicates,
      rejected: stats.rejected,
      sse: { clients: clients.size, connections: sseConnections, replayed: sseReplayed, resets: sseResets },
      auth: { failures: authFailures, schemaFailures, oversized },
      staticApp: root !== null,
    });
  }

  function handleEvents(req, res, url) {
    const lastEventId = req.headers['last-event-id'];
    const sinceParam = url.searchParams.get('since');
    const requested = Number(lastEventId ?? sinceParam ?? NaN);
    const since = Number.isFinite(requested) && requested >= 0 ? Math.floor(requested) : null;

    applyHeaders(res, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      Connection: 'keep-alive',
      // Any reverse proxy in front of this must not buffer the stream.
      'X-Accel-Buffering': 'no',
    });
    res.writeHead(200);
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);
    res.write(`retry: 3000\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({
      v: PUBLIC_VERSION,
      streamId: state.streamId,
      cursor: state.cursor,
      at: Number((Date.now() / 1000).toFixed(3)),
    })}\n\n`);

    sseConnections += 1;
    if (since !== null) {
      const replay = state.since(since);
      if (replay === null) {
        // The requested cursor is older than anything retained. Serving from
        // "now" would silently hide a hole, so the client is told to
        // re-snapshot instead.
        sseResets += 1;
        res.write(`event: reset\ndata: ${JSON.stringify({
          reason: 'cursor_too_old', cursor: state.cursor, streamId: state.streamId,
        })}\n\n`);
      } else if (replay.length > 0) {
        sseReplayed += replay.length;
        res.write(replay
          .map((event) => `id: ${event.cursor}\nevent: town\ndata: ${JSON.stringify(event)}\n\n`)
          .join(''));
      }
    }

    const client = { res };
    clients.add(client);
    const drop = () => clients.delete(client);
    req.on('close', drop);
    req.on('error', drop);
    res.on('error', drop);
  }

  function handleStatic(req, res, url) {
    if (root === null) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    const resolved = resolveStatic(root, url.pathname);
    if (!resolved.ok) {
      sendJson(res, resolved.reason === 'traversal' ? 403 : 404, {
        ok: false,
        error: resolved.reason === 'traversal' ? 'forbidden' : 'not_found',
      });
      return;
    }
    let data;
    try {
      data = fs.readFileSync(resolved.file);
    } catch {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    applyHeaders(res, { 'Content-Type': contentTypeFor(resolved.file), 'Content-Length': String(data.length) });
    res.writeHead(200);
    if (req.method === 'HEAD') res.end(); else res.end(data);
  }

  const server = http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad_request' });
      return;
    }
    const route = url.pathname;
    const method = req.method ?? 'GET';

    // No CORS headers anywhere, by design: the app and the API share an
    // origin, and a cross-origin reader has no business here.
    if (route === '/api/town/ingest') {
      if (method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }
      handleIngest(req, res).catch(() => {
        try { sendJson(res, 500, { ok: false, error: 'internal' }); } catch { /* already sent */ }
      });
      return;
    }
    if (route === '/api/town/snapshot') {
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }
      handleSnapshot(req, res, url);
      return;
    }
    if (route === '/api/town/events') {
      if (method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }
      handleEvents(req, res, url);
      return;
    }
    if (route === '/api/town/health') {
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
        return;
      }
      handleHealth(req, res);
      return;
    }
    if (route.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, error: 'not_found' });
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }
    handleStatic(req, res, url);
  });

  server.on('clientError', (error, socket) => {
    void error;
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return {
    server,
    state,
    /** Public events the boot seed published (one spawn per new keeper). */
    seededKeepers,
    listen(port, host = '127.0.0.1') {
      if (!isLoopbackHost(host)) {
        return Promise.reject(new Error(`Hermes Town only binds to loopback hosts, received: ${host}`));
      }
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      clearInterval(heartbeat);
      for (const client of clients) {
        try { client.res.end(); } catch { /* already gone */ }
      }
      clients.clear();
      state.compact();
      await new Promise((resolve) => server.close(() => resolve()));
    },
    stats() {
      return {
        ...state.stats(),
        sse: { clients: clients.size, connections: sseConnections, replayed: sseReplayed, resets: sseResets },
        auth: { failures: authFailures, schemaFailures, oversized },
      };
    },
  };
}
