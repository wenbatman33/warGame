// 程式建模工具：把基本幾何體依骨骼、顏色、隊伍色遮罩合併成一個模型
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 位移＋旋轉（弧度，XYZ）＋縮放 */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

/** 讓幾何體從 a 點延伸到 b 點（幾何體預設沿 +Y、中心在原點） */
export function between(geo: THREE.BufferGeometry, a: THREE.Vector3Like, b: THREE.Vector3Like): THREE.BufferGeometry {
  const va = new THREE.Vector3(a.x, a.y, a.z);
  const vb = new THREE.Vector3(b.x, b.y, b.z);
  const dir = vb.clone().sub(va);
  const len = dir.length();
  geo.scale(1, len, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  _m.compose(va.add(vb).multiplyScalar(0.5), q, _s.set(1, 1, 1));
  geo.applyMatrix4(_m);
  return geo;
}

/** 細節等級：0＝近景（上限 8 段）、1＝遠景（約六成段數、最少 4 段） */
export const KIT = { lod: 0 };
const segs = (n: number, min = 3) => (KIT.lod ? Math.max(min, Math.round(n * 0.4)) : Math.min(n, 8));
const rings = (n: number, min = 2) => (KIT.lod ? Math.max(min, Math.round(n * 0.34)) : Math.min(n, 6));

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, segs(seg), 1, open);
export const sphere = (r: number, ws = 8, hs = 6) => new THREE.SphereGeometry(r, segs(ws, 4), rings(hs, 2));
export const hemi = (r: number, ws = 8, hs = 4) => new THREE.SphereGeometry(r, segs(ws), rings(hs), 0, Math.PI * 2, 0, Math.PI / 2);
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, segs(seg, 3));

/** 一個模型的建構器：每個頂點帶骨骼編號 aBone、隊伍色遮罩 aMask */
export class ModelBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private bone: number[] = [];
  private mask: number[] = [];
  /** 全域位移（騎乘時把騎手整個抬到馬背上） */
  offset = new THREE.Vector3();

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, bone: number, m?: THREE.Matrix4, mask = 0): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    if (this.offset.lengthSq() > 0) g.translate(this.offset.x, this.offset.y, this.offset.z);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    const nm = g.getAttribute('normal');
    const c = new THREE.Color(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(nm.getX(i), nm.getY(i), nm.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.bone.push(bone);
      this.mask.push(mask);
    }
    if (g !== geo) g.dispose();
    geo.dispose();
    return this;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1));
    g.setAttribute('aMask', new THREE.Float32BufferAttribute(this.mask, 1));
    g.computeBoundingSphere();
    return g;
  }
}
