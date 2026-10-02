// 史詩配樂樂器：弦樂群（長音／跳弓）、銅管群（長音／重擊）、合唱、太鼓群、旋律線（嗩吶／二胡／笛子／號角）、
// 低音、衝擊（impact）、上升音效（riser）
// 這些都在 OfflineAudioContext 預渲染（見 music.ts），所以可以用比即時合成多很多的聲部
// 每個函式把聲音排程在時間 t 並接到 out

import { cymbal, drumHit, gongHit } from './instruments';
import { type Kit, adGain, asrGain, biquad, gainNode, noiseSrc, oscSrc, panner, periodic, rand, shaper } from './synth';

const cents = (c: number): number => Math.pow(2, c / 1200);

// ─────────────────────────────────────────── 弦樂

export interface PadOpts {
  attack?: number;
  release?: number;
  /** 亮度（低通截止倍率） */
  bright?: number;
  /** 每個音的聲部數 */
  voices?: number;
  /** 弓弦顫音（快速音量起伏，緊張感） */
  tremolo?: boolean;
  /** 漸強（整段音量由 0.35 升到 1） */
  swell?: boolean;
}

/** 弦樂長音：每音數支微失諧鋸齒波、左右展開，共用一個顫音 LFO（以 detune 調變，與音高無關） */
export function strings(k: Kit, out: AudioNode, t: number, freqs: number[], dur: number, gain: number, o: PadOpts = {}): void {
  const c = k.ctx;
  const att = o.attack ?? 0.5;
  const rel = o.release ?? 0.8;
  const nv = o.voices ?? 3;
  const end = t + dur + rel + 0.3;
  const amp = o.swell ? swellGain(c, t, gain, dur, rel) : asrGain(c, t, att, gain, dur, rel);
  const lo = Math.min(...freqs);
  const lp = biquad(c, 'lowpass', Math.min(5200, 1400 + lo * 4) * (o.bright ?? 1), 0.5);
  const sum = gainNode(c, 1 / Math.sqrt(freqs.length * nv));
  sum.connect(biquad(c, 'highpass', 60, 0.7)).connect(lp).connect(biquad(c, 'peaking', 380, 1, 2)).connect(amp);
  if (o.tremolo) {
    const tr = gainNode(c, 0.75);
    const lfo = oscSrc(c, 'triangle', rand(k.rnd, 10, 12.5), t, end - t);
    lfo.connect(gainNode(c, 0.25)).connect(tr.gain);
    amp.connect(tr).connect(out);
  } else amp.connect(out);
  const vib = oscSrc(c, 'sine', rand(k.rnd, 4.6, 5.4), t, end - t);
  const vg = gainNode(c, 7);
  vib.connect(vg);
  freqs.forEach((f, i) => {
    for (let v = 0; v < nv; v++) {
      const det = nv === 1 ? 0 : (v / (nv - 1) - 0.5) * 18 + rand(k.rnd, -2, 2);
      const os = oscSrc(c, 'sawtooth', f, t, end - t);
      os.detune.value = det;
      vg.connect(os.detune);
      const pan = nv === 1 ? 0 : (v / (nv - 1) - 0.5) * 1.1 + (i % 2 ? 0.1 : -0.1);
      os.connect(panner(c, pan)).connect(sum);
    }
  });
}

function swellGain(c: BaseAudioContext, t: number, gain: number, dur: number, rel: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain * 0.35, t + 0.15);
  g.gain.linearRampToValueAtTime(gain, t + dur);
  g.gain.setTargetAtTime(0, t + dur, Math.max(0.02, rel / 4));
  return g;
}

/** 跳弓短音（大提琴／低音提琴頑固音型）：雙鋸齒＋低八度、濾波包絡、弓擦噪聲 */
export function spiccato(k: Kit, out: AudioNode, t: number, f: number, gain: number, len = 0.16, pan = 0): void {
  const c = k.ctx;
  const lp = biquad(c, 'lowpass', 0, 0.9);
  lp.frequency.setValueAtTime(Math.min(4200, f * 9), t);
  lp.frequency.setTargetAtTime(Math.max(180, f * 2.4), t + 0.005, 0.045);
  const amp = adGain(c, t, 0.004, gain, len);
  const sum = gainNode(c, 0.45);
  sum.connect(lp).connect(amp).connect(panner(c, pan)).connect(out);
  for (const [mul, det, lvl] of [
    [1, -7, 1],
    [1, 7, 1],
    [0.5, 0, 0.7],
  ] as const) {
    const os = oscSrc(c, 'sawtooth', f * mul, t, len + 0.1);
    os.detune.value = det;
    os.connect(gainNode(c, lvl)).connect(sum);
  }
  noiseSrc(k, k.white, t, 0.04)
    .connect(biquad(c, 'bandpass', Math.min(6000, f * 12), 1.5))
    .connect(adGain(c, t, 0.002, gain * 0.25, 0.03))
    .connect(out);
}

