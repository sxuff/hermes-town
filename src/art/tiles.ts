import { PAL } from './palette';
import { Painter, mulberry, outline } from './painter';

export const TILE = 16;

/** Tile ids: index into the generated tileset, left to right. */
export const T = {
  grass: 0, grass2: 1, grass3: 2, path: 3, path2: 4, cobble: 5, cobble2: 6,
  water: 7, water2: 8, fence: 9, fenceEnd: 10, flowers: 11, stump: 12,
  gravel: 13, mud: 14, plank: 15, shore: 16, cliff: 17, cliffTop: 18, stairs: 19,
  crop: 20, crop2: 21, fenceV: 22, bridge: 23, rocks: 24, grassTall: 25,
  // countryside pass
  grassDry: 26, grassDry2: 27, grassWet: 28, grassWet2: 29, earth: 30, earth2: 31,
  tall0: 32, tall1: 33, tall2: 34,
  seed0: 35, seed1: 36, seed2: 37,
  flwWhite0: 38, flwWhite1: 39, flwBlue0: 40, flwBlue1: 41, flwYellow0: 42, flwYellow1: 43,
  mossStone: 44, weeds: 45, reeds0: 46, reeds1: 47, trail: 48, trail2: 49,
  stoneWall: 50, stoneWallV: 51, ledge: 52, water3: 53, mudWet: 54, gravel2: 55,
  // polish pass
  cobbleCracked: 56, cobbleMoss: 57, cobbleWorn: 58, cobbleLeaves: 59,
  pathEdge: 60, pathStones: 61, pathMud: 62, pathGrassy: 63,
  clover: 64, leaves: 65, soot: 66, waterLily0: 67, waterLily1: 68, waterStone: 69, shoreGrass: 70, trampled: 71,
} as const;

export const TILESET_COLUMNS = 72;

/** Tiles that sway: frame lists, in wind order (still, leaning, leaning more). */
export const WIND_GROUPS: { frames: number[]; strength: number }[] = [
  { frames: [T.tall0, T.tall1, T.tall2], strength: 1 },
  { frames: [T.seed0, T.seed1, T.seed2], strength: 1 },
  { frames: [T.flwWhite0, T.flwWhite1], strength: 0.5 },
  { frames: [T.flwBlue0, T.flwBlue1], strength: 0.5 },
  { frames: [T.flwYellow0, T.flwYellow1], strength: 0.5 },
  { frames: [T.reeds0, T.reeds1], strength: 0.8 },
  { frames: [T.water, T.water2, T.water3], strength: 0.3 },
  { frames: [T.waterLily0, T.waterLily1], strength: 0.3 },
];

