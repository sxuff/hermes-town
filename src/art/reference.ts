import type { BuildingKind } from './buildings';

export const REFERENCE_ATLASES = {
  buildings: new URL('../assets/buildings.png', import.meta.url).href,
  vegetation: new URL('../assets/vegetation.png', import.meta.url).href,
  props: new URL('../assets/props.png', import.meta.url).href,
  furniture: new URL('../assets/furniture.png', import.meta.url).href,
  equipment: new URL('../assets/equipment.png', import.meta.url).href,
};

type Rect = readonly [number, number, number, number];
const BUILDINGS: Partial<Record<BuildingKind, Rect>> = {
  library: [0, 0, 444, 480], hall: [444, 0, 443, 480],
  workshop: [887, 0, 444, 478], post: [1331, 0, 443, 480],
  observatory: [0, 481, 444, 406], tavern: [444, 481, 443, 406],
  forge: [887, 548, 444, 339], house: [1331, 481, 443, 406],
};

/** Import the authored chroma-key sheets once; render at two texels per world pixel. */
export class ReferenceArt {
  private sheets = new Map<string, HTMLCanvasElement>();
  constructor(images: Record<keyof typeof REFERENCE_ATLASES, HTMLImageElement>) {
    for (const [key, image] of Object.entries(images)) {
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = pixels.data;
      const w = canvas.width, h = canvas.height;
      // Magenta is reserved for transparency in these source sheets. A pixel
      // that is partly magenta is an anti-aliased edge: estimate how much of
      // it is key, remove that share (despill), and keep the rest.
      const keyness = new Float32Array(w * h);
      for (let i = 0, k = 0; i < d.length; i += 4, k++) {
        const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
        // distance from pure magenta, 0 = key, 1 = clearly not key
        const dist = Math.max(255 - r, g, 255 - b) / 255;
        const kn = Math.max(0, 1 - dist / 0.55);
        keyness[k] = kn;
      }
      for (let i = 0, k = 0; i < d.length; i += 4, k++) {
        const kn = keyness[k]!;
        if (kn >= 0.999) { d[i + 3] = 0; continue; }
        if (kn <= 0) continue;
        const a = 1 - kn;
        // unmix: p = a * fg + (1 - a) * magenta
        d[i] = Math.max(0, Math.min(255, Math.round((d[i]! - (1 - a) * 255) / a)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(d[i + 1]! / a)));
        d[i + 2] = Math.max(0, Math.min(255, Math.round((d[i + 2]! - (1 - a) * 255) / a)));
        d[i + 3] = Math.round(255 * a);
      }
      // Pixel art wants a hard edge: thin, mostly-key edge pixels go, and the
      // dark halo the generator painted around every object goes with them.
      const alphaAt = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[(y * w + x) * 4 + 3]!;
      const cut: number[] = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = d[i + 3]!;
        if (a === 0) continue;
        const border = alphaAt(x - 1, y) < 40 || alphaAt(x + 1, y) < 40 || alphaAt(x, y - 1) < 40 || alphaAt(x, y + 1) < 40;
        if (!border) continue;
        const lum = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
        const purplish = d[i]! > d[i + 1]! + 25 && d[i + 2]! > d[i + 1]! + 25;
        if (a < 160 || (lum < 70 && purplish)) cut.push(i);
      }
      for (const i of cut) d[i + 3] = 0;
      ctx.putImageData(pixels, 0, 0);
      this.sheets.set(key, canvas);
    }
  }

  private frame(sheet: string, rect: Rect, width: number, height?: number): HTMLCanvasElement {
    const source = this.sheets.get(sheet)!;
    const [x, y, w, h] = rect;
    const ctx = source.getContext('2d')!;
    const d = ctx.getImageData(x, y, w, h).data;
    let left = w, top = h, right = 0, bottom = 0;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      if (d[(yy * w + xx) * 4 + 3]! < 128) continue;
      left = Math.min(left, xx); right = Math.max(right, xx);
      top = Math.min(top, yy); bottom = Math.max(bottom, yy);
    }
    const sw = right - left + 1, sh = bottom - top + 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * 2);
    canvas.height = Math.round((height ?? width * sh / sw) * 2);
    const target = canvas.getContext('2d', { willReadFrequently: true })!;
    target.imageSmoothingEnabled = true;
    target.imageSmoothingQuality = 'high';
    target.drawImage(source, x + left, y + top, sw, sh, 0, 0, canvas.width, canvas.height);
    // Downsampling blurs the silhouette into a soft grey rim. Snap alpha back
    // to a hard edge so the sprite sits on the ground like everything else.
    const out = target.getImageData(0, 0, canvas.width, canvas.height);
    const od = out.data;
    for (let i = 3; i < od.length; i += 4) od[i] = od[i]! < 120 ? 0 : 255;
    target.putImageData(out, 0, 0);
    return canvas;
  }

  building(kind: BuildingKind, width: number, lit: boolean): HTMLCanvasElement {
    const canvas = this.frame('buildings', BUILDINGS[kind] ?? BUILDINGS.house!, width);
    if (!lit) {
      // Window occupancy remains meaningful: unoccupied windows lose their
      // bright yellow cores, while masonry and roof colours remain unchanged.
      const ctx = canvas.getContext('2d')!;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i]! > 205 && d[i + 1]! > 120 && d[i + 1]! < d[i]! * 0.94 && d[i + 2]! < d[i + 1]! * 0.78) {
          d[i] = Math.round(d[i]! * 0.5); d[i + 1] = Math.round(d[i + 1]! * 0.53); d[i + 2] = Math.min(95, d[i + 2]! + 15);
        }
      }
      ctx.putImageData(pixels, 0, 0);
    }
    return canvas;
  }

  tree(variant: number): HTMLCanvasElement {
    const frames: [Rect, number, number][] = [
      [[0, 0, 525, 518], 56, 62], [[540, 0, 490, 518], 48, 55],
      [[0, 0, 525, 518], 70, 73], [[1100, 0, 436, 518], 30, 61],
      [[0, 530, 490, 494], 30, 37], [[490, 530, 555, 494], 61, 62],
    ];
    const [rect, w, h] = frames[variant % frames.length]!;
    return this.frame('vegetation', rect, w, h);
  }

  bush(): HTMLCanvasElement { return this.frame('vegetation', [1050, 600, 486, 424], 24, 16); }

  furniture(index: number, width: number, height?: number): HTMLCanvasElement {
    return this.cell('furniture', index, 4, 4, width, height);
  }

  equipment(index: number, width: number, height?: number): HTMLCanvasElement {
    return this.cell('equipment', index, 4, 2, width, height);
  }

  private cell(sheet: string, index: number, columns: number, rows: number, width: number, height?: number): HTMLCanvasElement {
    const source = this.sheets.get(sheet)!;
    const col = index % columns, row = Math.floor(index / columns);
    const x = Math.round(col * source.width / columns), y = Math.round(row * source.height / rows);
    return this.frame(sheet, [x, y, Math.round((col + 1) * source.width / columns) - x, Math.round((row + 1) * source.height / rows) - y], width, height);
  }

  prop(index: number, width: number, height?: number): HTMLCanvasElement {
    const col = index % 4, row = Math.floor(index / 4);
    return this.frame('props', [Math.round(col * 443.5), row * 444, col % 2 ? 443 : 444, row ? 443 : 444], width, height);
  }
}
