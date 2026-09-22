// Strict ingress validation.
//
// This is an allowlist, not a cleanup pass. A field that is not in
// `INGRESS_EVENT_KEYS` does not get stripped, sanitised or coerced — its
// presence rejects the whole request. That way a future plugin bug, a
// mis-shaped payload, or a hostile client cannot smuggle a prompt, a path or a
// raw identifier into the town by hiding it in an unexpected key.

import {
  AGENT_KEY,
  DETAIL_NAME,
  INGRESS_EVENT_KEYS,
  INGRESS_ID,
  INGRESS_VERSION,
  KINDS,
  OUTCOMES,
  ROLES,
  TOOL_NAME,
} from './contract.mjs';

/** Events accepted in one POST. The plugin batches at most 24. */
export const MAX_BATCH = 32;

const KIND_SET = new Set(KINDS);
const ROLE_SET = new Set(ROLES);
const OUTCOME_SET = new Set(OUTCOMES);
const KEY_SET = new Set(INGRESS_EVENT_KEYS);
const OUTCOME_KINDS = new Set(['waiting', 'completed', 'failed']);

/** @returns {{ ok: true, events: object[] } | { ok: false, reason: string }} */
export function parseIngressBody(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'body is not valid JSON' };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'body is not an object' };
  }
  const bodyKeys = Object.keys(body);
  if (bodyKeys.some((key) => key !== 'v' && key !== 'events')) {
    return { ok: false, reason: 'body carries an unknown field' };
  }
  if (body.v !== INGRESS_VERSION) {
    return { ok: false, reason: 'unsupported ingress version' };
  }
  if (!Array.isArray(body.events)) {
    return { ok: false, reason: 'events is not an array' };
  }
  if (body.events.length === 0) {
    return { ok: false, reason: 'events is empty' };
  }
  if (body.events.length > MAX_BATCH) {
    return { ok: false, reason: 'too many events in one request' };
  }
  const events = [];
  for (const raw of body.events) {
    const validated = validateIngressEvent(raw);
    if (!validated.ok) return validated;
    events.push(validated.event);
  }
  return { ok: true, events };
}

/** @returns {{ ok: true, event: object } | { ok: false, reason: string }} */
export function validateIngressEvent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'event is not an object' };
  }
  for (const key of Object.keys(raw)) {
    if (!KEY_SET.has(key)) return { ok: false, reason: `event carries an unknown field: ${safeKey(key)}` };
  }
  const { id, key, kind, role, tool, outcome, detail } = raw;
  if (typeof id !== 'string' || !INGRESS_ID.test(id)) {
    return { ok: false, reason: 'event id is missing or malformed' };
  }
  if (typeof key !== 'string' || !AGENT_KEY.test(key)) {
    return { ok: false, reason: 'agent key is not a pseudonymous town key' };
  }
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) {
    return { ok: false, reason: 'unknown lifecycle kind' };
  }
  if (typeof role !== 'string' || !ROLE_SET.has(role)) {
    return { ok: false, reason: 'unknown role category' };
  }
  if (kind === 'tool_started') {
    if (typeof tool !== 'string' || !TOOL_NAME.test(tool)) {
      return { ok: false, reason: 'tool name is missing or not publishable' };
    }
  } else if (tool !== undefined) {
    return { ok: false, reason: 'tool is only valid on a tool_started event' };
  }
  if (detail !== undefined) {
    if (kind !== 'tool_started') return { ok: false, reason: 'detail is only valid on a tool_started event' };
    if (typeof detail !== 'string' || !DETAIL_NAME.test(detail) || detail.includes('..')) {
      return { ok: false, reason: 'detail is not a publishable name' };
    }
  }
  if (outcome !== undefined) {
    if (typeof outcome !== 'string' || !OUTCOME_SET.has(outcome)) {
      return { ok: false, reason: 'unknown outcome classification' };
    }
    if (!OUTCOME_KINDS.has(kind)) {
      return { ok: false, reason: 'outcome is not valid on this lifecycle kind' };
    }
  }
  // Rebuilt from validated locals rather than copied, so nothing rides along.
  const event = { id, key, kind, role };
  if (kind === 'tool_started') event.tool = tool;
  if (outcome !== undefined) event.outcome = outcome;
  return { ok: true, event };
}

/** Echo an offending key name back safely: bounded, printable, no payload. */
function safeKey(key) {
  return key.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 24) || 'unnamed';
}
