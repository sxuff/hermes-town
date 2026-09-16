// The Hermes Town live wire contract.
//
// Three shapes meet here and nowhere else:
//
//   ingress   `hermes-town.ingress.v1` — what the native Hermes plugin POSTs.
//             Bounded enums and one pseudonymous key. No timestamps, no
//             sequence numbers, no display text, no identifiers.
//
//   public    `hermes-town.public.v1` — what the snapshot and the SSE stream
//             serve. The current browser parser accepts this payload plus a
//             server cursor. The `source` label is deliberately absent:
//             the browser stamps `hermes` locally, so a payload can never claim
//             to be live Hermes activity on its own authority.
//
//   journal   `hermes-town.journal.v1` — the durable form: one public event
//             plus the ingress id that produced it, so de-duplication survives
//             a restart.
//
// Everything published downstream is *derived here* from the enums above. The
// server never copies a string out of an ingress body into a public event
// except the tool name, which has already passed `^[A-Za-z0-9_.:-]{1,64}$` on
// both sides.

export const INGRESS_VERSION = 'hermes-town.ingress.v1';
export const PUBLIC_VERSION = 'hermes-town.public.v1';
export const JOURNAL_VERSION = 'hermes-town.journal.v1';

/** The exact label the browser shows while the live source is running. */
export const LIVE_SOURCE_LABEL = 'live Hermes events';

export const ROLES = Object.freeze([
  'coordinator',
  'research',
  'fabrication',
  'review',
  'tooling',
  'general',
  'scheduled',
]);

export const KINDS = Object.freeze([
  'spawned',
  'assigned',
  'tool_started',
  'waiting',
  'completed',
  'failed',
  'departed',
]);

export const OUTCOMES = Object.freeze(['ok', 'error', 'interrupted', 'cancelled']);

/**
 * Compatibility mapping retained in the public v1 payload for clients of the
 * earlier renderer. The current 2D client ignores `district` and maps tool
 * names to work places locally in `src/sim/toolMap.ts`.
 */
export const ROLE_DISTRICT = Object.freeze({
  coordinator: 'central-plaza',
  general: 'central-plaza',
  research: 'research-quarter',
  fabrication: 'forge-ward',
  review: 'review-heights',
  tooling: 'deployment-docks',
  scheduled: 'central-plaza',
});

/** Display-name stem. One word per role category, nothing agent-specific. */
const ROLE_TITLE = Object.freeze({
  coordinator: 'Coordinator',
  research: 'Researcher',
  fabrication: 'Builder',
  review: 'Reviewer',
  tooling: 'Operator',
  general: 'Agent',
  scheduled: 'Keeper',
});

/** What the status panel prints for an assignment, per role. */
const ROLE_ACTION = Object.freeze({
  coordinator: 'central dispatch',
  research: 'research task',
  fabrication: 'build task',
  review: 'review task',
  tooling: 'tooling task',
  general: 'delegated task',
  scheduled: 'scheduled run',
});

const OUTCOME_ACTION = Object.freeze({
  ok: 'work completed',
  error: 'failed',
  interrupted: 'interrupted',
  cancelled: 'cancelled',
});

const FAILURE_REASON = Object.freeze({
  ok: 'reported failure',
  error: 'reported failure',
  interrupted: 'interrupted',
  cancelled: 'cancelled',
});

export const AGENT_KEY = /^h\/(main|child|cron)\/[0-9a-f]{16}$/;
export const INGRESS_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

/** Every key an ingress event may carry. Anything else rejects the request. */
export const INGRESS_EVENT_KEYS = Object.freeze(['id', 'key', 'kind', 'role', 'tool', 'outcome', 'detail']);
/** The one optional word a tool_started may carry: a skill name, opt-in on the plugin side. */
export const DETAIL_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * Generic display name: role class plus a four-character pseudonym slice.
 * Derived, never carried, so no ingress body can choose what a resident is
 * called.
 */
export function displayNameFor(role, key) {
  return `${ROLE_TITLE[role] ?? ROLE_TITLE.general} ${key.slice(-4)}`;
}

export function districtFor(role) {
  return ROLE_DISTRICT[role] ?? ROLE_DISTRICT.general;
}

/**
 * Turn one validated ingress event into the public TownEvent body, minus the
 * fields the caller stamps (`id`, `seq`, `at`, `cursor`).
 *
 * Returns `null` for a kind that carries no town transition.
 */
export function townEventBody(ingress, role) {
  const outcome = ingress.outcome ?? null;
  switch (ingress.kind) {
    case 'spawned':
      return { type: 'agent.spawned', role, displayName: displayNameFor(role, ingress.key) };
    case 'assigned':
      return { type: 'agent.assigned', district: districtFor(role), action: ROLE_ACTION[role] ?? ROLE_ACTION.general };
    case 'tool_started':
      // District is left null on purpose: the town's own tool-to-district
      // table decides where a tool is performed, so the wire never has to.
      return ingress.detail !== undefined
        ? { type: 'agent.tool_started', tool: ingress.tool, district: null, detail: ingress.detail }
        : { type: 'agent.tool_started', tool: ingress.tool, district: null };
    case 'waiting':
      return { type: 'agent.waiting', action: outcome === 'ok' ? 'tool completed' : 'waiting' };
    case 'completed':
      return { type: 'agent.completed', action: OUTCOME_ACTION[outcome ?? 'ok'] ?? 'work completed' };
    case 'failed':
      return { type: 'agent.failed', reason: FAILURE_REASON[outcome ?? 'error'] ?? 'reported failure' };
    case 'departed':
      return { type: 'agent.departed' };
    default:
      return null;
  }
}
