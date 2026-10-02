// 模型檢視器（?view=models）：所有兵種 × 所有動作排成格子，用來調整造型與姿勢
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { animTime } from '../models/bake';
import { ANIM_ORDER } from '../models/rig';
import { MODEL_KEYS } from '../models/soldier';
import { SoldierRenderer } from '../render/soldiers';
import { Stage } from '../render/stage';

export function startModelViewer(container: HTMLElement): void {
  const stage = new Stage(container, 'high');
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#86b84a', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  stage.scene.add(ground);
  const sr = new SoldierRenderer({}, 10);
  stage.scene.add(sr.group);
  const team = new THREE.Color('#2f6fd6');
  const params = new URLSearchParams(location.search);
  const only = params.get('m');
  const keys = only ? MODEL_KEYS.filter((k) => only.split(',').includes(k)) : MODEL_KEYS;
  const onlyA = params.get('a');
  const anims = onlyA ? ANIM_ORDER.filter((a) => onlyA.split(',').includes(a)) : ANIM_ORDER;
  const yawView = Number(params.get('yaw') ?? 0.6);
  const frozen = params.get('t');
  const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
  const cx = (anims.length - 1) * 1.6;
  const cz = (keys.length - 1) * 1.75;
  const span = Math.max(anims.length * 3.2, keys.length * 3.5);
  controls.target.set(cx, 1.1, cz);
  stage.camera.position.set(cx + Math.sin(yawView) * span * 0.9, 2 + span * 0.25, cz + Math.cos(yawView) * span * 0.9);
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;top:8px;color:#fff;font:12px sans-serif;text-shadow:0 1px 2px #000;white-space:pre';
  label.textContent = '列：' + keys.join(' / ') + '\n欄：' + anims.join(' / ');
  container.appendChild(label);
  let last = performance.now();
  stage.renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    animTime.value = frozen ? Number(frozen) : animTime.value + dt;
    controls.update();
    sr.begin();
    keys.forEach((k, r) => {
      anims.forEach((a, c) => {
        const start = a === 'die' || a === 'die2' ? Math.floor(animTime.value / 2.5) * 2.5 : 0;
        sr.push(k, c * 3.2, 0, r * 3.5, 0, a, start, 1, team, 0.5);
      });
    });
    sr.end();
    stage.updateShadow(controls.target, 40);
    stage.render();
  });
}