export function paintTileset(): HTMLCanvasElement {
  const p = new Painter(TILE * TILESET_COLUMNS, TILE);
  const at = (id: number) => id * TILE;

  const grassSet: [number, string, string][] = [
    [T.grass, PAL.grass, PAL.grass3],
    [T.grass2, PAL.grass2, PAL.grass],
    [T.grass3, PAL.grass, PAL.grass2],
  ];
  for (const [id, base, fleck] of grassSet) {
    p.rect(at(id), 0, TILE, TILE, base);
    p.noise(at(id), 0, TILE, TILE, fleck, 0.12, 11 + id);
    p.noise(at(id), 0, TILE, TILE, PAL.leaf2, 0.03, 31 + id);
  }
  p.rect(at(T.path), 0, TILE, TILE, PAL.dirt);
  p.noise(at(T.path), 0, TILE, TILE, PAL.dirt2, 0.2, 5);
  p.noise(at(T.path), 0, TILE, TILE, PAL.wood3, 0.05, 6);
  p.rect(at(T.path2), 0, TILE, TILE, PAL.dirt2);
  p.noise(at(T.path2), 0, TILE, TILE, PAL.dirt, 0.25, 7);

  for (const id of [T.cobble, T.cobble2]) {
    p.rect(at(id), 0, TILE, TILE, PAL.cobble3);
    const r = id === T.cobble ? 0 : 3;
    for (let y = 0; y < TILE; y += 4) {
      for (let x = ((y / 4) % 2) * 3 - r; x < TILE; x += 6) {
        const sx = Math.max(0, x);
        p.rect(at(id) + sx, y, Math.min(5, TILE - sx), 3, (x + y) % 3 ? PAL.cobble : PAL.cobble2);
      }
    }
  }
  p.rect(at(T.water), 0, TILE, TILE, PAL.water);
  p.hline(at(T.water) + 2, 4, 5, PAL.water2);
  p.hline(at(T.water) + 9, 11, 4, PAL.water2);
  p.rect(at(T.water2), 0, TILE, TILE, PAL.water);
  p.hline(at(T.water2) + 6, 7, 6, PAL.water2);
  p.hline(at(T.water2) + 1, 13, 4, PAL.water2);

  p.rect(at(T.fence), 0, TILE, TILE, PAL.grass);
  p.noise(at(T.fence), 0, TILE, TILE, PAL.grass3, 0.1, 12);
  p.rect(at(T.fence), 6, TILE, 2, PAL.wood2);
  p.rect(at(T.fence), 10, TILE, 2, PAL.wood2);
  p.rect(at(T.fence) + 3, 3, 3, 11, PAL.wood);
  p.rect(at(T.fence) + 3, 3, 3, 1, PAL.wood3);
  p.rect(at(T.fence) + 11, 3, 3, 11, PAL.wood);
  p.rect(at(T.fence) + 11, 3, 3, 1, PAL.wood3);
  p.rect(at(T.fenceEnd), 0, TILE, TILE, PAL.grass);
  p.rect(at(T.fenceEnd) + 6, 2, 4, 12, PAL.wood);
  p.rect(at(T.fenceEnd) + 6, 2, 4, 1, PAL.wood3);

  p.rect(at(T.flowers), 0, TILE, TILE, PAL.grass);
  p.noise(at(T.flowers), 0, TILE, TILE, PAL.grass3, 0.1, 13);
  const flowers: [number, number, string][] = [[3, 4, '#d9b34a'], [10, 3, '#c96a6a'], [6, 11, '#e0d3a0'], [12, 10, '#d9b34a']];
  for (const [x, y, c] of flowers) {
    p.px(at(T.flowers) + x, y, c);
    p.px(at(T.flowers) + x, y + 1, PAL.leaf);
  }
  p.rect(at(T.stump), 0, TILE, TILE, PAL.grass);
  p.rect(at(T.stump) + 4, 6, 8, 7, PAL.wood2);
  p.rect(at(T.stump) + 4, 5, 8, 3, PAL.wood3);
  p.rect(at(T.stump) + 6, 6, 4, 1, PAL.wood);

  p.rect(at(T.gravel), 0, TILE, TILE, PAL.stone2);
  p.noise(at(T.gravel), 0, TILE, TILE, PAL.stone, 0.3, 14);
  p.rect(at(T.mud), 0, TILE, TILE, PAL.wood2);
  p.noise(at(T.mud), 0, TILE, TILE, PAL.dirt2, 0.3, 15);
  p.rect(at(T.plank), 0, TILE, TILE, PAL.wood);
  for (let y = 0; y < TILE; y += 4) p.hline(at(T.plank), y, TILE, PAL.wood2);
  p.noise(at(T.plank), 0, TILE, TILE, PAL.wood3, 0.06, 16);
  // shore: sandy bank
  p.rect(at(T.shore), 0, TILE, TILE, '#a08a5c');
  p.noise(at(T.shore), 0, TILE, TILE, '#b39a68', 0.25, 17);
  p.noise(at(T.shore), 0, TILE, TILE, PAL.grass2, 0.08, 18);
  // cliff face: dark stone with a grassy lip at the top
  p.rect(at(T.cliff), 0, TILE, TILE, '#5a4a3e');
  for (let y = 2; y < TILE; y += 4) { p.hline(at(T.cliff), y, TILE, '#4a3c32'); p.hline(at(T.cliff) + ((y / 4) % 2) * 5, y + 2, 5, '#6a5a4c'); }
  p.rect(at(T.cliff), 0, TILE, 2, PAL.grass2);
  p.noise(at(T.cliff), 2, TILE, 2, PAL.grass, 0.5, 19);
  p.hline(at(T.cliff), TILE - 1, TILE, '#3a2e26');
  // cliff top: grass with the shadowed lip below
  p.rect(at(T.cliffTop), 0, TILE, TILE, PAL.grass);
  p.noise(at(T.cliffTop), 0, TILE, TILE, PAL.grass3, 0.12, 20);
  p.rect(at(T.cliffTop), TILE - 3, TILE, 3, PAL.grass2);
  p.hline(at(T.cliffTop), TILE - 1, TILE, '#3a2e26');
  // stairs cut into the cliff
  p.rect(at(T.stairs), 0, TILE, TILE, '#6a5a4c');
  for (let y = 0; y < TILE; y += 4) { p.hline(at(T.stairs), y, TILE, '#8a7a6a'); p.hline(at(T.stairs), y + 3, TILE, '#4a3c32'); }
  // crops: tilled soil with sprouts
  for (const [id, grown] of [[T.crop, false], [T.crop2, true]] as const) {
    p.rect(at(id), 0, TILE, TILE, PAL.wood2);
    p.noise(at(id), 0, TILE, TILE, PAL.dirt2, 0.3, 21);
    for (let y = 2; y < TILE; y += 5) p.hline(at(id), y, TILE, '#4a3322');
    for (let x = 2; x < TILE; x += 5) for (let y = 2; y < TILE; y += 5) {
      p.px(at(id) + x, y - 1, PAL.leaf3); p.px(at(id) + x, y - 2, grown ? PAL.leaf : PAL.leaf3);
      if (grown) { p.px(at(id) + x - 1, y - 2, PAL.leaf3); p.px(at(id) + x + 1, y - 2, PAL.leaf3); p.px(at(id) + x, y - 3, '#d9b34a'); }
    }
  }
  // vertical fence
  p.rect(at(T.fenceV), 0, TILE, TILE, PAL.grass);
  p.noise(at(T.fenceV), 0, TILE, TILE, PAL.grass3, 0.1, 22);
  p.rect(at(T.fenceV) + 6, 0, 2, TILE, PAL.wood2); p.rect(at(T.fenceV) + 10, 0, 2, TILE, PAL.wood2);
  p.rect(at(T.fenceV) + 5, 3, 8, 3, PAL.wood); p.rect(at(T.fenceV) + 5, 11, 8, 3, PAL.wood);
  p.hline(at(T.fenceV) + 5, 3, 8, PAL.wood3); p.hline(at(T.fenceV) + 5, 11, 8, PAL.wood3);
  // bridge planks over water
  p.rect(at(T.bridge), 0, TILE, TILE, PAL.wood3);
  for (let x = 0; x < TILE; x += 4) p.vline(at(T.bridge) + x, 0, TILE, PAL.wood2);
  p.hline(at(T.bridge), 0, TILE, PAL.wood2); p.hline(at(T.bridge), TILE - 1, TILE, PAL.wood2);
  // rocks on grass
  p.rect(at(T.rocks), 0, TILE, TILE, PAL.grass);
  p.noise(at(T.rocks), 0, TILE, TILE, PAL.grass3, 0.1, 23);
  p.rect(at(T.rocks) + 3, 8, 6, 4, PAL.stone2); p.rect(at(T.rocks) + 4, 7, 4, 1, PAL.stone);
  p.rect(at(T.rocks) + 10, 4, 4, 3, PAL.stone2); p.rect(at(T.rocks) + 11, 3, 2, 1, PAL.stone);
  // tall grass (legacy still frame)
  p.rect(at(T.grassTall), 0, TILE, TILE, PAL.grass);
  for (let x = 1; x < TILE; x += 3) { p.vline(at(T.grassTall) + x, 6 + (x % 2) * 3, 8, PAL.leaf3); p.px(at(T.grassTall) + x, 5 + (x % 2) * 3, PAL.leaf); }

  // ---- countryside pass
  const DRY = '#8a8a42', DRY2 = '#9a944a', DRYF = '#a8a058';
  const WET = '#476a38', WET2 = '#3f6033', WETF = '#527a3e';
  for (const [id, base, fleck, seed] of [[T.grassDry, DRY, DRYF, 60], [T.grassDry2, DRY2, DRY, 61]] as const) {
    p.rect(at(id), 0, TILE, TILE, base);
    p.noise(at(id), 0, TILE, TILE, fleck, 0.14, seed);
    p.noise(at(id), 0, TILE, TILE, PAL.grass2, 0.05, seed + 5);
  }
  for (const [id, base, fleck, seed] of [[T.grassWet, WET, WETF, 62], [T.grassWet2, WET2, WET, 63]] as const) {
    p.rect(at(id), 0, TILE, TILE, base);
    p.noise(at(id), 0, TILE, TILE, fleck, 0.12, seed);
    p.noise(at(id), 0, TILE, TILE, PAL.leaf2, 0.05, seed + 5);
  }
  for (const [id, seed] of [[T.earth, 64], [T.earth2, 65]] as const) {
    p.rect(at(id), 0, TILE, TILE, '#7a6242');
    p.noise(at(id), 0, TILE, TILE, '#6a5238', 0.3, seed);
    p.noise(at(id), 0, TILE, TILE, PAL.grass2, id === T.earth2 ? 0.18 : 0.06, seed + 3);
    p.noise(at(id), 0, TILE, TILE, PAL.stone2, 0.03, seed + 7);
  }
  const tallFrames = [T.tall0, T.tall1, T.tall2];
  tallFrames.forEach((id, f) => {
    p.rect(at(id), 0, TILE, TILE, PAL.grass);
    p.noise(at(id), 0, TILE, TILE, PAL.grass3, 0.1, 66 + f);
    for (let x = 1; x < TILE - 1; x += 3) {
      const h = 7 + (x % 2) * 3;
      for (let i = 0; i < h; i++) {
        const lean = Math.floor((i / h) * f * 1.6);
        p.px(at(id) + Math.min(TILE - 1, x + lean), TILE - 1 - i, i > h - 3 ? PAL.leaf : PAL.leaf3);
      }
    }
  });
  const seedFrames = [T.seed0, T.seed1, T.seed2];
  seedFrames.forEach((id, f) => {
    p.rect(at(id), 0, TILE, TILE, DRY2);
    p.noise(at(id), 0, TILE, TILE, DRYF, 0.12, 70 + f);
    for (let x = 2; x < TILE - 1; x += 4) {
      const h = 9 + (x % 3);
      for (let i = 0; i < h; i++) {
        const lean = Math.floor((i / h) * f * 2);
        const px = Math.min(TILE - 1, x + lean);
        p.px(at(id) + px, TILE - 1 - i, '#b8a45c');
        if (i >= h - 3) p.px(at(id) + px, TILE - 1 - i, '#d9c27a');
      }
    }
  });
  const flw: [number, number, string][] = [[T.flwWhite0, T.flwWhite1, '#f1ead8'], [T.flwBlue0, T.flwBlue1, '#7f9fd6'], [T.flwYellow0, T.flwYellow1, '#e2c04f']];
  for (const [a, b, colour] of flw) {
    [a, b].forEach((id, f) => {
      p.rect(at(id), 0, TILE, TILE, PAL.grass);
      p.noise(at(id), 0, TILE, TILE, PAL.grass3, 0.1, 74 + id);
      const pts: [number, number][] = [[3, 5], [10, 3], [7, 11], [13, 9], [2, 12]];
      for (const [x, y] of pts) {
        p.px(at(id) + x, y + 1, PAL.leaf); p.px(at(id) + x, y + 2, PAL.leaf);
        p.px(at(id) + x + f, y, colour); p.px(at(id) + x + f - 1, y, colour); p.px(at(id) + x + f + 1, y, colour); p.px(at(id) + x + f, y - 1, colour);
      }
    });
  }
  p.rect(at(T.mossStone), 0, TILE, TILE, PAL.grass);
  p.noise(at(T.mossStone), 0, TILE, TILE, PAL.grass3, 0.1, 80);
  p.rect(at(T.mossStone) + 2, 6, 11, 7, PAL.stone2); p.rect(at(T.mossStone) + 3, 5, 9, 2, PAL.stone);
  p.noise(at(T.mossStone) + 2, 5, 11, 8, PAL.leaf2, 0.3, 81); p.rect(at(T.mossStone) + 2, 12, 11, 1, '#4a4540');
  p.rect(at(T.weeds), 0, TILE, TILE, PAL.grass);
  p.noise(at(T.weeds), 0, TILE, TILE, PAL.grass2, 0.1, 82);
  for (const [x, y] of [[3, 9], [8, 5], [12, 10], [6, 13]] as const) { p.px(at(T.weeds) + x, y, PAL.leaf2); p.px(at(T.weeds) + x - 1, y + 1, PAL.leaf2); p.px(at(T.weeds) + x + 1, y + 1, PAL.leaf2); p.px(at(T.weeds) + x, y + 2, PAL.leaf); p.px(at(T.weeds) + x, y - 1, PAL.leaf3); }
  [T.reeds0, T.reeds1].forEach((id, f) => {
    p.rect(at(id), 0, TILE, TILE, '#a08a5c');
    p.noise(at(id), 0, TILE, TILE, '#b39a68', 0.2, 84 + f);
    for (let x = 2; x < TILE; x += 4) { p.vline(at(id) + x + f, 2, 13, '#5a7a3a'); p.rect(at(id) + x + f, 1, 1, 3, '#6a4a2a'); }
  });
  for (const [id, seed] of [[T.trail, 86], [T.trail2, 87]] as const) {
    p.rect(at(id), 0, TILE, TILE, PAL.grass2);
    p.noise(at(id), 0, TILE, TILE, PAL.grass, 0.15, seed);
    p.rect(at(id) + 4, 0, 8, TILE, '#7d6a48');
    p.noise(at(id) + 3, 0, 10, TILE, PAL.dirt, 0.3, seed + 1);
    p.noise(at(id) + 3, 0, 10, TILE, PAL.grass2, 0.25, seed + 2);
  }
  p.rect(at(T.stoneWall), 0, TILE, TILE, PAL.grass);
  p.rect(at(T.stoneWall), 5, TILE, 8, PAL.stone2);
  for (let y = 5; y < 13; y += 3) for (let x = ((y / 3) % 2) * 3; x < TILE; x += 6) p.rect(at(T.stoneWall) + x, y, 5, 2, (x + y) % 4 ? PAL.stone : '#9a958e');
  p.hline(at(T.stoneWall), 13, TILE, '#4a4540'); p.noise(at(T.stoneWall), 4, TILE, 2, PAL.leaf2, 0.3, 88);
  p.rect(at(T.stoneWallV), 0, TILE, TILE, PAL.grass);
  p.rect(at(T.stoneWallV) + 4, 0, 8, TILE, PAL.stone2);
  for (let y = 0; y < TILE; y += 3) p.rect(at(T.stoneWallV) + 5 + ((y / 3) % 2), y, 5, 2, (y % 2) ? PAL.stone : '#9a958e');
  p.vline(at(T.stoneWallV) + 12, 0, TILE, '#4a4540');
  p.rect(at(T.ledge), 0, TILE, TILE, PAL.grass);
  p.rect(at(T.ledge), 6, TILE, 10, '#6a5a4c');
  p.rect(at(T.ledge), 6, TILE, 2, PAL.grass2);
  for (let y = 9; y < 15; y += 3) p.hline(at(T.ledge) + ((y / 3) % 2) * 4, y, 6, '#4a3c32');
  p.hline(at(T.ledge), 15, TILE, '#3a2e26'); p.noise(at(T.ledge), 8, TILE, 7, PAL.stone2, 0.05, 89);
  p.rect(at(T.water3), 0, TILE, TILE, PAL.water);
  p.hline(at(T.water3) + 4, 2, 4, PAL.water2); p.hline(at(T.water3) + 10, 9, 5, PAL.water2); p.hline(at(T.water3) + 1, 14, 3, '#4f7a8a');
  p.rect(at(T.mudWet), 0, TILE, TILE, '#4f4a34');
  p.noise(at(T.mudWet), 0, TILE, TILE, '#5a5a3a', 0.25, 90); p.noise(at(T.mudWet), 0, TILE, TILE, WET2, 0.15, 91);
  p.rect(at(T.gravel2), 0, TILE, TILE, PAL.grass2); p.noise(at(T.gravel2), 0, TILE, TILE, PAL.stone2, 0.18, 92); p.noise(at(T.gravel2), 0, TILE, TILE, PAL.stone, 0.08, 93);

  // ---- polish pass: paving variety
  const cobbleBase = (id: number, r: number) => {
    p.rect(at(id), 0, TILE, TILE, PAL.cobble3);
    for (let y = 0; y < TILE; y += 4) for (let x = ((y / 4) % 2) * 3 - r; x < TILE; x += 6) {
      const sx = Math.max(0, x);
      p.rect(at(id) + sx, y, Math.min(5, TILE - sx), 3, (x + y) % 3 ? PAL.cobble : PAL.cobble2);
    }
  };
  cobbleBase(T.cobbleCracked, 0); p.px(at(T.cobbleCracked) + 4, 5, PAL.ink); p.px(at(T.cobbleCracked) + 5, 6, PAL.ink); p.px(at(T.cobbleCracked) + 6, 6, PAL.ink); p.px(at(T.cobbleCracked) + 7, 7, PAL.ink); p.px(at(T.cobbleCracked) + 11, 11, PAL.ink); p.px(at(T.cobbleCracked) + 12, 12, PAL.ink); p.px(at(T.cobbleCracked) + 12, 13, PAL.ink);
  cobbleBase(T.cobbleMoss, 3); p.noise(at(T.cobbleMoss), 0, TILE, TILE, PAL.leaf2, 0.22, 100); p.noise(at(T.cobbleMoss), 0, TILE, TILE, PAL.leaf3, 0.08, 101);
  cobbleBase(T.cobbleWorn, 0); p.noise(at(T.cobbleWorn), 0, TILE, TILE, PAL.dirt2, 0.28, 102); p.noise(at(T.cobbleWorn), 0, TILE, TILE, '#7a7268', 0.2, 103);
  cobbleBase(T.cobbleLeaves, 3); for (const [x, y, c] of [[3, 4, '#b8763a'], [9, 2, '#c9963a'], [12, 9, '#a85a2a'], [5, 12, '#c9963a'], [14, 13, '#b8763a']] as const) { p.px(at(T.cobbleLeaves) + x, y, c); p.px(at(T.cobbleLeaves) + x + 1, y, c); }
  // paths: grass creeping in, stones, mud, grassy middle
  p.rect(at(T.pathEdge), 0, TILE, TILE, PAL.dirt); p.noise(at(T.pathEdge), 0, TILE, TILE, PAL.dirt2, 0.2, 104);
  p.noise(at(T.pathEdge), 0, TILE, TILE, PAL.grass2, 0.3, 105); p.noise(at(T.pathEdge), 0, 5, TILE, PAL.grass, 0.45, 106); p.noise(at(T.pathEdge) + 11, 0, 5, TILE, PAL.grass, 0.45, 107);
  p.rect(at(T.pathStones), 0, TILE, TILE, PAL.dirt); p.noise(at(T.pathStones), 0, TILE, TILE, PAL.dirt2, 0.2, 108);
  p.rect(at(T.pathStones) + 3, 4, 4, 3, PAL.stone2); p.rect(at(T.pathStones) + 4, 3, 2, 1, PAL.stone); p.rect(at(T.pathStones) + 10, 10, 3, 2, PAL.stone2); p.rect(at(T.pathStones) + 9, 5, 2, 2, PAL.stone2);
  p.rect(at(T.pathMud), 0, TILE, TILE, PAL.dirt2); p.noise(at(T.pathMud), 0, TILE, TILE, '#5a4630', 0.3, 109); p.rect(at(T.pathMud) + 3, 6, 9, 4, '#5a4630'); p.rect(at(T.pathMud) + 5, 7, 5, 2, '#6a5a44');
  p.rect(at(T.pathGrassy), 0, TILE, TILE, PAL.dirt); p.noise(at(T.pathGrassy), 0, TILE, TILE, PAL.dirt2, 0.2, 110); p.noise(at(T.pathGrassy) + 5, 0, 6, TILE, PAL.grass2, 0.55, 111); p.noise(at(T.pathGrassy) + 6, 0, 4, TILE, PAL.grass, 0.4, 112);
  // ground detail
  p.rect(at(T.clover), 0, TILE, TILE, PAL.grass); p.noise(at(T.clover), 0, TILE, TILE, PAL.grass3, 0.1, 113);
  for (const [x, y] of [[3, 4], [10, 3], [6, 10], [12, 11], [2, 13]] as const) { p.px(at(T.clover) + x, y, PAL.leaf3); p.px(at(T.clover) + x + 1, y, PAL.leaf3); p.px(at(T.clover) + x, y + 1, PAL.leaf3); p.px(at(T.clover) + x + 1, y + 1, PAL.leaf); }
  p.rect(at(T.leaves), 0, TILE, TILE, PAL.grass2); p.noise(at(T.leaves), 0, TILE, TILE, PAL.grass, 0.1, 114);
  for (const [x, y, c] of [[2, 3, '#b8763a'], [8, 2, '#c9963a'], [12, 6, '#a85a2a'], [4, 9, '#c9963a'], [10, 12, '#b8763a'], [14, 13, '#8a5a2a'], [6, 13, '#a85a2a']] as const) { p.px(at(T.leaves) + x, y, c); p.px(at(T.leaves) + x + 1, y, c); p.px(at(T.leaves) + x, y + 1, c); }
  p.rect(at(T.soot), 0, TILE, TILE, '#4a4238'); p.noise(at(T.soot), 0, TILE, TILE, '#3a342c', 0.3, 115); p.noise(at(T.soot), 0, TILE, TILE, PAL.dirt2, 0.12, 116); p.noise(at(T.soot), 0, TILE, TILE, PAL.grass2, 0.05, 117);
  // water with lily pads, two frames
  [T.waterLily0, T.waterLily1].forEach((id, f) => {
    p.rect(at(id), 0, TILE, TILE, PAL.water); p.hline(at(id) + 2, 4 + f, 5, PAL.water2); p.hline(at(id) + 9, 11 - f, 4, PAL.water2);
    p.disc(5 + f, 6, 2, PAL.leaf); p.px(6 + f, 5, PAL.water); p.disc(11, 11 + f, 2, PAL.leaf3); p.px(12, 10 + f, PAL.water); p.px(5 + f, 5, '#f1c9d8');
  });
  p.rect(at(T.waterStone), 0, TILE, TILE, PAL.water); p.hline(at(T.waterStone) + 1, 12, 5, PAL.water2); p.rect(at(T.waterStone) + 5, 5, 7, 5, PAL.stone2); p.rect(at(T.waterStone) + 6, 4, 5, 2, PAL.stone); p.hline(at(T.waterStone) + 4, 10, 9, '#5f8a9a');
  // grass overhanging the bank
  p.rect(at(T.shoreGrass), 0, TILE, TILE, '#a08a5c'); p.noise(at(T.shoreGrass), 0, TILE, TILE, '#b39a68', 0.25, 118);
  p.rect(at(T.shoreGrass), 0, TILE, 6, PAL.grass); for (let x = 0; x < TILE; x += 2) p.px(at(T.shoreGrass) + x, 6 + (x % 3), PAL.grass2);
  p.noise(at(T.shoreGrass), 0, TILE, 5, PAL.grass3, 0.15, 119);
  // trampled grass at entrances
  p.rect(at(T.trampled), 0, TILE, TILE, PAL.grass2); p.noise(at(T.trampled), 0, TILE, TILE, PAL.dirt, 0.28, 120); p.noise(at(T.trampled), 0, TILE, TILE, PAL.grass, 0.15, 121);
  // The terrace is retained by aged stone, with an uneven moss-covered cap.
  const masonry = mulberry(809);
  p.rect(at(T.cliff), 0, TILE, TILE, '#484b40');
  for (let y = 2; y < TILE - 1; y += 4) for (let x = y % 8 ? -3 : 0; x < TILE; x += 7) {
    const xx = Math.max(0, x), width = Math.min(6, TILE - xx);
    p.rect(at(T.cliff) + xx, y, width, 3, masonry() < 0.5 ? '#7e8070' : '#6b7062');
    p.hline(at(T.cliff) + xx, y, width, '#96947d');
  }
  p.hline(at(T.cliff), 0, TILE, '#9b9980');
  p.noise(at(T.cliff), 0, TILE, 3, PAL.leaf2, 0.35, 811);
  p.hline(at(T.cliff), TILE - 1, TILE, '#303b2c');
  return p.canvas;
}

