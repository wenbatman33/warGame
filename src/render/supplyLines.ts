// 糧道：地面上的流動虛線（己方顏色、往本陣流動）；被切斷時轉紅、停止流動，斷點標出紅色 ✕
import * as THREE from 'three';
import type { World } from '../sim/world';
import type { Structure } from '../sim/structures';

const VERT = /* glsl */ `
attribute float aU;
attribute float aV;
varying float vU;
varying float vV;
void main() {
  vU = aU;
  vV = aV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
uniform float uFlow;
varying float vU;
varying float vV;
void main() {
  // 箭頭狀虛線：往本陣方向流動
  float p = fract((vU - uTime * uFlow) / 7.0 - abs(vV) * 0.08);
  float dash = smoothstep(0.0, 0.08, p) * (1.0 - smoothstep(0.5, 0.58, p));
  float edge = 1.0 - smoothstep(0.55, 1.0, abs(vV));
  float a = (0.28 + dash * 0.72) * edge * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

interface Line {
  st: Structure;
  route: [number, number][];
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  base: THREE.Color;
}

const RED = new THREE.Color('#ff3b2f');
const GRAY = new THREE.Color('#6b6258');

export class SupplyLines {
  readonly group = new THREE.Group();
  private lines: Line[] = [];
  private marks = new Map<number, THREE.Sprite>();
  private markTex: THREE.CanvasTexture;
  private time = 0;
  /** 部署階段（規劃糧道）：我軍糧道加寬加亮 */
  planning = false;

  constructor(private world: World) {
    this.markTex = makeMarkTexture();
    for (const team of world.teams) {
      if (!team.hq) continue;
      for (const st of world.supplySources(team)) {
        if (st.route.length < 2) continue;
        const base = new THREE.Color(team.color).lerp(new THREE.Color('#fff2c4'), 0.25);
        const mat = new THREE.ShaderMaterial({
          vertexShader: VERT,
          fragmentShader: FRAG,
          uniforms: { uColor: { value: base.clone() }, uTime: { value: 0 }, uOpacity: { value: 0.75 }, uFlow: { value: 5 } },
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        });
        const mesh = new THREE.Mesh(this.ribbon(st.route, 3.2), mat);
        mesh.renderOrder = 4;
        mesh.frustumCulled = false;
        this.group.add(mesh);
        this.lines.push({ st, route: st.route, mesh, mat, base });
      }
    }
  }

  /** 沿路線建貼地色帶（aU＝沿線距離、aV＝橫向 −1..1） */
  private ribbon(route: [number, number][], width: number): THREE.BufferGeometry {
    const w = this.world;
    const n = route.length;
    const pos = new Float32Array(n * 2 * 3);
    const u = new Float32Array(n * 2);
    const v = new Float32Array(n * 2);
    let dist = 0;
    for (let k = 0; k < n; k++) {
      const [x, z] = route[k];
      const [ax, az] = route[Math.max(0, k - 1)];
      const [bx, bz] = route[Math.min(n - 1, k + 1)];
      const dx = bx - ax;
      const dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * width * 0.5;
      const nz = (dx / l) * width * 0.5;
      if (k > 0) dist += Math.hypot(x - route[k - 1][0], z - route[k - 1][1]);
      for (let side = 0; side < 2; side++) {
        const sx = side ? x + nx : x - nx;
        const sz = side ? z + nz : z - nz;
        const o = (k * 2 + side) * 3;
        pos[o] = sx;
        pos[o + 1] = Math.max(w.groundY(sx, sz), w.groundY(x, z)) + 0.35;
        pos[o + 2] = sz;
        u[k * 2 + side] = dist;
        v[k * 2 + side] = side ? 1 : -1;
      }
    }
    const idx: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const a = k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    g.setAttribute('aV', new THREE.BufferAttribute(v, 1));
    g.setIndex(idx);
    return g;
  }

  update(dt: number): void {
    this.time += dt;
    const w = this.world;
    for (const L of this.lines) {
      const st = L.st;
      // 路線改了（玩家部署糧道）：重建色帶
      if (L.route !== st.route) {
        L.mesh.geometry.dispose();
        L.mesh.geometry = this.ribbon(st.route, 3.2);
        L.route = st.route;
      }
      const lost = st.burnt || st.team !== st.owner;
      const u = L.mat.uniforms;
      if (lost) {
        // 補給點已失：灰色、不流動
        u.uColor.value.copy(GRAY);
        u.uOpacity.value = 0.45;
      } else if (st.cut) {
        // 被切斷：紅色閃爍、不流動
        u.uColor.value.copy(RED);
        u.uOpacity.value = 0.65 + Math.sin(this.time * 6) * 0.25;
      } else if (st.cutT > 0) {
        // 被佔住、即將切斷：橘紅
        u.uColor.value.copy(L.base).lerp(RED, Math.min(1, st.cutT / 8));
        u.uOpacity.value = 0.85;
        u.uTime.value = this.time;
      } else {
        u.uColor.value.copy(L.base);
        u.uOpacity.value = this.planning && st.team === w.player ? 1 : 0.75;
        u.uTime.value = this.time;
      }
      // 斷點標記
      let m = this.marks.get(st.id);
      const show = !lost && (st.cut || st.cutT > 0);
      if (show && !m) {
        m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markTex, transparent: true, depthTest: false, fog: false }));
        m.renderOrder = 20;
        this.group.add(m);
        this.marks.set(st.id, m);
      }
      if (m) {
        m.visible = show;
        if (show) {
          // 貼近地面（避開部隊頭上的兵力徽章）
          const s = st.cut ? 13 + Math.sin(this.time * 6) * 1.5 : 8;
          m.scale.set(s, s, 1);
          m.position.set(st.cutX, w.groundY(st.cutX, st.cutZ) + 2, st.cutZ);
          (m.material as THREE.SpriteMaterial).opacity = st.cut ? 1 : 0.7;
        }
      }
    }
  }
}

function makeMarkTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(200,20,10,0.92)';
  g.beginPath();
  g.arc(64, 64, 56, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#000';
  g.stroke();
  g.strokeStyle = '#fff';
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(40, 40);
  g.lineTo(88, 88);
  g.moveTo(88, 40);
  g.lineTo(40, 88);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
