// 植被與岩石：CoC 式圓潤樹冠、灰藍岩石、草叢（給 InstancedMesh 大量放置，三角形數要省）
// 每個幾何都含 position / normal / color / aSway（0＝根部不動 → 1＝樹梢擺動最大）
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { C, GeoBuilder, V, blob, clamp01, hash3, lathe, logBetween, makeRng, mixC, pick, rr, smoothstep, type Rng, type VertexColorFn } from './propkit';

export type TreeVariant = 'broadleaf' | 'pine' | 'bamboo' | 'willow' | 'burnt';

const TAU = Math.PI * 2;

/** 依高度寫入 aSway（y / 最高點） */
function addSway(g: THREE.BufferGeometry, fixed?: number): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  let maxY = 0.001;
  for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) sway[i] = fixed ?? clamp01(pos.getY(i) / maxY);
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  return g;
}

/** 樹皮：下深上淺、帶縱向斑駁 */
function barkColor(base: string, dark: string): VertexColorFn {
  const b = C(base);
  const d = C(dark);
  return (p, _n, out) => {
    out.copy(b).lerp(d, 0.25 + 0.5 * hash3(Math.round(p.x * 8), Math.round(p.y * 2), Math.round(p.z * 8)));
  };
}

/** 樹冠一團：上亮下暗（假 AO）、頂端略偏黃綠 */
function canopyColor(base: THREE.Color, r: number): VertexColorFn {
  const dark = base.clone().multiplyScalar(0.42);
  dark.b *= 1.25;
  const light = mixC(base, C('#d4f07a'), 0.42);
  return (p, n, out) => {
    const t = clamp01(0.5 + 0.38 * n.y + 0.22 * (p.y / r));
    if (t < 0.55) out.copy(dark).lerp(base, smoothstep(0.0, 0.55, t));
    else out.copy(base).lerp(light, smoothstep(0.55, 1.0, t));
    out.multiplyScalar(0.94 + 0.12 * hash3(p.x * 3, p.y * 3, p.z * 3));
  };
}

const LEAF_GREENS = ['#5fba3c', '#55b03a', '#6cc243', '#4ea83a', '#66b83e'];

/** 闊葉樹（7–10 m）：粗短樹幹＋4 團 icosphere 樹冠 */
function broadleaf(b: GeoBuilder, rng: Rng) {
  const H = rr(rng, 7, 10);
  const s = H / 8.5;
  const top = H * 0.55;
  const rMul = Array.from({ length: 6 }, () => rr(rng, 0.88, 1.1));
  b.add(
    lathe(
      [
        [0.58 * s, -0.25],
        [0.36 * s, 0.4],
        [0.27 * s, top * 0.6],
        [0.2 * s, top],
      ],
      6,
      { phase: rng() * TAU, rMul },
    ),
    null,
    { vertex: barkColor('#86592f', '#5a3a20') },
  );
  const bark = C('#7a4f2b');
  for (let i = 0; i < 2; i++) {
    const a = rng() * TAU;
    logBetween(b, V(0, top * 0.72, 0), V(Math.sin(a) * 1.4 * s, top + 0.9 * s, Math.cos(a) * 1.4 * s), 0.13 * s, bark, 5, {}, 0, 0.07 * s);
  }
  const base = C(pick(rng, LEAF_GREENS));
  const R = rr(rng, 2.3, 2.7) * s;
  const blobs: [number, number, number, number][] = [[0, H - R * 1.05, 0, R]];
  const a0 = rng() * TAU;
  for (let i = 0; i < 2; i++) {
    const a = a0 + i * 2.4 + rr(rng, -0.3, 0.3);
    blobs.push([Math.sin(a) * R * 0.78, H - R * 1.65, Math.cos(a) * R * 0.78, R * rr(rng, 0.68, 0.8)]);
  }
  const at = a0 + 4.6;
  blobs.push([Math.sin(at) * R * 0.35, H - R * 0.55, Math.cos(at) * R * 0.35, R * 0.62]);
  for (const [x, y, z, r] of blobs) {
    const tint = base.clone().multiplyScalar(rr(rng, 0.93, 1.07));
    b.add(blob(r, 1, rng, 0.09, 1, 0.88, 1), new THREE.Matrix4().makeTranslation(x, y, z), { vertex: canopyColor(tint, r) });
  }
}

