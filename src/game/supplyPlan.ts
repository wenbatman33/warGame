// 糧道部署（部署階段）：玩家決定糧道走哪裡——三個快捷路線（官道／前線捷徑／後方小路），或拖曳 🍚 標記自訂經過點
// 取捨：路線越短運糧越快（糧道恢復後越快送到本陣）；越靠前線，補給範圍延伸越前面（弓兵可在糧道旁補箭），但越容易被切斷
import type { Structure } from '../sim/structures';
import { densify, type World } from '../sim/world';

export type RoutePreset = 'road' | 'front' | 'rear';

export const ROUTE_PRESETS: Record<RoutePreset, { name: string; desc: string }> = {
  road: { name: '官道', desc: '沿道路走：速度與安全都中等' },
  front: { name: '前線捷徑', desc: '貼近前線：補給範圍延伸到前線、弓兵在糧道旁可補箭，但容易被敵軍切斷' },
  rear: { name: '後方小路', desc: '繞到己方後方：最安全，但路長、糧道恢復後糧食送到得慢' },
};

export interface RouteStats {
  len: number;
  /** 糧道恢復後糧食送到本陣的秒數 */
  transit: number;
  /** 被切風險 0..1 與文字 */
  risk: number;
  riskText: '低' | '中' | '高';
  /** 補給延伸：糧道最前端離本陣往前推了多少公尺 */
  reach: number;
}

/** 玩家可以部署糧道的補給來源（糧倉，不含水源與營寨） */
export function plannable(w: World, team = w.player): Structure[] {
  const t = w.teams[team];
  if (!t.hq) return [];
  return w.supplySources(t).filter((s) => s.kind === 'depot' && s.route.length > 1);
}

/** 敵軍方向（由己方本陣指向敵方） */
function enemyDir(w: World, team: number): [number, number] {
  const [hx, hz] = w.homeDir[team] ?? [0, 1];
  return [-hx, -hz];
}

/** 經過點是否合法：可通行、在可遊玩區、在己方這一側 */
function validVia(w: World, team: number, x: number, z: number): boolean {
  const hq = w.teams[team].hq!;
  const ehq = w.teams[1 - team]?.hq;
  if (!w.hf.inPlay(x, z, 20) || !w.nav.passable(x, z)) return false;
  if (ehq && Math.hypot(x - hq.x, z - hq.z) > Math.hypot(x - ehq.x, z - ehq.z) - 30) return false;
  return true;
}

/** 把經過點拉回合法範圍：沿著「本陣 → 目標點」往回找 */
function clampVia(w: World, team: number, x: number, z: number): [number, number] {
  if (validVia(w, team, x, z)) return [x, z];
  const hq = w.teams[team].hq!;
  for (let k = 0.9; k > 0; k -= 0.1) {
    const qx = hq.x + (x - hq.x) * k;
    const qz = hq.z + (z - hq.z) * k;
    if (validVia(w, team, qx, qz)) return [qx, qz];
  }
  return [hq.x, hq.z];
}

/** 經過指定點的糧道路線 */
function routeVia(w: World, st: Structure, vx: number, vz: number): [number, number][] {
  const hq = w.teams[st.team].hq!;
  const a = w.nav.findPath(st.x, st.z, vx, vz);
  const b = w.nav.findPath(vx, vz, hq.x, hq.z);
  return densify([[st.x, st.z], ...a, [vx, vz], ...b, [hq.x, hq.z]], 6);
}

/** 快捷路線的經過點 */
export function presetVia(w: World, st: Structure, p: RoutePreset): [number, number] | null {
  if (p === 'road') return null;
  const hq = w.teams[st.team].hq!;
  const [ex, ez] = enemyDir(w, st.team);
  const mx = (st.x + hq.x) / 2;
  const mz = (st.z + hq.z) / 2;
  const len = Math.hypot(st.x - hq.x, st.z - hq.z);
  const off = Math.max(70, len * 0.45);
  const s = p === 'front' ? 1 : -1;
  return clampVia(w, st.team, mx + ex * off * s, mz + ez * off * s);
}

/** 套用路線：via＝null 走官道 */
export function applyVia(w: World, st: Structure, via: [number, number] | null): void {
  const hq = w.teams[st.team].hq!;
  if (!via) {
    st.via = null;
    w.setRoute(st, densify([[st.x, st.z], ...w.nav.findPath(st.x, st.z, hq.x, hq.z), [hq.x, hq.z]], 6));
    return;
  }
  const [x, z] = clampVia(w, st.team, via[0], via[1]);
  st.via = [x, z];
  w.setRoute(st, routeVia(w, st, x, z));
}

/** 拖曳標記到某點 */
export function dragVia(w: World, st: Structure, x: number, z: number): void {
  applyVia(w, st, [x, z]);
}

/** 目前路線最接近哪個快捷選項（按鈕高亮用） */
export function currentPreset(w: World, st: Structure): RoutePreset | null {
  if (!st.via) return 'road';
  for (const p of ['front', 'rear'] as RoutePreset[]) {
    const v = presetVia(w, st, p);
    if (v && Math.hypot(v[0] - st.via[0], v[1] - st.via[1]) < 6) return p;
  }
  return null;
}

/** 路線數據：長度、運糧時間、被切風險（離敵軍近、經過森林）、補給延伸 */
export function routeStats(w: World, st: Structure): RouteStats {
  const r = st.route;
  let len = 0;
  for (let k = 1; k < r.length; k++) len += Math.hypot(r[k][0] - r[k - 1][0], r[k][1] - r[k - 1][1]);
  const foes = w.regs.filter((e) => e.team !== st.team && !e.gone);
  const hq = w.teams[st.team].hq!;
  const [ex, ez] = enemyDir(w, st.team);
  let risk = 0;
  let reach = 0;
  for (const [x, z] of r) {
    let d = 400;
    for (const e of foes) d = Math.min(d, Math.hypot(e.mx - x, e.mz - z));
    risk += Math.max(0, 1 - d / 260) + (w.nav.forestAt(x, z) > 0.45 ? 0.25 : 0);
    reach = Math.max(reach, (x - hq.x) * ex + (z - hq.z) * ez);
  }
  risk /= Math.max(1, r.length);
  return { len, transit: st.transit, risk, riskText: risk < 0.16 ? '低' : risk < 0.3 ? '中' : '高', reach };
}
