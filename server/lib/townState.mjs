// Durable, bounded town state.
//
// One append-only journal on disk, one bounded projection in memory, and the
// canonical numbering every downstream consumer trusts: a monotonic server
// cursor, a per-agent sequence, and a monotonic server clock in epoch seconds.
// The plugin supplies none of those, so a mis-behaving or replayed ingress
// stream cannot walk the town backwards or forge an ordering.
//
// Retention is deliberately per-agent rather than a flat tail. A resident is
// only reconstructible from its own `agent.spawned` event plus whatever came
// after, so each agent keeps its latest spawn and a bounded ring of recent
// events. A tail of the global stream would eventually drop a spawn and leave
// the browser replaying events for a resident it has never heard of.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { JOURNAL_VERSION, PUBLIC_VERSION, townEventBody } from './contract.mjs';

export const LIMITS = Object.freeze({
  /** Distinct residents retained. Beyond this the coldest departed one goes. */
  maxAgents: 256,
  /**
   * A resident with no event for this long is treated as gone for the purpose
   * of a fresh snapshot. Its journal entries are kept; a new client just does
   * not meet it. A CLI that was closed without a session end is the common
   * case.
   */
  staleSeconds: 15 * 60,
  /** A scheduled job's keeper stands at its post between runs; it is only stale after a day. */
  scheduledStaleSeconds: 24 * 3600,
  /** Recent events retained per resident, on top of its current spawn event. */
  maxEventsPerAgent: 48,
  /** Ingress ids remembered for de-duplication. */
  maxDedupe: 8192,
  /** Journal lines appended before the file is rewritten from the projection. */
  compactAfterAppends: 2000,
  /** Journal bytes before the file is rewritten from the projection. */
  compactAfterBytes: 4 * 1024 * 1024,
});

function nowSeconds() {
  return Number((Date.now() / 1000).toFixed(3));
}

