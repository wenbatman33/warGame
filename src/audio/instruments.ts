// 樂器與音效積木：戰鼓、金屬撞擊、銅鑼、牛角號、古箏／琵琶撥弦、笛子、二胡、笙、鈴、梆子、鈸、人群吶喊、火星劈啪、悶擊
// 每個函式把聲音排程在時間 t 並接到 out，回傳聲音大約長度（秒）

import {
  type Kit,
  adGain,
  asrGain,
  biquad,
  gainNode,
  ksBuffer,
  mtof,
  noiseSrc,
  oscSrc,
  periodic,
  rand,
  shaper,
  type PluckTone,
} from './synth';

// ─────────────────────────────────────────── 鼓

export interface DrumOpts {
  f: number; // 鼓身基頻
  gain: number;
  decay: number;
  drop?: number; // 起始音高倍率（pitch drop）
  skin?: number; // 鼓皮擊打噪聲量
  thump?: number; // 低頻悶擊量
  lite?: boolean; // 精簡版（小鼓／密集鼓點用，省節點）
}

/** 戰鼓：正弦 pitch drop 鼓身＋第二振動模態＋鼓皮帶通噪聲＋棕噪低頻悶擊 */
export function drumHit(k: Kit, out: AudioNode, t: number, o: DrumOpts): number {
  const c = k.ctx;
  const drop = o.drop ?? 2.6;
  const body = oscSrc(c, 'sine', o.f * drop, t, o.decay + 0.15);
  body.frequency.exponentialRampToValueAtTime(o.f, t + 0.035);
  body.frequency.exponentialRampToValueAtTime(o.f * 0.8, t + o.decay);
  body.connect(adGain(c, t, 0.002, o.gain, o.decay)).connect(out);
  // 鼓皮擊打
  noiseSrc(k, k.white, t, 0.12)
    .connect(biquad(c, 'bandpass', Math.min(o.f * 14, 3000), 0.9))
    .connect(adGain(c, t, 0.001, o.gain * (o.skin ?? 0.35), 0.07))
    .connect(out);
  if (o.lite) return o.decay;
  // 第二模態（約 1.59 倍）
  const m2 = oscSrc(c, 'sine', o.f * 1.59 * drop * 0.7, t, o.decay * 0.5 + 0.1);
  m2.frequency.exponentialRampToValueAtTime(o.f * 1.59, t + 0.03);
  m2.connect(adGain(c, t, 0.002, o.gain * 0.3, o.decay * 0.4)).connect(out);
  // 低頻悶擊（胸腔感）
  noiseSrc(k, k.brown, t, 0.35)
    .connect(biquad(c, 'lowpass', o.f * 3.2, 0.7))
    .connect(adGain(c, t, 0.003, o.gain * (o.thump ?? 0.9), 0.22))
    .connect(out);
  return o.decay;
}

/** 多名鼓手齊擊：時間與音高微差，形成厚實的群鼓 */
export function drumEnsemble(k: Kit, out: AudioNode, t: number, o: DrumOpts, n: number, spread = 0.014): number {
  const r = k.rnd;
  for (let i = 0; i < n; i++) {
    drumHit(k, out, t + (i === 0 ? 0 : r() * spread), {
      ...o,
      f: o.f * rand(r, 0.94, 1.06),
      gain: (o.gain / Math.sqrt(n)) * rand(r, 0.85, 1.1),
      lite: o.lite || i > 1,
    });
  }
  return o.decay + spread;
}

// ─────────────────────────────────────────── 金屬

const METAL_RATIOS = [1, 1.483, 1.932, 2.546, 2.63, 3.897, 4.38, 5.43, 6.21];

