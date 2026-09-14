import type { BuildingKind } from '../art/buildings';
import type { WorkStyle } from '../art/characters';

/**
 * The town's whole vocabulary: a tool name becomes a place and a way of
 * working there. Anything unrecognised goes to the market, so an unknown tool
 * is still visible work rather than a resident standing still.
 */
export type Place = Exclude<BuildingKind, 'house'>;

export type { WorkStyle };

export interface ToolTarget {
  place: Place;
  style: WorkStyle;
  /** Short verb shown in the bubble beside the tool name. */
  verb: string;
}

const RULES: [RegExp, ToolTarget][] = [
  [/^(read|grep|glob|cat|ls|find|view|search_files|list_dir|read_file|rg|head|tail|less|tree)$/i, { place: 'library', style: 'read', verb: 'reading' }],
  [/^(edit|write|multiedit|str_replace|create_file|write_file|patch|apply_patch|notebookedit|replace)$/i, { place: 'workshop', style: 'hammer', verb: 'editing' }],
  [/^(bash|shell|terminal|execute|run|exec|powershell|cmd|python|node|npm|pytest|test|make|cargo|go)$/i, { place: 'forge', style: 'bellows', verb: 'running' }],
  [/^(git.*|gh|github.*|commit|push|pull|pr|merge|rebase)$/i, { place: 'post', style: 'parcel', verb: 'shipping' }],
  [/^(web.*|fetch|http.*|curl|browse.*|browser.*|search|websearch|webfetch|navigate|url)$/i, { place: 'observatory', style: 'gaze', verb: 'browsing' }],
  [/^(agent|task|delegate.*|spawn.*|subagent.*|sendmessage|team.*)$/i, { place: 'hall', style: 'desk', verb: 'delegating' }],
  [/^(todo.*|plan.*|memory.*|note.*|think.*|reflect.*)$/i, { place: 'hall', style: 'desk', verb: 'planning' }],
  [/^(sleep|wait|ask.*|question.*|prompt.*)$/i, { place: 'tavern', style: 'sit', verb: 'waiting' }],
];

export function targetForTool(tool: string): ToolTarget {
  const t = tool.replace(/^mcp__.*?__/, '').replace(/^functions\./, '');
  for (const [re, target] of RULES) if (re.test(t)) return target;
  if (/edit|write/i.test(t)) return RULES[1]![1];
  if (/read|list|get|search|find/i.test(t)) return RULES[0]![1];
  if (/run|exec|shell/i.test(t)) return RULES[2]![1];
  if (/git/i.test(t)) return RULES[3]![1];
  if (/web|http|fetch|browser/i.test(t)) return RULES[4]![1];
  return { place: 'market', style: 'haggle', verb: 'using' };
}

/** Where a resident goes when it has no tool but is thinking (an LLM turn). */
export const THINK_TARGET: ToolTarget = { place: 'hall', style: 'desk', verb: 'thinking' };
/** Where a resident goes between turns. */
export const IDLE_TARGET: ToolTarget = { place: 'tavern', style: 'sit', verb: 'idle' };

export const PLACE_LABEL: Record<Place, string> = {
  library: 'Library',
  workshop: 'Workshop',
  forge: 'Forge',
  post: 'Post office',
  observatory: 'Observatory',
  hall: 'Town hall',
  tavern: 'Tavern',
  market: 'Market',
};