// ─────────────────────────────────────────── 銅管

export interface BrassOpts {
  attack?: number;
  release?: number;
  bright?: number;
  /** 削波強度（越大越粗獷） */
  drive?: number;
  swell?: boolean;
}

/** 銅管群和弦：每音雙鋸齒微失諧 → 削波 → 隨起音開啟的低通（銅管張口感） */
export function brass(k: Kit, out: AudioNode, t: number, freqs: number[], dur: number, gain: number, o: BrassOpts = {}): void {
  const c = k.ctx;
  const att = o.attack ?? 0.12;
  const rel = o.release ?? 0.4;
  const br = o.bright ?? 1;
  const end = t + dur + rel + 0.3;
  const f0 = Math.min(...freqs);
  const lp = biquad(c, 'lowpass', f0 * 1.5, 1.2);
  const lf = lp.frequency;
  lf.setValueAtTime(f0 * 1.5, t);
  lf.linearRampToValueAtTime(Math.min(8000, f0 * 9 * br), t + att + (o.swell ? dur * 0.9 : 0.02));
  lf.setTargetAtTime(Math.min(6000, f0 * 5 * br), t + att + (o.swell ? dur * 0.9 : 0.05), 0.3);
  lf.setTargetAtTime(f0 * 1.5, t + dur, rel / 3);
  const amp = o.swell ? swellGain(c, t, gain, dur, rel) : asrGain(c, t, att, gain, dur, rel);
  const sum = gainNode(c, 0.5 / Math.sqrt(freqs.length));
  sum.connect(shaper(c, o.drive ?? 1.8)).connect(lp).connect(amp).connect(out);
  freqs.forEach((f, i) => {
    for (const det of [-6, 6]) {
      const os = oscSrc(c, 'sawtooth', f * 0.985, t, end - t);
      os.frequency.exponentialRampToValueAtTime(f, t + Math.min(0.08, att));
      os.detune.value = det + rand(k.rnd, -2, 2);
      os.connect(panner(c, (det > 0 ? 0.25 : -0.25) + (i % 2 ? 0.1 : -0.1))).connect(sum);
    }
  });
}

/** 電影式重擊銅管（braam）：根音＋五度＋八度＋低八度，大量削波、亮度瞬間打開 */
export function braam(k: Kit, out: AudioNode, t: number, f: number, dur: number, gain: number): void {
  brass(k, out, t, [f * 0.5, f, f * 1.5, f * 2], dur, gain, { attack: 0.06, release: 1.2, bright: 1.5, drive: 3.2 });
  subBass(k, out, t, f * 0.5, dur * 0.8, gain * 0.9);
}

// ─────────────────────────────────────────── 合唱

type Vowel = 'a' | 'o' | 'u';
const FORMANTS: Record<Vowel, Array<[number, number, number]>> = {
  a: [
    [720, 1, 6],
    [1180, 0.6, 8],
    [2650, 0.28, 10],
  ],
  o: [
    [460, 1, 6],
    [820, 0.6, 8],
    [2750, 0.2, 10],
  ],
  u: [
    [340, 1, 6],
    [720, 0.4, 8],
    [2500, 0.12, 10],
  ],
};

/** 合唱長音：每音三支鋸齒（獨立微失諧＋共用顫音）→ 並聯共振峰（母音）→ 氣聲 */
export function choir(k: Kit, out: AudioNode, t: number, freqs: number[], dur: number, gain: number, vowel: Vowel = 'a', attack = 0.7): void {
  const c = k.ctx;
  const end = t + dur + 1.6;
  const amp = asrGain(c, t, attack, gain, dur, 1.1);
  const fo = gainNode(c, 1);
  fo.connect(biquad(c, 'lowpass', 3800, 0.6)).connect(amp).connect(out);
  const src = gainNode(c, 1 / Math.sqrt(freqs.length * 3));
  for (const [ff, a, q] of FORMANTS[vowel]) src.connect(biquad(c, 'bandpass', ff, q)).connect(gainNode(c, a * 3.2)).connect(fo);
  const vib = oscSrc(c, 'sine', rand(k.rnd, 4.8, 5.6), t, end - t);
  const vg = gainNode(c, 0);
  vg.gain.setValueAtTime(0, t);
  vg.gain.linearRampToValueAtTime(16, t + Math.min(1.2, dur));
  vib.connect(vg);
  freqs.forEach((f, i) => {
    for (let v = 0; v < 3; v++) {
      const os = oscSrc(c, 'sawtooth', f, t, end - t);
      os.detune.value = (v - 1) * 11 + rand(k.rnd, -3, 3);
      vg.connect(os.detune);
      os.connect(panner(c, (v - 1) * 0.55 + (i % 2 ? 0.08 : -0.08))).connect(src);
    }
  });
  noiseSrc(k, k.pink, t, end - t)
    .connect(biquad(c, 'bandpass', FORMANTS[vowel][1][0] * 1.4, 1.2))
    .connect(gainNode(c, 0.05))
    .connect(fo);
}