/** 松樹（9–12 m）：細幹＋4 層下垂的錐形枝層 */
function pine(b: GeoBuilder, rng: Rng) {
  const H = rr(rng, 9, 12);
  const s = H / 10.5;
  b.add(
    lathe(
      [
        [0.42 * s, -0.25],
        [0.3 * s, 0.5],
        [0.12 * s, H * 0.88],
      ],
      6,
      { phase: rng() * TAU },
    ),
    null,
    { vertex: barkColor('#7d4e2c', '#56341c') },
  );
  const base = C(pick(rng, ['#2f8a4f', '#2a8048', '#358f55']));
  const dark = base.clone().multiplyScalar(0.45);
  const light = mixC(base, C('#9ad66a'), 0.4);
  const tiers = 4;
  const seg = 9;
  for (let i = 0; i < tiers; i++) {
    const R = (1 - i * 0.2) * rr(rng, 2.25, 2.55) * s;
    const yb = H * 0.17 + i * H * 0.19;
    const th = H * (i === tiers - 1 ? 0.3 : 0.33);
    const rMul = Array.from({ length: seg }, (_, j) => (j % 2 ? 0.86 : 1.06) * rr(rng, 0.95, 1.05));
    const yAdd = Array.from({ length: seg }, (_, j) => (j % 2 ? 0.08 : -0.16) * s);
    const y0 = yb;
    b.add(
      lathe(
        [
          [R * 0.3, yb + 0.5 * s],
          [R, yb],
          [R * 0.86, yb + 0.32 * s],
          [0, yb + th],
        ],
        seg,
        { phase: rng() * TAU, rMul, yAdd },
      ),
      null,
      {
        vertex: (p, n, out) => {
          if (n.y < 0) out.copy(dark);
          else {
            const t = clamp01((p.y - y0) / th);
            out.copy(base).lerp(light, 0.15 + 0.5 * t * n.y);
            if (Math.hypot(p.x, p.z) > R * 0.8) out.lerp(light, 0.25);
          }
        },
      },
    );
  }
}

/** 竹叢（9–12 m）：5 根微彎竹竿（每根 2 節）＋每根 2 簇向外下垂的水滴形葉簇 */
function bamboo(b: GeoBuilder, rng: Rng) {
  const n = 5;
  const culm = C('#8cc24a');
  const culm2 = C('#79b03f');
  const node = C('#c8dc7a');
  const leaf = C(pick(rng, ['#74c043', '#6cb93f', '#7dc64a']));
  const a0 = rng() * TAU;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU + rr(rng, -0.4, 0.4);
    const r0 = rr(rng, 0.15, 0.6);
    const base = V(Math.sin(a) * r0, -0.2, Math.cos(a) * r0);
    const h = rr(rng, 8.5, 11.5);
    const lean = rr(rng, 0.1, 0.24);
    const la = a + rr(rng, -0.5, 0.5);
    const dir = V(Math.sin(la), 0, Math.cos(la));
    const pt = (t: number) => base.clone().add(V(0, h * t, 0)).add(dir.clone().multiplyScalar(lean * h * Math.pow(t, 1.6)));
    const r = rr(rng, 0.1, 0.13);
    for (let k = 0; k < 2; k++) {
      const c = k % 2 ? culm2 : culm;
      logBetween(b, pt(k * 0.55), pt(k === 0 ? 0.55 : 1), r * (1 - k * 0.3), { vertex: (p, _n, out) => out.copy(p.y < 0.05 ? node : c) }, 5, {}, 0, r * (0.7 - k * 0.3));
    }
    // 葉簇：水滴形（6 邊車床體、24 三角形），從竿上向外下垂
    for (const [t, side] of [
      [0.74, rr(rng, 0.9, 1.3) * (rng() < 0.5 ? 1 : -1)],
      [1.0, rr(rng, -0.3, 0.3)],
    ] as const) {
      const L = rr(rng, 1.9, 2.5) * (t < 1 ? 0.9 : 1);
      const w = rr(rng, 0.45, 0.55);
      const d2 = V(Math.sin(la + side), 0, Math.cos(la + side));
      const axis = d2.multiplyScalar(0.82).add(V(0, t < 1 ? -0.55 : -0.3, 0)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), axis);
      const m = new THREE.Matrix4().compose(pt(t), q, V(1, 1, 1));
      const tint = leaf.clone().multiplyScalar(rr(rng, 0.9, 1.1));
      const dark = tint.clone().multiplyScalar(0.55);
      const light = mixC(tint, C('#d4f07a'), 0.35);
      b.add(
        lathe(
          [
            [0, 0],
            [w, L * 0.38],
            [w * 0.62, L * 0.78],
            [0, L],
          ],
          6,
          { phase: rng() * TAU, rMul: Array.from({ length: 6 }, () => rr(rng, 0.8, 1.15)) },
        ),
        m,
        { vertex: (p, nn, out) => out.copy(dark).lerp(light, clamp01(0.25 + 0.55 * (p.y / L) + 0.2 * nn.x)) },
      );
    }
  }
}