/** 金屬撞擊：不和諧泛音（含相近泛音對產生拍頻）＋高通噪聲瞬態 */
export function metalHit(k: Kit, out: AudioNode, t: number, base: number, gain: number, decay: number, partials = 7): number {
  const c = k.ctx;
  const r = k.rnd;
  const mix = gainNode(c, 1);
  mix.connect(out);
  const np = Math.min(partials, METAL_RATIOS.length);
  for (let i = 0; i < np; i++) {
    const f = base * METAL_RATIOS[i] * rand(r, 0.985, 1.015);
    if (f > 15000) break;
    const amp = (gain * (i === 0 ? 0.7 : 1 / (1 + i * 0.3)) * rand(r, 0.55, 1) * 2.2) / np;
    const d = (decay * rand(r, 0.5, 1.1)) / (1 + i * 0.22);
    oscSrc(c, 'sine', f, t, d + 0.05).connect(adGain(c, t, 0.0008, amp, d)).connect(mix);
  }
  noiseSrc(k, k.white, t, 0.05)
    .connect(biquad(c, 'highpass', 2800, 0.7))
    .connect(adGain(c, t, 0.0005, gain * 0.45, 0.025))
    .connect(mix);
  return decay;
}

const GONG_RATIOS = [1, 1.52, 2.03, 2.48, 2.97, 3.53, 4.11, 4.72, 5.33, 6.1, 7.2, 8.6];

/** 銅鑼：12 個非整數倍泛音、高泛音延遲「開花」、整體音高下滑（大鑼特色）＋鑼槌悶擊＋金屬嘶聲 */
export function gongHit(k: Kit, out: AudioNode, t: number, base: number, gain: number, decay: number, bend = -0.035): number {
  const c = k.ctx;
  const r = k.rnd;
  const mix = gainNode(c, 1);
  mix.connect(out);
  GONG_RATIOS.forEach((ratio, i) => {
    const f = base * ratio * rand(r, 0.99, 1.01);
    if (f > 14000) return;
    const o = oscSrc(c, 'sine', f, t, decay + 0.3);
    o.frequency.linearRampToValueAtTime(f * (1 + bend), t + 0.9);
    const att = 0.002 + i * 0.014;
    o.connect(adGain(c, t, att, (gain * 0.24) / (1 + i * 0.18), decay / (1 + i * 0.12))).connect(mix);
  });
  noiseSrc(k, k.brown, t, 0.25)
    .connect(biquad(c, 'lowpass', 900, 0.8))
    .connect(adGain(c, t, 0.002, gain * 0.6, 0.09))
    .connect(mix);
  noiseSrc(k, k.white, t, decay * 0.6)
    .connect(biquad(c, 'bandpass', Math.min(base * 18, 9000), 1.2))
    .connect(adGain(c, t, 0.06, gain * 0.07, decay * 0.5))
    .connect(mix);
  return decay;
}

/** 鈸（鏘）：高通噪聲＋短金屬泛音 */
export function cymbal(k: Kit, out: AudioNode, t: number, gain: number, decay = 1.4): number {
  const c = k.ctx;
  noiseSrc(k, k.white, t, decay + 0.1)
    .connect(biquad(c, 'highpass', 4200, 0.6))
    .connect(biquad(c, 'peaking', 7500, 0.8, 5))
    .connect(adGain(c, t, 0.001, gain * 0.55, decay))
    .connect(out);
  metalHit(k, out, t, 420, gain * 0.6, decay * 0.5, 7);
  return decay;
}

/** 梆子／板：木質短促「喀」 */
export function woodblock(k: Kit, out: AudioNode, t: number, gain: number, f = 1100): number {
  const c = k.ctx;
  const o = oscSrc(c, 'sine', f * 1.05, t, 0.1);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
  o.connect(adGain(c, t, 0.0005, gain, 0.06)).connect(out);
  oscSrc(c, 'sine', f * 2.37, t, 0.05).connect(adGain(c, t, 0.0005, gain * 0.35, 0.03)).connect(out);
  noiseSrc(k, k.white, t, 0.04)
    .connect(biquad(c, 'bandpass', f * 1.8, 5))
    .connect(adGain(c, t, 0.0005, gain * 0.6, 0.02))
    .connect(out);
  return 0.1;
}

