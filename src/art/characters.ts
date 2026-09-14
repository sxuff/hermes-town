import { CLOTH, HAIR, PAL } from './palette';
import { Painter, hashString, mulberry, outline, shade } from './painter';

/**
 * Procedural character sheets, 20×30 frames.
 *
 * Layout (frame index):
 *   0..15   walk, 4 facings × 4 frames (contact, pass, contact, pass)
 *   16      sit (facing down)
 *   17..    work: for each style, 3 orientations (side, down, up) × 2 frames
 *
 * "side" is drawn facing left; the renderer flips it for right.
 */
export const FRAME_W = 20;
export const FRAME_H = 30;
export const CHARACTER_SCALE = 2;

export type Facing = 'down' | 'left' | 'right' | 'up';
export const FACINGS: readonly Facing[] = ['down', 'left', 'right', 'up'];

export type WorkStyle = 'hammer' | 'read' | 'bellows' | 'parcel' | 'gaze' | 'desk' | 'sit' | 'haggle';
export const WORK_STYLES: readonly WorkStyle[] = ['hammer', 'read', 'bellows', 'parcel', 'gaze', 'desk', 'sit', 'haggle'];
type Orient = 'side' | 'down' | 'up';
const ORIENTS: readonly Orient[] = ['side', 'down', 'up'];

export function walkFrame(facing: Facing, i: number): number { return FACINGS.indexOf(facing) * 4 + (i % 4); }
export const SIT_FRAME = 16;
export function workFrame(style: WorkStyle, facing: Facing, i: number): number {
  const orient: Orient = facing === 'down' ? 'down' : facing === 'up' ? 'up' : 'side';
  return 17 + (WORK_STYLES.indexOf(style) * 3 + ORIENTS.indexOf(orient)) * 2 + (i % 2);
}
export const FRAME_COUNT = 17 + WORK_STYLES.length * 3 * 2;

export type RoleClass = 'coordinator' | 'research' | 'fabrication' | 'review' | 'tooling' | 'general';

export interface Look {
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bald' | 'mohawk';
  cloth: string;
  cloth2: string;
  pants: string;
  skin: string;
  hat: 'none' | 'cap' | 'hood' | 'band' | 'brim' | 'goggles';
  apron: boolean;
  beard: boolean;
  belt: boolean;
}

/** A stable look from a stable id, nudged by role so jobs read at a glance. */
export function lookFor(id: string, role: RoleClass): Look {
  const r = mulberry(hashString(id));
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)]!;
  const cloth = pick(CLOTH);
  const look: Look = {
    hair: pick(HAIR),
    hairStyle: pick(['short', 'short', 'long', 'bun', 'bald', 'mohawk'] as const),
    cloth,
    cloth2: shade(cloth, 0.72),
    pants: pick(['#3a3340', '#4a3a2a', '#2f3a44', '#5a4a3a']),
    skin: r() < 0.7 ? PAL.skin : PAL.skin2,
    hat: 'none',
    apron: false,
    beard: r() < 0.25,
    belt: r() < 0.6,
  };
  switch (role) {
    case 'coordinator': look.hat = 'brim'; look.cloth = pick(['#6b4a7a', '#3f5e7a', '#5a3d5c']); break;
    case 'research': look.hat = r() < 0.5 ? 'hood' : 'none'; look.cloth = pick(['#3f5e7a', '#2f6b66', '#4a4a56']); break;
    case 'fabrication': look.apron = true; look.hat = r() < 0.4 ? 'goggles' : 'none'; look.cloth = pick(['#7a3a2a', '#a0703a', '#7a6a3a']); break;
    case 'review': look.hat = 'band'; look.cloth = pick(['#4a4a56', '#7a6a3a', '#2f6b66']); break;
    case 'tooling': look.apron = r() < 0.5; look.hat = r() < 0.5 ? 'cap' : 'none'; look.cloth = pick(['#4f6b3a', '#4a4a56', '#3f5e7a']); break;
    default: break;
  }
  look.cloth2 = shade(look.cloth, 0.72);
  return look;
}

