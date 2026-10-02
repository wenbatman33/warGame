// 士兵實例化渲染：每種模型一個 InstancedMesh（活人）＋ 一個屍體層；骨骼動畫在 GPU 上算
import * as THREE from 'three';
import { animTime, BAT_DECL, bakeModel, type BakedModel } from '../models/bake';
import type { AnimName } from '../models/rig';
import { buildModel, MODEL_KEYS, type ModelKey } from '../models/soldier';

interface Layer {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  team: THREE.InstancedBufferAttribute;
  tint: THREE.InstancedBufferAttribute;
  count: number;
  cap: number;
}

interface ModelSet {
  baked: BakedModel;
  /** 近景 */
  live: Layer;
  /** 遠景（低面數） */
  far: Layer;
  dead: Layer;
  deadNext: number;
  deadFilled: number;
}

/** 近景模型的距離（m）；超過就用低面數模型 */
export const LOD = { dist: 60 };

const SOLDIER_SCALE = 1.0;

/** 遠景放大士兵（RTS 常用的可讀性技巧）與隊伍色自發光 */
export const soldierLook = { scale: { value: 1 }, glow: { value: 0.07 } };

function makeMaterial(baked: BakedModel): { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial } {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.05 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBat = { value: baked.texture };
    sh.uniforms.uAnimTime = animTime;
    sh.uniforms.uSoldierScale = soldierLook.scale;
    sh.uniforms.uTeamGlow = soldierLook.glow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${BAT_DECL}\nattribute float aMask;\nattribute vec3 aTeam;\nattribute float aTint;\nuniform float uSoldierScale;\nvarying vec4 vTeamMask;`)
      .replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb = mix(vColor.rgb * (0.8 + 0.4 * aTint), aTeam, aMask);\n  vTeamMask = vec4(aTeam, aMask);')
      .replace('#include <beginnormal_vertex>', 'mat4 batM = batMatrix();\n  vec3 objectNormal = mat3(batM) * normal;')
      .replace('#include <begin_vertex>', 'vec3 transformed = (batM * vec4(position, 1.0)).xyz * uSoldierScale;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTeamGlow;\nvarying vec4 vTeamMask;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vTeamMask.rgb * vTeamMask.a * uTeamGlow;');
  };
  mat.customProgramCacheKey = () => 'bat-std';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uBat = { value: baked.texture };
    sh.uniforms.uAnimTime = animTime;
    sh.uniforms.uSoldierScale = soldierLook.scale;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${BAT_DECL}\nuniform float uSoldierScale;`)
      .replace('#include <begin_vertex>', 'mat4 batM = batMatrix();\n  vec3 transformed = (batM * vec4(position, 1.0)).xyz * uSoldierScale;');
  };
  depth.customProgramCacheKey = () => 'bat-depth';
  return { mat, depth };
}

function makeLayer(baked: BakedModel, cap: number, mats: { mat: THREE.Material; depth: THREE.Material }, shadow: boolean, geo?: THREE.BufferGeometry): Layer {
  const src = geo ?? baked.def.geometry;
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'aBone', 'aMask']) g.setAttribute(name, src.getAttribute(name));
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
  const team = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  const tint = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
  anim.setUsage(THREE.DynamicDrawUsage);
  team.setUsage(THREE.DynamicDrawUsage);
  tint.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aAnim', anim);
  g.setAttribute('aTeam', team);
  g.setAttribute('aTint', tint);
  const mesh = new THREE.InstancedMesh(g, mats.mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.customDepthMaterial = mats.depth;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, anim, team, tint, count: 0, cap };
}

export class SoldierRenderer {
  readonly group = new THREE.Group();
  private sets = new Map<ModelKey, ModelSet>();
  shadows = true;

  /** 鏡頭位置（決定近景／遠景模型） */
  cam = new THREE.Vector3(0, 1e6, 0);

  constructor(caps: Partial<Record<ModelKey, number>> = {}, deadCap = 2500) {
    for (const key of MODEL_KEYS) {
      const baked = bakeModel(buildModel(key));
      const lowGeo = buildModel(key, 1).geometry;
      const mats = makeMaterial(baked);
      const small = key.startsWith('gen_') || key === 'packhorse';
      const cap = caps[key] ?? (small ? 48 : 2400);
      const live = makeLayer(baked, small ? cap : Math.min(cap, 900), mats, true);
      const far = makeLayer(baked, cap, mats, true, lowGeo);
      const dead = makeLayer(baked, small ? 16 : deadCap, mats, false, lowGeo);
      this.group.add(live.mesh, far.mesh, dead.mesh);
      this.sets.set(key, { baked, live, far, dead, deadNext: 0, deadFilled: 0 });
    }
  }

