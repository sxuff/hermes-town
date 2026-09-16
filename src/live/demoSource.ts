import type { RoleClass } from '../art/characters';
import type { EventSink, Source, SourceStatus, TownEvent, TownEventType } from './events';

/**
 * A scripted stand-in for Hermes: a couple of chat sessions that behave the
 * way a real one does. A turn starts (`assigned`), a burst of tool calls goes
 * out, each comes back (`waiting`), the turn ends (`completed`), and then the
 * session sits waiting for the user for a while before the next turn. Some
 * turns delegate a subagent. Labelled as a demo everywhere it is shown.
 */
const TOOLS_BY_ROLE: Record<RoleClass, string[]> = {
  coordinator: ['read_file', 'search_files', 'terminal', 'write_file', 'delegate_task', 'todo_list', 'web_search'],
  research: ['search_files', 'read_file', 'web_search', 'web_extract', 'read_file', 'vision_analyze'],
  fabrication: ['read_file', 'write_file', 'patch', 'terminal', 'patch', 'execute_code'],
  review: ['read_file', 'search_files', 'terminal', 'read_file', 'kanban_comment'],
  tooling: ['terminal', 'process_manage', 'terminal', 'discord', 'browser_navigate', 'browser_snapshot'],
  general: ['read_file', 'write_file', 'terminal', 'search_files'],
};
const NAMES = ['auth refactor', 'docs site', 'scraper', 'flaky tests', 'landing page', 'db migration', 'perf pass', 'onboarding'];

export function createDemoSource(sink: EventSink): Source {
  let status: SourceStatus = 'idle';
  let timer: number | null = null;
  let counter = 0;
  const seqs = new Map<string, number>();
  const timers = new Set<number>();
  const now = () => Date.now() / 1000;

  const emit = (agentId: string, type: TownEventType, extra: Partial<TownEvent> = {}): void => {
    if (status !== 'connected') return;
    const seq = (seqs.get(agentId) ?? 0) + 1;
    seqs.set(agentId, seq);
    counter += 1;
    sink.push({ id: `demo-${counter}`, seq, at: now(), agentId, type, ...extra });
  };
  const later = (seconds: number, fn: () => void): void => {
    const id = window.setTimeout(() => { timers.delete(id); if (status === 'connected') fn(); }, seconds * 1000);
    timers.add(id);
  };
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

  interface Session { id: string; role: RoleClass; turnsLeft: number; child: boolean }
  const sessions: Session[] = [];

  /** One turn: a burst of tools, then done. */
  const turn = (s: Session): void => {
    emit(s.id, 'agent.assigned', { action: s.child ? 'delegated task' : 'turn started' });
    const calls = Math.floor(rnd(2, 7));
    let t = rnd(0.8, 2);
    for (let i = 0; i < calls; i++) {
      const tool = pick(TOOLS_BY_ROLE[s.role]);
      later(t, () => {
        emit(s.id, 'agent.tool_started', { tool });
        if (tool === 'delegate_task' && s.turnsLeft > 1) spawn(pick(['research', 'fabrication', 'review', 'tooling'] as const), true, s.id.slice(-4));
        const failed = Math.random() < 0.08;
        later(rnd(0.3, 3), () => emit(s.id, failed ? 'agent.failed' : 'agent.waiting', failed ? { reason: 'tool error' } : { action: 'tool done' }));
      });
      t += rnd(0.6, 2.5);
    }
    later(t + rnd(2, 5), () => {
      s.turnsLeft -= 1;
      emit(s.id, 'agent.completed', { action: 'turn completed' });
      if (s.turnsLeft <= 0) {
        later(rnd(4, 9), () => { emit(s.id, 'agent.departed'); const i = sessions.indexOf(s); if (i >= 0) sessions.splice(i, 1); });
        return;
      }
      // the user reads the answer and types the next thing
      later(s.child ? rnd(2, 5) : rnd(15, 45), () => turn(s));
    });
  };

  const spawn = (role: RoleClass, child: boolean, parent?: string): void => {
    counter += 1;
    const id = `h/${child ? 'child' : 'main'}/${(Math.random() * 0xffffffff >>> 0).toString(16).padStart(8, '0')}${counter.toString(16).padStart(8, '0')}`;
    const s: Session = { id, role, turnsLeft: child ? 1 : Math.floor(rnd(3, 8)), child };
    sessions.push(s);
    emit(id, 'agent.spawned', { role, displayName: `${role[0]!.toUpperCase()}${role.slice(1)} ${id.slice(-4)}`, title: child ? `helper for ${parent}` : pick(NAMES) });
    later(rnd(1, 3), () => turn(s));
  };

  const tick = (): void => {
    const mains = sessions.filter((s) => !s.child).length;
    if (mains < 2 || (mains < 3 && Math.random() < 0.15)) spawn(mains === 0 ? 'coordinator' : pick(['coordinator', 'general', 'fabrication'] as const), false);
  };

  return {
    label: 'demo events',
    start() {
      status = 'connected';
      tick();
      timer = window.setInterval(tick, 12000);
    },
    stop() {
      status = 'idle';
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    },
    status: () => status,
    now,
  };
}
