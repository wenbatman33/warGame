// 持續環境層：melee（兵刃轟鳴＋人聲）、cavalry（馬蹄雷鳴）、marching（行軍腳步與甲片）、fire（大火）
// 每層 = 一張「聲床」（循環噪聲＋濾波，強度連續）＋「細節事件流」（預渲染的兵刃／喊聲／馬蹄…依 Poisson 過程隨機觸發、隨機聲像）
// 鏡頭拉遠時：聲床低通變暗、細節變少、殘響變多，並浮出一層低沉的遠方轟鳴

import type { AmbienceLevels } from './types';
import type { SoundBank } from './bank';
import { type Kit, biquad, clamp, gainNode, panner, rand } from './synth';

type Layer = keyof AmbienceLevels;
type BedKey = Layer | 'distant';
const LAYERS: Layer[] = ['melee', 'cavalry', 'marching', 'fire'];

/** 鏡頭高度（m）：低於 NEAR 為近景（細節完整），高於 FAR 為遠景（只剩轟鳴） */
export const AMB_NEAR_H = 30;
export const AMB_FAR_H = 260;

const BED_GAIN: Record<BedKey, number> = { melee: 0.55, cavalry: 0.75, marching: 0.75, fire: 0.6, distant: 0.45 };
const MAX_EVENTS = 48; // 同時存在的細節事件上限
// 細節事件共用的輸出匯流：7 個聲像 × 4 個音量階，事件本身只需 1 個 BufferSource 節點
const BUS_PANS = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];
const BUS_LEVELS = [0.1, 0.2, 0.38, 0.7];
const PER_TICK = 8; // 每條事件流每次排程上限
const LOOKAHEAD = 0.18;

interface Bed {
  gain: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  mod?: GainNode; // 起伏調變（melee 人聲轟鳴用）
  idle: number;
  applied: number;
}

export class Ambience {
  private target: AmbienceLevels = { melee: 0, cavalry: 0, marching: 0, fire: 0 };
  private cur: AmbienceLevels = { melee: 0, cavalry: 0, marching: 0, fire: 0 };
  private near = 1;
  private nearTarget = 1;
  private horizon = 0;
  private lastNow = 0;
  private next: Record<string, number> = {};
  private marchBeat = 0;
  private nextRoar = 0;
  private ends: number[] = []; // 進行中事件的結束時間
  private buses: AudioNode[][] | null = null;
  private beds: Partial<Record<BedKey, Bed>> = {};
  private bedSum: GainNode;
  private bedFilter: BiquadFilterNode;
  private detail: GainNode;
  private wet: GainNode;
  private appliedCut = 0;
  private appliedNear = -1;

  constructor(
    private kit: Kit,
    private bank: SoundBank,
    private out: AudioNode,
    wetOut: AudioNode,
  ) {
    const c = kit.ctx;
    this.bedSum = gainNode(c, 1);
    this.bedFilter = biquad(c, 'lowpass', 14000, 0.5);
    this.detail = gainNode(c, 1);
    this.wet = gainNode(c, 0.15);
    this.bedSum.connect(this.bedFilter);
    this.bedFilter.connect(out);
    this.bedFilter.connect(this.wet);
    this.detail.connect(out);
    this.detail.connect(this.wet);
    this.wet.connect(wetOut);
  }

  setLevels(l: AmbienceLevels): void {
    for (const k of LAYERS) {
      const v = Number(l[k]);
      this.target[k] = Number.isFinite(v) ? clamp(v, 0, 1) : 0;
    }
  }

  /** 依鏡頭高度設定遠近 */
  setHeight(h: number): void {
    if (!Number.isFinite(h)) return;
    this.nearTarget = clamp(1 - (h - AMB_NEAR_H) / (AMB_FAR_H - AMB_NEAR_H), 0, 1);
  }

  levels(): AmbienceLevels {
    return { ...this.cur };
  }

  activeEvents(): number {
    return this.ends.length;
  }

