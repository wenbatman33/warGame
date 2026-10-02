// 地面標示：選取框、命令線、畫戰線時的陣位預覽（貼地的半透明色帶）
import * as THREE from 'three';
import type { Regiment } from '../sim/regiment';
import type { World } from '../sim/world';

export interface PlanPreview {
  reg: Regiment;
  x: number;
  z: number;
  facing: number;
  width: number;
}

const _c = new THREE.Color();
const _m4 = new THREE.Matrix4();
const _slot: [number, number] = [0, 0];

export class Overlays {
  readonly group = new THREE.Group();
  private ribbonGeo = new THREE.BufferGeometry();
  private ribbon: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private n = 0;
  private dots: THREE.InstancedMesh;
  private dotN = 0;

  constructor(private world: World) {
    const cap = 60000;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.ribbonGeo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.ribbonGeo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.ribbon = new THREE.Mesh(this.ribbonGeo, mat);
    this.ribbon.frustumCulled = false;
    this.ribbon.renderOrder = 5;
    const dg = new THREE.CircleGeometry(0.42, 8).rotateX(-Math.PI / 2);
    this.dots = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false, fog: false }), 6000);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 6;
    this.dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(6000 * 3), 3);
    this.group.add(this.ribbon, this.dots);
  }

  private y(x: number, z: number): number {
    return this.world.groundY(x, z) + 0.25;
  }

  /** 貼地色帶 a→b */
  private strip(ax: number, az: number, bx: number, bz: number, w: number, color: THREE.ColorRepresentation, alpha: number): void {
    _c.set(color);
    const len = Math.hypot(bx - ax, bz - az);
    const segs = Math.max(1, Math.ceil(len / 4));
    const nx = (-(bz - az) / (len || 1)) * w * 0.5;
    const nz = ((bx - ax) / (len || 1)) * w * 0.5;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs;
      const t1 = (k + 1) / segs;
      const x0 = ax + (bx - ax) * t0;
      const z0 = az + (bz - az) * t0;
      const x1 = ax + (bx - ax) * t1;
      const z1 = az + (bz - az) * t1;
      const y0 = this.y(x0, z0);
      const y1 = this.y(x1, z1);
      this.quad(x0 - nx, y0, z0 - nz, x0 + nx, y0, z0 + nz, x1 + nx, y1, z1 + nz, x1 - nx, y1, z1 - nz, alpha);
    }
  }

  private quad(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number, alpha: number): void {
    if ((this.n + 6) * 3 > this.pos.length) return;
    const P = this.pos;
    const C = this.col;
    const push = (x: number, y: number, z: number) => {
      P[this.n * 3] = x;
      P[this.n * 3 + 1] = y;
      P[this.n * 3 + 2] = z;
      C[this.n * 4] = _c.r;
      C[this.n * 4 + 1] = _c.g;
      C[this.n * 4 + 2] = _c.b;
      C[this.n * 4 + 3] = alpha;
      this.n++;
    };
    push(ax, ay, az);
    push(bx, by, bz);
    push(cx, cy, cz);
    push(ax, ay, az);
    push(cx, cy, cz);
    push(dx, dy, dz);
  }

  /** 軍團外框（依陣寬、陣深、朝向） */
  private frame(cx: number, cz: number, facing: number, w: number, d: number, color: THREE.ColorRepresentation, alpha: number, thick = 0.5): void {
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    const pt = (lx: number, lz: number): [number, number] => [cx + lx * c + lz * s, cz - lx * s + lz * c];
    const hw = w / 2 + 1;
    const hd = d / 2 + 1;
    const p = [pt(-hw, hd), pt(hw, hd), pt(hw, -hd), pt(-hw, -hd)];
    for (let k = 0; k < 4; k++) {
      const a = p[k];
      const b = p[(k + 1) % 4];
      this.strip(a[0], a[1], b[0], b[1], k === 0 ? thick * 1.8 : thick, color, alpha);
    }
    // 正面箭頭
    const tip = pt(0, hd + 3);
    const l = pt(-2.2, hd + 0.6);
    const r = pt(2.2, hd + 0.6);
    this.strip(l[0], l[1], tip[0], tip[1], thick * 1.4, color, alpha);
    this.strip(r[0], r[1], tip[0], tip[1], thick * 1.4, color, alpha);
  }

  private dot(x: number, z: number, color: THREE.Color): void {
    if (this.dotN >= 6000) return;
    this.dots.setMatrixAt(this.dotN, _m4.makeTranslation(x, this.y(x, z) + 0.02, z));
    this.dots.setColorAt(this.dotN, color);
    this.dotN++;
  }

  update(selected: ReadonlySet<number>, hover: number, preview: PlanPreview[] | null, deploy?: { x: number; z: number; w: number; d: number } | null): void {
    this.n = 0;
    this.dotN = 0;
    const w = this.world;
    // 部署區
    if (deploy) {
      const { x, z, w: dw, d } = deploy;
      const pts: [number, number][] = [
        [x - dw / 2, z - d / 2],
        [x + dw / 2, z - d / 2],
        [x + dw / 2, z + d / 2],
        [x - dw / 2, z + d / 2],
      ];
      for (let k = 0; k < 4; k++) this.strip(pts[k][0], pts[k][1], pts[(k + 1) % 4][0], pts[(k + 1) % 4][1], 1.2, '#5fb8ff', 0.75);
    }
    for (const id of selected) {
      const r = w.regs[id];
      if (!r || r.gone) continue;
      const col = r.routing ? '#ff5544' : '#ffffff';
      this.frame(r.mx, r.mz, r.facing, r.frontage(), r.depth(), col, 0.8);
      // 命令線
      const o = r.order;
      if (o.type === 'move' || o.type === 'retreat') {
        this.strip(r.mx, r.mz, o.x, o.z, 0.45, o.type === 'retreat' ? '#ffcc44' : '#7dff7a', 0.6);
        this.frame(o.x, o.z, o.facing, r.frontage(), r.depth(), '#7dff7a', 0.45, 0.35);
      } else if (o.type === 'attack' && o.target >= 0) {
        const t = w.regs[o.target];
        if (t && !t.gone) this.strip(r.mx, r.mz, t.mx, t.mz, 0.55, '#ff4a3a', 0.7);
      } else if (o.type === 'attack' && o.struct >= 0) {
        const st = w.structs[o.struct];
        this.strip(r.mx, r.mz, st.x, st.z, 0.55, '#ff9a2a', 0.7);
      }
    }
    if (hover >= 0) {
      const r = w.regs[hover];
      if (r && !r.gone && !selected.has(hover)) this.frame(r.mx, r.mz, r.facing, r.frontage(), r.depth(), r.team === w.player ? '#bfe3ff' : '#ff5a4a', 0.65, 0.4);
    }
    if (preview) {
      const col = new THREE.Color('#9dffa0');
      for (const p of preview) {
        const r = p.reg;
        const n = r.members.length - (r.general?.alive ? 1 : 0);
        const ow = r.width;
        r.width = p.width;
        for (let k = 0; k < n; k++) {
          r.slotWorld(k, n, _slot, p.x, p.z, p.facing);
          this.dot(_slot[0], _slot[1], col);
        }
        this.frame(p.x, p.z, p.facing, r.frontage(n), r.depth(n), '#9dffa0', 0.7, 0.4);
        r.width = ow;
      }
    }
    this.ribbonGeo.setDrawRange(0, this.n);
    (this.ribbonGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.ribbonGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.dots.count = this.dotN;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }
}
