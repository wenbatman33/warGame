// 一場戰役的總管：模擬步進、渲染、操作、HUD、AI、時間控制（暫停／變速）
import * as THREE from 'three';
import { audio } from '../audio/audio';
import { AiCommander } from '../ai/commander';
import type { Scenario } from '../data/scenario';
import { RtsCamera } from '../input/camera';
import { Controls } from '../input/controls';
import { generateHeightfield } from '../map/mapgen';
import { BattleView } from '../render/battleView';
import { soldierLook } from '../render/soldiers';
import type { Quality } from '../render/stage';
import { TICK, World, type GameEvent } from '../sim/world';
import { Hud } from '../ui/hud';

export interface BattleOptions {
  quality: Quality;
  difficulty: 'easy' | 'normal' | 'hard';
  onExit: (result: BattleResult | null) => void;
  /** 跳過部署（測試用） */
  skipDeploy?: boolean;
  onHelp?: () => void;
  onSettings?: () => void;
}

export interface BattleResult {
  scenario: string;
  win: boolean;
  stars: boolean[];
  time: number;
}

export class Battle {
  readonly world: World;
  readonly view: BattleView;
  readonly cam: RtsCamera;
  readonly controls: Controls;
  readonly hud: Hud;
  readonly ai: AiCommander[] = [];
  paused = false;
  speed = 1;
  phase: 'deploy' | 'battle' | 'end' = 'deploy';
  private acc = 0;
  private clock = new THREE.Clock();
  private running = true;
  /** 慢動作（事件鏡頭） */
  slowmo = 0;
  /** 開場鏡頭倒數 */
  private introT = 0;

  readonly sc: Scenario;

  constructor(
    readonly container: HTMLElement,
    scenario: Scenario,
    readonly opts: BattleOptions,
  ) {
    // 每場複製一份劇本（觸發器會改 AI 計畫等，不能汙染原始資料）
    const sc = (this.sc = {
      ...scenario,
      teams: scenario.teams.map((t) => ({ ...t, ai: t.ai ? { ...t.ai } : undefined, regiments: t.regiments.map((r) => ({ ...r })), depots: t.depots.map((d) => ({ ...d })) })) as Scenario['teams'],
    });
    const hf = generateHeightfield(sc.map);
    this.world = new World(sc, hf);
    this.world.setDifficulty(opts.difficulty);
    this.view = new BattleView(container, this.world, opts.quality);
    this.cam = new RtsCamera(this.view.stage.camera, hf);
    const c = sc.camera ?? { x: 0, z: 150 };
    this.cam.set(c.x, c.z, c.dist ?? 230, c.yaw ?? 0);
    if (!opts.skipDeploy) {
      // 開場鏡頭：先看敵軍陣地，再拉回我軍
      const en = this.world.regs.filter((r) => r.team !== this.world.player && !r.hidden);
      if (en.length) {
        const ex = en.reduce((a, r) => a + r.cx, 0) / en.length;
        const ez = en.reduce((a, r) => a + r.cz, 0) / en.length;
        this.cam.set(ex, ez, 300, c.yaw ?? 0);
        this.introT = 2.6;
      }
    }
    this.controls = new Controls(this.world, this.cam, this.view.stage.camera, this.view.stage.renderer.domElement, {
      onPause: () => this.togglePause(),
      onSpeed: (s) => this.setSpeed(s),
      onOrder: (kind) => {
        audio.play('ui_order');
        audio.voice(kind === 'attack' || kind === 'struct' ? 'ack_attack' : 'ack_move');
      },
      onSelect: (ids) => {
        if (ids.length) audio.play('ui_select');
        this.hud.refreshSelection();
      },
      onTargetPick: (x, z) => this.hud.pickTarget(x, z),
      deployMode: () => this.phase === 'deploy',
      onDeployMove: (id, x, z) => this.deployMove(id, x, z),
      onDeployPlace: (id, x, z, f, wd) => this.deployPlace(id, x, z, f, wd),
      onKey: (k) => this.hud.onKey(k),
    });
    this.hud = new Hud(container, this);
    for (let t = 0; t < sc.teams.length; t++) {
      if (t !== this.world.player && sc.teams[t].ai) this.ai.push(new AiCommander(this.world, t, sc.teams[t].ai!, opts.difficulty));
    }
    if (opts.skipDeploy) this.startBattle();
    else audio.music('deploy');
    this.view.stage.renderer.setAnimationLoop(() => this.frame());
  }

