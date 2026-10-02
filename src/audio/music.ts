// 史詩配樂（電影預告片式編曲）
// 每種模式是一首「曲目」：數個 8 小節段落（主題、律動、間奏、高潮…），段落依序循環
// 每個段落在 OfflineAudioContext 預渲染成立體聲緩衝（太鼓群、弦樂、銅管、合唱、嗩吶／二胡／笛子旋律、殘響），
// 播放時只需排程 BufferSource 首尾相接 → 可以用大量聲部而不吃即時 CPU
// 主旋律是寫好的固定曲調（D 小調，帶五聲音階色彩），不再隨機產生
// 記憶體：只保留目前曲目與可能接下來會用到的曲目（例：交戰時預備高潮、勝利、敗北）

import type { MusicMode } from './types';
import type { SoundBank } from './bank';
import { drumHit, pluck, woodblock } from './instruments';
import { type LeadKind, type LineNote, bigGong, braam, brass, choir, crash, impact, line, riser, spiccato, strings, subBass, taiko } from './orchestra';
import { type Kit, biquad, gainNode, makeImpulse, mtof } from './synth';

type PlayMode = Exclude<MusicMode, 'none'>;

/** 預渲染取樣率（配樂不需要 16 kHz 以上，省三分之一記憶體） */
const RENDER_SR = 32000;
/** 段落前置（讓起音不被切掉）與尾巴（殘響、鼓聲延音，與下一段重疊） */
const PRE = 0.12;
const TAIL = 3.5;

// ─────────────────────────────────────────── 樂理小工具

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 音名 → MIDI（例：C#5、Bb4） */
function midiOf(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`音名錯誤：${name}`);
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

interface Mel {
  s: number; // 起始（16 分音符）
  len: number;
  midi: number;
  grace: boolean;
}

/** 旋律字串：「音名:長度」，長度以 16 分音符計；「^」＝上方倚音；「-:4」＝休止；「|」只是小節線 */
function mel(src: string): Mel[] {
  const out: Mel[] = [];
  let s = 0;
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [n, l] = tok.split(':');
    const grace = l.endsWith('^');
    const len = parseInt(l, 10);
    if (n !== '-') out.push({ s, len, midi: midiOf(n), grace });
    s += len;
  }
  return out;
}

/** 和弦（根音、三音、五音的音級） */
const CHORDS: Record<string, [number, number, number]> = {
  Dm: [2, 5, 9],
  Bb: [10, 2, 5],
  F: [5, 9, 0],
  C: [0, 4, 7],
  Gm: [7, 10, 2],
  A: [9, 1, 4],
};

/** 大於等於 lo 的最低一個指定音級 */
function above(pc: number, lo: number): number {
  return lo + ((pc - lo) % 12 + 12) % 12;
}

type Voicing = 'close' | 'open' | 'power';
function voice(ch: string, lo: number, v: Voicing): number[] {
  const [r, t, f] = CHORDS[ch];
  const root = above(r, lo);
  if (v === 'power') return [root, above(f, root), root + 12];
  const third = above(t, root + 1);
  const fifth = above(f, root + 1);
  if (v === 'close') return [root, third, fifth].sort((a, b) => a - b);
  return [root, fifth, third + 12];
}

// ─────────────────────────────────────────── 曲調

/** 主題（和弦 Dm Bb F C Dm Bb C Dm）：四度上揚的英雄動機 */
const THEME = mel(`
  A4:2 D5:6^ F5:4 E5:2 D5:2 | F5:6 G5:2 F5:4 D5:4 | C5:4 F5:4 A5:6^ G5:2 | G5:12 E5:4 |
  A4:2 D5:6 F5:4 G5:2 A5:2 | Bb5:6^ A5:2 G5:4 F5:4 | G5:6 E5:2 C5:4 E5:4 | D5:16`);
const T_CHORDS = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'C', 'Dm'];

/** 副題（和弦 Bb C Dm Dm Bb C A A）：往屬和弦推進，製造張力 */
const THEME_B = mel(`
  F5:8 D5:4 C5:4 | G5:8 E5:4 C5:4 | D5:12^ A4:4 | D5:4 E5:4 F5:8 |
  F5:8 G5:4 A5:4 | G5:8 E5:4 C5:4 | E5:12^ C#5:4 | E5:16`);
const B_CHORDS = ['Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A'];

