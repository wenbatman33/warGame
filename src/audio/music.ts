// 程式合成古風配樂
// 五聲音階（宮商角徵羽）調式；古箏／琵琶（Karplus-Strong 撥弦）、笛子、二胡、笙、大鼓、梆子、鈸、鑼、牛角號
// 以小節為單位排程（lookahead），旋律用「動機 → 應答」的 4 小節樂句生成，聽起來有重複與回應而不是亂彈
// 模式切換：舊樂手淡出、新樂手淡入（交叉淡化）

import type { MusicMode } from './types';
import type { SoundBank } from './bank';
import type { Recipe } from './sfx';
import { bowed, cymbal, drumHit, flute, gongHit, hornNote, pluck, sheng, woodblock } from './instruments';
import { type Kit, type Rng, biquad, clamp, gainNode, mtof, pick, shaper } from './synth';

type PlayMode = Exclude<MusicMode, 'none'>;

// 調式：相對主音的半音
const GONG = [0, 2, 4, 7, 9]; // 宮調（明亮莊嚴）
const YU = [0, 3, 5, 7, 10]; // 羽調（悲壯）

/** 五聲音階級數 → 半音（可為負，跨八度） */
function semi(scale: number[], deg: number): number {
  const o = Math.floor(deg / 5);
  return scale[deg - o * 5] + 12 * o;
}

interface MelodySpec {
  inst: 'dizi' | 'erhu';
  rhythm: number[]; // 可用的音長（16 分音符數）
  rest: number; // 休止機率
  lo: number; // 音域（級數）
  hi: number;
  oct: number; // 八度位移
  gain: number;
  skipFirst?: boolean; // 第一句不吹（前奏）
  down?: number; // 下行傾向 0..1
  silent?: number; // 整句休息機率
}

interface Style {
  bpm: number;
  root: number; // 主音 MIDI
  scale: number[];
  prog: number[]; // 每小節低音級數（循環）
  wet: number;
  gain: number;
  fadeIn: number;
  melody: MelodySpec | null;
  bar: (b: Bar) => void;
}

interface Note {
  s: number; // 起始（16 分音符，0..31）
  len: number;
  deg: number;
}

// 琵琶頑固音型（相對低音的級數）
const RIFFS: number[][] = [
  [0, 0, 2, 0, 3, 2, 1, 0],
  [0, 2, 3, 2, 0, 2, -1, 0],
  [0, 0, 3, 3, 2, 2, 1, 1],
  [0, 3, 2, 0, 5, 3, 2, 1],
];