/**
 * Trees. Variants 0/1 are the original round crowns; 2 is a broad old tree,
 * 3 a slim tall one, 4 a young sapling, 5 an autumn-touched crown.
 * Every canvas has the trunk base at bottom centre.
 */
export function paintTree(variant: number): HTMLCanvasElement {
  const v = variant % 6;
  if (v === 2) {
    const p = new Painter(48, 52);
    p.rect(21, 36, 8, 16, PAL.trunk); p.rect(19, 46, 12, 6, PAL.trunk); p.vline(23, 36, 14, PAL.wood2); p.rect(17, 34, 6, 5, PAL.trunk); p.rect(27, 33, 6, 5, PAL.trunk);
    const blobs: [number, number, number][] = [[24, 18, 16], [11, 24, 10], [37, 24, 10], [24, 9, 10], [14, 12, 8], [34, 12, 8], [8, 18, 7], [40, 18, 7]];
    for (const [cx, cy, r] of blobs) p.disc(cx, cy, r, PAL.leaf2);
    for (const [cx, cy, r] of blobs) p.disc(cx, cy - 3, r - 4, PAL.leaf);
    for (const [cx, cy, r] of blobs) if (r > 8) p.disc(cx - 2, cy - 6, Math.max(2, r - 9), PAL.leaf3);
    p.noise(4, 4, 40, 32, PAL.leaf2, 0.08, 45);
    outline(p, PAL.outline);
    return p.canvas;
  }
  if (v === 3) {
    const p = new Painter(24, 52);
    p.rect(10, 34, 4, 18, PAL.trunk); p.rect(9, 46, 6, 6, PAL.trunk); p.vline(11, 34, 16, PAL.wood2);
    const blobs: [number, number, number][] = [[12, 28, 7], [12, 18, 8], [12, 9, 7], [7, 22, 5], [17, 14, 5]];
    for (const [cx, cy, r] of blobs) p.disc(cx, cy, r, PAL.leaf);
    for (const [cx, cy, r] of blobs) p.disc(cx, cy - 2, r - 3, PAL.leaf3);
    p.noise(3, 2, 18, 32, PAL.leaf2, 0.1, 46);
    outline(p, PAL.outline);
    return p.canvas;
  }
  if (v === 4) {
    const p = new Painter(16, 22);
    p.rect(7, 14, 2, 8, PAL.trunk);
    p.disc(8, 9, 5, PAL.leaf); p.disc(7, 7, 3, PAL.leaf3); p.disc(11, 11, 3, PAL.leaf2);
    outline(p, PAL.outline);
    return p.canvas;
  }
  const p = new Painter(32, 40);
  const autumn = v === 5;
  const leaf = autumn ? '#8a6a2a' : v % 2 ? PAL.leaf : PAL.leaf2;
  const hi = autumn ? '#b8863a' : v % 2 ? PAL.leaf3 : PAL.leaf;
  p.rect(13, 28, 6, 12, PAL.trunk);
  p.rect(12, 34, 8, 6, PAL.trunk);
  p.vline(14, 28, 10, PAL.wood2);
  const blobs: [number, number, number][] = [[16, 14, 12], [9, 19, 8], [23, 19, 8], [16, 8, 8], [11, 10, 6], [21, 10, 6]];
  for (const [cx, cy, r] of blobs) p.disc(cx, cy, r, leaf);
  for (const [cx, cy, r] of blobs) p.disc(cx, cy - 3, r - 3, hi);
  p.noise(4, 4, 24, 22, autumn ? '#c9963a' : PAL.leaf2, 0.08, 40 + v);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintFallenLog(): HTMLCanvasElement {
  const p = new Painter(30, 10);
  p.rect(3, 2, 24, 6, PAL.wood2); p.rect(3, 2, 24, 2, PAL.wood); p.noise(3, 2, 24, 6, PAL.leaf2, 0.08, 47);
  p.rect(0, 2, 4, 6, PAL.wood3); p.rect(1, 4, 2, 2, PAL.wood2); p.rect(26, 1, 4, 7, PAL.wood3);
  p.rect(12, 0, 3, 2, PAL.leaf); p.rect(20, 8, 2, 2, '#c96a6a');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintChoppingBlock(): HTMLCanvasElement {
  const p = new Painter(14, 14);
  p.rect(2, 6, 10, 7, PAL.wood2); p.rect(2, 5, 10, 3, PAL.wood3); p.rect(4, 6, 6, 1, PAL.wood);
  p.rect(6, 0, 2, 6, PAL.wood2); p.rect(4, 1, 5, 3, PAL.stone2); p.rect(4, 1, 5, 1, '#b5b0a8');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintWheelbarrow(): HTMLCanvasElement {
  const p = new Painter(22, 14);
  p.rect(4, 3, 12, 6, PAL.wood); p.rect(4, 3, 12, 1, PAL.wood3); p.rect(4, 8, 12, 1, PAL.wood2);
  p.rect(16, 5, 6, 2, PAL.wood2); p.disc(6, 11, 3, PAL.wood2); p.disc(6, 11, 1, PAL.wood3); p.rect(14, 9, 2, 4, PAL.wood2);
  p.rect(6, 1, 8, 3, PAL.dirt2); p.px(8, 0, PAL.leaf3); p.px(11, 0, PAL.leaf3);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintBeehive(): HTMLCanvasElement {
  const p = new Painter(12, 16);
  p.rect(3, 12, 6, 4, PAL.wood2); p.rect(2, 11, 8, 1, PAL.wood);
  p.disc(6, 7, 5, '#c9a84a'); p.hline(2, 5, 8, '#a88a3a'); p.hline(1, 8, 10, '#a88a3a'); p.hline(2, 11, 8, '#a88a3a'); p.rect(5, 9, 2, 2, PAL.ink);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Campfire, 2 frames of 16x16. */
export function paintCampfire(): HTMLCanvasElement {
  const p = new Painter(32, 16);
  for (let f = 0; f < 2; f++) {
    const ox = f * 16;
    for (let i = 0; i < 7; i++) p.rect(ox + 1 + i * 2, 12 + ((i % 2) ? 1 : 0), 3, 3, PAL.stone2);
    p.rect(ox + 4, 10, 8, 3, PAL.wood2); p.rect(ox + 3, 11, 10, 1, PAL.trunk);
    p.rect(ox + 6, 6 + f, 4, 5, PAL.ember); p.rect(ox + 7, 3 + f * 2, 2, 4, '#f2c063'); p.px(ox + 5 + f * 3, 5 - f, '#f2c063'); p.px(ox + 8, 2 + f, PAL.lampCore);
  }
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintShrine(): HTMLCanvasElement {
  const p = new Painter(18, 26);
  p.rect(3, 20, 12, 6, PAL.stone2); p.rect(2, 19, 14, 2, PAL.stone);
  p.rect(5, 8, 8, 12, PAL.stone2); p.rect(6, 10, 6, 7, '#2a2430'); p.rect(8, 12, 2, 3, PAL.lamp);
  p.rect(2, 4, 14, 5, PAL.roofSlate); p.rect(4, 2, 10, 3, PAL.roofSlate2); p.rect(8, 0, 2, 3, PAL.stone);
  p.noise(3, 14, 12, 10, PAL.leaf2, 0.12, 48);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintBrokenWheel(): HTMLCanvasElement {
  const p = new Painter(14, 14);
  p.disc(7, 7, 6, PAL.wood2); p.disc(7, 7, 4, '#00000000');
  for (let a = 0; a < 6; a++) { const x = Math.round(7 + Math.cos(a) * 4), y = Math.round(7 + Math.sin(a) * 4); p.rect(Math.min(x, 7), Math.min(y, 7), Math.abs(x - 7) + 1, Math.abs(y - 7) + 1, PAL.wood3); }
  p.rect(10, 1, 4, 4, '#00000000'); p.disc(7, 7, 1, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintMailSacks(): HTMLCanvasElement {
  const p = new Painter(18, 12);
  p.disc(5, 7, 4, '#c9b48a'); p.rect(3, 2, 4, 3, '#b39a6a'); p.hline(3, 4, 4, PAL.wood2);
  p.disc(12, 7, 4, '#b39a6a'); p.rect(10, 2, 4, 3, '#a88a5a'); p.hline(10, 4, 4, PAL.wood2);
  p.rect(2, 10, 14, 2, '#a88a5a');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintParcels(): HTMLCanvasElement {
  const p = new Painter(16, 14);
  p.rect(1, 6, 8, 7, PAL.wood3); p.hline(1, 9, 8, PAL.wood2); p.vline(5, 6, 7, PAL.wood2);
  p.rect(8, 3, 7, 6, '#c9b48a'); p.hline(8, 6, 7, '#7a4a4a'); p.vline(11, 3, 6, '#7a4a4a');
  p.rect(3, 1, 6, 5, PAL.plaster2); p.hline(3, 3, 6, '#7a4a4a'); p.vline(6, 1, 5, '#7a4a4a');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintNoticeBoard(): HTMLCanvasElement {
  const p = new Painter(22, 24);
  p.rect(3, 14, 2, 10, PAL.wood2); p.rect(17, 14, 2, 10, PAL.wood2);
  p.rect(1, 2, 20, 13, PAL.wood2); p.rect(2, 3, 18, 11, PAL.wood); p.rect(0, 0, 22, 3, PAL.roofBrown2);
  p.rect(4, 5, 5, 6, PAL.plaster); p.hline(5, 7, 3, PAL.stone2); p.hline(5, 9, 2, PAL.stone2);
  p.rect(11, 4, 6, 5, '#e0d3a0'); p.hline(12, 6, 4, PAL.stone2); p.rect(10, 10, 5, 3, PAL.plaster2);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Banner on a pole, 2 wind frames of 12x30. */
export function paintBanner(colour: string): HTMLCanvasElement {
  const p = new Painter(24, 30);
  for (let f = 0; f < 2; f++) {
    const ox = f * 12;
    p.rect(ox + 2, 0, 2, 30, PAL.wood2); p.rect(ox + 1, 0, 4, 2, '#d9b34a');
    for (let y = 2; y < 18; y++) { const w = 7 - Math.floor(y / 6) - (f && y > 8 ? 1 : 0); const x = ox + 4 + (f ? Math.floor(Math.sin(y * 0.5) * 1.5) : 0); p.hline(x, y, Math.max(2, w), colour); }
    p.rect(ox + 5, 6, 3, 3, '#d9b34a');
  }
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintTavernSign(): HTMLCanvasElement {
  const p = new Painter(16, 14);
  p.rect(7, 0, 2, 3, PAL.ink);
  p.rect(1, 3, 14, 10, PAL.wood3); p.rect(1, 3, 14, 1, PAL.wood); p.rect(1, 12, 14, 1, PAL.wood2);
  p.rect(4, 5, 5, 6, '#c9a84a'); p.rect(9, 6, 2, 3, '#c9a84a'); p.rect(4, 5, 5, 2, PAL.plaster);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintLantern(): HTMLCanvasElement {
  const p = new Painter(8, 14);
  p.rect(3, 0, 2, 3, PAL.ink); p.box(1, 3, 6, 8, PAL.lamp, PAL.ink); p.rect(3, 5, 2, 3, PAL.lampCore); p.rect(2, 11, 4, 2, PAL.ink);
  return p.canvas;
}

export function paintFlowerBox(): HTMLCanvasElement {
  const p = new Painter(18, 10);
  p.rect(1, 4, 16, 6, PAL.wood2); p.rect(1, 4, 16, 1, PAL.wood3);
  for (let x = 2; x < 16; x += 3) { p.rect(x, 2, 2, 3, PAL.leaf); p.px(x, 1, x % 2 ? '#c96a6a' : '#e2c04f'); p.px(x + 1, 0, x % 2 ? '#e2c04f' : '#f1ead8'); }
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintPlanter(): HTMLCanvasElement {
  const p = new Painter(14, 16);
  p.rect(2, 8, 10, 8, PAL.stone2); p.rect(1, 7, 12, 2, PAL.stone); p.rect(3, 12, 8, 1, '#5a544e');
  p.disc(7, 5, 4, PAL.leaf); p.disc(6, 4, 2, PAL.leaf3); p.px(5, 3, '#c96a6a'); p.px(9, 5, '#f1ead8'); p.px(7, 6, '#e2c04f');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintTimberPile(): HTMLCanvasElement {
  const p = new Painter(26, 12);
  for (let row = 0; row < 3; row++) { const y = 8 - row * 3; p.rect(1 + row, y, 24 - row * 2, 3, PAL.wood3); p.rect(1 + row, y, 24 - row * 2, 1, PAL.wood); p.rect(1 + row, y + 2, 24 - row * 2, 1, PAL.wood2); }
  p.rect(0, 4, 2, 8, PAL.wood2); p.rect(24, 4, 2, 8, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintSawhorse(): HTMLCanvasElement {
  const p = new Painter(20, 14);
  p.rect(2, 3, 16, 3, PAL.wood3); p.rect(2, 5, 16, 1, PAL.wood2);
  p.rect(3, 6, 2, 8, PAL.wood2); p.rect(6, 6, 2, 8, PAL.wood2); p.rect(12, 6, 2, 8, PAL.wood2); p.rect(15, 6, 2, 8, PAL.wood2);
  p.rect(6, 0, 10, 3, PAL.wood); p.rect(14, 0, 4, 1, PAL.stone2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintCoalPile(): HTMLCanvasElement {
  const p = new Painter(18, 10);
  p.disc(9, 8, 8, '#2a2428'); p.disc(6, 6, 5, '#332c30'); p.disc(12, 6, 4, '#2a2428');
  p.noise(2, 2, 14, 7, '#4a4248', 0.25, 49); p.px(5, 4, '#5a525a'); p.px(11, 3, '#5a525a');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintMetalStack(): HTMLCanvasElement {
  const p = new Painter(16, 12);
  for (let i = 0; i < 4; i++) { p.rect(1, 9 - i * 2, 14 - i * 2, 2, i % 2 ? PAL.stone2 : '#7a7a80'); p.rect(1, 9 - i * 2, 14 - i * 2, 1, '#9a9aa0'); }
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintBridgePost(): HTMLCanvasElement {
  const p = new Painter(6, 14);
  p.rect(1, 2, 4, 12, PAL.wood2); p.rect(1, 1, 4, 2, PAL.wood3); p.rect(0, 0, 6, 1, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintAwning(w: number, colour: string): HTMLCanvasElement {
  const p = new Painter(w, 14);
  p.rect(1, 6, 2, 8, PAL.wood2); p.rect(w - 3, 6, 2, 8, PAL.wood2);
  for (let y = 0; y < 7; y++) { const inset = Math.round((6 - y) * 0.4); p.hline(inset, y, w - inset * 2, colour); }
  for (let x = 0; x < w; x += 4) p.rect(x, 0, 2, 7, PAL.plaster);
  p.hline(0, 6, w, PAL.ink); for (let x = 1; x < w; x += 4) p.rect(x, 7, 2, 1, colour);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintBookCrates(): HTMLCanvasElement {
  const p = new Painter(20, 12);
  p.box(0, 4, 10, 8, PAL.wood, PAL.wood2); p.box(10, 2, 10, 10, PAL.wood, PAL.wood2);
  for (const [x, y, c] of [[1, 1, PAL.roofPlum], [4, 2, '#3f5e7a'], [7, 0, '#7a3a2a'], [12, 0, '#2f6b66'], [15, -1, '#7a6a3a']] as const) { p.rect(x, y + 3, 3, 3, c); p.hline(x, y + 3, 3, PAL.plaster2); }
  outline(p, PAL.outline);
  return p.canvas;
}

/** Fountain, 2 frames of 36x30. */
export function paintFountain(): HTMLCanvasElement {
  const p = new Painter(72, 30);
  for (let f = 0; f < 2; f++) {
    const ox = f * 36;
    p.rect(ox + 2, 18, 32, 10, PAL.stone2); p.rect(ox + 1, 17, 34, 3, PAL.stone); p.rect(ox + 2, 27, 32, 2, '#5a544e');
    p.rect(ox + 5, 20, 26, 6, PAL.water); p.noise(ox + 5, 20, 26, 6, PAL.water2, 0.2, 130 + f); p.hline(ox + 8 + f * 3, 22, 5, '#7fb2dd'); p.hline(ox + 20 - f * 2, 24, 4, '#7fb2dd');
    p.rect(ox + 15, 8, 6, 12, PAL.stone2); p.rect(ox + 12, 6, 12, 3, PAL.stone); p.rect(ox + 14, 4, 8, 2, PAL.stone2);
    p.rect(ox + 17, 0, 2, 5, '#7fb2dd'); p.px(ox + 16 - f, 2, '#a8d0e8'); p.px(ox + 20 + f, 1, '#a8d0e8');
    p.rect(ox + 12 + f, 9, 2, 8, '#7fb2dd'); p.rect(ox + 22 - f, 9, 2, 8, '#7fb2dd'); p.px(ox + 11 + f, 17, '#a8d0e8'); p.px(ox + 24 - f, 17, '#a8d0e8');
  }
  outline(p, PAL.outline);
  return p.canvas;
}

/** Small stone chapel for the cemetery, 40x46. */
export function paintChapel(): HTMLCanvasElement {
  const p = new Painter(40, 46);
  p.rect(4, 22, 32, 22, PAL.stone); for (let y = 25; y < 44; y += 4) p.hline(4, y, 32, PAL.stone2);
  p.rect(4, 42, 32, 2, '#5a544e');
  p.rect(14, 30, 12, 14, PAL.ink); p.rect(15, 31, 10, 12, PAL.wood2); p.vline(20, 31, 12, PAL.wood); p.rect(16, 28, 8, 3, PAL.ink); p.rect(17, 29, 6, 2, PAL.wood2);
  p.box(7, 27, 5, 7, PAL.glassDark, PAL.stone2); p.box(28, 27, 5, 7, PAL.glassDark, PAL.stone2); p.rect(8, 28, 3, 1, '#7f9fd6'); p.rect(29, 28, 3, 1, '#7f9fd6');
  for (let y = 0; y < 22; y++) { const inset = Math.round((21 - y) * 0.45); p.hline(2 + inset, y + 2, 36 - inset * 2, y % 3 === 2 ? PAL.roofSlate2 : PAL.roofSlate); }
  p.hline(2, 23, 36, PAL.ink);
  p.rect(19, 0, 2, 6, PAL.stone); p.rect(17, 2, 6, 1, PAL.stone);
  p.noise(4, 30, 32, 12, PAL.leaf2, 0.05, 150);
  p.rect(12, 44, 16, 2, PAL.stone2);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Sunflowers, 2 wind frames of 14x22. */
export function paintSunflowers(): HTMLCanvasElement {
  const p = new Painter(28, 22);
  for (let f = 0; f < 2; f++) {
    const ox = f * 14;
    for (const [x, h] of [[3, 16], [8, 20], [12, 14]] as const) {
      p.vline(ox + x, 22 - h, h, PAL.leaf); p.rect(ox + x - 2 + f, 22 - h + 6, 3, 1, PAL.leaf); p.rect(ox + x + 1, 22 - h + 10, 3, 1, PAL.leaf);
      p.disc(ox + x + f, 22 - h - 1, 3, '#e2c04f'); p.disc(ox + x + f, 22 - h - 1, 1, '#5a3a22');
    }
  }
  outline(p, PAL.outline);
  return p.canvas;
}

/** Market stall with a striped awning, 2 variants of 30x28. */
export function paintMarketStall(variant: number): HTMLCanvasElement {
  const p = new Painter(30, 28);
  const a = variant === 0 ? '#b8453a' : '#4f6b3a', b = variant === 0 ? '#e9e4d6' : '#8a9a5a';
  p.rect(2, 14, 2, 14, PAL.wood2); p.rect(26, 14, 2, 14, PAL.wood2);
  p.rect(3, 17, 24, 4, PAL.wood3); p.rect(3, 20, 24, 1, PAL.wood2); p.rect(4, 21, 22, 5, PAL.wood); p.hline(4, 23, 22, PAL.wood2);
  for (const [x, c] of [[5, '#c96a6a'], [9, '#e2c04f'], [13, PAL.leaf3], [17, '#d9b34a'], [21, '#c96a6a']] as const) { p.rect(x, 14, 3, 3, c); p.px(x + 1, 13, c); }
  for (let y = 0; y < 10; y++) { const inset = Math.round((9 - y) * 0.5); p.hline(inset, y + 2, 30 - inset * 2, PAL.wood2); }
  for (let y = 2; y < 12; y++) { const inset = Math.round((9 - (y - 2)) * 0.5); for (let x = inset; x < 30 - inset; x++) p.px(x, y, Math.floor((x + (variant ? 0 : 0)) / 4) % 2 ? a : b); }
  for (let x = 1; x < 29; x += 4) p.rect(x, 12, 2, 1, a);
  p.hline(0, 11, 30, PAL.ink);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Moon-and-stars sign for the observatory, 14x14. */
export function paintMoonSign(): HTMLCanvasElement {
  const p = new Painter(14, 14);
  p.rect(6, 0, 2, 2, PAL.ink); p.box(1, 2, 12, 12, '#22262c', PAL.wood2);
  p.disc(6, 8, 3, '#e0d3a0'); p.disc(8, 7, 3, '#22262c'); p.px(10, 5, '#e0d3a0'); p.px(11, 9, '#e0d3a0'); p.px(4, 4, '#e0d3a0');
  outline(p, PAL.outline);
  return p.canvas;
}

/** Teapot sign for the tavern, 14x14. */
export function paintTeapotSign(): HTMLCanvasElement {
  const p = new Painter(14, 14);
  p.rect(6, 0, 2, 2, PAL.ink); p.box(1, 2, 12, 12, PAL.wood3, PAL.wood2);
  p.disc(6, 9, 3, '#c9a84a'); p.rect(9, 7, 3, 1, '#c9a84a'); p.px(11, 6, '#c9a84a'); p.rect(3, 8, 1, 3, '#c9a84a'); p.rect(5, 5, 2, 2, '#c9a84a');
  outline(p, PAL.outline);
  return p.canvas;
}

/** Hedge segment, 16x12, tiles horizontally. */
export function paintHedge(): HTMLCanvasElement {
  const p = new Painter(16, 12);
  p.rect(0, 3, 16, 9, PAL.leaf2); p.rect(0, 2, 16, 4, PAL.leaf); p.noise(0, 2, 16, 10, PAL.leaf3, 0.15, 151); p.noise(0, 6, 16, 6, PAL.leaf2, 0.2, 152);
  p.px(3, 1, PAL.leaf); p.px(9, 1, PAL.leaf); p.px(13, 1, PAL.leaf3);
  p.hline(0, 11, 16, PAL.outline);
  return p.canvas;
}

/** Wooden dock plank end with a mooring post, 20x14. */
export function paintDock(): HTMLCanvasElement {
  const p = new Painter(20, 14);
  p.rect(0, 2, 20, 10, PAL.wood3); for (let x = 0; x < 20; x += 4) p.vline(x, 2, 10, PAL.wood2); p.hline(0, 2, 20, PAL.wood2); p.hline(0, 11, 20, PAL.wood2);
  p.rect(16, 0, 3, 6, PAL.wood2); p.rect(16, 0, 3, 1, PAL.wood3);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Duck, 2 frames of 10x8, facing left. */
export function paintDuck(): HTMLCanvasElement {
  const p = new Painter(20, 8);
  for (let i = 0; i < 2; i++) {
    const ox = i * 10;
    p.rect(ox + 2, 3, 7, 4, '#f1e9d8'); p.rect(ox + 1, 2, 3, 3, '#f1e9d8'); p.px(ox + 0, 3, '#e0a030'); p.px(ox + 2, 2, PAL.ink);
    p.rect(ox + 4, 3 + i, 4, 2, '#e0d3a0'); p.hline(ox + 1, 7, 8, PAL.water2);
  }
  outline(p, PAL.outline);
  return p.canvas;
}

/** Butterfly, 2 frames of 6x5. */
export function paintButterfly(): HTMLCanvasElement {
  const p = new Painter(12, 5);
  p.rect(0, 1, 2, 3, '#e2c04f'); p.rect(4, 1, 2, 3, '#e2c04f'); p.px(2, 2, PAL.ink); p.px(3, 2, PAL.ink);
  p.rect(7, 2, 1, 2, '#e2c04f'); p.rect(10, 2, 1, 2, '#e2c04f'); p.px(8, 2, PAL.ink); p.px(9, 2, PAL.ink);
  return p.canvas;
}

export function paintLamp(): HTMLCanvasElement {
  const p = new Painter(10, 30);
  p.rect(4, 8, 2, 22, PAL.ink);
  p.rect(3, 28, 4, 2, PAL.stone2);
  p.box(2, 2, 6, 8, PAL.lamp, PAL.ink);
  p.rect(4, 4, 2, 3, PAL.lampCore);
  p.rect(3, 0, 4, 2, PAL.ink);
  return p.canvas;
}

export function paintWell(): HTMLCanvasElement {
  const p = new Painter(24, 28);
  p.rect(2, 16, 20, 10, PAL.stone2);
  p.rect(3, 15, 18, 3, PAL.stone);
  p.rect(6, 18, 12, 6, PAL.water);
  p.rect(4, 4, 2, 14, PAL.wood2);
  p.rect(18, 4, 2, 14, PAL.wood2);
  p.rect(2, 2, 20, 4, PAL.roofBrown);
  p.rect(1, 5, 22, 1, PAL.roofBrown2);
  p.rect(11, 6, 2, 8, PAL.stone2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintBench(): HTMLCanvasElement {
  const p = new Painter(20, 12);
  p.rect(1, 3, 18, 3, PAL.wood3);
  p.rect(1, 6, 18, 1, PAL.wood2);
  p.rect(3, 7, 2, 5, PAL.wood2);
  p.rect(15, 7, 2, 5, PAL.wood2);
  p.rect(1, 0, 18, 3, PAL.wood);
  p.rect(1, 2, 18, 1, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintCrate(): HTMLCanvasElement {
  const p = new Painter(12, 12);
  p.box(0, 0, 12, 12, PAL.wood, PAL.wood2);
  p.hline(1, 5, 10, PAL.wood2);
  p.vline(5, 1, 10, PAL.wood2);
  p.hline(1, 1, 10, PAL.wood3);
  return p.canvas;
}

export function paintBarrel(): HTMLCanvasElement {
  const p = new Painter(10, 13);
  p.rect(1, 1, 8, 11, PAL.wood);
  p.rect(0, 3, 10, 2, PAL.stone2);
  p.rect(0, 8, 10, 2, PAL.stone2);
  p.vline(3, 1, 11, PAL.wood3);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintBush(): HTMLCanvasElement {
  const p = new Painter(18, 12);
  p.disc(6, 7, 5, PAL.leaf2); p.disc(12, 7, 5, PAL.leaf2); p.disc(9, 5, 5, PAL.leaf);
  p.disc(8, 4, 3, PAL.leaf3);
  p.noise(2, 2, 14, 8, PAL.leaf2, 0.1, 50);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintRock(): HTMLCanvasElement {
  const p = new Painter(14, 10);
  p.rect(2, 4, 10, 5, PAL.stone2); p.rect(3, 2, 8, 3, PAL.stone); p.rect(4, 1, 5, 1, '#a8a29a');
  p.rect(2, 8, 10, 1, '#5a544e');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintLog(): HTMLCanvasElement {
  const p = new Painter(18, 8);
  p.rect(2, 1, 14, 6, PAL.wood2); p.rect(2, 1, 14, 2, PAL.wood);
  p.rect(0, 1, 3, 6, PAL.wood3); p.rect(1, 3, 1, 2, PAL.wood2);
  p.rect(15, 1, 3, 6, PAL.wood3); p.rect(16, 3, 1, 2, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintMushroom(): HTMLCanvasElement {
  const p = new Painter(10, 8);
  p.rect(2, 1, 6, 3, '#c96a6a'); p.rect(3, 0, 4, 1, '#c96a6a'); p.px(3, 1, '#f1e9d8'); p.px(6, 2, '#f1e9d8');
  p.rect(4, 4, 2, 3, PAL.plaster); p.rect(0, 5, 3, 2, '#c96a6a'); p.rect(1, 4, 1, 1, '#c96a6a');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintHay(): HTMLCanvasElement {
  const p = new Painter(16, 12);
  p.rect(1, 2, 14, 9, '#c9a84a'); p.rect(1, 2, 14, 2, '#dcbb5c');
  p.noise(1, 2, 14, 9, '#a88a3a', 0.2, 51);
  p.rect(1, 6, 14, 1, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintSignpost(): HTMLCanvasElement {
  const p = new Painter(14, 20);
  p.rect(6, 6, 2, 14, PAL.wood2);
  p.rect(1, 2, 12, 5, PAL.wood3); p.rect(1, 6, 12, 1, PAL.wood2); p.rect(2, 3, 2, 1, PAL.ink); p.rect(5, 3, 5, 1, PAL.ink); p.rect(2, 5, 7, 1, PAL.ink);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintPorchBench(): HTMLCanvasElement {
  const p = new Painter(16, 10);
  p.rect(1, 2, 14, 3, PAL.wood3); p.rect(1, 5, 14, 1, PAL.wood2);
  p.rect(2, 6, 2, 4, PAL.wood2); p.rect(12, 6, 2, 4, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintFirewood(): HTMLCanvasElement {
  const p = new Painter(18, 12);
  for (let row = 0; row < 3; row++) for (let i = 0; i < 4 - (row % 2); i++) {
    const x = 1 + i * 4 + (row % 2) * 2, y = 8 - row * 3;
    p.rect(x, y, 4, 3, PAL.wood2); p.rect(x + 1, y + 1, 2, 1, PAL.wood3);
  }
  p.rect(0, 2, 1, 10, PAL.wood2); p.rect(17, 2, 1, 10, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintCart(): HTMLCanvasElement {
  const p = new Painter(28, 18);
  p.rect(4, 4, 18, 8, PAL.wood); p.rect(4, 4, 18, 1, PAL.wood3); p.rect(4, 11, 18, 1, PAL.wood2);
  for (let x = 6; x < 22; x += 4) p.vline(x, 5, 6, PAL.wood2);
  p.rect(22, 7, 6, 2, PAL.wood2);
  p.disc(8, 13, 4, PAL.wood2); p.disc(8, 13, 2, PAL.wood3); p.disc(18, 13, 4, PAL.wood2); p.disc(18, 13, 2, PAL.wood3);
  p.rect(6, 1, 12, 3, '#c9a84a'); p.noise(6, 1, 12, 3, '#a88a3a', 0.3, 95);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintTools(): HTMLCanvasElement {
  const p = new Painter(14, 20);
  p.rect(3, 4, 1, 16, PAL.wood2); p.rect(1, 1, 5, 1, PAL.stone2); p.rect(1, 1, 1, 4, PAL.stone2); p.rect(3, 1, 1, 4, PAL.stone2); p.rect(5, 1, 1, 4, PAL.stone2);
  p.rect(10, 5, 1, 15, PAL.wood2); p.rect(6, 3, 6, 1, PAL.stone2); p.rect(5, 4, 2, 1, PAL.stone); p.rect(11, 4, 2, 1, PAL.stone2);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintStoneMarker(): HTMLCanvasElement {
  const p = new Painter(10, 14);
  p.rect(3, 2, 4, 11, PAL.stone2); p.rect(3, 1, 4, 2, PAL.stone); p.rect(2, 12, 6, 2, '#5a544e');
  p.px(4, 5, '#4a4540'); p.px(5, 7, '#4a4540'); p.noise(3, 6, 4, 6, PAL.leaf2, 0.15, 96);
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintGravestone(variant: number): HTMLCanvasElement {
  const p = new Painter(12, 14);
  if (variant === 0) { p.rect(3, 3, 6, 10, PAL.stone2); p.disc(6, 3, 3, PAL.stone2); p.rect(4, 4, 4, 1, PAL.stone); p.px(5, 7, '#4a4540'); p.px(6, 7, '#4a4540'); }
  else if (variant === 1) { p.rect(5, 1, 2, 12, PAL.stone2); p.rect(2, 4, 8, 2, PAL.stone2); p.px(5, 1, PAL.stone); }
  else { p.rect(2, 6, 8, 7, PAL.stone2); p.rect(3, 5, 6, 2, PAL.stone); p.noise(2, 8, 8, 5, PAL.leaf2, 0.2, 97); }
  p.rect(2, 12, 8, 2, '#5a544e');
  outline(p, PAL.outline);
  return p.canvas;
}

export function paintDeadTree(): HTMLCanvasElement {
  const p = new Painter(24, 36);
  p.rect(10, 12, 4, 24, PAL.trunk); p.rect(9, 30, 6, 6, PAL.trunk);
  p.rect(6, 8, 4, 2, PAL.trunk); p.rect(4, 4, 2, 5, PAL.trunk); p.rect(10, 4, 2, 9, PAL.trunk);
  p.rect(14, 10, 5, 2, PAL.trunk); p.rect(18, 3, 2, 8, PAL.trunk); p.rect(15, 6, 2, 5, PAL.trunk);
  p.vline(11, 12, 20, PAL.wood2);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Clothesline with two cloths, 2 wind frames of 30x18. */
export function paintClothesline(): HTMLCanvasElement {
  const p = new Painter(60, 18);
  for (let f = 0; f < 2; f++) {
    const ox = f * 30;
    p.rect(ox + 2, 2, 2, 16, PAL.wood2); p.rect(ox + 26, 2, 2, 16, PAL.wood2);
    p.hline(ox + 4, 3, 22, PAL.ink);
    const lean = f;
    p.rect(ox + 7 + lean, 4, 6, 7, '#c9c0a8'); p.rect(ox + 7 + lean * 2, 9, 6, 2, '#c9c0a8');
    p.rect(ox + 16 + lean, 4, 7, 8, '#7a4a4a'); p.rect(ox + 16 + lean * 2, 10, 7, 2, '#7a4a4a');
  }
  outline(p, PAL.outline);
  return p.canvas;
}

/** Sheep, 2 frames of 14x10, facing left. */
export function paintSheep(): HTMLCanvasElement {
  const p = new Painter(28, 10);
  for (let i = 0; i < 2; i++) {
    const ox = i * 14;
    p.rect(ox + 3, 2, 10, 6, '#e9e4d6'); p.rect(ox + 2, 3, 12, 4, '#e9e4d6'); p.noise(ox + 3, 2, 10, 6, '#d4cebd', 0.2, 98 + i);
    p.rect(ox + 1, 4, 3, 3, '#3a3340'); p.px(ox + 1, 5, PAL.ink);
    p.rect(ox + 4 + i, 8, 1, 2, '#3a3340'); p.rect(ox + 11 - i, 8, 1, 2, '#3a3340');
  }
  outline(p, PAL.outline);
  return p.canvas;
}

/** Small wooden shed, 40x34, door on the right. */
export function paintShed(): HTMLCanvasElement {
  const p = new Painter(40, 34);
  p.rect(2, 16, 36, 18, PAL.wood);
  for (let y = 18; y < 34; y += 4) p.hline(2, y, 36, PAL.wood2);
  p.rect(2, 31, 36, 3, PAL.stone2);
  p.rect(28, 20, 8, 12, PAL.wood2); p.vline(32, 21, 10, PAL.wood);
  for (let y = 0; y < 18; y++) { const inset = Math.round((17 - y) * 0.3); p.hline(inset, y, 40 - inset * 2, y % 3 === 2 ? PAL.roofBrown2 : PAL.roofBrown); }
  p.hline(0, 17, 40, PAL.ink);
  p.noise(0, 0, 40, 17, PAL.roofMoss, 0.04, 99);
  outline(p, PAL.outline);
  return p.canvas;
}

/** Soft elliptical shadow, drawn under trees and residents. */
export function paintShadow(w: number, h: number): HTMLCanvasElement {
  const p = new Painter(w, h);
  p.ctx.fillStyle = 'rgba(10,6,14,0.35)';
  p.ctx.beginPath(); p.ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); p.ctx.fill();
  return p.canvas;
}

/** Soft radial light used by the night overlay and lamp glows. */
export function paintGlow(): HTMLCanvasElement {
  const size = 96;
  const p = new Painter(size, size);
  const g = p.ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  p.ctx.fillStyle = g;
  p.ctx.fillRect(0, 0, size, size);
  return p.canvas;
}

/** A 4x4 white square used for particles. */
export function paintSpark(): HTMLCanvasElement {
  const p = new Painter(3, 3);
  p.rect(0, 0, 3, 3, '#ffffff');
  return p.canvas;
}