/** Layered cloth, hair, leather and articulated poses share the environment's
 * two-texel resolution. Frame indices remain the simulation's animation contract. */
export function paintCharacterSheet(look: Look): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W * FRAME_COUNT * CHARACTER_SCALE; canvas.height = FRAME_H * CHARACTER_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(CHARACTER_SCALE, CHARACTER_SCALE);
  const draw = (frame: number, facing: Facing, phase: number, style?: WorkStyle) => {
    ctx.save(); ctx.translate(frame * FRAME_W, 0);
    ctx.beginPath(); ctx.rect(0, 0, FRAME_W, FRAME_H); ctx.clip();
    if (facing === 'right') { ctx.translate(FRAME_W, 0); ctx.scale(-1, 1); }
    drawResident(ctx, look, facing === 'right' ? 'left' : facing, phase, style);
    ctx.restore();
  };
  for (const facing of FACINGS) for (let i = 0; i < 4; i++) draw(walkFrame(facing, i), facing, i);
  draw(SIT_FRAME, 'down', 0, 'sit');
  for (const style of WORK_STYLES) for (const facing of ['left', 'down', 'up'] as const) {
    for (let i = 0; i < 2; i++) draw(workFrame(style, facing, i), facing, i, style);
  }
  return canvas;
}

function drawResident(ctx: CanvasRenderingContext2D, look: Look, facing: Facing, phase: number, style?: WorkStyle): void {
  const side = facing === 'left', back = facing === 'up', sitting = style === 'sit';
  const step = style ? 0 : [1.8, 0, -1.8, 0][phase]!;
  const bob = !style && phase % 2 ? 0.5 : 0;
  const ink = '#272720', leather = '#594333', leatherLight = '#92704b';
  const shape = (points: number[][], color: string, edge = true) => {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!)); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    if (edge) { ctx.strokeStyle = ink; ctx.lineWidth = 0.65; ctx.stroke(); }
  };
  const line = (points: number[][], color: string, width = 0.6) => {
    ctx.beginPath(); points.forEach(([x,y], i) => i ? ctx.lineTo(x!, y!) : ctx.moveTo(x!, y!));
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  };
  const dot = (x: number, y: number, color: string, size = 0.6) => { ctx.fillStyle = color; ctx.fillRect(x, y, size, size); };
  const head = 6 + bob + (sitting ? 3 : 0), waist = 20 + (sitting ? 1 : 0);
  // Separate trouser legs and turned leather boots, articulated during walking.
  for (const [x, swing] of [[7.7, step], [11, -step]]) {
    const foot = sitting ? 27 : 28 - Math.max(0, swing!);
    shape([[x!, waist - 2], [x! + 2.6, waist - 2], [x! + 2.2 + swing! * 0.25, foot - 2], [x! - 0.3 + swing! * 0.25, foot - 2]], look.pants);
    const fx = x! + swing! * 0.25;
    shape([[fx - 0.5, foot - 3], [fx + 2.2, foot - 3], [fx + 2.4, foot], [fx - (side ? 1.7 : 0.8), foot], [fx - 1, foot - 1]], leather);
    line([[fx, foot - 2.5], [fx + 1.4, foot - 2.5]], leatherLight);
  }
  // Tapered coat hem, shoulder volume, seams, folds and belt hardware.
  const top = head + 6;
  shape([[7, top], [12.5, top], [14.4, top + 2], [13.6, waist - 3], [14, waist + 1], [10.5, waist + 2], [6, waist + 1], [6.8, waist - 3], [5.6, top + 2]], look.cloth);
  shape([[6, top + 2], [7.5, top + 1], [8.2, waist], [6.2, waist + 0.7]], look.cloth2, false);
  line([[9, top + 1], [8.6, waist - 2]], shade(look.cloth, 1.32), 0.7);
  line([[12, top + 3], [11.8, waist]], shade(look.cloth, 0.7), 0.7);
  if (look.apron) shape([[8, top + 1], [12, top + 1], [13, waist + 1], [7, waist + 1]], '#ad9270');
  line([[6.8, waist - 2], [13.5, waist - 2]], leather, 1.2);
  if (!back) { dot(10, waist - 2.5, '#cbb16d', 1.2); dot(10.4, waist - 2.2, leather, 0.5); }
  shape([[side ? 11.5 : 13, waist - 2], [side ? 14 : 15.3, waist - 1.5], [side ? 14 : 15, waist + 2], [side ? 11.5 : 12.8, waist + 2]], leather);
  line([[13, waist - 1], [14.4, waist - 1]], leatherLight);
  // Bent arms make the tool lifecycle readable at the same station positions.
  const working = style && !sitting;
  const raised = (style === 'hammer' || style === 'bellows') && phase === 0;
  const handX = side ? working ? (style === 'hammer' || style === 'bellows') && !raised ? 6.5 : 3.7 : 6 - step * 0.3 : 14.2;
  const handY = raised ? head + 1 : working ? top + 4 + phase * 0.4 : top + 6 + step * 0.3;
  line([[6.2, top + 1], [5.6, top + 4], [side ? 7 : 5, top + 6 - step * 0.25]], ink, 3);
  line([[6.2, top + 1], [5.6, top + 4], [side ? 7 : 5, top + 6 - step * 0.25]], look.cloth2, 2);
  line([[12.8, top + 1], [raised ? 12 : side ? 8.5 : 14, raised ? head - 0.5 : top + 3], [handX, handY]], ink, 3);
  line([[12.8, top + 1], [raised ? 12 : side ? 8.5 : 14, raised ? head - 0.5 : top + 3], [handX, handY]], look.cloth, 2);
  dot(handX - 0.65, handY - 0.6, look.skin, 1.5);
  // Rounded face silhouette, shaded cheek and individually picked-out hair locks.
  shape([[8, head], [11.5, head - 0.4], [13, head + 1.3], [12.6, head + 5], [11, head + 6.4], [8.5, head + 5.8], [side ? 6.7 : 7.5, head + 3.3]], back ? look.hair : look.skin);
  if (!back) {
    shape([[11.5, head + 1], [12.7, head + 1.4], [12.2, head + 5], [10.6, head + 6], [10.8, head + 3.8]], shade(look.skin, 0.8), false);
    dot(side ? 7.5 : 8.2, head + 3, ink, 0.65);
    if (!side) dot(11, head + 3, ink, 0.65);
    line([[side ? 7.3 : 9, head + 5], [side ? 8.2 : 10.2, head + 5]], shade(look.skin, 0.66), 0.45);
    if (look.beard) shape([[8, head + 4.5], [12.1, head + 4.7], [11, head + 6.6], [9.3, head + 6.3]], look.hair, false);
  }
  if (look.hairStyle !== 'bald') {
    shape([[7.2, head + 1.8], [7.7, head - 0.4], [9, head - 1.1], [12, head - 0.6], [13.1, head + 0.8], [12.8, head + (back ? 5.2 : 3)], [11.9, head + 1.1], [9.5, head + 0.6], [8.4, head + 2.2]], look.hair);
    for (let i = 0; i < 4; i++) line([[8.3 + i, head], [8.1 + i, head + 1.1]], shade(look.hair, 1.4), 0.45);
    if (look.hairStyle === 'long' || look.hairStyle === 'bun') shape([[11.8, head + 1], [13.5, head + 2], [13, head + 7], [11.7, head + 5]], look.hair);
  }
  if (look.hat !== 'none') {
    const hat = look.hat === 'hood' ? look.cloth2 : leather;
    shape([[6.8, head + 0.8], [7.8, head - 1.5], [11.8, head - 2], [13.4, head + 0.8]], hat);
    line([[6.5, head + 1], [13.8, head + 1]], look.hat === 'goggles' ? '#b39d65' : leatherLight, look.hat === 'brim' ? 1.5 : 0.8);
  }
  if (!working) return;
  const hx = handX, hy = handY;
  if (style === 'hammer' || style === 'bellows') {
    line([[hx, hy], [hx - (raised ? 1 : 4), hy - (raised ? 5 : 1)]], '#94734b', 1);
    shape([[hx - (raised ? 3 : 6), hy - (raised ? 6 : 3)], [hx + (raised ? 1 : -3), hy - (raised ? 6 : 3)], [hx + (raised ? 1 : -3), hy - (raised ? 4 : 0)], [hx - (raised ? 3 : 6), hy - (raised ? 4 : 0)]], '#8b9090');
  } else if (style === 'read') {
    shape([[hx - 3, hy - 2], [hx, hy - 1], [hx + 3, hy - 2 - phase * 0.4], [hx + 3, hy + 1], [hx, hy + 2], [hx - 3, hy + 1]], '#d8caa2');
    line([[hx, hy - 1], [hx, hy + 1.5]], '#887f69');
    line([[hx - 2.3, hy - 0.2], [hx - 0.8, hy + 0.2]], '#887f69', 0.4);
  } else if (style === 'parcel') {
    shape([[hx - 3, hy - 3], [hx + 2, hy - 3], [hx + 2, hy + 1], [hx - 3, hy + 1]], '#9f7950');
    line([[hx - 0.5, hy - 3], [hx - 0.5, hy + 1]], '#d5be89');
  } else if (style === 'desk') {
    line([[hx, hy + 0.7], [hx + 1 + phase * 0.4, hy - 4]], '#d9cda9', 0.8);
  } else if (style === 'gaze') {
    line([[side ? 7 : 8, head + 3], [side ? 2 : 12, head + 2 - phase * 0.5]], '#b99a58', 1.8);
  }
}

