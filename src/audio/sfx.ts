// 音效配方：每個 SfxId 一個合成配方＋節流規格；另有環境層用的細節事件配方（馬蹄、腳步、甲片、火星、喊聲）
// 配方簽名：(kit, out, t, rate) → 聲音長度（秒）。rate 只影響音高類參數。

import type { SfxId } from './types';
import {
  bell,
  bowed,
  crackle,
  crowdVoices,
  drumEnsemble,
  drumHit,
  flute,
  gongHit,
  hornNote,
  metalHit,
  pluck,
  sweep,
  thud,
  woodblock,
} from './instruments';
import { type Kit, adGain, asrGain, biquad, gainNode, mtof, noiseSrc, oscSrc, panner, rand, shaper } from './synth';

export type Recipe = (k: Kit, out: AudioNode, t: number, rate: number) => number;

export interface SfxSpec {
  gap: number; // 同種音效最短間隔（秒）
  max: number; // 同時最多幾個
  vol: number; // 基礎音量
  wet: number; // 殘響送出量
  minor?: boolean; // 繁忙時可丟棄
  bank?: number; // 預渲染變體數（頻繁觸發的音效）
  len?: number; // 預渲染長度（秒）
  stereo?: boolean; // 預渲染成立體聲
}

export const SFX_SPEC: Record<SfxId, SfxSpec> = {
  drum_start: { gap: 1.5, max: 1, vol: 0.6, wet: 0.35 },
  drum_boost: { gap: 0.8, max: 2, vol: 0.63, wet: 0.35 },
  horn_charge: { gap: 0.8, max: 2, vol: 0.75, wet: 0.45 },
  horn_retreat: { gap: 0.8, max: 2, vol: 1.25, wet: 0.45 },
  gong: { gap: 0.8, max: 1, vol: 1.2, wet: 0.4 },
  clash: { gap: 0.025, max: 8, vol: 1.3, wet: 0.2, minor: true, bank: 10, len: 0.8 },
  arrow_volley: { gap: 0.12, max: 4, vol: 1.3, wet: 0.3, bank: 4, len: 2.6, stereo: true },
  arrow_hit: { gap: 0.03, max: 8, vol: 0.95, wet: 0.15, minor: true, bank: 6, len: 0.35 },
  shield_hit: { gap: 0.03, max: 6, vol: 1.5, wet: 0.15, minor: true, bank: 6, len: 0.5 },
  charge_impact: { gap: 0.15, max: 3, vol: 0.88, wet: 0.3 },
  death: { gap: 0.05, max: 6, vol: 0.48, wet: 0.12, minor: true, bank: 8, len: 0.45 },
  war_cry: { gap: 0.35, max: 3, vol: 0.8, wet: 0.35 },
  fire_ignite: { gap: 0.1, max: 4, vol: 1.25, wet: 0.2 },
  depot_burnt: { gap: 1.0, max: 2, vol: 0.76, wet: 0.35 },
  rout: { gap: 0.6, max: 2, vol: 0.75, wet: 0.3 },
  general_down: { gap: 1.0, max: 1, vol: 0.8, wet: 0.45 },
  stratagem: { gap: 0.3, max: 2, vol: 1.18, wet: 0.4 },
  ui_click: { gap: 0.03, max: 4, vol: 0.77, wet: 0.04 },
  ui_select: { gap: 0.04, max: 4, vol: 1.25, wet: 0.08 },
  ui_order: { gap: 0.05, max: 3, vol: 0.55, wet: 0.1 },
  ui_card: { gap: 0.05, max: 3, vol: 1.25, wet: 0.08 },
  ui_error: { gap: 0.15, max: 2, vol: 0.58, wet: 0.04 },
  victory_sting: { gap: 2, max: 1, vol: 0.65, wet: 0.4 },
  defeat_sting: { gap: 2, max: 1, vol: 0.87, wet: 0.45 },
  star: { gap: 0.08, max: 3, vol: 1.05, wet: 0.3 },
};

// ─────────────────────────────────────────── 共用小配方

