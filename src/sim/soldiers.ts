// 士兵結構陣列（SoA）：數千名士兵的狀態放在 TypedArray，模擬與渲染直接讀
import type { AnimName } from '../models/rig';
import { ANIM_ORDER } from '../models/rig';

export const SState = {
  Alive: 0,
  Dying: 1,
  Dead: 2,
  Gone: 3, // 逃出戰場
} as const;

export const ANIM_ID: Record<AnimName, number> = Object.fromEntries(ANIM_ORDER.map((a, i) => [a, i])) as Record<AnimName, number>;

export class Soldiers {
  readonly cap: number;
  count = 0;
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly px: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  readonly yaw: Float32Array;
  readonly pyaw: Float32Array;
  readonly hp: Float32Array;
  readonly maxHp: Float32Array;
  readonly reg: Int32Array;
  readonly slot: Int32Array;
  readonly team: Uint8Array;
  readonly state: Uint8Array;
  readonly anim: Uint8Array;
  readonly animStart: Float32Array;
  readonly animSpeed: Float32Array;
  readonly target: Int32Array;
  readonly cd: Float32Array;
  readonly reload: Float32Array;
  readonly ammo: Int16Array;
  readonly tint: Float32Array;
  readonly stun: Float32Array;
  readonly deathT: Float32Array;
  readonly model: Uint8Array;
  readonly general: Uint8Array;
  /** 衝鋒命中冷卻（同一名騎兵不會連續撞） */
  readonly chargeCd: Float32Array;
  /** 本步是否處於肉搏 */
  readonly fighting: Uint8Array;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.px = new Float32Array(cap);
    this.pz = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.yaw = new Float32Array(cap);
    this.pyaw = new Float32Array(cap);
    this.hp = new Float32Array(cap);
    this.maxHp = new Float32Array(cap);
    this.reg = new Int32Array(cap);
    this.slot = new Int32Array(cap);
    this.team = new Uint8Array(cap);
    this.state = new Uint8Array(cap);
    this.anim = new Uint8Array(cap);
    this.animStart = new Float32Array(cap);
    this.animSpeed = new Float32Array(cap).fill(1);
    this.target = new Int32Array(cap).fill(-1);
    this.cd = new Float32Array(cap);
    this.reload = new Float32Array(cap);
    this.ammo = new Int16Array(cap);
    this.tint = new Float32Array(cap);
    this.stun = new Float32Array(cap);
    this.deathT = new Float32Array(cap);
    this.model = new Uint8Array(cap);
    this.general = new Uint8Array(cap);
    this.chargeCd = new Float32Array(cap);
    this.fighting = new Uint8Array(cap);
  }

  add(): number {
    if (this.count >= this.cap) throw new Error('士兵容量不足');
    return this.count++;
  }

  /** 切換動作；restart=true 時從 start 開始播（攻擊、射擊對齊用） */
  setAnim(i: number, a: AnimName, t: number, speed = 1, restart = false, start = t): void {
    const id = ANIM_ID[a];
    if (this.anim[i] === id && !restart && Math.abs(this.animSpeed[i] - speed) < 0.15) return;
    this.anim[i] = id;
    this.animStart[i] = restart ? start : t - Math.random() * 2;
    this.animSpeed[i] = speed;
  }
}

/** 空間雜湊：4 m 一格的計數排序，每步重建 */
export class SpatialHash {
  readonly cell = 4;
  readonly n: number;
  readonly half: number;
  readonly start: Int32Array;
  readonly cnt: Int32Array;
  items: Int32Array;

  constructor(worldSize: number, cap: number) {
    this.half = worldSize / 2;
    this.n = Math.ceil(worldSize / this.cell);
    this.start = new Int32Array(this.n * this.n + 1);
    this.cnt = new Int32Array(this.n * this.n);
    this.items = new Int32Array(cap);
  }

  key(x: number, z: number): number {
    let i = Math.floor((x + this.half) / this.cell);
    let j = Math.floor((z + this.half) / this.cell);
    i = i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
    j = j < 0 ? 0 : j >= this.n ? this.n - 1 : j;
    return j * this.n + i;
  }

  private keys = new Int32Array(0);
  private fill = new Int32Array(0);

  rebuild(s: Soldiers): void {
    const cnt = this.cnt;
    cnt.fill(0);
    if (this.keys.length < s.cap) this.keys = new Int32Array(s.cap);
    const keys = this.keys;
    for (let i = 0; i < s.count; i++) {
      if (s.state[i] !== SState.Alive) {
        keys[i] = -1;
        continue;
      }
      const k = this.key(s.x[i], s.z[i]);
      keys[i] = k;
      cnt[k]++;
    }
    let acc = 0;
    for (let k = 0; k < cnt.length; k++) {
      this.start[k] = acc;
      acc += cnt[k];
    }
    this.start[cnt.length] = acc;
    if (this.fill.length !== cnt.length) this.fill = new Int32Array(cnt.length);
    const fill = this.fill;
    fill.fill(0);
    if (this.items.length < s.count) this.items = new Int32Array(s.cap);
    for (let i = 0; i < s.count; i++) {
      const k = keys[i];
      if (k < 0) continue;
      this.items[this.start[k] + fill[k]++] = i;
    }
  }

  /** 查詢結果暫存（near() 填入） */
  res = new Int32Array(4096);

  /** 半徑 r 方框內的士兵填進 res，回傳數量（呼叫端自行判斷距離） */
  near(x: number, z: number, r: number): number {
    const i0 = Math.max(0, Math.floor((x - r + this.half) / this.cell));
    const i1 = Math.min(this.n - 1, Math.floor((x + r + this.half) / this.cell));
    const j0 = Math.max(0, Math.floor((z - r + this.half) / this.cell));
    const j1 = Math.min(this.n - 1, Math.floor((z + r + this.half) / this.cell));
    let c = 0;
    const res = this.res;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.n + i;
        const e = this.start[k + 1];
        for (let p = this.start[k]; p < e && c < res.length; p++) res[c++] = this.items[p];
      }
    }
    return c;
  }

  /** 對半徑 r 內的每個士兵呼叫 fn（回傳 true 提早結束） */
  query(x: number, z: number, r: number, fn: (i: number) => boolean | void): void {
    const i0 = Math.max(0, Math.floor((x - r + this.half) / this.cell));
    const i1 = Math.min(this.n - 1, Math.floor((x + r + this.half) / this.cell));
    const j0 = Math.max(0, Math.floor((z - r + this.half) / this.cell));
    const j1 = Math.min(this.n - 1, Math.floor((z + r + this.half) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.n + i;
        const e = this.start[k + 1];
        for (let p = this.start[k]; p < e; p++) if (fn(this.items[p])) return;
      }
    }
  }
}
