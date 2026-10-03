// 軍團：玩家下令的最小單位；陣型計算、狀態與士氣欄位
import type { FactionId } from '../data/factions';
import type { GeneralId } from '../data/generals';
import type { UnitDef, UnitTypeId } from '../data/units';

export type Formation = 'line' | 'square' | 'wedge' | 'loose';
export type OrderType = 'idle' | 'move' | 'attack' | 'retreat';
export type RegState = 'ready' | 'moving' | 'engaged' | 'routing' | 'shattered' | 'destroyed';
export type AiRole = 'line' | 'ranged' | 'flank' | 'reserve' | 'guard' | 'raider' | 'hold';

export interface Order {
  type: OrderType;
  x: number;
  z: number;
  facing: number;
  /** 攻擊目標軍團 id，或 -1 */
  target: number;
  /** 攻擊目標建築 id，或 -1 */
  struct: number;
}

export interface Buff {
  id: string;
  until: number;
  atk?: number;
  def?: number;
  speed?: number;
  /** 期間士氣不下降 */
  steady?: boolean;
  /** 期間不耗體力 */
  tireless?: boolean;
}

export interface GeneralState {
  id: GeneralId;
  name: string;
  soldier: number;
  alive: boolean;
  /** 逃出戰場（不是陣亡） */
  fled?: boolean;
  cd: number;
}

export class Regiment {
  readonly id: number;
  team: number;
  faction: FactionId;
  readonly unit: UnitDef;
  readonly type: UnitTypeId;
  name: string;
  general: GeneralState | null = null;
  members: number[] = [];
  initial = 0;
  formation: Formation = 'line';
  width: number;
  cx = 0;
  cz = 0;
  facing = 0;
  /** 士兵質心（每步更新） */
  mx = 0;
  mz = 0;
  /** 陣列半徑 */
  radius = 10;
  path: [number, number][] = [];
  pathI = 0;
  /** 上次尋路請求的目標點 */
  pathGoalX = Infinity;
  pathGoalZ = Infinity;
  /** 有傷亡、待補位 */
  needReslot = false;
  order: Order = { type: 'idle', x: 0, z: 0, facing: 0, target: -1, struct: -1 };
  run = false;
  hold = false;
  fireAtWill = true;
  fireArrows = false;
  morale = 70;
  baseMorale = 70;
  stamina = 100;
  state: RegState = 'ready';
  routs = 0;
  routT = 0;
  calmT = 0;
  /** 最近傷亡（時間戳） */
  losses: number[] = [];
  lostThisTick = 0;
  /** 本秒受到的側擊／背襲次數 */
  flankHits = 0;
  rearHits = 0;
  arrowsTaken = 0;
  chargeShockT = -99;
  /** 上次喊衝鋒（號角）的時間 */
  chargeCallT = -99;
  lastCombatT = -99;
  lastFireT = -99;
  /** 正在射擊的目標 */
  fireTarget = -1;
  /** 交戰中的敵軍團 */
  engagedWith = new Set<number>();
  /** 附近的敵軍團（0.5 秒更新） */
  nearEnemies: number[] = [];
  buffs: Buff[] = [];
  /** 對手是否看得見（team 1 對 team 0 的可見性） */
  visible = true;
  hidden = false;
  spottedT = 0;
  repathT = 0;
  cohesion = 1;
  /** 已逃出戰場人數 */
  fled = 0;
  /** 戰功：斬敵數 */
  kills = 0;
  /** 在己方本陣補給範圍內（補箭、體力回復加快） */
  inSupply = false;
  /** 深入敵境、遠離己方糧道的累積秒數（遠征斷糧） */
  outT = 0;
  /** 撤退中的武將（單人隊伍，回到本陣即離場） */
  retreatHome = false;
  ai: { role: AiRole; anchorX: number; anchorZ: number; waitUntil: number; homeX: number; homeZ: number; targetT: number } = {
    role: 'line',
    anchorX: 0,
    anchorZ: 0,
    waitUntil: 0,
    homeX: 0,
    homeZ: 0,
    targetT: 0,
  };
  /** 目前所處地形（0.5 秒更新） */
  terrain = { height: 0, relHeight: 0, high: false, forest: false, wet: false, camp: false, road: false };
  /** 部署階段不能移動（例：長坂坡的趙雲在敵陣中） */
  fixed = false;
  /** 10 秒內重大傷亡的驚嚇已觸發 */
  flagsHeavy = false;
  /** 由 DEV 或劇本設定：武將不會撤退 */
  unbreakable = false;

