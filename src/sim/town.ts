import type { Facing, RoleClass, WorkStyle } from '../art/characters';
import { hashString } from '../art/painter';
import { TILE } from '../art/tiles';
import type { TownEvent } from '../live/events';
import { tileCenter, type Building, type Station, type TownMap } from '../world/map';
import { findPath, nearestWalkable, type Point } from '../world/pathfind';
import { IDLE_TARGET, THINK_TARGET, targetForTool, type Place, type ToolTarget } from './toolMap';

/**
 * The town model, crew edition.
 *
 * A session is one resident, the coordinator. It thinks at a hall desk. Every
 * tool call it makes dispatches a runner: a smaller figure that leaves the
 * desk, goes to that tool's building, works there for a few real seconds, and
 * walks back with the result. A turn with six tool calls is six runners
 * fanning out across town while the coordinator sits thinking. When the turn
 * ends the coordinator walks to the notice board, pins the result, and goes
 * to stand at its own front door, waiting for you. Nothing on screen is
 * invented: every figure is one session, one subagent, or one tool call.
 */

export const WALK_SPEED = 44; // world px per second
const RUNNER_WORK_SECONDS = 7;
const RUNNER_HANDIN_SECONDS = 1.6;
const MAX_RUNNERS_PER_SESSION = 6;
const PIN_SECONDS = 3;
const CELEBRATE_SECONDS = 2.2;
const FAIL_SECONDS = 3;
const GONE_AFTER_SECONDS = 1.2;
/** How long a finished session sits on its porch before it is forgotten. */
const REST_SECONDS = 30 * 60;
/** A remembered session from earlier today stays on its porch this long. */
const MEMORY_SECONDS = 6 * 60 * 60;
/** A resident waiting at its door for this long goes to sit on the porch. */
const IDLE_HOME_SECONDS = 10 * 60;
const HISTORY_LIMIT = 14;

export type ResidentState =
  | 'arriving' | 'moving' | 'working' | 'idle' | 'celebrating' | 'failed'
  | 'pinning' | 'waiting' | 'returning' | 'handing' | 'leaving' | 'resting' | 'gone'
  /** a keeper standing at its post between scheduled runs */
  | 'posted';
export type Anim = 'walk' | 'stand' | 'work' | 'sit';
export type ResidentKind = 'session' | 'runner';

export interface Intent {
  target: ToolTarget;
  tool: string | null;
  home?: boolean;
  /** Walk to this tile instead of a station. */
  tile?: Point;
  /** Prefer this station: a skill's own stall. */
  stationId?: string;
}

export interface Resident {
  id: string;
  kind: ResidentKind;
  /** The session a runner belongs to. */
  parentId: string | null;
  name: string;
  role: RoleClass;
  title: string | null;
  home: Building;
  isChild: boolean;
  /** Remembered from earlier today: sits on the porch, was not seen live. */
  memory: boolean;
  /** A scheduled job's keeper: has a post in town instead of a front door. */
  post: Point | null;
  x: number;
  y: number;
  facing: Facing;
  anim: Anim;
  style: WorkStyle;
  state: ResidentState;
  porch: Point | null;
  place: Place | null;
  station: Station | null;
  intent: Intent | null;
  queue: Intent[];
  path: Point[];
  pathIndex: number;
  /** Seconds left before the resident may leave its current spot. */
  hold: number;
  /** Seconds since the last event. */
  quiet: number;
  /** A runner whose tool has finished may return once its minimum time is up. */
  done: boolean;
  /** A runner whose tool failed comes back with smoke. */
  failed: boolean;
  bubble: string | null;
  emote: 'ok' | 'fail' | 'think' | 'zzz' | 'wait' | null;
  emoteUntil: number;
  history: { at: number; text: string }[];
  lastEventAt: number;
  spawnedAt: number;
  fade: number;
  clock: number;
  seq: number;
  runnerCount: number;
}

export interface SimEvent { at: number; text: string; residentId: string }

