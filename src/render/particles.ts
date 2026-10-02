// 粒子：火焰（加色）、濃煙、塵土、火花；CPU 模擬、Points 繪製（柔邊圓點）
import * as THREE from 'three';

export type ParticleKind = 'fire' | 'smoke' | 'dust' | 'spark' | 'ember' | 'blood';

interface Pool {
  points: THREE.Points;
  pos: Float32Array;
  col: Float32Array;
  size: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  max: Float32Array;
  grow: Float32Array;
  cap: number;
  n: number;
}

const VERT = /* glsl */ `
attribute float aSize;
attribute vec4 aCol;
varying vec4 vCol;
uniform float uScale;
#include <fog_pars_vertex>
void main() {
  vCol = aCol;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */ `
varying vec4 vCol;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.15, d);
  gl_FragColor = vec4(vCol.rgb, vCol.a * a);
  #include <fog_fragment>
}`;

function makePool(cap: number, additive: boolean, scale: { value: number }): Pool {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3);
  const col = new Float32Array(cap * 4);
  const size = new Float32Array(cap);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: scale }]),
  });
  mat.uniforms.uScale = scale;
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 9 : 8;
  return { points, pos, col, size, vel: new Float32Array(cap * 3), life: new Float32Array(cap), max: new Float32Array(cap), grow: new Float32Array(cap), cap, n: 0 };
}

const COLORS: Record<ParticleKind, [number, number, number, number]> = {
  fire: [0.95, 0.4, 0.08, 0.75],
  smoke: [0.22, 0.2, 0.19, 0.55],
  dust: [0.78, 0.68, 0.5, 0.35],
  spark: [1.0, 0.85, 0.5, 1.0],
  ember: [1.0, 0.45, 0.1, 1.0],
  blood: [0.55, 0.06, 0.04, 0.8],
};

export class Particles {
  readonly group = new THREE.Group();
  private add: Pool;
  private norm: Pool;
  private scale = { value: 600 };

  constructor() {
    this.add = makePool(5000, true, this.scale);
    this.norm = makePool(7000, false, this.scale);
    this.group.add(this.norm.points, this.add.points);
  }

  resize(h: number): void {
    this.scale.value = h * 0.9;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, n = 1, spread = 1, size = 1): void {
    const additive = kind === 'fire' || kind === 'spark' || kind === 'ember';
    const p = additive ? this.add : this.norm;
    const c = COLORS[kind];
    for (let k = 0; k < n; k++) {
      if (p.n >= p.cap) return;
      const i = p.n++;
      p.pos[i * 3] = x + (Math.random() - 0.5) * spread;
      p.pos[i * 3 + 1] = y + Math.random() * spread * 0.3;
      p.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      let vx = (Math.random() - 0.5) * 0.6;
      let vy = 0;
      let vz = (Math.random() - 0.5) * 0.6;
      let life = 1;
      let s = 1;
      let grow = 0;
      switch (kind) {
        case 'fire':
          vy = 2.5 + Math.random() * 2.5;
          life = 0.6 + Math.random() * 0.6;
          s = 3.2 + Math.random() * 2.5;
          grow = -2.5;
          break;
        case 'smoke':
          vy = 2.2 + Math.random() * 1.8;
          vx += 0.8;
          life = 5 + Math.random() * 4;
          s = 4 + Math.random() * 3;
          grow = 2.4;
          break;
        case 'dust':
          vy = 0.6 + Math.random() * 0.6;
          life = 1.2 + Math.random() * 0.8;
          s = 2 + Math.random() * 1.5;
          grow = 1.6;
          break;
        case 'spark':
          vx *= 8;
          vz *= 8;
          vy = 2 + Math.random() * 3;
          life = 0.25 + Math.random() * 0.2;
          s = 0.6;
          break;
        case 'ember':
          vx *= 3;
          vz *= 3;
          vy = 3 + Math.random() * 4;
          life = 1.5 + Math.random() * 1.5;
          s = 0.5 + Math.random() * 0.4;
          break;
        case 'blood':
          vx *= 3;
          vz *= 3;
          vy = 1 + Math.random() * 1.5;
          life = 0.4;
          s = 0.5;
          break;
      }
      p.vel[i * 3] = vx;
      p.vel[i * 3 + 1] = vy;
      p.vel[i * 3 + 2] = vz;
      p.life[i] = p.max[i] = life;
      p.size[i] = s * size;
      p.grow[i] = grow;
      p.col[i * 4] = c[0];
      p.col[i * 4 + 1] = c[1];
      p.col[i * 4 + 2] = c[2];
      p.col[i * 4 + 3] = c[3];
    }
  }

  update(dt: number): void {
    for (const p of [this.add, this.norm]) {
      let w = 0;
      for (let i = 0; i < p.n; i++) {
        p.life[i] -= dt;
        if (p.life[i] <= 0) continue;
        // 壓縮：把活著的往前搬
        if (w !== i) {
          p.pos[w * 3] = p.pos[i * 3];
          p.pos[w * 3 + 1] = p.pos[i * 3 + 1];
          p.pos[w * 3 + 2] = p.pos[i * 3 + 2];
          p.vel[w * 3] = p.vel[i * 3];
          p.vel[w * 3 + 1] = p.vel[i * 3 + 1];
          p.vel[w * 3 + 2] = p.vel[i * 3 + 2];
          p.col[w * 4] = p.col[i * 4];
          p.col[w * 4 + 1] = p.col[i * 4 + 1];
          p.col[w * 4 + 2] = p.col[i * 4 + 2];
          p.col[w * 4 + 3] = p.col[i * 4 + 3];
          p.life[w] = p.life[i];
          p.max[w] = p.max[i];
          p.size[w] = p.size[i];
          p.grow[w] = p.grow[i];
        }
        const k = w;
        w++;
        p.pos[k * 3] += p.vel[k * 3] * dt;
        p.pos[k * 3 + 1] += p.vel[k * 3 + 1] * dt;
        p.pos[k * 3 + 2] += p.vel[k * 3 + 2] * dt;
        p.vel[k * 3 + 1] -= (p === this.add ? -0.5 : 0.1) * dt;
        p.size[k] = Math.max(0.05, p.size[k] + p.grow[k] * dt);
        const f = p.life[k] / p.max[k];
        // 淡出（火焰由黃轉紅）
        if (p === this.add) {
          p.col[k * 4 + 1] = Math.max(0.15, p.col[k * 4 + 1] - dt * 0.6);
          p.col[k * 4 + 3] = Math.min(1, f * 1.4);
        } else p.col[k * 4 + 3] = Math.min(p.col[k * 4 + 3], f * 0.7 + 0.05);
      }
      p.n = w;
      const g = p.points.geometry;
      g.setDrawRange(0, p.n);
      for (const name of ['position', 'aCol', 'aSize']) {
        const a = g.getAttribute(name) as THREE.BufferAttribute;
        a.clearUpdateRanges();
        a.addUpdateRange(0, p.n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }
}
