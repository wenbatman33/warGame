// 道具／營寨／植被的目視預覽頁（props-preview.html），只給開發驗證用
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  PROP_KINDS,
  buildBanner,
  buildCamp,
  buildDepot,
  buildHQ,
  buildWaterSource,
  propGeometry,
  propMaterial,
  propTime,
  type StructureVisual,
} from '../models/props';
import { grassTuftGeometry, rockGeometry, treeGeometry, type TreeVariant } from '../models/trees';

const TEAM = { wei: '#3f6fd6', yuan: '#e8b22a', shu: '#3e9e4a', wu: '#cf3b2f' };

// ───────── 場景 ─────────
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd3f0');
scene.fog = new THREE.Fog('#a9d8f0', 160, 420);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.5, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight('#cfe6ff', '#7c9a4a', 1.15));
const sun = new THREE.DirectionalLight('#ffe2b4', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const sc = sun.shadow.camera;
sc.left = -60;
sc.right = 60;
sc.top = 60;
sc.bottom = -60;
sc.near = 1;
sc.far = 300;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFF = new THREE.Vector3(-60, 90, 70);

// 地面（帶點色斑的草地）
{
  const g = new THREE.PlaneGeometry(900, 900, 180, 180);
  g.rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color('#6fae3f');
  const b = new THREE.Color('#5c9a36');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const t = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.09);
    c.copy(a).lerp(b, t);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  ground.position.y = -0.01;
  scene.add(ground);
}

// ───────── 標籤 ─────────
function label(text: string, x: number, y: number, z: number, size = 1) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const ctx = cv.getContext('2d')!;
  ctx.font = '900 52px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#3b2a14';
  ctx.strokeText(text, 256, 48);
  ctx.fillStyle = '#fff3c4';
  ctx.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(6 * size, 1.125 * size, 1);
  s.position.set(x, y, z);
  scene.add(s);
}

const stats: string[] = [];
const tri = (g: THREE.BufferGeometry) => g.getAttribute('position').count / 3;

// ───────── 1) 道具一排 ─────────
const propSpots: Record<string, THREE.Vector3> = {};
{
  let x = 0;
  let row = 0;
  stats.push('— 道具（三角形）—');
  PROP_KINDS.forEach((k, i) => {
    if (i === 9) {
      x = 0;
      row = 1;
    }
    const team = [TEAM.wei, TEAM.wu, TEAM.shu, TEAM.yuan][i % 4];
    const g = propGeometry(k, { team, seed: i + 1, length: k === 'bridge' ? 10 : undefined });
    const w = k === 'bridge' ? 14 : k === 'commandTent' ? 13 : k === 'palisadeSegment' || k === 'palisadeGate' ? 9 : 8;
    x += w / 2;
    const m = new THREE.Mesh(g, propMaterial);
    m.castShadow = m.receiveShadow = true;
    const z = row === 0 ? 0 : -22;
    m.position.set(x, 0, z);
    scene.add(m);
    propSpots[k] = new THREE.Vector3(x, 0, z);
    label(k, x, -0.0 + 0.05, z + 6.5, 1);
    stats.push(`${k.padEnd(16)} ${tri(g)}`);
    x += w / 2 + 2;
  });
  // 獨立飄動大旗
  const bn = buildBanner({ team: TEAM.yuan, text: '袁', big: true });
  bn.position.set(-8, 0, 0);
  bn.traverse((o) => (o.castShadow = true));
  scene.add(bn);
  const bn2 = buildBanner({ team: TEAM.wei, text: '曹', left: true });
  bn2.position.set(-14, 0, 0);
  scene.add(bn2);
  propSpots.banner = new THREE.Vector3(-10, 0, 0);
}

