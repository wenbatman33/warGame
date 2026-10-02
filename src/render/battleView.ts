// 戰場畫面：把模擬（World）畫出來——地形、水、植被、士兵、屍體、箭、營寨、輜重車、特效、地面標示
import * as THREE from 'three';
import { FACTIONS } from '../data/factions';
import { animTime } from '../models/bake';
import { ANIM_ORDER } from '../models/rig';
import { buildDepot, buildHQ, buildCamp, buildWaterSource, propGeometry, propMaterial, propTime, type StructureVisual } from '../models/props';
import { grassTuftGeometry, rockGeometry, treeGeometry } from '../models/trees';
import { SState } from '../sim/soldiers';
import type { Structure } from '../sim/structures';
import { TICK, type GameEvent, type World } from '../sim/world';
import { shipGeometry, SHIP_FIRE } from '../models/ship';
import { WATER_LEVEL } from '../map/heightfield';
import { ArrowRenderer } from './arrows';
import { Banners } from './banners';
import { Overlays } from './overlays';
import { Particles } from './particles';
import { LOD, SoldierRenderer } from './soldiers';
import { LIGHT, Stage, type Quality } from './stage';
import { buildTerrainMesh, heightTexture, trample } from './terrain';
import { buildVegetation, windTime } from './vegetation';
import { buildWater, waterTime, waterTint } from './water';

interface StructView {
  st: Structure;
  vis: StructureVisual;
  burntShown: boolean;
  lastFrac: number;
}

