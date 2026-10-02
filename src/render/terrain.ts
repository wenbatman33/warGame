// 地形網格：頂點色（草地／森林地／道路／泥灘／岩壁）＋ 片段噪聲細節（CoC 式飽和草地）
import * as THREE from 'three';
import { Heightfield, WATER_LEVEL } from '../map/heightfield';
import { clamp, fbm, smoothstep } from '../util/rng';

export const TERRAIN_COLORS = {
  grassA: '#7db544',
  grassB: '#97c853',
  grassDry: '#b2c45e',
  forestFloor: '#5b8a35',
  road: '#d2ab6c',
  roadEdge: '#b58f57',
  sand: '#d3c08c',
  mud: '#9b8862',
  rock: '#9a9488',
  rockDark: '#78736a',
  bed: '#7a7155',
};

export const GLSL_NOISE = /* glsl */ `
float tHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float tNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** 戰場踐踏貼圖（激戰、屍體處變泥土） */
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
blank.needsUpdate = true;
export const trample = { tex: { value: blank as THREE.Texture }, play: { value: 560 } };

/** 地形圖開關（0..1 淡入淡出）與基準高度 */
export const terrainView = { value: 0 };
export const terrainBase = { value: 3 };

export function buildTerrainMesh(hf: Heightfield, seed: number): THREE.Mesh {
  const n = hf.n;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const C = Object.fromEntries(Object.entries(TERRAIN_COLORS).map(([k, v]) => [k, new THREE.Color(v)])) as Record<keyof typeof TERRAIN_COLORS, THREE.Color>;
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = hf.vx(i);
      const z = hf.vx(j);
      const h = hf.h[k];
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      // 草地：大塊明暗變化
      const g = fbm(x / 55, z / 55, seed + 201, 3) * 0.5 + 0.5;
      const dry = smoothstep(0.55, 0.85, fbm(x / 140, z / 140, seed + 77, 2) * 0.5 + 0.5);
      c.copy(C.grassA).lerp(C.grassB, g);
      c.lerp(C.grassDry, dry * 0.5);
      // 森林地面
      c.lerp(C.forestFloor, hf.forest[k] * 0.85);
      // 岩壁
      const s = hf.slope(x, z);
      const rock = smoothstep(0.42, 0.75, s);
      if (rock > 0) {
        tmp.copy(C.rock).lerp(C.rockDark, (Math.sin(h * 1.7) * 0.5 + 0.5) * 0.6);
        c.lerp(tmp, rock);
      }
      // 泥灘、沙岸、河床
      const shore = hf.mud[k];
      if (shore > 0) {
        tmp.copy(C.sand).lerp(C.mud, smoothstep(WATER_LEVEL + 1.5, WATER_LEVEL - 0.3, h));
        c.lerp(tmp, clamp(shore * 0.9, 0, 1));
      }
      if (h < WATER_LEVEL + 0.2) c.lerp(C.bed, smoothstep(WATER_LEVEL + 0.2, WATER_LEVEL - 1.0, h));
      // 道路
      const r = hf.road[k];
      if (r > 0) {
        tmp.copy(C.roadEdge).lerp(C.road, smoothstep(0.3, 0.9, r));
        c.lerp(tmp, smoothstep(0.05, 0.5, r));
      }
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let p = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const d = a + n;
      const e = d + 1;
      idx[p++] = a;
      idx[p++] = d;
      idx[p++] = b;
      idx[p++] = b;
      idx[p++] = d;
      idx[p++] = e;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTerrainView = terrainView;
    sh.uniforms.uTerrainBase = terrainBase;
    sh.uniforms.uTrample = trample.tex;
    sh.uniforms.uTramplePlay = trample.play;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nuniform float uTerrainView;\nuniform float uTerrainBase;\nuniform sampler2D uTrample;\nuniform float uTramplePlay;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  {
    // 細節：中尺度斑塊 ＋ 小尺度草葉顆粒
    float n1 = tNoise(vWPos.xz * 0.11);
    float n2 = tNoise(vWPos.xz * 0.9 + 17.0);
    float n3 = tNoise(vWPos.xz * 3.1 + 3.0);
    float green = smoothstep(0.0, 0.25, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
    diffuseColor.rgb *= 0.93 + n1 * 0.12 + (n2 - 0.5) * 0.08;
    diffuseColor.rgb *= 1.0 - green * step(0.8, n3) * 0.12;
    // 踐踏：草地被踩成泥（帶噪聲邊緣）
    vec2 tuv = vWPos.xz / uTramplePlay + 0.5;
    float tr = texture2D(uTrample, tuv).r;
    tr = smoothstep(0.08, 0.7, tr + (n2 - 0.5) * 0.25);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.29, 0.2) * (0.85 + n1 * 0.3), tr * 0.75);
  }
  if (uTerrainView > 0.001) {
    // 地形圖：高度色帶（低＝藍綠、高＝暖橘）＋ 每 2 m 等高線、每 10 m 粗線
    float rel = vWPos.y - uTerrainBase;
    vec3 band = rel < 0.0 ? mix(vec3(0.35, 0.6, 0.75), vec3(0.55, 0.75, 0.55), clamp(rel / 2.0 + 1.0, 0.0, 1.0))
                          : mix(vec3(0.62, 0.8, 0.5), vec3(0.95, 0.62, 0.3), clamp(rel / 14.0, 0.0, 1.0));
    float f1 = abs(fract(vWPos.y / 2.0 + 0.5) - 0.5) / fwidth(vWPos.y / 2.0);
    float f2 = abs(fract(vWPos.y / 10.0 + 0.5) - 0.5) / fwidth(vWPos.y / 10.0);
    float line = max(1.0 - min(f1, 1.0), (1.0 - min(f2 * 0.6, 1.0)) * 1.0);
    vec3 tv = mix(diffuseColor.rgb, band, 0.55);
    tv = mix(tv, vec3(0.18, 0.12, 0.08), line * 0.55);
    diffuseColor.rgb = mix(diffuseColor.rgb, tv, uTerrainView);
  }`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** 高度場貼圖（給水面算深度用） */
export function heightTexture(hf: Heightfield): THREE.DataTexture {
  // 半精度浮點在 WebGL2 一定可線性過濾（32 位元浮點在部分手機不行）
  const half = new Uint16Array(hf.h.length);
  for (let i = 0; i < hf.h.length; i++) half[i] = THREE.DataUtils.toHalfFloat(hf.h[i]);
  const tex = new THREE.DataTexture(half, hf.n, hf.n, THREE.RedFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