  /** 由引擎排程器約每 50ms 呼叫 */
  tick(now: number): void {
    const dt = this.lastNow ? clamp(now - this.lastNow, 0, 0.5) : 0.05;
    this.lastNow = now;
    const a = 1 - Math.exp(-dt / 0.6);
    for (const k of LAYERS) {
      this.cur[k] += (this.target[k] - this.cur[k]) * a;
      if (this.target[k] === 0 && this.cur[k] < 0.002) this.cur[k] = 0;
    }
    this.near += (this.nearTarget - this.near) * (1 - Math.exp(-dt / 0.4));
    this.updateBeds(now, dt);
    this.schedule(now);
  }

  // ─────────────────────────────────────── 聲床

  private updateBeds(now: number, dt: number): void {
    const far = 1 - this.near;
    const bedScale = 1 - 0.5 * far;
    for (const k of LAYERS) this.updateBed(k, Math.pow(this.cur[k], 1.2) * BED_GAIN[k] * bedScale, this.target[k] > 0, now, dt);
    const cu = this.cur;
    const total = Math.min(1.2, cu.melee * 0.8 + cu.cavalry * 0.9 + cu.fire * 0.4 + cu.marching * 0.3);
    this.updateBed('distant', total * (0.12 + 0.75 * far) * BED_GAIN.distant, total > 0, now, dt);

    // 遠近：低通、細節量、殘響
    const cut = 500 + 13500 * Math.pow(this.near, 1.5);
    if (Math.abs(cut - this.appliedCut) / Math.max(1, this.appliedCut) > 0.02) {
      this.bedFilter.frequency.setTargetAtTime(cut, now, 0.1);
      this.appliedCut = cut;
    }
    if (Math.abs(this.near - this.appliedNear) > 0.01) {
      this.detail.gain.setTargetAtTime(0.2 + 0.8 * this.near, now, 0.1);
      this.wet.gain.setTargetAtTime(0.12 + 0.4 * far, now, 0.1);
      this.appliedNear = this.near;
    }
    // 人聲轟鳴的隨機起伏
    const mb = this.beds.melee;
    if (mb?.mod && now >= this.nextRoar) {
      mb.mod.gain.setTargetAtTime(rand(this.kit.rnd, 0.55, 1.25), now, 0.2);
      this.nextRoar = now + rand(this.kit.rnd, 0.25, 0.6);
    }
  }

  private updateBed(key: BedKey, v: number, wanted: boolean, now: number, dt: number): void {
    let bed = this.beds[key];
    if (!bed) {
      if (v < 0.002 && !wanted) return;
      bed = this.makeBed(key);
      this.beds[key] = bed;
    }
    if (v < 0.002 && !wanted) {
      bed.idle += dt;
      if (bed.idle > 2.5) {
        this.disposeBed(bed);
        delete this.beds[key];
        return;
      }
    } else bed.idle = 0;
    if (Math.abs(v - bed.applied) > 0.002) {
      bed.gain.gain.setTargetAtTime(v, now, 0.08);
      bed.applied = v;
    }
  }

