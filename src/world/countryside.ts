import { T } from '../art/tiles';
import { hasWorldSprite } from './dressing';
import { TILE } from '../art/tiles';
import { mulberry } from '../art/painter';
import type { Point } from './pathfind';
import { LOCAL_H, LOCAL_W, MAP_H, MAP_W, TOWN_OX, TOWN_OY, type Prop, type PropKind, type TownMap } from './map';

/**
 * The countryside pass. Takes the authored town exactly as built and embeds it
 * in a much larger landscape: a height field gives the grass its tone (golden
 * on exposed rises, dark and wet in hollows), vegetation comes in clusters,
 * ledges follow one contour, old trails wander out to a few places worth
 * finding, and the settlement gets the small things a lived-in place has.
 * Nothing inside the town's footprint is moved.
 */

// ------------------------------------------------------------------ noise

function valueNoise(seed: number): (x: number, y: number) => number {
  const perm = new Uint8Array(512);
  const r = mulberry(seed);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j]!, base[i]!]; }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;
  const lattice = (ix: number, iy: number) => perm[(perm[ix & 255]! + iy) & 255]! / 255;
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = fade(x - ix), fy = fade(y - iy);
    const a = lattice(ix, iy), b = lattice(ix + 1, iy), c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

function fbm(n: (x: number, y: number) => number, x: number, y: number, octaves: number, scale: number): number {
  let v = 0, amp = 0.5, f = 1 / scale, norm = 0;
  for (let i = 0; i < octaves; i++) { v += n(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2.1; }
  return v / norm;
}

/** Rasterize a polyline in tile space. */
function stroke(points: Point[], width: number, put: (x: number, y: number) => void): void {
  const half = Math.floor(width / 2);
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const steps = Math.max(1, Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a.x + ((b.x - a.x) * s) / steps), y = Math.round(a.y + ((b.y - a.y) * s) / steps);
      for (let dy = -half; dy < width - half; dy++) for (let dx = -half; dx < width - half; dx++) put(x + dx, y + dy);
    }
  }
}

/** Add a little sideways wobble to a polyline so nothing reads as ruled. */
function wobble(points: Point[], r: () => number, amount = 1.5): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    out.push(a);
    const n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 5));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: Math.round(a.x + (b.x - a.x) * t + (r() - 0.5) * 2 * amount), y: Math.round(a.y + (b.y - a.y) * t + (r() - 0.5) * 2 * amount) });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

const GRASS_FAMILY = new Set<number>([T.grass, T.grass2, T.grass3, T.grassTall, T.flowers, T.rocks]);

// ------------------------------------------------------------ the pass