export interface RememberedSession { agentId: string; displayName?: string; role?: RoleClass; at: number }

export class TownSim {
  readonly residents = new Map<string, Resident>();
  readonly departed: Resident[] = [];
  readonly log: SimEvent[] = [];
  /** Completed turns pinned to the notice board today, newest first. */
  readonly board: { at: number; name: string; text: string }[] = [];
  private occupied = new Map<string, string>();
  private porches = new Set<string>();
  private time = 0;
  private runnerSerial = 0;
  private boardTile: Point;
  /** Where keepers stand: beside the lamps of the square; shared when jobs outnumber lamps. */
  private posts: Point[] = [];
  private postsTaken = new Map<string, number>();
  /** Skill name → market station id. Every skill gets its own stall. */
  readonly stalls = new Map<string, string>();
  private stallUse = new Map<string, number>();
  /** Building activity, 0..1, drives lit windows and chimney smoke. */
  readonly activity = new Map<Place, number>();

  constructor(readonly map: TownMap) {
    for (const b of map.buildings) this.activity.set(b.kind as Place, 0);
    this.activity.set('market', 0);
    // the notice board nearest the fountain is where turns get pinned
    const fountain = map.props.find((p) => p.kind === 'fountain');
    const boards = map.props.filter((p) => p.kind === 'noticeBoard');
    const fx = fountain ? fountain.x : (map.grid.w * TILE) / 2, fy = fountain ? fountain.y : (map.grid.h * TILE) / 2;
    boards.sort((a, b) => Math.hypot(a.x - fx, a.y - fy) - Math.hypot(b.x - fx, b.y - fy));
    const b = boards[0];
    const guess = b ? { x: Math.floor((b.x + 12) / TILE), y: Math.floor(b.y / TILE) + 2 } : { x: Math.floor(fx / TILE), y: Math.floor(fy / TILE) + 3 };
    this.boardTile = nearestWalkable(map.grid, guess) ?? map.entrance;
    for (const lamp of map.lamps) {
      const spot = nearestWalkable(map.grid, { x: lamp.x + 1, y: lamp.y + 1 }, 2);
      if (spot) this.posts.push(spot);
    }
  }

  /** The stall a skill works from, assigning the least recently used one on first sight. */
  stallFor(skill: string): Station | null {
    const known = this.stalls.get(skill);
    const stallStations = this.map.stations.filter((s) => s.place === 'market' && s.prop.kind === 'stall');
    if (known) { this.stallUse.set(skill, this.time); return stallStations.find((s) => s.id === known) ?? null; }
    if (stallStations.length === 0) return null;
    const taken = new Set(this.stalls.values());
    let pick = stallStations.find((s) => !taken.has(s.id));
    if (!pick) {
      // every stall has a skill: the one used longest ago gives way
      let oldest: string | null = null;
      for (const [name, at] of this.stallUse) if (oldest === null || at < (this.stallUse.get(oldest) ?? 0)) oldest = name;
      if (oldest !== null) { const id = this.stalls.get(oldest)!; this.stalls.delete(oldest); this.stallUse.delete(oldest); pick = stallStations.find((s) => s.id === id); }
    }
    if (!pick) return null;
    this.stalls.set(skill, pick.id);
    this.stallUse.set(skill, this.time);
    return pick;
  }

  keepers(): Resident[] {
    return [...this.residents.values()].filter((r) => r.role === 'scheduled' && r.kind === 'session');
  }

  now(): number { return this.time; }

  reset(): void {
    this.residents.clear();
    this.departed.length = 0;
    this.log.length = 0;
    this.board.length = 0;
    this.occupied.clear();
    this.porches.clear();
  }

  /** Sessions and subagents that still represent a live execution context. */
  active(): Resident[] {
    return [...this.residents.values()].filter((r) => r.kind === 'session' && !r.memory && r.state !== 'resting' && r.state !== 'gone' && r.state !== 'posted');
  }

