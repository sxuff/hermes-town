import type { RoleClass } from '../art/characters';
import type { EventSink, Source, SourceStatus, TownEvent, TownEventType } from './events';

/**
 * A scripted stand-in for Hermes: a handful of sessions that spawn, think,
 * call tools in plausible bursts, delegate children, and finish. Lets the town
 * be watched without a runtime attached, and is labelled as such.
 */
const TOOLS_BY_ROLE: Record<RoleClass, string[]> = {
  coordinator: ['Read', 'Agent', 'TodoWrite', 'Bash', 'Grep', 'Edit'],
  research: ['Grep', 'Read', 'Glob', 'WebSearch', 'WebFetch', 'Read'],
  fabrication: ['Read', 'Edit', 'Write', 'Bash', 'Edit', 'Bash'],
  review: ['Read', 'Grep', 'Bash', 'Read', 'git.diff'],
  tooling: ['Bash', 'Bash', 'git.commit', 'gh', 'Bash'],
  general: ['Read', 'Edit', 'Bash', 'Grep'],
};
const NAMES = ['auth refactor', 'docs site', 'scraper', 'flaky tests', 'landing page', 'db migration', 'perf pass', 'onboarding'];

export function createDemoSource(sink: EventSink): Source {
  let status: SourceStatus = 'idle';
  let timer: number | null = null;
  let counter = 0;
  const seqs = new Map<string, number>();
  const now = () => Date.now() / 1000;

  const emit = (agentId: string, type: TownEventType, extra: Partial<TownEvent> = {}): void => {
    const seq = (seqs.get(agentId) ?? 0) + 1;
    seqs.set(agentId, seq);
    counter += 1;
    sink.push({ id: `demo-${counter}`, seq, at: now(), agentId, type, ...extra });
  };

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

  interface Session { id: string; role: RoleClass; steps: number; children: number; }
  const sessions: Session[] = [];
  let mainCount = 0;

  const scheduleSession = (s: Session, delay: number): void => {
    window.setTimeout(() => step(s), delay * 1000);
  };

  const step = (s: Session): void => {
    if (status !== 'connected') return;
    s.steps -= 1;
    if (s.steps <= 0) {
      const failed = Math.random() < 0.12;
      emit(s.id, failed ? 'agent.failed' : 'agent.completed', failed ? { reason: 'reported failure' } : { action: 'work completed' });
      window.setTimeout(() => emit(s.id, 'agent.departed'), rnd(2, 5) * 1000);
      const i = sessions.indexOf(s);
      if (i >= 0) sessions.splice(i, 1);
      return;
    }
    const roll = Math.random();
    if (roll < 0.12 && s.role === 'coordinator' && s.children < 3) {
      s.children += 1;
      emit(s.id, 'agent.tool_started', { tool: 'Agent' });
      spawn(pick(['research', 'fabrication', 'review', 'tooling'] as const), true, s.id.slice(-4));
      scheduleSession(s, rnd(3, 6));
    } else if (roll < 0.3) {
      emit(s.id, 'agent.waiting', { action: 'thinking' });
      scheduleSession(s, rnd(2, 6));
    } else {
      emit(s.id, 'agent.tool_started', { tool: pick(TOOLS_BY_ROLE[s.role]) });
      scheduleSession(s, rnd(1.5, 5));
    }
  };

  const spawn = (role: RoleClass, child: boolean, parent?: string): void => {
    counter += 1;
    const id = `h/${child ? 'child' : 'main'}/${(Math.random() * 0xffffffff >>> 0).toString(16).padStart(8, '0')}${counter.toString(16).padStart(8, '0')}`;
    const s: Session = { id, role, steps: child ? Math.floor(rnd(4, 9)) : Math.floor(rnd(10, 26)), children: 0 };
    sessions.push(s);
    if (!child) mainCount += 1;
    const title = child ? `helper for ${parent}` : pick(NAMES);
    emit(id, 'agent.spawned', { role, displayName: `${role[0]!.toUpperCase()}${role.slice(1)} ${id.slice(-4)}`, title });
    window.setTimeout(() => { emit(id, 'agent.assigned', { action: child ? 'delegated task' : 'central dispatch' }); scheduleSession(s, rnd(1, 3)); }, 800);
  };

  const tick = (): void => {
    const mains = sessions.filter((s) => s.id.startsWith('h/main/')).length;
    if (mains < 3 || (mains < 5 && Math.random() < 0.3)) spawn(mains === 0 ? 'coordinator' : pick(['coordinator', 'research', 'fabrication', 'tooling', 'general'] as const), false);
  };

  return {
    label: 'demo events',
    start() {
      status = 'connected';
      tick();
      timer = window.setInterval(tick, 9000);
    },
    stop() { status = 'idle'; if (timer !== null) window.clearInterval(timer); timer = null; },
    status: () => status,
    now,
  };
}
