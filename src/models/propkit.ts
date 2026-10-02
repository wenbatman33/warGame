// 場景道具程式建模工具：倒角盒、八角柱、車床體（圓柱／錐／屋頂）、圓團、合併與上色
// 單位：1 = 1 公尺，Y 朝上；所有幾何都輸出「非索引」三角形（position / normal），由 GeoBuilder 上色後合併
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ───────────────────────── 隨機 ─────────────────────────

export type Rng = () => number;

/** mulberry32：可重現的偽隨機數（0..1） */
export function makeRng(seed: number): Rng {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** a..b 之間的隨機數 */
export const rr = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
/** 從陣列隨機挑一個 */
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

/** 由座標產生 0..1 的雜湊（同位置同結果，做石塊、焦痕等斑駁色） */
export function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ───────────────────────── 色票（CoC 式飽和暖色） ─────────────────────────

export const PAL = {
  wood: '#a86b3c',
  woodLight: '#c98d52',
  woodDark: '#6f4526',
  woodFresh: '#e2b679', // 削尖的新鮮木頭切面
  plank: '#b97c45',
  straw: '#ecbc4c',
  strawLight: '#f7d77c',
  strawDark: '#c28a2a',
  rope: '#8c6a3c',
  canvas: '#f3e8cf',
  canvasShade: '#ddc9a0',
  clay: '#d9a465',
  clayDark: '#b98348',
  stone: '#8f9cad',
  stoneLight: '#b1bdca',
  stoneDark: '#6c7889',
  sack: '#efe3c2',
  sack2: '#e2cb93',
  sack3: '#d2b375',
  metal: '#a8b4c0',
  metalDark: '#5e6a78',
  gold: '#f0bd3d',
  lacquer: '#b9332b',
  drumHead: '#f1dfb8',
  dirt: '#c9a46c',
  dirtDark: '#ab8452',
  charcoal: '#2c2725',
  char2: '#3a322d',
  ash: '#77706a',
  ashLight: '#9a938b',
  ember: '#d4561c',
  water: '#2a9fc0',
  waterDeep: '#11698a',
  leaf: '#5fba3c',
  leafDark: '#2e7f2e',
  leafLight: '#a3dc4e',
} as const;

/** 由十六進位取顏色（THREE.Color 會自動轉線性空間） */
export const C = (hex: THREE.ColorRepresentation) => new THREE.Color(hex);
/** 亮度倍率 */
export const shade = (c: THREE.Color, k: number) => c.clone().multiplyScalar(k);
/** 線性內插兩色 */
export const mixC = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

// ───────────────────────── 矩陣 ─────────────────────────

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * 位移＋旋轉＋縮放。旋轉順序 YXZ：先依 ry 轉向（航向），再 rx 前後傾、rz 左右傾。
 * s 可為等比數字或 [sx, sy, sz]
 */
export function mat(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, s: number | [number, number, number] = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ');
  if (typeof s === 'number') _s.set(s, s, s);
  else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s);
}