/** 弓弦放箭：短促低音撥弦＋弦打護臂的「啪」 */
function bowTwang(k: Kit, out: AudioNode, t: number, gain: number): void {
  const c = k.ctx;
  pluck(k, out, t, rand(k.rnd, 95, 150), gain, 'bow');
  noiseSrc(k, k.white, t, 0.05)
    .connect(biquad(c, 'bandpass', rand(k.rnd, 500, 800), 1.5))
    .connect(adGain(c, t, 0.001, gain * 0.5, 0.04))
    .connect(out);
}

/** 單支箭飛過的「咻」：高 Q 帶通噪聲先升後降（都卜勒）＋聲像移動 */
function arrowWhoosh(k: Kit, out: AudioNode, t: number, gain: number): void {
  const c = k.ctx;
  const r = k.rnd;
  const dur = rand(r, 0.3, 0.7);
  const f = rand(r, 1600, 4200);
  const p = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
  const dst: AudioNode = p ?? out;
  if (p) {
    const a = rand(r, -0.9, 0.9);
    p.pan.setValueAtTime(a, t);
    p.pan.linearRampToValueAtTime(-a * 0.6, t + dur);
    p.connect(out);
  }
  sweep(k, dst, t, dur, gain, f * 0.6, f * 1.25, f * 0.55, rand(r, 6, 12));
}

/** 人聲悶哼（倒地、受傷） */
function grunt(k: Kit, out: AudioNode, t: number, gain: number): void {
  const c = k.ctx;
  const f0 = rand(k.rnd, 105, 175);
  const o = oscSrc(c, 'sawtooth', f0 * 1.15, t, 0.3);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.75, t + 0.2);
  const g = adGain(c, t, 0.012, gain, 0.18);
  const sum = gainNode(c, 1);
  o.connect(g).connect(sum);
  sum.connect(biquad(c, 'bandpass', rand(k.rnd, 550, 700), 5)).connect(gainNode(c, 2.2)).connect(out);
  sum.connect(biquad(c, 'bandpass', rand(k.rnd, 950, 1200), 6)).connect(gainNode(c, 1.2)).connect(out);
}

// ─────────────────────────────────────────── 音效配方