/** 凱旋號角（F 大調） */
const FANFARE = mel(`C4:2 F4:6 A4:4 C5:4 | D5:8 C5:4 Bb4:4 | C5:6 E5:2 G5:8 | F5:16`);
/** 凱旋主題（主題改大調） */
const V_THEME = mel(`
  C5:2 F5:6^ A5:4 G5:2 F5:2 | A5:6 Bb5:2 A5:4 F5:4 | D5:4 F5:4 Bb5:6^ A5:2 | G5:12 E5:4 |
  C5:2 F5:6 A5:4 Bb5:2 C6:2 | D6:6^ C6:2 A5:4 F5:4 | G5:8 E5:4 G5:4 | F5:16`);
/** 輓歌（二胡） */
const LAMENT = mel(`
  D5:8^ C5:4 A4:4 | Bb4:8 A4:4 F4:4 | G4:6 A4:2 Bb4:4 D5:4 | C#5:12^ A4:4 |
  D5:6 F5:2 E5:4 D5:4 | Bb4:8 A4:4 G4:4 | A4:8 G4:4 E4:4 | D4:16`);

// ─────────────────────────────────────────── 段落編寫工具

type Bus = 'drums' | 'strings' | 'brass' | 'choir' | 'lead' | 'pluck' | 'low' | 'fx';
/** 各聲部送殘響量 */
const SEND: Record<Bus, number> = { drums: 0.32, strings: 0.42, brass: 0.36, choir: 0.6, lead: 0.3, pluck: 0.35, low: 0.05, fx: 0.4 };
/** 各聲部音量 */
const LEVEL: Record<Bus, number> = { drums: 1, strings: 1, brass: 0.9, choir: 0.9, lead: 1, pluck: 0.9, low: 1, fx: 0.8 };

class Comp {
  readonly bus: Record<Bus, GainNode>;
  constructor(
    readonly k: Kit,
    readonly step: number,
    readonly chords: string[],
    mix: AudioNode,
    hall: AudioNode,
  ) {
    const c = k.ctx;
    const mk = (b: Bus): GainNode => {
      const g = gainNode(c, LEVEL[b]);
      g.connect(mix);
      g.connect(gainNode(c, SEND[b])).connect(hall);
      return g;
    };
    this.bus = { drums: mk('drums'), strings: mk('strings'), brass: mk('brass'), choir: mk('choir'), lead: mk('lead'), pluck: mk('pluck'), low: mk('low'), fx: mk('fx') };
  }
  t(bar: number, s = 0): number {
    return PRE + (bar * 16 + s) * this.step;
  }
  ch(bar: number): string {
    return this.chords[bar % this.chords.length];
  }
  dur(steps: number): number {
    return steps * this.step;
  }
  root(bar: number, lo: number): number {
    return above(CHORDS[this.ch(bar)][0], lo);
  }

  // 打擊
  taiko(bar: number, s: number, size: 'o' | 'm' | 's', g: number): void {
    taiko(this.k, this.bus.drums, this.t(bar, s), size, g);
  }
  /** 鼓滾：from～to（16 分音符）漸強 */
  roll(bar: number, from: number, to: number, size: 'm' | 's', g0: number, g1: number): void {
    for (let s = from; s <= to; s++) this.taiko(bar, s, size, g0 + ((g1 - g0) * (s - from)) / Math.max(1, to - from));
  }
  crash(bar: number, g: number, s = 0): void {
    crash(this.k, this.bus.drums, this.t(bar, s), g);
  }
  gong(bar: number, g: number): void {
    bigGong(this.k, this.bus.drums, this.t(bar), g);
  }
  impact(bar: number, g: number): void {
    impact(this.k, this.bus.fx, this.t(bar), g);
  }
  riser(bar: number, s: number, steps: number, g: number): void {
    riser(this.k, this.bus.fx, this.t(bar, s), this.dur(steps), g);
  }
  tick(bar: number, s: number, g: number): void {
    woodblock(this.k, this.bus.drums, this.t(bar, s), g, 1350);
  }

