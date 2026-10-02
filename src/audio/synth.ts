// 低階合成工具：噪聲緩衝、包絡、濾波器、Karplus-Strong 撥弦、程式殘響、軟削波、亂數
// 所有函式只依賴 BaseAudioContext，所以同一份配方可用在即時 AudioContext 與離線 OfflineAudioContext（預渲染變體）

export type Rng = () => number;

/** 合成時需要的共用資源；離線預渲染時只換 ctx，噪聲緩衝共用 */
export interface Kit {
  ctx: BaseAudioContext;
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  rnd: Rng;
}

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const rand = (r: Rng, a: number, b: number): number => a + (b - a) * r();
export const pick = <T>(r: Rng, arr: readonly T[]): T => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

// ─────────────────────────────────────────── 噪聲

/** 產生可循環的白／粉紅／棕噪聲（單聲道）；尾端與開頭交叉淡化，循環接縫不會爆音 */
export function makeNoise(ctx: BaseAudioContext, seconds = 4): { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer } {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const fade = Math.floor(sr * 0.05);
  const total = n + fade;
  const w = new Float32Array(total);
  const p = new Float32Array(total);
  const b = new Float32Array(total);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < total; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    // Paul Kellet 粉紅噪聲濾波
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    // 棕噪聲：帶洩漏的積分
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  const out = (src: Float32Array): AudioBuffer => {
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    let peak = 1e-6;
    for (let i = 0; i < n; i++) {
      // 開頭 fade 段：與超出 n 的尾巴交叉淡化，讓 d[n-1] → d[0] 連續
      const v = i < fade ? src[i] * (i / fade) + src[n + i] * (1 - i / fade) : src[i];
      d[i] = v;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const g = 0.95 / peak;
    for (let i = 0; i < n; i++) d[i] *= g;
    return buf;
  };
  return { white: out(w), pink: out(p), brown: out(b) };
}

// ─────────────────────────────────────────── 節點小工具

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 1, gain = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(freq, 10, ctx.sampleRate * 0.45);
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

/** 固定增益節點 */
export function gainNode(ctx: BaseAudioContext, v: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** 打擊包絡：attack 線性升到 peak，之後指數衰減（decay＝約 -60 dB 所需秒數） */
export function adGain(ctx: BaseAudioContext, t: number, attack: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain();
  const p = g.gain;
  p.value = 0;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + Math.max(0.0005, attack));
  p.setTargetAtTime(0, t + Math.max(0.0005, attack), Math.max(0.002, decay / 6.9));
  return g;
}

/** 持續音包絡：attack → 持平到 t+dur → release 指數收尾 */
export function asrGain(ctx: BaseAudioContext, t: number, attack: number, peak: number, dur: number, release: number): GainNode {
  const g = ctx.createGain();
  const p = g.gain;
  const a = Math.max(0.002, attack);
  const hold = Math.max(t + a, t + dur);
  p.value = 0;
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, hold);
  p.setTargetAtTime(0, hold, Math.max(0.005, release / 4));
  return g;
}

/** 循環噪聲來源，隨機起點 */
export function noiseSrc(k: Kit, buf: AudioBuffer, t: number, dur: number, rate = 1): AudioBufferSourceNode {
  const s = k.ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(t, k.rnd() * buf.duration * 0.9);
  s.stop(t + Math.max(0.01, dur));
  return s;
}

/** 振盪器來源 */
export function oscSrc(ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.start(t);
  o.stop(t + Math.max(0.01, dur));
  return o;
}

/** 立體聲像節點（舊瀏覽器沒有 StereoPanner 時回傳直通的 Gain） */
export function panner(ctx: BaseAudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner !== 'function') return gainNode(ctx, 1);
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  return p;
}

// ─────────────────────────────────────────── 波形快取

const curveCache = new Map<number, Float32Array<ArrayBuffer>>();
/** tanh 軟削波曲線（WaveShaper 用），drive 越大越飽和 */
export function softClipCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 100);
  let c = curveCache.get(key);
  if (c) return c;
  const n = 2048;
  c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * drive) / norm;
  }
  curveCache.set(key, c);
  return c;
}

/** 軟削波節點；oversample 預設關閉（省 CPU），強烈失真的高頻素材再開 '2x' */
export function shaper(ctx: BaseAudioContext, drive: number, oversample: OverSampleType = 'none'): WaveShaperNode {
  const s = ctx.createWaveShaper();
  s.curve = softClipCurve(drive);
  s.oversample = oversample;
  return s;
}