export const SFX: Record<SfxId, Recipe> = {
  // 開戰戰鼓：加速滾奏（兩面鼓交替、多名鼓手）→ 兩記重擊 → 終擊
  drum_start(k, out, t) {
    const bus = shaper(k.ctx, 1.4);
    bus.connect(out);
    let tt = t;
    let gap = 0.32;
    let i = 0;
    while (tt < t + 2.35) {
      const prog = (tt - t) / 2.35;
      drumEnsemble(k, bus, tt, { f: i % 2 ? 62 : 71, gain: 0.28 + prog * 0.5, decay: 0.55 + (1 - prog) * 0.4, lite: prog > 0.5 }, 2);
      tt += gap;
      gap = Math.max(0.055, gap * 0.86);
      i++;
    }
    drumEnsemble(k, bus, t + 2.55, { f: 49, gain: 1.0, decay: 1.4 }, 4);
    drumEnsemble(k, bus, t + 3.05, { f: 44, gain: 1.15, decay: 2.3 }, 5);
    noiseSrc(k, k.brown, t + 3.05, 2)
      .connect(biquad(k.ctx, 'lowpass', 90, 0.7))
      .connect(adGain(k.ctx, t + 3.05, 0.01, 0.5, 1.8))
      .connect(out);
    return 5.5;
  },

  // 擂鼓助威：咚 · 咚 · 咚咚咚 — 咚！×2，最後全軍一聲「喝！」
  drum_boost(k, out, t) {
    const bus = shaper(k.ctx, 1.4);
    bus.connect(out);
    const pat: Array<[number, number, number]> = [
      [0, 0.6, 0.6], [0.28, 0.6, 0.6], [0.56, 0.5, 0.45], [0.7, 0.55, 0.45], [0.84, 0.6, 0.5], [1.12, 0.95, 1.1],
      [1.5, 0.6, 0.5], [1.64, 0.6, 0.45], [1.78, 0.65, 0.5], [2.0, 1.0, 1.6],
    ];
    for (const [dt, g, d] of pat) drumEnsemble(k, bus, t + dt, { f: g > 0.9 ? 50 : 64, gain: g, decay: d }, 3);
    crowdVoices(k, out, t + 2.02, { n: 12, dur: 0.55, f0: [120, 220], gain: 0.5, vowel: 'o', stagger: 0.06, glide: 0.85 });
    return 3.4;
  },

  // 衝鋒號角：低沉長音 → 上揚五度並漸強（三支號角疊合）
  horn_charge(k, out, t) {
    const r = k.rnd;
    const f = 110;
    for (let i = 0; i < 3; i++) {
      const o = t + r() * 0.06;
      const det = 1 + (i - 1) * 0.006;
      hornNote(k, out, o, f * det, 1.05, 0.32, { glide: 0.84 });
      hornNote(k, out, o + 1.25, f * 1.5 * det, 1.6, 0.36, { glide: 0.9, attack: 0.25, bright: 1.15, vib: 5 });
    }
    return 3.4;
  },

  // 撤退號：三個下行長音，越吹越弱，尾音下墜
  horn_retreat(k, out, t) {
    const r = k.rnd;
    const notes: Array<[number, number, number, number]> = [
      [0, 146.8, 0.9, 0.32],
      [1.05, 123.5, 0.9, 0.28],
      [2.15, 98, 1.5, 0.26],
    ];
    for (let i = 0; i < 2; i++) {
      const det = 1 + (i ? 0.005 : -0.004);
      const o = r() * 0.05;
      for (const [dt, f, d, g] of notes) hornNote(k, out, t + dt + o, f * det, d, g, { attack: 0.3, glide: 0.93, bright: 0.85, release: 0.6 });
    }
    return 4.4;
  },

  // 鳴金：銅鑼連敲三下
  gong(k, out, t) {
    gongHit(k, out, t, 200, 0.9, 3.2);
    gongHit(k, out, t + 0.6, 205, 0.8, 3.0);
    gongHit(k, out, t + 1.2, 198, 0.95, 3.8);
    return 5.2;
  },

  // 兵刃交擊：兩把兵器各自的不和諧金屬泛音＋高通瞬態＋手臂悶擊，部分變體帶刀刃滑擦
  clash(k, out, t, rate) {
    const c = k.ctx;
    const r = k.rnd;
    const base = rand(r, 1100, 1650) * rate;
    metalHit(k, out, t, base, 0.55, rand(r, 0.25, 0.5), 7);
    if (r() < 0.75) metalHit(k, out, t + rand(r, 0.003, 0.012), base * rand(r, 1.3, 1.8), 0.3, rand(r, 0.12, 0.3), 5);
    noiseSrc(k, k.brown, t, 0.1)
      .connect(biquad(c, 'lowpass', 400, 0.7))
      .connect(adGain(c, t, 0.001, 0.35, 0.06))
      .connect(out);
    if (r() < 0.4) sweep(k, out, t + 0.01, rand(r, 0.08, 0.16), 0.12, 3000 * rate, 6000 * rate, 4500 * rate, 4);
    return 0.7;
  },

  // 箭雨：十幾聲弓弦（錯開、散在立體聲場）→ 一群「咻」＋整片嘶嘶聲
  arrow_volley(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    for (let i = 0; i < 14; i++) {
      const p = panner(c, rand(r, -0.7, 0.7));
      p.connect(out);
      bowTwang(k, p, t + Math.pow(r(), 1.5) * 0.35, rand(r, 0.4, 0.7));
    }
    for (let i = 0; i < 18; i++) arrowWhoosh(k, out, t + 0.12 + r() * 0.9, rand(r, 0.25, 0.5));
    const hiss = c.createGain();
    hiss.gain.setValueAtTime(0, t);
    hiss.gain.linearRampToValueAtTime(0.35, t + 0.6);
    hiss.gain.linearRampToValueAtTime(0, t + 1.9);
    noiseSrc(k, k.white, t, 2)
      .connect(biquad(c, 'highpass', 1500, 0.7))
      .connect(biquad(c, 'bandpass', 4200, 0.7))
      .connect(hiss)
      .connect(out);
    return 2.4;
  },

  // 箭落地／命中：低通悶擊＋箭桿「篤」
  arrow_hit(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    noiseSrc(k, k.brown, t, 0.15)
      .connect(biquad(c, 'lowpass', rand(r, 500, 900), 0.8))
      .connect(adGain(c, t, 0.001, 0.7, 0.09))
      .connect(out);
    noiseSrc(k, k.white, t, 0.05)
      .connect(biquad(c, 'bandpass', rand(r, 1800, 2600), 3))
      .connect(adGain(c, t, 0.0005, 0.25, 0.025))
      .connect(out);
    thud(k, out, t, rand(r, 60, 90), 0.4, 0.08);
    if (r() < 0.5) {
      noiseSrc(k, k.white, t + 0.01, 0.15)
        .connect(biquad(c, 'lowpass', 3000, 0.7))
        .connect(adGain(c, t + 0.01, 0.002, 0.08, 0.12))
        .connect(out);
    }
    return 0.3;
  },

  // 箭中木盾：木板模態（短噪聲激發高 Q 帶通）＋箭桿顫動，部分變體擊中金屬盾釘
  shield_hit(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    const ex = noiseSrc(k, k.white, t, 0.01);
    const exG = adGain(c, t, 0.0003, 1, 0.006);
    ex.connect(exG);
    for (const [f, q, g] of [[320, 18, 2.4], [610, 22, 1.8], [980, 25, 1.2], [1450, 20, 0.8]] as const) {
      exG.connect(biquad(c, 'bandpass', f * rand(r, 0.88, 1.12), q)).connect(gainNode(c, g)).connect(out);
    }
    thud(k, out, t, rand(r, 120, 160), 0.3, 0.07);
    // 箭桿插在盾上的顫動「嗡」
    const vib = oscSrc(c, 'triangle', rand(r, 220, 300), t + 0.01, 0.35);
    const am = c.createGain();
    am.gain.value = 0;
    const lfo = oscSrc(c, 'sine', rand(r, 22, 30), t + 0.01, 0.35);
    lfo.connect(am.gain);
    vib.connect(am).connect(adGain(c, t + 0.01, 0.005, 0.06, 0.25)).connect(out);
    if (r() < 0.3) metalHit(k, out, t, rand(r, 2300, 3000), 0.15, 0.12, 4);
    return 0.45;
  },

  // 騎兵衝撞：低頻轟擊＋碎裂＋長槍折斷＋數聲金屬＋戰馬嘶鳴＋人聲驚呼＋倒地
  charge_impact(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    const boom = oscSrc(c, 'sine', 120, t, 0.9);
    boom.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    boom.connect(adGain(c, t, 0.002, 1.0, 0.7)).connect(out);
    noiseSrc(k, k.brown, t, 0.7)
      .connect(biquad(c, 'lowpass', 260, 0.7))
      .connect(adGain(c, t, 0.003, 0.9, 0.5))
      .connect(out);
    noiseSrc(k, k.white, t, 0.6)
      .connect(biquad(c, 'lowpass', 2500, 0.7))
      .connect(biquad(c, 'peaking', 800, 1, 6))
      .connect(adGain(c, t, 0.005, 0.45, 0.35))
      .connect(out);
    // 長槍折斷的木裂聲
    for (let i = 0; i < 6; i++) {
      const tt = t + r() * 0.28;
      noiseSrc(k, k.white, tt, 0.05)
        .connect(biquad(c, 'bandpass', rand(r, 1400, 3000), 2))
        .connect(adGain(c, tt, 0.0005, rand(r, 0.2, 0.4), 0.025))
        .connect(out);
    }
    for (let i = 0; i < 4; i++) metalHit(k, out, t + 0.03 + r() * 0.4, rand(r, 1000, 1700), rand(r, 0.2, 0.35), rand(r, 0.2, 0.4), 6);
    // 戰馬嘶鳴：高音鋸齒＋快速顫音、下滑
    for (let i = 0; i < 2; i++) {
      const tt = t + 0.08 + i * rand(r, 0.15, 0.3);
      const f = rand(r, 750, 950);
      const h = oscSrc(c, 'sawtooth', f, tt, 0.9);
      h.frequency.linearRampToValueAtTime(f * 1.12, tt + 0.12);
      h.frequency.exponentialRampToValueAtTime(f * 0.55, tt + 0.75);
      const lfo = oscSrc(c, 'sine', rand(r, 11, 15), tt, 0.9);
      const lg = gainNode(c, f * 0.06);
      lfo.connect(lg).connect(h.frequency);
      const sum = gainNode(c, 1);
      h.connect(asrGain(c, tt, 0.04, 0.09, 0.45, 0.3)).connect(sum);
      sum.connect(biquad(c, 'bandpass', 1150, 3)).connect(gainNode(c, 2)).connect(out);
      sum.connect(biquad(c, 'bandpass', 2400, 4)).connect(gainNode(c, 1.2)).connect(out);
    }
    crowdVoices(k, out, t + 0.12, { n: 6, dur: 0.6, f0: [150, 260], gain: 0.28, vowel: 'a', stagger: 0.2, glide: 0.7 });
    for (let i = 0; i < 4; i++) thud(k, out, t + 0.3 + r() * 0.7, rand(r, 50, 80), rand(r, 0.3, 0.5), 0.15);
    return 1.9;
  },

  // 倒地：身體落地悶擊＋（多半）一聲悶哼＋（偶爾）甲片輕響；音量刻意小
  death(k, out, t) {
    const r = k.rnd;
    const tf = t + rand(r, 0.05, 0.15);
    thud(k, out, tf, rand(r, 55, 80), 0.5, 0.12);
    if (r() < 0.65) grunt(k, out, t, rand(r, 0.1, 0.16));
    if (r() < 0.35) metalHit(k, out, tf, rand(r, 2600, 3600), 0.05, 0.08, 4);
    return 0.4;
  },

  // 軍團吶喊：十幾人「喔啊——」由低衝上、抖動、收尾下滑
  war_cry(k, out, t) {
    crowdVoices(k, out, t, { n: 16, dur: 2.0, f0: [110, 230], gain: 0.7, vowel: 'a', stagger: 0.3, rise: 0.8, glide: 0.75, breath: 0.4 });
    crowdVoices(k, out, t + 0.05, { n: 6, dur: 1.6, f0: [90, 140], gain: 0.35, vowel: 'o', stagger: 0.3, glide: 0.8 });
    return 2.9;
  },

  // 點火：帶通掃頻的「呼」＋低頻火團＋幾顆火星
  fire_ignite(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    sweep(k, out, t, 1.0, 0.6, 250, 1800, 500, 1.2);
    noiseSrc(k, k.brown, t, 1.5)
      .connect(biquad(c, 'lowpass', 400, 0.7))
      .connect(asrGain(c, t, 0.2, 0.55, 0.5, 0.8))
      .connect(out);
    const fw = oscSrc(c, 'sine', 95, t, 0.5);
    fw.frequency.exponentialRampToValueAtTime(55, t + 0.35);
    fw.connect(adGain(c, t, 0.02, 0.3, 0.35)).connect(out);
    for (let i = 0; i < 9; i++) crackle(k, out, t + 0.2 + r() * 1.0, rand(r, 0.1, 0.35));
    return 1.6;
  },

  // 糧倉焚毀：爆燃轟擊＋大火怒吼＋大量火星 → 木樑呻吟 → 三次倒塌重擊＋碎塊落地
  depot_burnt(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    const boom = oscSrc(c, 'sine', 90, t, 2.2);
    boom.frequency.exponentialRampToValueAtTime(30, t + 0.6);
    boom.connect(adGain(c, t, 0.003, 1.0, 1.8)).connect(out);
    noiseSrc(k, k.brown, t, 2)
      .connect(biquad(c, 'lowpass', 300, 0.7))
      .connect(adGain(c, t, 0.01, 0.9, 1.5))
      .connect(out);
    // 大火怒吼（帶抖動）
    const roar = asrGain(c, t, 0.3, 0.45, 1.6, 1.8);
    const flutter = gainNode(c, 0.7);
    const lfo = oscSrc(c, 'sine', 7, t, 4);
    lfo.connect(gainNode(c, 0.3)).connect(flutter.gain);
    noiseSrc(k, k.white, t, 4)
      .connect(biquad(c, 'lowpass', 1200, 0.7))
      .connect(biquad(c, 'bandpass', 500, 0.5))
      .connect(flutter)
      .connect(roar)
      .connect(out);
    for (let i = 0; i < 40; i++) crackle(k, out, t + Math.pow(r(), 1.3) * 3.6, rand(r, 0.08, 0.4));
    // 木樑呻吟
    const creak = oscSrc(c, 'sawtooth', 140, t + 1.1, 0.8);
    creak.frequency.exponentialRampToValueAtTime(85, t + 1.75);
    creak.connect(biquad(c, 'bandpass', 600, 8)).connect(asrGain(c, t + 1.1, 0.1, 0.12, 0.45, 0.2)).connect(out);
    // 倒塌
    for (const dt of [1.4, 1.75, 2.2]) {
      drumHit(k, out, t + dt, { f: rand(r, 40, 55), gain: 0.7, decay: 0.9, skin: 0.1 });
      noiseSrc(k, k.white, t + dt, 0.4)
        .connect(biquad(c, 'bandpass', 900, 1.5))
        .connect(adGain(c, t + dt, 0.001, 0.4, 0.25))
        .connect(out);
    }
    for (let i = 0; i < 14; i++) thud(k, out, t + 2.2 + r() * 1.1, rand(r, 70, 160), rand(r, 0.1, 0.3), 0.08);
    return 4.6;
  },

  // 潰逃：數聲尖叫（音高下墜）＋雜亂奔逃腳步＋丟棄兵器
  rout(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    for (let i = 0; i < 6; i++) {
      crowdVoices(k, out, t + r() * 1.4, {
        n: 1, dur: rand(r, 0.5, 0.9), f0: [280, 420], gain: rand(r, 0.12, 0.2), vowel: 'a',
        stagger: 0, rise: 1.05, glide: 0.65, formant: 1.15, breath: 0.2, drive: 3,
      });
    }
    crowdVoices(k, out, t, { n: 8, dur: 1.8, f0: [160, 300], gain: 0.25, vowel: 'e', stagger: 0.5, glide: 0.6 });
    for (let i = 0; i < 30; i++) {
      const p = panner(c, rand(r, -0.9, 0.9));
      p.connect(out);
      thud(k, p, t + r() * 2.3, rand(r, 70, 110), rand(r, 0.1, 0.25), 0.05);
    }
    for (let i = 0; i < 3; i++) metalHit(k, out, t + 0.3 + r() * 1.5, rand(r, 900, 1400), 0.18, 0.3, 5);
    return 2.8;
  },

  // 武將陣亡：兩記心跳般的低沉鼓 → 不和諧低音群漸起 → 低沉大鑼
  general_down(k, out, t) {
    const c = k.ctx;
    drumHit(k, out, t, { f: 42, gain: 1.0, decay: 2.0, skin: 0.2 });
    drumHit(k, out, t + 0.85, { f: 40, gain: 0.9, decay: 2.4, skin: 0.2 });
    const lp = biquad(c, 'lowpass', 350, 1.2);
    lp.frequency.setValueAtTime(250, t + 0.5);
    lp.frequency.linearRampToValueAtTime(700, t + 2.5);
    lp.frequency.linearRampToValueAtTime(250, t + 4.5);
    lp.connect(asrGain(c, t + 0.5, 1.4, 0.22, 1.6, 1.8)).connect(out);
    for (const f of [55, 58.3, 77.8, 110.5]) oscSrc(c, 'sawtooth', f, t + 0.5, 4.6).connect(gainNode(c, 0.25)).connect(lp);
    gongHit(k, out, t + 1.8, 72, 0.5, 4.0, -0.02);
    return 5.8;
  },

  // 施放計策：五聲音階鈴聲急速上行＋上升風聲＋低頻湧起＋尾端古箏和弦
  stratagem(k, out, t) {
    const c = k.ctx;
    const r = k.rnd;
    const scale = [0, 2, 4, 7, 9];
    for (let i = 0; i < 9; i++) {
      const m = 74 + scale[i % 5] + 12 * Math.floor(i / 5);
      bell(k, out, t + i * 0.075, mtof(m), 0.22 + i * 0.015, 0.9);
    }
    const bp = biquad(c, 'bandpass', 300, 4);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(6000, t + 1.2);
    noiseSrc(k, k.white, t, 1.6).connect(bp).connect(asrGain(c, t, 0.9, 0.35, 0.3, 0.4)).connect(out);
    const sub = oscSrc(c, 'sine', 55, t, 2);
    sub.frequency.exponentialRampToValueAtTime(110, t + 1.1);
    sub.connect(asrGain(c, t, 0.8, 0.3, 0.4, 0.5)).connect(out);
    for (let i = 0; i < 6; i++) bell(k, out, t + 1.0 + r() * 0.8, mtof(pick5(r, 86)), 0.08, 0.6);
    for (const m of [62, 69, 74, 78]) pluck(k, out, t + 1.15 + (m - 62) * 0.004, mtof(m), 0.3, 'zheng');
    return 2.6;
  },

  // UI：木魚般的短「喀」
  ui_click(k, out, t, rate) {
    woodblock(k, out, t, 0.55, 1700 * rate);
    return 0.12;
  },

  // UI 選取：琵琶單音
  ui_select(k, out, t, rate) {
    pluck(k, out, t, 880 * rate, 0.5, 'pipa');
    woodblock(k, out, t, 0.12, 2200 * rate);
    return 0.8;
  },

  // UI 下令：小鼓「咚」＋小鑼「鏘」
  ui_order(k, out, t, rate) {
    drumHit(k, out, t, { f: 120 * rate, gain: 0.6, decay: 0.28, lite: true, skin: 0.5 });
    metalHit(k, out, t + 0.01, 2200 * rate, 0.15, 0.18, 5);
    return 0.45;
  },

  // UI 卡片：快速揮動的「咻」＋輕撥
  ui_card(k, out, t, rate) {
    sweep(k, out, t, 0.14, 0.4, 900, 4000, 2500, 1.5);
    pluck(k, out, t + 0.06, 659.3 * rate, 0.3, 'pipa');
    return 0.7;
  },

  // UI 錯誤：兩聲下行的悶「嗯嗯」
  ui_error(k, out, t, rate) {
    const c = k.ctx;
    for (const [dt, f] of [[0, 196], [0.12, 165]] as const) {
      oscSrc(c, 'square', f * rate, t + dt, 0.12)
        .connect(biquad(c, 'lowpass', 900, 1))
        .connect(asrGain(c, t + dt, 0.005, 0.22, 0.08, 0.03))
        .connect(out);
    }
    woodblock(k, out, t, 0.15, 600);
    return 0.35;
  },

  // 勝利：群鼓 → 古箏上行刮奏 → 號角和弦＋大鑼＋笛子高音
  victory_sting(k, out, t) {
    const bus = shaper(k.ctx, 1.3);
    bus.connect(out);
    for (const [dt, g] of [[0, 0.8], [0.35, 0.6], [0.55, 0.65], [0.75, 0.95]] as const) drumEnsemble(k, bus, t + dt, { f: 52, gain: g, decay: 0.9 }, 3);
    const scale = [0, 2, 4, 7, 9];
    for (let i = 0; i < 14; i++) {
      const m = 50 + scale[i % 5] + 12 * Math.floor(i / 5);
      pluck(k, out, t + 0.75 + i * 0.032, mtof(m), 0.22, 'zheng');
    }
    for (const f of [146.8, 220, 293.7]) hornNote(k, out, t + 0.8, f, 1.9, 0.18, { attack: 0.2, bright: 1.3, glide: 0.9 });
    gongHit(k, out, t + 0.8, 180, 0.6, 3.0);
    flute(k, out, t + 1.2, mtof(81), 1.6, 0.22, 1.2);
    return 4.2;
  },

  // 敗北：低沉鼓 → 二胡下行哀調 → 低鑼＋低音持續
  defeat_sting(k, out, t) {
    const c = k.ctx;
    drumHit(k, out, t, { f: 40, gain: 0.9, decay: 2.2, skin: 0.15 });
    const mel: Array<[number, number, number]> = [
      [0.3, 69, 0.6], [0.9, 67, 0.5], [1.4, 64, 0.6], [2.0, 62, 0.5], [2.5, 57, 1.6],
    ];
    let prev = 0;
    for (const [dt, m, d] of mel) {
      bowed(k, out, t + dt, mtof(m), d, 0.2, prev);
      prev = mtof(m);
    }
    oscSrc(c, 'sine', 55, t + 0.2, 4.8)
      .connect(asrGain(c, t + 0.2, 1.0, 0.25, 2.8, 1.2))
      .connect(out);
    gongHit(k, out, t + 2.5, 85, 0.45, 3.5, -0.025);
    return 5.5;
  },

  // 結算星星：鐘聲＋撥弦＋小鼓落定＋高頻閃光（rate 讓每顆星升高）
  star(k, out, t, rate) {
    const c = k.ctx;
    bell(k, out, t, 1318.5 * rate, 0.4, 1.2);
    pluck(k, out, t, 659.3 * rate, 0.3, 'pipa');
    drumHit(k, out, t, { f: 95, gain: 0.45, decay: 0.25, lite: true });
    noiseSrc(k, k.white, t, 0.4)
      .connect(biquad(c, 'highpass', 6000, 0.7))
      .connect(adGain(c, t, 0.002, 0.1, 0.3))
      .connect(out);
    return 1.3;
  },
};