  /** 部署：拖曳軍團（限制在部署區） */
  deployMove(id: number, x: number, z: number): void {
    const w = this.world;
    const r = w.regs[id];
    const dz = this.sc.teams[w.player].deploy;
    if (!r || r.team !== w.player) return;
    if (dz) {
      x = Math.max(dz.x - dz.w / 2, Math.min(dz.x + dz.w / 2, x));
      z = Math.max(dz.z - dz.d / 2, Math.min(dz.z + dz.d / 2, z));
    }
    if (!w.nav.passable(x, z)) return;
    const dx = x - r.cx;
    const dz2 = z - r.cz;
    r.cx = x;
    r.cz = z;
    r.order.x = x;
    r.order.z = z;
    for (const i of r.members) {
      w.s.x[i] += dx;
      w.s.z[i] += dz2;
      w.s.px[i] = w.s.x[i];
      w.s.pz[i] = w.s.z[i];
    }
  }

  /** 部署：軍團直接就位（含朝向與陣寬），士兵瞬移到陣位 */
  deployPlace(id: number, x: number, z: number, facing: number, width?: number): void {
    const w = this.world;
    const r = w.regs[id];
    if (!r || r.team !== w.player) return;
    const dz = this.sc.teams[w.player].deploy;
    if (dz) {
      x = Math.max(dz.x - dz.w / 2, Math.min(dz.x + dz.w / 2, x));
      z = Math.max(dz.z - dz.d / 2, Math.min(dz.z + dz.d / 2, z));
    }
    [x, z] = w.nav.nearestPassable(x, z);
    r.cx = x;
    r.cz = z;
    r.facing = facing;
    if (width) r.width = Math.max(2, Math.round(width));
    r.order = { type: 'idle', x, z, facing, target: -1, struct: -1 };
    const n = r.members.length - (r.general?.alive ? 1 : 0);
    const slot: [number, number] = [0, 0];
    for (const i of r.members) {
      if (w.s.general[i]) {
        w.s.x[i] = x + Math.sin(facing) * (r.depth(n) / 2 + 1.5);
        w.s.z[i] = z + Math.cos(facing) * (r.depth(n) / 2 + 1.5);
      } else {
        r.slotWorld(w.s.slot[i], n, slot);
        [w.s.x[i], w.s.z[i]] = w.nav.passable(slot[0], slot[1]) ? slot : [x, z];
      }
      w.s.px[i] = w.s.x[i];
      w.s.pz[i] = w.s.z[i];
      w.s.yaw[i] = w.s.pyaw[i] = facing;
    }
    r.mx = x;
    r.mz = z;
  }

  startBattle(): void {
    if (this.phase !== 'deploy') return;
    this.phase = 'battle';
    this.world.started = true;
    this.world.flags.startT = this.world.t;
    this.sc.onStart?.(this.world);
    // 部署時拉的戰線：已經在位置上，直接當作待命
    audio.play('drum_start');
    audio.voice('battle_start');
    audio.music('battle');
    this.hud.toast('全軍出擊！', 'gold');
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.hud.refreshTime();
  }

  setSpeed(s: number): void {
    this.speed = s;
    this.paused = false;
    this.hud.refreshTime();
  }

  /** 遠景：士兵放大、隊伍色更亮（大軍像一塊塊色塊，參考 Frost & Flame） */
  private updateLook(): void {
    const f = Math.min(1, Math.max(0, (this.cam.dist - 80) / 300));
    soldierLook.scale.value = 1 + f * 0.75;
    soldierLook.glow.value = 0.07 + f * 0.2;
  }

  /** 測試用：不推進模擬，畫一幀（含 HUD） */
  debugFrame(): void {
    this.cam.update(0.5);
    this.updateLook();
    this.view.stage.updateShadow(this.cam.target, this.cam.viewRadius);
    this.view.overlays.update(this.controls.selected, this.controls.hover, this.controls.preview, this.phase === 'deploy' ? this.sc.teams[this.world.player].deploy : null);
    this.view.render(1, 0.016, false);
    this.view.stage.render();
    this.hud.update(0.25);
  }

  /** 測試用：同步快轉模擬 n 秒（分頁在背景時 rAF 不跑） */
  simulate(seconds: number): void {
    const w = this.world;
    const n = Math.round(seconds / TICK);
    for (let k = 0; k < n; k++) {
      w.step();
      if (this.phase === 'battle') for (const ai of this.ai) ai.update();
      this.handleEvents(w.events);
      this.view.consumeEvents(w.events);
      w.events = [];
    }
  }

