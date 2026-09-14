import { parseTownEvent, type EventSink, type Source, type SourceStatus } from './events';

/**
 * Browser half of the live bridge. Fetches the same-origin snapshot, then
 * follows the SSE stream, deduplicating by server cursor. It stamps nothing
 * and retains nothing beyond counters; the payload goes straight to the sink.
 */
const SNAPSHOT_PATH = '/api/town/snapshot';
const STREAM_PATH = '/api/town/events';
const DISCONNECT_AFTER_MS = 4000;
const RETRY_MS = 2500;
/** A proxy that accepts SSE but buffers its frames: fall back to polling after this silence. */
const STALL_AFTER_MS = 3500;
const POLL_MS = 2000;

export function createLiveSource(sink: EventSink): Source {
  let status: SourceStatus = 'idle';
  let stream: EventSource | null = null;
  let cursor = 0;
  let streamId: string | null = null;
  let offset = 0;
  let stopped = false;
  let disconnectTimer: number | null = null;
  let retryTimer: number | null = null;
  let lastFrameAt = 0;
  let pollTimer: number | null = null;
  let polling = false;

  const absorb = (payload: unknown): void => {
    if (typeof payload !== 'object' || payload === null) return;
    const rec = payload as Record<string, unknown>;
    const c = typeof rec.cursor === 'number' ? rec.cursor : null;
    if (c === null || c <= cursor) return;
    const ev = parseTownEvent(rec);
    if (!ev) return;
    cursor = c;
    sink.push(ev);
  };

  const adoptStream = (id: unknown): void => {
    if (typeof id !== 'string') return;
    if (streamId !== null && streamId !== id) {
      cursor = 0;
      sink.reset();
    }
    streamId = id;
  };

  const snapshot = async (incremental = false): Promise<boolean> => {
    try {
      const q = incremental && streamId !== null ? `?since=${cursor}&stream=${encodeURIComponent(streamId)}` : '';
      const res = await fetch(SNAPSHOT_PATH + q, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as Record<string, unknown>;
      adoptStream(body.streamId);
      if (typeof body.at === 'number') offset = body.at - Date.now() / 1000;
      const events = Array.isArray(body.events) ? body.events : [];
      for (const e of events) absorb(e);
      if (typeof body.cursor === 'number' && body.cursor > cursor) cursor = body.cursor;
      return true;
    } catch {
      return false;
    }
  };

  const clearTimers = (): void => {
    if (disconnectTimer !== null) { window.clearTimeout(disconnectTimer); disconnectTimer = null; }
    if (retryTimer !== null) { window.clearTimeout(retryTimer); retryTimer = null; }
    if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
  };

  // SSE stays primary; while frames are stalled, incremental snapshots keep the town current.
  const startPollWatch = (): void => {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => {
      if (stopped || status !== 'connected' || polling) return;
      if (Date.now() - lastFrameAt < STALL_AFTER_MS) return;
      polling = true;
      void snapshot(true).finally(() => { polling = false; });
    }, POLL_MS);
  };

  const open = (): void => {
    if (stopped) return;
    stream?.close();
    const src = new EventSource(`${STREAM_PATH}?since=${cursor}`);
    stream = src;
    src.addEventListener('open', () => { if (disconnectTimer !== null) { window.clearTimeout(disconnectTimer); disconnectTimer = null; } status = 'connected'; lastFrameAt = Date.now(); startPollWatch(); });
    src.addEventListener('heartbeat', () => { lastFrameAt = Date.now(); });
    src.addEventListener('hello', (e) => {
      try {
        const body = JSON.parse((e as MessageEvent).data) as Record<string, unknown>;
        const before = streamId;
        adoptStream(body.streamId);
        if (typeof body.at === 'number') offset = body.at - Date.now() / 1000;
        if (before !== null && streamId !== before) { src.close(); void boot(); }
      } catch { /* ignore */ }
    });
    src.addEventListener('reset', () => { src.close(); void boot(); });
    src.addEventListener('town', (e) => {
      lastFrameAt = Date.now();
      try { absorb(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
    });
    src.addEventListener('error', () => {
      if (stopped) return;
      if (status === 'connected') status = 'reconnecting';
      if (disconnectTimer === null) disconnectTimer = window.setTimeout(() => { status = 'disconnected'; disconnectTimer = null; if (retryTimer === null) retryTimer = window.setTimeout(() => { retryTimer = null; void boot(); }, RETRY_MS); }, DISCONNECT_AFTER_MS);
    });
  };

  const boot = async (): Promise<void> => {
    if (stopped) return;
    stream?.close();
    stream = null;
    if (status !== 'reconnecting') status = 'connecting';
    const ok = await snapshot();
    if (stopped) return;
    if (!ok) {
      status = 'disconnected';
      clearTimers();
      retryTimer = window.setTimeout(() => { retryTimer = null; void boot(); }, RETRY_MS);
      return;
    }
    open();
  };

  return {
    label: 'live Hermes events',
    start() { stopped = false; void boot(); },
    stop() { stopped = true; clearTimers(); stream?.close(); stream = null; status = 'idle'; },
    status: () => status,
    now: () => Date.now() / 1000 + offset,
  };
}
