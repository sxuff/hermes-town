import { CLOTH, HAIR, PAL } from './palette';
import { Painter, hashString, mulberry, outline, shade } from './painter';

/**
 * Resident sprites, drawn to the concept sheet: a big head under a wide brim,
 * two dot eyes and nothing else on the face, a tunic with a satchel strap and
 * a buckled belt, dark trousers, brown boots, and both arms always visible.
 * Flat two-tone shading, one dark outline, no anti-aliasing anywhere.
 *
 * Frames are 20×30 texels, painted on that grid and blitted at 2× so they
 * share the world's texel density. Layout (frame index):
 *   0..15   walk, 4 facings × 4 frames (contact, pass, contact, pass)
 *   16      sit (facing down)
 *   17..    work: for each style, 3 orientations (side, down, up) × 2 frames
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

export type RoleClass = 'coordinator' | 'research' | 'fabrication' | 'review' | 'tooling' | 'general' | 'scheduled';

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
    hairStyle: pick(['short', 'long', 'long', 'bun', 'short', 'bald', 'mohawk'] as const),
    cloth,
    cloth2: shade(cloth, 0.72),
    pants: pick(['#4a4548', '#3f3a44', '#4a3d36', '#3a4048']),
    skin: r() < 0.7 ? PAL.skin : PAL.skin2,
    hat: r() < 0.35 ? 'brim' : 'none',
    apron: false,
    beard: r() < 0.2,
    belt: true,
  };
  switch (role) {
    case 'coordinator': look.hat = 'brim'; look.cloth = pick(['#6b4a7a', '#5e3f78', '#3f5e7a']); break;
    case 'research': look.hat = r() < 0.5 ? 'hood' : 'none'; look.cloth = pick(['#3f5e7a', '#2f6b66', '#4a4a56']); break;
    case 'fabrication': look.apron = true; look.hat = r() < 0.4 ? 'goggles' : 'none'; look.cloth = pick(['#7a3a2a', '#a0703a', '#7a6a3a']); break;
    case 'review': look.hat = 'band'; look.cloth = pick(['#4a4a56', '#7a6a3a', '#2f6b66']); break;
    case 'tooling': look.apron = r() < 0.5; look.hat = r() < 0.5 ? 'cap' : 'none'; look.cloth = pick(['#4f6b3a', '#4a4a56', '#3f5e7a']); break;
    case 'scheduled': look.hat = 'hood'; look.cloth = pick(['#2f3a5a', '#3a3350', '#2f4a4a']); look.beard = false; break;
    default: break;
  }
  look.cloth2 = shade(look.cloth, 0.72);
  return look;
}

const INK = '#2a1f1c';
const HAT = '#8a6a3f';
const HAT_DARK = '#6b4f2e';
const STRAP = '#5a3d24';
const BUCKLE = '#d9b34a';
const BOOT = '#7a4f2e';
const BOOT_DARK = '#5a3820';
const APRON = '#ad9270';
const APRON_DARK = '#8a7454';

export function paintCharacterSheet(look: Look): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W * FRAME_COUNT * CHARACTER_SCALE;
  canvas.height = FRAME_H * CHARACTER_SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const put = (index: number, frame: Painter) => {
    ctx.drawImage(frame.canvas, index * FRAME_W * CHARACTER_SCALE, 0, FRAME_W * CHARACTER_SCALE, FRAME_H * CHARACTER_SCALE);
  };
  for (const facing of FACINGS) for (let i = 0; i < 4; i++) put(walkFrame(facing, i), drawFrame(look, facing, 'walk', i));
  put(SIT_FRAME, drawFrame(look, 'down', 'sit', 0));
  for (const style of WORK_STYLES) for (const o of ORIENTS) for (let i = 0; i < 2; i++) {
    const facing: Facing = o === 'side' ? 'left' : o;
    put(workFrame(style, facing, i), drawFrame(look, facing, style, i));
  }
  return canvas;
}

type Mode = 'walk' | WorkStyle;

/** One 20×30 frame. `right` is painted as `left` and mirrored. */
function drawFrame(look: Look, facing: Facing, mode: Mode, phase: number): Painter {
  const p = new Painter(FRAME_W, FRAME_H);
  const mirror = facing === 'right';
  const f: Facing = mirror ? 'left' : facing;
  const X = (x: number) => (mirror ? FRAME_W - 1 - x : x);
  const px = (x: number, y: number, c: string) => { if (x >= 0 && y >= 0 && x < FRAME_W && y < FRAME_H) p.px(X(x), y, c); };
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) px(x + k, y + j, c);
  };

  const side = f === 'left', back = f === 'up';
  const walking = mode === 'walk';
  const sitting = mode === 'sit';
  const working = !walking && !sitting;
  const stride = walking ? [1, 0, -1, 0][phase]! : 0;
  const bob = walking && phase % 2 === 1 ? 1 : 0;
  const oy = sitting ? 4 : bob;           // head and torso shift; feet stay on the ground
  const hairDark = shade(look.hair, 0.7);
  const skinDark = shade(look.skin, 0.82);
  const pantsDark = shade(look.pants, 0.78);
  const hand = (x: number, y: number) => rect(x, y, 2, 2, look.skin);

  // ------------------------------------------------------------- legs
  const legTop = 21 + oy;
  if (sitting) {
    rect(5, 22, 10, 3, look.pants);
    rect(5, 24, 10, 1, pantsDark);
    rect(4, 25, 3, 3, BOOT); rect(13, 25, 3, 3, BOOT);
    rect(4, 27, 3, 1, BOOT_DARK); rect(13, 27, 3, 1, BOOT_DARK);
  } else if (side) {
    const backX = 9 + stride, frontX = 8 - stride;
    rect(backX, legTop, 3, 5, pantsDark);
    rect(backX - 1, 26, 4, 3, BOOT_DARK);
    rect(frontX, legTop, 3, 5, look.pants);
    rect(frontX - 2, 26, 5, 3, BOOT);
    rect(frontX - 2, 28, 5, 1, BOOT_DARK);
  } else {
    const l = Math.max(0, stride), r = Math.max(0, -stride);
    rect(5, legTop, 4, 5 + l - oy, look.pants);
    rect(11, legTop, 4, 5 + r - oy, look.pants);
    rect(5, 26 + l, 4, 3 - l, BOOT); rect(11, 26 + r, 4, 3 - r, BOOT);
    rect(5, 28, 4, 1, BOOT_DARK); rect(11, 28, 4, 1, BOOT_DARK);
    if (!back) { px(8, legTop, pantsDark); px(11, legTop, pantsDark); }
  }

  // ------------------------------------------------------------- back arm (side view), behind the body
  const shoulder = 13 + oy;
  const armLen = 6;
  if (side && !sitting) {
    const raised = working && (mode === 'hammer' || mode === 'bellows') && phase === 0;
    if (!raised) { rect(13, shoulder + 1 - stride, 2, armLen, look.cloth2); rect(13, shoulder + 1 - stride + armLen, 2, 2, skinDark); }
  }

  // ------------------------------------------------------------- torso
  const torsoTop = 12 + oy;
  if (side) {
    rect(6, torsoTop, 8, 9, look.cloth);
    rect(12, torsoTop, 2, 9, look.cloth2);
    rect(6, torsoTop + 8, 8, 1, look.cloth2);
  } else {
    rect(5, torsoTop, 10, 9, look.cloth);
    rect(5, torsoTop + 8, 10, 1, look.cloth2);
    rect(13, torsoTop + 1, 2, 7, look.cloth2);
    if (!back) { px(9, torsoTop, look.cloth2); px(10, torsoTop, look.cloth2); }
  }
  if (look.apron && !back) {
    rect(6, torsoTop + 2, side ? 6 : 8, 8, APRON);
    rect(6, torsoTop + 2, side ? 6 : 8, 1, APRON_DARK);
    rect(side ? 6 : 7, torsoTop + 9, 6, 1, APRON_DARK);
  }
  // satchel strap across the chest, or the back
  if (!side) {
    for (let i = 0; i < 7; i++) { const sx = back ? 6 + i : 13 - i; px(sx, torsoTop + i, STRAP); }
    if (!back) rect(5, torsoTop + 5, 2, 3, STRAP);
  } else {
    rect(11, torsoTop, 2, 7, STRAP);
    rect(12, torsoTop + 6, 2, 3, STRAP);
  }
  if (look.belt) {
    rect(side ? 6 : 5, torsoTop + 6, side ? 8 : 10, 1, STRAP);
    if (!back) { px(side ? 8 : 9, torsoTop + 6, BUCKLE); px(side ? 8 : 10, torsoTop + 6, BUCKLE); }
  }

  // ------------------------------------------------------------- arms in front
  let handL = { x: 3, y: shoulder + armLen }, handR = { x: 15, y: shoulder + armLen };
  if (sitting) {
    rect(3, shoulder, 2, 5, look.cloth); rect(15, shoulder, 2, 5, look.cloth);
    hand(3, shoulder + 5); hand(15, shoulder + 5);
  } else if (side) {
    const raised = working && (mode === 'hammer' || mode === 'bellows') && phase === 0;
    const forward = working && (mode === 'read' || mode === 'parcel' || mode === 'desk' || mode === 'gaze'
      || ((mode === 'hammer' || mode === 'bellows') && phase === 1) || (mode === 'haggle' && phase === 0));
    if (raised) {
      rect(5, shoulder - 5, 2, 6, look.cloth); hand(5, shoulder - 7); handL = { x: 5, y: shoulder - 7 };
    } else if (forward) {
      rect(5, shoulder, 2, 3, look.cloth); rect(2, shoulder + 2, 4, 2, look.cloth); hand(1, shoulder + 2); handL = { x: 1, y: shoulder + 2 };
    } else {
      rect(5, shoulder + stride, 2, armLen, look.cloth); hand(5, shoulder + stride + armLen); handL = { x: 5, y: shoulder + stride + armLen };
    }
  } else if (back) {
    const up = working && (mode === 'hammer' || mode === 'bellows' || mode === 'haggle') && phase === 0;
    if (up) {
      rect(3, shoulder - 5, 2, armLen, look.cloth); rect(15, shoulder - 5, 2, armLen, look.cloth);
      hand(3, shoulder - 7); hand(15, shoulder - 7);
    } else {
      rect(3, shoulder + stride, 2, armLen, look.cloth); rect(15, shoulder - stride, 2, armLen, look.cloth);
      hand(3, shoulder + stride + armLen); hand(15, shoulder - stride + armLen);
    }
  } else {
    const fwd = working && (mode === 'read' || mode === 'parcel' || mode === 'desk');
    const wave = working && mode === 'haggle';
    const up = working && (mode === 'hammer' || mode === 'bellows') && phase === 0;
    if (fwd) {
      rect(3, shoulder, 2, 4, look.cloth); rect(15, shoulder, 2, 4, look.cloth);
      rect(4, shoulder + 3, 2, 2, look.cloth); rect(14, shoulder + 3, 2, 2, look.cloth);
      handL = { x: 5, y: shoulder + 4 }; handR = { x: 13, y: shoulder + 4 };
      hand(handL.x, handL.y); hand(handR.x, handR.y);
    } else if (wave) {
      rect(3, shoulder, 2, armLen, look.cloth); hand(3, shoulder + armLen);
      const lift = phase === 0 ? 6 : 3;
      rect(15, shoulder - lift, 2, lift + 1, look.cloth); hand(15, shoulder - lift - 2); handR = { x: 15, y: shoulder - lift - 2 };
    } else if (up) {
      rect(3, shoulder, 2, armLen, look.cloth); hand(3, shoulder + armLen);
      rect(15, shoulder - 6, 2, 7, look.cloth); hand(15, shoulder - 8); handR = { x: 15, y: shoulder - 8 };
    } else if (working && mode === 'gaze') {
      rect(3, shoulder, 2, armLen, look.cloth); hand(3, shoulder + armLen);
      rect(15, shoulder - 3, 2, 4, look.cloth); rect(13, shoulder - 4, 3, 2, look.cloth); hand(11, shoulder - 5); handR = { x: 11, y: shoulder - 5 };
    } else {
      rect(3, shoulder - stride, 2, armLen, look.cloth); rect(15, shoulder + stride, 2, armLen, look.cloth);
      hand(3, shoulder - stride + armLen); hand(15, shoulder + stride + armLen);
    }
  }

  // ------------------------------------------------------------- head
  const headTop = 2 + oy;
  const faceX = side ? 6 : 5, faceW = side ? 8 : 10;
  if (back) {
    rect(5, headTop, 10, 10, look.hairStyle === 'bald' ? look.skin : look.hair);
    rect(5, headTop + 8, 10, 2, look.hairStyle === 'bald' ? skinDark : hairDark);
    if (look.hairStyle === 'long') { rect(5, headTop + 10, 10, 3, look.hair); rect(5, headTop + 12, 10, 1, hairDark); }
    if (look.hairStyle === 'bun') rect(8, headTop - 2, 4, 2, look.hair);
  } else {
    rect(faceX, headTop + 1, faceW, 9, look.skin);
    rect(faceX + faceW - 1, headTop + 2, 1, 7, skinDark);
    rect(faceX, headTop + 9, faceW, 1, skinDark);
    if (side) rect(faceX + 1, headTop + 5, 1, 2, INK);
    else { rect(faceX + 2, headTop + 5, 1, 2, INK); rect(faceX + faceW - 3, headTop + 5, 1, 2, INK); }
    if (look.beard) { rect(faceX + 1, headTop + 8, faceW - 2, 2, look.hair); rect(faceX + 1, headTop + 9, faceW - 2, 1, hairDark); }
    if (look.hairStyle !== 'bald') {
      rect(faceX, headTop, faceW, 2, look.hair);
      rect(faceX, headTop, faceW, 1, hairDark);
      const drape = look.hairStyle === 'long' ? 10 : 4;
      if (side) { rect(faceX + faceW - 1, headTop + 1, 2, drape + 1, look.hair); px(faceX + faceW, headTop + 1, hairDark); }
      else { rect(faceX - 1, headTop + 1, 1, drape, look.hair); rect(faceX + faceW, headTop + 1, 1, drape, look.hair); }
      if (look.hairStyle === 'bun') rect(side ? faceX + faceW : faceX + 2, headTop - 2, 3, 2, look.hair);
      if (look.hairStyle === 'mohawk') rect(faceX + 3, headTop - 2, 2, 3, look.hair);
    } else {
      rect(faceX, headTop, faceW, 1, skinDark);
    }
  }
  const brimY = headTop + 1;
  switch (look.hat) {
    case 'brim':
      rect(side ? 1 : 2, brimY, side ? 17 : 16, 2, HAT);
      rect(side ? 1 : 2, brimY + 1, side ? 17 : 16, 1, HAT_DARK);
      rect(5, headTop - 2, 10, 3, HAT);
      rect(5, headTop - 2, 10, 1, shade(HAT, 1.15));
      rect(5, headTop, 10, 1, HAT_DARK);
      break;
    case 'cap':
      rect(faceX - 1, headTop - 1, faceW + 2, 3, look.cloth2);
      if (side) rect(faceX - 3, headTop + 1, 3, 1, look.cloth2); else rect(faceX - 1, headTop + 2, faceW + 2, 1, look.cloth2);
      break;
    case 'hood':
      rect(faceX - 1, headTop - 1, faceW + 2, 3, look.cloth2);
      rect(faceX - 1, headTop + 2, 1, 7, look.cloth2); rect(faceX + faceW, headTop + 2, 1, 7, look.cloth2);
      break;
    case 'band':
      rect(faceX, headTop + 2, faceW, 1, BUCKLE);
      break;
    case 'goggles':
      rect(faceX, headTop + 1, faceW, 2, INK);
      px(faceX + 1, headTop + 1, '#7fb2dd'); if (!side) px(faceX + 5, headTop + 1, '#7fb2dd');
      break;
    default:
      break;
  }

  // ------------------------------------------------------------- what the hands hold
  if (working) {
    if (side) {
      if (mode === 'hammer' || mode === 'bellows') {
        if (phase === 0) { rect(handL.x, handL.y - 5, 1, 5, STRAP); rect(handL.x - 2, handL.y - 7, 5, 3, '#8b9090'); rect(handL.x - 2, handL.y - 7, 5, 1, '#b5b8b8'); }
        else { rect(handL.x - 5, handL.y + 1, 6, 1, STRAP); rect(handL.x - 8, handL.y, 3, 3, '#8b9090'); }
      } else if (mode === 'read') { rect(handL.x - 3, handL.y - 2, 7, 5, '#d8caa2'); rect(handL.x, handL.y - 2, 1, 5, '#a89a74'); if (phase === 1) px(handL.x + 2, handL.y - 3, '#f1ead8'); }
      else if (mode === 'parcel') { rect(handL.x - 3, handL.y - 4, 7, 6, '#9f7950'); rect(handL.x - 3, handL.y - 4, 7, 1, '#c0955f'); rect(handL.x, handL.y - 4, 1, 6, '#d5be89'); }
      else if (mode === 'desk') { rect(handL.x + 1, handL.y - 5 + phase, 1, 5, '#e0d3a0'); px(handL.x + 1, handL.y - 6 + phase, '#c9b58f'); }
      else if (mode === 'gaze') { rect(handL.x - 6, headTop + 5 - phase, 8, 2, '#b99a58'); rect(handL.x - 7, headTop + 4 - phase, 2, 4, '#8a7a3a'); }
      else if (mode === 'haggle' && phase === 0) { px(handL.x - 2, handL.y - 2, BUCKLE); px(handL.x - 3, handL.y - 4, BUCKLE); }
    } else if (!back) {
      if (mode === 'read') { rect(6, handL.y - 1, 8, 5, '#d8caa2'); rect(10, handL.y - 1, 1, 5, '#a89a74'); rect(7, handL.y, 2, 1, '#a89a74'); if (phase === 1) px(11, handL.y - 2, '#f1ead8'); }
      else if (mode === 'parcel') { rect(5, handL.y - 5, 10, 7, '#9f7950'); rect(5, handL.y - 5, 10, 1, '#c0955f'); rect(9, handL.y - 5, 2, 7, '#d5be89'); rect(5, handL.y - 2, 10, 1, '#d5be89'); hand(4, handL.y - 1); hand(14, handL.y - 1); }
      else if (mode === 'desk') { rect(handR.x, handR.y - 4 + phase, 1, 4, '#e0d3a0'); }
      else if (mode === 'haggle' && phase === 0) { px(handR.x + 3, handR.y - 2, BUCKLE); px(handR.x + 4, handR.y - 4, BUCKLE); px(handR.x + 2, handR.y - 5, BUCKLE); }
      else if (mode === 'hammer' || mode === 'bellows') {
        if (phase === 0) { rect(handR.x, handR.y - 5, 1, 5, STRAP); rect(handR.x - 2, handR.y - 7, 5, 3, '#8b9090'); rect(handR.x - 2, handR.y - 7, 5, 1, '#b5b8b8'); }
        else { rect(16, shoulder + 2, 1, 5, STRAP); rect(15, shoulder + 7, 4, 3, '#8b9090'); }
      } else if (mode === 'gaze') { rect(handR.x - 6, handR.y - 1, 8, 2, '#b99a58'); }
    }
  }

  outline(p, INK);
  return p;
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