  baked(key: ModelKey): BakedModel {
    return this.sets.get(key)!.baked;
  }

  /** 每幀開始：清空活人層 */
  begin(): void {
    for (const s of this.sets.values()) {
      s.live.count = 0;
      s.far.count = 0;
    }
  }

  /** 加一名活著（或正在倒下）的士兵 */
  push(key: ModelKey, x: number, y: number, z: number, yaw: number, anim: AnimName, start: number, speed: number, team: THREE.Color, tint: number): void {
    const s = this.sets.get(key)!;
    const dx = x - this.cam.x;
    const dy = y - this.cam.y;
    const dz = z - this.cam.z;
    let L = dx * dx + dy * dy + dz * dz < LOD.dist * LOD.dist ? s.live : s.far;
    if (L.count >= L.cap) L = L === s.live ? s.far : s.live;
    if (L.count >= L.cap) return;
    write(L, L.count, s.baked, x, y, z, yaw, anim, start, speed, team, tint);
    L.count++;
  }

  /** 屍體：寫進屍體層（環狀覆蓋最舊的） */
  addCorpse(key: ModelKey, x: number, y: number, z: number, yaw: number, anim: AnimName, start: number, team: THREE.Color, tint: number): void {
    const s = this.sets.get(key)!;
    const L = s.dead;
    const i = s.deadNext;
    write(L, i, s.baked, x, y, z, yaw, anim, start, 1, team, tint);
    s.deadNext = (i + 1) % L.cap;
    s.deadFilled = Math.min(L.cap, s.deadFilled + 1);
    L.mesh.count = s.deadFilled;
    L.mesh.instanceMatrix.needsUpdate = true;
    L.anim.needsUpdate = true;
    L.team.needsUpdate = true;
    L.tint.needsUpdate = true;
  }

  clearCorpses(): void {
    for (const s of this.sets.values()) {
      s.deadNext = 0;
      s.deadFilled = 0;
      s.dead.mesh.count = 0;
    }
  }

  end(): void {
    for (const s of this.sets.values()) {
      for (const L of [s.live, s.far]) this.flush(L);
    }
  }

  private flush(L: Layer): void {
    L.mesh.count = L.count;
    L.mesh.castShadow = this.shadows;
    if (L.count === 0) return;
    L.mesh.instanceMatrix.clearUpdateRanges();
    L.mesh.instanceMatrix.addUpdateRange(0, L.count * 16);
    L.mesh.instanceMatrix.needsUpdate = true;
    for (const a of [L.anim, L.team, L.tint]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, L.count * a.itemSize);
      a.needsUpdate = true;
    }
  }

  get liveCount(): number {
    let n = 0;
    for (const s of this.sets.values()) n += s.live.count + s.far.count;
    return n;
  }
}

function write(L: Layer, i: number, baked: BakedModel, x: number, y: number, z: number, yaw: number, anim: AnimName, start: number, speed: number, team: THREE.Color, tint: number): void {
  const m = L.mesh.instanceMatrix.array as Float32Array;
  // 每名士兵身高略有不同（0.94–1.06 倍），大軍看起來更自然
  const sc = SOLDIER_SCALE * (0.94 + ((tint * 7.31) % 1) * 0.12);
  const c = Math.cos(yaw) * sc;
  const s = Math.sin(yaw) * sc;
  const o = i * 16;
  m[o] = c;
  m[o + 1] = 0;
  m[o + 2] = -s;
  m[o + 3] = 0;
  m[o + 4] = 0;
  m[o + 5] = sc;
  m[o + 6] = 0;
  m[o + 7] = 0;
  m[o + 8] = s;
  m[o + 9] = 0;
  m[o + 10] = c;
  m[o + 11] = 0;
  m[o + 12] = x;
  m[o + 13] = y;
  m[o + 14] = z;
  m[o + 15] = 1;
  const row = baked.anims[anim];
  const a = L.anim.array as Float32Array;
  a[i * 4] = row.row;
  a[i * 4 + 1] = row.frames;
  a[i * 4 + 2] = start;
  const dur = row.dur / Math.max(0.1, speed);
  a[i * 4 + 3] = row.loop ? dur : -dur;
  const t = L.team.array as Float32Array;
  t[i * 3] = team.r;
  t[i * 3 + 1] = team.g;
  t[i * 3 + 2] = team.b;
  (L.tint.array as Float32Array)[i] = tint;
}