  runners(): Resident[] {
    return [...this.residents.values()].filter((r) => r.kind === 'runner' && r.state !== 'gone');
  }

  remembered(): Resident[] {
    return [...this.residents.values()].filter((r) => r.memory);
  }

  /** The resident that most recently had something happen to it. */
  mostRecent(): Resident | null {
    let best: Resident | null = null;
    for (const r of this.residents.values()) {
      if (r.state === 'gone' || r.state === 'resting') continue;
      if (!best || r.lastEventAt > best.lastEventAt) best = r;
    }
    return best;
  }

  /**
   * After a snapshot replay: everyone the snapshot described was already in
   * town, so nobody walks in from the gate.
   */
  settle(): void {
    for (const r of this.residents.values()) {
      if (r.state === 'arriving') {
        const next = r.queue.shift();
        if (next) this.startIntent(r, next);
      }
      if ((r.state === 'moving' || r.state === 'leaving' || r.state === 'returning') && r.path.length > 0) {
        const end = tileCenter(r.path[r.path.length - 1]!);
        r.x = end.x; r.y = end.y; r.pathIndex = r.path.length - 1;
        this.arrive(r);
      }
      r.history = r.history.filter((h) => h.text !== 'arrived in town' && h.text !== 'arrived to help');
    }
    this.log.length = 0;
  }

  /** Sessions from earlier today, shown sitting on their porches. */
  remember(list: RememberedSession[]): void {
    for (const m of list) {
      if (this.residents.has(m.agentId)) continue;
      const r = this.makeResident(m.agentId, m.displayName ?? `Agent ${m.agentId.slice(-4)}`, m.role ?? 'general', 'session', null);
      r.memory = true;
      const spot = r.home.porch.find((p) => !this.porches.has(`${p.x},${p.y}`));
      if (!spot) continue;
      this.porches.add(`${spot.x},${spot.y}`);
      r.porch = spot;
      const c = tileCenter(spot);
      r.x = c.x; r.y = c.y;
      r.state = 'resting';
      r.anim = 'sit';
      r.facing = 'down';
      r.hold = MEMORY_SECONDS;
      r.history = [{ at: this.time, text: 'earlier today' }];
      this.residents.set(r.id, r);
    }
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
    if (r.memory) { r.memory = false; r.history = []; }
    if ((r.state === 'resting' || r.state === 'waiting' || r.state === 'posted') && e.type !== 'agent.departed') this.wake(r);
    r.lastEventAt = this.time;
    r.quiet = 0;
    if (e.title && !r.title) r.title = e.title;
    switch (e.type) {
      case 'agent.spawned':
        break;
      case 'agent.assigned':
        // a turn begins: think at the hall
        if (r.place !== 'hall' && !(r.intent && r.intent.target.place === 'hall' && r.state === 'moving')) {
          r.queue.length = 0;
          this.enqueue(r, { target: THINK_TARGET, tool: null });
        } else {
          this.setEmote(r, 'think', 2.5);
        }
        this.note(r, e.action ?? 'turn started');
        break;
      case 'agent.tool_started': {
        const tool = e.tool ?? 'tool';
        this.dispatch(r, tool, e.detail ?? null);
        this.note(r, e.detail ? `${tool} · ${e.detail}` : tool);
        break;
      }
      case 'agent.waiting': {
        // the tool came back: the runner that has been out longest may return
        const runner = this.runnersOf(r).find((x) => !x.done);
        if (runner) runner.done = true;
        break;
      }
      case 'agent.completed': {
        // the turn is over: runners come home, the coordinator pins the result
        for (const runner of this.runnersOf(r)) runner.done = true;
        r.queue.length = 0;
        this.setEmote(r, 'ok', CELEBRATE_SECONDS);
        this.board.unshift({ at: this.time, name: r.name, text: e.action ?? 'turn completed' });
        if (this.board.length > 12) this.board.length = 12;
        this.enqueue(r, { target: { place: 'hall', style: 'desk', verb: 'pinning' }, tool: null, tile: this.boardTile });
        this.note(r, e.action ?? 'completed');
        break;
      }
      case 'agent.failed': {
        const runner = this.runnersOf(r).find((x) => !x.done);
        if (runner) {
          // a tool failed: that runner comes back with smoke
          runner.done = true;
          runner.failed = true;
          this.note(r, `${runner.name} failed`);
        } else {
          for (const x of this.runnersOf(r)) x.done = true;
          r.queue.length = 0;
          r.state = r.state === 'moving' ? 'moving' : 'failed';
          if (r.state === 'failed') { r.hold = FAIL_SECONDS; r.anim = 'stand'; }
          r.bubble = null;
          this.setEmote(r, 'fail', FAIL_SECONDS);
          this.note(r, e.reason ?? 'failed');
        }
        break;
      }
      case 'agent.departed':
        if (r.state === 'resting' || r.state === 'posted') break;
        for (const x of this.runnersOf(r)) x.done = true;
        r.queue.length = 0;
        r.intent = null;
        this.leaveStation(r);
        if (r.post) { this.goPost(r); this.note(r, 'run over, back on watch'); break; }
        this.goHome(r);
        this.note(r, 'went home');
        break;
    }
  }