  constructor(id: number, team: number, faction: FactionId, unit: UnitDef, name: string) {
    this.id = id;
    this.team = team;
    this.faction = faction;
    this.unit = unit;
    this.type = unit.id;
    this.name = name;
    this.width = unit.width;
    this.baseMorale = unit.morale;
    this.morale = unit.morale;
  }

  get alive(): number {
    return this.members.length;
  }

  get routing(): boolean {
    return this.state === 'routing' || this.state === 'shattered';
  }

  get gone(): boolean {
    return this.state === 'destroyed' || this.state === 'shattered' || this.members.length === 0;
  }

  get wavering(): boolean {
    return !this.routing && this.morale < 35;
  }

  get ranged(): boolean {
    return !!this.unit.ranged;
  }

  buffMul(key: 'atk' | 'def' | 'speed', now: number): number {
    let m = 1;
    for (const b of this.buffs) if (b.until > now && b[key] !== undefined) m *= b[key]!;
    return m;
  }

  hasBuff(flag: 'steady' | 'tireless', now: number): boolean {
    for (const b of this.buffs) if (b.until > now && b[flag]) return true;
    return false;
  }

  /** 陣型間距倍率 */
  spacingMul(): number {
    return this.formation === 'loose' ? 1.8 : 1;
  }

  /** 依目前人數與寬度：陣位 i 的區域座標（+Z 為前方） */
  slotLocal(i: number, n: number, out: [number, number]): [number, number] {
    const [sx0, sz0] = this.unit.spacing;
    const k = this.spacingMul();
    const sx = sx0 * k;
    const sz = sz0 * k;
    if (this.formation === 'wedge') {
      // 鋒矢：第 r 排有 2r+1 人
      let r = 0;
      let acc = 0;
      while (acc + (2 * r + 1) <= i) {
        acc += 2 * r + 1;
        r++;
      }
      const c = i - acc - r;
      out[0] = c * sx;
      out[1] = -r * sz + this.depth(n) / 2;
      return out;
    }
    const w = this.formation === 'square' ? Math.max(2, Math.ceil(Math.sqrt(n))) : Math.max(1, Math.min(this.width, n));
    const rows = Math.ceil(n / w);
    const row = Math.floor(i / w);
    const col = i % w;
    const inRow = row === rows - 1 ? n - row * w : w;
    out[0] = (col - (inRow - 1) / 2) * sx;
    out[1] = ((rows - 1) / 2 - row) * sz;
    return out;
  }

  /** 陣列深度（m） */
  depth(n = this.members.length): number {
    const sz = this.unit.spacing[1] * this.spacingMul();
    if (this.formation === 'wedge') {
      let r = 0;
      let acc = 0;
      while (acc < n) {
        acc += 2 * r + 1;
        r++;
      }
      return r * sz;
    }
    const w = this.formation === 'square' ? Math.max(2, Math.ceil(Math.sqrt(n))) : Math.max(1, Math.min(this.width, n));
    return Math.ceil(n / w) * sz;
  }

  /** 陣列寬度（m） */
  frontage(n = this.members.length): number {
    const sx = this.unit.spacing[0] * this.spacingMul();
    if (this.formation === 'wedge') return (this.depth(n) / (this.unit.spacing[1] * this.spacingMul())) * 2 * sx;
    const w = this.formation === 'square' ? Math.max(2, Math.ceil(Math.sqrt(n))) : Math.max(1, Math.min(this.width, n));
    return w * sx;
  }

  /** 陣位的世界座標 */
  slotWorld(i: number, n: number, out: [number, number], ax = this.cx, az = this.cz, facing = this.facing): [number, number] {
    this.slotLocal(i, n, out);
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    const lx = out[0];
    const lz = out[1];
    // 區域 +Z 對齊 facing 方向 (sin f, cos f)；區域 +X 對齊 (cos f, -sin f)
    out[0] = ax + lx * c + lz * s;
    out[1] = az - lx * s + lz * c;
    return out;
  }
}