// ─────────────────────────────────────────── 號角

export interface HornOpts {
  glide?: number; // 起音音高倍率（由低滑上）
  vib?: number; // 顫音速度 Hz
  bright?: number; // 亮度倍率
  attack?: number;
  release?: number;
}

/** 牛角號：雙鋸齒微失諧＋低八度方波＋正弦 → 軟削波 → 隨氣流開啟的低通（銅管張口感）＋延遲顫音＋氣息噪聲 */
export function hornNote(k: Kit, out: AudioNode, t: number, f: number, dur: number, gain: number, o: HornOpts = {}): number {
  const c = k.ctx;
  const att = o.attack ?? 0.16;
  const rel = o.release ?? 0.35;
  const bright = o.bright ?? 1;
  const end = t + Math.max(dur, att);
  const total = dur + rel + 0.3;
  const pre = gainNode(c, 0.45);
  const lp = biquad(c, 'lowpass', f * 1.2, 1.6);
  const lf = lp.frequency;
  lf.setValueAtTime(f * 1.2, t);
  lf.linearRampToValueAtTime(Math.min(f * 7 * bright, 9000), t + att);
  lf.setTargetAtTime(Math.min(f * 4.6 * bright, 8000), t + att, 0.25);
  lf.setTargetAtTime(f * 1.2, end, rel / 3);
  const amp = asrGain(c, t, att, gain, dur, rel);
  pre.connect(shaper(c, 2.2)).connect(lp).connect(amp).connect(out);
  // 延遲顫音
  const lfo = oscSrc(c, 'sine', o.vib ?? 4.6, t, total);
  const lfoG = c.createGain();
  lfoG.gain.setValueAtTime(0, t);
  lfoG.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(dur, 0.9));
  lfo.connect(lfoG);
  const g0 = o.glide ?? 0.86;
  const layers: Array<[OscillatorType, number, number]> = [
    ['sawtooth', 0.997, 0.5],
    ['sawtooth', 1.004, 0.5],
    ['square', 0.5, 0.22],
    ['sine', 1, 0.4],
  ];
  for (const [type, mul, lvl] of layers) {
    const os = oscSrc(c, type, f * mul * g0, t, total);
    os.frequency.exponentialRampToValueAtTime(f * mul, t + att * 0.9 + 0.04);
    lfoG.connect(os.frequency);
    os.connect(gainNode(c, lvl)).connect(pre);
  }
  // 氣息
  noiseSrc(k, k.white, t, total)
    .connect(biquad(c, 'bandpass', f * 3, 1.2))
    .connect(asrGain(c, t, att * 0.6, gain * 0.06, dur, rel))
    .connect(out);
  return dur + rel;
}

// ─────────────────────────────────────────── 弦樂

export type PluckKind = 'zheng' | 'pipa' | 'bow';
const PLUCK_TONES: Record<PluckKind, PluckTone> = {
  zheng: { t60: 2.4, bright: 0.5, dur: 2.4, pos: 0.18 }, // 古箏：悠長溫潤
  pipa: { t60: 0.85, bright: 0.85, dur: 1.2, pos: 0.12 }, // 琵琶：明亮顆粒
  bow: { t60: 0.2, bright: 0.95, dur: 0.35, pos: 0.3 }, // 弓弦：短促有力
};

/**
 * Karplus-Strong 撥弦（緩衝依三個半音的格點快取，再以 playbackRate 微調音高）
 * vib＞0 時加「揉弦」；damp＞0 時在 damp 秒後止音（快速音型用，減少同時發聲數）
 */