  // 和聲
  pad(bar: number, bars: number, lo: number, v: Voicing, g: number, o: Parameters<typeof strings>[6] = {}): void {
    strings(this.k, this.bus.strings, this.t(bar), voice(this.ch(bar), lo, v).map(mtof), this.dur(bars * 16) * 0.98, g, o);
  }
  choir(bar: number, bars: number, lo: number, v: Voicing, g: number, vowel: 'a' | 'o' | 'u'): void {
    choir(this.k, this.bus.choir, this.t(bar), voice(this.ch(bar), lo, v).map(mtof), this.dur(bars * 16) * 0.97, g, vowel);
  }
  brass(bar: number, s: number, steps: number, lo: number, v: Voicing, g: number, o: Parameters<typeof brass>[6] = {}): void {
    brass(this.k, this.bus.brass, this.t(bar, s), voice(this.ch(bar), lo, v).map(mtof), this.dur(steps), g, o);
  }
  braam(bar: number, steps: number, g: number): void {
    braam(this.k, this.bus.brass, this.t(bar), mtof(this.root(bar, 38)), this.dur(steps), g);
  }
  sub(bar: number, bars: number, g: number): void {
    subBass(this.k, this.bus.low, this.t(bar), mtof(this.root(bar, 26)), this.dur(bars * 16) * 0.95, g);
  }
  /** 跳弓頑固音型（steps＝出聲的 16 分位置；accent＝重音位置） */
  ostinato(bar: number, lo: number, steps: number[], g: number, accent: number[] = [0, 8]): void {
    const f = mtof(this.root(bar, lo));
    for (const s of steps) spiccato(this.k, this.bus.strings, this.t(bar, s), f, accent.includes(s) ? g * 1.45 : g, this.dur(2) * 0.9);
  }
  /** 和弦音 8 分音符脈動（弦樂） */
  pulse(bar: number, lo: number, g: number): void {
    const v = voice(this.ch(bar), lo, 'open');
    for (let j = 0; j < 8; j++) spiccato(this.k, this.bus.strings, this.t(bar, j * 2), mtof(v[j % 2 ? 1 : 0]), j % 4 === 0 ? g * 1.3 : g, this.dur(2), j % 2 ? 0.3 : -0.3);
  }
  /** 古箏琶音 */
  zheng(bar: number, lo: number, g: number, sixteenths = false): void {
    const v = voice(this.ch(bar), lo, 'close');
    const seq = [v[0], v[1], v[2], v[0] + 12, v[1] + 12, v[2] + 12, v[0] + 24, v[2] + 12];
    const n = sixteenths ? 16 : 8;
    for (let j = 0; j < n; j++) {
      const m = sixteenths ? seq[j < 8 ? j : 15 - j] : seq[j];
      pluck(this.k, this.bus.pluck, this.t(bar, j * (sixteenths ? 1 : 2)), mtof(m), j === 0 ? g * 1.4 : g, 'zheng');
    }
  }
  /** 琵琶 8 分音型（和弦音） */
  pipa(bar: number, lo: number, g: number): void {
    const v = voice(this.ch(bar), lo, 'close');
    const seq = [v[0], v[0], v[2], v[0], v[1], v[2], v[1], v[0]];
    for (let j = 0; j < 8; j++) pluck(this.k, this.bus.pluck, this.t(bar, j * 2), mtof(seq[j]), j % 4 === 0 ? g * 1.4 : g, 'pipa', 0, this.dur(2) * 1.6);
  }
  /** 琵琶輪指（16 分快速重複） */
  pipaTremolo(bar: number, lo: number, g: number): void {
    const f = mtof(this.root(bar, lo));
    for (let s = 0; s < 16; s++) pluck(this.k, this.bus.pluck, this.t(bar, s), f, g * (0.7 + 0.3 * ((s % 4) === 0 ? 1 : 0)), 'pipa', 0, this.dur(1) * 1.5);
  }

  // 旋律
  line(kind: LeadKind, m: Mel[], g: number, oct = 0, fromBar = 0, pan = 0): void {
    const notes: LineNote[] = m.map((n) => ({
      t: this.t(fromBar, n.s),
      dur: this.dur(n.len) * 0.97,
      f: mtof(n.midi + oct * 12),
      grace: n.grace ? mtof(n.midi + oct * 12 + 2) : undefined,
    }));
    line(this.k, this.bus.lead, notes, kind, g, pan);
  }
  /** 低音區號角呼喚（遠方） */
  call(bar: number, src: string, g: number): void {
    this.line('horns', mel(src), g, 0, bar, -0.3);
  }
  drum(bar: number, s: number, f: number, g: number, decay: number): void {
    drumHit(this.k, this.bus.drums, this.t(bar, s), { f, gain: g, decay, lite: true });
  }
}

interface Section {
  bars: number;
  chords: string[];
  /** 整段一次寫入的部分（旋律線等） */
  once?: (c: Comp) => void;
  /** 逐小節寫入（每小節之間讓出主執行緒） */
  bar: (c: Comp, i: number) => void;
}

interface Cue {
  bpm: number;
  /** 目標響度（RMS） */
  rms: number;
  intro?: string;
  loop: string[];
  sections: Record<string, Section>;
}

const GALLOP = [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15];
const ALL16 = Array.from({ length: 16 }, (_, i) => i);

// ─────────────────────────────────────────── 曲目