/** 一小節的排程工具 */
class Bar {
  readonly k: Kit;
  readonly r: Rng;
  readonly bass: number;
  constructor(
    private p: Player,
    readonly t0: number,
    readonly step: number,
    readonly i: number,
  ) {
    this.k = p.kit;
    this.r = p.kit.rnd;
    const pr = p.style.prog;
    this.bass = pr[i % pr.length];
  }
  at(s: number): number {
    return this.t0 + s * this.step;
  }
  /** 級數 → 頻率（oct＝相對主音的八度） */
  f(deg: number, oct = 0): number {
    const st = this.p.style;
    return mtof(st.root + 12 * oct + semi(st.scale, deg));
  }
  bassSemi(): number {
    return semi(this.p.style.scale, this.bass);
  }
  get riff8(): number[] {
    return this.p.riff.slice(0, 8);
  }
  get riff16(): number[] {
    return this.p.riff;
  }
  zheng(s: number, deg: number, oct: number, gain: number, vib = 0): void {
    pluck(this.k, this.p.pluckBus, this.at(s), this.f(deg, oct), gain, 'zheng', vib);
  }
  /** 琵琶單音；lenSteps 給定時在該長度後止音（快速頑固音型） */
  pipa(s: number, deg: number, oct: number, gain: number, lenSteps = 0): void {
    pluck(this.k, this.p.pluckBus, this.at(s), this.f(deg, oct), gain, 'pipa', 0, lenSteps > 0 ? Math.max(0.12, lenSteps * this.step * 1.6) : 0);
  }
  /** 輪指：快速重複並漸強 */
  tremolo(s: number, len: number, deg: number, oct: number, gain: number): void {
    const n = Math.max(2, Math.floor((len * this.step) / 0.06));
    const f = this.f(deg, oct);
    for (let j = 0; j < n; j++) pluck(this.k, this.p.pluckBus, this.at(s) + j * 0.06, f, gain * (0.5 + (0.5 * j) / n), 'pipa', 0, j < n - 1 ? 0.1 : 0);
  }
  /** 掃弦 */
  strum(s: number, degs: number[], oct: number, gain: number): void {
    degs.forEach((d, j) => pluck(this.k, this.p.pluckBus, this.at(s) + j * 0.018, this.f(d, oct), gain, 'pipa'));
  }
  /** 古箏刮奏（花指） */
  gliss(s: number, from: number, to: number, oct: number, gain: number, dt: number): void {
    const dir = to > from ? 1 : -1;
    const n = Math.abs(to - from) + 1;
    for (let j = 0; j < n; j++) {
      pluck(this.k, this.p.pluckBus, this.at(s) + j * dt, this.f(from + j * dir, oct), gain * (0.6 + (0.4 * j) / n), 'zheng');
    }
  }
  /** 鼓（優先用預渲染緩衝，2 個節點；尚未渲染時即時合成） */
  drum(s: number, size: 'big' | 'mid' | 'tom', gain: number): void {
    const name = size === 'big' ? 'm_big' : size === 'mid' ? 'm_mid' : 'm_tom';
    this.p.hit(name, this.at(s), gain, this.p.drumBus);
  }
  clap(s: number, gain: number): void {
    this.p.hit('m_clap', this.at(s), gain, this.p.inst);
  }
  crash(s: number, gain: number): void {
    this.p.hit('m_crash', this.at(s), gain, this.p.inst);
  }
  tam(s: number, gain: number): void {
    gongHit(this.k, this.p.inst, this.at(s), 150, gain, 4);
  }
  horn(s: number, deg: number, oct: number, lenSteps: number, gain: number): void {
    hornNote(this.k, this.p.inst, this.at(s), this.f(deg, oct), lenSteps * this.step, gain, { attack: 0.35, glide: 0.93, release: 0.5 });
  }
  /** 笙長音（semis 相對主音的半音） */
  pad(s: number, semis: number[], lenSteps: number, gain: number): void {
    const root = this.p.style.root;
    sheng(this.k, this.p.inst, this.at(s), semis.map((x) => mtof(root + x)), lenSteps * this.step, gain);
  }
}

// ─────────────────────────────────────────── 配樂打擊樂（預渲染）

export type MusicHitId = 'm_big' | 'm_mid' | 'm_tom' | 'm_clap' | 'm_crash';
type HitLive = (k: Kit, out: AudioNode, t: number, gain: number) => number;

/** 配樂打擊樂：live 為即時合成版本（gain 可變）；預渲染時以 gain=1 跑同一份 */
export const MUSIC_HITS: Record<MusicHitId, { live: HitLive; count: number; len: number }> = {
  m_big: { count: 4, len: 1.2, live: (k, out, t, gain) => drumHit(k, out, t, { f: 52, gain, decay: 0.9 }) },
  m_mid: { count: 3, len: 0.7, live: (k, out, t, gain) => drumHit(k, out, t, { f: 78, gain, decay: 0.5, lite: true }) },
  m_tom: { count: 4, len: 0.4, live: (k, out, t, gain) => drumHit(k, out, t, { f: 125, gain, decay: 0.22, lite: true, skin: 0.5 }) },
  m_clap: { count: 3, len: 0.15, live: (k, out, t, gain) => woodblock(k, out, t, gain, 1250) },
  m_crash: { count: 2, len: 1.6, live: (k, out, t, gain) => cymbal(k, out, t, gain) },
};

