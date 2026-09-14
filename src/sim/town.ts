import type { Facing, RoleClass, WorkStyle } from '../art/characters';
import { hashString } from '../art/painter';
import { TILE } from '../art/tiles';
import type { TownEvent } from '../live/events';
import { tileCenter, type Building, type Station, type TownMap } from '../world/map';
import { findPath, nearestWalkable, type Point } from '../world/pathfind';
import { IDLE_TARGET, THINK_TARGET, targetForTool, type Place, type ToolTarget } from './toolMap';

export const WALK_SPEED = 44; // world px per second
const MIN_WORK_SECONDS = 2.6;
const HOLD_AFTER_WORK_SECONDS = 9;
const CELEBRATE_SECONDS = 2.2;
const FAIL_SECONDS = 3;
const GONE_AFTER_SECONDS = 1.2;
/** How long a finished session sits on its porch before it is forgotten. */
const REST_SECONDS = 30 * 60;
const QUEUE_LIMIT = 2;
const HISTORY_LIMIT = 14;

export type ResidentState = 'arriving' | 'moving' | 'working' | 'idle' | 'celebrating' | 'failed' | 'leaving' | 'resting' | 'gone';
export type Anim = 'walk' | 'stand' | 'work' | 'sit';

export interface Intent {
  target: ToolTarget;
  tool: string | null;
  home?: boolean;
}

export interface Resident {
  id: string;
  name: string;
  role: RoleClass;
  title: string | null;
  home: Building;
  isChild: boolean;
  x: number;
  y: number;
  facing: Facing;
  anim: Anim;
  style: WorkStyle;
  state: ResidentState;
  /** Porch tile held while resting, or null. */
  porch: Point | null;
  place: Place | null;
  station: Station | null;
  intent: Intent | null;
  queue: Intent[];
  path: Point[];
  pathIndex: number;
  /** Seconds left before the resident may leave its current station. */
  hold: number;
  /** Seconds the resident has been standing without a new event. */
  quiet: number;
  bubble: string | null;
  emote: 'ok' | 'fail' | 'think' | 'zzz' | 'wait' | null;
  emoteUntil: number;
  history: { at: number; text: string }[];
  lastEventAt: number;
  spawnedAt: number;
  fade: number;
  /** Animation clock in seconds. */
  clock: number;
  seq: number;
}

export interface SimEvent { at: number; text: string; residentId: string }

export class TownSim {
  readonly residents = new Map<string, Resident>();
  readonly departed: Resident[] = [];
  readonly log: SimEvent[] = [];
  private occupied = new Map<string, string>();
  private porches = new Set<string>();
  private time = 0;
  /** Building activity, 0..1, drives lit windows and chimney smoke. */
  readonly activity = new Map<Place, number>();

  constructor(readonly map: TownMap) {
    for (const b of map.buildings) this.activity.set(b.kind as Place, 0);
    this.activity.set('market', 0);
  }

  now(): number { return this.time; }

  reset(): void {
    this.residents.clear();
    this.departed.length = 0;
    this.log.length = 0;
    this.occupied.clear();
    this.porches.clear();
  }

  /** Residents that still represent a live execution context. */
  active(): Resident[] {
    return [...this.residents.values()].filter((r) => r.state !== 'resting' && r.state !== 'gone');
  }

  // ---------------------------------------------------------------- events

