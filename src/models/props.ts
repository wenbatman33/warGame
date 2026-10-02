// 場景道具與營寨結構（CoC 式厚實低多邊形，全部程式建模、頂點色）
// 單位：1 = 1 公尺，Y 朝上，原點在地面中心，+Z 為正面
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  C,
  GeoBuilder,
  PAL,
  V,
  bevelPrism,
  blob,
  boxGeo,
  chamferBox,
  openBeam,
  hash3,
  lathe,
  logBetween,
  makeRng,
  mat,
  mixC,
  pick,
  plankBetween,
  polyGeo,
  rr,
  woodFace,
  type FaceColorFn,
  type Rng,
} from './propkit';

// ───────────────────────── 對外：共用時間與材質 ─────────────────────────

/** 共用時間 uniform（秒），主程式每幀更新：旗幟飄動、水面波光 */
export const propTime: { value: number } = { value: 0 };

/** 道具共用材質：頂點色、粗糙木頭／帆布質感 */
export const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
propMaterial.name = 'propMaterial';

export type PropKind =
  | 'tent'
  | 'commandTent'
  | 'granary'
  | 'sackPile'
  | 'palisadeSegment'
  | 'palisadeGate'
  | 'watchtower'
  | 'bannerPole'
  | 'campfire'
  | 'wagon'
  | 'cheval'
  | 'weaponRack'
  | 'barrels'
  | 'drumStand'
  | 'well'
  | 'bridge'
  | 'burntDebris';

export const PROP_KINDS: readonly PropKind[] = [
  'tent',
  'commandTent',
  'granary',
  'sackPile',
  'palisadeSegment',
  'palisadeGate',
  'watchtower',
  'bannerPole',
  'campfire',
  'wagon',
  'cheval',
  'weaponRack',
  'barrels',
  'drumStand',
  'well',
  'bridge',
  'burntDebris',
];

export interface PropOptions {
  team?: THREE.ColorRepresentation;
  seed?: number;
  /** palisadeSegment／bridge 長度（沿 X 軸） */
  length?: number;
}

type B = GeoBuilder;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const DEFAULT_TEAM = '#3f6fd6';

// ───────────────────────── 上色小工具 ─────────────────────────

/** 焦黑木頭：上表面積灰、側面炭黑、零星暗紅餘燼 */
function charFace(ashUp = 0.75, emberP = 0.035): { face: FaceColorFn } {
  const c1 = C(PAL.charcoal);
  const c2 = C(PAL.char2);
  const ash = C(PAL.ash);
  const ember = C(PAL.ember);
  return {
    face: (c, n, out) => {
      const h = hash3(c.x, c.y, c.z);
      if (n.y > ashUp && h > 0.25) out.copy(ash).multiplyScalar(0.7 + 0.3 * h);
      else if (h < emberP) out.copy(ember).multiplyScalar(0.5);
      else out.copy(h < 0.5 ? c1 : c2).multiplyScalar(0.85 + 0.3 * h);
    },
  };
}

/** 石塊：每片面隨機深淺，頂面偏亮 */
function stoneFace(dark = 1): { face: FaceColorFn } {
  const s = [C(PAL.stone), C(PAL.stoneLight), C(PAL.stoneDark), mixC(C(PAL.stone), C(PAL.stoneLight), 0.5)];
  return {
    face: (c, n, out) => {
      const h = hash3(Math.round(c.x * 3), Math.round(c.y * 3), Math.round(c.z * 3));
      out.copy(s[Math.floor(h * 4) % 4]).multiplyScalar((n.y > 0.6 ? 1.08 : 0.95) * dark);
    },
  };
}

/** 焦黑石塊 */
function sootStoneFace(): { face: FaceColorFn } {
  const st = stoneFace(0.45);
  const ash = C(PAL.ash);
  return {
    face: (c, n, out) => {
      st.face(c, n, out);
      if (n.y > 0.6) out.lerp(ash, 0.4);
    },
  };
}

/** 依角度索引交錯兩色（編織牆、條紋屋頂、木桶板） */
function angleIndex(c: THREE.Vector3, seg: number, phase = 0) {
  const a = Math.atan2(c.x, c.z) - phase;
  return ((Math.round((a / TAU) * seg) % seg) + seg) % seg;
}

// ───────────────────────── 共用小零件 ─────────────────────────

/** 削尖木樁（5 邊形、15 三角形），x,z 為樁底 */
function stake(b: B, x: number, z: number, h: number, r: number, o: { ry?: number; rx?: number; rz?: number; burnt?: boolean; broken?: boolean } = {}) {
  const rng = b.rng;
  const tip = r * 2.5;
  const prof: [number, number][] = o.broken
    ? [
        [r, -0.3],
        [r * 0.97, h],
        [r * 0.55, h + 0.06],
        [0, h + 0.1],
      ]
    : [
        [r, -0.3],
        [r * 0.95, h - tip],
        [0, h],
      ];
  // 4 邊形＋環向平滑法線：剪影是削尖方樁、光影像圓木（12 三角形，省預算）
  const g = lathe(prof, 4, { phase: rng() * TAU });
  if (o.burnt) {
    b.add(g, mat(x, 0, z, o.ry ?? 0, o.rx ?? 0, o.rz ?? 0), charFace());
    return;
  }
  const base = C(pick(rng, [PAL.wood, PAL.woodLight, PAL.plank, PAL.wood])).multiplyScalar(0.88 + rng() * 0.22);
  const fresh = C(PAL.woodFresh);
  b.add(g, mat(x, 0, z, o.ry ?? 0, o.rx ?? 0, o.rz ?? 0), {
    face: (c, _n, out) => {
      out.copy(c.y > h - tip ? fresh : base);
    },
  });
}

/** 一條直線柵欄（沿 X、長 L，正面 +Z，橫木在內側 -Z） */
function palisadeLine(b: B, L: number, burnt = false) {
  const rng = b.rng;
  const n = Math.max(2, Math.round(L / 0.56));
  const sp = L / n;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + sp * (i + 0.5);
    const h = rr(rng, 2.45, 2.85);
    const r = rr(rng, 0.255, 0.29);
    const tilt = { rx: rr(rng, -0.04, 0.04), rz: rr(rng, -0.04, 0.04), ry: rng() * TAU };
    if (!burnt) {
      stake(b, x, rr(rng, -0.03, 0.03), h, r, tilt);
      continue;
    }
    const k = rng();
    if (k < 0.1) continue; // 燒光
    if (k < 0.3) {
      // 倒下：橫躺在地，向外或向內
      const dir = rng() < 0.6 ? 1 : -1;
      stake(b, x, dir * 0.15, h * rr(rng, 0.5, 0.9), r, { ry: rr(rng, -0.4, 0.4), rx: dir * rr(rng, 1.25, 1.5), burnt: true });
    } else if (k < 0.6) {
      stake(b, x, 0, h * rr(rng, 0.3, 0.7), r, { ...tilt, burnt: true, broken: true });
    } else stake(b, x, 0, h * rr(rng, 0.85, 1), r, { ...tilt, burnt: true });
  }
  // 橫木（內側），每個頂點各自貼地
  const railCol = burnt ? charFace() : woodFace(C(PAL.woodDark));
  for (const y of [0.75, 1.85]) {
    if (burnt && rng() < 0.5) continue;
    b.add(openBeam(L, 0.18, 0.14), mat(0, y, -0.3), railCol, { anchor: 'vertex' });
  }
}

/** 一圈柵欄，+Z 方向留缺口（gapHalf 為缺口半寬，公尺） */
function palisadeRing(b: B, R: number, gapHalf: number, burnt = false) {
  const gapA = Math.asin(Math.min(0.99, gapHalf / R));
  const span = TAU - 2 * gapA;
  const n = Math.ceil((span * R) / 4.2);
  const dA = span / n;
  for (let i = 0; i < n; i++) {
    const am = gapA + dA * (i + 0.5);
    const L = 2 * R * Math.sin(dA / 2);
    const rc = R * Math.cos(dA / 2);
    b.push(mat(rc * Math.sin(am), 0, rc * Math.cos(am), am));
    palisadeLine(b, L + 0.04, burnt);
    b.pop();
  }
}

/** 一個麻袋（6×3 分段的方圓枕頭，24 三角形），兩端收口沿 X 軸 */
let _sack: THREE.BufferGeometry | null = null;
function sackGeo(): THREE.BufferGeometry {
  if (_sack) return _sack;
  let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, 6, 3, Math.PI / 6);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const f = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.62);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // 球的極軸（Y）轉到 X：(x, y) → (y, -x)，保持右手座標；環點推到 ±0.8、極點 ±0.95 → 鈍頭枕形
    const ax = Math.abs(y) > 0.99 ? Math.sign(y) * 0.95 : Math.abs(y) > 0.01 ? Math.sign(y) * 0.8 : 0;
    p.setXYZ(i, ax * 0.47, f(-x) * 0.25, f(z) * 0.31);
  }
  g.computeVertexNormals();
  _sack = g.toNonIndexed();
  return _sack;
}

const SACK_COLS = [PAL.sack, PAL.sack2, PAL.sack3, PAL.sack];

interface SackSpec {
  m: THREE.Matrix4;
  col: THREE.Color;
  layer: number;
  ax: number;
  az: number;
  order: number;
}

/** 金字塔麻袋堆：回傳每個麻袋的矩陣（結構座標），由下而上 */
function sackPileSpecs(rng: Rng, origin: THREE.Matrix4, nx: number, nz: number, out: SackSpec[], pallet: number) {
  const ax = origin.elements[12];
  const az = origin.elements[14];
  for (let L = 0; ; L++) {
    const cx = nx - L;
    const cz = nz - L;
    if (cx < 1 || cz < 1) break;
    for (let i = 0; i < cx; i++)
      for (let j = 0; j < cz; j++) {
        const lx = (i - (cx - 1) / 2) * 0.86 + rr(rng, -0.04, 0.04);
        const lz = (j - (cz - 1) / 2) * 0.58 + rr(rng, -0.03, 0.03);
        const ly = pallet + 0.22 + L * 0.39;
        const s = rr(rng, 0.94, 1.06);
        const m = origin.clone().multiply(mat(lx, ly, lz, rr(rng, -0.12, 0.12), rr(rng, -0.06, 0.06), rr(rng, -0.05, 0.05), [s, s * rr(rng, 0.92, 1.05), s]));
        out.push({ m, col: C(pick(rng, SACK_COLS)).multiplyScalar(rr(rng, 0.92, 1.06)), layer: L, ax, az, order: rng() });
      }
  }
}

/** 麻袋堆底下的木棧板 */
function pallet(b: B, nx: number, nz: number) {
  const w = nx * 0.86 + 0.2;
  const d = nz * 0.58 + 0.2;
  const col = woodFace(C(PAL.woodDark));
  for (const z of [-d / 2 + 0.2, d / 2 - 0.2]) b.add(bevelPrism(0.13, w, 0.22, 0.04), mat(-w / 2, 0.065, z, 0, 0, -Math.PI / 2), col, { jitter: 0.06 });
}

/** 灰燼堆（麻袋焚毀後） */
function ashHeap(b: B, sx: number, sz: number, h = 0.45) {
  const rng = b.rng;
  const ash = C(PAL.ash);
  const ashL = C(PAL.ashLight);
  const ch = C(PAL.charcoal);
  const em = C(PAL.ember);
  b.add(blob(1, 1, rng, 0.22, sx, h * 0.8, sz), mat(0, -0.02, 0), {
    vertex: (p, n, out) => {
      const k = hash3(p.x * 4, p.y * 4, p.z * 4);
      if (n.y < 0.5 || k < 0.35) out.copy(ch).multiplyScalar(0.9 + 0.3 * k);
      else if (k > 0.96) out.copy(em).multiplyScalar(0.55);
      else out.copy(k < 0.7 ? ash : ashL).multiplyScalar(0.55 + 0.25 * k);
    },
  });
  // 幾個燒黑的麻袋殘形
  for (let i = 0; i < 3; i++) {
    b.add(sackGeo(), mat(rr(rng, -sx, sx) * 0.6, 0.12, rr(rng, -sz, sz) * 0.6, rng() * TAU, 0, rr(rng, -0.2, 0.2), [0.9, 0.6, 0.9]), charFace());
  }
}

