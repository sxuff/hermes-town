/** Grid A* with a per-tile move cost. Four-way, so residents walk on tile axes. */

export interface Grid {
  readonly w: number;
  readonly h: number;
  /** 0 = blocked, otherwise the cost to step onto the tile. */
  readonly cost: Uint8Array;
}

export type Point = { x: number; y: number };

class Heap {
  private a: { k: number; i: number }[] = [];
  get size(): number { return this.a.length; }
  push(k: number, i: number): void {
    const a = this.a;
    a.push({ k, i });
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (a[p]!.k <= a[c]!.k) break;
      [a[p], a[c]] = [a[c]!, a[p]!];
      c = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0]!.i;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.k < a[m]!.k) m = l;
        if (r < a.length && a[r]!.k < a[m]!.k) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export function findPath(grid: Grid, from: Point, to: Point): Point[] | null {
  const { w, h, cost } = grid;
  const idx = (x: number, y: number) => y * w + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  if (!inb(from.x, from.y) || !inb(to.x, to.y)) return null;
  const start = idx(from.x, from.y), goal = idx(to.x, to.y);
  if (cost[goal] === 0) return null;
  const g = new Float32Array(w * h).fill(Infinity);
  const came = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = new Heap();
  g[start] = 0;
  heap.push(0, start);
  const hx = (i: number) => Math.abs((i % w) - to.x) + Math.abs(Math.floor(i / w) - to.y);
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w, cy = Math.floor(cur / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx, ny = cy + dy;
      if (!inb(nx, ny)) continue;
      const ni = idx(nx, ny);
      const c = cost[ni]!;
      if (c === 0 || closed[ni]) continue;
      const ng = g[cur]! + c;
      if (ng < g[ni]!) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ng + hx(ni), ni);
      }
    }
  }
  if (came[goal] === -1 && goal !== start) return null;
  const out: Point[] = [];
  for (let i = goal; i !== -1; i = came[i]!) out.push({ x: i % w, y: Math.floor(i / w) });
  return out.reverse();
}

/** Nearest walkable tile to a point, searching in growing rings. */
export function nearestWalkable(grid: Grid, p: Point, maxR = 6): Point | null {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = p.x + dx, y = p.y + dy;
      if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
      if (grid.cost[y * grid.w + x]! > 0) return { x, y };
    }
  }
  return null;
}