// ───────── 2) 結構 ─────────
const structs: Record<string, { v: StructureVisual; pos: THREE.Vector3 }> = {};
function addStruct(name: string, v: StructureVisual, x: number, z: number) {
  v.group.position.set(x, 0, z);
  scene.add(v.group);
  structs[name] = { v, pos: new THREE.Vector3(x, 0, z) };
  label(name, x, 0.1, z + v.radius + 4, 2.2);
  const t = v.group.userData.triangles as { visible: number; visibleBurnt: number; flags: number; pad: number };
  stats.push(`${name.padEnd(13)} 完好總計 ${t.visible}（旗 ${t.flags}、地墊 ${t.pad}）/ 焚毀總計 ${t.visibleBurnt}`);
}
stats.push('', '— 結構（三角形）—');
{
  const Z = 80;
  addStruct('depot', buildDepot({ team: TEAM.yuan, flagText: '袁' }), 0, Z);
  addStruct('depotMain', buildDepot({ team: TEAM.yuan, flagText: '袁', main: true }), 52, Z);
  const burnt = buildDepot({ team: TEAM.yuan, flagText: '袁', seed: 9 });
  burnt.setBurnt(true);
  addStruct('depotBurnt', burnt, 104, Z);
  const low = buildDepot({ team: TEAM.wei, flagText: '曹', seed: 12 });
  low.setStock(0.3);
  addStruct('depotStock30', low, 148, Z);
  addStruct('hq', buildHQ({ team: TEAM.wei, flagText: '曹' }), 0, Z + 62);
  addStruct('camp', buildCamp({ team: TEAM.shu, flagText: '劉' }), 52, Z + 62);
  addStruct('water', buildWaterSource({ team: TEAM.shu }), 90, Z + 62);
  const hqBurnt = buildHQ({ team: TEAM.wu, flagText: '吳', seed: 4 });
  hqBurnt.setBurnt(true);
  addStruct('hqBurnt', hqBurnt, 140, Z + 62);
  const campB = buildCamp({ team: TEAM.wu, flagText: '吳', seed: 8 });
  campB.setBurnt(true);
  addStruct('campBurnt', campB, 190, Z + 62);
  const waterLow = buildWaterSource({ seed: 3 });
  waterLow.setStock(0.15);
  addStruct('waterLow', waterLow, 90, Z + 98);

  // setHeight 測試：凹凸地形上的營寨
  const hx = 190;
  const hz = Z;
  // 高於預覽的平地（y≈0），否則會被平地蓋住
  const hfn = (x: number, z: number) => 2.4 + 1.2 * Math.sin((x - hx) * 0.21) * Math.cos((z - hz) * 0.17) + 0.05 * (x - hx);
  const tg = new THREE.PlaneGeometry(40, 40, 80, 80);
  tg.rotateX(-Math.PI / 2);
  const tp = tg.getAttribute('position');
  for (let i = 0; i < tp.count; i++) tp.setY(i, hfn(tp.getX(i) + hx, tp.getZ(i) + hz));
  tg.computeVertexNormals();
  const terr = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: '#79b347', roughness: 1 }));
  terr.position.set(hx, 0, hz);
  terr.receiveShadow = true;
  scene.add(terr);
  const slope = buildCamp({ team: TEAM.wei, flagText: '魏', seed: 5 });
  slope.group.position.set(hx, hfn(hx, hz), hz);
  slope.group.rotation.y = 0.4;
  scene.add(slope.group);
  slope.setHeight!(hfn);
  structs.campSlope = { v: slope, pos: new THREE.Vector3(hx, 0, hz) };
  label('campSlope (setHeight)', hx, 4, hz + 20, 2.2);
}