const CUES: Record<PlayMode, Cue> = {
  // 主選單：莊嚴遼闊——二胡唱主題 → 號角＋合唱全奏
  menu: {
    bpm: 70,
    rms: 0.085,
    loop: ['A', 'B'],
    sections: {
      A: {
        bars: 8,
        chords: T_CHORDS,
        once: (c) => c.line('erhu', THEME, 0.2),
        bar: (c, i) => {
          c.pad(i, 1, 50, 'open', 0.12, { attack: 0.9, release: 1.4 });
          c.sub(i, 1, 0.16);
          c.zheng(i, 50, 0.12);
          if (i % 4 === 0) c.taiko(i, 0, 'o', 0.5);
          if (i % 2 === 1) c.taiko(i, 8, 'm', 0.22);
          if (i === 0) c.gong(0, 0.14);
          if (i >= 4) c.choir(i, 1, 57, 'close', 0.05, 'u');
          if (i === 7) c.roll(7, 10, 15, 's', 0.06, 0.2);
        },
      },
      B: {
        bars: 8,
        chords: T_CHORDS,
        once: (c) => {
          c.line('horns', THEME, 0.16, -1);
          c.line('dizi', THEME, 0.1, 0, 0, 0.2);
        },
        bar: (c, i) => {
          if (i === 0) c.impact(0, 0.35);
          c.choir(i, 1, 57, 'close', 0.085, 'a');
          c.pad(i, 1, 50, 'open', 0.07, { attack: 0.5 });
          c.pulse(i, 50, 0.06);
          c.sub(i, 1, 0.17);
          c.taiko(i, 0, 'o', 0.55);
          c.taiko(i, 6, 'm', 0.24);
          c.taiko(i, 8, 'o', 0.4);
          c.taiko(i, 12, 'm', 0.3);
          for (let s = 2; s < 16; s += 4) c.taiko(i, s, 's', 0.05);
          if (i % 4 === 0) c.crash(i, 0.17);
          if (i === 7) c.roll(7, 8, 15, 'm', 0.15, 0.45);
        },
      },
    },
  },
  // 部署：山雨欲來——低音弦樂急奏、心跳鼓、遠方號角、銅管漸強
  deploy: {
    bpm: 92,
    rms: 0.1,
    loop: ['A', 'B'],
    sections: {
      A: {
        bars: 8,
        chords: ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'],
        once: (c) => {
          c.call(0, 'A3:4 D4:12', 0.09);
          c.call(4, 'A3:4 D4:6 F4:2 E4:4 -:4', 0.08);
        },
        bar: (c, i) => {
          c.ostinato(i, 38, ALL16, 0.05, [0, 3, 6, 8, 11, 14]);
          c.taiko(i, 0, 'o', 0.42);
          c.taiko(i, 3, 'o', 0.25);
          if (i % 2) {
            c.taiko(i, 8, 'o', 0.32);
            c.taiko(i, 11, 'm', 0.18);
          }
          c.tick(i, 4, 0.035);
          c.tick(i, 12, 0.035);
          c.choir(i, 1, 50, 'close', 0.05, 'o');
          c.pad(i, 1, 69, 'power', 0.03, { tremolo: true, attack: 0.3 });
          c.sub(i, 1, 0.15);
        },
      },
      B: {
        bars: 8,
        chords: ['Dm', 'Dm', 'Bb', 'Bb', 'Gm', 'Gm', 'A', 'A'],
        once: (c) => c.line('suona', mel('D5:4 F5:2 G5:2 Bb5:8 | A5:4 G5:4 D5:8'), 0.09, 0, 4, 0.15),
        bar: (c, i) => {
          if (i === 0) c.crash(0, 0.12);
          c.ostinato(i, 38, ALL16, 0.06, [0, 3, 6, 8, 11, 14]);
          c.ostinato(i, 50, GALLOP, 0.035);
          c.taiko(i, 0, 'o', 0.48);
          c.taiko(i, 3, 'o', 0.28);
          c.taiko(i, 8, 'o', 0.36);
          c.taiko(i, 11, 'm', 0.22);
          c.brass(i, 0, 16, 50, 'open', 0.11, { swell: true, release: 0.3 });
          c.pad(i, 1, 69, 'power', 0.035, { tremolo: true, attack: 0.2 });
          c.sub(i, 1, 0.16);
          if (i >= 6) c.roll(i, 0, 15, 'm', 0.12 + (i - 6) * 0.15, 0.27 + (i - 6) * 0.18);
          if (i === 6) c.riser(6, 0, 32, 0.14);
        },
      },
    },
  },
  // 交戰：律動 → 嗩吶主題 → 二胡間奏 → 主題再現
  battle: {
    bpm: 132,
    rms: 0.15,
    loop: ['A', 'B', 'A', 'C', 'B'],
    sections: {
      A: {
        bars: 8,
        chords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A'],
        bar: (c, i) => {
          if (i === 0) c.crash(0, 0.15);
          c.taiko(i, 0, 'o', 0.6);
          c.taiko(i, 8, 'o', 0.5);
          if (i % 2 === 0) c.taiko(i, 10, 'o', 0.32);
          c.taiko(i, 4, 'm', 0.38);
          c.taiko(i, 12, 'm', 0.38);
          for (let s = 0; s < 16; s++) c.taiko(i, s, 's', s % 4 === 2 ? 0.08 : 0.035);
          if (i % 4 === 3) c.roll(i, 12, 15, 'm', 0.3, 0.45);
          c.ostinato(i, 38, GALLOP, 0.1);
          c.ostinato(i, 50, GALLOP, 0.055);
          c.brass(i, 0, 5, 50, 'power', 0.13, { attack: 0.02, release: 0.15, drive: 2.2 });
          c.pipa(i, 62, 0.07);
          c.sub(i, 1, 0.15);
        },
      },
      B: {
        bars: 8,
        chords: T_CHORDS,
        once: (c) => {
          c.line('suona', THEME, 0.15);
          c.line('horns', THEME, 0.11, -1);
        },
        bar: (c, i) => {
          if (i === 0) c.impact(0, 0.3);
          if (i % 4 === 0) c.crash(i, 0.18);
          c.taiko(i, 0, 'o', 0.6);
          c.taiko(i, 8, 'o', 0.5);
          if (i % 2 === 0) c.taiko(i, 10, 'o', 0.32);
          c.taiko(i, 4, 'm', 0.36);
          c.taiko(i, 12, 'm', 0.36);
          for (let s = 0; s < 16; s++) c.taiko(i, s, 's', s % 4 === 2 ? 0.07 : 0.03);
          if (i === 7) c.roll(7, 8, 15, 'm', 0.2, 0.5);
          c.ostinato(i, 38, GALLOP, 0.09);
          c.choir(i, 1, 57, 'close', 0.065, 'a');
          c.pad(i, 1, 50, 'open', 0.06, { attack: 0.3 });
          c.sub(i, 1, 0.15);
        },
      },
      C: {
        bars: 8,
        chords: B_CHORDS,
        once: (c) => c.line('erhu', THEME_B, 0.18),
        bar: (c, i) => {
          c.taiko(i, 0, 'o', 0.45);
          c.taiko(i, 8, 'm', 0.3);
          for (let s = 0; s < 16; s += 2) c.taiko(i, s, 's', 0.03);
          c.pad(i, 1, 50, 'open', 0.09, { attack: 0.6 });
          if (i < 6) c.pipaTremolo(i, 62, 0.04);
          c.zheng(i, 62, 0.06);
          c.sub(i, 1, 0.14);
          if (i >= 4) c.choir(i, 1, 50, 'close', 0.06, 'o');
          if (i >= 6) c.roll(i, 0, 15, 'm', 0.12 + (i - 6) * 0.16, 0.28 + (i - 6) * 0.2);
          if (i === 6) c.riser(6, 0, 32, 0.17);
        },
      },
    },
  },
  // 決戰：3-3-2 重鼓、號角＋嗩吶齊奏主題、合唱、重擊銅管
  climax: {
    bpm: 148,
    rms: 0.18,
    loop: ['A', 'B'],
    sections: {
      A: {
        bars: 8,
        chords: T_CHORDS,
        once: (c) => {
          c.line('horns', THEME, 0.15, -1);
          c.line('suona', THEME, 0.13);
        },
        bar: (c, i) => {
          if (i === 0) c.impact(0, 0.32);
          if (i % 4 === 0) c.braam(i, 14, 0.12);
          if (i % 2 === 0) c.crash(i, 0.15);
          const big: Array<[number, number]> = [
            [0, 0.58],
            [3, 0.36],
            [6, 0.42],
            [8, 0.52],
            [11, 0.36],
            [14, 0.42],
          ];
          for (const [s, g] of big) c.taiko(i, s, 'o', g);
          c.taiko(i, 4, 'm', 0.3);
          c.taiko(i, 12, 'm', 0.3);
          for (let s = 0; s < 16; s++) c.taiko(i, s, 's', s % 2 ? 0.035 : 0.075);
          if (i === 7) c.roll(7, 8, 15, 's', 0.08, 0.25);
          c.ostinato(i, 38, ALL16, 0.085, [0, 3, 6, 8, 11, 14]);
          c.ostinato(i, 50, ALL16, 0.05, [0, 3, 6, 8, 11, 14]);
          c.choir(i, 1, 57, 'power', 0.08, 'a');
          c.pad(i, 1, 62, 'open', 0.045);
          c.sub(i, 1, 0.16);
        },
      },
      B: {
        bars: 8,
        chords: B_CHORDS,
        once: (c) => {
          c.line('horns', THEME_B, 0.15, -1);
          c.line('suona', THEME_B, 0.12);
        },
        bar: (c, i) => {
          if (i % 4 === 0) c.braam(i, 14, 0.13);
          if (i % 2 === 0) c.crash(i, 0.15);
          for (const [s, g] of [
            [0, 0.58],
            [3, 0.36],
            [6, 0.42],
            [8, 0.52],
            [11, 0.36],
            [14, 0.42],
          ] as Array<[number, number]>)
            c.taiko(i, s, 'o', g);
          c.taiko(i, 4, 'm', 0.3);
          c.taiko(i, 12, 'm', 0.3);
          for (let s = 0; s < 16; s++) c.taiko(i, s, 's', s % 2 ? 0.035 : 0.075);
          c.ostinato(i, 38, ALL16, 0.085, [0, 3, 6, 8, 11, 14]);
          c.pad(i, 1, 69, 'close', 0.045, { tremolo: true, attack: 0.15 });
          c.choir(i, 1, 57, 'power', 0.075, 'a');
          c.sub(i, 1, 0.16);
          if (i >= 6) for (let s = 0; s < 16; s += 2) c.taiko(i, s, 'o', 0.25 + (i - 6) * 0.1 + s * 0.008);
          if (i === 6) c.riser(6, 0, 32, 0.18);
        },
      },
    },
  },
  // 凱旋：號角開場 → 大調主題（笛子＋號角）、行進鼓
  victory: {
    bpm: 96,
    rms: 0.13,
    intro: 'F',
    loop: ['V'],
    sections: {
      F: {
        bars: 4,
        chords: ['F', 'Bb', 'C', 'F'],
        once: (c) => c.line('horns', FANFARE, 0.2),
        bar: (c, i) => {
          if (i === 0) {
            c.impact(0, 0.35);
            c.gong(0, 0.16);
          }
          c.brass(i, 0, 16, 53, 'open', 0.07, { attack: 0.25 });
          c.taiko(i, 0, 'o', 0.5);
          c.taiko(i, 8, 'm', 0.3);
          c.sub(i, 1, 0.14);
          if (i === 2) c.roll(2, 8, 15, 'm', 0.15, 0.45);
          if (i === 3) {
            c.crash(3, 0.2);
            c.choir(3, 1, 57, 'close', 0.09, 'a');
            c.pad(3, 1, 53, 'open', 0.08);
          }
        },
      },
      V: {
        bars: 8,
        chords: ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'C', 'F'],
        once: (c) => {
          c.line('dizi', V_THEME, 0.15, 0, 0, 0.1);
          c.line('horns', V_THEME, 0.09, -1);
        },
        bar: (c, i) => {
          if (i === 0) c.crash(0, 0.15);
          c.taiko(i, 0, 'o', 0.45);
          c.taiko(i, 4, 'm', 0.2);
          c.taiko(i, 8, 'o', 0.35);
          c.taiko(i, 12, 'm', 0.25);
          for (let s = 0; s < 16; s += 2) c.taiko(i, s, 's', 0.04);
          c.pulse(i, 53, 0.055);
          c.choir(i, 1, 60, 'close', 0.055, 'a');
          c.zheng(i, 65, 0.06, true);
          c.sub(i, 1, 0.14);
          if (i === 7) c.roll(7, 12, 15, 'm', 0.2, 0.4);
        },
      },
    },
  },
  // 敗北：二胡輓歌、低沉弦樂與合唱、遠方喪鼓
  defeat: {
    bpm: 58,
    rms: 0.1,
    loop: ['D'],
    sections: {
      D: {
        bars: 8,
        chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Gm', 'A', 'Dm'],
        once: (c) => c.line('erhu', LAMENT, 0.2),
        bar: (c, i) => {
          c.pad(i, 1, 50, 'open', 0.1, { attack: 1.2, release: 1.6 });
          c.choir(i, 1, 50, 'close', 0.055, 'o');
          c.sub(i, 1, 0.12);
          if (i % 4 === 0) c.taiko(i, 0, 'o', 0.3);
          if (i === 0) c.gong(0, 0.08);
          pluckRoot(c, i);
        },
      },
    },
  },
};