/** 散落焦木＋灰（通用殘骸） */
function debris(b: B, size = 1) {
  const rng = b.rng;
  ashHeap(b, 1.3 * size, 1.1 * size, 0.35 * size);
  const n = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * TAU;
    const r0 = rr(rng, 0.2, 1.3) * size;
    const len = rr(rng, 1.0, 2.2) * size;
    const p0 = V(Math.sin(a) * r0, 0.12, Math.cos(a) * r0);
    const a2 = a + rr(rng, -1.2, 1.2);
    const p1 = p0.clone().add(V(Math.sin(a2) * len, rr(rng, 0.0, 0.5) * size, Math.cos(a2) * len));
    logBetween(b, p0, p1, rr(rng, 0.08, 0.14) * size, charFace(), 5, {}, 2);
  }
  for (let i = 0; i < 2; i++) {
    const a = rng() * TAU;
    stake(b, Math.sin(a) * 1.6 * size, Math.cos(a) * 1.6 * size, rr(rng, 0.5, 1.2) * size, 0.2 * size, { burnt: true, broken: true, rx: rr(rng, -0.2, 0.2) });
  }
}

/** 小三角旗（頂點色，靜態） */
function pennant(b: B, x: number, y: number, z: number, team: THREE.Color, len = 0.6, ry = 0) {
  b.add(polyGeo([V(0, 0, 0), V(len, -0.16, 0), V(0, -0.34, 0)], true), mat(x, y, z, ry), team);
}

// ───────────────────────── 道具 ─────────────────────────

/** 人字帳篷（長 3.8、寬 3.2、高 2.5）：米白帆布、下緣與屋脊隊伍色條 */
function tent(b: B, team: THREE.Color) {
  const pts: [number, number][] = [
    [-1.6, 0],
    [-1.55, 0.55],
    [-1.06, 1.49],
    [-0.36, 2.3],
    [0, 2.42],
    [0.36, 2.3],
    [1.06, 1.49],
    [1.55, 0.55],
    [1.6, 0],
  ];
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = 3.6;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 1, steps: 1, curveSegments: 1 });
  g.deleteAttribute('uv');
  const canvas = C(PAL.canvas);
  const canvasSh = C(PAL.canvasShade);
  b.add(g, mat(0, 0, -depth / 2), {
    face: (c, n, out) => {
      if (Math.abs(n.z) > 0.6) out.copy(canvasSh);
      else if (c.y < 0.6 || c.y > 2.22) out.copy(team);
      else out.copy(canvas);
    },
  });
  const zf = depth / 2 + 0.155;
  // 門洞
  b.add(polyGeo([V(-0.55, 0, zf), V(0.55, 0, zf), V(0, 1.72, zf)]), null, C('#5a3a24'));
  // 捲起的門簾
  logBetween(b, V(-0.66, 0.05, zf + 0.03), V(-0.08, 1.74, zf + 0.03), 0.085, C(PAL.canvasShade), 5, {}, 1);
  logBetween(b, V(0.66, 0.05, zf + 0.03), V(0.08, 1.74, zf + 0.03), 0.085, C(PAL.canvasShade), 5, {}, 1);
  // 前後帳桿與三角小旗
  for (const s of [1, -1]) logBetween(b, V(0, -0.1, s * (zf + 0.06)), V(0, 3.0, s * (zf + 0.06)), 0.055, C(PAL.woodDark), 5, {}, 1);
  pennant(b, 0, 3.0, zf + 0.06, team, 0.62);
  // 地樁
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(boxGeo(0.08, 0.3, 0.08), mat(sx * 1.85, 0.1, sz * 1.5, 0, 0, sx * 0.3), C(PAL.woodDark));
}

/** 焚毀帳篷：焦黑帆布塌堆＋殘桿 */
function burntTent(b: B) {
  const rng = b.rng;
  b.add(blob(1, 1, rng, 0.2, 1.6, 0.4, 1.9), mat(0, 0.02, 0), charFace());
  logBetween(b, V(0, -0.1, 1.9), V(0.15, 1.7, 2.0), 0.06, charFace(), 5, {}, 1);
  logBetween(b, V(-0.4, 0.08, -2.0), V(1.0, 0.3, -0.7), 0.06, charFace(), 5, {}, 1);
}

/** 主帥大帳：八角帳、隊伍色條紋屋頂、金頂、前廊遮簷（直徑約 10 m、高 7 m） */
function commandTent(b: B, team: THREE.Color) {
  const seg = 8;
  const ph = -Math.PI / 8; // 第 0 面正對 +Z
  const gold = C(PAL.gold);
  const canvas = C(PAL.canvas);
  // 木平台
  b.add(
    lathe(
      [
        [5.0, -0.1],
        [5.0, 0.24],
        [4.82, 0.4],
        [0, 0.4],
      ],
      seg,
      { phase: ph, flat: true },
    ),
    null,
    woodFace(C(PAL.plank), C(PAL.woodLight)),
  );
  // 帆布牆（交錯深淺）
  const wallR = 4.2;
  b.add(
    lathe(
      [
        [wallR, 0.38],
        [wallR, 2.5],
      ],
      seg,
      { phase: ph, flat: true },
    ),
    null,
    { face: (c, _n, out) => out.copy(angleIndex(c, seg) % 2 ? C(PAL.canvasShade) : canvas) },
  );
  // 簷下垂飾帶（隊伍色）
  b.add(
    lathe(
      [
        [4.3, 2.2],
        [4.42, 2.62],
        [4.3, 2.72],
      ],
      seg,
      { phase: ph, flat: true },
    ),
    null,
    team,
  );
  // 垂飾三角牙
  const ap = 4.32 * Math.cos(Math.PI / 8);
  const side = 2 * 4.32 * Math.sin(Math.PI / 8);
  for (let j = 0; j < seg; j++) {
    b.push(mat(0, 0, 0, j * (TAU / seg)));
    for (const k of [-0.25, 0.25]) {
      const cx = k * side;
      b.add(polyGeo([V(cx - side * 0.2, 2.22, ap + 0.02), V(cx, 1.92, ap + 0.02), V(cx + side * 0.2, 2.22, ap + 0.02)]), null, team.clone().multiplyScalar(0.82));
    }
    b.pop();
  }
  // 屋頂：微凹的八角錐，隊伍色與米白交錯
  b.add(
    lathe(
      [
        [4.2, 2.7],
        [5.1, 2.5],
        [5.15, 2.72],
        [3.7, 3.45],
        [2.1, 4.25],
        [0.9, 5.05],
        [0.4, 5.45],
        [0, 5.55],
      ],
      seg,
      { phase: ph, flat: true },
    ),
    null,
    {
      face: (c, n, out) => {
        if (n.y < -0.2) out.copy(C(PAL.canvasShade)).multiplyScalar(0.8);
        else if (c.y < 2.75) out.copy(gold);
        else out.copy(angleIndex(c, seg) % 2 ? canvas : team);
      },
    },
  );
  // 屋脊金色肋條
  for (let j = 0; j < seg; j++) {
    const a = ph + (j / seg) * TAU;
    const p0 = V(Math.sin(a) * 5.12, 2.72, Math.cos(a) * 5.12);
    const p1 = V(Math.sin(a) * 0.45, 5.45, Math.cos(a) * 0.45);
    logBetween(b, p0, p1, 0.07, gold, 4, {}, 0);
  }
  // 金頂
  b.add(
    lathe(
      [
        [0.42, 5.4],
        [0.46, 5.62],
        [0.16, 5.9],
        [0.26, 6.15],
        [0, 6.85],
      ],
      6,
    ),
    null,
    gold,
  );
  pennant(b, 0, 7.6, 0, team, 1.0);
  logBetween(b, V(0, 6.5, 0), V(0, 7.65, 0), 0.04, C(PAL.woodDark), 4, {}, 1);
  // 門與前廊
  const zf = wallR * Math.cos(Math.PI / 8) + 0.02;
  b.add(polyGeo([V(-0.95, 0.4, zf), V(0.95, 0.4, zf), V(0.95, 2.15, zf), V(-0.95, 2.15, zf)]), null, C('#4a2e1c'));
  logBetween(b, V(-1.05, 0.42, zf + 0.06), V(-0.95, 2.15, zf + 0.06), 0.11, C(PAL.canvasShade), 5, {}, 1);
  logBetween(b, V(1.05, 0.42, zf + 0.06), V(0.95, 2.15, zf + 0.06), 0.11, C(PAL.canvasShade), 5, {}, 1);
  for (const s of [-1, 1]) {
    logBetween(b, V(s * 1.5, 0.35, 5.6), V(s * 1.5, 2.55, 5.6), 0.08, C(PAL.lacquer), 6, {}, 2);
    b.add(lathe([[0.12, 0], [0.14, 0.1], [0, 0.22]], 6), mat(s * 1.5, 2.55, 5.6), gold);
  }
  // 遮簷：從牆頭斜到前柱
  const awn = V(0, 2.62, 4.75);
  b.add(chamferBox(3.6, 0.1, 2.0, 0.04), mat(awn.x, awn.y, awn.z, 0, 0.16, 0), {
    face: (c, n, out) => out.copy(n.y > 0.5 ? (Math.abs(c.x) < 0.6 ? canvas : team) : gold),
  });
  // 台階
  b.add(chamferBox(2.6, 0.22, 0.7, 0.05), mat(0, 0.11, 5.2), woodFace(C(PAL.plank)));
}

/** 焚毀主帥帳 */
function burntCommandTent(b: B) {
  const rng = b.rng;
  b.add(
    lathe(
      [
        [5.0, -0.1],
        [5.0, 0.24],
        [4.82, 0.4],
        [0, 0.4],
      ],
      8,
      { phase: -Math.PI / 8, flat: true },
    ),
    null,
    charFace(),
  );
  // 殘柱
  for (let j = 0; j < 8; j++) {
    const a = -Math.PI / 8 + (j / 8) * TAU;
    const k = rng();
    if (k < 0.3) continue;
    const h = k < 0.6 ? rr(rng, 0.6, 1.4) : rr(rng, 1.8, 2.5);
    logBetween(b, V(Math.sin(a) * 4.2, 0.3, Math.cos(a) * 4.2), V(Math.sin(a) * 4.1, 0.3 + h, Math.cos(a) * 4.1), 0.1, charFace(), 5, {}, 1);
  }
  // 塌下的屋頂
  b.add(
    lathe(
      [
        [4.6, 0],
        [2.8, 0.5],
        [1.0, 0.9],
        [0, 1.0],
      ],
      8,
      { phase: 0.2, flat: true, rMul: [1, 0.85, 1.05, 0.9, 1, 0.8, 1.05, 0.95] },
    ),
    mat(0.3, 0.42, -0.2, 0.3, 0.12, -0.08),
    charFace(),
  );
  ashHeap(b, 2.4, 2.0, 0.5);
  logBetween(b, V(-2, 0.5, 3), V(2.5, 0.7, 1.2), 0.12, charFace(), 5, {}, 2);
}