  private frame(): void {
    if (!this.running) return;
    const raw = Math.min(0.1, this.clock.getDelta());
    const w = this.world;
    let simDt = this.paused ? 0 : raw * this.speed;
    if (this.slowmo > 0) {
      this.slowmo -= raw;
      simDt *= 0.3;
    }
    // 部署階段：模擬只跑視覺（動作），不推進戰鬥
    this.acc += simDt;
    let steps = 0;
    while (this.acc >= TICK && steps < 8) {
      w.step();
      if (this.phase === 'battle') for (const ai of this.ai) ai.update();
      this.acc -= TICK;
      steps++;
      this.handleEvents(w.events);
      this.view.consumeEvents(w.events);
      w.events = [];
    }
    if (steps >= 8) this.acc = 0;
    if (this.introT > 0) {
      this.introT -= raw;
      if (this.introT <= 0) {
        const c = this.sc.camera ?? { x: 0, z: 150 };
        this.cam.set(c.x, c.z, c.dist ?? 230, c.yaw ?? 0, false);
        this.cam.smoothMul = 0.18;
        setTimeout(() => (this.cam.smoothMul = 1), 3500);
      }
    }
    this.controls.update(raw);
    this.cam.update(raw);
    this.updateLook();
    this.view.stage.updateShadow(this.cam.target, this.cam.viewRadius);
    const alpha = this.acc / TICK;
    this.view.overlays.update(this.controls.selected, this.controls.hover, this.controls.preview, this.phase === 'deploy' ? this.sc.teams[w.player].deploy : null);
    this.view.render(alpha, this.paused ? 0 : raw * this.speed, this.paused);
    this.view.stage.render();
    this.hud.update(raw);
    audio.setListener(this.cam.target.x, this.cam.target.z, this.cam.dist);
    this.ambience();
  }

  private ambT = 0;
  private ambience(): void {
    if (++this.ambT % 10) return;
    const w = this.world;
    let melee = 0;
    let cav = 0;
    let march = 0;
    const tx = this.cam.target.x;
    const tz = this.cam.target.z;
    const R = Math.max(120, this.cam.dist * 1.2);
    for (const r of w.regs) {
      if (r.gone) continue;
      const d = Math.hypot(r.mx - tx, r.mz - tz);
      if (d > R) continue;
      const k = 1 - d / R;
      if (r.engagedWith.size > 0) melee += r.alive * k;
      else if (r.state === 'moving' || r.routing) {
        if (r.unit.mounted) cav += r.alive * k * (r.run ? 2 : 1);
        else march += r.alive * k;
      }
    }
    let fire = 0;
    for (const st of w.structs) if (st.fire > 0 && !st.burnt) fire = Math.max(fire, st.fire * (1 - Math.min(1, Math.hypot(st.x - tx, st.z - tz) / (R * 1.5))));
    audio.setAmbience({ melee: Math.min(1, melee / 400), cavalry: Math.min(1, cav / 120), marching: Math.min(1, march / 500), fire });
  }

  private handleEvents(evs: GameEvent[]): void {
    const w = this.world;
    for (const ev of evs) {
      switch (ev.k) {
        case 'arrow': {
          const p = w.proj;
          if (w.tick % 3 === 0) audio.play('arrow_volley', { ...this.sndPos(p.sx[ev.p], p.sz[ev.p]), volume: 0.5 });
          break;
        }
        case 'impact':
          if (ev.hit && Math.random() < 0.3) audio.play(ev.hit === 2 ? 'shield_hit' : 'arrow_hit', { ...this.sndPos(ev.x, ev.z), volume: 0.4 });
          if (ev.fire) this.view.particles.emit('fire', ev.x, w.groundY(ev.x, ev.z) + 0.3, ev.z, 1, 0.5, 0.5);
          break;
        case 'clash':
          audio.play('clash', { ...this.sndPos(ev.x, ev.z), volume: 0.5, rate: 0.85 + Math.random() * 0.3 });
          if (Math.random() < 0.3) this.view.particles.emit('spark', ev.x, w.groundY(ev.x, ev.z) + 1.2, ev.z, 3, 0.4);
          break;
        case 'charge':
          audio.play('charge_impact', this.sndPos(ev.x, ev.z));
          this.view.particles.emit('dust', ev.x, w.groundY(ev.x, ev.z) + 0.5, ev.z, 10, 4);
          if (Math.hypot(ev.x - this.cam.target.x, ev.z - this.cam.target.z) < this.cam.dist) this.cam.shake = Math.max(this.cam.shake, 0.5);
          break;
        default:
          this.hud.onEvent(ev);
      }
    }
  }

  /** 音效位置：轉到鏡頭空間，讓左右聲像跟著鏡頭旋轉 */
  sndPos(x: number, z: number): { x: number; z: number } {
    const tx = this.cam.target.x;
    const tz = this.cam.target.z;
    const dx = x - tx;
    const dz = z - tz;
    const c = Math.cos(-this.cam.yaw);
    const s = Math.sin(-this.cam.yaw);
    return { x: tx + dx * c - dz * s, z: tz + dx * s + dz * c };
  }

  exit(result: BattleResult | null): void {
    this.running = false;
    this.view.stage.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.hud.dispose();
    this.view.stage.renderer.domElement.remove();
    this.view.stage.renderer.dispose();
    audio.setAmbience({ melee: 0, cavalry: 0, marching: 0, fire: 0 });
    this.opts.onExit(result);
  }
}
