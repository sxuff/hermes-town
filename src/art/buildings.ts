import { PAL } from './palette';
import { Painter, outline } from './painter';

export type BuildingKind = 'library' | 'workshop' | 'forge' | 'post' | 'observatory' | 'hall' | 'tavern' | 'house' | 'market';

/** Anvil workstation, 16x12. */
export function paintAnvil(): HTMLCanvasElement {
  const p = new Painter(16, 12);
  p.rect(4, 8, 8, 4, PAL.stone2);
  p.rect(2, 3, 12, 4, PAL.stone);
  p.rect(1, 3, 3, 2, PAL.stone);
  p.rect(5, 6, 6, 3, PAL.stone2);
  p.hline(2, 3, 12, '#b5b0a8');
  outline(p, PAL.outline);
  return p.canvas;
}

/** Workbench with a vice, 22x14. */
export function paintWorkbench(): HTMLCanvasElement {
  const p = new Painter(22, 14);
  p.rect(1, 4, 20, 4, PAL.wood3);
  p.rect(1, 7, 20, 1, PAL.wood2);
  p.rect(2, 8, 3, 6, PAL.wood2);
  p.rect(17, 8, 3, 6, PAL.wood2);
  p.rect(14, 1, 5, 4, PAL.stone2);
  p.rect(3, 2, 6, 2, PAL.wood);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Lectern with an open book, 14x16. */
export function paintLectern(): HTMLCanvasElement {
  const p = new Painter(14, 16);
  p.rect(5, 6, 4, 10, PAL.wood2);
  p.rect(3, 14, 8, 2, PAL.wood2);
  p.rect(1, 3, 12, 4, PAL.wood3);
  p.rect(2, 1, 10, 3, PAL.plaster);
  p.vline(7, 1, 3, PAL.plaster2);
  p.hline(3, 2, 3, PAL.stone2);
  p.hline(8, 2, 3, PAL.stone2);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Telescope on a tripod, 16x20. */
export function paintTelescope(): HTMLCanvasElement {
  const p = new Painter(16, 20);
  p.rect(7, 10, 2, 10, PAL.wood2);
  p.rect(3, 18, 3, 2, PAL.wood2);
  p.rect(10, 18, 3, 2, PAL.wood2);
  for (let i = 0; i < 9; i++) p.rect(3 + i, 11 - i, 3, 3, i > 6 ? '#b59a4a' : PAL.stone2);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Post box, 10x16. */
export function paintPostbox(): HTMLCanvasElement {
  const p = new Painter(10, 16);
  p.rect(2, 2, 6, 12, '#a03a3a');
  p.rect(1, 1, 8, 2, '#7a2a2a');
  p.rect(3, 5, 4, 1, PAL.ink);
  p.rect(3, 14, 4, 2, PAL.stone2);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Desk with papers, 20x12. */
export function paintDesk(): HTMLCanvasElement {
  const p = new Painter(20, 12);
  p.rect(1, 3, 18, 4, PAL.wood);
  p.rect(1, 6, 18, 1, PAL.wood2);
  p.rect(2, 7, 2, 5, PAL.wood2);
  p.rect(16, 7, 2, 5, PAL.wood2);
  p.rect(3, 1, 6, 3, PAL.plaster);
  p.rect(11, 1, 5, 3, PAL.plaster2);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Market stall table, 20x12. */
export function paintStall(): HTMLCanvasElement {
  const p = new Painter(20, 12);
  p.rect(1, 4, 18, 3, PAL.wood3);
  p.rect(2, 7, 2, 5, PAL.wood2);
  p.rect(16, 7, 2, 5, PAL.wood2);
  p.rect(3, 1, 4, 3, '#c96a6a');
  p.rect(8, 1, 4, 3, '#d9b34a');
  p.rect(13, 1, 4, 3, PAL.leaf3);
  outline(p, PAL.outline);
  return p.canvas;
}