/** Small emote bubble sprites keyed by name. */
export function paintEmote(kind: 'ok' | 'fail' | 'think' | 'zzz' | 'wait'): HTMLCanvasElement {
  const p = new Painter(12, 12);
  p.disc(6, 5, 5, '#f7f1e3');
  p.rect(4, 10, 2, 2, '#f7f1e3');
  switch (kind) {
    case 'ok': p.px(3, 5, '#3b7a2a'); p.px(4, 6, '#3b7a2a'); p.px(5, 7, '#3b7a2a'); p.px(6, 6, '#3b7a2a'); p.px(7, 5, '#3b7a2a'); p.px(8, 4, '#3b7a2a'); p.px(9, 3, '#3b7a2a'); break;
    case 'fail': p.rect(5, 2, 2, 5, '#b8322a'); p.rect(5, 8, 2, 1, '#b8322a'); break;
    case 'think': p.rect(3, 4, 6, 1, PAL.stone2); p.rect(3, 6, 4, 1, PAL.stone2); break;
    case 'zzz': p.rect(3, 3, 3, 1, PAL.stone2); p.px(4, 4, PAL.stone2); p.rect(3, 5, 3, 1, PAL.stone2); p.rect(7, 5, 3, 1, PAL.stone2); p.px(8, 6, PAL.stone2); p.rect(7, 7, 3, 1, PAL.stone2); break;
    case 'wait': p.rect(4, 2, 4, 1, PAL.stone2); p.rect(4, 8, 4, 1, PAL.stone2); p.px(5, 3, PAL.stone2); p.px(6, 3, PAL.stone2); p.px(5, 7, PAL.stone2); p.px(6, 7, PAL.stone2); p.px(5, 5, PAL.stone2); p.px(6, 5, PAL.stone2); break;
  }
  outline(p, PAL.outline);
  return p.canvas;
}
