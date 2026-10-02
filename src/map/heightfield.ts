// 高度場：地形高度、地表類型遮罩（道路／森林／泥灘），模擬與渲染共用
export const WATER_LEVEL = 0;

export class Heightfield {
  /** 地形總邊長（含外圍邊框），以原點為中心 */
  readonly size: number;
  /** 可遊玩區域邊長（中心正方形） */
  readonly play: number;
  /** 格距（m） */
  readonly res: number;
  /** 每邊頂點數 */
  readonly n: number;
  readonly h: Float32Array;
  readonly road: Float32Array;
  readonly forest: Float32Array;
  readonly mud: Float32Array;
  /** 淺灘（可涉水通過的河段） */
  readonly ford: Float32Array;

  constructor(size: number, play: number, res: number) {
    this.size = size;
    this.play = play;
    this.res = res;
    this.n = Math.round(size / res) + 1;
    const nn = this.n * this.n;
    this.h = new Float32Array(nn);
    this.road = new Float32Array(nn);
    this.forest = new Float32Array(nn);
    this.mud = new Float32Array(nn);
    this.ford = new Float32Array(nn);
  }

  get half(): number {
    return this.size / 2;
  }

  /** 頂點 (i,j) 的世界座標 */
  vx(i: number): number {
    return i * this.res - this.size / 2;
  }

  private sampleField(f: Float32Array, x: number, z: number): number {
    const n = this.n;
    let gx = (x + this.size / 2) / this.res;
    let gz = (z + this.size / 2) / this.res;
    gx = gx < 0 ? 0 : gx > n - 1.001 ? n - 1.001 : gx;
    gz = gz < 0 ? 0 : gz > n - 1.001 ? n - 1.001 : gz;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const k = j * n + i;
    const a = f[k];
    const b = f[k + 1];
    const c = f[k + n];
    const d = f[k + n + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  height(x: number, z: number): number {
    return this.sampleField(this.h, x, z);
  }

  /** 地面高度（水面以下時回傳河床；士兵涉水用） */
  groundOrWater(x: number, z: number): number {
    return Math.max(this.height(x, z), WATER_LEVEL - 0.5);
  }

  forestAt(x: number, z: number): number {
    return this.sampleField(this.forest, x, z);
  }

  roadAt(x: number, z: number): number {
    return this.sampleField(this.road, x, z);
  }

  fordAt(x: number, z: number): number {
    return this.sampleField(this.ford, x, z);
  }

  /** 坡度（高度梯度大小） */
  slope(x: number, z: number): number {
    const e = this.res;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  /** 是否在可遊玩區域內 */
  inPlay(x: number, z: number, margin = 0): boolean {
    const p = this.play / 2 - margin;
    return x > -p && x < p && z > -p && z < p;
  }
}
