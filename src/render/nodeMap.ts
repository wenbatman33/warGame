// 地點地圖：道路（貼地色帶）與地點（貼地圓環，顏色＝誰佔領／起火／可選目標）
import * as THREE from 'three';
import type { NodeGame } from '../node/game';
import { NODE_R } from '../node/game';
import type { World } from '../sim/world';

const C_ROAD = new THREE.Color('#f3e2b0');
const C_NEUTRAL = new THREE.Color('#ffffff');
const C_MINE = new THREE.Color('#4aa8ff');
const C_FOE = new THREE.Color('#ff5a45');
const C_FIRE = new THREE.Color('#ff8a1e');
const C_PICK = new THREE.Color('#ffe14a');

export class NodeMapRenderer {
  readonly group = new THREE.Group();
  private rings = new Map<string, { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }>();
  /** 拖曳中可選的目標地點（由介面設定） */
  highlight = new Set<string>();
  private t = 0;

  constructor(
    private w: World,
    private g: NodeGame,
  ) {
    // 道路
    const pos: number[] = [];
    const idx: number[] = [];
    for (const [a, b] of g.sc.edges) {
      const na = g.nodes.get(a)!;
      const nb = g.nodes.get(b)!;
      this.strip(pos, idx, na.x, na.z, nb.x, nb.z, 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setIndex(idx);
    const road = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: C_ROAD, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false }));
    road.renderOrder = 3;
    road.frustumCulled = false;
    this.group.add(road);
    // 地點圓環
    for (const n of g.nodes.values()) {
      const mat = new THREE.MeshBasicMaterial({ color: C_NEUTRAL, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(this.ring(n.x, n.z, NODE_R - 4, NODE_R), mat);
      mesh.renderOrder = 4;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.rings.set(n.id, { mesh, mat });
    }
  }

  private y(x: number, z: number): number {
    return this.w.groundY(x, z) + 0.35;
  }

  /** 貼地色帶 */
  private strip(pos: number[], idx: number[], ax: number, az: number, bx: number, bz: number, wd: number): void {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(len / 4));
    const nx = (-(bz - az) / len) * wd * 0.5;
    const nz = ((bx - ax) / len) * wd * 0.5;
    const base = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      pos.push(x - nx, this.y(x - nx, z - nz), z - nz, x + nx, this.y(x + nx, z + nz), z + nz);
      if (k < n) {
        const a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }

  /** 貼地圓環（每個頂點跟著地形高度） */
  private ring(cx: number, cz: number, r0: number, r1: number): THREE.BufferGeometry {
    const seg = 48;
    const pos: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      for (const r of [r0, r1]) {
        const x = cx + c * r;
        const z = cz + s * r;
        pos.push(x, this.y(x, z) + 0.05, z);
      }
      if (k < seg) {
        const b = k * 2;
        idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  update(dt: number): void {
    this.t += dt;
    const g = this.g;
    const me = this.w.player;
    for (const [id, { mesh, mat }] of this.rings) {
      let col = C_NEUTRAL;
      let op = 0.42;
      if (g.isBurning(id)) {
        col = C_FIRE;
        op = 0.65 + Math.sin(this.t * 7) * 0.2;
      } else if (g.held(id, me)) {
        col = C_FOE;
        op = 0.6;
      } else if (g.held(id, 1 - me)) {
        col = C_MINE;
        op = 0.6;
      }
      if (this.highlight.has(id)) {
        col = C_PICK;
        op = 0.75 + Math.sin(this.t * 8) * 0.2;
      }
      mat.color.copy(col);
      mat.opacity = op;
      const s = this.highlight.has(id) ? 1.12 : 1;
      mesh.scale.setScalar(1);
      void s;
    }
  }
}