  private makeBed(key: BedKey): Bed {
    const k = this.kit;
    const c = k.ctx;
    const g = gainNode(c, 0);
    const bed: Bed = { gain: g, srcs: [], nodes: [g], idle: 0, applied: 0 };
    g.connect(key === 'distant' ? this.out : this.bedSum);
    const loop = (buf: AudioBuffer, rate = 1): AudioBufferSourceNode => {
      const s = c.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(c.currentTime, k.rnd() * buf.duration);
      bed.srcs.push(s);
      return s;
    };
    const lfo = (f: number, depth: number, param: AudioParam): void => {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.start();
      const d = gainNode(c, depth);
      o.connect(d).connect(param);
      bed.srcs.push(o);
      bed.nodes.push(d);
    };
    const via = (src: AudioNode, ...chain: AudioNode[]): void => {
      let n = src;
      for (const x of chain) {
        n.connect(x);
        bed.nodes.push(x);
        n = x;
      }
      n.connect(g);
    };
    switch (key) {
      case 'melee': {
        // 千人吶喊轟鳴：粉紅噪聲經母音共振峰，音量隨機起伏
        const mod = gainNode(c, 1);
        bed.mod = mod;
        bed.nodes.push(mod);
        mod.connect(g);
        const pk = loop(k.pink);
        for (const [f, q, lv] of [[650, 2.5, 1.7], [1150, 3, 1.1], [2500, 4, 0.45]] as const) {
          const bp = biquad(c, 'bandpass', f, q);
          const gg = gainNode(c, lv);
          pk.connect(bp).connect(gg).connect(mod);
          bed.nodes.push(bp, gg);
        }
        // 地面低頻悶響
        via(loop(k.brown), biquad(c, 'lowpass', 160, 0.7), gainNode(c, 0.8));
        // 遠處兵刃的金屬嘶聲
        via(loop(k.white, 0.9), biquad(c, 'bandpass', 3600, 1.5), gainNode(c, 0.07));
        break;
      }
      case 'cavalry': {
        // 馬蹄雷鳴：棕噪低頻，被兩個不同速度的 LFO 調幅出「隆隆」節奏
        const am = gainNode(c, 0.6);
        bed.nodes.push(am);
        lfo(8.7, 0.3, am.gain);
        lfo(5.3, 0.18, am.gain);
        via(loop(k.brown), biquad(c, 'lowpass', 115, 0.8), am, gainNode(c, 1.3));
        via(loop(k.pink), biquad(c, 'bandpass', 320, 0.7), gainNode(c, 0.3));
        break;
      }
      case 'marching': {
        via(loop(k.pink), biquad(c, 'lowpass', 420, 0.7), gainNode(c, 0.5));
        via(loop(k.white, 1.1), biquad(c, 'bandpass', 5200, 0.8), gainNode(c, 0.04));
        break;
      }
      case 'fire': {
        // 大火：低沉怒吼（不規則起伏）＋高頻嘶聲＋低音火團
        const fl = gainNode(c, 0.7);
        bed.nodes.push(fl);
        lfo(6.1, 0.22, fl.gain);
        lfo(2.3, 0.18, fl.gain);
        via(loop(k.brown), biquad(c, 'lowpass', 650, 0.5), fl, gainNode(c, 1.1));
        via(loop(k.white), biquad(c, 'highpass', 2500, 0.7), gainNode(c, 0.06));
        via(loop(k.pink, 0.8), biquad(c, 'bandpass', 220, 0.6), gainNode(c, 0.35));
        break;
      }
      case 'distant': {
        // 遠方轟鳴：極低頻棕噪
        via(loop(k.brown, 0.8), biquad(c, 'lowpass', 85, 0.8), gainNode(c, 1.4));
        const am = gainNode(c, 0.8);
        bed.nodes.push(am);
        lfo(0.31, 0.2, am.gain);
        via(loop(k.pink, 0.7), biquad(c, 'bandpass', 180, 0.8), am, gainNode(c, 0.35));
        break;
      }
    }
    return bed;
  }

  private disposeBed(bed: Bed): void {
    for (const s of bed.srcs) {
      try {
        s.stop();
      } catch {
        /* 已停止 */
      }
      s.disconnect();
    }
    for (const n of bed.nodes) n.disconnect();
  }

  // ─────────────────────────────────────── 細節事件

