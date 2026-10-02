// 植被：依森林遮罩撒樹、草叢、岩石；分區塊實例化（每塊各自視錐剔除）＋ 風擺 shader
import * as THREE from 'three';
import type { Heightfield } from '../map/heightfield';
import { WATER_LEVEL } from '../map/heightfield';
import { makeRng } from '../util/rng';

export const windTime = { value: 0 };

export interface VegetationGeos {
  trees: THREE.BufferGeometry[]; // 依變體
  rocks: THREE.BufferGeometry[];
  grass: THREE.BufferGeometry[];
}

function swayMaterial(amp: number, rough = 0.85): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;\nattribute float aSway;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float ph = ip.x * 0.07 + ip.z * 0.05;
    float w = sin(uWind * 1.3 + ph) * 0.6 + sin(uWind * 2.7 + ph * 1.7) * 0.25;
    transformed.x += w * aSway * ${amp.toFixed(3)};
    transformed.z += w * aSway * ${(amp * 0.6).toFixed(3)};
  }`,
      );
  };
  mat.customProgramCacheKey = () => 'sway' + amp;
  return mat;
}

/** 依區塊建立實例化網格 */
function chunked(geo: THREE.BufferGeometry, mat: THREE.Material, items: THREE.Matrix4[], chunk: number, shadow: boolean, group: THREE.Group): void {
  const buckets = new Map<string, THREE.Matrix4[]>();
  const p = new THREE.Vector3();
  for (const m of items) {
    p.setFromMatrixPosition(m);
    const key = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(m);
  }
  for (const list of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadow;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
}

export interface TreeInstance {
  x: number;
  z: number;
  s: number;
}

export function buildVegetation(hf: Heightfield, seed: number, geos: VegetationGeos, quality: 'high' | 'medium' | 'low', avoid: { x: number; z: number; r: number }[]): { group: THREE.Group; trees: TreeInstance[] } {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const rng = makeRng(seed + 555);
  const half = hf.size / 2;
  const playHalf = hf.play / 2;
  const treeMats = swayMaterial(0.35);
  const treeLists: THREE.Matrix4[][] = geos.trees.map(() => []);
  const trees: TreeInstance[] = [];
  const blocked = (x: number, z: number) => avoid.some((a) => Math.hypot(a.x - x, a.z - z) < a.r);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const spacing = quality === 'low' ? 8 : 6;
  for (let z = -half + 4; z < half - 4; z += spacing) {
    for (let x = -half + 4; x < half - 4; x += spacing) {
      const outside = Math.max(Math.abs(x), Math.abs(z)) > playHalf + 6;
      const step = outside ? 1.6 : 1;
      if (outside && rng() > 1 / (step * step)) continue;
      const jx = x + (rng() - 0.5) * spacing * 0.9;
      const jz = z + (rng() - 0.5) * spacing * 0.9;
      const f = hf.forestAt(jx, jz);
      // 草原上偶爾的孤樹
      const lone = !outside && f < 0.05 && rng() < 0.0035 && hf.roadAt(jx, jz) < 0.1;
      if (!lone && rng() > f * 0.95) continue;
      const h = hf.height(jx, jz);
      if (h < WATER_LEVEL + 0.6 || hf.slope(jx, jz) > 0.9) continue;
      if (blocked(jx, jz)) continue;
      const variant = h > 14 && geos.trees.length > 1 ? 1 : rng() < 0.75 ? 0 : Math.min(geos.trees.length - 1, 1 + ((rng() * (geos.trees.length - 1)) | 0));
      const s = (outside ? 1.15 : 1) * (0.8 + rng() * 0.45);
      e.set((rng() - 0.5) * 0.06, rng() * Math.PI * 2, (rng() - 0.5) * 0.06);
      m.compose(v.set(jx, h - 0.2, jz), q.setFromEuler(e), sc.set(s, s * (0.9 + rng() * 0.25), s));
      treeLists[variant].push(m.clone());
      if (!outside) trees.push({ x: jx, z: jz, s });
    }
  }
  geos.trees.forEach((g, k) => chunked(g, treeMats, treeLists[k], 120, quality !== 'low', group));

  // 岩石：坡地與邊框
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const rockLists: THREE.Matrix4[][] = geos.rocks.map(() => []);
  for (let k = 0; k < 700; k++) {
    const x = (rng() - 0.5) * hf.size * 0.95;
    const z = (rng() - 0.5) * hf.size * 0.95;
    const sl = hf.slope(x, z);
    const outside = Math.max(Math.abs(x), Math.abs(z)) > playHalf;
    if (!outside && sl < 0.35 && rng() > 0.08) continue;
    if (blocked(x, z) || hf.roadAt(x, z) > 0.2) continue;
    const h = hf.height(x, z);
    if (h < WATER_LEVEL - 0.3) continue;
    const s = 0.6 + rng() * (outside ? 2.2 : 1.1);
    e.set(rng() * 0.5, rng() * Math.PI * 2, rng() * 0.5);
    m.compose(v.set(x, h - 0.3 * s, z), q.setFromEuler(e), sc.set(s, s * (0.6 + rng() * 0.5), s));
    rockLists[k % geos.rocks.length].push(m.clone());
  }
  geos.rocks.forEach((g, k) => chunked(g, rockMat, rockLists[k], 120, quality !== 'low', group));

  // 草叢：只在可遊玩區、草地上
  if (quality !== 'low') {
    const grassMat = swayMaterial(0.12, 0.95);
    const count = quality === 'high' ? 18000 : 9000;
    const lists: THREE.Matrix4[][] = geos.grass.map(() => []);
    for (let k = 0; k < count; k++) {
      const x = (rng() - 0.5) * hf.play;
      const z = (rng() - 0.5) * hf.play;
      const h = hf.height(x, z);
      if (h < WATER_LEVEL + 0.4 || hf.roadAt(x, z) > 0.15 || hf.slope(x, z) > 0.5) continue;
      if (blocked(x, z)) continue;
      const s = 0.7 + rng() * 0.8;
      e.set(0, rng() * Math.PI * 2, 0);
      m.compose(v.set(x, h - 0.05, z), q.setFromEuler(e), sc.set(s, s * (0.8 + rng() * 0.6), s));
      lists[rng() < 0.85 || lists.length === 1 ? 0 : 1].push(m.clone());
    }
    geos.grass.forEach((g, k) => chunked(g, grassMat, lists[k], 100, false, group));
  }
  return { group, trees };
}
