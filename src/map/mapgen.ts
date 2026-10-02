// 劇本地圖產生器：依參數（丘陵、山脊、河流、淺灘、道路、森林）產生高度場
import { clamp, distToPolyline, fbm, lerp, smoothstep } from '../util/rng';
import { Heightfield, WATER_LEVEL } from './heightfield';

export type Pt = readonly [number, number];

export interface MapSpec {
  /** 可遊玩區域邊長（m） */
  play: number;
  /** 外圍邊框寬（m），會長成山與森林 */
  border?: number;
  seed: number;
  /** 平地基準高度 */
  base?: number;
  /** 起伏噪聲 */
  noiseAmp?: number;
  noiseScale?: number;
  /** 丘陵：plateau=true 為平頂台地（好佈陣） */
  hills?: { x: number; z: number; r: number; h: number; plateau?: boolean }[];
  /** 山脊／山嶺：沿折線隆起 */
  ridges?: { pts: Pt[]; w: number; h: number }[];
  /** 河流：寬度、深度；fords 為淺灘位置（沿線 0..1）與寬度 */
  rivers?: { pts: Pt[]; w: number; depth?: number; fords?: { t: number; w: number }[] }[];
  /** 湖／池 */
  lakes?: { x: number; z: number; r: number }[];
  /** 道路 */
  roads?: { pts: Pt[]; w: number }[];
  /** 森林：圓形區域，density 0..1 */
  forests?: { x: number; z: number; r: number; density?: number }[];
  /** 不長樹的區域（營地、部署區） */
  clearings?: { x: number; z: number; r: number }[];
  /** 邊框是否長成山（預設 true） */
  borderMountains?: boolean;
}

export function generateHeightfield(spec: MapSpec): Heightfield {
  const border = spec.border ?? 110;
  const size = spec.play + border * 2;
  const res = 2;
  const hf = new Heightfield(size, spec.play, res);
  const n = hf.n;
  const base = spec.base ?? 3;
  const amp = spec.noiseAmp ?? 1.6;
  const sc = spec.noiseScale ?? 140;
  const seed = spec.seed;
  const half = spec.play / 2;
  const rivers = spec.rivers ?? [];
  const riverLens = rivers.map((rv) => polyLen(rv.pts));
  const roads = spec.roads ?? [];

  for (let j = 0; j < n; j++) {
    const z = hf.vx(j);
    for (let i = 0; i < n; i++) {
      const x = hf.vx(i);
      const k = j * n + i;
      let h = base + fbm(x / sc, z / sc, seed, 4) * amp + fbm(x / 22, z / 22, seed + 99, 2) * 0.25;

      // 丘陵
      for (const hl of spec.hills ?? []) {
        const d = Math.hypot(x - hl.x, z - hl.z);
        if (d > hl.r * 1.6) continue;
        const wob = 1 + fbm(x / 40, z / 40, seed + 7, 2) * 0.18;
        if (hl.plateau) h += hl.h * smoothstep(hl.r * wob, hl.r * 0.55 * wob, d);
        else h += hl.h * Math.exp(-((d / (hl.r * wob)) ** 2) * 2.2);
      }
      // 山脊
      for (const rg of spec.ridges ?? []) {
        const { d } = distToPolyline(x, z, rg.pts);
        if (d > rg.w * 1.5) continue;
        const wob = 1 + fbm(x / 30, z / 30, seed + 13, 3) * 0.3;
        h += rg.h * wob * Math.exp(-((d / rg.w) ** 2) * 2.5);
      }
      // 外圍山地（讓戰場像一塊沙盤）
      if (spec.borderMountains !== false) {
        const edge = Math.max(Math.abs(x), Math.abs(z));
        const m = smoothstep(half - 10, half + border * 0.8, edge);
        if (m > 0) h += m * (26 + fbm(x / 60, z / 60, seed + 31, 3) * 16);
      }

      // 道路：微微壓平
      let road = 0;
      for (const rd of roads) {
        const { d } = distToPolyline(x, z, rd.pts);
        const wob = fbm(x / 9, z / 9, seed + 5, 2) * 0.8;
        road = Math.max(road, smoothstep(rd.w / 2 + 1.2 + wob, rd.w / 2 - 0.8 + wob, d));
      }
      if (road > 0) h -= road * 0.15;

      // 河流：挖出河床，淺灘處河床抬高
      let mud = 0;
      let ford = 0;
      for (let ri = 0; ri < rivers.length; ri++) {
        const rv = rivers[ri];
        const { d, t } = distToPolyline(x, z, rv.pts);
        const hw = rv.w / 2;
        const bank = 9;
        if (d > hw + bank + 6) continue;
        let fordAmt = 0;
        for (const f of rv.fords ?? []) {
          const dt = Math.abs(t - f.t) * riverLens[ri];
          fordAmt = Math.max(fordAmt, smoothstep(f.w / 2 + 6, f.w / 2 - 2, dt));
        }
        const bed = lerp(WATER_LEVEL - (rv.depth ?? 2.2), WATER_LEVEL - 0.35, fordAmt);
        const cut = smoothstep(hw + bank, hw * 0.5, d);
        h = lerp(h, Math.min(h, bed), cut);
        mud = Math.max(mud, smoothstep(hw + bank + 5, hw, d));
        if (d < hw + 2) ford = Math.max(ford, fordAmt);
      }
      for (const lk of spec.lakes ?? []) {
        const d = Math.hypot(x - lk.x, z - lk.z);
        const wob = 1 + fbm(x / 25, z / 25, seed + 3, 2) * 0.2;
        const cut = smoothstep(lk.r * wob + 8, lk.r * wob * 0.6, d);
        h = lerp(h, Math.min(h, WATER_LEVEL - 2), cut);
        mud = Math.max(mud, smoothstep(lk.r * wob + 12, lk.r * wob, d));
      }

      hf.h[k] = h;
      hf.road[k] = road;
      hf.mud[k] = mud;
      hf.ford[k] = ford;
    }
  }

  // 森林遮罩（帶噪聲邊緣）
  for (let j = 0; j < n; j++) {
    const z = hf.vx(j);
    for (let i = 0; i < n; i++) {
      const x = hf.vx(i);
      const k = j * n + i;
      let f = 0;
      for (const fo of spec.forests ?? []) {
        const d = Math.hypot(x - fo.x, z - fo.z);
        const wob = fbm(x / 26, z / 26, seed + 41, 3) * fo.r * 0.35;
        f = Math.max(f, smoothstep(fo.r + wob, fo.r * 0.7 + wob, d) * (fo.density ?? 1));
      }
      // 外圍邊框長滿樹
      const edge = Math.max(Math.abs(x), Math.abs(z));
      f = Math.max(f, smoothstep(half - 6, half + 20, edge) * 0.9);
      for (const c of spec.clearings ?? []) {
        const d = Math.hypot(x - c.x, z - c.z);
        f *= smoothstep(c.r * 0.8, c.r + 8, d);
      }
      // 水裡、道路上不長樹
      f *= 1 - hf.road[k];
      if (hf.h[k] < WATER_LEVEL + 0.6) f = 0;
      hf.forest[k] = clamp(f, 0, 1);
    }
  }
  return hf;
}

function polyLen(pts: readonly Pt[]): number {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return l;
}