  private makeResident(id: string, name: string, role: RoleClass, kind: ResidentKind, parentId: string | null): Resident {
    const isChild = id.includes('/child/');
    const home = this.map.homes[hashString(parentId ?? id) % this.map.homes.length]!;
    const pos = tileCenter(this.map.entrance);
    return {
      id, kind, parentId, name, role, title: null, home, isChild, memory: false, post: null,
      x: pos.x, y: pos.y, facing: 'up', anim: 'stand', style: 'desk', state: 'arriving',
      porch: null, place: null, station: null, intent: null, queue: [], path: [], pathIndex: 0,
      hold: 0, quiet: 0, done: false, failed: false, bubble: null, emote: null, emoteUntil: 0,
      history: [], lastEventAt: this.time, spawnedAt: this.time, fade: 1, clock: Math.random() * 10, seq: 0, runnerCount: 0,
    };
  }

  private spawn(e: TownEvent): Resident {
    const r = this.makeResident(e.agentId, e.displayName ?? `Agent ${e.agentId.slice(-4)}`, e.role ?? 'general', 'session', null);
    r.title = e.title ?? null;
    this.residents.set(r.id, r);
    if (r.role === 'scheduled') {
      // a keeper: takes a post by a lamp and stands there between runs.
      // A real scheduler can hold more enabled jobs than the square has
      // lamps, so a taken post is shared, least-crowded first, instead of
      // stacking every extra keeper on the same tile.
      let post: Point | undefined;
      let crowd = Infinity;
      for (const p of this.posts) {
        const taken = this.postsTaken.get(`${p.x},${p.y}`) ?? 0;
        if (taken < crowd) { post = p; crowd = taken; }
      }
      post = post ?? this.posts[0] ?? r.home.door;
      this.postsTaken.set(`${post.x},${post.y}`, crowd + 1);
      r.post = post;
      this.note(r, 'took up a post');
      this.enqueue(r, { target: THINK_TARGET, tool: null, tile: post });
      return r;
    }
    this.note(r, r.isChild ? 'arrived to help' : 'arrived in town');
    this.enqueue(r, { target: { place: 'hall', style: 'desk', verb: 'checking in' }, tool: null });
    return r;
  }

  private runnersOf(r: Resident): Resident[] {
    const out: Resident[] = [];
    for (const x of this.residents.values()) if (x.kind === 'runner' && x.parentId === r.id && x.state !== 'gone' && x.state !== 'returning' && x.state !== 'handing') out.push(x);
    out.sort((a, b) => a.spawnedAt - b.spawnedAt);
    return out;
  }

