// 陣法：把多個軍團一次排成經典陣形（一字長蛇、鶴翼、鋒矢、方圓）
import type { Regiment } from '../sim/regiment';
import type { World } from '../sim/world';

export type ArmyFormation = 'snake' | 'crane' | 'arrow' | 'circle';

export const ARMY_FORMATIONS: Record<ArmyFormation, { name: string; desc: string }> = {
  snake: { name: '一字長蛇陣', desc: '步兵一字排開、弓弩在後、騎兵護兩翼、武將居後——穩紮穩打' },
  crane: { name: '鶴翼陣', desc: '兩翼向前張開包抄，騎兵在翼端——適合以多打少、包圍敵軍' },
  arrow: { name: '鋒矢陣', desc: '精銳在箭頭、兩翼斜後跟進——集中突破敵陣一點' },
  circle: { name: '方圓陣', desc: '步兵圍成一圈向外、弓弩與武將在內——被包圍時死守' },
};

export interface Placement {
  id: number;
  x: number;
  z: number;
  facing: number;
  width?: number;
}

function kind(r: Regiment): 'inf' | 'ranged' | 'cav' | 'gen' {
  if (r.general) return 'gen';
  if (r.unit.ranged && !r.unit.mounted) return 'ranged';
  if (r.unit.mounted) return 'cav';
  return 'inf';
}

/** 計算陣法位置：以選取軍團的重心為中心，面向 facing */
export function planArmyFormation(w: World, ids: number[], f: ArmyFormation, facing?: number): Placement[] {
  const regs = ids.map((id) => w.regs[id]).filter((r) => r && !r.gone && !r.routing);
  if (regs.length === 0) return [];
  const cx = regs.reduce((a, r) => a + r.mx, 0) / regs.length;
  const cz = regs.reduce((a, r) => a + r.mz, 0) / regs.length;
  // 預設面向最近的敵軍重心
  if (facing === undefined) {
    // 只看最近的 5 團敵軍（遠方的守倉部隊不算）
    const en = w.regs
      .filter((r) => r.team !== regs[0].team && !r.gone && !r.routing && w.isVisibleTo(r, regs[0].team))
      .sort((a, b) => Math.hypot(a.mx - cx, a.mz - cz) - Math.hypot(b.mx - cx, b.mz - cz))
      .slice(0, 5);
    if (en.length) {
      const ex = en.reduce((a, r) => a + r.mx, 0) / en.length;
      const ez = en.reduce((a, r) => a + r.mz, 0) / en.length;
      facing = Math.atan2(ex - cx, ez - cz);
    } else facing = regs.reduce((a, r) => a + r.facing, 0) / regs.length;
  }
  const c = Math.cos(facing);
  const s = Math.sin(facing);
  // 區域座標（lx 右、lz 前）→ 世界
  const toWorld = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
  const groups = { inf: [] as Regiment[], ranged: [] as Regiment[], cav: [] as Regiment[], gen: [] as Regiment[] };
  for (const r of regs) groups[kind(r)].push(r);
  // 依目前左右位置排序，減少交叉
  const lxOf = (r: Regiment) => (r.mx - cx) * c - (r.mz - cz) * s;
  for (const g of Object.values(groups)) g.sort((a, b) => lxOf(a) - lxOf(b));
  const out: Placement[] = [];
  const front = (r: Regiment) => r.unit.width * r.unit.spacing[0];
  const gap = 4;
  const rowOf = (list: Regiment[], lz: number, curve = 0, faceOut = false) => {
    const total = list.reduce((a, r) => a + front(r), 0) + gap * Math.max(0, list.length - 1);
    let x = -total / 2;
    for (const r of list) {
      const w0 = front(r);
      const lx = x + w0 / 2;
      const lzz = lz + curve * Math.abs(lx) / Math.max(1, total / 2);
      const [wx, wz] = toWorld(lx, lzz);
      const fa = faceOut ? Math.atan2(wx - cx, wz - cz) : facing! + (curve !== 0 ? Math.sign(lx) * -Math.atan2(curve, total / 2) * 0.6 : 0);
      out.push({ id: r.id, x: wx, z: wz, facing: fa, width: r.unit.width });
      x += w0 + gap;
    }
    return total;
  };
  switch (f) {
    case 'snake': {
      const tw = rowOf(groups.inf, 0);
      rowOf(groups.ranged, -24);
      const cav = groups.cav;
      cav.forEach((r, k) => {
        const side = k % 2 ? 1 : -1;
        const [x, z] = toWorld(side * (tw / 2 + 20 + Math.floor(k / 2) * 30), 0);
        out.push({ id: r.id, x, z, facing: facing!, width: r.unit.width });
      });
      rowOf(groups.gen, -48);
      break;
    }
    case 'crane': {
      // 中央步兵，兩翼前彎；騎兵在翼端更前方
      const tw = rowOf(groups.inf, 0, 26);
      rowOf(groups.ranged, -22);
      groups.cav.forEach((r, k) => {
        const side = k % 2 ? 1 : -1;
        const [x, z] = toWorld(side * (tw / 2 + 18 + Math.floor(k / 2) * 26), 40 + Math.floor(k / 2) * 10);
        out.push({ id: r.id, x, z, facing: facing! - side * 0.35, width: r.unit.width });
      });
      rowOf(groups.gen, -44);
      break;
    }
    case 'arrow': {
      // 箭頭：最前一團，兩側依序斜後退
      const list = [...groups.inf];
      list.sort((a, b) => b.unit.atk + b.unit.def - (a.unit.atk + a.unit.def));
      list.forEach((r, k) => {
        const rank = Math.ceil(k / 2);
        const side = k === 0 ? 0 : k % 2 ? 1 : -1;
        const [x, z] = toWorld(side * rank * (front(r) * 0.8 + gap), -rank * 16);
        out.push({ id: r.id, x, z, facing: facing!, width: r.unit.width });
      });
      rowOf(groups.ranged, -16 * (Math.ceil(list.length / 2) + 1));
      groups.cav.forEach((r, k) => {
        const side = k % 2 ? 1 : -1;
        const [x, z] = toWorld(side * (30 + Math.floor(k / 2) * 26), -30);
        out.push({ id: r.id, x, z, facing: facing!, width: r.unit.width });
      });
      rowOf(groups.gen, -24);
      break;
    }
    case 'circle': {
      // 步兵圍成一圈面向外；其他在圈內
      const ring = groups.inf;
      const per = ring.reduce((a, r) => a + front(r), 0);
      const R = Math.max(25, per / (Math.PI * 2) + 6);
      ring.forEach((r, k) => {
        const a = facing! + (k / ring.length) * Math.PI * 2;
        const x = cx + Math.sin(a) * R;
        const z = cz + Math.cos(a) * R;
        out.push({ id: r.id, x, z, facing: a, width: Math.max(4, Math.round(((2 * Math.PI * R) / Math.max(1, ring.length)) / r.unit.spacing[0]) - 2) });
      });
      const inner = [...groups.ranged, ...groups.gen, ...groups.cav];
      inner.forEach((r, k) => {
        const a = facing! + (k / Math.max(1, inner.length)) * Math.PI * 2;
        const rr = inner.length > 1 ? R * 0.4 : 0;
        out.push({ id: r.id, x: cx + Math.sin(a) * rr, z: cz + Math.cos(a) * rr, facing: facing!, width: Math.min(r.unit.width, 12) });
      });
      break;
    }
  }
  return out;
}
