// 骨骼動畫貼圖（Bone Animation Texture）：把每個動作每一格的骨骼矩陣烘成浮點貼圖
// vertex shader 依實例屬性（動作列、格數、起始時間、長度）取兩格矩陣內插，法線也一起轉換
import * as THREE from 'three';
import { ANIM_ORDER, ANIMS, BONE_COUNT, poseAt, type AnimName } from './rig';
import type { ModelDef } from './soldier';

export interface AnimRow {
  row: number;
  frames: number;
  dur: number;
  loop: boolean;
}

export interface BakedModel {
  def: ModelDef;
  texture: THREE.DataTexture;
  anims: Record<AnimName, AnimRow>;
}

const _t = new THREE.Matrix4();
const _r = new THREE.Matrix4();
const _e = new THREE.Euler();

export function bakeModel(def: ModelDef): BakedModel {
  const anims = {} as Record<AnimName, AnimRow>;
  let rows = 0;
  for (const a of ANIM_ORDER) {
    anims[a] = { row: rows, frames: ANIMS[a].frames, dur: ANIMS[a].dur, loop: ANIMS[a].loop };
    rows += ANIMS[a].frames;
  }
  const W = BONE_COUNT * 3;
  const data = new Float32Array(W * rows * 4);
  const { parent, pivot } = def.rig;
  const world: THREE.Matrix4[] = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
  const done = new Uint8Array(BONE_COUNT);
  const rootM = new THREE.Matrix4();

  for (const a of ANIM_ORDER) {
    const spec = anims[a];
    for (let f = 0; f < spec.frames; f++) {
      const ph = spec.loop ? f / spec.frames : f / (spec.frames - 1);
      const pose = poseAt(def.weapon, def.mounted, a, ph);
      const [px, py, pz] = pose.rootPivot;
      rootM.makeTranslation(pose.rootPos[0], pose.rootPos[1], pose.rootPos[2]);
      rootM.multiply(_t.makeTranslation(px, py, pz));
      rootM.multiply(_r.makeRotationFromEuler(_e.set(pose.rootRot[0], pose.rootRot[1], pose.rootRot[2])));
      rootM.multiply(_t.makeTranslation(-px, -py, -pz));
      done.fill(0);
      const solve = (b: number): THREE.Matrix4 => {
        if (done[b]) return world[b];
        const par = parent[b];
        const m = world[b].copy(par >= 0 ? solve(par) : rootM);
        const bx = pivot[b * 3];
        const by = pivot[b * 3 + 1];
        const bz = pivot[b * 3 + 2];
        m.multiply(_t.makeTranslation(bx, by, bz));
        m.multiply(_r.makeRotationFromEuler(_e.set(pose.rot[b * 3], pose.rot[b * 3 + 1], pose.rot[b * 3 + 2])));
        m.multiply(_t.makeTranslation(-bx, -by, -bz));
        done[b] = 1;
        return m;
      };
      const rowBase = (spec.row + f) * W * 4;
      for (let b = 0; b < BONE_COUNT; b++) {
        const e = solve(b).elements; // column-major
        // 存成三列（row-major 的前三列）
        for (let r = 0; r < 3; r++) {
          const o = rowBase + (b * 3 + r) * 4;
          data[o] = e[r];
          data[o + 1] = e[4 + r];
          data[o + 2] = e[8 + r];
          data[o + 3] = e[12 + r];
        }
      }
    }
  }
  const texture = new THREE.DataTexture(data, W, rows, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { def, texture, anims };
}

/** 共用動畫時間（秒，遊戲時間；暫停時停止） */
export const animTime = { value: 0 };

export const BAT_DECL = /* glsl */ `
uniform highp sampler2D uBat;
uniform float uAnimTime;
attribute float aBone;
attribute vec4 aAnim;
mat4 batFetch(int row, int bone) {
  int x = bone * 3;
  vec4 r0 = texelFetch(uBat, ivec2(x, row), 0);
  vec4 r1 = texelFetch(uBat, ivec2(x + 1, row), 0);
  vec4 r2 = texelFetch(uBat, ivec2(x + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 batMatrix() {
  float frames = aAnim.y;
  float dur = abs(aAnim.w);
  float p = (uAnimTime - aAnim.z) / dur;
  float f;
  float f1;
  if (aAnim.w > 0.0) {
    f = fract(p) * frames;
    f1 = mod(floor(f) + 1.0, frames);
  } else {
    f = clamp(p, 0.0, 1.0) * (frames - 1.0);
    f1 = min(floor(f) + 1.0, frames - 1.0);
  }
  float f0 = floor(f);
  int bone = int(aBone + 0.5);
  mat4 a = batFetch(int(aAnim.x + f0), bone);
  mat4 b = batFetch(int(aAnim.x + f1), bone);
  return a + (b - a) * (f - f0);
}
`;