  /** A tool call leaves the coordinator's side as a runner. */
  private dispatch(r: Resident, tool: string, detail: string | null): void {
    const target = targetForTool(tool);
    const label = detail ?? tool.replace(/^mcp__.*?__/, '');
    const stall = detail ? this.stallFor(detail) : null;
    const out = this.runnersOf(r);
    if (out.length >= MAX_RUNNERS_PER_SESSION) {
      // too many out at once: the oldest is called back so the newest can go
      out[0]!.done = true;
    }
    this.runnerSerial += 1;
    const runner = this.makeResident(`${r.id}#r${this.runnerSerial}`, label, r.role, 'runner', r.id);
    runner.x = r.x; runner.y = r.y;
    runner.title = r.title;
    runner.history = [{ at: this.time, text: `sent by ${r.name}` }];
    this.residents.set(runner.id, runner);
    r.runnerCount += 1;
    this.startIntent(runner, stall ? { target, tool: label, stationId: stall.id } : { target, tool: label });
    r.bubble = null;
    this.setEmote(r, 'think', 2);
    if (r.state === 'idle' || r.state === 'waiting') r.state = 'working';
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
    const cur = r.intent;
    if (cur && !intent.tile && cur.target.place === intent.target.place && (r.state === 'working' || r.state === 'moving') && r.queue.length === 0) {
      cur.tool = intent.tool;
      cur.target = intent.target;
      if (r.state === 'working') { r.style = intent.target.style; r.bubble = bubbleFor(intent); }
      return;
    }
    r.queue.push(intent);
    while (r.queue.length > 3) r.queue.shift();
  }

  // ------------------------------------------------------------- movement

  private leaveStation(r: Resident): void {
    if (r.station) { this.occupied.delete(r.station.id); r.station = null; }
    r.place = null;
  }