function pluckRoot(c: Comp, i: number): void {
  const v = voice(c.ch(i), 62, 'close');
  pluck(c.k, c.bus.pluck, c.t(i, 0), mtof(v[0]), 0.1, 'zheng', 0.01);
  pluck(c.k, c.bus.pluck, c.t(i, 8), mtof(v[2]), 0.07, 'zheng', 0.008);
}

/** 每個曲目接下來可能用到的曲目（預先渲染） */
const NEXT: Record<PlayMode, PlayMode[]> = {
  menu: ['deploy'],
  deploy: ['battle'],
  battle: ['climax', 'victory', 'defeat'],
  climax: ['battle', 'victory', 'defeat'],
  victory: ['menu'],
  defeat: ['menu'],
};

// ─────────────────────────────────────────── 預渲染

const yieldMain = (): Promise<void> => new Promise((res) => setTimeout(res, 0));

async function renderSection(base: Kit, cue: Cue, sec: Section): Promise<AudioBuffer | null> {
  const OAC: typeof OfflineAudioContext | undefined =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!OAC) return null;
  const step = 60 / cue.bpm / 4;
  const len = PRE + sec.bars * 16 * step + TAIL;
  let off: OfflineAudioContext;
  try {
    off = new OAC(2, Math.ceil(RENDER_SR * len), RENDER_SR);
  } catch {
    const sr = base.ctx.sampleRate;
    off = new OAC(2, Math.ceil(sr * len), sr);
  }
  const k: Kit = { ...base, ctx: off };
  // 總線：各聲部 → 混音 → 壓縮 → 輸出；殘響（大廳）
  const mix = gainNode(off, 1);
  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 8;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  mix.connect(biquad(off, 'highpass', 28, 0.7)).connect(comp).connect(off.destination);
  const hall = off.createConvolver();
  hall.buffer = makeImpulse(off, 3.4, 3);
  const hallIn = gainNode(off, 1);
  hallIn.connect(biquad(off, 'highpass', 180, 0.7)).connect(hall).connect(gainNode(off, 0.55)).connect(mix);
  const c = new Comp(k, step, sec.chords, mix, hallIn);
  sec.once?.(c);
  for (let i = 0; i < sec.bars; i++) {
    sec.bar(c, i);
    await yieldMain();
  }
  const buf = await off.startRendering();
  // 響度部分對齊：太小聲的段落拉高、太大聲的壓低（只修正一半，保留段落間的起伏）；峰值不超過 0.95
  let sum = 0;
  let peak = 1e-6;
  const n = buf.length;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i += 4) {
      const v = d[i];
      sum += v * v;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
    }
  }
  const rms = Math.sqrt(sum / ((n / 4) * buf.numberOfChannels)) || 1e-6;
  let g = Math.pow(cue.rms / rms, 0.5);
  g = Math.min(Math.max(g, 0.3), 4, 0.95 / peak);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return buf;
}

