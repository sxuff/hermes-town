import { T, TILE } from './tiles';
import { ReferenceArt } from './reference';
import { TOWN_OX, TOWN_OY, type TownMap } from '../world/map';

/** Draw complete masonry and fence sections over continuous ground. */
export function paintStructures(map: TownMap, art: ReferenceArt): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.grid.w * TILE * 2; canvas.height = map.grid.h * TILE * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const woodH = art.furniture(10, 32, 17), woodV = art.furniture(11, 9, 32);
  const ironH = art.furniture(8, 32, 19), ironV = art.furniture(9, 9, 32);
  const wallH = art.furniture(12, 48, 20), wallV = art.furniture(13, 12, 32);
  const stairs = art.furniture(14, 48, 32), crops = art.equipment(7, 32, 15);
  const cemetery = (x: number, y: number) => x >= 9 && x <= 19 && y >= 27 && y <= 37;
  const horizontal = (g: number) => g === T.fence || g === T.fenceEnd ? 'fence' : g === T.cliff || g === T.stoneWall ? 'wall' : g === T.stairs ? 'stairs' : g === T.crop || g === T.crop2 ? 'crop' : '';
  for (let y = 0; y < map.grid.h; y++) for (let x = 0; x < map.grid.w;) {
    const kind = horizontal(map.ground[y]![x]!);
    if (!kind) { x++; continue; }
    const start = x;
    while (x < map.grid.w && horizontal(map.ground[y]![x]!) === kind) x++;
    // The central hall has one continuous stair flight, painted below.
    if (kind === 'stairs' && y === TOWN_OY + 14 && start === TOWN_OX + 30) continue;
    const sprite = kind === 'fence' ? cemetery(start, y) ? ironH : woodH : kind === 'wall' ? wallH : kind === 'stairs' ? stairs : crops;
    const section = kind === 'wall' ? 3 : kind === 'stairs' ? x - start : 2;
    const height = sprite.height / 2;
    for (let tx = start; tx < x; tx += section) {
      const width = Math.min(section, x - tx) * TILE;
      ctx.drawImage(sprite, tx * TILE - 0.5, (y + 1) * TILE - height, width + 1, height);
    }
  }
  for (let x = 0; x < map.grid.w; x++) for (let y = 0; y < map.grid.h;) {
    const tile = map.ground[y]![x]!;
    if (tile !== T.fenceV && tile !== T.stoneWallV) { y++; continue; }
    const start = y;
    while (y < map.grid.h && map.ground[y]![x] === tile) y++;
    const sprite = tile === T.stoneWallV ? wallV : cemetery(x, start) ? ironV : woodV;
    for (let ty = start; ty < y; ty += 2) {
      ctx.drawImage(sprite, x * TILE + 3, ty * TILE - 5, sprite.width / 2, Math.min(2, y - ty) * TILE + 1);
    }
  }
  const hallSteps = art.furniture(14, 48, 40);
  for (let part = 0; part < 2; part++) ctx.drawImage(hallSteps, (TOWN_OX + 30) * TILE, (TOWN_OY + 11) * TILE + part * 40, 48, 40);
  return canvas;
}