/** 圓形草頂穀倉（牆半徑 2.9、高約 6.7 m），門朝 +Z */
function granary(b: B) {
  const rng = b.rng;
  const seg = 12;
  // 石基
  b.add(
    lathe(
      [
        [3.25, -0.1],
        [3.3, 0.32],
        [3.12, 0.48],
        [0, 0.48],
      ],
      seg,
      { phase: rng() },
    ),
    null,
    stoneFace(),
  );
  // 編織土牆（棋盤深淺）
  const clay = C(PAL.clay);
  const clayD = C(PAL.clayDark);
  b.add(
    lathe(
      [
        [2.9, 0.45],
        [2.99, 1.5],
        [2.9, 2.95],
      ],
      seg,
    ),
    null,
    { face: (c, _n, out) => out.copy((angleIndex(c, seg, Math.PI / seg) + (c.y < 1.5 ? 0 : 1)) % 2 ? clay : clayD) },
  );
  // 木柱
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    b.add(bevelPrism(0.3, 2.75, 0.3, 0.07), mat(Math.sin(a) * 2.98, 0.4, Math.cos(a) * 2.98, a), woodFace(C(PAL.woodDark)), { jitter: 0.06 });
  }
  // 門
  b.add(chamferBox(1.1, 1.72, 0.24, 0.05), mat(0, 0.48 + 0.86, 2.92), woodFace(C(PAL.plank)));
  plankBetween(b, V(-0.78, 2.3, 3.04), V(0.78, 2.3, 3.04), 0.2, 0.22, woodFace(C(PAL.woodDark)));
  for (const y of [0.9, 1.8]) b.add(boxGeo(1.0, 0.08, 0.05), mat(0, y, 3.06), C(PAL.metalDark));
  // 草頂（兩層，帶滴水簷與段差）
  const straw = C(PAL.straw);
  const strawL = C(PAL.strawLight);
  const strawD = C(PAL.strawDark);
  const rMul = Array.from({ length: seg }, () => 1 + (rng() * 2 - 1) * 0.025);
  b.add(
    lathe(
      [
        [2.85, 2.95],
        [3.85, 2.62],
        [4.0, 2.84],
        [2.5, 4.15],
        [2.66, 4.07],
        [2.78, 4.26],
        [1.2, 5.45],
        [0.6, 5.8],
        [0, 5.95],
      ],
      seg,
      { rMul, phase: rng() },
    ),
    null,
    {
      face: (c, n, out) => {
        if (n.y < -0.05) out.copy(strawD).multiplyScalar(0.75);
        else if (c.y < 2.95 || (c.y > 4.05 && c.y < 4.3)) out.copy(strawL);
        else out.copy(straw).multiplyScalar(angleIndex(c, seg) % 2 ? 1 : 0.92);
      },
    },
  );
  // 頂結
  b.add(
    lathe(
      [
        [0.62, 5.72],
        [0.42, 6.0],
        [0.5, 6.12],
        [0.22, 6.3],
        [0, 6.75],
      ],
      6,
    ),
    null,
    { face: (c, _n, out) => out.copy(c.y < 6.1 ? C(PAL.rope) : strawD) },
  );
}

/** 焚毀穀倉：焦黑殘牆＋塌頂＋灰堆 */
function burntGranary(b: B) {
  const rng = b.rng;
  b.add(
    lathe(
      [
        [3.25, -0.1],
        [3.3, 0.32],
        [3.12, 0.48],
        [0, 0.48],
      ],
      12,
    ),
    null,
    sootStoneFace(),
  );
  for (let j = 0; j < 12; j++) {
    if (rng() < 0.2) continue;
    const a = (j / 12) * TAU;
    const h = rr(rng, 0.3, 2.0);
    b.add(bevelPrism(1.5, h, 0.22, 0.06), mat(Math.sin(a) * 2.9, 0.45, Math.cos(a) * 2.9, a, rr(rng, -0.08, 0.08), rr(rng, -0.05, 0.05)), charFace());
  }
  b.add(
    lathe(
      [
        [3.7, 0],
        [2.2, 0.55],
        [0.8, 1.0],
        [0, 1.1],
      ],
      12,
      { rMul: Array.from({ length: 12 }, () => rr(rng, 0.8, 1.08)) },
    ),
    mat(0.2, 0.55, 0.1, rng() * TAU, 0.18, -0.1),
    charFace(0.96, 0.02),
  );
  ashHeap(b, 1.8, 1.6, 0.6);
  for (let k = 0; k < 2; k++) {
    const a = Math.PI / 4 + k * Math.PI;
    logBetween(b, V(Math.sin(a) * 2.98, 0.4, Math.cos(a) * 2.98), V(Math.sin(a) * 2.95, rr(rng, 1.6, 2.4), Math.cos(a) * 2.95), 0.15, charFace(), 6, {}, 1);
  }
  logBetween(b, V(-2.5, 0.6, 1.5), V(2.0, 0.9, -2.2), 0.14, charFace(), 6, {}, 2);
}

/** 麻袋堆（直接加入，不走庫存排序） */
function sackPile(b: B, nx = 3, nz = 3) {
  pallet(b, nx, nz);
  const specs: SackSpec[] = [];
  sackPileSpecs(b.rng, new THREE.Matrix4(), nx, nz, specs, 0.12);
  for (const s of specs) b.add(sackGeo(), s.m, s.col);
}

/** 尖木柵欄段（沿 X，長 length，正面 +Z） */
function palisadeSegment(b: B, length: number) {
  palisadeLine(b, length);
}

/** 營門：雙柱、門楣隊伍色匾額、瓦頂、兩扇向內敞開的木樁門、紅燈籠（寬約 6.4 m） */
function palisadeGate(b: B, team: THREE.Color) {
  const wood = woodFace(C(PAL.wood));
  const woodD = woodFace(C(PAL.woodDark));
  const gold = C(PAL.gold);
  for (const s of [-1, 1]) {
    b.add(chamferBox(0.62, 4.5, 0.62, 0.08), mat(s * 2.75, 2.15, 0), wood, { jitter: 0.05 });
    b.add(lathe([[0.45, 0], [0.45, 0.12], [0, 0.45]], 4, { phase: Math.PI / 4, flat: true }), mat(s * 2.75, 4.4, 0), C(PAL.stoneDark));
  }
  b.add(chamferBox(6.6, 0.42, 0.56, 0.08), mat(0, 4.0, 0), woodD);
  b.add(chamferBox(5.5, 0.3, 0.42, 0.06), mat(0, 3.3, 0), wood);
  // 匾額
  b.add(chamferBox(1.95, 0.95, 0.1, 0.03), mat(0, 3.66, 0.3), gold);
  b.add(chamferBox(1.7, 0.72, 0.12, 0.03), mat(0, 3.66, 0.34), team);
  // 瓦頂
  const tile = C('#5d6d82');
  for (const s of [-1, 1]) b.add(chamferBox(7.2, 0.14, 1.0, 0.05), mat(0, 4.48, s * 0.33, 0, s * 0.5, 0), { face: (_c, n, out) => out.copy(tile).multiplyScalar(n.y > 0.3 ? 1.05 : 0.8) });
  logBetween(b, V(-3.7, 4.72, 0), V(3.7, 4.72, 0), 0.11, C('#4a5869'), 6, {}, 2);
  for (const s of [-1, 1]) b.add(lathe([[0.16, 0], [0.12, 0.25], [0, 0.32]], 5), mat(s * 3.7, 4.72, 0, 0, 0, -s * 0.5), tile);
  // 門扇（向內開 70°）
  for (const s of [-1, 1]) {
    b.push(mat(s * 2.4, 0, -0.1, s < 0 ? 70 * DEG : Math.PI - 70 * DEG));
    for (let i = 0; i < 5; i++) stake(b, 0.25 + i * 0.46, 0, 3.0 + (i % 2) * 0.12, 0.22, { ry: i * 1.3 });
    for (const y of [0.7, 2.1]) b.add(boxGeo(2.3, 0.16, 0.12), mat(1.15, y, -0.24), woodD);
    plankBetween(b, V(0.25, 0.75, -0.26), V(2.1, 2.05, -0.26), 0.14, 0.1, woodD);
    b.pop();
  }
  // 紅燈籠
  for (const s of [-1, 1]) {
    logBetween(b, V(s * 1.9, 3.15, 0.15), V(s * 1.9, 2.95, 0.15), 0.015, C(PAL.rope), 4, {}, 0);
    b.add(
      lathe(
        [
          [0, 0],
          [0.17, 0.04],
          [0.25, 0.24],
          [0.17, 0.44],
          [0, 0.48],
        ],
        6,
      ),
      mat(s * 1.9, 2.47, 0.15),
      { face: (c, _n, out) => out.copy(c.y < 0.06 || c.y > 0.42 ? gold : C(PAL.lacquer)) },
    );
  }
}

/** 望樓（高約 8.4 m）：四柱斜撐、平台、女牆掛隊伍色布、草頂、前方梯子 */
function watchtower(b: B, team: THREE.Color) {
  const wood = C(PAL.wood);
  const woodD = C(PAL.woodDark);
  const top = 5.2;
  const legs: THREE.Vector3[][] = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const p0 = V(sx * 1.4, -0.2, sz * 1.4);
      const p1 = V(sx * 1.05, 7.0, sz * 1.05);
      logBetween(b, p0, p1, 0.17, woodFace(wood), 6, { jitter: 0.06 }, 1);
      legs.push([p0, p1]);
    }
  const legAt = (sx: number, sz: number, y: number) => V(sx * (1.4 - (0.35 * (y + 0.2)) / 7.2), y, sz * (1.4 - (0.35 * (y + 0.2)) / 7.2));
  // X 形斜撐
  const sides: [number, number, number, number][] = [
    [-1, 1, 1, 1],
    [-1, -1, 1, -1],
    [1, -1, 1, 1],
    [-1, -1, -1, 1],
  ];
  for (const [ax, az, bx, bz] of sides) {
    logBetween(b, legAt(ax, az, 0.5), legAt(bx, bz, 4.6), 0.075, woodD, 5, {}, 0);
    logBetween(b, legAt(bx, bz, 0.5), legAt(ax, az, 4.6), 0.075, woodD, 5, {}, 0);
  }
  // 平台
  b.add(chamferBox(3.3, 0.3, 3.3, 0.08), mat(0, top - 0.15, 0), woodFace(C(PAL.plank)));
  // 女牆
  for (let k = 0; k < 4; k++) {
    b.push(mat(0, 0, 0, (k * Math.PI) / 2));
    b.add(chamferBox(3.3, 1.0, 0.14, 0.04), mat(0, top + 0.5, 1.58), woodFace(C(PAL.plank)), { jitter: 0.05 });
    b.pop();
  }
  b.add(chamferBox(1.6, 0.72, 0.05, 0.02), mat(0, top + 0.5, 1.68), team);
  b.add(chamferBox(1.0, 0.2, 0.06, 0.02), mat(0, top + 0.82, 1.7), C(PAL.gold));
  // 草頂
  b.add(
    lathe(
      [
        [1.7, 6.95],
        [2.45, 6.72],
        [2.55, 6.9],
        [0, 8.3],
      ],
      4,
      { phase: Math.PI / 4, flat: true },
    ),
    null,
    { face: (_c, n, out) => out.copy(n.y < 0 ? C(PAL.strawDark).multiplyScalar(0.75) : C(PAL.straw)) },
  );
  b.add(lathe([[0.2, 0], [0.14, 0.25], [0, 0.5]], 5), mat(0, 8.15, 0), C(PAL.strawDark));
  // 梯子（前方 +Z）
  const l0 = V(0, 0, 2.55);
  const l1 = V(0, top + 0.05, 1.68);
  for (const s of [-0.38, 0.38]) logBetween(b, V(s, l0.y - 0.1, l0.z), V(s, l1.y + 0.6, l1.z - 0.08), 0.06, woodD, 5, {}, 1);
  for (let i = 1; i <= 8; i++) {
    const t = i / 9;
    const p = l0.clone().lerp(l1, t);
    logBetween(b, V(-0.38, p.y, p.z), V(0.38, p.y, p.z), 0.04, wood, 4, {}, 0);
  }
  pennant(b, 1.05, 8.3, 1.05, team, 0.7);
  logBetween(b, V(1.05, 6.9, 1.05), V(1.05, 8.35, 1.05), 0.035, woodD, 4, {}, 1);
}