// ─────────────────────────────────────────── 播放

class Player {
  readonly out: GainNode;
  readonly wet: GainNode;
  private seq = 0;
  nextT = -1;
  stopAt = Infinity;
  deadAt = Infinity;
  private sources: AudioBufferSourceNode[] = [];

  constructor(
    private ctx: BaseAudioContext,
    readonly mode: PlayMode,
    private cue: Cue,
    dry: AudioNode,
    wetOut: AudioNode,
    private fadeIn: number,
  ) {
    this.out = gainNode(ctx, 0);
    this.wet = gainNode(ctx, 0);
    this.out.connect(dry);
    this.wet.connect(wetOut);
  }

  /** 第 n 個要播的段落 */
  private secAt(n: number): string {
    const c = this.cue;
    if (c.intro) return n === 0 ? c.intro : c.loop[(n - 1) % c.loop.length];
    return c.loop[n % c.loop.length];
  }

  get upcoming(): string {
    return this.secAt(this.seq);
  }

  schedule(now: number, get: (sec: string) => AudioBuffer | null): void {
    if (now >= this.stopAt) return;
    const id = this.secAt(this.seq);
    const buf = get(id);
    if (!buf) {
      // 還沒渲染好：等，時間往後推
      if (this.nextT >= 0 && this.nextT < now + 0.05) this.nextT = now + 0.1;
      return;
    }
    if (this.nextT < 0) {
      // 第一段：淡入
      this.nextT = now + 0.15;
      for (const [g, v] of [
        [this.out, 1],
        [this.wet, 0.12],
      ] as const) {
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(v, now + 0.15 + this.fadeIn);
      }
    }
    if (this.nextT - now > 1.2) return;
    if (this.nextT < now) this.nextT = now + 0.05; // 分頁暫停後重新對齊
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.connect(this.out);
    s.connect(this.wet);
    const at = this.nextT - PRE;
    if (at >= now) s.start(at);
    else s.start(now, now - at);
    s.onended = () => {
      s.disconnect();
      this.sources = this.sources.filter((x) => x !== s);
    };
    this.sources.push(s);
    const sec = this.cue.sections[id];
    this.nextT += (sec.bars * 16 * 60) / this.cue.bpm / 4;
    this.seq++;
  }