/** 在五聲音階中隨機挑一個音（MIDI） */
function pick5(r: () => number, base: number): number {
  const scale = [0, 2, 4, 7, 9, 12];
  return base + scale[Math.floor(r() * scale.length) % scale.length];
}

// ─────────────────────────────────────────── 環境層細節事件（預渲染）

export type AmbEventId = 'gallop' | 'step' | 'rattle' | 'crackle' | 'shout';

/** 單一蹄聲：低頻踏地＋泥土＋蹄鐵輕擊 */
function hoof(k: Kit, out: AudioNode, t: number, gain: number): void {
  const c = k.ctx;
  const r = k.rnd;
  thud(k, out, t, rand(r, 70, 95), 0.7 * gain, 0.08);
  noiseSrc(k, k.brown, t, 0.1)
    .connect(biquad(c, 'lowpass', rand(r, 700, 1100), 0.7))
    .connect(adGain(c, t, 0.001, 0.5 * gain, 0.05))
    .connect(out);
  noiseSrc(k, k.white, t, 0.03)
    .connect(biquad(c, 'bandpass', rand(r, 1500, 2200), 1))
    .connect(adGain(c, t, 0.0005, 0.14 * gain, 0.01))
    .connect(out);
}

export const AMB_EVENTS: Record<AmbEventId, { recipe: Recipe; count: number; len: number }> = {
  // 一匹馬跑步的三連蹄（da-da-dum），整組渲染成一個緩衝，播放只要 1 個節點
  gallop: {
    count: 8,
    len: 0.45,
    recipe(k, out, t) {
      const r = k.rnd;
      hoof(k, out, t, 1);
      hoof(k, out, t + rand(r, 0.06, 0.09), 0.8);
      hoof(k, out, t + rand(r, 0.15, 0.2), 0.95);
      return 0.4;
    },
  },
  // 腳步：軟悶擊＋鞋底摩擦
  step: {
    count: 6,
    len: 0.2,
    recipe(k, out, t) {
      const c = k.ctx;
      const r = k.rnd;
      thud(k, out, t, rand(r, 95, 125), 0.35, 0.05);
      noiseSrc(k, k.pink, t, 0.12)
        .connect(biquad(c, 'bandpass', rand(r, 500, 900), 0.9))
        .connect(adGain(c, t + 0.005, 0.01, 0.3, 0.08))
        .connect(out);
      return 0.15;
    },
  },
  // 甲片碰撞：一串細小金屬輕響＋皮革摩擦
  rattle: {
    count: 6,
    len: 0.3,
    recipe(k, out, t) {
      const c = k.ctx;
      const r = k.rnd;
      const n = 4 + Math.floor(r() * 5);
      for (let i = 0; i < n; i++) metalHit(k, out, t + r() * 0.09, rand(r, 2800, 5200), rand(r, 0.04, 0.1), 0.05, 3);
      noiseSrc(k, k.pink, t, 0.15)
        .connect(biquad(c, 'bandpass', 1800, 1.2))
        .connect(adGain(c, t, 0.02, 0.06, 0.1))
        .connect(out);
      return 0.25;
    },
  },
  // 火星：1–3 顆劈啪
  crackle: {
    count: 8,
    len: 0.12,
    recipe(k, out, t) {
      const r = k.rnd;
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) crackle(k, out, t + r() * 0.06, rand(r, 0.3, 0.8));
      return 0.1;
    },
  },
  // 單兵喊殺：2–3 人的短促吼聲
  shout: {
    count: 6,
    len: 0.9,
    recipe(k, out, t) {
      const r = k.rnd;
      crowdVoices(k, out, t, {
        n: 2 + Math.floor(r() * 2), dur: rand(r, 0.35, 0.65), f0: [120, 260], gain: 0.5,
        vowel: r() < 0.5 ? 'a' : 'o', stagger: 0.08, rise: 0.85, glide: 0.75,
      });
      return 0.8;
    },
  },
};
