// 天氣畫面：雨絲（GPU 落下動畫，跟著鏡頭）
import * as THREE from 'three';

export const rainTime = { value: 0 };

export class Rain {
  readonly mesh: THREE.InstancedMesh;
  private readonly box = 150;
  private readonly height = 70;

  constructor(count = 7000) {
    const geo = new THREE.BoxGeometry(0.03, 1.6, 0.03);
    const mat = new THREE.MeshBasicMaterial({ color: '#c8d6e6', transparent: true, opacity: 0.38, depthWrite: false, fog: false });
    const H = this.height;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uRainT = rainTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uRainT;\nattribute float aPhase;`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  // 落下：依相位錯開，循環高度 ${H} m，帶一點風斜
  float fall = mod(uRainT * 32.0 + aPhase * ${H.toFixed(1)}, ${H.toFixed(1)});
  transformed.y -= fall;
  transformed.x += fall * 0.12;`,
        );
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      m.makeTranslation((Math.random() - 0.5) * this.box, H, (Math.random() - 0.5) * this.box);
      this.mesh.setMatrixAt(i, m);
      phase[i] = Math.random();
    }
    this.mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** 跟著鏡頭注視點 */
  follow(x: number, y: number, z: number, dt: number): void {
    this.mesh.position.set(x, y - 10, z);
    rainTime.value += dt;
  }
}