/** 旗桿（無貼圖版：旗面直接用頂點色；結構內會改用 CanvasTexture 飄動旗） */
function bannerPoleStatic(b: B, team: THREE.Color) {
  bannerPoleBase(b, 6.2);
  const top = 6.2 - 0.3;
  const W = 1.35;
  const H = 2.0;
  const edge = mixC(team, C(PAL.gold), 0.6);
  const pts = [V(0.08, top, 0), V(0.08 + W * 0.5, top, 0.12), V(0.08 + W, top, 0)];
  const bot = pts.map((p) => V(p.x, top - H, p.z * 0.5));
  for (let i = 0; i < 2; i++) b.add(polyGeo([bot[i], bot[i + 1], pts[i + 1], pts[i]], true), null, team);
  for (let i = 0; i < 4; i++) {
    const x0 = 0.08 + (i * W) / 4;
    b.add(polyGeo([V(x0, top - H, 0.04), V(x0 + W / 4, top - H, 0.04), V(x0 + W / 8, top - H - 0.22, 0.04)], true), null, edge);
  }
}

/** 旗桿本體：石座、紅漆桿、橫杆、金槍頭與紅纓 */
function bannerPoleBase(b: B, h: number, w = 1.35, left = false) {
  b.add(bevelPrism(0.66, 0.4, 0.66, 0.12), mat(0, 0, 0, 0.3), stoneFace());
  logBetween(b, V(0, 0.2, 0), V(0, h, 0), 0.075, C(PAL.lacquer), 6, {}, 1);
  const s = left ? -1 : 1;
  logBetween(b, V(0, h - 0.27, 0), V(s * (w + 0.12), h - 0.27, 0), 0.035, C(PAL.woodDark), 4, {}, 1);
  b.add(lathe([[0.09, 0], [0.11, 0.1], [0, 0.55]], 5), mat(0, h, 0), C(PAL.gold));
  b.add(blob(0.15, 0, b.rng, 0.15, 1, 1.3, 1), mat(0, h - 0.08, 0), C(PAL.lacquer));
}

/** 營火：石圈、交叉柴薪、餘燼、兩根坐木 */
function campfire(b: B) {
  const rng = b.rng;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + rr(rng, -0.1, 0.1);
    b.add(blob(0.22, 0, rng, 0.15, 1.1, 0.8, 1), mat(Math.sin(a) * 0.78, 0.1, Math.cos(a) * 0.78, rng() * TAU), stoneFace(), { jitter: 0.08 });
  }
  const ember = C(PAL.ember);
  b.add(
    lathe(
      [
        [0.72, 0.0],
        [0.55, 0.07],
        [0, 0.1],
      ],
      8,
    ),
    null,
    { vertex: (p, _n, out) => out.copy(Math.hypot(p.x, p.z) < 0.3 ? ember : C(PAL.charcoal)) },
  );
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const p0 = V(Math.sin(a) * 0.6, 0.02, Math.cos(a) * 0.6);
    const p1 = V(Math.sin(a + 0.6) * 0.08, 0.78, Math.cos(a + 0.6) * 0.08);
    const len = p0.distanceTo(p1);
    logBetween(b, p0, p1, 0.075, { face: (c, n, out) => out.copy(c.y > len * 0.55 ? C(PAL.charcoal) : Math.abs(n.y) > 0.8 ? C(PAL.woodFresh) : C(PAL.wood)) }, 5, {}, 1);
  }
  for (let i = 0; i < 3; i++) b.add(blob(0.12, 0, rng, 0.2), mat(rr(rng, -0.2, 0.2), 0.1, rr(rng, -0.2, 0.2)), ember);
  for (const a of [0.9, 3.6]) {
    const c = V(Math.sin(a) * 1.7, 0.2, Math.cos(a) * 1.7);
    const t = V(Math.cos(a) * 0.75, 0, -Math.sin(a) * 0.75);
    logBetween(b, c.clone().sub(t), c.clone().add(t), 0.2, woodFace(C(PAL.wood)), 6, {}, 1);
  }
}

/** 一個車輪（繞 X 軸），中心在原點 */
function wheel(b: B, r: number) {
  const woodD = C(PAL.woodDark);
  const iron = C(PAL.metalDark);
  b.push(mat(0, 0, 0, 0, 0, Math.PI / 2));
  b.add(
    lathe(
      [
        [r - 0.11, -0.07],
        [r, -0.07],
        [r, 0.07],
        [r - 0.11, 0.07],
        [r - 0.11, -0.07],
      ],
      9,
      { flat: true },
    ),
    null,
    { face: (c, _n, out) => out.copy(Math.hypot(c.x, c.z) > r - 0.02 ? iron : woodD) },
  );
  b.add(lathe([[0, -0.16], [0.14, -0.16], [0.14, 0.16], [0, 0.16]], 6), null, woodD);
  b.pop();
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.3;
    b.add(boxGeo(0.06, r * 2 - 0.2, 0.08), mat(0, 0, 0, 0, a), C(PAL.wood));
  }
}

/** 兩輪輜重車（車轅朝 +Z），車上堆麻袋 */
function wagon(b: B, team: THREE.Color) {
  const rng = b.rng;
  const plank = woodFace(C(PAL.plank));
  const wood = woodFace(C(PAL.wood));
  const y = 0.98;
  b.add(chamferBox(1.7, 0.14, 2.6, 0.04), mat(0, y, 0), plank);
  for (const s of [-1, 1]) {
    b.add(boxGeo(0.1, 0.36, 2.6), mat(s * 0.83, y + 0.24, 0), wood, { jitter: 0.06 });
    b.add(boxGeo(1.7, 0.36, 0.1), mat(0, y + 0.24, s * 1.27), wood, { jitter: 0.06 });
    // 車轅
    logBetween(b, V(s * 0.5, y - 0.12, -1.25), V(s * 0.42, y - 0.12, 3.3), 0.07, C(PAL.woodDark), 5, {}, 2);
    // 輪
    b.push(mat(s * 1.04, 0.72, -0.15));
    wheel(b, 0.72);
    b.pop();
  }
  logBetween(b, V(-0.5, y - 0.12, 3.15), V(0.5, y - 0.12, 3.15), 0.06, C(PAL.woodDark), 5, {}, 2);
  logBetween(b, V(-1.18, 0.72, -0.15), V(1.18, 0.72, -0.15), 0.06, C(PAL.woodDark), 5, {}, 1);
  // 前撐腳
  logBetween(b, V(0, 0, 1.6), V(0, y - 0.1, 1.45), 0.06, C(PAL.woodDark), 5, {}, 1);
  // 麻袋
  const specs: SackSpec[] = [];
  sackPileSpecs(rng, mat(0, y + 0.07, 0.0, Math.PI / 2), 3, 2, specs, 0);
  for (const s of specs) b.add(sackGeo(), s.m, s.col);
  pennant(b, -0.8, 2.25, -1.25, team, 0.5);
  logBetween(b, V(-0.8, y, -1.25), V(-0.8, 2.3, -1.25), 0.03, C(PAL.woodDark), 4, {}, 1);
}

/** 拒馬：橫木穿過交叉的雙尖木樁 */
function cheval(b: B) {
  const rng = b.rng;
  logBetween(b, V(-1.7, 0.55, 0), V(1.7, 0.55, 0), 0.14, woodFace(C(PAL.woodDark)), 6, {}, 2);
  const fresh = C(PAL.woodFresh);
  for (let i = 0; i < 4; i++) {
    const x = -1.2 + i * 0.8;
    for (const s of [-1, 1]) {
      const L = 2.2;
      const r = 0.075;
      const base = C(pick(rng, [PAL.wood, PAL.woodLight, PAL.plank])).multiplyScalar(rr(rng, 0.9, 1.1));
      const g = lathe(
        [
          [0, -L / 2],
          [r, -L / 2 + 0.3],
          [r, L / 2 - 0.3],
          [0, L / 2],
        ],
        5,
      );
      b.add(g, mat(x + s * 0.06, 0.55, 0, 0, s * (48 + (i % 2) * 6) * DEG, rr(rng, -0.08, 0.08)), {
        face: (c, _n, out) => out.copy(Math.abs(c.y) > L / 2 - 0.3 ? fresh : base),
      });
    }
    b.add(blob(0.11, 0, rng, 0.1, 1, 1, 1.2), mat(x, 0.55, 0), C(PAL.rope));
  }
}

/** 兵器架：長槍、戟、靠著的圓盾（隊伍色） */
function weaponRack(b: B, team: THREE.Color) {
  const rng = b.rng;
  const woodD = woodFace(C(PAL.woodDark));
  for (const s of [-1, 1]) {
    b.add(bevelPrism(0.16, 1.95, 0.16, 0.04), mat(s * 1.15, 0, 0), woodD);
    b.add(chamferBox(0.2, 0.14, 1.0, 0.04), mat(s * 1.15, 0.07, 0), woodD);
  }
  b.add(chamferBox(2.6, 0.16, 0.2, 0.04), mat(0, 1.8, 0), woodD);
  b.add(chamferBox(2.5, 0.12, 0.16, 0.03), mat(0, 0.45, 0.3), woodD);
  const steel = C(PAL.metal);
  for (let i = 0; i < 6; i++) {
    const x = -0.95 + i * 0.38;
    const p0 = V(x, 0.03, 0.32);
    const p1 = V(x + rr(rng, -0.05, 0.05), 2.65, -0.12);
    logBetween(b, p0, p1, 0.032, C(PAL.wood), 4, {}, 0);
    const dir = p1.clone().sub(p0).normalize();
    const tip = p1.clone().add(dir.clone().multiplyScalar(0.42));
    logBetween(b, p1, tip, 0.05, steel, 4, {}, 0, 0.001);
    b.add(lathe([[0, 0], [0.075, 0.1], [0, 0.2]], 4), mat(p1.x, p1.y - 0.2, p1.z), C(PAL.lacquer));
    if (i % 3 === 1) b.add(boxGeo(0.03, 0.3, 0.22), mat(p1.x, p1.y + 0.12, p1.z + 0.12, 0, -0.17), steel);
  }
  // 圓盾
  const gold = C(PAL.gold);
  for (const s of [-1, 1]) {
    b.add(
      lathe(
        [
          [0, 0],
          [0.48, 0],
          [0.5, 0.05],
          [0.42, 0.1],
          [0, 0.13],
        ],
        9,
      ),
      mat(s * 0.62, 0.44, 0.6, s * 0.15, 1.3, 0, 0.82),
      { face: (c, _n, out) => out.copy(Math.hypot(c.x, c.z) > 0.4 ? gold : team) },
    );
    b.add(lathe([[0.09, 0], [0.06, 0.05], [0, 0.07]], 6), mat(s * 0.62, 0.47, 0.7, s * 0.15, 1.3, 0), gold);
  }
}

/** 一個木桶（高 1 m） */
function barrel(b: B, m: THREE.Matrix4) {
  const seg = 9;
  const hoop = C(PAL.metalDark);
  const wood = C(PAL.wood);
  const woodL = C(PAL.woodLight);
  b.add(
    lathe(
      [
        [0, 0],
        [0.36, 0],
        [0.39, 0.1],
        [0.405, 0.18],
        [0.45, 0.5],
        [0.405, 0.82],
        [0.39, 0.9],
        [0.36, 1.0],
        [0, 0.98],
      ],
      seg,
    ),
    m,
    {
      face: (c, n, out) => {
        if (n.y > 0.8) out.copy(woodL);
        else if ((c.y > 0.09 && c.y < 0.19) || (c.y > 0.81 && c.y < 0.91)) out.copy(hoop);
        else out.copy(wood).multiplyScalar(angleIndex(c, seg) % 2 ? 1 : 0.88);
      },
    },
    { jitter: 0.06 },
  );
}

