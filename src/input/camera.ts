// RTS 鏡頭：CoC 式斜俯視，縮放時俯角自動變化（拉近像電影鏡頭、拉遠看全局）
import * as THREE from 'three';
import type { Heightfield } from '../map/heightfield';

export const CAM = {
  fov: 40,
  minDist: 22,
  maxDist: 460,
  pitchNear: 30, // 度：最近時的俯角
  pitchFar: 58, // 度：最遠時的俯角
  keyPanSpeed: 1.1, // 每秒移動「距離 × 倍數」
  edgePan: true,
  rotateSpeed: 1.8,
  smooth: 10,
};

export class RtsCamera {
  readonly target = new THREE.Vector3();
  dist = 190;
  yaw = 0;
  private goal = new THREE.Vector3();
  private goalDist = 190;
  private goalYaw = 0;
  private groundY = 0;
  /** 鏡頭震動（衝鋒、爆燃） */
  shake = 0;

  constructor(
    private cam: THREE.PerspectiveCamera,
    private hf: Heightfield,
  ) {}

  set(x: number, z: number, dist?: number, yaw?: number, instant = true): void {
    this.goal.set(x, 0, z);
    if (dist !== undefined) this.goalDist = dist;
    if (yaw !== undefined) this.goalYaw = yaw;
    if (instant) {
      this.target.copy(this.goal);
      this.dist = this.goalDist;
      this.yaw = this.goalYaw;
      this.groundY = this.hf.height(x, z);
    }
  }

  get pitch(): number {
    const t = (this.dist - CAM.minDist) / (CAM.maxDist - CAM.minDist);
    const e = Math.sqrt(THREE.MathUtils.clamp(t, 0, 1));
    return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(CAM.pitchNear, CAM.pitchFar, e));
  }

  /** 地面上的「往前」與「往右」 */
  forward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }
  right(): [number, number] {
    return [Math.cos(this.yaw), -Math.sin(this.yaw)];
  }

  panBy(dx: number, dz: number): void {
    this.goal.x += dx;
    this.goal.z += dz;
    this.clampGoal();
  }

  /** 螢幕方向平移（像素 → 世界，依縮放換算） */
  panScreen(px: number, py: number, viewH: number): void {
    const worldPerPx = (2 * this.dist * Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2))) / viewH;
    const [fx, fz] = this.forward();
    const [rx, rz] = this.right();
    const k = worldPerPx * 1.1;
    this.panBy((-px * rx + py * fx / Math.sin(this.pitch)) * k, (-px * rz + py * fz / Math.sin(this.pitch)) * k);
  }

  zoomBy(factor: number, focus?: THREE.Vector3): void {
    const nd = THREE.MathUtils.clamp(this.goalDist * factor, CAM.minDist, CAM.maxDist);
    if (focus) {
      // 朝游標方向縮放
      const k = 1 - nd / this.goalDist;
      this.goal.x += (focus.x - this.goal.x) * k;
      this.goal.z += (focus.z - this.goal.z) * k;
      this.clampGoal();
    }
    this.goalDist = nd;
  }

  rotateBy(a: number): void {
    this.goalYaw += a;
  }

  private clampGoal(): void {
    const p = this.hf.play / 2;
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -p, p);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -p, p);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-CAM.smooth * dt);
    this.target.x += (this.goal.x - this.target.x) * k;
    this.target.z += (this.goal.z - this.target.z) * k;
    this.dist += (this.goalDist - this.dist) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    const gy = this.hf.groundOrWater(this.target.x, this.target.z);
    this.groundY += (gy - this.groundY) * Math.min(1, dt * 4);
    this.target.y = this.groundY;

    const p = this.pitch;
    const cp = Math.cos(p);
    const sp = Math.sin(p);
    const cam = this.cam;
    cam.position.set(this.target.x + Math.sin(this.yaw) * cp * this.dist, this.target.y + sp * this.dist, this.target.z + Math.cos(this.yaw) * cp * this.dist);
    // 不穿地
    const floor = this.hf.groundOrWater(cam.position.x, cam.position.z) + 4;
    if (cam.position.y < floor) cam.position.y = floor;
    const look = this.target.clone();
    if (this.shake > 0) {
      const s = this.shake * 0.6;
      look.x += (Math.random() - 0.5) * s;
      look.y += (Math.random() - 0.5) * s;
      look.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    cam.lookAt(look);
    if (cam.fov !== CAM.fov) {
      cam.fov = CAM.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** 目前視野大約涵蓋的半徑（陰影範圍、LOD 用） */
  get viewRadius(): number {
    return this.dist * Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2)) * 1.6;
  }
}
