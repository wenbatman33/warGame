// 箭矢渲染：InstancedMesh，依拋物線插值位置與朝向；火矢帶橘光
import * as THREE from 'three';
import type { Projectiles } from '../sim/projectiles';

export class ArrowRenderer {
  readonly mesh: THREE.InstancedMesh;
  private tmp = new Float32Array(6);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private dir = new THREE.Vector3();
  private up = new THREE.Vector3(0, 0, 1);
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3(1, 1, 1);
  private normal = new THREE.Color('#3b2a1c');
  private fire = new THREE.Color('#ffb040');

  constructor(cap: number) {
    // 箭桿＋箭羽（沿 +Z）
    const shaft = new THREE.BoxGeometry(0.035, 0.035, 0.95);
    const fl = new THREE.BoxGeometry(0.12, 0.012, 0.18);
    fl.translate(0, 0, -0.38);
    const fl2 = fl.clone().rotateZ(Math.PI / 2);
    const geo = mergeSimple([shaft, fl, fl2]);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  update(p: Projectiles, t: number): void {
    let n = 0;
    for (let k = 0; k < p.cap; k++) {
      if (!p.active[k] || t < p.t0[k]) continue;
      p.at(k, t, this.tmp);
      this.pos.set(this.tmp[0], this.tmp[1], this.tmp[2]);
      this.dir.set(this.tmp[3], this.tmp[4], this.tmp[5]).normalize();
      this.q.setFromUnitVectors(this.up, this.dir);
      const s = p.fire[k] ? 1.4 : 1;
      this.scl.set(s, s, s);
      this.m.compose(this.pos, this.q, this.scl);
      this.mesh.setMatrixAt(n, this.m);
      this.mesh.setColorAt(n, p.fire[k] ? this.fire : this.normal);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of geos) {
    const ng = g.index ? g.toNonIndexed() : g;
    const a = ng.getAttribute('position');
    for (let i = 0; i < a.count; i++) pos.push(a.getX(i), a.getY(i), a.getZ(i));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return out;
}
