import type { RoleClass } from '../art/characters';

/**
 * The normalized event the town consumes. This is exactly the shape the
 * existing live server publishes as `hermes-town.public.v1`, minus the cursor.
 * Both the live source and the demo source produce it.
 */
export type TownEventType =
  | 'agent.spawned'
  | 'agent.assigned'
  | 'agent.tool_started'
  | 'agent.waiting'
  | 'agent.completed'
  | 'agent.failed'
  | 'agent.departed';

export interface TownEvent {
  id: string;
  seq: number;
  /** Source clock, epoch seconds. */
  at: number;
  agentId: string;
  type: TownEventType;
  role?: RoleClass;
  displayName?: string;
  tool?: string;
  action?: string;
  reason?: string;
  /** Optional, only present when the operator enabled richer metadata. */
  title?: string;
  file?: string;
}

const ROLES: readonly string[] = ['coordinator', 'research', 'fabrication', 'review', 'tooling', 'general'];
const TYPES: readonly string[] = ['agent.spawned', 'agent.assigned', 'agent.tool_started', 'agent.waiting', 'agent.completed', 'agent.failed', 'agent.departed'];

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (t.length === 0 || t.length > max) return undefined;
  return t;
}

/** Parse an untrusted payload into a TownEvent, or null. Allowlist only. */
export function parseTownEvent(raw: unknown): TownEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const agentId = str(r.agentId, 64);
  const type = str(r.type, 32);
  if (!id || !agentId || !type || !TYPES.includes(type)) return null;
  if (typeof r.seq !== 'number' || typeof r.at !== 'number') return null;
  const role = str(r.role, 16);
  return {
    id,
    seq: r.seq,
    at: r.at,
    agentId,
    type: type as TownEventType,
    role: role && ROLES.includes(role) ? (role as RoleClass) : undefined,
    displayName: str(r.displayName, 48),
    tool: str(r.tool, 64),
    action: str(r.action, 64),
    reason: str(r.reason, 64),
    title: str(r.title, 80),
    file: str(r.file, 80),
  };
}

export interface EventSink {
  push(event: TownEvent): void;
  /** Called when the server's stream identity changed: forget everything. */
  reset(): void;
  /** Called after a full snapshot replay: residents were already here, so they need not walk in. */
  settle?(): void;
  /** Sessions from earlier today that the snapshot left out: shown resting on their porches. */
  remember?(list: { agentId: string; displayName?: string; role?: RoleClass; at: number }[]): void;
}

export type SourceStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface Source {
  readonly label: string;
  start(): void;
  stop(): void;
  status(): SourceStatus;
  /** Source clock, epoch seconds, aligned to the server when live. */
  now(): number;
  /** Residents the last full snapshot deliberately left out, by reason. */
  omitted?(): { departed: number; stale: number };
}