export function pluck(k: Kit, out: AudioNode, t: number, f: number, gain: number, kind: PluckKind = 'zheng', vib = 0, damp = 0): number {
  const c = k.ctx;
  const midi = 69 + 12 * Math.log2(f / 440);
  const grid = Math.round(midi / 3) * 3;
  const buf = ksBuffer(c, grid, PLUCK_TONES[kind], kind);
  const s = c.createBufferSource();
  s.buffer = buf;
  const rate = f / mtof(grid);
  s.playbackRate.setValueAtTime(rate, t);
  if (vib > 0) {
    for (let i = 0; i < 6; i++) s.playbackRate.linearRampToValueAtTime(rate * (1 + (i % 2 ? -vib : vib)), t + 0.3 + i * 0.1);
    s.playbackRate.linearRampToValueAtTime(rate, t + 0.95);
  }
  const g = gainNode(c, gain);
  s.connect(g).connect(out);
  s.start(t);
  if (damp > 0 && damp < buf.duration / rate) {
    g.gain.setValueAtTime(gain, t + damp);
    g.gain.setTargetAtTime(0, t + damp, 0.03);
    s.stop(t + damp + 0.2);
  }
  if (kind === 'pipa') {
    // 琵琶指甲的撥奏聲
    noiseSrc(k, k.white, t, 0.02)
      .connect(biquad(c, 'highpass', 3000, 0.7))
      .connect(adGain(c, t, 0.0005, gain * 0.15, 0.01))
      .connect(out);
  }
  return damp > 0 ? Math.min(damp + 0.2, buf.duration / rate) : buf.duration / rate;
}

/** 笛子：帶少量泛音的週期波＋起音滑音＋延遲顫音＋氣聲＋吹口噪聲 */
export function flute(k: Kit, out: AudioNode, t: number, f: number, dur: number, gain: number, vib = 1): number {
  const c = k.ctx;
  const o = c.createOscillator();
  o.setPeriodicWave(periodic(c, 'dizi', [0, 1, 0.42, 0.16, 0.09, 0.05, 0.03, 0.02]));
  o.frequency.setValueAtTime(f * 0.975, t);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
  o.start(t);
  o.stop(t + dur + 0.4);
  if (vib > 0 && dur > 0.25) {
    const lfo = oscSrc(c, 'sine', rand(k.rnd, 5, 5.8), t, dur + 0.4);
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.setValueAtTime(0, t + 0.15);
    lg.gain.linearRampToValueAtTime(f * 0.011 * vib, t + Math.min(dur, 0.7));
    lfo.connect(lg).connect(o.frequency);
  }
  const amp = asrGain(c, t, 0.05, gain, dur, 0.14);
  // 笛膜的亮音
  o.connect(biquad(c, 'peaking', 2600, 1.4, 4)).connect(amp).connect(out);
  noiseSrc(k, k.white, t, dur + 0.3)
    .connect(biquad(c, 'bandpass', Math.min(f * 2, 9000), 1.3))
    .connect(asrGain(c, t, 0.02, gain * 0.08, dur, 0.12))
    .connect(out);
  noiseSrc(k, k.white, t, 0.1)
    .connect(biquad(c, 'bandpass', Math.min(f * 3, 9000), 2))
    .connect(adGain(c, t, 0.004, gain * 0.14, 0.06))
    .connect(out);
  return dur + 0.3;
}

/** 二胡：鋸齒波＋鼻音共振峰＋延遲顫音＋滑音（from 為上一音頻率）＋弓毛噪聲 */
export function bowed(k: Kit, out: AudioNode, t: number, f: number, dur: number, gain: number, from = 0): number {
  const c = k.ctx;
  const o = oscSrc(c, 'sawtooth', from > 0 ? from : f, t, dur + 0.6);
  if (from > 0) o.frequency.exponentialRampToValueAtTime(f, t + 0.16);
  const lfo = oscSrc(c, 'sine', rand(k.rnd, 5.6, 6.6), t, dur + 0.6);
  const lg = c.createGain();
  lg.gain.setValueAtTime(0, t);
  lg.gain.setValueAtTime(0, t + 0.25);
  lg.gain.linearRampToValueAtTime(f * 0.014, t + Math.min(dur, 0.8));
  lfo.connect(lg).connect(o.frequency);
  const amp = asrGain(c, t, 0.14, gain, dur, 0.28);
  o.connect(biquad(c, 'highpass', 280, 0.7))
    .connect(biquad(c, 'peaking', 1000, 1.8, 7))
    .connect(biquad(c, 'peaking', 2600, 2.5, 4))
    .connect(biquad(c, 'lowpass', 4200, 0.7))
    .connect(amp)
    .connect(out);
  noiseSrc(k, k.white, t, dur + 0.4)
    .connect(biquad(c, 'bandpass', 3000, 1))
    .connect(asrGain(c, t, 0.1, gain * 0.03, dur, 0.2))
    .connect(out);
  return dur + 0.4;
}