/** 讓「沿 +Y、底在原點」的幾何從 a 指向 b 的矩陣（只旋轉＋位移，長度由幾何本身決定） */
export function alignY(a: THREE.Vector3, b: THREE.Vector3, roll = 0): THREE.Matrix4 {
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  if (roll !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  return new THREE.Matrix4().compose(a, q, _s.set(1, 1, 1));
}

export const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ───────────────────────── 基本幾何 ─────────────────────────

function geoFrom(pos: number[], nor: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export interface LatheOpts {
  /** 起始角（弧度） */
  phase?: number;
  /** true＝每片平面法線（多面體感）；false＝環向平滑 */
  flat?: boolean;
  /** 每個角度索引的半徑倍率（長度 = seg），做不規則邊緣 */
  rMul?: number[];
  /** 每個角度索引的高度位移（長度 = seg），做下垂的葉尖等 */
  yAdd?: number[];
}

/**
 * 車床體：profile 由下而上 [半徑, 高度]，繞 Y 軸一圈。
 * 輪廓方向的法線是平的（倒角邊清楚），環向平滑 → CoC 式圓潤但有稜角。
 * r=0 的點自動收成尖頂／封底。
 */
export function lathe(profile: [number, number][], seg: number, o: LatheOpts = {}): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const phase = o.phase ?? 0;
  const ang = (j: number) => phase + (j / seg) * Math.PI * 2;
  const rm = (j: number) => (o.rMul ? o.rMul[j % seg] : 1);
  const ya = (j: number) => (o.yAdd ? o.yAdd[j % seg] : 0);
  const P = (r: number, y: number, j: number, out: number[]) => {
    const a = ang(j);
    const rr2 = r * rm(j);
    out.push(rr2 * Math.sin(a), y + (r > 0 ? ya(j) : 0), rr2 * Math.cos(a));
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    // 輪廓切線 (dr, dy) 的外法線 = (dy, -dr)
    let nr = y1 - y0;
    let ny = -(r1 - r0);
    const len = Math.hypot(nr, ny) || 1;
    nr /= len;
    ny /= len;
    for (let j = 0; j < seg; j++) {
      const v00: number[] = [];
      const v01: number[] = [];
      const v10: number[] = [];
      const v11: number[] = [];
      P(r0, y0, j, v00);
      P(r0, y0, j + 1, v01);
      P(r1, y1, j, v10);
      P(r1, y1, j + 1, v11);
      const nA = (a: number) => [nr * Math.sin(a), ny, nr * Math.cos(a)];
      const am = (ang(j) + ang(j + 1)) / 2;
      const n0 = o.flat ? nA(am) : nA(ang(j));
      const n1 = o.flat ? nA(am) : nA(ang(j + 1));
      const tri = (a: number[], na: number[], b: number[], nb: number[], c: number[], nc: number[]) => {
        pos.push(...a, ...b, ...c);
        nor.push(...na, ...nb, ...nc);
      };
      if (r0 > 1e-6) tri(v00, n0, v01, n1, v11, n1);
      if (r1 > 1e-6) tri(v00, n0, v11, n1, v10, n0);
    }
  }
  return geoFrom(pos, nor);
}

/** 圓柱（底在 y=0），可選倒角與封頂 */
export function cylinder(r: number, h: number, seg = 8, bevel = 0, capTop = true, capBottom = false): THREE.BufferGeometry {
  const p: [number, number][] = [];
  if (capBottom) p.push([0, 0]);
  if (bevel > 0 && capBottom) p.push([r - bevel, 0], [r, bevel]);
  else p.push([r, 0]);
  if (bevel > 0 && capTop) p.push([r, h - bevel], [r - bevel, h]);
  else p.push([r, h]);
  if (capTop) p.push([0, h]);
  return lathe(p, seg);
}

/** 由一組凸多邊形面組成凸多面體（自動排序頂點並朝外），平面法線 */
export function convexFaces(faces: THREE.Vector3[][], center: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const c = new THREE.Vector3();
  const out = new THREE.Vector3();
  const u = new THREE.Vector3();
  const w = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const f of faces) {
    c.set(0, 0, 0);
    for (const p of f) c.add(p);
    c.multiplyScalar(1 / f.length);
    out.copy(c).sub(center).normalize();
    // 平面基底
    u.set(1, 0, 0);
    if (Math.abs(out.x) > 0.9) u.set(0, 1, 0);
    u.cross(out).normalize();
    w.copy(out).cross(u);
    const sorted = f
      .map((p) => ({ p, a: Math.atan2(p.clone().sub(c).dot(w), p.clone().sub(c).dot(u)) }))
      .sort((a, b) => a.a - b.a)
      .map((x) => x.p);
    // Newell 法線
    n.set(0, 0, 0);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = sorted[(i + 1) % sorted.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    if (n.dot(out) < 0) {
      sorted.reverse();
      n.negate();
    }
    n.normalize();
    for (let i = 1; i < sorted.length - 1; i++) {
      for (const p of [sorted[0], sorted[i], sorted[i + 1]]) {
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
      }
    }
  }
  return geoFrom(pos, nor);
}

/** 倒角盒（中心在原點）：6 面＋12 條斜邊＋8 個角 = 44 三角形，CoC 厚實感的主力 */
export function chamferBox(w: number, h: number, d: number, b = 0.06): THREE.BufferGeometry {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  b = Math.min(b, hx * 0.45, hy * 0.45, hz * 0.45);
  // 每個角三個點：分別落在 X / Y / Z 面上
  const pt = (sx: number, sy: number, sz: number, axis: number) => {
    if (axis === 0) return V(sx * hx, sy * (hy - b), sz * (hz - b));
    if (axis === 1) return V(sx * (hx - b), sy * hy, sz * (hz - b));
    return V(sx * (hx - b), sy * (hy - b), sz * hz);
  };
  const S = [-1, 1];
  const faces: THREE.Vector3[][] = [];
  // 主面
  for (let axis = 0; axis < 3; axis++) {
    for (const s of S) {
      const f: THREE.Vector3[] = [];
      for (const a of S)
        for (const c of S) {
          const sg = [0, 0, 0];
          sg[axis] = s;
          sg[(axis + 1) % 3] = a;
          sg[(axis + 2) % 3] = c;
          f.push(pt(sg[0], sg[1], sg[2], axis));
        }
      faces.push(f);
    }
  }
  // 斜邊
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const k = 3 - i - j;
      for (const si of S)
        for (const sj of S) {
          const f: THREE.Vector3[] = [];
          for (const sk of S) {
            const sg = [0, 0, 0];
            sg[i] = si;
            sg[j] = sj;
            sg[k] = sk;
            f.push(pt(sg[0], sg[1], sg[2], i), pt(sg[0], sg[1], sg[2], j));
          }
          faces.push(f);
        }
    }
  }
  // 角
  for (const sx of S) for (const sy of S) for (const sz of S) faces.push([pt(sx, sy, sz, 0), pt(sx, sy, sz, 1), pt(sx, sy, sz, 2)]);
  return convexFaces(faces, V(0, 0, 0));
}