export function createTownState({ journalPath, limits = LIMITS, clock = nowSeconds } = {}) {
  if (typeof journalPath !== 'string' || journalPath.length === 0) {
    throw new Error('createTownState requires a journalPath');
  }
  const bounds = { ...LIMITS, ...limits };

  /** @type {Map<string, {key: string, role: string, seq: number, lastCursor: number, departed: boolean, spawn: object|null, events: object[]}>} */
  const agents = new Map();
  const dedupe = new Set();
  const dedupeOrder = [];
  let streamId = '';
  let cursor = 0;
  let lastAt = 0;
  let appendsSinceCompaction = 0;
  let ingested = 0;
  let duplicates = 0;
  let rejected = 0;

  // -- journal io ----------------------------------------------------------

  function ensureDirectory() {
    fs.mkdirSync(path.dirname(journalPath), { recursive: true, mode: 0o700 });
  }

  function rememberIngressId(id) {
    dedupe.add(id);
    dedupeOrder.push(id);
    while (dedupeOrder.length > bounds.maxDedupe) {
      dedupe.delete(dedupeOrder.shift());
    }
  }

  function agentFor(key, role) {
    let agent = agents.get(key);
    if (agent) return agent;
    // A brand-new resident is the *hottest*, not the coldest: seeding its
    // cursor at the current high-water mark is what stops the eviction pass
    // below from immediately evicting the agent it was just asked to create.
    agent = { key, role, seq: 0, lastCursor: cursor, departed: false, spawn: null, events: [] };
    agents.set(key, agent);
    evictAgents();
    return agent;
  }

  /** Coldest departed resident first; only then the coldest resident at all. */
  function evictAgents() {
    while (agents.size > bounds.maxAgents) {
      let victim = null;
      for (const agent of agents.values()) {
        if (!agent.departed) continue;
        if (victim === null || agent.lastCursor < victim.lastCursor) victim = agent;
      }
      if (victim === null) {
        for (const agent of agents.values()) {
          if (victim === null || agent.lastCursor < victim.lastCursor) victim = agent;
        }
      }
      if (victim === null) return;
      agents.delete(victim.key);
    }
  }

  /** Apply one already-numbered public event to the in-memory projection. */
  function project(event) {
    const agent = agentFor(event.agentId, event.role ?? 'general');
    if (event.type === 'agent.spawned') {
      agent.role = event.role;
      agent.spawn = event;
      agent.events = [];
      agent.departed = false;
    } else {
      agent.events.push(event);
      while (agent.events.length > bounds.maxEventsPerAgent) agent.events.shift();
      agent.departed = event.type === 'agent.departed';
    }
    agent.seq = Math.max(agent.seq, event.seq);
    agent.lastCursor = Math.max(agent.lastCursor, event.cursor);
    if (event.cursor > cursor) cursor = event.cursor;
    if (event.at > lastAt) lastAt = event.at;
  }

  function load() {
    ensureDirectory();
    if (!fs.existsSync(journalPath)) {
      streamId = crypto.randomBytes(8).toString('hex');
      compact();
      return { restored: 0, malformedLines: 0, fresh: true };
    }
    const text = fs.readFileSync(journalPath, 'utf8');
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    let restored = 0;
    let malformedLines = 0;
    let headerCursor = 0;
    for (const line of lines) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        malformedLines += 1;
        continue;
      }
      if (record && record.v === JOURNAL_VERSION && typeof record.streamId === 'string') {
        streamId = record.streamId;
        headerCursor = Number.isFinite(record.cursor) ? record.cursor : 0;
        continue;
      }
      if (!record || typeof record !== 'object' || !record.event || typeof record.ingressId !== 'string') {
        malformedLines += 1;
        continue;
      }
      const event = record.event;
      if (!Number.isFinite(event.cursor) || typeof event.agentId !== 'string' || typeof event.type !== 'string') {
        malformedLines += 1;
        continue;
      }
      rememberIngressId(record.ingressId);
      project(event);
      restored += 1;
    }
    if (headerCursor > cursor) cursor = headerCursor;
    if (streamId === '') streamId = crypto.randomBytes(8).toString('hex');
    // A restart is the natural compaction point: rewriting now bounds the file
    // and re-stamps the cursor high-water mark into the header.
    compact();
    return { restored, malformedLines, fresh: false };
  }

  /** Rewrite the journal from the retained projection, atomically. */
  function compact() {
    ensureDirectory();
    const header = { v: JOURNAL_VERSION, streamId, cursor, compactedAt: nowSeconds() };
    const lines = [JSON.stringify(header)];
    for (const event of orderedEvents()) {
      lines.push(JSON.stringify({ ingressId: event.ingressId ?? '', event: publicEvent(event) }));
    }
    const temporary = `${journalPath}.tmp`;
    fs.writeFileSync(temporary, `${lines.join('\n')}\n`, { mode: 0o600 });
    fs.renameSync(temporary, journalPath);
    appendsSinceCompaction = 0;
  }

  function maybeCompact() {
    if (appendsSinceCompaction < bounds.compactAfterAppends) {
      let size = 0;
      try {
        size = fs.statSync(journalPath).size;
      } catch { size = 0; }
      if (size < bounds.compactAfterBytes) return;
    }
    compact();
  }

  function append(ingressId, event) {
    fs.appendFileSync(journalPath, `${JSON.stringify({ ingressId, event: publicEvent(event) })}\n`, { mode: 0o600 });
    appendsSinceCompaction += 1;
  }

  // -- projection views ----------------------------------------------------

  /** Every retained event, in cursor order. Internal form (carries ingressId). */
  function orderedEvents() {
    const all = [];
    for (const agent of agents.values()) {
      if (agent.spawn) all.push(agent.spawn);
      for (const event of agent.events) all.push(event);
    }
    all.sort((a, b) => a.cursor - b.cursor);
    return all;
  }

  /** The wire form: no ingress id, no server-private bookkeeping. */
  function publicEvent(event) {
    const { ingressId, ...rest } = event;
    void ingressId;
    return rest;
  }

  // -- ingestion -----------------------------------------------------------

  /**
   * Absorb a validated ingress batch.
   *
   * Every published event is numbered here and nowhere else. An ingress id that
   * has already been seen is a no-op, so a retried delivery cannot duplicate a
   * resident, and an event for an unknown resident spawns it from the role the
   * plugin carried rather than being dropped — that is what lets the town
   * survive a server restart mid-run without inventing anything.
   */
  function ingest(events) {
    const published = [];
    let accepted = 0;
    let duplicate = 0;
    let skipped = 0;
    for (const ingress of events) {
      if (dedupe.has(ingress.id)) {
        duplicate += 1;
        duplicates += 1;
        continue;
      }
      const known = agents.get(ingress.key);
      const role = known ? known.role : ingress.role;
      if (townEventBody(ingress, role) === null) {
        skipped += 1;
        rejected += 1;
        continue;
      }
      // A resident the server has never numbered cannot receive a mid-life
      // event: it is spawned first, from the role the plugin carried.
      if (!known && ingress.kind !== 'spawned') {
        published.push(emit(`${ingress.id}~spawn`, {
          key: ingress.key, kind: 'spawned', role: ingress.role,
        }, ingress.role));
      }
      published.push(emit(ingress.id, ingress, role));
      accepted += 1;
      ingested += 1;
    }
    if (published.length > 0) maybeCompact();
    return { accepted, duplicate, skipped, cursor, events: published.map(publicEvent) };
  }

  function emit(ingressId, ingress, role) {
    const body = townEventBody(ingress, role);
    const agent = agentFor(ingress.key, role);
    cursor += 1;
    const at = Math.max(lastAt, clock());
    const event = {
      ingressId,
      cursor,
      id: `e${cursor}`,
      seq: agent.seq + 1,
      at,
      agentId: ingress.key,
      ...body,
    };
    rememberIngressId(ingressId);
    project(event);
    append(ingressId, event);
    return event;
  }

  // -- public surface ------------------------------------------------------

  const loadReport = load();

  return {
    get streamId() { return streamId; },
    get cursor() { return cursor; },
    get loadReport() { return loadReport; },
    ingest,
    /**
     * Everything a fresh client needs. When `since` is inside the retained
     * cursor window and `expectedStreamId` names this journal, return only newer
     * events so an HTTP polling fallback can catch up without downloading the
     * whole journal projection. A stale cursor or replaced journal deliberately
     * receives the full retained snapshot instead.
     */
    snapshot(since = null, expectedStreamId = null) {
      const retained = orderedEvents();
      const canIncrement = Number.isFinite(since)
        && expectedStreamId === streamId
        && since <= cursor
        && (retained.length === 0 || since >= retained[0].cursor - 1);
      const now = Math.max(lastAt, clock());
      const omitted = { departed: 0, stale: 0 };
      /** Residents left out but seen in the last day, newest first, for the porches. */
      const recent = [];
      let selected;
      if (canIncrement) {
        selected = retained.filter((event) => event.cursor > since);
      } else {
        // A fresh client is shown the town as it is now: residents that have
        // departed, and residents nothing has been heard from in a while, are
        // left out. Their journal entries stay retained for the stream.
        const skip = new Set();
        for (const agent of agents.values()) {
          const last = agent.events.length > 0 ? agent.events[agent.events.length - 1] : agent.spawn;
          const lastEventAt = last ? last.at : 0;
          let left = false;
          if (agent.role === 'scheduled') {
            // A keeper is stationary: a finished run is not a departure.
            if (now - lastEventAt > bounds.scheduledStaleSeconds) { skip.add(agent.key); omitted.stale += 1; }
            continue;
          }
          if (agent.departed) { skip.add(agent.key); omitted.departed += 1; left = true; }
          else if (now - lastEventAt > bounds.staleSeconds) { skip.add(agent.key); omitted.stale += 1; left = true; }
          if (left && agent.spawn && now - lastEventAt < 24 * 3600 && agent.key.startsWith('h/main/')) {
            recent.push({ agentId: agent.key, displayName: agent.spawn.displayName, role: agent.role, at: lastEventAt });
          }
        }
        selected = retained.filter((event) => !skip.has(event.agentId));
      }
      const events = selected.map(publicEvent);
      return {
        v: PUBLIC_VERSION,
        streamId,
        cursor,
        at: now,
        oldestCursor: retained.length > 0 ? retained[0].cursor : cursor,
        omitted,
        recent: recent.sort((a, b) => b.at - a.at).slice(0, 8),
        events,
      };
    },
    /**
     * Replay after `from`. Returns `null` when the requested cursor is older
     * than anything retained, which tells the caller to re-snapshot instead of
     * silently serving a hole.
     */
    since(from) {
      const events = orderedEvents();
      if (events.length === 0) return from <= cursor ? [] : null;
      if (from < events[0].cursor - 1) return null;
      return events.filter((event) => event.cursor > from).map(publicEvent);
    },
    stats() {
      let active = 0;
      let departed = 0;
      let retainedEvents = 0;
      for (const agent of agents.values()) {
        if (agent.departed) departed += 1; else active += 1;
        retainedEvents += agent.events.length + (agent.spawn ? 1 : 0);
      }
      return {
        cursor,
        agents: agents.size,
        activeAgents: active,
        departedAgents: departed,
        retainedEvents,
        ingested,
        duplicates,
        rejected,
        dedupeTracked: dedupe.size,
      };
    },
    /** Count one request-level rejection (schema, auth, or cap). */
    countRejected() { rejected += 1; },
    compact,
  };
}