/** 給 SoundBank 用的配方（gain＝1） */
export const MUSIC_HIT_RECIPES: Array<{ name: MusicHitId; recipe: Recipe; count: number; len: number }> = (
  Object.keys(MUSIC_HITS) as MusicHitId[]
).map((name) => ({ name, recipe: (k, out, t) => MUSIC_HITS[name].live(k, out, t, 1), count: MUSIC_HITS[name].count, len: MUSIC_HITS[name].len }));

// ─────────────────────────────────────────── 各模式曲風

const STYLES: Record<PlayMode, Style> = {
  // 主選單：莊嚴悠遠——笙鋪底、古箏琶音、笛子長句、偶爾大鼓與鑼
  menu: {
    bpm: 64,
    root: 62,
    scale: GONG,
    prog: [0, -1, -2, 0],
    wet: 0.55,
    gain: 1.4,
    fadeIn: 2.5,
    melody: { inst: 'dizi', rhythm: [4, 8, 8, 6, 2, 12, 4], rest: 0.18, lo: -1, hi: 7, oct: 1, gain: 0.24, skipFirst: true, down: 0.5, silent: 0.2 },
    bar(b) {
      const bs = b.bassSemi();
      b.pad(0, [bs - 24, bs - 17, bs - 12], 16, 0.12);
      const arp = [0, 2, 3, 5, 7, 5, 3, 2];
      arp.forEach((o, j) => b.zheng(j * 2, b.bass + o, -1, j === 0 ? 0.3 : 0.18));
      if (b.i % 4 === 3) b.gliss(12, b.bass - 2, b.bass + 8, -1, 0.15, 0.035);
      if (b.i % 2 === 0) b.drum(0, 'big', 0.35);
      if (b.i % 8 === 0) b.tam(0, 0.15);
    },
  },
  // 部署：緊張低鼓——低音鼓頑固節奏、梆子滴答、琵琶低音輪指、二胡偶爾低吟
  deploy: {
    bpm: 84,
    root: 57,
    scale: YU,
    prog: [0, 0, -1, -2],
    wet: 0.45,
    gain: 0.9,
    fadeIn: 2,
    melody: { inst: 'erhu', rhythm: [8, 12, 16, 4, 6], rest: 0.3, lo: -2, hi: 4, oct: 0, gain: 0.18, skipFirst: true, down: 0.55, silent: 0.35 },
    bar(b) {
      const bs = b.bassSemi();
      b.drum(0, 'big', 0.55);
      b.drum(6, 'mid', 0.28);
      b.drum(10, 'mid', 0.3);
      b.drum(12, 'big', 0.38);
      if (b.i % 4 === 3) for (const s of [13, 14, 15]) b.drum(s, 'tom', 0.14 + (s - 13) * 0.04);
      b.clap(4, 0.06);
      b.clap(12, 0.06);
      b.pad(0, [bs - 24, bs - 17], 16, 0.13);
      b.zheng(0, b.bass, -2, 0.32);
      if (b.i % 2 === 1) b.tremolo(8, 8, b.bass, -1, 0.1);
    },
  },
  // 交戰：激昂鼓點——大鼓＋中鼓 16 分律動、梆子反拍、琵琶頑固音型、笛子快板
  battle: {
    bpm: 128,
    root: 62,
    scale: YU,
    prog: [0, 0, -1, -1, 0, 0, 1, -2],
    wet: 0.3,
    gain: 0.75,
    fadeIn: 1.5,
    melody: { inst: 'dizi', rhythm: [2, 2, 4, 4, 6, 8, 2], rest: 0.12, lo: 0, hi: 8, oct: 1, gain: 0.22, down: 0.5, silent: 0.15 },
    bar(b) {
      b.drum(0, 'big', 0.7);
      b.drum(8, 'big', 0.6);
      if (b.r() < 0.5) b.drum(10, 'big', 0.4);
      b.drum(14, 'mid', 0.35);
      for (const s of [2, 4, 6, 12, 13]) b.drum(s, 'tom', 0.16 + b.r() * 0.06);
      for (const s of [2, 6, 10, 14]) b.clap(s, 0.07);
      if (b.i % 4 === 3) for (let s = 8; s < 16; s++) b.drum(s, 'tom', 0.15 + (s - 8) * 0.03);
      if (b.i % 4 === 0) b.crash(0, 0.2);
      const riff = b.riff8;
      for (let j = 0; j < 8; j++) b.pipa(j * 2, b.bass + riff[j], -1, j === 0 ? 0.28 : 0.18, 2);
      b.strum(0, [b.bass, b.bass + 2, b.bass + 3], -1, 0.14);
      b.zheng(0, b.bass, -2, 0.4);
      b.zheng(8, b.bass, -2, 0.28);
    },
  },
  // 決戰高潮：更急——每拍大鼓、16 分中鼓連打、琵琶 16 分輪奏、號角長音、鑼
  climax: {
    bpm: 148,
    root: 64,
    scale: YU,
    prog: [0, 0, -1, -2, 0, 1, -1, 0],
    wet: 0.28,
    gain: 0.65,
    fadeIn: 1.0,
    melody: { inst: 'dizi', rhythm: [2, 2, 2, 4, 4, 6], rest: 0.08, lo: 2, hi: 9, oct: 1, gain: 0.22, down: 0.45, silent: 0.1 },
    bar(b) {
      for (const s of [0, 4, 8, 12]) b.drum(s, 'big', 0.6);
      for (let s = 0; s < 16; s++) if (s % 4) b.drum(s, 'tom', s % 2 ? 0.09 : 0.16);
      if (b.i % 2 === 0) b.crash(0, 0.22);
      if (b.i % 8 === 0) b.tam(0, 0.2);
      const riff = b.riff16;
      for (let j = 0; j < 16; j++) b.pipa(j, b.bass + riff[j], -1, j % 4 === 0 ? 0.22 : 0.13, 1);
      if (b.i % 2 === 0) b.horn(0, b.bass, -1, 28, 0.12);
      b.zheng(0, b.bass, -2, 0.42);
      b.zheng(8, b.bass, -2, 0.32);
    },
  },
  // 凱旋：宮調明亮——古箏 16 分琶音、笛子高亢、鼓與鈸、號角
  victory: {
    bpm: 100,
    root: 62,
    scale: GONG,
    prog: [0, 0, -2, -1, 0, -2, 1, 0],
    wet: 0.4,
    gain: 0.8,
    fadeIn: 0.6,
    melody: { inst: 'dizi', rhythm: [4, 4, 8, 2, 2, 6], rest: 0.1, lo: 0, hi: 9, oct: 1, gain: 0.24, down: 0.4 },
    bar(b) {
      const bs = b.bassSemi();
      b.drum(0, 'big', 0.55);
      b.drum(8, 'big', 0.45);
      b.drum(12, 'tom', 0.22);
      b.drum(14, 'tom', 0.22);
      b.clap(4, 0.06);
      b.clap(12, 0.06);
      if (b.i % 4 === 0) b.crash(0, 0.2);
      if (b.i % 4 === 3) b.gliss(12, b.bass, b.bass + 10, -1, 0.14, 0.03);
      const arp = [0, 2, 3, 5, 3, 5, 7, 8, 5, 7, 8, 10, 8, 7, 5, 3];
      for (let j = 0; j < 16; j++) b.zheng(j, b.bass + arp[j], -1, j % 4 === 0 ? 0.18 : 0.11);
      b.pad(0, [bs - 12, bs - 5, bs], 16, 0.08);
      if (b.i % 4 === 0) b.horn(0, b.bass, -1, 14, 0.11);
    },
  },
  // 敗北：悲涼——二胡下行長句、稀疏古箏揉弦、低音笙、遠方喪鼓
  defeat: {
    bpm: 54,
    root: 57,
    scale: YU,
    prog: [0, -1, -2, 0],
    wet: 0.6,
    gain: 1.2,
    fadeIn: 1.2,
    melody: { inst: 'erhu', rhythm: [8, 12, 16, 6, 4], rest: 0.15, lo: -3, hi: 5, oct: 0, gain: 0.2, down: 0.62 },
    bar(b) {
      const bs = b.bassSemi();
      if (b.i % 2 === 0) b.drum(0, 'big', 0.3);
      b.pad(0, [bs - 24, bs - 17], 16, 0.1);
      b.zheng(0, b.bass, -1, 0.2, 0.01);
      if (b.r() < 0.6) b.zheng(8, b.bass + 3, -1, 0.14, 0.008);
      if (b.i % 8 === 4) b.tam(0, 0.1);
    },
  },
};