/** 笙：簧片波形的和音長音（每音兩支微失諧），緩起緩收 */
export function sheng(k: Kit, out: AudioNode, t: number, freqs: number[], dur: number, gain: number): number {
  const c = k.ctx;
  const lp = biquad(c, 'lowpass', 1700, 0.6);
  const amp = asrGain(c, t, Math.min(0.8, dur * 0.3), gain, dur, 0.9);
  lp.connect(amp).connect(out);
  const wave = periodic(c, 'reed', [0, 1, 0.55, 0.4, 0.28, 0.2, 0.14, 0.1, 0.07]);
  const per = 1 / (freqs.length * 2);
  for (const f of freqs) {
    for (const det of [-1, 1]) {
      const o = c.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = f * (1 + det * 0.0018);
      o.start(t);
      o.stop(t + dur + 1.2);
      o.connect(gainNode(c, per)).connect(lp);
    }
  }
  return dur + 1;
}

/** 鈴／磬：鐘形非整數泛音 */
export function bell(k: Kit, out: AudioNode, t: number, f: number, gain: number, decay: number): number {
  const c = k.ctx;
  const parts: Array<[number, number, number]> = [
    [1, 1, 1],
    [2.0, 0.45, 0.6],
    [2.76, 0.35, 0.4],
    [5.4, 0.15, 0.25],
    [8.93, 0.08, 0.15],
  ];
  for (const [ratio, amp, dk] of parts) {
    if (f * ratio > 15000) continue;
    oscSrc(c, 'sine', f * ratio, t, decay * dk + 0.05)
      .connect(adGain(c, t, 0.001, gain * amp * 0.5, decay * dk))
      .connect(out);
  }
  return decay;
}

// ─────────────────────────────────────────── 人聲

type Vowel = 'a' | 'o' | 'e';
const VOWELS: Record<Vowel, Array<[number, number, number]>> = {
  // [共振峰頻率, 增益, Q]
  a: [[800, 1, 5], [1250, 0.6, 7], [2600, 0.25, 9]],
  o: [[500, 1, 5], [900, 0.55, 7], [2400, 0.15, 9]],
  e: [[550, 1, 5], [1800, 0.5, 8], [2600, 0.25, 9]],
};

export interface CrowdOpts {
  n: number; // 人數（振盪器數）
  dur: number;
  f0: [number, number]; // 基頻範圍
  gain: number;
  vowel?: Vowel;
  stagger?: number; // 起聲錯開秒數
  rise?: number; // 起聲音高倍率（喊聲由低衝上）
  glide?: number; // 收尾音高倍率
  formant?: number; // 共振峰整體倍率（尖叫用 >1）
  breath?: number; // 嘶吼噪聲量
  drive?: number; // 聲帶撕裂感（軟削波）
}