// ─────────────────────────────────────────── 打擊

export type TaikoSize = 'o' | 'm' | 's';

/** 太鼓：o＝大太鼓（多人齊擊＋次低頻）、m＝長胴太鼓、s＝締太鼓（高、短、脆） */
export function taiko(k: Kit, out: AudioNode, t: number, size: TaikoSize, gain: number): void {
  const c = k.ctx;
  const r = k.rnd;
  if (size === 'o') {
    for (let i = 0; i < 3; i++) {
      const p = panner(c, (i - 1) * 0.35);
      p.connect(out);
      drumHit(k, p, t + (i === 0 ? 0 : r() * 0.012), { f: 44 * rand(r, 0.95, 1.05), gain: gain * 0.62, decay: 1.5, drop: 2.3, thump: 1.1, skin: 0.22, lite: i > 0 });
    }
    // 次低頻：胸口的壓迫感
    const sb = oscSrc(c, 'sine', 62, t, 1.3);
    sb.frequency.exponentialRampToValueAtTime(34, t + 0.6);
    sb.connect(adGain(c, t, 0.004, gain * 0.55, 1.1)).connect(out);
  } else if (size === 'm') {
    const p = panner(c, rand(r, -0.3, 0.3));
    p.connect(out);
    drumHit(k, p, t, { f: 76 * rand(r, 0.96, 1.04), gain, decay: 0.75, drop: 2.2, thump: 0.8, skin: 0.4 });
  } else {
    const p = panner(c, rand(r, -0.4, 0.4));
    p.connect(out);
    drumHit(k, p, t, { f: 210 * rand(r, 0.97, 1.03), gain, decay: 0.16, drop: 1.6, skin: 0.9, lite: true });
  }
}

/** 鈸 */
export function crash(k: Kit, out: AudioNode, t: number, gain: number): void {
  cymbal(k, out, t, gain, 2.2);
}

/** 低音大鑼 */
export function bigGong(k: Kit, out: AudioNode, t: number, gain: number): void {
  gongHit(k, out, t, 98, gain, 6, -0.05);
}

/** 電影式衝擊：次低頻下墜＋悶爆＋群鼓＋鈸＋鑼 */
export function impact(k: Kit, out: AudioNode, t: number, gain: number): void {
  const c = k.ctx;
  const sb = oscSrc(c, 'sine', 90, t, 2.8);
  sb.frequency.exponentialRampToValueAtTime(28, t + 1.8);
  sb.connect(adGain(c, t, 0.003, gain * 0.9, 2.4)).connect(out);
  noiseSrc(k, k.brown, t, 1.4)
    .connect(biquad(c, 'lowpass', 260, 0.7))
    .connect(adGain(c, t, 0.002, gain * 0.9, 1))
    .connect(out);
  taiko(k, out, t, 'o', gain * 0.8);
  crash(k, out, t, gain * 0.45);
  bigGong(k, out, t + 0.01, gain * 0.35);
}