  push(e: TownEvent): void {
    let r = this.residents.get(e.agentId);
    if (!r) {
      if (e.type === 'agent.departed') return;
      r = this.spawn(e);
    }
    if (e.seq <= r.seq) return;
    r.seq = e.seq;
    if (r.state === 'resting' && e.type !== 'agent.departed') this.wake(r);
    r.lastEventAt = this.time;
    r.quiet = 0;
    if (e.title && !r.title) r.title = e.title;
    switch (e.type) {
      case 'agent.spawned':
        break;
      case 'agent.assigned':
        if (r.state === 'arriving' || r.state === 'idle' && r.place !== 'hall' && r.queue.length === 0 && !r.intent) {
          this.enqueue(r, { target: THINK_TARGET, tool: null });
        } else if (r.state === 'working' || r.state === 'idle') {
          this.setEmote(r, 'think', 2.5);
          if (r.state === 'working') r.anim = 'stand';
        }
        this.note(r, e.action ?? 'turn started');
        break;
      case 'agent.tool_started': {
        const tool = e.tool ?? 'tool';
        this.enqueue(r, { target: targetForTool(tool), tool });
        this.note(r, tool);
        break;
      }
      case 'agent.waiting':
        if (r.state === 'working') {
          r.hold = Math.min(r.hold, 1.2);
          r.bubble = r.bubble ? `${r.bubble} ✓` : null;
        }
        break;
      case 'agent.completed':
        r.queue.length = 0;
        r.state = r.state === 'moving' ? 'moving' : 'celebrating';
        if (r.state === 'celebrating') { r.hold = CELEBRATE_SECONDS; r.anim = 'stand'; }
        r.bubble = null;
        this.setEmote(r, 'ok', CELEBRATE_SECONDS);
        this.note(r, e.action ?? 'completed');
        break;
      case 'agent.failed':
        r.queue.length = 0;
        r.state = r.state === 'moving' ? 'moving' : 'failed';
        if (r.state === 'failed') { r.hold = FAIL_SECONDS; r.anim = 'stand'; }
        r.bubble = null;
        this.setEmote(r, 'fail', FAIL_SECONDS);
        this.note(r, e.reason ?? 'failed');
        break;
      case 'agent.departed':
        if (r.state === 'resting') break;
        r.queue.length = 0;
        r.intent = null;
        this.leaveStation(r);
        this.goHome(r);
        this.note(r, 'went home');
        break;
    }
  }

  private spawn(e: TownEvent): Resident {
    const isChild = e.agentId.includes('/child/');
    const h = hashString(e.agentId);
    const home = this.map.homes[h % this.map.homes.length]!;
    const role = e.role ?? 'general';
    const start = this.map.entrance;
    const pos = tileCenter(start);
    const r: Resident = {
      id: e.agentId,
      name: e.displayName ?? `Agent ${e.agentId.slice(-4)}`,
      role,
      title: e.title ?? null,
      home,
      isChild,
      x: pos.x,
      y: pos.y,
      facing: 'up',
      anim: 'stand',
      style: 'desk',
      state: 'arriving',
      porch: null,
      place: null,
      station: null,
      intent: null,
      queue: [],
      path: [],
      pathIndex: 0,
      hold: 0,
      quiet: 0,
      bubble: null,
      emote: null,
      emoteUntil: 0,
      history: [],
      lastEventAt: this.time,
      spawnedAt: this.time,
      fade: 1,
      clock: Math.random() * 10,
      seq: 0,
    };
    this.residents.set(r.id, r);
    this.note(r, isChild ? 'arrived to help' : 'arrived in town');
    // walk in from the gate and check in at the hall
    this.enqueue(r, { target: { place: 'hall', style: 'desk', verb: 'checking in' }, tool: null });
    return r;
  }

  private note(r: Resident, text: string): void {
    r.history.unshift({ at: this.time, text });
    if (r.history.length > HISTORY_LIMIT) r.history.length = HISTORY_LIMIT;
    this.log.unshift({ at: this.time, text: `${r.name}: ${text}`, residentId: r.id });
    if (this.log.length > 40) this.log.length = 40;
  }

  private setEmote(r: Resident, e: Resident['emote'], seconds: number): void {
    r.emote = e;
    r.emoteUntil = this.time + seconds;
  }

  private enqueue(r: Resident, intent: Intent): void {
    // Same place as the current intent: refresh in place, no walk.
    const cur = r.intent;
    if (cur && cur.target.place === intent.target.place && (r.state === 'working' || r.state === 'moving') && r.queue.length === 0) {
      cur.tool = intent.tool;
      cur.target = intent.target;
      if (r.state === 'working') {
        r.hold = Math.max(r.hold, MIN_WORK_SECONDS);
        r.style = intent.target.style;
        r.anim = intent.target.style === 'sit' ? 'sit' : 'work';
        r.bubble = bubbleFor(intent);
      }
      return;
    }
    // Collapse: keep only the newest queued intents.
    const last = r.queue[r.queue.length - 1];
    if (last && last.target.place === intent.target.place) { r.queue[r.queue.length - 1] = intent; return; }
    r.queue.push(intent);
    while (r.queue.length > QUEUE_LIMIT) r.queue.shift();
  }