// ─────────────────────────────────────────── 旋律生成

function makeMotif(r: Rng, m: MelodySpec): Note[] {
  const notes: Note[] = [];
  let s = 0;
  let d = Math.round((m.lo + m.hi) / 2) + pick(r, [-1, 0, 1]);
  const down = m.down ?? 0.5;
  while (s < 32) {
    let len = pick(r, m.rhythm);
    if (s + len > 32) len = 32 - s;
    if (s > 0 && r() < m.rest) {
      s += len;
      continue;
    }
    const x = r();
    let mv = x < 0.2 ? 0 : x < 0.8 ? (r() < down ? -1 : 1) : r() < down ? -2 : 2;
    if (x > 0.95) mv = r() < 0.5 ? 3 : -3;
    d += mv;
    if (d < m.lo) d = m.lo + 1;
    if (d > m.hi) d = m.hi - 1;
    notes.push({ s, len, deg: d });
    s += len;
  }
  return notes;
}

// ─────────────────────────────────────────── 樂手（一個模式一組）

class Player {
  readonly out: GainNode;
  readonly wet: GainNode;
  readonly inst: GainNode;
  readonly pluckBus: AudioNode;
  readonly drumBus: AudioNode;
  readonly riff: number[];
  nextBar: number;
  barIdx = 0;
  stopAt = Infinity;
  deadAt = Infinity;
  private motif: Note[] = [];
  private shift = 0;
  private phraseOn = true;
  private lastMel = 0;