/** 木桶堆＋木箱 */
function barrels(b: B) {
  const rng = b.rng;
  barrel(b, mat(-0.45, 0, 0, rng()));
  barrel(b, mat(0.45, 0, -0.15, rng()));
  barrel(b, mat(0.1, 0.45, 0.85, 1.4, Math.PI / 2, 0));
  b.add(chamferBox(0.75, 0.6, 0.75, 0.06), mat(-0.75, 0.3, 0.95, 0.4), woodFace(C(PAL.plank)));
}

/** 戰鼓台：木台、紅漆大鼓（鼓面朝 +Z）、鼓架、鼓槌、小旗 */
function drumStand(b: B, team: THREE.Color) {
  const rng = b.rng;
  const plank = woodFace(C(PAL.plank));
  const woodD = woodFace(C(PAL.woodDark));
  const gold = C(PAL.gold);
  b.add(chamferBox(3.0, 0.36, 2.3, 0.07), mat(0, 0.18, 0), plank);
  b.add(chamferBox(1.3, 0.2, 0.45, 0.05), mat(0, 0.1, 1.38), plank);
  for (const s of [-1, 1]) {
    b.add(bevelPrism(0.22, 2.75, 0.22, 0.05), mat(s * 1.25, 0.36, 0), woodD);
    b.add(chamferBox(0.32, 0.72, 0.55, 0.05), mat(s * 0.55, 0.36 + 0.36, 0), woodD);
    pennant(b, s * 1.42, 3.55, 0, team, 0.5, s < 0 ? Math.PI : 0);
    logBetween(b, V(s * 1.42, 3.0, 0), V(s * 1.42, 3.6, 0), 0.03, C(PAL.woodDark), 4, {}, 1);
  }
  b.add(chamferBox(3.0, 0.24, 0.32, 0.06), mat(0, 3.12, 0), { face: (c, _n, out) => out.copy(Math.abs(c.x) > 1.35 ? gold : C(PAL.lacquer)) });
  // 鼓身（車床體繞 Y 後轉成沿 Z）
  const drumY = 1.62;
  b.add(
    lathe(
      [
        [0, -0.5],
        [0.78, -0.5],
        [0.86, -0.42],
        [0.95, 0],
        [0.86, 0.42],
        [0.78, 0.5],
        [0, 0.5],
      ],
      14,
    ),
    mat(0, drumY, 0, 0, Math.PI / 2),
    {
      face: (c, n, out) => {
        if (Math.abs(n.y) > 0.9) out.copy(C(PAL.drumHead));
        else if (Math.abs(c.y) > 0.4) out.copy(gold);
        else out.copy(C(PAL.lacquer));
      },
    },
  );
  // 鼓面中央隊伍色圓
  b.add(lathe([[0.36, 0], [0.3, 0.02], [0, 0.025]], 12), mat(0, drumY, 0.5, 0, Math.PI / 2), team);
  b.add(lathe([[0.36, 0], [0.3, 0.02], [0, 0.025]], 12), mat(0, drumY, -0.5, 0, -Math.PI / 2), team);
  // 鼓槌
  for (const s of [-1, 1]) {
    const p0 = V(s * 1.05, 0.4, 0.5);
    const p1 = V(s * 1.0, 1.3, 0.62 + 0.1);
    logBetween(b, p0, p1, 0.035, C(PAL.wood), 4, {}, 1);
    b.add(blob(0.09, 0, rng, 0.05), mat(p1.x, p1.y, p1.z), C(PAL.lacquer));
  }
}

/** 水井：石砌井欄、木架轆轤、小屋頂、吊桶 */
function well(b: B, burnt = false) {
  const rng = b.rng;
  b.add(
    lathe(
      [
        [1.05, -0.05],
        [1.09, 0.38],
        [1.1, 0.72],
        [1.02, 0.86],
        [0.8, 0.86],
        [0.74, 0.78],
        [0.74, 0.3],
        [0, 0.3],
      ],
      12,
      { phase: rng() },
    ),
    null,
    burnt
      ? sootStoneFace()
      : {
          face: (c, n, out) => {
            if (Math.hypot(c.x, c.z) < 0.7 && n.y > 0.5) out.copy(C(PAL.waterDeep));
            else if (n.x * c.x + n.z * c.z < 0) out.copy(C(PAL.stoneDark)).multiplyScalar(0.7);
            else stoneFace().face(c, n, out);
          },
        },
  );
  const wood = burnt ? charFace() : woodFace(C(PAL.woodDark));
  for (const s of [-1, 1]) b.add(bevelPrism(0.16, burnt ? 1.2 + rng() * 0.5 : 2.2, 0.16, 0.04), mat(s * 0.94, 0.8, 0), wood);
  if (burnt) {
    logBetween(b, V(-1.2, 0.95, 0.6), V(1.0, 0.1, 1.3), 0.08, charFace(), 5, {}, 1);
    return;
  }
  logBetween(b, V(-1.05, 2.55, 0), V(1.05, 2.55, 0), 0.09, woodFace(C(PAL.wood)), 6, {}, 2);
  logBetween(b, V(1.05, 2.55, 0), V(1.05, 2.3, 0.25), 0.03, C(PAL.woodDark), 4, {}, 1);
  logBetween(b, V(0, 2.5, 0), V(0, 1.55, 0), 0.015, C(PAL.rope), 4, {}, 0);
  b.add(
    lathe(
      [
        [0, 0],
        [0.17, 0],
        [0.2, 0.3],
        [0.17, 0.3],
        [0.15, 0.04],
        [0, 0.04],
      ],
      7,
    ),
    mat(0, 1.25, 0),
    { face: (c, _n, out) => out.copy(c.y > 0.2 ? C(PAL.metalDark) : C(PAL.wood)) },
  );
  for (const s of [-1, 1]) b.add(chamferBox(2.6, 0.1, 1.05, 0.04), mat(0, 3.12, s * 0.42, 0, s * 0.62, 0), woodFace(C(PAL.woodDark), C(PAL.wood)), { jitter: 0.05 });
  logBetween(b, V(-1.35, 3.43, 0), V(1.35, 3.43, 0), 0.07, C(PAL.woodDark), 5, {}, 2);
  for (const s of [-1, 1]) b.add(bevelPrism(0.12, 0.9, 0.12, 0.03), mat(s * 0.94, 2.55, 0), wood);
}

/** 木橋（沿 X 軸，長 L，寬 3.6 m，橋面高 0.55 m，橋墩下探到 -2.6 m） */
function bridge(b: B, L: number) {
  const rng = b.rng;
  const deckY = 0.55;
  const n = Math.max(2, Math.round(L / 0.5));
  const sp = L / n;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + sp * (i + 0.5);
    const g = bevelPrism(sp - 0.04, 3.6, 0.12, 0.03, true);
    b.add(g, mat(x, deckY - 0.06 + rr(rng, -0.015, 0.015), 1.8, 0, -Math.PI / 2), woodFace(C(pick(rng, [PAL.plank, PAL.wood, PAL.woodLight]))), { jitter: 0.05 });
  }
  const woodD = woodFace(C(PAL.woodDark));
  for (const s of [-1, 1]) b.add(chamferBox(L + 0.3, 0.3, 0.3, 0.06), mat(0, deckY - 0.25, s * 1.65), woodD);
  // 橋墩
  const np = Math.max(2, Math.round(L / 3.5) + 1);
  for (let i = 0; i < np; i++) {
    const x = -L / 2 + 0.6 + ((L - 1.2) * i) / (np - 1);
    for (const s of [-1, 1]) logBetween(b, V(x, -2.6, s * 1.5), V(x, deckY - 0.35, s * 1.5), 0.17, woodFace(C(PAL.wood)), 6, {}, 1);
    b.add(chamferBox(0.36, 0.26, 3.8, 0.05), mat(x, deckY - 0.3, 0), woodD);
  }
  // 欄杆
  const npost = Math.max(2, Math.round(L / 2.5) + 1);
  for (const s of [-1, 1]) {
    for (let i = 0; i < npost; i++) {
      const x = -L / 2 + 0.2 + ((L - 0.4) * i) / (npost - 1);
      b.add(bevelPrism(0.14, 1.05, 0.14, 0.035), mat(x, deckY, s * 1.82), woodD);
    }
    logBetween(b, V(-L / 2 + 0.1, deckY + 0.98, s * 1.82), V(L / 2 - 0.1, deckY + 0.98, s * 1.82), 0.065, C(PAL.wood), 6, {}, 2);
  }
  // 兩端引道
  for (const s of [-1, 1]) b.add(chamferBox(1.3, 0.12, 3.4, 0.04), mat(s * (L / 2 + 0.55), 0.26, 0, 0, 0, s * -0.4), woodFace(C(PAL.plank)));
}

/** 焚毀殘骸（約 4 m 範圍） */
function burntDebris(b: B) {
  debris(b, 1.1);
}

// ───────────────────────── propGeometry ─────────────────────────

/** 依種類把道具加入建構器（在建構器目前座標系） */
function addProp(b: B, kind: PropKind, team: THREE.Color, length?: number) {
  switch (kind) {
    case 'tent':
      return tent(b, team);
    case 'commandTent':
      return commandTent(b, team);
    case 'granary':
      return granary(b);
    case 'sackPile':
      return sackPile(b);
    case 'palisadeSegment':
      return palisadeSegment(b, length ?? 6);
    case 'palisadeGate':
      return palisadeGate(b, team);
    case 'watchtower':
      return watchtower(b, team);
    case 'bannerPole':
      return bannerPoleStatic(b, team);
    case 'campfire':
      return campfire(b);
    case 'wagon':
      return wagon(b, team);
    case 'cheval':
      return cheval(b);
    case 'weaponRack':
      return weaponRack(b, team);
    case 'barrels':
      return barrels(b);
    case 'drumStand':
      return drumStand(b, team);
    case 'well':
      return well(b);
    case 'bridge':
      return bridge(b, length ?? 10);
    case 'burntDebris':
      return burntDebris(b);
  }
}

/** 單一道具合併幾何（position/normal/color），用 propMaterial 畫；呼叫端請自行快取 */
export function propGeometry(kind: PropKind, opts: PropOptions = {}): THREE.BufferGeometry {
  const b = new GeoBuilder(makeRng(opts.seed ?? 1));
  addProp(b, kind, new THREE.Color(opts.team ?? DEFAULT_TEAM), opts.length);
  const g = b.toGeometry({ ao: 0.28, aoHeight: 1.0 });
  g.name = kind;
  return g;
}

// ───────────────────────── 旗幟（CanvasTexture＋頂點飄動） ─────────────────────────

const FLAG_FONT = '"Noto Serif TC", "Songti TC", "STSong", "SimSun", "PMingLiU", serif';

function isYellowish(c: THREE.Color) {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.h > 0.09 && hsl.h < 0.2 && hsl.s > 0.35 && hsl.l > 0.3;
}