/** 群眾吶喊：多支鋸齒波（各自音高抖動、起落）→ 軟削波 → 並聯母音共振峰；再混入粉紅噪聲嘶吼 */
export function crowdVoices(k: Kit, out: AudioNode, t: number, o: CrowdOpts): number {
  const c = k.ctx;
  const r = k.rnd;
  const stagger = o.stagger ?? 0.25;
  const sum = gainNode(c, 1);
  const fo = gainNode(c, 1);
  fo.connect(out);
  const drive = shaper(c, o.drive ?? 2.5, '2x');
  sum.connect(drive);
  const fm = o.formant ?? 1;
  for (const [ff, amp, q] of VOWELS[o.vowel ?? 'a']) {
    const bp = biquad(c, 'bandpass', ff * fm * rand(r, 0.95, 1.05), q);
    // 共振峰緩慢漂移，像母音在變
    bp.frequency.linearRampToValueAtTime(ff * fm * rand(r, 1.0, 1.12), t + o.dur);
    drive.connect(bp).connect(gainNode(c, amp * 2.6)).connect(fo);
  }
  const per = o.gain / Math.sqrt(o.n);
  for (let i = 0; i < o.n; i++) {
    const st = t + r() * stagger;
    const d = o.dur * rand(r, 0.75, 1.05);
    const f0 = rand(r, o.f0[0], o.f0[1]);
    const v = oscSrc(c, 'sawtooth', f0 * (o.rise ?? 0.82), st, d + 0.4);
    const fr = v.frequency;
    fr.exponentialRampToValueAtTime(f0, st + 0.1 + r() * 0.08);
    let tt = st + 0.2;
    while (tt < st + d * 0.75) {
      fr.linearRampToValueAtTime(f0 * rand(r, 0.97, 1.03), tt);
      tt += rand(r, 0.08, 0.16);
    }
    fr.exponentialRampToValueAtTime(f0 * (o.glide ?? 0.78), st + d);
    v.connect(asrGain(c, st, 0.05 + r() * 0.08, per * rand(r, 0.6, 1), d * 0.8, d * 0.25)).connect(sum);
  }
  noiseSrc(k, k.pink, t, o.dur + 0.5)
    .connect(asrGain(c, t, 0.1, o.gain * (o.breath ?? 0.35), o.dur * 0.8, o.dur * 0.3))
    .connect(sum);
  return o.dur + stagger + 0.4;
}

// ─────────────────────────────────────────── 小積木

/** 火星劈啪：極短高通噪聲脈衝 */
export function crackle(k: Kit, out: AudioNode, t: number, gain: number, bright = 1): number {
  const c = k.ctx;
  const d = rand(k.rnd, 0.004, 0.018);
  noiseSrc(k, k.white, t, d + 0.03)
    .connect(biquad(c, 'highpass', rand(k.rnd, 1200, 3200) * bright, 0.8))
    .connect(adGain(c, t, 0.0003, gain, d))
    .connect(out);
  return d;
}

/** 悶擊（腳步、馬蹄、倒地、碎塊）：正弦 pitch drop＋低通棕噪 */
export function thud(k: Kit, out: AudioNode, t: number, f: number, gain: number, decay: number): number {
  const c = k.ctx;
  const o = oscSrc(c, 'sine', f * 1.6, t, decay + 0.05);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
  o.frequency.exponentialRampToValueAtTime(f * 0.7, t + decay);
  o.connect(adGain(c, t, 0.001, gain, decay)).connect(out);
  noiseSrc(k, k.brown, t, decay + 0.05)
    .connect(biquad(c, 'lowpass', f * 6, 0.7))
    .connect(adGain(c, t, 0.001, gain * 0.8, decay * 0.8))
    .connect(out);
  return decay;
}

/** 帶通噪聲掃頻（呼嘯、揮動、點火） */
export function sweep(
  k: Kit,
  out: AudioNode,
  t: number,
  dur: number,
  gain: number,
  f0: number,
  f1: number,
  f2: number,
  q: number,
  buf: 'white' | 'pink' | 'brown' = 'white',
): number {
  const c = k.ctx;
  const bp = biquad(c, 'bandpass', f0, q);
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.5);
  bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur * 0.5);
  g.gain.linearRampToValueAtTime(0, t + dur);
  noiseSrc(k, k[buf], t, dur + 0.02).connect(bp).connect(g).connect(out);
  return dur;
}