  // ------------------------------------------------------------- movement

  private leaveStation(r: Resident): void {
    if (r.station) { this.occupied.delete(r.station.id); r.station = null; }
    r.place = null;
  }

  private stationFor(r: Resident, place: Place): { station: Station | null; tile: Point } {
    const free = this.map.stations.filter((s) => s.place === place && !this.occupied.has(s.id));
    const here = { x: Math.floor(r.x / TILE), y: Math.floor(r.y / TILE) };
    if (free.length > 0) {
      free.sort((a, b) => dist(a.tile, here) - dist(b.tile, here));
      return { station: free[0]!, tile: free[0]!.tile };
    }
    // Everything is taken: stand near the building, visibly queued.
    const all = this.map.stations.filter((s) => s.place === place);
    const anchor = all[Math.floor(Math.random() * all.length)]!.tile;
    const spots: Point[] = [];
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx === 0 && dy === 0) continue;
      const p = { x: anchor.x + dx, y: anchor.y + dy };
      if (p.x < 0 || p.y < 0 || p.x >= this.map.grid.w || p.y >= this.map.grid.h) continue;
      if (this.map.grid.cost[p.y * this.map.grid.w + p.x] === 0) continue;
      if (this.map.stations.some((s) => s.tile.x === p.x && s.tile.y === p.y)) continue;
      spots.push(p);
    }
    const tile = spots[Math.floor(Math.random() * spots.length)] ?? anchor;
    return { station: null, tile };
  }

  private startIntent(r: Resident, intent: Intent): void {
    this.leaveStation(r);
    r.intent = intent;
    r.bubble = null;
    let target: Point;
    if (intent.home) {
      target = r.home.door;
    } else {
      const pick = this.stationFor(r, intent.target.place);
      if (pick.station) { this.occupied.set(pick.station.id, r.id); r.station = pick.station; }
      target = pick.tile;
    }
    const from = nearestWalkable(this.map.grid, { x: Math.floor(r.x / TILE), y: Math.floor(r.y / TILE) }) ?? this.map.entrance;
    const path = findPath(this.map.grid, from, target) ?? [from, target];
    r.path = path;
    r.pathIndex = 0;
    r.state = intent.home ? 'leaving' : 'moving';
    r.anim = 'walk';
  }

  private wake(r: Resident): void {
    if (r.porch) { this.porches.delete(`${r.porch.x},${r.porch.y}`); r.porch = null; }
    r.state = 'idle';
    r.anim = 'stand';
    r.hold = 0;
    r.fade = 1;
    this.note(r, 'back to work');
  }

  private goHome(r: Resident): void {
    this.startIntent(r, { target: IDLE_TARGET, tool: null, home: true });
  }

  private arrive(r: Resident): void {
    const intent = r.intent;
    if (!intent) { r.state = 'idle'; r.anim = 'stand'; return; }
    if (intent.home) {
      const spot = r.home.porch.find((p) => !this.porches.has(`${p.x},${p.y}`));
      if (spot) {
        this.porches.add(`${spot.x},${spot.y}`);
        r.porch = spot;
        const c = tileCenter(spot);
        r.x = c.x; r.y = c.y;
        r.state = 'resting';
        r.anim = 'sit';
        r.facing = 'down';
        r.hold = REST_SECONDS;
        r.bubble = null;
        return;
      }
      r.state = 'gone';
      r.hold = GONE_AFTER_SECONDS;
      r.facing = 'up';
      r.anim = 'walk';
      return;
    }
    r.place = intent.target.place;
    r.style = intent.target.style;
    r.state = 'working';
    r.facing = r.station ? r.station.facing : 'down';
    r.anim = intent.target.style === 'sit' ? 'sit' : r.station ? 'work' : 'stand';
    if (r.station && r.station.prop.kind === 'barrel') r.anim = 'stand';
    r.hold = MIN_WORK_SECONDS;
    r.bubble = bubbleFor(intent);
    if (intent.target.verb === 'idle') { r.bubble = null; r.state = 'idle'; }
  }

  update(dt: number): void {
    this.time += dt;
    for (const r of this.residents.values()) {
      r.clock += dt;
      if (r.emote && this.time > r.emoteUntil) r.emote = null;
      switch (r.state) {
        case 'arriving':
        case 'idle':
        case 'working':
        case 'celebrating':
        case 'failed': {
          r.hold = Math.max(0, r.hold - dt);
          r.quiet += dt;
          if (r.hold > 0) break;
          if (r.state === 'celebrating' || r.state === 'failed') {
            // rest at the tavern until something new happens
            r.state = 'idle';
            if (r.queue.length === 0) this.enqueue(r, { target: IDLE_TARGET, tool: null });
          }
          const next = r.queue.shift();
          if (next) { this.startIntent(r, next); break; }
          if (r.state === 'working') {
            // finished the visible work; stand and wait a while, then wander
            if (r.anim === 'work') { r.anim = 'stand'; r.hold = HOLD_AFTER_WORK_SECONDS; break; }
            if (r.place !== 'tavern') { this.enqueue(r, { target: IDLE_TARGET, tool: null }); break; }
            r.state = 'idle';
          }
          if (r.state === 'idle' && r.quiet > 30 && Math.random() < dt * 0.05) {
            this.setEmote(r, 'zzz', 3);
            r.quiet = 10;
          }
          break;
        }
        case 'moving':
        case 'leaving': {
          this.step(r, dt);
          break;
        }
        case 'resting': {
          r.hold -= dt;
          r.quiet += dt;
          if (r.quiet > 20 && Math.random() < dt * 0.03) { this.setEmote(r, 'zzz', 3); r.quiet = 0; }
          if (r.hold <= 0) {
            if (r.porch) { this.porches.delete(`${r.porch.x},${r.porch.y}`); r.porch = null; }
            r.state = 'gone';
            r.hold = GONE_AFTER_SECONDS;
          }
          break;
        }
        case 'gone': {
          r.hold -= dt;
          r.fade = Math.max(0, r.hold / GONE_AFTER_SECONDS);
          if (r.hold <= 0) {
            this.residents.delete(r.id);
            this.departed.unshift(r);
            if (this.departed.length > 30) this.departed.length = 30;
          }
          break;
        }
      }
    }
    // building activity: proportion of stations in use, eased
    for (const place of this.activity.keys()) {
      const total = this.map.stations.filter((s) => s.place === place).length || 1;
      const used = [...this.residents.values()].filter((r) => r.place === place && r.state === 'working').length;
      const target = Math.min(1, used / Math.min(2, total));
      const cur = this.activity.get(place) ?? 0;
      this.activity.set(place, cur + (target - cur) * Math.min(1, dt * 1.5));
    }
  }

  private step(r: Resident, dt: number): void {
    let budget = WALK_SPEED * dt;
    while (budget > 0) {
      const next = r.path[r.pathIndex + 1];
      if (!next) { this.arrive(r); return; }
      const c = tileCenter(next);
      const dx = c.x - r.x, dy = c.y - r.y;
      const d = Math.hypot(dx, dy);
      if (d <= budget) {
        r.x = c.x; r.y = c.y; r.pathIndex += 1; budget -= d;
      } else {
        r.x += (dx / d) * budget; r.y += (dy / d) * budget; budget = 0;
      }
      r.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
    }
  }
}

function bubbleFor(intent: Intent): string | null {
  if (intent.tool) return intent.tool.replace(/^mcp__.*?__/, '');
  if (intent.target.verb === 'idle') return null;
  return intent.target.verb;
}

function dist(a: Point, b: Point): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