  private stationFor(r: Resident, place: Place, preferred?: string): { station: Station | null; tile: Point } {
    if (preferred) {
      const own = this.map.stations.find((s) => s.id === preferred);
      if (own && !this.occupied.has(own.id)) return { station: own, tile: own.tile };
      if (own) {
        // the stall is busy: wait beside it
        const near = nearestWalkable(this.map.grid, { x: own.tile.x, y: own.tile.y + 1 }, 2);
        if (near) return { station: null, tile: near };
      }
    }
    const free = this.map.stations.filter((s) => s.place === place && !this.occupied.has(s.id));
    const here = { x: Math.floor(r.x / TILE), y: Math.floor(r.y / TILE) };
    if (free.length > 0) {
      free.sort((a, b) => dist(a.tile, here) - dist(b.tile, here));
      return { station: free[0]!, tile: free[0]!.tile };
    }
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

  private walkTo(r: Resident, target: Point): void {
    const from = nearestWalkable(this.map.grid, { x: Math.floor(r.x / TILE), y: Math.floor(r.y / TILE) }) ?? this.map.entrance;
    const to = nearestWalkable(this.map.grid, target) ?? target;
    r.path = findPath(this.map.grid, from, to) ?? [from, to];
    r.pathIndex = 0;
    r.anim = 'walk';
  }

  private startIntent(r: Resident, intent: Intent): void {
    this.leaveStation(r);
    r.intent = intent;
    r.bubble = null;
    let target: Point;
    if (intent.home) target = r.home.door;
    else if (intent.tile) target = intent.tile;
    else {
      const pick = this.stationFor(r, intent.target.place, intent.stationId);
      if (pick.station) { this.occupied.set(pick.station.id, r.id); r.station = pick.station; }
      target = pick.tile;
    }
    this.walkTo(r, target);
    r.state = intent.home ? 'leaving' : 'moving';
  }

  private wake(r: Resident): void {
    if (r.porch) { this.porches.delete(`${r.porch.x},${r.porch.y}`); r.porch = null; }
    r.state = 'idle';
    r.anim = 'stand';
    r.hold = 0;
    r.fade = 1;
    r.bubble = null;
    this.note(r, 'back to work');
  }

  private goHome(r: Resident): void {
    this.startIntent(r, { target: IDLE_TARGET, tool: null, home: true });
  }

  /** A keeper returns to its post by the lamp. */
  private goPost(r: Resident): void {
    this.leaveStation(r);
    const post = r.post ?? r.home.door;
    r.intent = { target: THINK_TARGET, tool: null, tile: post };
    this.walkTo(r, post);
    r.state = 'moving';
  }

  /** The coordinator goes to stand at its own door, facing you. */
  private goWait(r: Resident): void {
    if (r.post) { this.goPost(r); return; }
    this.leaveStation(r);
    r.intent = { target: IDLE_TARGET, tool: null, tile: r.home.door };
    this.walkTo(r, r.home.door);
    r.state = 'moving';
  }

  /** A runner heads back to whoever sent it. */
  private returnRunner(runner: Resident): void {
    this.leaveStation(runner);
    const parent = runner.parentId ? this.residents.get(runner.parentId) : null;
    const target = parent && parent.state !== 'gone' ? { x: Math.floor(parent.x / TILE), y: Math.floor(parent.y / TILE) + 1 } : runner.home.door;
    runner.intent = { target: IDLE_TARGET, tool: null, tile: target };
    this.walkTo(runner, target);
    runner.state = 'returning';
    runner.bubble = runner.failed ? '✗' : '✓';
  }

  private arrive(r: Resident): void {
    const intent = r.intent;
    if (!intent) { r.state = 'idle'; r.anim = 'stand'; return; }
    if (r.state === 'returning') {
      r.state = 'handing';
      r.anim = 'stand';
      r.facing = 'up';
      r.hold = RUNNER_HANDIN_SECONDS;
      this.setEmote(r, r.failed ? 'fail' : 'ok', RUNNER_HANDIN_SECONDS);
      const parent = r.parentId ? this.residents.get(r.parentId) : null;
      if (parent && r.failed) this.setEmote(parent, 'fail', 2);
      return;
    }
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
    if (intent.tile) {
      if (r.post && intent.tile.x === r.post.x && intent.tile.y === r.post.y) {
        r.state = 'posted';
        r.anim = 'stand';
        r.facing = 'down';
        r.hold = 0;
        r.quiet = 0;
        r.bubble = 'on watch';
        r.place = null;
        return;
      }
      if (intent.target.verb === 'pinning') {
        r.state = 'pinning';
        r.anim = 'work';
        r.style = 'desk';
        r.facing = 'up';
        r.hold = PIN_SECONDS;
        r.bubble = 'done';
        return;
      }
      // at the front door, facing the street
      r.state = 'waiting';
      r.anim = 'stand';
      r.facing = 'down';
      r.hold = 0;
      r.quiet = 0;
      r.bubble = 'waiting for you';
      r.place = null;
      return;
    }
    r.place = intent.target.place;
    r.style = intent.target.style;
    r.state = 'working';
    r.facing = r.station ? r.station.facing : 'down';
    r.anim = intent.target.style === 'sit' ? 'sit' : r.station ? 'work' : 'stand';
    if (r.station && r.station.prop.kind === 'barrel') r.anim = 'stand';
    r.hold = r.kind === 'runner' ? RUNNER_WORK_SECONDS : 0;
    r.bubble = bubbleFor(intent);
    if (intent.target.verb === 'idle') { r.bubble = null; r.state = 'idle'; }
  }

  update(dt: number): void {
    this.time += dt;
    for (const r of this.residents.values()) {
      r.clock += dt;
      if (r.emote && this.time > r.emoteUntil) r.emote = null;
      if (r.kind === 'runner') { this.updateRunner(r, dt); continue; }
      // waited at the door long enough: sit down on the porch (keepers go back on watch instead)
      if ((r.state === 'waiting' || r.state === 'idle' || r.state === 'working' || r.state === 'celebrating' || r.state === 'failed' || r.state === 'arriving')
        && !r.memory && this.time - r.lastEventAt > IDLE_HOME_SECONDS) {
        if (r.post) { r.queue.length = 0; r.intent = null; this.leaveStation(r); this.goPost(r); continue; }
        r.queue.length = 0;
        r.intent = null;
        this.leaveStation(r);
        this.goHome(r);
        this.note(r, 'went quiet, sat down');
        continue;
      }
      switch (r.state) {
        case 'arriving':
        case 'idle':
        case 'working':
        case 'celebrating':
        case 'failed':
        case 'pinning': {
          r.hold = Math.max(0, r.hold - dt);
          r.quiet += dt;
          if (r.hold > 0) break;
          if (r.state === 'pinning') { this.goWait(r); break; }
          if (r.state === 'celebrating' || r.state === 'failed') r.state = 'idle';
          const next = r.queue.shift();
          if (next) { this.startIntent(r, next); break; }
          if (r.state === 'working' && r.place === 'hall') {
            // thinking: runners out means a busy desk, none means a pause
            const out = this.runnersOf(r).length;
            r.anim = out > 0 ? 'work' : 'stand';
            r.bubble = out > 0 ? `${out} out` : r.quiet > 8 ? 'thinking' : null;
            if (r.quiet > 45 && out === 0) { this.goWait(r); }
            break;
          }
          if (r.state === 'working' && r.place !== 'hall') {
            // a session that somehow works elsewhere: after a while, go think
            if (r.quiet > 12) this.enqueue(r, { target: THINK_TARGET, tool: null });
            break;
          }
          if (r.state === 'idle' && r.quiet > 6) this.goWait(r);
          break;
        }
        case 'waiting': {
          r.quiet += dt;
          if (r.quiet > 120 && Math.random() < dt * 0.04) { this.setEmote(r, 'zzz', 3); }
          break;
        }
        case 'posted': {
          r.quiet += dt;
          // a keeper looks around now and then; it never leaves its post on its own
          if (r.quiet > 40 && Math.random() < dt * 0.05) { r.facing = (['left', 'right', 'down'] as const)[Math.floor(Math.random() * 3)]!; r.quiet = 15; }
          break;
        }
        case 'moving':
        case 'leaving':
          this.step(r, dt);
          break;
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
        default:
          break;
      }
    }
    for (const place of this.activity.keys()) {
      const total = this.map.stations.filter((s) => s.place === place).length || 1;
      const used = [...this.residents.values()].filter((r) => r.place === place && r.state === 'working').length;
      const target = Math.min(1, used / Math.min(2, total));
      const cur = this.activity.get(place) ?? 0;
      this.activity.set(place, cur + (target - cur) * Math.min(1, dt * 1.5));
    }
  }

  private updateRunner(r: Resident, dt: number): void {
    switch (r.state) {
      case 'arriving':
      case 'moving':
        if (r.state === 'arriving') { const next = r.queue.shift(); if (next) this.startIntent(r, next); break; }
        this.step(r, dt);
        break;
      case 'working':
      case 'idle': {
        r.hold = Math.max(0, r.hold - dt);
        r.quiet += dt;
        // a runner works at least its minimum, then heads back once the tool is done;
        // a tool that never reports back still returns after a long while
        if (r.hold <= 0 && (r.done || r.quiet > 90)) this.returnRunner(r);
        break;
      }
      case 'returning':
        this.step(r, dt);
        break;
      case 'handing': {
        r.hold -= dt;
        if (r.hold <= 0) { r.state = 'gone'; r.hold = GONE_AFTER_SECONDS; }
        break;
      }
      case 'gone': {
        r.hold -= dt;
        r.fade = Math.max(0, r.hold / GONE_AFTER_SECONDS);
        if (r.hold <= 0) this.residents.delete(r.id);
        break;
      }
      default:
        r.state = 'gone'; r.hold = GONE_AFTER_SECONDS;
        break;
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
  if (intent.tool) return intent.tool;
  if (intent.target.verb === 'idle') return null;
  return intent.target.verb;
}

function dist(a: Point, b: Point): number { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