  fadeOut(now: number, sec: number): void {
    for (const g of [this.out, this.wet]) {
      const v = g.gain.value;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(v, now);
      g.gain.linearRampToValueAtTime(0, now + sec);
    }
    this.stopAt = now;
    this.deadAt = now + sec + 0.2;
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* 已停止 */
      }
    }
    this.sources = [];
    this.out.disconnect();
    this.wet.disconnect();
  }
}

// ─────────────────────────────────────────── 對外

export class Music {
  private players: Player[] = [];
  private mode: MusicMode = 'none';
  /** 已渲染的段落：key＝「曲目/段落」 */
  private ready = new Map<string, AudioBuffer>();
  private pending = new Set<string>();
  private busy = false;

  constructor(
    private kit: Kit,
    private dry: AudioNode,
    private wetOut: AudioNode,
    _bank: SoundBank | null = null,
  ) {}

  get current(): MusicMode {
    return this.mode;
  }

  /** 已渲染段落數（DEV 顯示用） */
  get renderedCount(): number {
    return this.ready.size;
  }

  setMode(mode: MusicMode, now: number): void {
    if (mode === this.mode) return;
    const quick = mode === 'victory' || mode === 'defeat' || this.mode === 'victory' || this.mode === 'defeat';
    this.mode = mode;
    for (const p of this.players) if (p.stopAt === Infinity) p.fadeOut(now, quick ? 1.2 : 2.5);
    if (mode !== 'none') this.players.push(new Player(this.kit.ctx, mode, CUES[mode], this.dry, this.wetOut, quick ? 0.4 : 2));
    this.evict();
    void this.pump();
  }