/** 八角柱（只倒直邊），底在 y=0：8 側面＋頂蓋 = 22 三角形，給柱子／木板用 */
export function bevelPrism(w: number, h: number, d: number, b = 0.05, bottom = false): THREE.BufferGeometry {
  const hx = w / 2;
  const hz = d / 2;
  b = Math.min(b, hx * 0.45, hz * 0.45);
  const ring = (y: number) => [
    V(hx - b, y, hz),
    V(hx, y, hz - b),
    V(hx, y, -hz + b),
    V(hx - b, y, -hz),
    V(-hx + b, y, -hz),
    V(-hx, y, -hz + b),
    V(-hx, y, hz - b),
    V(-hx + b, y, hz),
  ];
  const lo = ring(0);
  const hi = ring(h);
  const faces: THREE.Vector3[][] = [];
  for (let i = 0; i < 8; i++) faces.push([lo[i], lo[(i + 1) % 8], hi[(i + 1) % 8], hi[i]]);
  faces.push(hi);
  if (bottom) faces.push(lo);
  return convexFaces(faces, V(0, h / 2, 0));
}

/** 沿 X 的開口方木（只有上下前後 4 面、8 三角形），柵欄橫木用 */
export function openBeam(L: number, h: number, d: number): THREE.BufferGeometry {
  const x = L / 2;
  const y = h / 2;
  const z = d / 2;
  const q = (a: THREE.Vector3[]) => a;
  return convexFaces(
    [
      q([V(-x, y, -z), V(x, y, -z), V(x, y, z), V(-x, y, z)]),
      q([V(-x, -y, -z), V(x, -y, -z), V(x, -y, z), V(-x, -y, z)]),
      q([V(-x, -y, z), V(x, -y, z), V(x, y, z), V(-x, y, z)]),
      q([V(-x, -y, -z), V(x, -y, -z), V(x, y, -z), V(-x, y, -z)]),
    ],
    V(0, 0, 0),
  );
}

/** 一般方盒（中心在原點，非索引） */
export function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}

/** 圓潤一團（icosphere 加噪聲、平滑法線），樹冠、岩石、麻袋用 */
export function blob(
  radius: number,
  detail: number,
  rng: Rng,
  noise = 0.1,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const k = radius * (1 + (rng() * 2 - 1) * noise);
    p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sz);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** 平面多邊形（依給定順序扇形三角化），double=true 時加背面 */