/** 柳樹（7–8.5 m）：粗矮彎幹、寬扁樹冠、四周垂下的柳條 */
function willow(b: GeoBuilder, rng: Rng) {
  const H = rr(rng, 7, 8.5);
  const s = H / 7.8;
  const top = H * 0.45;
  b.add(
    lathe(
      [
        [0.66 * s, -0.25],
        [0.45 * s, 0.5],
        [0.42 * s, 1.8 * s],
        [0.32 * s, top],
      ],
      6,
      { phase: rng() * TAU, rMul: Array.from({ length: 6 }, () => rr(rng, 0.82, 1.15)) },
    ),
    mat3(rr(rng, -0.06, 0.06), rr(rng, -0.06, 0.06)),
    { vertex: barkColor('#7a5a3a', '#4f3822') },
  );
  const bark = C('#6e5034');
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rng();
    logBetween(b, V(0, top - 0.3, 0), V(Math.sin(a) * 1.6 * s, top + 1.3 * s, Math.cos(a) * 1.6 * s), 0.16 * s, bark, 5, {}, 0, 0.08 * s);
  }
  const base = C(pick(rng, ['#86c246', '#7fbb42', '#90c84c']));
  const cy = H * 0.72;
  const R = 2.5 * s;
  b.add(blob(R, 1, rng, 0.12, 1.05, 0.78, 1.05), new THREE.Matrix4().makeTranslation(0, cy, 0), { vertex: canopyColor(base, R * 0.78) });
  const a2 = rng() * TAU;
  b.add(
    blob(R * 0.66, 1, rng, 0.12, 1, 0.8, 1),
    new THREE.Matrix4().makeTranslation(Math.sin(a2) * R * 0.35, cy + R * 0.55, Math.cos(a2) * R * 0.35),
    { vertex: canopyColor(base.clone().multiplyScalar(1.05), R * 0.5) },
  );
  // 柳條：兩圈細長扁平的垂絲（4 邊錐、每條 4 三角形），從樹冠邊緣上方垂下
  const dr = base.clone().multiplyScalar(0.72);
  const tip = mixC(base, C('#d8ef8a'), 0.45);
  for (let ring = 0; ring < 2; ring++) {
    const cnt = ring === 0 ? 11 : 8;
    for (let i = 0; i < cnt; i++) {
      const a = ((i + ring * 0.5) / cnt) * TAU + rr(rng, -0.15, 0.15);
      const rad = R * (ring === 0 ? rr(rng, 0.9, 0.98) : rr(rng, 0.7, 0.8));
      const L = (ring === 0 ? rr(rng, 3.0, 4.1) : rr(rng, 2.2, 3.0)) * s;
      const w = rr(rng, 0.26, 0.36) * s;
      const y0 = cy + (ring === 0 ? 0.15 : -0.2) * R;
      const m = new THREE.Matrix4().compose(
        V(Math.sin(a) * rad, y0, Math.cos(a) * rad),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06 * Math.cos(a), a, -0.06 * Math.sin(a), 'YXZ')),
        V(1, 1, 1),
      );
      b.add(
        lathe(
          [
            [0, -L],
            [w, 0],
          ],
          4,
          { rMul: [0.35, 1, 0.35, 1] }, // 寬面朝切線方向（扁平柳絲）
        ),
        m,
        { vertex: (p, _n, out) => out.copy(dr).lerp(tip, clamp01(-p.y / L)) },
      );
    }
  }
}

