// 導航格網（4 m 一格）＋ A* ＋ 視線拉直；河流、懸崖、建築不可走，森林／淺灘有成本
import { Heightfield, WATER_LEVEL } from './heightfield';

export class NavGrid {
  readonly cell = 4;
  readonly n: number;
  readonly half: number;
  /** 移動成本（Infinity＝不可走） */
  readonly cost: Float32Array;
  /** 速度倍率（森林、淺灘、道路） */
  readonly speed: Float32Array;
  readonly forest: Float32Array;

  constructor(hf: Heightfield) {
    this.half = hf.play / 2;
    this.n = Math.ceil(hf.play / this.cell);
    const nn = this.n * this.n;
    this.cost = new Float32Array(nn);
    this.speed = new Float32Array(nn);
    this.forest = new Float32Array(nn);
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const x = this.cx(i);
        const z = this.cz(j);
        const k = j * this.n + i;
        const h = hf.height(x, z);
        const ford = hf.fordAt(x, z);
        const slope = hf.slope(x, z);
        const forest = hf.forestAt(x, z);
        const road = hf.roadAt(x, z);
        let blocked = false;
        if (h < WATER_LEVEL - 0.55 && ford < 0.35) blocked = true;
        if (slope > 0.85) blocked = true;
        const edge = Math.max(Math.abs(x), Math.abs(z));
        if (edge > this.half - 4) blocked = true;
        const wet = h < WATER_LEVEL + 0.05 ? 1 : 0;
        this.forest[k] = forest;
        this.speed[k] = Math.max(0.35, (1 - forest * 0.32 - wet * 0.4 - Math.max(0, slope - 0.25) * 0.5) * (1 + road * 0.15));
        this.cost[k] = blocked ? Infinity : 1 / this.speed[k];
      }
    }
  }

  cx(i: number): number {
    return -this.half + (i + 0.5) * this.cell;
  }
  cz(j: number): number {
    return -this.half + (j + 0.5) * this.cell;
  }
  ix(x: number): number {
    return Math.min(this.n - 1, Math.max(0, Math.floor((x + this.half) / this.cell)));
  }
  iz(z: number): number {
    return Math.min(this.n - 1, Math.max(0, Math.floor((z + this.half) / this.cell)));
  }
  idx(x: number, z: number): number {
    return this.iz(z) * this.n + this.ix(x);
  }

  passable(x: number, z: number): boolean {
    return this.cost[this.idx(x, z)] !== Infinity;
  }
  speedAt(x: number, z: number): number {
    return this.speed[this.idx(x, z)];
  }
  forestAt(x: number, z: number): number {
    return this.forest[this.idx(x, z)];
  }

  /** 結構物佔地：設為不可走 */
  block(x: number, z: number, r: number): void {
    const i0 = this.ix(x - r);
    const i1 = this.ix(x + r);
    const j0 = this.iz(z - r);
    const j1 = this.iz(z + r);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (Math.hypot(this.cx(i) - x, this.cz(j) - z) <= r) this.cost[j * this.n + i] = Infinity;
      }
  }

  /** 橋：沿橋身打通河面（angle：橋身方向，弧度，0＝沿 Z 軸） */
  openBridge(x: number, z: number, angle: number, length: number): void {
    const steps = Math.ceil(length / 2);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps - 0.5;
      const bx = x + Math.sin(angle) * length * t;
      const bz = z + Math.cos(angle) * length * t;
      for (const off of [-3, 0, 3]) {
        const px = bx + Math.cos(angle) * off;
        const pz = bz - Math.sin(angle) * off;
        const i = this.idx(px, pz);
        this.cost[i] = 1;
        this.speed[i] = 1;
      }
    }
  }

  /** 最近的可走點 */
  nearestPassable(x: number, z: number): [number, number] {
    if (this.passable(x, z)) return [x, z];
    const ci = this.ix(x);
    const cj = this.iz(z);
    for (let r = 1; r < 40; r++) {
      let best: [number, number] | null = null;
      let bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          if (this.cost[j * this.n + i] === Infinity) continue;
          const d = Math.hypot(this.cx(i) - x, this.cz(j) - z);
          if (d < bd) {
            bd = d;
            best = [this.cx(i), this.cz(j)];
          }
        }
      if (best) return best;
    }
    return [x, z];
  }

  /** 直線是否暢通（沿線取樣） */
  lineClear(ax: number, az: number, bx: number, bz: number, maxCost = 1.6): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const c = this.cost[this.idx(ax + (bx - ax) * t, az + (bz - az) * t)];
      if (c === Infinity || c > maxCost) return false;
    }
    return true;
  }

  private heap = new MinHeap();
  private gScore = new Float32Array(0);
  private came = new Int32Array(0);
  private stamp = new Uint32Array(0);
  private closed = new Uint32Array(0);
  private gen = 0;

  /** A*：回傳拉直後的路徑點（不含起點，含終點） */
  findPath(sx: number, sz: number, tx: number, tz: number): [number, number][] {
    [tx, tz] = this.nearestPassable(tx, tz);
    if (this.lineClear(sx, sz, tx, tz, 3)) return [[tx, tz]];
    const n = this.n;
    const nn = n * n;
    if (this.gScore.length !== nn) {
      this.gScore = new Float32Array(nn);
      this.came = new Int32Array(nn);
      this.stamp = new Uint32Array(nn);
      this.closed = new Uint32Array(nn);
    }
    const gen = ++this.gen;
    const [ssx, ssz] = this.nearestPassable(sx, sz);
    const start = this.idx(ssx, ssz);
    const goal = this.idx(tx, tz);
    const gi = goal % n;
    const gj = (goal / n) | 0;
    const h = (k: number) => {
      const dx = Math.abs((k % n) - gi);
      const dz = Math.abs(((k / n) | 0) - gj);
      return (dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz)) * 0.9;
    };
    const heap = this.heap;
    heap.clear();
    this.stamp[start] = gen;
    this.gScore[start] = 0;
    this.came[start] = -1;
    heap.push(start, h(start));
    let found = -1;
    let bestK = start;
    let bestH = h(start);
    let iter = 0;
    while (heap.size > 0 && iter++ < 40000) {
      const k = heap.pop();
      if (this.closed[k] === gen) continue;
      this.closed[k] = gen;
      if (k === goal) {
        found = k;
        break;
      }
      const hk = h(k);
      if (hk < bestH) {
        bestH = hk;
        bestK = k;
      }
      const i = k % n;
      const j = (k / n) | 0;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const nk = nj * n + ni;
          const c = this.cost[nk];
          if (c === Infinity || this.closed[nk] === gen) continue;
          if (di && dj && (this.cost[j * n + ni] === Infinity || this.cost[nj * n + i] === Infinity)) continue;
          const g = this.gScore[k] + c * (di && dj ? Math.SQRT2 : 1);
          if (this.stamp[nk] !== gen || g < this.gScore[nk]) {
            this.stamp[nk] = gen;
            this.gScore[nk] = g;
            this.came[nk] = k;
            heap.push(nk, g + h(nk));
          }
        }
    }
    const end = found >= 0 ? found : bestK;
    const cells: number[] = [];
    for (let k = end; k >= 0; k = this.came[k]) {
      cells.push(k);
      if (k === start) break;
    }
    cells.reverse();
    const pts: [number, number][] = cells.map((k) => [this.cx(k % n), this.cz((k / n) | 0)]);
    if (found >= 0) pts[pts.length - 1] = [tx, tz];
    // 拉直（只避開不可走與極高成本的格子；淺灘、森林照走）
    const out: [number, number][] = [];
    let ax = sx;
    let az = sz;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineClear(ax, az, pts[j][0], pts[j][1], 3)) j--;
      out.push(pts[j]);
      ax = pts[j][0];
      az = pts[j][1];
      i = j + 1;
    }
    // 起點所在格的中心常在身後：丟掉，免得軍團來回擺動
    while (out.length > 1 && Math.hypot(out[0][0] - sx, out[0][1] - sz) < this.cell * 1.5) out.shift();
    return out;
  }
}

class MinHeap {
  private k: number[] = [];
  private p: number[] = [];
  get size(): number {
    return this.k.length;
  }
  clear(): void {
    this.k.length = 0;
    this.p.length = 0;
  }
  push(key: number, pri: number): void {
    const k = this.k;
    const p = this.p;
    let i = k.length;
    k.push(key);
    p.push(pri);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= pri) break;
      k[i] = k[par];
      p[i] = p[par];
      i = par;
    }
    k[i] = key;
    p[i] = pri;
  }
  pop(): number {
    const k = this.k;
    const p = this.p;
    const top = k[0];
    const lk = k.pop()!;
    const lp = p.pop()!;
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        k[i] = k[c];
        p[i] = p[c];
        i = c;
      }
      k[i] = lk;
      p[i] = lp;
    }
    return top;
  }
}