// ───────── 3) 植被 ─────────
const swayMat = propMaterial.clone();
swayMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = propTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float sw = aSway * aSway;
      vec4 wp = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      transformed.x += sin(uTime * 1.3 + wp.x * 0.3) * 0.25 * sw;
      transformed.z += cos(uTime * 1.1 + wp.z * 0.3) * 0.18 * sw;`,
    );
};
swayMat.customProgramCacheKey = () => 'preview-sway';
const vegSpot = new THREE.Vector3(0, 0, -70);
{
  stats.push('', '— 植被（三角形）—');
  const variants: TreeVariant[] = ['broadleaf', 'pine', 'bamboo', 'willow', 'burnt'];
  variants.forEach((v, i) => {
    let mx = 0;
    for (let s = 0; s < 3; s++) {
      const g = treeGeometry(v, s);
      mx = Math.max(mx, tri(g));
      const m = new THREE.Mesh(g, swayMat);
      m.castShadow = m.receiveShadow = true;
      m.position.set(i * 14, 0, -60 - s * 11);
      scene.add(m);
    }
    label(v, i * 14, 0.1, -52, 1.2);
    stats.push(`tree:${v.padEnd(10)} 最多 ${mx}`);
  });
  let rmax = 0;
  for (let s = 0; s < 6; s++) {
    const g = rockGeometry(s);
    rmax = Math.max(rmax, tri(g));
    const m = new THREE.Mesh(g, propMaterial);
    m.castShadow = m.receiveShadow = true;
    m.position.set(74 + (s % 3) * 6, 0, -60 - Math.floor(s / 3) * 7);
    m.rotation.y = s;
    scene.add(m);
  }
  label('rocks', 80, 0.1, -52, 1.2);
  stats.push(`rock            最多 ${rmax}`);
  const g0 = grassTuftGeometry(false);
  const g1 = grassTuftGeometry(true);
  stats.push(`grass ${tri(g0)} / 帶花 ${tri(g1)}`);
  const n = 160;
  const im0 = new THREE.InstancedMesh(g0, swayMat, n);
  const im1 = new THREE.InstancedMesh(g1, swayMat, n / 4);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m4.compose(new THREE.Vector3(95 + Math.random() * 10, 0, -58 - Math.random() * 10), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28), new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + Math.random() * 0.5));
    im0.setMatrixAt(i, m4);
    if (i < n / 4) im1.setMatrixAt(i, m4.clone().setPosition(95 + Math.random() * 10, 0, -58 - Math.random() * 10));
  }
  im0.receiveShadow = im1.receiveShadow = true;
  scene.add(im0, im1);
  label('grass', 100, 0.1, -52, 1.2);
}

document.getElementById('stats')!.textContent = stats.join('\n');
console.log(stats.join('\n'));

// ───────── 鏡頭預設 ─────────
const views: Record<string, () => void> = {};
function view(name: string, target: THREE.Vector3, dist: number, yaw = -0.5, pitch = 0.75) {
  views[name] = () => {
    controls.target.copy(target);
    camera.position.set(target.x + Math.sin(yaw) * Math.cos(pitch) * dist, target.y + Math.sin(pitch) * dist, target.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    controls.update();
  };
}
view('道具1', new THREE.Vector3(40, 1.5, 0), 62, -0.2, 0.5);
view('道具2', new THREE.Vector3(40, 1.5, -22), 62, -0.2, 0.5);
for (const [k, p] of Object.entries(propSpots)) view(k, p.clone().setY(1.5), k === 'commandTent' || k === 'bridge' ? 18 : 12, -0.6, 0.45);
for (const [k, s] of Object.entries(structs)) view(k, s.pos.clone().setY(1), s.v.radius * 2.6, -0.45, 0.72);
view('植被', vegSpot.clone().add(new THREE.Vector3(45, 3, -8)), 70, -0.15, 0.4);
views['道具1']();

const ui = document.getElementById('ui')!;
for (const k of ['道具1', '道具2', 'depot', 'depotMain', 'depotBurnt', 'depotStock30', 'hq', 'hqBurnt', 'camp', 'campBurnt', 'campSlope', 'water', 'waterLow', '植被']) {
  const b = document.createElement('button');
  b.textContent = k;
  b.onclick = () => views[k]();
  ui.appendChild(b);
}
{
  const l = document.createElement('label');
  l.textContent = '庫存';
  const r = document.createElement('input');
  r.type = 'range';
  r.min = '0';
  r.max = '1';
  r.step = '0.01';
  r.value = '1';
  r.oninput = () => {
    for (const k of ['depot', 'depotMain', 'hq', 'camp', 'water']) structs[k].v.setStock(+r.value);
  };
  l.appendChild(r);
  ui.appendChild(l);
  const bt = document.createElement('button');
  let burnt = false;
  bt.textContent = '切換焚毀';
  bt.onclick = () => {
    burnt = !burnt;
    for (const k of ['depot', 'depotMain', 'hq', 'camp', 'water']) structs[k].v.setBurnt(burnt);
  };
  ui.appendChild(bt);
}

// 給腳本截圖用
(window as unknown as { __pv: unknown }).__pv = {
  views,
  structs,
  focus: (k: string, dist?: number, yaw?: number, pitch?: number) => {
    const s = structs[k];
    const p = propSpots[k];
    const t = s ? s.pos.clone().setY(1) : p ? p.clone().setY(1.5) : null;
    if (t && dist) {
      view('_tmp', t, dist, yaw ?? -0.5, pitch ?? 0.6);
      views._tmp();
    } else views[k]?.();
  },
  camera,
  controls,
  hideUI: (h: boolean) => {
    ui.style.display = h ? 'none' : 'flex';
    document.getElementById('stats')!.style.display = h ? 'none' : 'block';
  },
};

// ───────── 迴圈 ─────────
const t0 = performance.now();
renderer.setAnimationLoop(() => {
  propTime.value = (performance.now() - t0) / 1000;
  controls.update();
  sun.target.position.copy(controls.target);
  sun.position.copy(controls.target).add(SUN_OFF);
  renderer.render(scene, camera);
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