/** 焚毀的枯樹（6.5–8 m）：焦黑樹幹、斷枝、零星餘燼 */
function burntTree(b: GeoBuilder, rng: Rng) {
  const H = rr(rng, 6.5, 8);
  const ch = C('#2c2725');
  const ch2 = C('#3d342e');
  const ash = C('#77706a');
  const ember = C('#a8401a');
  const charCol: VertexColorFn = (p, n, out) => {
    const h = hash3(Math.round(p.x * 6), Math.round(p.y * 3), Math.round(p.z * 6));
    if (n.y > 0.6) out.copy(ash);
    else if (h < 0.03) out.copy(ember).multiplyScalar(0.7);
    else out.copy(h < 0.5 ? ch : ch2);
  };
  b.add(
    lathe(
      [
        [0.52, -0.25],
        [0.35, 0.6],
        [0.27, H * 0.55],
        [0.14, H * 0.9],
        [0.0, H],
      ],
      6,
      { phase: rng() * TAU, rMul: Array.from({ length: 6 }, () => rr(rng, 0.8, 1.15)) },
    ),
    null,
    { vertex: charCol },
  );
  const nb = 4 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < nb; i++) {
    const y = H * rr(rng, 0.4, 0.85);
    const a = rng() * TAU;
    const len = rr(rng, 1.2, 2.4) * (1.2 - y / H);
    const p0 = V(0, y, 0);
    const p1 = V(Math.sin(a) * len, y + len * rr(rng, 0.4, 0.9), Math.cos(a) * len);
    logBetween(b, p0, p1, rr(rng, 0.08, 0.12), { vertex: charCol }, 5, {}, 0, 0.015);
    if (i < 3) {
      const a2 = a + rr(rng, -0.8, 0.8);
      const p2 = p1.clone().add(V(Math.sin(a2) * 0.7, 0.5, Math.cos(a2) * 0.7));
      logBetween(b, p1.clone().lerp(p0, 0.3), p2, 0.05, { vertex: charCol }, 4, {}, 0, 0.01);
    }
  }
}

/** 小工具：只做 X/Z 傾斜的矩陣 */
function mat3(rx: number, rz: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, 0, rz));
}

/**
 * 樹的合併幾何（position/normal/color＋aSway），高度約 7–12 m（焚毀枯樹 6.5–8 m）。
 * 三角形數（實測上限）：闊葉 376、松 204、竹 340、柳 302、枯樹 116
 */
export function treeGeometry(variant: TreeVariant, seed = 0): THREE.BufferGeometry {
  const rng = makeRng(seed * 977 + variant.length * 31 + 5);
  const b = new GeoBuilder(rng);
  switch (variant) {
    case 'broadleaf':
      broadleaf(b, rng);
      break;
    case 'pine':
      pine(b, rng);
      break;
    case 'bamboo':
      bamboo(b, rng);
      break;
    case 'willow':
      willow(b, rng);
      break;
    case 'burnt':
      burntTree(b, rng);
      break;
  }
  const g = addSway(b.toGeometry({ ao: 0.25, aoHeight: 1.2 }));
  g.name = 'tree:' + variant;
  return g;
}

/** 灰藍圓潤岩石（直徑約 1.5–3 m），80 三角形，半平面半平滑法線，部分帶青苔；aSway = 0 */
export function rockGeometry(seed = 0): THREE.BufferGeometry {
  const rng = makeRng(seed * 131 + 17);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const s = rr(rng, 0.75, 1.5);
  const sx = s * rr(rng, 1.0, 1.35);
  const sy = s * rr(rng, 0.72, 0.98);
  const sz = s * rr(rng, 0.85, 1.15);
  const bump = V(rr(rng, -1, 1), rr(rng, 0.2, 1), rr(rng, -1, 1)).normalize();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const k = (1 + (rng() * 2 - 1) * 0.14) * (1 + 0.15 * Math.max(0, v.dot(bump)));
    v.multiplyScalar(k);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.25; // 壓平底部
    p.setXYZ(i, v.x * sx, (v.y + 0.18) * sy, v.z * sz);
  }
  g.computeVertexNormals();
  const smoothN = g.getAttribute('normal') as THREE.BufferAttribute;
  // 展開成非索引，法線 = 0.55 平面 + 0.45 平滑（有稜面但不尖銳）
  const idx = g.index!;
  const n = idx.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const moss = rng() < 0.45;
  const stones = [C('#7f8fa6'), C('#8a9ab0'), C('#74859d'), C('#93a2b6')];
  const mossC = C('#6faa48');
  const a = new THREE.Vector3();
  const bb = new THREE.Vector3();
  const c = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const color = new THREE.Color();
  for (let t = 0; t < n; t += 3) {
    const i0 = idx.getX(t);
    const i1 = idx.getX(t + 1);
    const i2 = idx.getX(t + 2);
    a.fromBufferAttribute(p, i0);
    bb.fromBufferAttribute(p, i1);
    c.fromBufferAttribute(p, i2);
    fn.subVectors(bb, a).cross(tmp.subVectors(c, a)).normalize();
    const cy = (a.y + bb.y + c.y) / 3;
    const h = hash3(a.x + bb.x, a.y + c.y, a.z + c.z);
    color.copy(stones[Math.floor(h * 4) % 4]);
    if (fn.y > 0.5) color.multiplyScalar(1.1);
    if (fn.y < -0.2 || cy < 0.15 * sy) color.multiplyScalar(0.72);
    if (moss && fn.y > 0.72 && h > 0.3) color.lerp(mossC, 0.75);
    [i0, i1, i2].forEach((vi, k) => {
      const o = (t + k) * 3;
      pos[o] = p.getX(vi);
      pos[o + 1] = p.getY(vi);
      pos[o + 2] = p.getZ(vi);
      tmp.set(smoothN.getX(vi), smoothN.getY(vi), smoothN.getZ(vi)).multiplyScalar(0.45).addScaledVector(fn, 0.55).normalize();
      nor[o] = tmp.x;
      nor[o + 1] = tmp.y;
      nor[o + 2] = tmp.z;
      col[o] = color.r;
      col[o + 1] = color.g;
      col[o + 2] = color.b;
    });
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  out.name = 'rock';
  return addSway(out, 0);
}