const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
/** 自訂週期波形（依泛音振幅陣列，index 0 為直流） */
export function periodic(ctx: BaseAudioContext, name: string, harmonics: number[]): PeriodicWave {
  let m = waveCache.get(ctx);
  if (!m) {
    m = new Map();
    waveCache.set(ctx, m);
  }
  let w = m.get(name);
  if (!w) {
    const real = new Float32Array(harmonics.length);
    const imag = new Float32Array(harmonics);
    imag[0] = 0;
    w = ctx.createPeriodicWave(real, imag);
    m.set(name, w);
  }
  return w;
}

// ─────────────────────────────────────────── Karplus-Strong 撥弦

export interface PluckTone {
  t60: number; // 衰減到 -60 dB 的秒數
  bright: number; // 激發噪聲亮度 0..1
  dur: number; // 緩衝長度
  pos: number; // 撥弦位置（梳狀濾波）0..0.5
}

const ksCache = new Map<string, AudioBuffer>();
/** 以 JS 逐樣本產生 Karplus-Strong 撥弦音（分數延遲線性內插，音準正確），依 (樂器, 音高) 快取 */
export function ksBuffer(ctx: BaseAudioContext, midi: number, tone: PluckTone, key: string): AudioBuffer {
  const sr = ctx.sampleRate;
  const id = `${key}:${midi}:${sr}`;
  const hit = ksCache.get(id);
  if (hit) return hit;
  const f = mtof(midi);
  const n = Math.floor(sr * tone.dur);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const D = sr / f - 0.5; // 兩點平均帶來半個樣本延遲
  const exLen = Math.ceil(D) + 2;
  const ex = new Float32Array(exLen);
  let lp = 0;
  for (let i = 0; i < exLen; i++) {
    lp += (Math.random() * 2 - 1 - lp) * tone.bright;
    ex[i] = lp;
  }
  const posN = Math.max(1, Math.floor(exLen * tone.pos));
  const loss = Math.pow(0.001, 1 / (f * tone.t60));
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    let v = i < exLen ? ex[i] - (i >= posN ? ex[i - posN] * 0.9 : 0) : 0;
    const p = i - D;
    if (p >= 1) {
      const i0 = Math.floor(p);
      const fr = p - i0;
      const y1 = d[i0] + (d[i0 + 1] - d[i0]) * fr;
      const y0 = d[i0 - 1] + (d[i0] - d[i0 - 1]) * fr;
      v += loss * 0.5 * (y1 + y0);
    }
    d[i] = v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
  }
  // 正規化＋尾端淡出
  const g = 0.85 / peak;
  const tail = Math.floor(n * 0.1);
  for (let i = 0; i < n; i++) {
    const fo = i > n - tail ? (n - i) / tail : 1;
    d[i] *= g * fo;
  }
  ksCache.set(id, buf);
  return buf;
}

// ─────────────────────────────────────────── 程式殘響

/**
 * 產生戰場殘響 IR（立體聲）：漸暗的指數衰減噪聲尾巴＋早期反射＋遠山回聲
 * seconds：長度；rt：衰減到 -60 dB 的秒數
 */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, rt: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const tt = (i - pre) / sr;
      const env = Math.exp((-6.9 * tt) / rt);
      // 越晚越暗：一階低通係數隨時間下降
      const a = 0.85 - 0.7 * Math.min(1, tt / rt);
      lp += (Math.random() * 2 - 1 - lp) * a;
      d[i] = lp * env * 0.6;
    }
    // 早期反射
    for (let j = 0; j < 10; j++) {
      const idx = pre + Math.floor(sr * (0.004 + Math.random() * 0.07));
      if (idx < n) d[idx] += (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.45);
    }
    // 遠山回聲：兩團較暗的回音
    const echoes: Array<[number, number]> = [
      [0.27 + ch * 0.015, 0.28],
      [0.46 + ch * 0.022, 0.16],
    ];
    for (const [et, eg] of echoes) {
      const s0 = Math.floor(sr * et);
      const len = Math.floor(sr * 0.03);
      let e = 0;
      for (let i = 0; i < len && s0 + i < n; i++) {
        e += (Math.random() * 2 - 1 - e) * 0.25;
        d[s0 + i] += e * eg * Math.sin((Math.PI * i) / len);
      }
    }
  }
  return buf;
}