  /** 需要的段落（依優先順序）：目前曲目先，接著是可能的下一首 */
  private wanted(): string[] {
    if (this.mode === 'none') return [];
    const out: string[] = [];
    const add = (m: PlayMode, all: boolean) => {
      const c = CUES[m];
      const order = [...(c.intro ? [c.intro] : []), ...c.loop];
      for (const s of all ? order : order.slice(0, 1)) if (!out.includes(`${m}/${s}`)) out.push(`${m}/${s}`);
    };
    const cur = this.mode as PlayMode;
    // 正在播的曲目：下一段最優先
    const p = this.players.find((x) => x.mode === cur && x.stopAt === Infinity);
    if (p) out.push(`${cur}/${p.upcoming}`);
    add(cur, true);
    for (const n of NEXT[cur]) add(n, false);
    for (const n of NEXT[cur]) add(n, true);
    return out;
  }

  /** 丟掉用不到的曲目，控制記憶體 */
  private evict(): void {
    const keep = new Set(this.wanted().map((k) => k.split('/')[0]));
    for (const p of this.players) keep.add(p.mode);
    for (const key of [...this.ready.keys()]) if (!keep.has(key.split('/')[0])) this.ready.delete(key);
  }

  /** 依序渲染需要的段落（一次一段，不搶 CPU） */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const key = this.wanted().find((k) => !this.ready.has(k) && !this.pending.has(k));
        if (!key) break;
        this.pending.add(key);
        const [m, s] = key.split('/') as [PlayMode, string];
        const cue = CUES[m];
        try {
          const buf = await renderSection(this.kit, cue, cue.sections[s]);
          if (buf) this.ready.set(key, buf);
        } catch {
          // 單段失敗：略過
        }
        this.pending.delete(key);
        await yieldMain();
      }
    } finally {
      this.busy = false;
    }
  }

  tick(now: number): void {
    this.players = this.players.filter((p) => {
      if (now > p.deadAt) {
        p.dispose();
        return false;
      }
      return true;
    });
    for (const p of this.players) p.schedule(now, (sec) => this.ready.get(`${p.mode}/${sec}`) ?? null);
  }

  dispose(): void {
    for (const p of this.players) p.dispose();
    this.players = [];
    this.ready.clear();
  }
}