/** 上升音效（段落轉換前的漸強）：噪聲掃頻＋上滑鋸齒，於 t＋dur 戛然而止 */
export function riser(k: Kit, out: AudioNode, t: number, dur: number, gain: number): void {
  const c = k.ctx;
  const bp = biquad(c, 'bandpass', 300, 1.1);
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(7500, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
  noiseSrc(k, k.white, t, dur + 0.05).connect(bp).connect(g).connect(out);
  const os = oscSrc(c, 'sawtooth', 110, t, dur + 0.05);
  os.frequency.exponentialRampToValueAtTime(880, t + dur);
  const lp = biquad(c, 'lowpass', 400, 1);
  lp.frequency.exponentialRampToValueAtTime(5000, t + dur);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(gain * 0.35, t + dur);
  g2.gain.linearRampToValueAtTime(0, t + dur + 0.03);
  os.connect(lp).connect(g2).connect(out);
}

/** 低音（正弦＋少量三角波，輕微飽和） */
export function subBass(k: Kit, out: AudioNode, t: number, f: number, dur: number, gain: number): void {
  const c = k.ctx;
  const amp = asrGain(c, t, 0.03, gain, dur, 0.4);
  const sum = gainNode(c, 1);
  sum.connect(shaper(c, 1.3)).connect(amp).connect(out);
  oscSrc(c, 'sine', f, t, dur + 0.6).connect(sum);
  oscSrc(c, 'triangle', f, t, dur + 0.6).connect(gainNode(c, 0.25)).connect(sum);
}

// ─────────────────────────────────────────── 旋律線（單音、連奏滑音）

export type LeadKind = 'suona' | 'erhu' | 'dizi' | 'horns';

export interface LineNote {
  t: number;
  dur: number;
  f: number;
  /** 倚音頻率（由上方裝飾進入） */
  grace?: number;
  gain?: number;
}

interface LeadSpec {
  /** [波形, 頻率倍率, 音量, 音分偏移] */
  osc: Array<['sawtooth' | 'square' | 'dizi', number, number, number]>;
  drive: number;
  filters: Array<[BiquadFilterType, number, number, number]>;
  vibHz: number;
  vibCents: number;
  glide: number; // 滑音時間常數
  scoop: number; // 樂句起音由下滑入的音分
  attack: number;
  release: number;
  breath: number;
  /** 號角：每音濾波包絡 */
  brassEnv?: boolean;
}

const LEADS: Record<LeadKind, LeadSpec> = {
  // 嗩吶：明亮鼻音、聲量大、滑音明顯
  suona: {
    osc: [
      ['sawtooth', 1, 1, 0],
      ['square', 1, 0.45, 4],
    ],
    drive: 2.4,
    filters: [
      ['highpass', 420, 0.7, 0],
      ['peaking', 1350, 1.2, 9],
      ['peaking', 3100, 2, 6],
      ['lowpass', 6500, 0.7, 0],
    ],
    vibHz: 5.8,
    vibCents: 24,
    glide: 0.03,
    scoop: -90,
    attack: 0.03,
    release: 0.18,
    breath: 0.05,
  },
  // 二胡：柔中帶鼻音、大滑音
  erhu: {
    osc: [['sawtooth', 1, 1, 0]],
    drive: 1.2,
    filters: [
      ['highpass', 280, 0.7, 0],
      ['peaking', 1000, 1.8, 7],
      ['peaking', 2600, 2.5, 4],
      ['lowpass', 4200, 0.7, 0],
    ],
    vibHz: 6.2,
    vibCents: 26,
    glide: 0.06,
    scoop: -60,
    attack: 0.09,
    release: 0.3,
    breath: 0.03,
  },
  // 笛子：清亮、氣聲
  dizi: {
    osc: [['dizi', 1, 1, 0]],
    drive: 1,
    filters: [
      ['peaking', 2600, 1.4, 4],
      ['lowpass', 9000, 0.7, 0],
    ],
    vibHz: 5.4,
    vibCents: 18,
    glide: 0.018,
    scoop: -40,
    attack: 0.04,
    release: 0.15,
    breath: 0.1,
  },
  // 號角群（法國號／長號齊奏）
  horns: {
    osc: [
      ['sawtooth', 1, 0.7, -7],
      ['sawtooth', 1, 0.7, 7],
      ['sawtooth', 0.5, 0.35, 0],
    ],
    drive: 1.7,
    filters: [['highpass', 70, 0.7, 0]],
    vibHz: 4.8,
    vibCents: 9,
    glide: 0.04,
    scoop: -50,
    attack: 0.08,
    release: 0.35,
    breath: 0.02,
    brassEnv: true,
  },
};

/** 旋律線：整句共用同一組振盪器，音與音之間連奏滑音、樂句間斷開；自動顫音、倚音、氣聲 */
export function line(k: Kit, out: AudioNode, notes: LineNote[], kind: LeadKind, gain: number, pan = 0): void {
  if (notes.length === 0) return;
  const c = k.ctx;
  const sp = LEADS[kind];
  const t0 = notes[0].t;
  const last = notes[notes.length - 1];
  const tEnd = last.t + last.dur + sp.release + 0.4;
  const span = tEnd - t0 + 0.1;
  const amp = c.createGain();
  amp.gain.value = 0;
  let node: AudioNode = shaper(c, sp.drive);
  const head = node;
  let lp: BiquadFilterNode | null = null;
  for (const [type, f, q, g] of sp.filters) {
    const b = biquad(c, type, f, q, g);
    node.connect(b);
    node = b;
  }
  if (sp.brassEnv) {
    lp = biquad(c, 'lowpass', 800, 1.1);
    node.connect(lp);
    node = lp;
  }
  node.connect(amp).connect(panner(c, pan)).connect(out);
  const mix = gainNode(c, 0.5);
  mix.connect(head);
  // 顫音（音分）
  const vib = oscSrc(c, 'sine', sp.vibHz * rand(k.rnd, 0.95, 1.05), t0, span);
  const vg = c.createGain();
  vg.gain.value = 0;
  vib.connect(vg);
  const oscs: OscillatorNode[] = [];
  for (const [type, , lvl, det] of sp.osc) {
    const o = c.createOscillator();
    if (type === 'dizi') o.setPeriodicWave(periodic(c, 'dizi', [0, 1, 0.42, 0.16, 0.09, 0.05, 0.03, 0.02]));
    else o.type = type;
    o.detune.value = det;
    vg.connect(o.detune);
    o.start(t0);
    o.stop(t0 + span);
    o.connect(gainNode(c, lvl)).connect(mix);
    oscs.push(o);
  }
  // 氣聲（跟著音量包絡）
  const breathBp = biquad(c, 'bandpass', 2400, 1);
  noiseSrc(k, k.white, t0, span).connect(breathBp).connect(gainNode(c, sp.breath)).connect(amp);
  const mulOf = sp.osc.map((o) => o[1]);
  const setF = (f: number, at: number, tau: number, jump = false) => {
    oscs.forEach((o, i) => {
      if (jump) o.frequency.setValueAtTime(f * mulOf[i], at);
      else o.frequency.setTargetAtTime(f * mulOf[i], at, tau);
    });
  };
  const A = amp.gain;
  const V = vg.gain;
  let prevEnd = -1;
  let prevPeak = 0;
  notes.forEach((n, i) => {
    const pk = gain * (n.gain ?? 1);
    const legato = prevEnd > 0 && n.t - prevEnd < 0.03;
    // 音高
    if (!legato) {
      setF(n.f * cents(sp.scoop), n.t, 0, true);
      setF(n.f, n.t, 0.035);
    } else if (n.grace) {
      setF(n.grace, n.t, 0.012);
      setF(n.f, n.t + 0.06, 0.015);
    } else setF(n.f, n.t, sp.glide);
    if (n.grace && !legato) {
      setF(n.grace, n.t, 0, true);
      setF(n.f, n.t + 0.06, 0.015);
    }
    breathBp.frequency.setValueAtTime(Math.min(8000, n.f * 2.2), n.t);
    // 音量
    if (!legato) {
      A.setValueAtTime(0, n.t);
      A.linearRampToValueAtTime(pk, n.t + sp.attack);
    } else {
      A.setValueAtTime(prevPeak, Math.max(n.t - 0.02, 0));
      A.linearRampToValueAtTime(prevPeak * 0.72, n.t);
      A.linearRampToValueAtTime(pk, n.t + 0.05);
    }
    // 長音微漸強
    if (n.dur > 0.6) A.linearRampToValueAtTime(pk * 1.12, n.t + n.dur * 0.85);
    const next = notes[i + 1];
    const end = n.t + n.dur;
    const held = n.dur > 0.6 ? pk * 1.12 : pk;
    if (!next || next.t - end >= 0.03) {
      A.setValueAtTime(held, end - 0.01);
      A.setTargetAtTime(0, end - 0.01, sp.release / 3);
    }
    // 顫音：長音才加，延遲淡入
    V.setValueAtTime(0, n.t);
    if (n.dur > 0.25) V.linearRampToValueAtTime(sp.vibCents, n.t + Math.min(0.45, n.dur * 0.7));
    // 號角：每音起音較亮
    if (lp) {
      lp.frequency.setValueAtTime(Math.min(7000, n.f * (legato ? 4 : 2)), n.t);
      lp.frequency.setTargetAtTime(Math.min(7000, n.f * 7), n.t, 0.04);
      lp.frequency.setTargetAtTime(Math.min(5000, n.f * 3.6), n.t + 0.15, 0.3);
    }
    prevEnd = end;
    prevPeak = held;
  });
}