export class BattleView {
  readonly stage: Stage;
  readonly soldiers: SoldierRenderer;
  readonly overlays: Overlays;
  readonly particles = new Particles();
  private arrows: ArrowRenderer;
  private banners: Banners;
  private structs: StructView[] = [];
  private wagonMeshes = new Map<number, THREE.Mesh>();
  private wagonGeo: THREE.BufferGeometry[] = [];
  private teamColors: THREE.Color[];
  private sunDir = new THREE.Vector3();
  private fireLights: THREE.PointLight[] = [];
  private ships: { mesh: THREE.Mesh; burning: boolean; ph: number }[] = [];
  private trampleData: Uint8Array;
  private trampleTex: THREE.DataTexture;
  private trampleT = 0;
  private readonly TR = 256;
  /** 自動畫質：逐級降低（0＝原設定） */
  perfLevel = 0;
  degrade(): string | null {
    const st = this.stage;
    this.perfLevel++;
    if (this.perfLevel === 1) {
      st.setBloom(false);
      st.renderer.setPixelRatio(1);
      st.resize();
      return '後製與解析度';
    }
    if (this.perfLevel === 2) {
      st.scene.traverse((o) => {
        if (o.userData.grass) o.visible = false;
      });
      LOD.dist = 35;
      return '草叢與近景細節';
    }
    if (this.perfLevel === 3) {
      st.renderer.shadowMap.enabled = false;
      st.sun.castShadow = false;
      st.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        for (const mm of Array.isArray(m) ? m : [m]) mm.needsUpdate = true;
      });
      return '陰影';
    }
    return null;
  }

  /** 渲染用遊戲時間（含插值） */
  rt = 0;

  constructor(
    container: HTMLElement,
    readonly world: World,
    readonly quality: Quality,
  ) {
    this.stage = new Stage(container, quality);
    const sc = world.sc;
    this.stage.setTimeOfDay(sc.time ?? 'day');
    LOD.dist = 60;
    waterTint.value = sc.time === 'night' ? 0.38 : sc.time === 'dusk' ? 0.85 : 1;
    // 火光：最多 4 盞點光源跟著燃燒中的營寨
    for (let k = 0; k < 4; k++) {
      // 永遠開著（只調亮度），避免光源數量變動造成 shader 重編
      const l = new THREE.PointLight('#ff5a12', 0, 110, 1.2);
      this.fireLights.push(l);
      this.stage.scene.add(l);
    }
    const hf = world.hf;
    // 戰場踐踏貼圖
    this.trampleData = new Uint8Array(this.TR * this.TR);
    this.trampleTex = new THREE.DataTexture(this.trampleData, this.TR, this.TR, THREE.RedFormat, THREE.UnsignedByteType);
    this.trampleTex.magFilter = THREE.LinearFilter;
    this.trampleTex.minFilter = THREE.LinearFilter;
    this.trampleTex.needsUpdate = true;
    trample.tex.value = this.trampleTex;
    trample.play.value = hf.play;
    this.stage.scene.add(buildTerrainMesh(hf, sc.map.seed));
    this.stage.scene.add(buildWater(hf, heightTexture(hf), this.sunDir));
    const avoid = world.structs.map((s) => ({ x: s.x, z: s.z, r: s.radius + 6 }));
    for (const ts of sc.teams) if (ts.deploy) avoid.push({ x: ts.deploy.x, z: ts.deploy.z, r: 0 });
    const veg = buildVegetation(
      hf,
      sc.map.seed,
      {
        trees: [treeGeometry('broadleaf', 1), treeGeometry('pine', 2), treeGeometry('broadleaf', 3), treeGeometry('willow', 4)],
        rocks: [rockGeometry(1), rockGeometry(2), rockGeometry(3)],
        grass: [grassTuftGeometry(false), grassTuftGeometry(true)],
      },
      quality,
      avoid,
    );
    this.stage.scene.add(veg.group);
    this.teamColors = world.teams.map((t) => new THREE.Color(t.color));
    this.soldiers = new SoldierRenderer({}, quality === 'low' ? 1200 : 3000);
    this.stage.scene.add(this.soldiers.group);
    this.arrows = new ArrowRenderer(4000);
    this.stage.scene.add(this.arrows.mesh);
    this.banners = new Banners(world);
    this.stage.scene.add(this.banners.group);
    this.overlays = new Overlays(world);
    this.stage.scene.add(this.overlays.group);
    this.stage.scene.add(this.particles.group);
    this.particles.resize(innerHeight);
    addEventListener('resize', this.onResize);
    // 營寨與糧倉
    for (const st of world.structs) {
      const f = FACTIONS[sc.teams[st.team].faction];
      const vis =
        st.kind === 'hq'
          ? buildHQ({ team: f.color, flagText: f.flag, seed: st.id })
          : st.kind === 'camp'
            ? buildCamp({ team: f.color, flagText: f.flag, seed: st.id })
            : st.kind === 'water'
              ? buildWaterSource({ team: f.color, seed: st.id })
              : buildDepot({ team: f.color, flagText: f.flag, main: st.main, seed: st.id });
      vis.group.position.set(st.x, hf.height(st.x, st.z), st.z);
      vis.group.rotation.y = st.gate;
      vis.group.updateMatrixWorld(true);
      vis.setHeight?.((x, z) => hf.height(x, z));
      vis.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.stage.scene.add(vis.group);
      this.structs.push({ st, vis, burntShown: false, lastFrac: 1 });
    }
    // 橋
    for (const b of world.bridges) {
      const g = propGeometry('bridge', { length: b.length });
      const m = new THREE.Mesh(g, propMaterial);
      m.position.set(b.x, 0, b.z);
      m.rotation.y = b.angle - Math.PI / 2;
      m.castShadow = m.receiveShadow = true;
      this.stage.scene.add(m);
    }
    this.wagonGeo = world.teams.map((t) => propGeometry('wagon', { team: t.color }));
    // 場景裝飾：戰船
    const shipMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    for (const d of sc.decor ?? []) {
      if (d.kind !== 'ship') continue;
      const m = new THREE.Mesh(shipGeometry(world.teams[d.team].color, !!d.burnt), shipMat);
      m.position.set(d.x, WATER_LEVEL - 0.6, d.z);
      m.rotation.y = d.angle;
      m.castShadow = m.receiveShadow = true;
      this.stage.scene.add(m);
      this.ships.push({ mesh: m, burning: !!d.burning, ph: d.x * 0.1 });
    }
  }

  private onResize = (): void => this.particles.resize(innerHeight);

  dispose(): void {
    removeEventListener('resize', this.onResize);
    this.stage.dispose();
  }

  /** 在世界座標 (x,z) 踩出一塊泥地 */
  private stomp(x: number, z: number, amount: number, r = 1): void {
    const n = this.TR;
    const play = this.world.hf.play;
    const cx = ((x / play) + 0.5) * n;
    const cz = ((z / play) + 0.5) * n;
    for (let j = Math.floor(cz - r); j <= Math.ceil(cz + r); j++) {
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const d = Math.hypot(i - cx, j - cz) / (r + 0.5);
        if (d > 1) continue;
        const k = j * n + i;
        this.trampleData[k] = Math.min(255, this.trampleData[k] + amount * (1 - d));
      }
    }
  }

  /** 模擬事件：屍體轉進屍體層 */
  consumeEvents(events: GameEvent[]): void {
    const w = this.world;
    const s = w.s;
    for (const ev of events) {
      if (ev.k !== 'corpse') continue;
      const i = ev.i;
      this.stomp(s.x[i], s.z[i], 22, 1.2);
      this.soldiers.addCorpse(w.modelOf(i), s.x[i], w.groundY(s.x[i], s.z[i]), s.z[i], s.yaw[i], ANIM_ORDER[s.anim[i]], s.animStart[i], this.teamColors[s.team[i]], s.tint[i]);
    }
  }

  /** 每幀：alpha＝模擬步之間的插值比例 */
  render(alpha: number, dt: number, paused: boolean): void {
    const w = this.world;
    const s = w.s;
    this.rt = w.t - TICK * (1 - alpha);
    animTime.value = this.rt;
    if (!paused) {
      windTime.value += dt;
      waterTime.value += dt;
      propTime.value += dt;
    }
    const az = THREE.MathUtils.degToRad(LIGHT.sunAzimuth);
    const el = THREE.MathUtils.degToRad(LIGHT.sunElevation);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));

    // 士兵
    const sr = this.soldiers;
    sr.cam.copy(this.stage.camera.position);
    sr.begin();
    for (let i = 0; i < s.count; i++) {
      const st = s.state[i];
      if (st !== SState.Alive && st !== SState.Dying) continue;
      const reg = w.regs[s.reg[i]];
      if (reg.team !== w.player && !w.isVisibleTo(reg, w.player) && st === SState.Alive) continue;
      const x = s.px[i] + (s.x[i] - s.px[i]) * alpha;
      const z = s.pz[i] + (s.z[i] - s.pz[i]) * alpha;
      let dy = s.yaw[i] - s.pyaw[i];
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      const yaw = s.pyaw[i] + dy * alpha;
      sr.push(w.modelOf(i), x, w.groundY(x, z), z, yaw, ANIM_ORDER[s.anim[i]], s.animStart[i], s.animSpeed[i], this.teamColors[s.team[i]], s.tint[i]);
    }
    // 輜重車
    for (const wg of w.wagons) {
      let m = this.wagonMeshes.get(wg.id);
      if (!wg.alive || wg.arrived) {
        if (m) {
          this.stage.scene.remove(m);
          this.wagonMeshes.delete(wg.id);
          if (!wg.alive) this.particles.emit('smoke', wg.x, w.groundY(wg.x, wg.z) + 1, wg.z, 8, 2);
        }
        continue;
      }
      if (!m) {
        m = new THREE.Mesh(this.wagonGeo[wg.team], propMaterial);
        m.castShadow = true;
        this.stage.scene.add(m);
        this.wagonMeshes.set(wg.id, m);
      }
      const x = wg.px + (wg.x - wg.px) * alpha;
      const z = wg.pz + (wg.z - wg.pz) * alpha;
      m.position.set(x, w.groundY(x, z), z);
      m.rotation.y = wg.yaw;
      m.visible = wg.team === w.player || this.nearPlayer(x, z);
      if (m.visible) {
        // 兩匹拖車馬（輜重車沿 +Z 前進，車轅在前方）
        const fx = Math.sin(wg.yaw);
        const fz = Math.cos(wg.yaw);
        for (const side of [-0.55, 0.55]) {
          const hx = x + fx * 3.6 + fz * side;
          const hz = z + fz * 3.6 - fx * side;
          this.soldiers.push('packhorse', hx, w.groundY(hx, hz), hz, wg.yaw, 'walk', wg.id * 0.37 + side, 0.9, this.teamColors[wg.team], 0.5);
        }
      }
    }
    sr.end();
    this.arrows.update(w.proj, this.rt);
    this.banners.update(alpha);
    // 騎兵奔馳揚塵
    if (!paused && this.quality !== 'low') {
      for (const r of w.regs) {
        if (!r.unit.mounted || r.gone || (r.state !== 'moving' && !r.routing) || !r.run) continue;
        if (r.team !== w.player && !w.isVisibleTo(r, w.player)) continue;
        const k = r.members[(Math.random() * r.members.length) | 0];
        if (Math.random() < 0.5 && k !== undefined && Math.hypot(s.vx[k], s.vz[k]) > 4) this.particles.emit('dust', s.x[k], w.groundY(s.x[k], s.z[k]) + 0.3, s.z[k], 1, 1.5, 1.2);
      }
    }

    // 踐踏：交戰中的士兵把草地踩爛（每 0.5 秒）
    this.trampleT += dt;
    if (this.trampleT > 0.5) {
      this.trampleT = 0;
      for (const r of w.regs) {
        if (r.gone || r.engagedWith.size === 0) continue;
        for (let k = 0; k < r.members.length; k += 4) {
          const i = r.members[k];
          this.stomp(s.x[i], s.z[i], 5, 0.8);
        }
      }
      this.trampleTex.needsUpdate = true;
    }
    // 戰船：隨波起伏、燃燒
    const v3 = new THREE.Vector3();
    for (const sh of this.ships) {
      const t = this.rt + sh.ph;
      sh.mesh.position.y = WATER_LEVEL - 0.6 + Math.sin(t * 0.9) * 0.12;
      sh.mesh.rotation.z = Math.sin(t * 0.7) * 0.025;
      if (!sh.burning || paused) continue;
      sh.mesh.updateMatrixWorld();
      for (const a of SHIP_FIRE) {
        if (Math.random() > 0.55) continue;
        v3.copy(a).applyMatrix4(sh.mesh.matrixWorld);
        this.particles.emit('fire', v3.x, v3.y, v3.z, 1, 2.5, 1.3);
        if (Math.random() < 0.3) this.particles.emit('smoke', v3.x, v3.y + 3, v3.z, 1, 3, 1.6);
        if (Math.random() < 0.1) this.particles.emit('ember', v3.x, v3.y + 1, v3.z, 2, 2);
      }
    }
    // 火光
    const burning = this.structs.filter((sv) => sv.st.fire > 0.05).sort((a, b) => b.st.fire - a.st.fire);
    const night = this.world.sc.time === 'night' ? 1.5 : this.world.sc.time === 'dusk' ? 1.2 : 1;
    const burningShips = this.ships.filter((sh) => sh.burning).sort((a, b) => a.mesh.position.distanceToSquared(this.stage.camera.position) - b.mesh.position.distanceToSquared(this.stage.camera.position));
    this.fireLights.forEach((l, k) => {
      const sv = burning[k];
      if (!sv) {
        const sh = burningShips[k - burning.length];
        if (sh) {
          l.position.set(sh.mesh.position.x, 9, sh.mesh.position.z);
          l.intensity = (170 + Math.random() * 60) * night;
        } else l.intensity = 0;
        return;
      }
      const f = sv.st.burnt ? 0.35 : sv.st.fire;
      l.position.set(sv.st.x, this.world.hf.height(sv.st.x, sv.st.z) + 8, sv.st.z);
      l.position.y += 6;
      l.intensity = (170 + Math.random() * 60) * f * night;
    });
    // 營寨
    for (const sv of this.structs) {
      const st = sv.st;
      if (Math.abs(st.frac - sv.lastFrac) > 0.01) {
        sv.vis.setStock(st.frac);
        sv.lastFrac = st.frac;
      }
      if (st.burnt && !sv.burntShown) {
        sv.vis.setBurnt(true);
        sv.burntShown = true;
      }
      if (!paused && (st.fire > 0 || st.burnt)) this.fireFx(sv, dt);
    }
    if (!paused) this.particles.update(dt);
  }

  private nearPlayer(x: number, z: number): boolean {
    for (const r of this.world.regs) if (r.team === this.world.player && !r.gone && Math.hypot(r.mx - x, r.mz - z) < 150) return true;
    return false;
  }

  private fireAcc = 0;
  private fireFx(sv: StructView, dt: number): void {
    const st = sv.st;
    this.fireAcc += dt;
    const anchors = sv.vis.fireAnchors;
    const g = sv.vis.group;
    const v = new THREE.Vector3();
    const intensity = st.burnt ? 0.35 : st.fire;
    for (const a of anchors) {
      if (Math.random() > intensity * 0.9 + 0.1) continue;
      v.copy(a).applyMatrix4(g.matrixWorld);
      if (!st.burnt || Math.random() < 0.3) this.particles.emit('fire', v.x, v.y, v.z, Math.ceil(2 * intensity), 2.5, 0.8 + intensity);
      if (Math.random() < 0.35) this.particles.emit('smoke', v.x, v.y + 3, v.z, 1, 3, 1 + intensity);
      if (Math.random() < 0.15) this.particles.emit('ember', v.x, v.y + 1, v.z, 2, 2);
    }
    // 焚毀後的大煙柱（全地圖可見）
    if (st.burnt && Math.random() < 0.5) this.particles.emit('smoke', st.x, this.world.hf.height(st.x, st.z) + 4, st.z, 1, 6, 2.2);
  }
}