  private schedule(now: number): void {
    const from = Math.max(this.horizon, now + 0.03);
    const to = now + LOOKAHEAD;
    if (to <= from) return;
    this.horizon = to;
    if (this.ends.length) this.ends = this.ends.filter((e) => e > now);
    const r = this.kit.rnd;
    const { melee, cavalry, marching, fire } = this.cur;
    const q = (): number => 0.12 + 0.88 * r() * r(); // 多數事件較小聲（遠），少數很近
    const dens = 0.3 + 0.7 * this.near; // 鏡頭拉遠時細節本來就聽不清，減少事件省 CPU

    // 混戰：兵刃交擊、喊殺、倒地
    this.stream('clash', 22 * melee * dens, from, to, (t) => this.emit('clash', t, 0.6 * q(), rand(r, 0.8, 1.2)));
    this.stream('shout', 4 * melee * dens, from, to, (t) => this.emit('shout', t, 0.5 * q(), rand(r, 0.85, 1.15)));
    this.stream('death', 2.5 * melee * dens, from, to, (t) => this.emit('death', t, 0.6 * q(), rand(r, 0.9, 1.1)));

    // 騎兵：每匹馬一組三連蹄（跑步步態，已預渲染成一個緩衝）
    this.stream('gallop', 16 * cavalry * dens, from, to, (t) => this.emit('gallop', t, 0.6 * q(), rand(r, 0.85, 1.2)));

    // 行軍：約 1.85 步／秒的大致齊步，每拍數人錯落
    if (marching > 0.02) {
      if (this.marchBeat < from) this.marchBeat = from;
      while (this.marchBeat < to) {
        const n = 2 + Math.floor(marching * 5 * dens);
        for (let i = 0; i < n; i++) this.emit('step', this.marchBeat + rand(r, -0.045, 0.045), 0.8 * q(), rand(r, 0.85, 1.15));
        this.marchBeat += 1 / 1.85;
      }
    } else this.marchBeat = 0;
    this.stream('rattle', 7 * marching * dens, from, to, (t) => this.emit('rattle', t, 0.6 * q(), rand(r, 0.85, 1.2)));

    // 大火：劈啪火星＋偶爾較大的爆裂
    this.stream('crackle', 24 * fire * dens, from, to, (t) => this.emit('crackle', t, 0.5 * q(), rand(r, 0.7, 1.4)));
    this.stream('pop', 3 * fire, from, to, (t) => this.emit('crackle', t, 0.7, rand(r, 0.4, 0.6)));
  }

  /** Poisson 事件流：在 [from, to) 間依速率 rate（次/秒）產生事件 */
  private stream(name: string, rate: number, from: number, to: number, fire: (t: number) => void): void {
    if (rate < 0.05) {
      this.next[name] = 0;
      return;
    }
    let t = this.next[name] ?? 0;
    if (t < from) t = from + (-Math.log(1 - Math.random()) / rate) * 0.5;
    let n = 0;
    while (t < to && n < PER_TICK) {
      fire(t);
      t += -Math.log(1 - Math.random()) / rate;
      n++;
    }
    this.next[name] = Math.max(t, n >= PER_TICK ? to : t);
  }

  /** 共用匯流（第一次用到才建立） */
  private bus(pan: number, gain: number): AudioNode {
    if (!this.buses) {
      const c = this.kit.ctx;
      this.buses = BUS_PANS.map((p) => {
        const pn = panner(c, p);
        pn.connect(this.detail);
        return BUS_LEVELS.map((lv) => {
          const g = gainNode(c, lv);
          g.connect(pn);
          return g;
        });
      });
    }
    let pi = 0;
    for (let i = 1; i < BUS_PANS.length; i++) if (Math.abs(BUS_PANS[i] - pan) < Math.abs(BUS_PANS[pi] - pan)) pi = i;
    let li = 0;
    for (let i = 1; i < BUS_LEVELS.length; i++) if (Math.abs(Math.log(BUS_LEVELS[i] / gain)) < Math.abs(Math.log(BUS_LEVELS[li] / gain))) li = i;
    return this.buses[pi][li];
  }

  private emit(name: string, t: number, gain: number, rate: number): void {
    if (this.ends.length >= MAX_EVENTS || gain <= 0) return;
    const buf = this.bank.get(name);
    if (!buf) return;
    const c = this.kit.ctx;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.connect(this.bus(rand(this.kit.rnd, -1, 1), gain));
    const st = Math.max(t, c.currentTime);
    s.start(st);
    this.ends.push(st + buf.duration / rate);
  }

  dispose(): void {
    for (const k of Object.keys(this.beds) as BedKey[]) {
      const b = this.beds[k];
      if (b) this.disposeBed(b);
    }
    this.beds = {};
    if (this.buses) for (const row of this.buses) for (const g of row) g.disconnect();
    this.buses = null;
  }
}