  constructor(
    readonly kit: Kit,
    readonly style: Style,
    dry: AudioNode,
    wetOut: AudioNode,
    t: number,
    private bank: SoundBank | null,
  ) {
    const c = kit.ctx;
    this.out = gainNode(c, 0);
    this.wet = gainNode(c, 0);
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(style.gain, t + style.fadeIn);
    this.wet.gain.setValueAtTime(0, t);
    this.wet.gain.linearRampToValueAtTime(style.gain * style.wet, t + style.fadeIn);
    this.inst = gainNode(c, 1);
    this.inst.connect(this.out);
    this.inst.connect(this.wet);
    this.out.connect(dry);
    this.wet.connect(wetOut);
    // 撥弦琴身共鳴＋柔化高頻
    const body = biquad(c, 'peaking', 230, 1.2, 4);
    body.connect(biquad(c, 'highshelf', 3500, 0.7, -3)).connect(this.inst);
    this.pluckBus = body;
    // 鼓組輕微飽和，更有份量
    const ds = shaper(c, 1.3);
    ds.connect(this.inst);
    this.drumBus = ds;
    this.nextBar = t;
    const r = kit.rnd;
    this.riff = [...pick(r, RIFFS), ...pick(r, RIFFS)];
  }

  /** 播放打擊樂：有預渲染緩衝就用（音高微隨機），否則即時合成 */
  hit(name: MusicHitId, t: number, gain: number, out: AudioNode): void {
    const buf = this.bank?.get(name) ?? null;
    if (!buf) {
      MUSIC_HITS[name].live(this.kit, out, t, gain);
      return;
    }
    const c = this.kit.ctx;
    const s = c.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.97 + this.kit.rnd() * 0.06;
    const g = gainNode(c, gain);
    s.connect(g).connect(out);
    s.onended = () => {
      s.disconnect();
      g.disconnect();
    };
    s.start(t);
  }