/**
 * 一叢草（約 0.5 m）：交叉三角葉片，已含正反兩面（用 FrontSide 材質即可）。
 * flowers=true 時帶 2 朵小黃花。三角形：無花 20、有花 24
 */
export function grassTuftGeometry(flowers = false): THREE.BufferGeometry {
  const rng = makeRng(flowers ? 77 : 33);
  const nb = flowers ? 8 : 10;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const baseC = C('#3f8c2b');
  const tipC = C('#9edb4c');
  const up = V(0, 1, 0);
  const push = (p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => {
    pos.push(p.x, p.y, p.z);
    nor.push(n.x, n.y, n.z);
    col.push(c.r, c.g, c.b);
  };
  const tips: THREE.Vector3[] = [];
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + rr(rng, -0.3, 0.3);
    const dir = V(Math.sin(a), 0, Math.cos(a));
    const perp = V(dir.z, 0, -dir.x);
    const base = dir.clone().multiplyScalar(rr(rng, 0.0, 0.07));
    const h = rr(rng, 0.32, 0.55);
    const w = rr(rng, 0.07, 0.11);
    const tip = base.clone().add(V(0, h, 0)).add(dir.clone().multiplyScalar(h * rr(rng, 0.25, 0.55)));
    tips.push(tip);
    const bl = base.clone().addScaledVector(perp, w / 2);
    const br = base.clone().addScaledVector(perp, -w / 2);
    const fnrm = new THREE.Vector3().subVectors(br, bl).cross(new THREE.Vector3().subVectors(tip, bl)).normalize();
    const nf = fnrm.clone().multiplyScalar(0.35).addScaledVector(up, 0.65).normalize();
    const nbk = fnrm.clone().multiplyScalar(-0.35).addScaledVector(up, 0.65).normalize();
    const tc = tipC.clone().multiplyScalar(rr(rng, 0.9, 1.08));
    push(bl, nf, baseC);
    push(br, nf, baseC);
    push(tip, nf, tc);
    push(br, nbk, baseC);
    push(bl, nbk, baseC);
    push(tip, nbk, tc);
  }
  if (flowers) {
    const yel = C('#ffd23f');
    for (let k = 0; k < 2; k++) {
      const t = tips[k * 3 + 1];
      const c = V(t.x * 0.8, t.y + 0.03, t.z * 0.8);
      const r = 0.065;
      const q = [V(c.x + r, c.y, c.z), V(c.x, c.y, c.z - r), V(c.x - r, c.y, c.z), V(c.x, c.y, c.z + r)];
      // 上面（逆時針朝上）與背面
      for (const [i, j, l] of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        push(q[i], up, yel);
        push(q[j], up, yel);
        push(q[l], up, yel);
        const dn = V(0, -1, 0);
        push(q[i], dn, yel);
        push(q[l], dn, yel);
        push(q[j], dn, yel);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.name = flowers ? 'grassFlower' : 'grass';
  return addSway(g);
}