/** 畫牙旗：隊伍色旗面、火焰牙邊、內框、大字 */
function drawFlag(cv: HTMLCanvasElement, team: THREE.Color, text: string, left: boolean) {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const w = cv.width;
  const h = cv.height;
  const yellow = isYellowish(team);
  const field = '#' + team.getHexString();
  const toothCol = yellow ? '#b3261e' : '#f2c14e';
  const dark = '#' + team.clone().multiplyScalar(0.28).getHexString();
  const T = Math.round(w * 0.14);
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  if (left) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  // 牙邊：右側與下緣的火焰齒
  ctx.fillStyle = toothCol;
  const nR = 7;
  const fh = h - T;
  for (let i = 0; i < nR; i++) {
    const y0 = (fh / nR) * i;
    const y1 = (fh / nR) * (i + 1);
    ctx.beginPath();
    ctx.moveTo(w - T - 4, y0);
    ctx.quadraticCurveTo(w - T * 0.2, y0 + (y1 - y0) * 0.15, w - 1, y1 - (y1 - y0) * 0.15);
    ctx.lineTo(w - T - 4, y1);
    ctx.closePath();
    ctx.fill();
  }
  const nB = 4;
  const fw = w - T;
  for (let i = 0; i < nB; i++) {
    const x0 = (fw / nB) * i;
    const x1 = (fw / nB) * (i + 1);
    ctx.beginPath();
    ctx.moveTo(x0, h - T - 4);
    ctx.quadraticCurveTo(x0 + (x1 - x0) * 0.2, h - T * 0.2, x1 - (x1 - x0) * 0.1, h - 1);
    ctx.lineTo(x1, h - T - 4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(w - T - 4, h - T - 4);
  ctx.lineTo(w - 1, h - 1);
  ctx.lineTo(w - T - 4, h - T * 0.3);
  ctx.closePath();
  ctx.fill();
  // 旗面
  ctx.fillStyle = field;
  ctx.fillRect(0, 0, w - T, h - T);
  ctx.strokeStyle = toothCol;
  ctx.lineWidth = Math.max(4, w * 0.025);
  const ins = w * 0.06;
  ctx.strokeRect(ins, ins, w - T - ins * 2, h - T - ins * 2);
  ctx.restore();
  // 大字
  const cx = left ? T + (w - T) / 2 : (w - T) / 2;
  const cy = (h - T) / 2 + h * 0.01;
  const size = Math.round((w - T) * 0.74);
  ctx.font = `900 ${size}px ${FLAG_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.11;
  ctx.strokeStyle = dark;
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = yellow ? '#fffaf0' : '#ffd84d';
  ctx.fillText(text, cx, cy);
}

const FLAG_HEAD = /* glsl */ `
attribute vec4 aFlag; // x: 離旗桿距離 0..1, y: 由上而下 0..1, z: 帶正負的旗寬, w: 旗高
uniform float uTime;
vec3 qjlFlagWave(out float wz) {
  float fu = aFlag.x;
  float fv = aFlag.y;
  float W = aFlag.z;
  float ph = modelMatrix[3].x * 0.37 + modelMatrix[3].z * 0.29;
  float A = 0.1 * abs(W) * (0.45 + 0.55 * fv);
  float amp = A * fu;
  float a1 = fu * 5.5 - uTime * 3.4 + ph + fv * 1.1;
  float a2 = fu * 9.0 - uTime * 5.3 + ph * 1.7 - fv * 0.8;
  float s = sin(a1) + 0.35 * sin(a2);
  wz = amp * s;
  float dzdu = amp * (5.5 * cos(a1) + 3.15 * cos(a2)) + A * s;
  float dzdv = amp * (1.1 * cos(a1) - 0.28 * cos(a2)) + 0.1 * abs(W) * 0.55 * fu * s;
  return normalize(vec3(-dzdu / W, dzdv / aFlag.w, 1.0));
}
`;

const flagMats = new Map<string, THREE.MeshStandardMaterial>();
const flagGeos = new Map<string, THREE.BufferGeometry>();

/** 旗面幾何：PlaneGeometry，旗桿側在 x=0，向 +X（left 時向 -X）展開，上緣在 y=0 */
function flagClothGeometry(w: number, h: number, left: boolean): THREE.BufferGeometry {
  const key = `${w.toFixed(2)}|${h.toFixed(2)}|${left}`;
  const hit = flagGeos.get(key);
  if (hit) return hit;
  const g = new THREE.PlaneGeometry(w, h, 8, 6);
  g.translate(left ? -w / 2 : w / 2, -h / 2, 0);
  const uv = g.getAttribute('uv');
  const af = new Float32Array(uv.count * 4);
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    af[i * 4] = left ? 1 - u : u;
    af[i * 4 + 1] = 1 - uv.getY(i);
    af[i * 4 + 2] = left ? -w : w;
    af[i * 4 + 3] = h;
  }
  g.setAttribute('aFlag', new THREE.BufferAttribute(af, 4));
  flagGeos.set(key, g);
  return g;
}

/** 牙旗材質（依隊伍色＋字快取）：CanvasTexture、雙面、alphaTest 剪出牙邊、propTime 驅動飄動 */
export function flagMaterial(team: THREE.ColorRepresentation, text: string, left = false): THREE.MeshStandardMaterial {
  const tc = new THREE.Color(team);
  const key = `${tc.getHexString()}|${text}|${left}`;
  const hit = flagMats.get(key);
  if (hit) return hit;
  let tex: THREE.Texture | null = null;
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 400;
    drawFlag(cv, tc, text, left);
    const ct = new THREE.CanvasTexture(cv);
    ct.colorSpace = THREE.SRGBColorSpace;
    ct.anisotropy = 4;
    tex = ct;
    // 網頁字型載入後重畫
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts) {
      fonts
        .load(`900 64px "Noto Serif TC"`, text)
        .then(() => {
          drawFlag(cv, tc, text, left);
          ct.needsUpdate = true;
        })
        .catch(() => {});
    }
  }
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    color: tex ? 0xffffff : tc,
    side: THREE.DoubleSide,
    roughness: 0.78,
    metalness: 0,
    alphaTest: 0.5,
  });
  m.name = 'flag:' + text;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = propTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FLAG_HEAD)
      .replace('#include <beginnormal_vertex>', 'float qjlWz;\nvec3 objectNormal = qjlFlagWave(qjlWz);')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position);\ntransformed.z += qjlWz;');
  };
  m.customProgramCacheKey = () => 'qjl-flag';
  flagMats.set(key, m);
  return m;
}

/** 旗面陰影用的深度材質（同樣飄動） */
let _flagDepth: Map<string, THREE.MeshDepthMaterial> | null = null;
function flagDepthMaterial(src: THREE.MeshStandardMaterial): THREE.MeshDepthMaterial {
  _flagDepth ??= new Map();
  const hit = _flagDepth.get(src.uuid);
  if (hit) return hit;
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: src.map, alphaTest: 0.5 });
  d.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = propTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FLAG_HEAD)
      .replace('#include <begin_vertex>', 'float qjlWz;\nqjlFlagWave(qjlWz);\nvec3 transformed = vec3(position);\ntransformed.z += qjlWz;');
  };
  d.customProgramCacheKey = () => 'qjl-flag-depth';
  _flagDepth.set(src.uuid, d);
  return d;
}

/** 建立一面飄動旗面 Mesh（上緣中心在旗桿側 x=0,y=0） */
function makeCloth(team: THREE.ColorRepresentation, text: string, w: number, h: number, left: boolean): THREE.Mesh {
  const mtl = flagMaterial(team, text, left);
  const mesh = new THREE.Mesh(flagClothGeometry(w, h, left), mtl);
  mesh.customDepthMaterial = flagDepthMaterial(mtl);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'flagCloth';
  return mesh;
}

/**
 * 獨立的一支大旗（旗桿＋寫字飄動旗面），給軍團、劇本裝飾用。
 * 原點在旗桿底；left=true 時旗面往 -X 展開（字仍正向朝 +Z）
 */
export function buildBanner(opts: { team: THREE.ColorRepresentation; text: string; height?: number; big?: boolean; left?: boolean; seed?: number }): THREE.Group {
  const big = !!opts.big;
  const h = opts.height ?? (big ? 8.2 : 6.2);
  const w = big ? 1.9 : 1.35;
  const fh = big ? 2.9 : 2.0;
  const b = new GeoBuilder(makeRng(opts.seed ?? 1));
  bannerPoleBase(b, h, w, !!opts.left);
  const group = new THREE.Group();
  group.name = 'banner';
  const pole = new THREE.Mesh(b.toGeometry({ ao: 0.25, aoHeight: 0.6 }), propMaterial);
  pole.castShadow = true;
  pole.receiveShadow = true;
  group.add(pole);
  const cloth = makeCloth(opts.team, opts.text, w, fh, !!opts.left);
  cloth.position.set(opts.left ? -0.09 : 0.09, h - 0.32, 0);
  group.add(cloth);
  return group;
}

// ───────────────────────── 結構（糧倉大營、本陣、營寨、水源） ─────────────────────────

export interface StructureVisual {
  group: THREE.Group;
  radius: number;
  fireAnchors: THREE.Vector3[];
  setStock(frac: number): void;
  setBurnt(burnt: boolean): void;
  setHeight?(fn: (x: number, z: number) => number): void;
}

interface FlagSpec {
  x: number;
  z: number;
  h: number;
  w: number;
  fh: number;
  left: boolean;
  ry: number;
}

interface Assembly {
  rng: Rng;
  team: THREE.Color;
  text: string;
  radius: number;
  intact: GeoBuilder;
  burnt: GeoBuilder;
  pad: GeoBuilder;
  sacks: SackSpec[];
  flags: FlagSpec[];
  fire: THREE.Vector3[];
}

function newAssembly(seed: number, team: THREE.ColorRepresentation, text: string, radius: number): Assembly {
  return {
    rng: makeRng(seed),
    team: new THREE.Color(team),
    text,
    radius,
    intact: new GeoBuilder(makeRng(seed * 7 + 1)),
    burnt: new GeoBuilder(makeRng(seed * 13 + 5)),
    pad: new GeoBuilder(makeRng(seed * 3 + 2)),
    sacks: [],
    flags: [],
    fire: [],
  };
}

/** 在結構中放一個道具：完好版放 intact、焚毀版放 burnt（同一位置，整組以原點貼地） */
/** 地墊內部約高 0.1 m，結構內的道具整體墊高一點避免陷進地墊 */
const PAD_LIFT = 0.08;

function place(A: Assembly, m0: THREE.Matrix4, fi: (b: B) => void, fb?: (b: B) => void) {
  const m = new THREE.Matrix4().makeTranslation(0, PAD_LIFT, 0).multiply(m0);
  A.intact.push(m, true);
  fi(A.intact);
  A.intact.pop();
  if (fb) {
    A.burnt.push(m, true);
    fb(A.burnt);
    A.burnt.pop();
  }
}

/** 夯土地面墊（微微隆起、邊緣沒入地面），每頂點貼地 */
function groundPad(A: Assembly, R: number) {
  const rng = A.pad.rng;
  const seg = 28;
  const ph1 = rng() * TAU;
  const ph2 = rng() * TAU;
  const rMul = Array.from({ length: seg }, (_, j) => 1 + 0.035 * Math.sin((j / seg) * TAU * 3 + ph1) + 0.02 * Math.sin((j / seg) * TAU * 5 + ph2));
  const dirt = C(PAL.dirt);
  const dirtD = C(PAL.dirtDark);
  A.pad.add(
    lathe(
      [
        [R, -0.1],
        [R - 1.0, 0.06],
        [R * 0.8, 0.09],
        [R * 0.6, 0.1],
        [R * 0.4, 0.1],
        [R * 0.2, 0.1],
        [0, 0.1],
      ],
      seg,
      { rMul },
    ),
    null,
    {
      vertex: (p, _n, out) => {
        const k = hash3(Math.round(p.x), 0, Math.round(p.z));
        out.copy(dirt).lerp(dirtD, 0.25 + 0.35 * k);
        if (Math.hypot(p.x, p.z) > R - 1.2) out.lerp(C('#7d9a45'), 0.35);
      },
    },
    { anchor: 'vertex' },
  );
  // 焚毀時地面焦痕（低頻起伏的不規則圓）
  const p3 = rng() * TAU;
  const p4 = rng() * TAU;
  const sc = Array.from({ length: 24 }, (_, j) => 0.85 + 0.1 * Math.sin((j / 24) * TAU * 2 + p3) + 0.07 * Math.sin((j / 24) * TAU * 5 + p4));
  A.burnt.add(
    lathe(
      [
        [R * 0.8, 0.115],
        [R * 0.55, 0.125],
        [R * 0.28, 0.13],
        [0, 0.13],
      ],
      24,
      { rMul: sc },
    ),
    null,
    { vertex: (p, _n, out) => out.copy(C(PAL.charcoal)).lerp(C(PAL.ash), hash3(Math.round(p.x * 0.7), 1, Math.round(p.z * 0.7)) * 0.5) },
    { anchor: 'vertex' },
  );
}

/** 營門缺口兩側的門柱＋旗 */
function gatePosts(A: Assembly, R: number, gapHalf: number, withFlags: boolean) {
  for (const s of [-1, 1]) {
    const x = s * (gapHalf + 0.15);
    const z = Math.sqrt(Math.max(0, R * R - x * x));
    place(
      A,
      mat(x, 0, z),
      (b) => {
        b.add(chamferBox(0.6, 3.3, 0.6, 0.08), mat(0, 1.55, 0), woodFace(C(PAL.wood)));
        b.add(lathe([[0.45, 0], [0.45, 0.1], [0, 0.42]], 4, { phase: Math.PI / 4, flat: true }), mat(0, 3.2, 0), C(PAL.stoneDark));
      },
      (b) => stake(b, 0, 0, 1.6, 0.3, { burnt: true, broken: true }),
    );
    if (withFlags) addFlag(A, x + s * 0.9, z - 1.0, 5.6, false, s < 0);
  }
}

/** 加一支寫字旗（桿子放 intact，旗面另建 Mesh；焚毀版留焦桿） */
function addFlag(A: Assembly, x: number, z: number, h: number, big: boolean, left: boolean) {
  const w = big ? 1.9 : 1.35;
  const fh = big ? 2.9 : 2.0;
  place(
    A,
    mat(x, 0, z),
    (b) => bannerPoleBase(b, h, w, left),
    (b) => {
      b.add(chamferBox(0.7, 0.4, 0.7, 0.08), mat(0, 0.2, 0), sootStoneFace());
      logBetween(b, V(0, 0.2, 0), V(0.15, h * 0.45, 0.1), 0.075, charFace(), 6, {}, 1);
    },
  );
  A.flags.push({ x, z, h, w, fh, left, ry: 0 });
}

/** 加一堆會隨庫存縮小的麻袋（含棧板；焚毀版是灰堆） */
function addStockPile(A: Assembly, x: number, z: number, ry: number, nx: number, nz: number) {
  const m = mat(x, 0, z, ry);
  const ms = mat(x, PAD_LIFT, z, ry);
  place(
    A,
    m,
    (b) => pallet(b, nx, nz),
    (b) => ashHeap(b, nx * 0.5, nz * 0.38, 0.35 + Math.min(nx, nz) * 0.08),
  );
  sackPileSpecs(A.rng, ms, nx, nz, A.sacks, 0.12);
  A.fire.push(V(x, 0.4 + Math.min(nx, nz) * 0.25, z));
}

/** 組裝完成：合併成少數 Mesh，提供 StructureVisual 介面 */
function finalize(A: Assembly, name: string, extra?: { objects?: THREE.Object3D[]; onStock?: (f: number) => void; onBurnt?: (b: boolean) => void }): StructureVisual {
  // 麻袋依層排序後接在 intact 最後，setStock 用 drawRange 由上層開始隱藏
  A.sacks.sort((a, b) => a.layer - b.layer || a.order - b.order);
  const marks: number[] = [A.intact.vertexCount];
  const sg = sackGeo();
  for (const s of A.sacks) {
    A.intact.add(sg, s.m, s.col, { anchorAt: [s.ax, s.az] });
    marks.push(A.intact.vertexCount);
  }
  const mk = (b: GeoBuilder, nm: string, ao: number) => {
    const mesh = new THREE.Mesh(b.toGeometry({ ao, aoHeight: 1.0, anchors: true }), propMaterial);
    mesh.name = nm;
    mesh.castShadow = nm !== 'groundPad';
    mesh.receiveShadow = true;
    return mesh;
  };
  const group = new THREE.Group();
  group.name = name;
  const pad = mk(A.pad, 'groundPad', 0);
  const intact = mk(A.intact, 'intact', 0.28);
  const burnt = mk(A.burnt, 'burnt', 0.15);
  burnt.visible = false;
  group.add(pad, intact, burnt);
  const flagGroup = new THREE.Group();
  flagGroup.name = 'flags';
  for (const f of A.flags) {
    const cloth = makeCloth(A.team, A.text, f.w, f.fh, f.left);
    cloth.position.set(f.x + (f.left ? -0.09 : 0.09), f.h - 0.32, f.z);
    cloth.rotation.y = f.ry;
    cloth.userData.anchor = [f.x, f.z];
    cloth.userData.baseY = cloth.position.y;
    flagGroup.add(cloth);
  }
  group.add(flagGroup);
  for (const o of extra?.objects ?? []) group.add(o);
  let flagTris = 0;
  for (const c of flagGroup.children) {
    const g = (c as THREE.Mesh).geometry;
    flagTris += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  }
  // 三角形統計：visible＝完好狀態實際會畫的（地墊＋完好＋旗面）
  group.userData.triangles = {
    intact: A.intact.triangles,
    burnt: A.burnt.triangles,
    pad: A.pad.triangles,
    flags: flagTris,
    visible: A.pad.triangles + A.intact.triangles + flagTris,
    visibleBurnt: A.pad.triangles + A.burnt.triangles,
  };

  const fireBase = A.fire.map((p) => p.y);
  let stock = 1;
  let isBurnt = false;
  const applyStock = () => {
    const n = stock <= 0 ? 0 : Math.max(1, Math.round(stock * A.sacks.length));
    intact.geometry.setDrawRange(0, marks[Math.min(n, marks.length - 1)]);
  };
  const vis: StructureVisual = {
    group,
    radius: A.radius,
    fireAnchors: A.fire,
    setStock(frac: number) {
      stock = Math.min(1, Math.max(0, frac));
      applyStock();
      extra?.onStock?.(stock);
    },
    setBurnt(b: boolean) {
      isBurnt = b;
      intact.visible = !isBurnt;
      flagGroup.visible = !isBurnt;
      burnt.visible = isBurnt;
      extra?.onBurnt?.(isBurnt);
    },
    setHeight(fn: (x: number, z: number) => number) {
      group.updateWorldMatrix(true, false);
      const mw = group.matrixWorld;
      const sy = new THREE.Vector3().setFromMatrixScale(mw).y || 1;
      const tmp = new THREE.Vector3();
      const dyAt = (ax: number, az: number) => {
        tmp.set(ax, 0, az).applyMatrix4(mw);
        return (fn(tmp.x, tmp.z) - tmp.y) / sy;
      };
      for (const mesh of [pad, intact, burnt]) {
        const g = mesh.geometry;
        const anc = g.userData.anchors as Float32Array;
        const pos = g.getAttribute('position') as THREE.BufferAttribute;
        g.userData.baseY ??= Float32Array.from({ length: pos.count }, (_, i) => pos.getY(i));
        const base = g.userData.baseY as Float32Array;
        let lx = NaN;
        let lz = NaN;
        let ld = 0;
        for (let i = 0; i < pos.count; i++) {
          const ax = anc[i * 2];
          const az = anc[i * 2 + 1];
          if (ax !== lx || az !== lz) {
            ld = dyAt(ax, az);
            lx = ax;
            lz = az;
          }
          pos.setY(i, base[i] + ld);
        }
        pos.needsUpdate = true;
        g.computeBoundingSphere();
        g.computeBoundingBox();
      }
      for (const o of [...flagGroup.children, ...(extra?.objects ?? [])]) {
        const a = o.userData.anchor as [number, number] | undefined;
        if (!a) continue;
        o.position.y = (o.userData.baseY as number) + dyAt(a[0], a[1]);
      }
      A.fire.forEach((p, i) => (p.y = fireBase[i] + dyAt(p.x, p.z)));
    },
  };
  applyStock();
  return vis;
}

/** 糧倉大營：2–4 座圓形草頂穀倉＋麻袋堆＋一圈尖木柵欄（+Z 缺口）＋勢力旗 */
export function buildDepot(opts: { team: THREE.ColorRepresentation; flagText: string; main?: boolean; seed?: number }): StructureVisual {
  const main = !!opts.main;
  const A = newAssembly(opts.seed ?? (main ? 11 : 5), opts.team, opts.flagText, main ? 22 : 15);
  const rng = A.rng;
  const palR = A.radius - 1.4;
  const gapHalf = main ? 3.6 : 3.0;
  groundPad(A, palR + 1.0);
  palisadeRing(A.intact, palR, gapHalf);
  palisadeRing(A.burnt, palR, gapHalf, true);
  gatePosts(A, palR, gapHalf, true);

  // 穀倉
  const gs = main ? 1.2 : 1.0;
  const n = main ? 4 : rng() < 0.75 ? 3 : 2;
  const spots: [number, number][] = main
    ? [
        [150, 11.6],
        [-150, 11.6],
        [80, 11.2],
        [-80, 11.2],
      ]
    : n === 3
      ? [
          [180, 7.4],
          [100, 7.6],
          [-100, 7.6],
        ]
      : [
          [135, 7.2],
          [-135, 7.2],
        ];
  for (const [deg, r] of spots) {
    const a = deg * DEG;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    place(A, mat(x, 0, z, a + Math.PI + rr(rng, -0.25, 0.25), 0, 0, gs), granary, burntGranary);
    A.fire.push(V(x, 4.3 * gs, z), V(x + Math.sin(a + 1.2) * 2.6 * gs, 1.6 * gs, z + Math.cos(a + 1.2) * 2.6 * gs));
  }

  // 麻袋堆（庫存）
  if (main) {
    addStockPile(A, 0, -1.2, 0, 4, 3);
    addStockPile(A, -3.7, 4.6, 0.15, 3, 2);
    addStockPile(A, 3.7, 4.6, -0.15, 3, 2);
    addStockPile(A, -7.0, 11.0, 0.5, 3, 2);
    addStockPile(A, 7.0, 11.0, -0.5, 3, 2);
  } else {
    addStockPile(A, 0, 1.3, 0, 4, 3);
    addStockPile(A, -4.6, 6.6, 0.35, 3, 2);
    addStockPile(A, 4.6, 6.6, -0.35, 3, 2);
  }

  // 中央大旗
  addFlag(A, main ? 0.6 : -0.9, main ? -6.0 : -2.5, main ? 8.2 : 7.0, main, false);

  // 雜項
  if (main) {
    // 主倉預算留給 4 座大穀倉與麻袋；輜重車由主程式動態派出，這裡不放
    place(A, mat(10.6, 0, 11.6, -0.3), barrels, (b) => debris(b, 0.6));
  } else {
    place(A, mat(-8.0, 0, 7.0, 0.65), (b) => wagon(b, A.team), (b) => debris(b, 0.8));
    place(A, mat(8.0, 0, 6.6, -0.4), barrels, (b) => debris(b, 0.6));
  }
  return finalize(A, main ? 'depotMain' : 'depot');
}

/** 本陣：主帥大帳＋小帳篷＋戰鼓台＋大旗＋柵欄營牆與營門（+Z）＋糧草堆；半徑約 24 m */
export function buildHQ(opts: { team: THREE.ColorRepresentation; flagText: string; seed?: number }): StructureVisual {
  const A = newAssembly(opts.seed ?? 21, opts.team, opts.flagText, 24);
  const rng = A.rng;
  const palR = 21.6;
  groundPad(A, palR + 1.0);
  palisadeRing(A.intact, palR, 3.25);
  palisadeRing(A.burnt, palR, 3.25, true);
  place(A, mat(0, 0, palR), (b) => palisadeGate(b, A.team), (b) => {
    for (const s of [-1, 1]) stake(b, s * 2.75, 0, rr(b.rng, 1.2, 2.4), 0.32, { burnt: true, broken: true });
    debris(b, 0.9);
  });
  A.fire.push(V(0, 3.0, palR));

  // 主帥帳
  place(A, mat(0, 0, -5), (b) => commandTent(b, A.team), burntCommandTent);
  A.fire.push(V(0, 4.2, -5), V(3.2, 1.6, -3), V(-3.2, 1.6, -3));
  addFlag(A, -6.6, 0.2, 8.2, true, true);
  addFlag(A, 6.6, 0.2, 8.2, true, false);
  addFlag(A, -4.6, palR - 2.2, 5.6, false, true);
  addFlag(A, 4.6, palR - 2.2, 5.6, false, false);

  // 小帳篷（面向中心）
  for (const deg of [58, 100, 142, -58, -100, -142]) {
    const a = deg * DEG;
    const r = 15.2 + rr(rng, -0.6, 0.6);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    place(A, mat(x, 0, z, a + Math.PI + rr(rng, -0.15, 0.15), 0, 0, rr(rng, 0.95, 1.08)), (b) => tent(b, A.team), burntTent);
    A.fire.push(V(x, 1.6, z));
  }
  // 戰鼓台
  place(A, mat(-7.6, 0, 7.4, 1.25), (b) => drumStand(b, A.team), (b) => debris(b, 0.8));
  // 糧草堆
  addStockPile(A, 8.6, 1.8, 0.1, 3, 3);
  addStockPile(A, 9.2, -3.0, -0.2, 3, 2);
  place(A, mat(5.6, 0, 9.0, -0.4), (b) => wagon(b, A.team), (b) => debris(b, 0.8));
  place(A, mat(11.5, 0, 5.6, 0.3), barrels, (b) => debris(b, 0.6));
  // 兵器架、營火
  place(A, mat(-10.6, 0, 0.8, Math.PI / 2), (b) => weaponRack(b, A.team), (b) => debris(b, 0.6));
  place(A, mat(-10.4, 0, -3.6, Math.PI / 2), (b) => weaponRack(b, A.team), (b) => debris(b, 0.6));
  place(A, mat(6.4, 0, 14.0), campfire);
  place(A, mat(-6.4, 0, 14.0), campfire);
  // 望樓
  for (const s of [-1, 1]) {
    place(A, mat(s * 14.6, 0, -12.6, s * -0.6), (b) => watchtower(b, A.team), (b) => debris(b, 1.2));
    A.fire.push(V(s * 14.6, 5.6, -12.6));
  }
  // 營門外拒馬
  for (const s of [-1, 1]) place(A, mat(s * 6.6, 0, palR + 1.5, s * 0.12), cheval, (b) => debris(b, 0.6));
  return finalize(A, 'hq');
}

/** 一般營寨（夷陵連營用）：數頂帳篷＋柵欄＋小糧堆＋旗，半徑約 12 m */
export function buildCamp(opts: { team: THREE.ColorRepresentation; flagText: string; seed?: number }): StructureVisual {
  const A = newAssembly(opts.seed ?? 31, opts.team, opts.flagText, 12);
  const rng = A.rng;
  const palR = 10.6;
  const gapHalf = 2.6;
  groundPad(A, palR + 0.9);
  palisadeRing(A.intact, palR, gapHalf);
  palisadeRing(A.burnt, palR, gapHalf, true);
  gatePosts(A, palR, gapHalf, false);
  const nT = 3 + Math.floor(rng() * 3);
  const tentSpots = [-150, 150, -88, 88, 180].slice(0, nT);
  for (const deg of tentSpots) {
    const a = deg * DEG;
    const r = 6.3 + rr(rng, -0.4, 0.3);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    place(A, mat(x, 0, z, a + Math.PI + rr(rng, -0.2, 0.2), 0, 0, rr(rng, 0.92, 1.05)), (b) => tent(b, A.team), burntTent);
    A.fire.push(V(x, 1.6, z));
  }
  place(A, mat(0, 0, 0.6), campfire);
  addStockPile(A, -3.9, 4.8, 0.4, 3, 2);
  place(A, mat(-5.9, 0, 3.0, 0.8), barrels, (b) => debris(b, 0.5));
  place(A, mat(4.2, 0, 4.8, -0.5), (b) => weaponRack(b, A.team), (b) => debris(b, 0.5));
  addFlag(A, 2.2, 7.2, 6.0, false, false);
  addFlag(A, nT >= 5 ? 2.6 : 0.4, nT >= 5 ? -4.4 : -6.0, 7.0, false, false);
  return finalize(A, 'camp');
}

/** 水源（街亭）：山腳泉池（石砌池＋竹管泉水）＋水井＋木架；setStock 表示水量 */
export function buildWaterSource(opts: { team?: THREE.ColorRepresentation; seed?: number }): StructureVisual {
  const A = newAssembly(opts.seed ?? 41, opts.team ?? DEFAULT_TEAM, '水', 8);
  groundPad(A, 7.2);
  const poolR = 2.75;
  // 石砌池欄（池底在地面上，避免被地形吃掉）
  const curb = (b: B, soot: boolean) => {
    b.add(
      lathe(
        [
          [3.35, -0.1],
          [3.42, 0.42],
          [3.25, 0.62],
          [poolR + 0.1, 0.62],
          [poolR, 0.52],
          [poolR, 0.1],
          [0, 0.1],
        ],
        14,
        { phase: 0.2 },
      ),
      null,
      soot
        ? sootStoneFace()
        : {
            face: (c, n, out) => {
              const rc = Math.hypot(c.x, c.z);
              if (rc < poolR - 0.05 && n.y > 0.5) out.copy(C('#5e4a30')); // 乾掉的泥底
              else if (rc < poolR + 0.02 && n.y < 0.5) out.copy(C(PAL.stoneDark)).multiplyScalar(0.75); // 池內壁
              else stoneFace().face(c, n, out);
            },
          },
    );
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.5 + rr(b.rng, -0.2, 0.2);
      b.add(blob(rr(b.rng, 0.35, 0.55), 0, b.rng, 0.18, 1.2, 0.75, 1), mat(Math.sin(a) * 3.3, 0.55, Math.cos(a) * 3.3, b.rng() * TAU), soot ? sootStoneFace() : stoneFace(), { jitter: 0.08 });
    }
  };
  place(A, new THREE.Matrix4(), (b) => curb(b, false), (b) => curb(b, true));

  // 山腳岩壁（泉眼）
  const rocks = (b: B, soot: boolean) => {
    const f = soot ? sootStoneFace() : stoneFace();
    b.add(blob(1.6, 1, b.rng, 0.14, 1.3, 1.1, 0.9), mat(-0.6, 1.0, -4.6, 0.3), f);
    b.add(blob(1.3, 1, b.rng, 0.14, 1.2, 1.0, 0.9), mat(1.6, 0.7, -4.2, 1.1), f);
    b.add(blob(1.1, 1, b.rng, 0.16, 1.0, 1.2, 1.0), mat(0.4, 2.3, -5.0, 2.0), f);
    // 竹管
    logBetween(b, V(0.2, 1.75, -3.35), V(0.15, 1.45, -2.3), 0.09, soot ? charFace() : C('#8fbf4a'), 6, {}, 1);
  };
  place(A, new THREE.Matrix4(), (b) => rocks(b, false), (b) => rocks(b, true));
  // 泉水水柱（落入池中，池中段被水面遮住）
  A.intact.add(polyGeo([V(0.05, 1.5, -2.25), V(0.25, 1.5, -2.25), V(0.27, 0.18, -1.9), V(0.03, 0.18, -1.9)], true), null, C('#bfeaf2'));

  // 水井
  place(A, mat(4.6, 0, 1.4, -0.5), (b) => well(b), (b) => well(b, true));
  A.fire.push(V(4.6, 2.4, 1.4));
  // 木架（吊桶架）
  const rack = (b: B, burnt: boolean) => {
    const wood = burnt ? charFace() : woodFace(C(PAL.woodDark));
    for (const s of [-1, 1]) {
      if (burnt && s > 0) {
        logBetween(b, V(1.2, 0.1, -0.4), V(0.2, 0.25, 1.2), 0.07, charFace(), 5, {}, 1);
        continue;
      }
      logBetween(b, V(s * 1.2, 0, -0.55), V(s * 1.15, 2.1, 0), 0.07, wood, 5, {}, 1);
      logBetween(b, V(s * 1.2, 0, 0.55), V(s * 1.15, 2.1, 0), 0.07, wood, 5, {}, 1);
    }
    if (burnt) return;
    logBetween(b, V(-1.4, 2.05, 0), V(1.4, 2.05, 0), 0.065, woodFace(C(PAL.wood)), 6, {}, 2);
    for (const x of [-0.6, 0, 0.6]) {
      logBetween(b, V(x, 2.0, 0), V(x, 1.35, 0), 0.012, C(PAL.rope), 3, {}, 0);
      b.add(
        lathe(
          [
            [0, 0],
            [0.16, 0],
            [0.19, 0.3],
            [0.16, 0.3],
            [0.14, 0.04],
            [0, 0.04],
          ],
          7,
        ),
        mat(x, 1.05, 0),
        { face: (c, _n, out) => out.copy(c.y > 0.22 ? C(PAL.metalDark) : C(PAL.wood)) },
      );
    }
  };
  place(A, mat(-4.6, 0, 1.6, 0.4), (b) => rack(b, false), (b) => rack(b, true));
  A.fire.push(V(-4.6, 1.5, 1.6));
  place(A, mat(-4.2, 0, 4.2, 0.2), barrels, (b) => debris(b, 0.5));
  if (opts.team !== undefined) addFlag(A, 3.0, -3.4, 6.0, false, false);

  // 水面（獨立材質：波光；焚毀＝被污染變濁）
  const waterMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 });
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = propTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRip;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRip = (modelMatrix * vec4(position, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRip;\nuniform float uTime;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(normal + vec3(sin(vRip.x * 2.7 + uTime * 1.9) * 0.09 + sin(vRip.y * 4.1 - uTime * 1.3) * 0.06,
                                        cos(vRip.y * 3.1 - uTime * 1.6) * 0.09 + cos(vRip.x * 3.7 + uTime * 1.1) * 0.05, 0.0));`,
      );
  };
  waterMat.customProgramCacheKey = () => 'qjl-water';
  const wb = new GeoBuilder(makeRng(3));
  const deep = C(PAL.waterDeep);
  const shallow = C(PAL.water);
  const foam = C('#cdeff6');
  wb.add(
    lathe(
      [
        [poolR + 0.02, 0],
        [poolR - 0.28, 0],
        [0, 0],
      ],
      16,
      { phase: 0.2 },
    ),
    null,
    { vertex: (p, _n, out) => out.copy(Math.hypot(p.x, p.z) > poolR - 0.1 ? foam : mixC(deep, shallow, Math.min(1, Math.hypot(p.x, p.z) / (poolR - 0.3)))) },
  );
  const water = new THREE.Mesh(wb.toGeometry(), waterMat);
  water.name = 'water';
  water.receiveShadow = true;
  water.userData.anchor = [0, 0];
  const levelAt = (f: number) => PAD_LIFT + 0.13 + 0.43 * f;
  water.position.y = levelAt(1);
  water.userData.baseY = water.position.y;
  const vis = finalize(A, 'waterSource', {
    objects: [water],
    onStock: (f) => {
      const base = water.userData.baseY as number;
      const dy = water.position.y - base;
      water.userData.baseY = levelAt(f);
      water.position.y = levelAt(f) + dy;
      water.visible = f > 0.01;
    },
    onBurnt: (b) => {
      waterMat.color.set(b ? '#7a7448' : '#ffffff');
    },
  });
  return vis;
}