export function polyGeo(pts: THREE.Vector3[], double = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const n = new THREE.Vector3()
    .subVectors(pts[1], pts[0])
    .cross(new THREE.Vector3().subVectors(pts[2], pts[0]))
    .normalize();
  for (let i = 1; i < pts.length - 1; i++) {
    for (const p of [pts[0], pts[i], pts[i + 1]]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
    }
    if (double) {
      for (const p of [pts[0], pts[i + 1], pts[i]]) {
        pos.push(p.x, p.y, p.z);
        nor.push(-n.x, -n.y, -n.z);
      }
    }
  }
  return geoFrom(pos, nor);
}

// ───────────────────────── 合併建構器 ─────────────────────────

export type FaceColorFn = (c: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;
export type VertexColorFn = (p: THREE.Vector3, n: THREE.Vector3, out: THREE.Color) => void;
/** 顏色：單色、依三角形（區域座標的重心＋法線）或依頂點（區域座標） */
export type ColorSpec = THREE.Color | string | { face: FaceColorFn } | { vertex: VertexColorFn };

export interface AddOpts {
  /** 'vertex'：每個頂點各自貼地（地面墊、橫木）；預設以零件原點貼地 */
  anchor?: 'vertex' | 'part';
  /** 亮度隨機幅度（例 0.08 = ±8%），讓木板、麻袋有深淺 */
  jitter?: number;
  /** 指定貼地錨點（結構座標 x, z），優先於其他設定 */
  anchorAt?: [number, number];
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _lc = new THREE.Vector3();
const _ln = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const _m3 = new THREE.Matrix3();

/**
 * 把許多零件幾何依矩陣變換、上頂點色後合併成一個 BufferGeometry。
 * 另外記錄每個頂點的「貼地錨點」(x, z)，讓 setHeight 能讓整組結構貼合地形。
 */
export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly anc: number[] = [];
  readonly rng: Rng;
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private anchors: (THREE.Vector2 | null)[] = [null];

  constructor(rng: Rng = makeRng(1)) {
    this.rng = rng;
  }

  get vertexCount() {
    return this.pos.length / 3;
  }
  get triangles() {
    return this.pos.length / 9;
  }

  /** 進入子座標系；anchorHere=true 時整個子組件以這個原點為貼地錨點（剛體，不變形） */
  push(m: THREE.Matrix4, anchorHere = false) {
    const top = this.stack[this.stack.length - 1].clone().multiply(m);
    this.stack.push(top);
    this.anchors.push(anchorHere ? new THREE.Vector2(top.elements[12], top.elements[14]) : this.anchors[this.anchors.length - 1]);
  }
  pop() {
    if (this.stack.length > 1) {
      this.stack.pop();
      this.anchors.pop();
    }
  }

  /** 目前座標系下某區域點的結構座標 */
  toLocal(x: number, y: number, z: number) {
    return V(x, y, z).applyMatrix4(this.stack[this.stack.length - 1]);
  }

  add(geo: THREE.BufferGeometry, m: THREE.Matrix4 | null, color: ColorSpec, o: AddOpts = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const P = g.getAttribute('position');
    const N = g.getAttribute('normal');
    const M = this.stack[this.stack.length - 1].clone();
    if (m) M.multiply(m);
    _m3.getNormalMatrix(M);
    const mirror = M.determinant() < 0;
    const stackAnchor = this.anchors[this.anchors.length - 1];
    const perVertex = o.anchor === 'vertex';
    const ax = o.anchorAt ? o.anchorAt[0] : stackAnchor ? stackAnchor.x : M.elements[12];
    const az = o.anchorAt ? o.anchorAt[1] : stackAnchor ? stackAnchor.y : M.elements[14];
    const k = 1 + (o.jitter ? (this.rng() * 2 - 1) * o.jitter : 0);
    let solid: THREE.Color | null = null;
    let faceFn: FaceColorFn | null = null;
    let vtxFn: VertexColorFn | null = null;
    if (color instanceof THREE.Color) solid = color;
    else if (typeof color === 'string') solid = new THREE.Color(color);
    else if ('face' in color) faceFn = color.face;
    else vtxFn = color.vertex;
    const order = mirror ? [0, 2, 1] : [0, 1, 2];
    for (let t = 0; t < P.count; t += 3) {
      if (faceFn) {
        _lc.set(0, 0, 0);
        for (let i = 0; i < 3; i++) _lc.x += P.getX(t + i) / 3, _lc.y += P.getY(t + i) / 3, _lc.z += P.getZ(t + i) / 3;
        _a.set(P.getX(t + 1) - P.getX(t), P.getY(t + 1) - P.getY(t), P.getZ(t + 1) - P.getZ(t));
        _b.set(P.getX(t + 2) - P.getX(t), P.getY(t + 2) - P.getY(t), P.getZ(t + 2) - P.getZ(t));
        _ln.crossVectors(_a, _b).normalize();
        faceFn(_lc, _ln, _c);
      }
      for (const oi of order) {
        const i = t + oi;
        _v.set(P.getX(i), P.getY(i), P.getZ(i));
        _n.set(N.getX(i), N.getY(i), N.getZ(i));
        if (vtxFn) vtxFn(_v, _n, _c);
        else if (solid) _c.copy(solid);
        _v.applyMatrix4(M);
        _n.applyMatrix3(_m3).normalize();
        this.pos.push(_v.x, _v.y, _v.z);
        this.nor.push(_n.x, _n.y, _n.z);
        this.col.push(_c.r * k, _c.g * k, _c.b * k);
        if (perVertex) this.anc.push(_v.x, _v.z);
        else this.anc.push(ax, az);
      }
    }
  }

  /** 把另一個建構器的內容整批接上 */
  append(o: GeoBuilder) {
    this.pos.push(...o.pos);
    this.nor.push(...o.nor);
    this.col.push(...o.col);
    this.anc.push(...o.anc);
  }

  /**
   * 輸出合併幾何。ao>0 時依高度把貼地處壓暗（假接觸陰影）；anchors=true 時把貼地錨點存進 userData.anchors
   */
  toGeometry(o: { ao?: number; aoHeight?: number; anchors?: boolean } = {}): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const col = new Float32Array(this.col);
    if (o.ao && o.ao > 0) {
      const h = o.aoHeight ?? 1.2;
      for (let i = 0; i < this.pos.length / 3; i++) {
        const f = 1 - o.ao * (1 - smoothstep(0, h, this.pos[i * 3 + 1]));
        col[i * 3] *= f;
        col[i * 3 + 1] *= f;
        col[i * 3 + 2] *= f;
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (o.anchors) g.userData.anchors = new Float32Array(this.anc);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// ───────────────────────── 常用組件 ─────────────────────────

/** 圓木：a→b 的 n 邊形圓柱。caps：0 不封口、1 平封口、2 倒角封口 */
export function logBetween(b: GeoBuilder, a: THREE.Vector3, c: THREE.Vector3, r: number, color: ColorSpec, seg = 6, o: AddOpts = {}, caps: 0 | 1 | 2 = 2, rTop = r) {
  const len = a.distanceTo(c);
  const ch = Math.min(r * 0.3, len * 0.2);
  let prof: [number, number][];
  if (caps === 2)
    prof = [
      [0, 0],
      [r * 0.72, 0],
      [r, ch],
      [rTop, len - ch],
      [rTop * 0.72, len],
      [0, len],
    ];
  else if (caps === 1)
    prof = [
      [0, 0],
      [r, 0],
      [rTop, len],
      [0, len],
    ];
  else
    prof = [
      [r, 0],
      [rTop, len],
    ];
  b.add(lathe(prof, seg, { phase: Math.PI / seg }), alignY(a, c), color, o);
}

/** 木板／方木：a→b 的八角柱（寬 w、厚 d） */
export function plankBetween(b: GeoBuilder, a: THREE.Vector3, c: THREE.Vector3, w: number, d: number, color: ColorSpec, o: AddOpts = {}, roll = 0) {
  const len = a.distanceTo(c);
  b.add(bevelPrism(w, len, d, Math.min(w, d) * 0.22, true), alignY(a, c, roll), color, o);
}

/** 依面朝向與高度的木頭上色：端面（年輪）較亮 */
export function woodFace(base: THREE.Color, endColor?: THREE.Color): { face: FaceColorFn } {
  const end = endColor ?? mixC(base, C(PAL.woodFresh), 0.55);
  return {
    face: (_c, n, out) => {
      if (Math.abs(n.y) > 0.85) out.copy(end);
      else out.copy(base).multiplyScalar(0.92 + 0.12 * Math.abs(n.x));
    },
  };
}