export function buildCountryside(local: TownMap): TownMap {
  const r = mulberry(99);
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const key = (x: number, y: number) => y * MAP_W + x;
  const inTown = (x: number, y: number) => x >= TOWN_OX && y >= TOWN_OY && x < TOWN_OX + LOCAL_W && y < TOWN_OY + LOCAL_H;
  const inTownCore = (x: number, y: number) => x >= TOWN_OX + 1 && y >= TOWN_OY + 1 && x < TOWN_OX + LOCAL_W - 1 && y < TOWN_OY + LOCAL_H - 1;

  // ---- embed the town
  const ground: number[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    ground.push([]);
    for (let x = 0; x < MAP_W; x++) {
      const v = r();
      ground[y]!.push(v < 0.7 ? T.grass : v < 0.9 ? T.grass2 : T.grass3);
    }
  }
  for (let y = 0; y < LOCAL_H; y++) for (let x = 0; x < LOCAL_W; x++) ground[y + TOWN_OY]![x + TOWN_OX] = local.ground[y]![x]!;
  const shift = (p: Point): Point => ({ x: p.x + TOWN_OX, y: p.y + TOWN_OY });
  const shiftPx = (x: number, y: number) => ({ x: x + TOWN_OX * TILE, y: y + TOWN_OY * TILE });
  const buildings = local.buildings.map((b) => ({ ...b, x: b.x + TOWN_OX, y: b.y + TOWN_OY, door: shift(b.door), porch: b.porch.map(shift) }));
  const homes = local.homes.map((b) => ({ ...b, x: b.x + TOWN_OX, y: b.y + TOWN_OY, door: shift(b.door), porch: b.porch.map(shift) }));
  const stations = local.stations.map((s) => ({ ...s, tile: shift(s.tile), prop: { ...s.prop, ...shiftPx(s.prop.x, s.prop.y) } }));
  const props: Prop[] = local.props.map((p) => ({ ...p, ...shiftPx(p.x, p.y), blocks: p.blocks?.map(shift) }));
  const lamps = local.lamps.map(shift);

  // the town's own walkability, carried over verbatim
  const cost = new Uint8Array(MAP_W * MAP_H);
  const townCost = new Map<number, number>();
  for (let y = 0; y < LOCAL_H; y++) for (let x = 0; x < LOCAL_W; x++) townCost.set(key(x + TOWN_OX, y + TOWN_OY), local.grid.cost[y * LOCAL_W + x]!);
  // the town's border ring was a hedge; open it where roads leave
  const road = new Set<number>();
  const water = new Set<number>();
  const trail = new Set<number>();

  // ---- height field: gentle rise to the north, rolling elsewhere
  const hn = valueNoise(7);
  const cn = valueNoise(11);
  const fn = valueNoise(13);
  const height = new Float32Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const h = fbm(hn, x, y, 3, 22) * 0.78 + (1 - y / MAP_H) * 0.22;
    height[key(x, y)] = Math.max(0, Math.min(1, h));
  }
  const H = (x: number, y: number) => height[key(Math.max(0, Math.min(MAP_W - 1, x)), Math.max(0, Math.min(MAP_H - 1, y)))]!;

  // ---- old roads continue out of the town to the edges of the world
  const putRoad = (x: number, y: number) => { if (inb(x, y) && !inTownCore(x, y)) road.add(key(x, y)); };
  const T0 = (x: number, y: number): Point => ({ x: x + TOWN_OX, y: y + TOWN_OY });
  stroke(wobble([T0(1, 22), { x: 18, y: 40 }, { x: 9, y: 36 }, { x: 0, y: 39 }], r, 1), 2, putRoad);
  stroke(wobble([T0(62, 22), { x: 98, y: 41 }, { x: 108, y: 37 }, { x: MAP_W - 1, y: 39 }], r, 1), 2, putRoad);
  stroke(wobble([T0(31, 40), { x: 55, y: 64 }, { x: 59, y: 70 }, { x: 57, y: MAP_H - 1 }], r, 1), 2, putRoad);
  stroke(wobble([T0(31, 1), { x: 55, y: 10 }, { x: 58, y: 4 }, { x: 56, y: 0 }], r, 1), 2, putRoad);

  // ---- the stream continues north and south of the town
  const putWater = (x: number, y: number) => { if (inb(x, y) && !inTownCore(x, y)) water.add(key(x, y)); };
  stroke(wobble([T0(60, 0), { x: 84, y: 9 }, { x: 86, y: 0 }], r, 0.8), 4, putWater);
  stroke(wobble([T0(61, 41), { x: 89, y: 64 }, { x: 86, y: 70 }, { x: 90, y: MAP_H - 1 }], r, 0.8), 4, putWater);
  // a wet hollow in the low ground to the south-west
  const pn = valueNoise(21);
  for (let y = 55; y <= 65; y++) for (let x = 17; x <= 33; x++) if (Math.hypot((x - 25) / 1.5, (y - 60) * 1.05) < 4.1 + (pn(x * 0.5, y * 0.5) - 0.5) * 1.7) putWater(x, y);

  // ---- trails: single-width, worn, leading to the places worth finding
  const putTrail = (x: number, y: number) => { if (inb(x, y) && !inTownCore(x, y) && !road.has(key(x, y))) trail.add(key(x, y)); };
  const cemetery = { x: 9, y: 27, w: 11, h: 11 };
  const meadow = { x: 92, y: 58, w: 13, h: 10 };
  const cartSpot = { x: 14, y: 58 };
  stroke(wobble([{ x: 19, y: 38 }, { x: cemetery.x + 5, y: cemetery.y + cemetery.h }], r, 0.6), 1, putTrail);
  stroke(wobble([{ x: 12, y: 37 }, { x: 8, y: 26 }, { x: 10, y: 14 }, { x: 16, y: 6 }], r, 1.2), 1, putTrail);
  // The meadow trail crosses the stream on one straight row, so its bridge is a
  // single span rather than two staggered pieces on a diagonal.
  stroke(wobble([{ x: 57, y: 63 }, { x: 70, y: 66 }, { x: 82, y: 62 }], r, 1.2), 1, putTrail);
  stroke([{ x: 82, y: 62 }, { x: 93, y: 62 }], 1, putTrail);
  stroke(wobble([{ x: 93, y: 62 }, { x: meadow.x, y: meadow.y + 5 }], r, 1.2), 1, putTrail);
  stroke(wobble([{ x: 57, y: 9 }, { x: 70, y: 11 }, { x: 84, y: 10 }, { x: 96, y: 8 }, { x: 110, y: 13 }], r, 1.2), 1, putTrail);
  stroke(wobble([{ x: 10, y: 37 }, { x: 8, y: 48 }, { x: cartSpot.x, y: cartSpot.y - 1 }], r, 1.2), 1, putTrail);
  stroke(wobble([{ x: 100, y: 40 }, { x: 104, y: 30 }, { x: 98, y: 20 }], r, 1.2), 1, putTrail);

  // ---- write the outer ground
  let n = 0;
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (inTownCore(x, y)) continue;
    const k = key(x, y);
    if (water.has(k) && (road.has(k) || trail.has(k))) ground[y]![x] = T.bridge;
    else if (water.has(k)) ground[y]![x] = (x + y) % 3 ? T.water : T.water2;
    else if (road.has(k)) ground[y]![x] = (n++ % 7 === 3) ? T.path2 : T.path;
    else if (trail.has(k)) ground[y]![x] = (n++ % 2) ? T.trail : T.trail2;
  }
  // the town hedge ring opens where a road or the stream meets it
  for (let y = 0; y < LOCAL_H; y++) for (let x = 0; x < LOCAL_W; x++) {
    const wx = x + TOWN_OX, wy = y + TOWN_OY;
    if (x !== 0 && y !== 0 && x !== LOCAL_W - 1 && y !== LOCAL_H - 1) continue;
    const g = local.ground[y]![x]!;
    const isRoad = g === T.path || g === T.path2 || g === T.stairs;
    const isWater = g === T.water || g === T.water2;
    if (isRoad) { road.add(key(wx, wy)); townCost.set(key(wx, wy), 1); }
    if (isWater) water.add(key(wx, wy));
  }
  // shore around all water
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (inTownCore(x, y)) continue;
    const k = key(x, y);
    if (water.has(k) || road.has(k) || trail.has(k)) continue;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inb(x + dx!, y + dy!) && water.has(key(x + dx!, y + dy!)));
    if (near) { const v = (x * 7 + y * 3) % 7; ground[y]![x] = v === 0 || v === 3 ? T.reeds0 : v === 4 ? T.shoreGrass : v === 6 && H(x, y) < 0.4 ? T.mudWet : T.shore; }
  }
  // still water gets lily pads, the stream gets the odd stone
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    const g = ground[y]![x]!;
    if (g !== T.water && g !== T.water2) continue;
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => water.has(key(x + dx!, y + dy!))).length;
    const v = r();
    if (neighbours === 4 && v < 0.14) ground[y]![x] = T.waterLily0;
    else if (neighbours < 4 && v < 0.05) ground[y]![x] = T.waterStone;
  }

  // ---- terrain tone and vegetation clusters, everywhere the ground is plain grass
  const grad = (x: number, y: number) => Math.hypot(H(x + 1, y) - H(x - 1, y), H(x, y + 1) - H(x, y - 1));
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    const g = ground[y]![x]!;
    if (!GRASS_FAMILY.has(g)) continue;
    const h = H(x, y);
    const c = fbm(cn, x, y, 2, 7);
    const d = fbm(fn, x, y, 2, 4);
    const roll = r();
    // soft thresholds: the chance of a wet or dry tile rises across a band,
    // so the transitions dither instead of stepping
    const smooth = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
    const wet = smooth((0.38 - h) / 0.14);
    const dry = smooth((h - 0.6) / 0.14);
    const r2 = r();
    let out = g === T.grassTall || g === T.flowers || g === T.rocks ? T.grass : g;
    if (r2 < dry) out = roll < 0.55 ? T.grassDry : T.grassDry2;
    else if (r2 < dry + wet) out = roll < 0.55 ? T.grassWet : T.grassWet2;
    const roll2 = r();
    if (h < 0.24 && c > 0.6 && roll2 < 0.7) out = T.mudWet;
    else if (dry > 0.5 && c > 0.5 && roll2 < 0.75) out = T.seed0;
    else if (c > 0.63 && h > 0.3 && h < 0.72 && roll2 < 0.75) out = T.tall0;
    else if (c < 0.26 && roll2 < 0.45) out = h < 0.42 ? T.flwWhite0 : h < 0.6 ? T.flwBlue0 : T.flwYellow0;
    else if (grad(x, y) > 0.06 && d > 0.6 && roll2 < 0.45) out = roll < 0.4 ? T.earth : roll < 0.7 ? T.earth2 : T.rocks;
    else if (roll2 < 0.01) out = T.mossStone;
    else if (roll2 < 0.025 && h > 0.45) out = T.gravel2;
    ground[y]![x] = out;
  }

  // ---- points of interest
  const extra: Prop[] = [];
  const at = (x: number, y: number, kind: PropKind, dx = 0, dy = 0, blocks = true): void => {
    extra.push({ kind, x: x * TILE + dx, y: y * TILE + dy, blocks: blocks ? [{ x, y }] : [] });
  };
  // Cemetery: iron enclosure, chapel and grave markers beside a clear approach.
  for (let x = cemetery.x; x < cemetery.x + cemetery.w; x++) { ground[cemetery.y]![x] = T.fence; ground[cemetery.y + cemetery.h - 1]![x] = x === cemetery.x + 5 ? T.trail : T.fence; }
  for (let y = cemetery.y + 1; y < cemetery.y + cemetery.h - 1; y++) { ground[y]![cemetery.x] = T.fenceV; ground[y]![cemetery.x + cemetery.w - 1] = T.fenceV; }
  for (let y = cemetery.y + 1; y < cemetery.y + cemetery.h - 1; y++) for (let x = cemetery.x + 1; x < cemetery.x + cemetery.w - 1; x++) ground[y]![x] = r() < 0.2 ? T.weeds : r() < 0.5 ? T.grassWet : T.grass2;
  const graves: [number, number, number][] = [[1, 4, 0], [8, 4, 2], [2, 6, 1], [4, 7, 0], [7, 7, 1], [9, 7, 0]];
  for (const [gx, gy, v] of graves) at(cemetery.x + gx, cemetery.y + gy, `grave${v}` as PropKind, 2, 1);
  // Chapel at the top of the plot and a lamp beside the open gate.
  extra.push({ kind: 'chapel', x: (cemetery.x + 4) * TILE - 4, y: (cemetery.y + 5) * TILE - 46, blocks: [0, 1, 2].flatMap((dx) => [{ x: cemetery.x + 4 + dx, y: cemetery.y + 3 }, { x: cemetery.x + 4 + dx, y: cemetery.y + 4 }]) });
  extra.push({ kind: 'lamp', x: (cemetery.x + 4) * TILE + 3, y: (cemetery.y + cemetery.h) * TILE - 14, blocks: [{ x: cemetery.x + 4, y: cemetery.y + cemetery.h }] });
  ground[cemetery.y + 6]![cemetery.x + 6] = T.flwWhite0; ground[cemetery.y + 3]![cemetery.x + 8] = T.flwWhite0; ground[cemetery.y + 5]![cemetery.x + 1] = T.flwBlue0;
  for (let y = cemetery.y + 5; y < cemetery.y + cemetery.h; y++) ground[y]![cemetery.x + 5] = T.trail;
  for (const [dx, dy] of [[2, 2], [8, 2], [2, 8], [7, 9]]) {
    extra.push({ kind: 'bush', x: (cemetery.x + dx!) * TILE, y: (cemetery.y + dy!) * TILE, blocks: [] });
  }
  // Rails and end posts are part of each complete bridge sprite.
  ground[cemetery.y + 3]![cemetery.x + 4] = T.mossStone;
  // A handcart at the end of the west trail.
  at(cartSpot.x, cartSpot.y, 'cart', -6, -4);
  // a run of dry-stone wall beside the east road
  // a lone signpost at the north-east fork
  at(96, 9, 'signpost', 1, -6);

  // ---- settlement: the small things a lived-in place has
  at(48, 49, 'cart', -4, -4);
  // crop patch inside the east yard
  for (let y = 49; y <= 50; y++) for (let x = 70; x <= 73; x++) ground[y]![x] = (x + y) % 2 ? T.crop : T.crop2;
  // weeds and nettles around foundations
  for (const b of [...buildings, ...homes]) {
    for (let y = b.y + b.h - 1; y <= b.y + b.h; y++) for (const x of [b.x - 1, b.x + b.w]) {
      if (!inb(x, y)) continue;
      const g = ground[y]![x]!;
      if (GRASS_FAMILY.has(g) || g === T.grassWet || g === T.grassDry) if (r() < 0.5) ground[y]![x] = T.weeds;
    }
  }
  // worn grass in front of every door
  for (const b of homes) { const { x, y } = b.door; if (inb(x, y + 1) && GRASS_FAMILY.has(ground[y + 1]![x]!)) ground[y + 1]![x] = T.trail; }

  for (let i = extra.length - 1; i >= 0; i--) if (!hasWorldSprite(extra[i]!.kind)) extra.splice(i, 1);

  // ---- walkability for the whole world
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const k = key(x, y);
    const carried = townCost.get(k);
    if (carried !== undefined && inTownCore(x, y)) { cost[k] = carried; continue; }
    const g = ground[y]![x]!;
    const isRoad = g === T.path || g === T.path2 || g === T.bridge || g === T.stairs;
    const isTrail = g === T.trail || g === T.trail2;
    const blocked = g === T.water || g === T.water2 || g === T.water3 || g === T.waterLily0 || g === T.waterStone || g === T.cliff || g === T.fence || g === T.fenceV || g === T.fenceEnd
      || g === T.crop || g === T.crop2 || g === T.stoneWall || g === T.stoneWallV || g === T.ledge || g === T.mudWet;
    cost[k] = blocked ? 0 : isRoad ? 1 : isTrail ? 2 : g === T.shore || g === T.reeds0 || g === T.shoreGrass ? 5 : 3;
    if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) cost[k] = 0;
  }
  // the town hedge ring: open where roads cross it, otherwise keep it closed
  for (let y = 0; y < LOCAL_H; y++) for (let x = 0; x < LOCAL_W; x++) {
    if (x !== 0 && y !== 0 && x !== LOCAL_W - 1 && y !== LOCAL_H - 1) continue;
    const k = key(x + TOWN_OX, y + TOWN_OY);
    cost[k] = road.has(k) ? 1 : 0;
  }
  const block = (x: number, y: number) => { if (inb(x, y)) cost[key(x, y)] = 0; };
  for (const p of extra) for (const b of p.blocks ?? []) block(b.x, b.y);
  for (const p of props) for (const b of p.blocks ?? []) block(b.x, b.y);

  // ---- trees: woods where the forest field is high, thinning to open grass
  let placed = 0, tries = 0;
  const treeCells = new Set<number>();
  while (placed < 560 && tries++ < 90000) {
    const x = 1 + Math.floor(r() * (MAP_W - 2)), y = 2 + Math.floor(r() * (MAP_H - 3));
    if (inTown(x, y)) continue;
    const f = fbm(fn, x + 300, y + 300, 3, 16);
    const edge = x < 6 || x > MAP_W - 7 || y < 6 || y > MAP_H - 7;
    // the woods press right up to the town's hedge
    const nearTown = x >= TOWN_OX - 4 && x < TOWN_OX + LOCAL_W + 4 && y >= TOWN_OY - 4 && y < TOWN_OY + LOCAL_H + 4;
    const want = edge ? 0.85 : nearTown ? 0.6 : f > 0.58 ? 0.75 : f > 0.48 ? 0.3 : 0.03;
    if (r() > want) continue;
    const g = ground[y]![x]!;
    if (cost[key(x, y)] === 0) continue;
    if (g === T.trail || g === T.trail2 || g === T.shore || g === T.reeds0 || g === T.earth || g === T.earth2) continue;
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) {
      const kk = key(x + dx, y + dy);
      if (road.has(kk) || trail.has(kk) || water.has(kk) || treeCells.has(kk)) ok = false;
      const gg = ground[y + dy]?.[x + dx];
      if (gg === T.ledge || gg === T.fence || gg === T.fenceV || gg === T.stoneWall || gg === T.stoneWallV || gg === T.crop || gg === T.crop2) ok = false;
    }
    if (x >= cemetery.x - 1 && x < cemetery.x + cemetery.w + 1 && y >= cemetery.y - 3 && y < cemetery.y + cemetery.h + 1) ok = false;
    if (x >= meadow.x - 1 && x < meadow.x + meadow.w + 1 && y >= meadow.y - 3 && y < meadow.y + meadow.h + 1) ok = false;
    for (const p of extra) for (const b of p.blocks ?? []) if (Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 2) ok = false;
    if (!ok) continue;
    const tv = r();
    const variant = tv < 0.08 ? 2 : tv < 0.2 ? 3 : tv < 0.3 ? 4 : tv < 0.36 ? 5 : Math.floor(r() * 2);
    extra.push({ kind: 'tree', x: x * TILE - 8, y: y * TILE - 24, variant });
    treeCells.add(key(x, y));
    block(x, y);
    placed++;
    const below = ground[y + 1]?.[x];
    if (below !== undefined && (GRASS_FAMILY.has(below) || below === T.grassWet || below === T.grassDry) && r() < 0.45) ground[y + 1]![x] = r() < 0.7 ? T.leaves : T.clover;
  }
  // bushes in loose clusters at wood edges
  for (let i = 0; i < 650; i++) {
    const x = 1 + Math.floor(r() * (MAP_W - 2)), y = 2 + Math.floor(r() * (MAP_H - 3));
    if (inTown(x, y) || cost[key(x, y)] !== 3) continue;
    const f = fbm(fn, x + 300, y + 300, 3, 16);
    if (f < 0.45 || f > 0.62) continue;
    const g = ground[y]![x]!;
    if (!(GRASS_FAMILY.has(g) || g === T.grassWet || g === T.grassWet2 || g === T.grassDry || g === T.tall0)) continue;
    extra.push({ kind: 'bush', x: x * TILE - 1, y: y * TILE + 2, blocks: [{ x, y }] });
    block(x, y);
  }

  // Riverbank vignettes sit outside the walkable channel and bridge approaches.
  const wet = new Set<number>([T.water, T.water2, T.water3, T.waterLily0, T.waterLily1, T.waterStone]);
  for (let y = 2; y < MAP_H - 2; y++) for (let x = 2; x < MAP_W - 2; x++) {
    if (wet.has(ground[y]![x]!) || ground[y]![x] === T.bridge || r() > 0.33) continue;
    if (![[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => wet.has(ground[y + dy!]![x + dx!]!))) continue;
    if ([...buildings, ...homes].some(b => x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h + 1)) continue;
    let bridgeNearby = false;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (ground[y + dy]?.[x + dx] === T.bridge) bridgeNearby = true;
    if (bridgeNearby) continue;
    extra.push({ kind: r() < 0.8 ? 'rock' : 'bush', x: x * TILE - 4, y: y * TILE - 5, blocks: [] });
  }

  return {
    ground,
    height,
    grid: { w: MAP_W, h: MAP_H, cost },
    buildings,
    stations,
    props: [...props, ...extra],
    homes,
    lamps,
    entrance: { x: 1, y: 39 },
    idleSmoke: [{ x: (homes[1]!.x + homes[1]!.w) * TILE - 11, y: homes[1]!.y * TILE - 6 }],
  };
}
