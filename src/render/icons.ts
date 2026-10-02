// 兵種卡圖示：用遊戲內同一份 3D 模型即時算圖（保證和戰場一致），快取成 dataURL
import * as THREE from 'three';
import { animTime } from '../models/bake';
import type { ModelKey } from '../models/soldier';
import { SoldierRenderer } from './soldiers';

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let cam: THREE.PerspectiveCamera | null = null;
let soldiers: SoldierRenderer | null = null;
const cache = new Map<string, string>();

function setup(): void {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(128, 128);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight('#fff2dc', 3.2);
  sun.position.set(3, 6, 5);
  const rim = new THREE.DirectionalLight('#9fc8ff', 1.6);
  rim.position.set(-4, 3, -4);
  scene.add(sun, rim, new THREE.HemisphereLight('#d8ecff', '#6a5a40', 1.3));
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  soldiers = new SoldierRenderer({}, 1);
  soldiers.shadows = false;
  soldiers.cam.set(0, 1.5, 3);
  scene.add(soldiers.group);
}

/** 取得某模型＋隊伍色的圖示 */
export function unitIcon(model: ModelKey, color: string): string {
  const key = `${model}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    setup();
  } catch {
    return '';
  }
  const mounted = model.includes('cav') || model === 'horsearcher' || model.startsWith('gen_');
  const t0 = animTime.value;
  animTime.value = 0.4;
  soldiers!.begin();
  soldiers!.push(model, 0, 0, 0, 0.55, 'idle', 0, 0.001, new THREE.Color(color), 0.5);
  soldiers!.end();
  if (mounted) {
    cam!.position.set(2.1, 2.7, 3.5);
    cam!.lookAt(0, 1.85, 0.25);
  } else {
    cam!.position.set(0.95, 1.6, 2.05);
    cam!.lookAt(0, 1.22, 0);
  }
  renderer!.render(scene!, cam!);
  animTime.value = t0;
  const url = renderer!.domElement.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
