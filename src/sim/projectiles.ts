// 箭矢（SoA）：拋物線投射物，落地時才判定命中
export class Projectiles {
  readonly cap: number;
  readonly active: Uint8Array;
  readonly sx: Float32Array;
  readonly sy: Float32Array;
  readonly sz: Float32Array;
  readonly tx: Float32Array;
  readonly ty: Float32Array;
  readonly tz: Float32Array;
  readonly t0: Float32Array;
  readonly dur: Float32Array;
  readonly arc: Float32Array;
  readonly team: Uint8Array;
  readonly dmg: Float32Array;
  readonly ap: Float32Array;
  readonly fire: Uint8Array;
  readonly reg: Int32Array;
  private next = 0;

  constructor(cap: number) {
    this.cap = cap;
    this.active = new Uint8Array(cap);
    this.sx = new Float32Array(cap);
    this.sy = new Float32Array(cap);
    this.sz = new Float32Array(cap);
    this.tx = new Float32Array(cap);
    this.ty = new Float32Array(cap);
    this.tz = new Float32Array(cap);
    this.t0 = new Float32Array(cap);
    this.dur = new Float32Array(cap);
    this.arc = new Float32Array(cap);
    this.team = new Uint8Array(cap);
    this.dmg = new Float32Array(cap);
    this.ap = new Float32Array(cap);
    this.fire = new Uint8Array(cap);
    this.reg = new Int32Array(cap);
  }

  spawn(sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, t0: number, dur: number, arc: number, team: number, dmg: number, ap: number, fire: boolean, reg: number): number {
    for (let n = 0; n < this.cap; n++) {
      const k = (this.next + n) % this.cap;
      if (this.active[k]) continue;
      this.next = (k + 1) % this.cap;
      this.active[k] = 1;
      this.sx[k] = sx;
      this.sy[k] = sy;
      this.sz[k] = sz;
      this.tx[k] = tx;
      this.ty[k] = ty;
      this.tz[k] = tz;
      this.t0[k] = t0;
      this.dur[k] = dur;
      this.arc[k] = arc;
      this.team[k] = team;
      this.dmg[k] = dmg;
      this.ap[k] = ap;
      this.fire[k] = fire ? 1 : 0;
      this.reg[k] = reg;
      return k;
    }
    return -1;
  }

  /** 時間 t 的位置與切線（渲染用） */
  at(k: number, t: number, out: Float32Array): void {
    const u = Math.min(1, Math.max(0, (t - this.t0[k]) / this.dur[k]));
    const x = this.sx[k] + (this.tx[k] - this.sx[k]) * u;
    const z = this.sz[k] + (this.tz[k] - this.sz[k]) * u;
    const y = this.sy[k] + (this.ty[k] - this.sy[k]) * u + this.arc[k] * 4 * u * (1 - u);
    const dx = this.tx[k] - this.sx[k];
    const dz = this.tz[k] - this.sz[k];
    const dy = this.ty[k] - this.sy[k] + this.arc[k] * 4 * (1 - 2 * u);
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = dx;
    out[4] = dy;
    out[5] = dz;
  }
}