  schedule(now: number, horizon: number): void {
    if (this.nextBar < now - 0.05) this.nextBar = now + 0.05; // 分頁暫停後重新對齊
    let guard = 0;
    while (this.nextBar < horizon && this.nextBar < this.stopAt && guard++ < 4) this.playBar();
  }

  private playBar(): void {
    const st = this.style;
    const step = 60 / st.bpm / 4;
    const b = new Bar(this, this.nextBar, step, this.barIdx);
    try {
      st.bar(b);
      this.melody(b);
    } catch {
      // 單小節失敗不影響後續
    }
    this.nextBar += step * 16;
    this.barIdx++;
  }

  private melody(b: Bar): void {
    const m = this.style.melody;
    if (!m) return;
    const r = this.kit.rnd;
    const pb = b.i % 4;
    const phrase = Math.floor(b.i / 4);
    if (pb === 0) {
      if (this.motif.length === 0 || (phrase % 2 === 0 && r() < 0.65)) this.motif = makeMotif(r, m);
      this.shift = pick(r, [-1, 1, 2, 0, -2]);
      this.phraseOn = !(m.skipFirst && phrase === 0) && r() >= (m.silent ?? 0);
    }
    if (!this.phraseOn) return;
    const answer = pb >= 2;
    const off = (pb % 2) * 16;
    const notes = this.motif;
    for (let j = 0; j < notes.length; j++) {
      const n = notes[j];
      if (n.s < off || n.s >= off + 16) continue;
      let deg = n.deg;
      let len = n.len;
      if (answer) {
        deg += this.shift;
        if (j === notes.length - 1) {
          deg = Math.round(deg / 5) * 5; // 句尾回到主音
          len = 32 - n.s;
        }
      }
      deg = clamp(deg, m.lo - 2, m.hi + 2);
      const t = b.at(n.s - off);
      const dur = len * b.step * 0.94;
      const f = b.f(deg, m.oct);
      if (m.inst === 'dizi') {
        if (len >= 4 && r() < 0.3) flute(this.kit, this.inst, t - 0.07, b.f(deg + 1, m.oct), 0.07, m.gain * 0.7, 0); // 倚音
        flute(this.kit, this.inst, t, f, dur, m.gain * (0.85 + 0.3 * r()));
      } else {
        bowed(this.kit, this.inst, t, f, dur, m.gain, this.lastMel > 0 && r() < 0.5 ? this.lastMel : 0);
      }
      this.lastMel = f;
    }
  }

  fadeOut(now: number, sec: number): void {
    for (const g of [this.out, this.wet]) {
      const v = g.gain.value;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(v, now);
      g.gain.linearRampToValueAtTime(0, now + sec);
    }
    this.stopAt = now + sec;
    this.deadAt = now + sec + 0.2;
  }

  dispose(): void {
    this.out.disconnect();
    this.wet.disconnect();
  }
}

// ─────────────────────────────────────────── 對外

export class Music {
  private players: Player[] = [];
  private mode: MusicMode = 'none';

  constructor(
    private kit: Kit,
    private dry: AudioNode,
    private wetOut: AudioNode,
    private bank: SoundBank | null = null,
  ) {}

  get current(): MusicMode {
    return this.mode;
  }

  setMode(mode: MusicMode, now: number): void {
    if (mode === this.mode) return;
    const quick = mode === 'victory' || mode === 'defeat' || this.mode === 'victory' || this.mode === 'defeat';
    this.mode = mode;
    for (const p of this.players) if (p.stopAt === Infinity) p.fadeOut(now, quick ? 1.2 : 2.5);
    if (mode !== 'none') this.players.push(new Player(this.kit, STYLES[mode], this.dry, this.wetOut, now + 0.12, this.bank));
  }

  tick(now: number): void {
    const horizon = now + 0.35;
    this.players = this.players.filter((p) => {
      if (now > p.deadAt) {
        p.dispose();
        return false;
      }
      return true;
    });
    for (const p of this.players) p.schedule(now, horizon);
  }

  dispose(): void {
    for (const p of this.players) p.dispose();
    this.players = [];
  }
}
