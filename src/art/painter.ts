/** Tiny pixel painter over an offscreen canvas. Every coordinate is a texel. */
export class Painter {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  constructor(readonly w: number, readonly h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }
  px(x: number, y: number, c: string): void {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, 1, 1);
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(x, y, w, h);
  }
  hline(x: number, y: number, w: number, c: string): void { this.rect(x, y, w, 1, c); }
  vline(x: number, y: number, h: number, c: string): void { this.rect(x, y, 1, h, c); }
  /** Outlined box: fill plus one-texel border. */
  box(x: number, y: number, w: number, h: number, fill: string, edge: string): void {
    this.rect(x, y, w, h, edge);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
  }
  /** Scatter single texels of `c` inside a rect, seeded so it is stable. */
  noise(x: number, y: number, w: number, h: number, c: string, density: number, seed: number): void {
    const r = mulberry(seed);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (r() < density) this.px(x + i, y + j, c);
  }
  /** Filled disc. */
  disc(cx: number, cy: number, r: number, c: string): void {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) this.px(cx + x, cy + y, c);
  }
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Darken or lighten a hex colour by a factor around 1. */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * k));
  const b = Math.min(255, Math.round((n & 255) * k));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Draw a one-texel outline around every opaque region. */
export function outline(p: Painter, colour: string): void {
  const img = p.ctx.getImageData(0, 0, p.w, p.h);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && d[(y * p.w + x) * 4 + 3]! > 0;
  const add: [number, number][] = [];
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
    if (solid(x, y)) continue;
    if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) add.push([x, y]);
  }
  for (const [x, y] of add) p.px(x, y, colour);
}
